"""Read-only Git inspection tools. This MVP intentionally does not mutate refs."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from ..errors import WorkspaceError
from ..policy import RiskLevel
from ..workspace import Workspace
from .base import Tool, ToolContext, ToolResult
from .process import run_bounded_process


class _GitTool(Tool):
    required_capability = "git.read"

    def _run(self, argv: list[str], context: ToolContext) -> ToolResult:
        try:
            result = run_bounded_process(
                ["git", *argv],
                cwd=context.workspace.root,
                timeout_seconds=20,
                output_limit_bytes=32_000,
            )
        except (OSError, ValueError) as exc:
            return ToolResult.failure(f"Could not run Git: {exc}")
        if result.return_code != 0:
            message = result.stderr.strip() or result.stdout.strip() or f"git exited with {result.return_code}"
            return ToolResult.failure(message)
        return ToolResult.success({
            "stdout": result.stdout,
            "stderr": result.stderr,
            "return_code": result.return_code,
            "duration_seconds": round(result.duration_seconds, 3),
            "truncated": result.stdout_truncated or result.stderr_truncated,
        })

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW


class GitStatusTool(_GitTool):
    name = "git.status"
    description = "Show concise Git branch and working-tree status for the workspace."
    input_schema = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        return self._run(["status", "--short", "--branch"], context)


class GitDiffTool(_GitTool):
    name = "git.diff"
    description = (
        "Show a bounded Git diff. Secret-looking changed files are omitted unless one sensitive path "
        "is explicitly requested and permitted."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "staged": {"type": "boolean"},
            "path": {"type": "string", "maxLength": 1000},
        },
        "required": [],
        "additionalProperties": False,
    }

    def _is_sensitive_request(self, arguments: Mapping[str, Any], context: ToolContext) -> bool:
        if "path" not in arguments:
            return False
        raw = Path(str(arguments["path"])).expanduser()
        try:
            resolved = context.workspace.resolve(raw)
        except WorkspaceError:
            resolved = raw
        return Workspace.is_sensitive_path(raw) or Workspace.is_sensitive_path(resolved)

    def capability(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        return "git.read_sensitive" if self._is_sensitive_request(arguments, context) else "git.read"

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.HIGH if self._is_sensitive_request(arguments, context) else RiskLevel.LOW

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        if "path" in arguments:
            return f"Read Git diff for path: {arguments['path']}"
        return "Read a bounded Git diff; known secret-looking file paths will be omitted."

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        base = ["diff", "--no-ext-diff", "--no-color"]
        if arguments.get("staged", False):
            base.append("--staged")
        if "path" in arguments:
            try:
                path = context.workspace.resolve(arguments["path"])
            except WorkspaceError as exc:
                return ToolResult.failure(str(exc))
            base.extend(["--", path.relative_to(context.workspace.root).as_posix()])
            return self._run(base, context)

        # Discover changed paths first so known secret/credential files never enter
        # the broad diff output by default. NUL delimiters preserve whitespace names.
        name_command = ["diff", "--no-ext-diff", "--name-only", "-z"]
        if arguments.get("staged", False):
            name_command.append("--staged")
        names = self._run(name_command, context)
        if not names.ok:
            return names
        if names.data["truncated"]:
            return ToolResult.failure(
                "Changed-path list exceeded the output limit; request a path-specific diff instead."
            )
        changed_paths = [item for item in names.data["stdout"].split("\x00") if item]
        sensitive_paths = [item for item in changed_paths if Workspace.is_sensitive_path(Path(item))]
        visible_paths = [item for item in changed_paths if item not in sensitive_paths]
        if not visible_paths:
            return ToolResult.success({
                "stdout": "",
                "stderr": "",
                "return_code": 0,
                "duration_seconds": names.data["duration_seconds"],
                "truncated": False,
                "redacted_sensitive_file_count": len(sensitive_paths),
            })

        safe_paths: list[str] = []
        approximate_arg_bytes = 0
        for item in visible_paths:
            size = len(item.encode("utf-8", errors="replace")) + 1
            if len(safe_paths) >= 100 or approximate_arg_bytes + size > 24_000:
                break
            safe_paths.append(item)
            approximate_arg_bytes += size
        diff = self._run(base + ["--", *safe_paths], context)
        if not diff.ok:
            return diff
        diff.data["redacted_sensitive_file_count"] = len(sensitive_paths)
        diff.data["paths_limited"] = len(safe_paths) < len(visible_paths)
        return diff


class GitLogTool(_GitTool):
    name = "git.log"
    description = "Show recent one-line commits from the workspace Git repository."
    input_schema = {
        "type": "object",
        "properties": {"max_count": {"type": "integer", "minimum": 1, "maximum": 50}},
        "required": [],
        "additionalProperties": False,
    }

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        return self._run(["log", "--oneline", "--decorate", "-n", str(arguments.get("max_count", 10))], context)


def built_in_git_tools() -> list[Tool]:
    return [GitStatusTool(), GitDiffTool(), GitLogTool()]
