from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

from stx_agent.policy import PermissionMode, Policy
from stx_agent.tools import ToolContext
from stx_agent.tools.git_tools import GitDiffTool, GitStatusTool
from stx_agent.tools.process import safe_child_environment
from stx_agent.tools.registry import ToolRegistry
from stx_agent.tools.terminal import TerminalTool
from stx_agent.workspace import Workspace


class ToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def context(self, *, dry_run: bool = False, autonomy: str = "assisted", approval=None) -> ToolContext:
        return ToolContext(
            self.workspace,
            Policy({"terminal.execute": PermissionMode.ALLOW, "git.read": PermissionMode.ALLOW}),
            autonomy=autonomy,
            approval=approval,
            dry_run=dry_run,
        )

    def test_registry_rejects_unknown_properties(self) -> None:
        tool = TerminalTool()
        result = ToolRegistry([tool]).execute("terminal.run", {"argv": ["pwd"], "shell": True}, self.context())
        self.assertFalse(result.ok)
        self.assertIn("Unexpected argument", result.error)

    def test_terminal_executes_argv_without_shell_and_returns_bounded_result(self) -> None:
        tool = TerminalTool()
        result = tool.execute({"argv": [sys.executable, "--version"]}, self.context())
        self.assertTrue(result.ok)
        self.assertEqual(result.data["return_code"], 0)
        self.assertIn("Python", result.data["stdout"] + result.data["stderr"])
        self.assertFalse(result.data["timed_out"])

    def test_terminal_dry_run_does_not_execute(self) -> None:
        marker = Path(self.temp.name) / "must-not-exist"
        result = TerminalTool().execute(
            {"argv": [sys.executable, "-c", f"open({str(marker)!r}, 'w').write('bad')"]},
            self.context(dry_run=True),
        )
        self.assertTrue(result.ok)
        self.assertFalse(result.data["executed"])
        self.assertFalse(marker.exists())

    def test_terminal_cancellation_terminates_process(self) -> None:
        from threading import Event, Timer
        from stx_agent.tools.process import run_bounded_process

        cancelled = Event()
        timer = Timer(0.15, cancelled.set)
        timer.start()
        try:
            result = run_bounded_process(
                [sys.executable, "-c", "import time; time.sleep(20)"],
                cwd=Path(self.temp.name), timeout_seconds=5, cancel_event=cancelled,
            )
        finally:
            timer.cancel()
        self.assertTrue(result.cancelled)
        self.assertLess(result.duration_seconds, 3)

    def test_terminal_timeout_and_output_truncation(self) -> None:
        context = self.context(autonomy="autonomous")
        timeout_result = TerminalTool().execute(
            {"argv": [sys.executable, "-c", "import time; time.sleep(2)"], "timeout_seconds": 1},
            context,
        )
        self.assertTrue(timeout_result.ok)
        self.assertTrue(timeout_result.data["timed_out"])

        from stx_agent.tools.process import run_bounded_process
        result = run_bounded_process(
            [sys.executable, "-c", "print('x' * 5000)"],
            cwd=self.workspace.root,
            timeout_seconds=5,
            output_limit_bytes=256,
        )
        self.assertTrue(result.stdout_truncated)
        self.assertIn("output truncated", result.stdout)

    def test_terminal_confirmation_is_enforced_by_registry(self) -> None:
        context = ToolContext(
            self.workspace,
            Policy({"terminal.execute": PermissionMode.CONFIRM}),
            autonomy="autonomous",
            approval=None,
        )
        result = ToolRegistry([TerminalTool()]).execute("terminal.run", {"argv": ["pwd"]}, context)
        self.assertFalse(result.ok)
        self.assertIn("requires confirmation", result.error)

    def test_risk_classifier_catches_secret_reads_and_execution_helpers(self) -> None:
        tool = TerminalTool()
        context = self.context()
        self.assertEqual(tool.risk({"argv": ["cat", ".env"]}, context).name, "HIGH")
        self.assertEqual(tool.risk({"argv": ["find", ".", "-exec", "echo", "{}", ";"]}, context).name, "HIGH")
        self.assertEqual(tool.risk({"argv": ["git", "diff"]}, context).name, "HIGH")
        self.assertEqual(tool.risk({"argv": ["python3.11", "--version"]}, context).name, "LOW")

    def test_child_environment_does_not_inherit_api_keys(self) -> None:
        with patch.dict(os.environ, {"PATH": "/bin", "OPENAI_API_KEY": "do-not-pass", "CI": "1"}):
            environment = safe_child_environment()
        self.assertEqual(environment.get("PATH"), "/bin")
        self.assertEqual(environment.get("CI"), "1")
        self.assertNotIn("OPENAI_API_KEY", environment)

    @unittest.skipUnless(shutil.which("git"), "Git is required")
    def test_read_only_git_status_works(self) -> None:
        import subprocess
        subprocess.run(["git", "init", "-q"], cwd=self.workspace.root, check=True)
        result = GitStatusTool().execute({}, self.context())
        self.assertTrue(result.ok, result.error)
        self.assertIn("##", result.data["stdout"])

    @unittest.skipUnless(shutil.which("git"), "Git is required")
    def test_broad_git_diff_redacts_secret_file_content(self) -> None:
        import subprocess
        secret_file = self.workspace.root / ".env"
        code_file = self.workspace.root / "app.py"
        secret_file.write_text("API_KEY=old-value\\n", encoding="utf-8")
        code_file.write_text("value = 1\\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=self.workspace.root, check=True)
        subprocess.run(["git", "add", ".env", "app.py"], cwd=self.workspace.root, check=True)
        subprocess.run([
            "git", "-c", "user.name=STX Test", "-c", "user.email=stx@example.invalid",
            "commit", "-qm", "baseline",
        ], cwd=self.workspace.root, check=True)
        secret_file.write_text("API_KEY=top-secret-new-value\\n", encoding="utf-8")
        code_file.write_text("value = 2\\n", encoding="utf-8")
        context = ToolContext(
            self.workspace,
            Policy({"git.read": PermissionMode.ALLOW, "git.read_sensitive": PermissionMode.DENY}),
        )
        registry = ToolRegistry([GitDiffTool()])
        broad = registry.execute("git.diff", {}, context)
        self.assertTrue(broad.ok, broad.error)
        self.assertIn("value = 2", broad.data["stdout"])
        self.assertNotIn("top-secret-new-value", broad.data["stdout"])
        self.assertEqual(broad.data["redacted_sensitive_file_count"], 1)
        explicit = registry.execute("git.diff", {"path": ".env"}, context)
        self.assertFalse(explicit.ok)
        self.assertIn("denied", explicit.error.lower())


if __name__ == "__main__":
    unittest.main()
