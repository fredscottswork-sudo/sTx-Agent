from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from stx_agent.policy import ApprovalRequest, PermissionMode, Policy, RiskLevel
from stx_agent.tools import ToolContext, ToolRegistry
from stx_agent.tools.filesystem import built_in_filesystem_tools
from stx_agent.workspace import Workspace


class PolicyTests(unittest.TestCase):
    def test_deny_is_never_overridden_by_approval_or_dry_run(self) -> None:
        asked = []
        policy = Policy({"terminal.execute": PermissionMode.DENY})
        result = policy.authorize(
            capability="terminal.execute", tool_name="terminal.run", risk=RiskLevel.LOW,
            autonomy="autonomous", details="read only", approval=lambda request: asked.append(request) or True,
            dry_run=True,
        )
        self.assertFalse(result.allowed)
        self.assertEqual(asked, [])

    def test_confirm_mode_requires_positive_user_approval(self) -> None:
        policy = Policy({"filesystem.write": PermissionMode.CONFIRM})
        request_seen: list[ApprovalRequest] = []
        allowed = policy.authorize(
            capability="filesystem.write", tool_name="workspace.write_file", risk=RiskLevel.MEDIUM,
            autonomy="assisted", details="create a.py", approval=lambda request: request_seen.append(request) or True,
        )
        rejected = policy.authorize(
            capability="filesystem.write", tool_name="workspace.write_file", risk=RiskLevel.MEDIUM,
            autonomy="assisted", details="create b.py", approval=lambda request: False,
        )
        self.assertTrue(allowed.allowed)
        self.assertTrue(allowed.confirmation_required)
        self.assertFalse(rejected.allowed)
        self.assertEqual(request_seen[0].details, "create a.py")

    def test_manual_and_assisted_modes_raise_confirmation_for_risky_actions(self) -> None:
        policy = Policy({"terminal.execute": PermissionMode.ALLOW})
        no_approval = policy.authorize(
            capability="terminal.execute", tool_name="terminal.run", risk=RiskLevel.HIGH,
            autonomy="assisted", details="run code", approval=None,
        )
        autonomous = policy.authorize(
            capability="terminal.execute", tool_name="terminal.run", risk=RiskLevel.HIGH,
            autonomy="autonomous", details="run code", approval=None,
        )
        self.assertFalse(no_approval.allowed)
        self.assertTrue(autonomous.allowed)

    def test_dry_run_previews_side_effects_but_does_not_bypass_read_confirmation(self) -> None:
        policy = Policy({
            "filesystem.write": PermissionMode.CONFIRM,
            "filesystem.read_sensitive": PermissionMode.CONFIRM,
        })
        preview = policy.authorize(
            capability="filesystem.write", tool_name="workspace.write_file", risk=RiskLevel.MEDIUM,
            autonomy="assisted", details="preview", approval=None, dry_run=True,
        )
        sensitive_read = policy.authorize(
            capability="filesystem.read_sensitive", tool_name="workspace.read_file", risk=RiskLevel.HIGH,
            autonomy="assisted", details="read .env", approval=None, dry_run=True,
        )
        self.assertTrue(preview.allowed)
        self.assertFalse(sensitive_read.allowed)
        self.assertTrue(sensitive_read.confirmation_required)

    def test_unlisted_capability_is_denied(self) -> None:
        self.assertEqual(Policy().mode_for("network.request"), PermissionMode.DENY)


class WorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "workspace"
        self.root.mkdir()
        self.workspace = Workspace(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_path_traversal_is_rejected_for_reads_and_writes(self) -> None:
        outside = Path(self.temp.name) / "outside.txt"
        outside.write_text("private", encoding="utf-8")
        with self.assertRaises(Exception):
            self.workspace.read_text("../outside.txt")
        with self.assertRaises(Exception):
            self.workspace.write_text("../outside.txt", "overwritten")
        self.assertEqual(outside.read_text(encoding="utf-8"), "private")

    def test_symlink_escape_is_rejected_when_supported(self) -> None:
        outside = Path(self.temp.name) / "outside.txt"
        outside.write_text("private", encoding="utf-8")
        link = self.root / "outside-link"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are not available")
        with self.assertRaises(Exception):
            self.workspace.read_text("outside-link")
        self.assertNotIn("outside-link", self.workspace.list_files()["files"])

    def test_secret_looking_files_are_hidden_and_denied_by_default(self) -> None:
        secret = self.root / ".env"
        secret.write_text("API_KEY=not-for-context", encoding="utf-8")
        (self.root / ".env.example").write_text("API_KEY=replace-me", encoding="utf-8")
        (self.root / "production.env").write_text("API_KEY=also-private", encoding="utf-8")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "config").write_text("credential", encoding="utf-8")
        self.assertNotIn(".env", self.workspace.list_files()["files"])
        self.assertNotIn("production.env", self.workspace.list_files()["files"])
        self.assertIn(".env.example", self.workspace.list_files()["files"])
        with self.assertRaises(Exception):
            self.workspace.read_text(".env")
        with self.assertRaises(Exception):
            self.workspace.list_files(".git")
        with self.assertRaises(Exception):
            self.workspace.search_text("credential", ".git")

    def test_sensitive_file_permission_is_explicit(self) -> None:
        (self.root / ".env").write_text("API_KEY=unit-test", encoding="utf-8")
        tool = next(tool for tool in built_in_filesystem_tools() if tool.name == "workspace.read_file")
        denied_context = ToolContext(
            self.workspace, Policy({"filesystem.read": PermissionMode.ALLOW, "filesystem.read_sensitive": PermissionMode.DENY})
        )
        registry = ToolRegistry([tool])
        denied = registry.execute("workspace.read_file", {"path": ".env"}, denied_context)
        self.assertFalse(denied.ok)
        allowed_context = ToolContext(
            self.workspace,
            Policy({"filesystem.read": PermissionMode.ALLOW, "filesystem.read_sensitive": PermissionMode.CONFIRM}),
            approval=lambda request: True,
        )
        # Exercise policy through the registry (not the tool implementation directly).
        registry = ToolRegistry([tool])
        result = registry.execute("workspace.read_file", {"path": ".env"}, allowed_context)
        self.assertTrue(result.ok)
        self.assertIn("unit-test", result.data["content"])

    def test_write_is_atomic_and_reports_diff(self) -> None:
        self.workspace.write_text("src/a.txt", "before\n")
        result = self.workspace.write_text("src/a.txt", "after\n")
        self.assertTrue(result["overwritten"])
        self.assertIn("-before", result["diff"])
        self.assertEqual((self.root / "src/a.txt").read_text(encoding="utf-8"), "after\n")
        self.assertFalse(list(self.root.rglob("*.stx-tmp-*")))

    def test_read_size_limit_and_search(self) -> None:
        (self.root / "note.txt").write_text("Alpha\nBeta\n", encoding="utf-8")
        self.assertEqual(self.workspace.search_text("beta")["matches"][0]["line"], 2)
        with self.assertRaisesRegex(Exception, "per-read limit"):
            self.workspace.read_text("note.txt", max_bytes=2)


if __name__ == "__main__":
    unittest.main()
