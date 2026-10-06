"""Policy-gated direct argv execution (never invokes a shell)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from ..policy import RiskLevel
from .base import Tool, ToolContext, ToolResult
from .process import run_bounded_process


_LOW_RISK_COMMANDS = {"pwd", "ls", "dir", "find", "rg", "grep", "cat", "head", "tail", "wc", "file"}
_HIGH_RISK_COMMANDS = {
    "bash", "sh", "zsh", "fish", "cmd", "cmd.exe", "powershell", "pwsh",
    "python", "python3", "node", "ruby", "perl", "php", "java", "sudo", "su",
    "rm", "rmdir", "del", "erase", "format", "mkfs", "dd", "shutdown", "reboot",
    "curl", "wget", "ssh", "scp", "nc", "netcat", "pip", "pip3", "npm", "pnpm", "yarn",
}
_CONTENT_READ_COMMANDS = {"cat", "head", "tail", "grep", "rg", "sed", "awk", "more", "less"}


class TerminalTool(Tool):
    name = "terminal.run"
    description = (
        "Run one executable with an argv array in the workspace (no shell expansion). "
        "Commands have bounded runtime/output and may require approval."
    )
    required_capability = "terminal.execute"
    input_schema = {
        "type": "object",
        "properties": {
            "argv": {
                "type": "array", "minItems": 1, "maxItems": 128,
                "items": {"type": "string", "maxLength": 8192},
            },
            "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
        },
        "required": ["argv"],
        "additionalProperties": False,
    }

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        argv = arguments.get("argv", [])
        if not argv:
            return RiskLevel.HIGH
        executable = Path(argv[0]).name.lower()
        if executable.endswith(".exe"):
            executable = executable[:-4]

        if executable in _CONTENT_READ_COMMANDS:
            # Terminal reads can bypass filesystem-specific redaction (including
            # hidden files reached via broad search), so keep them approval-gated.
            return RiskLevel.HIGH

        if executable.startswith("python") or executable in _HIGH_RISK_COMMANDS:
            # A few metadata-only invocations do not execute project code.
            if executable.startswith("python") and argv[1:] in (["--version"], ["-V"]):
                return RiskLevel.LOW
            return RiskLevel.HIGH
        if executable == "git":
            subcommand = argv[1].lower() if len(argv) > 1 else ""
            if subcommand in {"status", "log", "rev-parse"}:
                return RiskLevel.LOW
            if subcommand == "branch":
                mutating = {"-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force"}
                return RiskLevel.HIGH if any(item in mutating for item in argv[2:]) else RiskLevel.LOW
            # Diff/show can reveal repository contents and may run configured helpers.
            return RiskLevel.HIGH
        if executable == "find" and any(item in {"-exec", "-execdir", "-delete"} for item in argv[1:]):
            return RiskLevel.HIGH
        if executable == "rg" and any(item == "--pre" or item.startswith("--pre=") for item in argv[1:]):
            return RiskLevel.HIGH
        if executable in _LOW_RISK_COMMANDS:
            return RiskLevel.LOW
        return RiskLevel.MEDIUM

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        return "Command: " + repr(arguments.get("argv", []))

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        argv = arguments["argv"]
        timeout = arguments.get("timeout_seconds", 30)
        if context.dry_run:
            return ToolResult.success({
                "dry_run": True,
                "executed": False,
                "argv": argv,
                "cwd": ".",
                "timeout_seconds": timeout,
            })
        try:
            result = run_bounded_process(
                argv,
                cwd=context.workspace.root,
                timeout_seconds=timeout,
                output_limit_bytes=32_000,
                cancel_event=context.cancel_event,
            )
        except (OSError, ValueError) as exc:
            return ToolResult.failure(f"Could not start command: {exc}")
        return ToolResult.success({
            "argv": result.argv,
            "return_code": result.return_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "duration_seconds": round(result.duration_seconds, 3),
            "timed_out": result.timed_out,
            "cancelled": result.cancelled,
            "stdout_truncated": result.stdout_truncated,
            "stderr_truncated": result.stderr_truncated,
            "cwd": ".",
        })
