"""Model-facing workspace inspection and filesystem tools."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Mapping

from ..errors import WorkspaceError
from ..policy import RiskLevel
from ..workspace import Workspace, format_text_diff
from .base import Tool, ToolContext, ToolResult


class WorkspaceInspectTool(Tool):
    name = "workspace.inspect"
    description = "Inspect project root entries and common manifest markers without reading file contents."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object", "properties": {}, "required": [], "additionalProperties": False,
    }

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        return ToolResult.success(context.workspace.summary(include_root=False))


class WorkspaceListTool(Tool):
    name = "workspace.list_files"
    description = "List non-secret files under a workspace directory; generated/vendor directories are skipped."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "maxLength": 1000},
            "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
        },
        "required": [],
        "additionalProperties": False,
    }

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        return ToolResult.success(context.workspace.list_files(arguments.get("path", "."), limit=arguments.get("limit", 200)))


class WorkspaceReadTool(Tool):
    name = "workspace.read_file"
    description = "Read a UTF-8 text file inside the workspace. Secret-looking files are denied unless explicitly permitted."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object",
        "properties": {"path": {"type": "string", "minLength": 1, "maxLength": 2000}},
        "required": ["path"],
        "additionalProperties": False,
    }

    def capability(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        raw = Path(str(arguments.get("path", ""))).expanduser()
        try:
            resolved = context.workspace.resolve(raw, must_exist=True)
        except WorkspaceError:
            resolved = raw
        if context.workspace.is_sensitive_path(raw) or context.workspace.is_sensitive_path(resolved):
            return "filesystem.read_sensitive"
        return "filesystem.read"

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        if self.capability(arguments, context) == "filesystem.read_sensitive":
            return RiskLevel.HIGH
        return RiskLevel.LOW

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        return f"Read file: {arguments.get('path', '')}"

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        is_sensitive = self.capability(arguments, context) == "filesystem.read_sensitive"
        return ToolResult.success(context.workspace.read_text(arguments["path"], allow_sensitive=is_sensitive))


class WorkspaceSearchTool(Tool):
    name = "workspace.search_text"
    description = "Search literal text in bounded UTF-8 workspace files; secret-looking files are skipped."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": 500},
            "path": {"type": "string", "maxLength": 1000},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        return ToolResult.success(context.workspace.search_text(
            arguments["query"],
            arguments.get("path", "."),
            limit=arguments.get("limit", 50),
        ))


class WorkspaceWriteTool(Tool):
    name = "workspace.write_file"
    description = "Create or replace a UTF-8 file in the workspace. Policy may require user confirmation."
    required_capability = "filesystem.write"
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "minLength": 1, "maxLength": 2000},
            "content": {"type": "string", "maxLength": 1000000},
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    }

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.MEDIUM

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        try:
            raw_path = Path(str(arguments.get("path", ""))).expanduser()
            target = context.workspace.resolve(str(arguments.get("path", "")))
            if context.workspace.is_sensitive_path(raw_path) or context.workspace.is_sensitive_path(target):
                return "Write to a secret/credential path (the tool will reject this)."
            exists = target.exists()
            content = str(arguments.get("content", ""))
            byte_count = len(content.encode("utf-8"))
            action = "replace" if exists else "create"
            old = ""
            if exists and target.is_file():
                with target.open("rb") as handle:
                    old_bytes = handle.read(1_000_001)
                if len(old_bytes) <= 1_000_000:
                    old = old_bytes.decode("utf-8")
                else:
                    old = "[existing content omitted: file exceeds preview limit]\n"
            relative_name = target.relative_to(context.workspace.root).as_posix()
            preview = format_text_diff(
                old,
                content,
                from_file=f"a/{relative_name}",
                to_file=f"b/{relative_name}",
            )
            if len(preview) > 4000:
                preview = preview[:4000] + "\n[approval preview truncated]\n"
            return (
                f"{action.capitalize()} {target.relative_to(context.workspace.root)} "
                f"({byte_count} UTF-8 bytes)\n{preview or '[no text diff]'}"
            )
        except (WorkspaceError, OSError, UnicodeDecodeError, ValueError):
            return f"Write requested path: {arguments.get('path', '')}"

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if not context.dry_run:
            return ToolResult.success(context.workspace.write_text(arguments["path"], arguments["content"]))
        try:
            target = context.workspace.resolve(arguments["path"])
            if context.workspace.is_sensitive_path(Path(arguments["path"])) or context.workspace.is_sensitive_path(target):
                raise WorkspaceError("Writing secret/credential paths is disabled by the filesystem tool.")
            if target.exists() and not target.is_file():
                raise WorkspaceError("Target is not a regular file.")
            if target.exists() and target.stat().st_size > 1_000_000:
                raise WorkspaceError("Existing file exceeds the 1,000,000-byte safe replacement limit.")
            old = ""
            if target.exists():
                with target.open("rb") as handle:
                    old_bytes = handle.read(1_000_001)
                if len(old_bytes) > 1_000_000:
                    raise WorkspaceError("Existing file exceeds the 1,000,000-byte safe replacement limit.")
                old = old_bytes.decode("utf-8")
            content = arguments["content"]
            relative_name = target.relative_to(context.workspace.root).as_posix()
            diff = format_text_diff(
                old,
                content,
                from_file=f"a/{relative_name}",
                to_file=f"b/{relative_name}",
            )
            encoded = content.encode("utf-8")
            if len(encoded) > 1_000_000:
                raise WorkspaceError("Content exceeds the 1,000,000-byte write limit.")
            return ToolResult.success({
                "dry_run": True,
                "path": target.relative_to(context.workspace.root).as_posix(),
                "bytes": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest(),
                "diff": diff[:12000],
                "diff_truncated": len(diff) > 12000 or diff.startswith("[diff omitted:"),
                "written": False,
            })
        except (WorkspaceError, OSError, UnicodeDecodeError, ValueError) as exc:
            return ToolResult.failure(str(exc))


def built_in_filesystem_tools() -> list[Tool]:
    return [
        WorkspaceInspectTool(),
        WorkspaceListTool(),
        WorkspaceReadTool(),
        WorkspaceSearchTool(),
        WorkspaceWriteTool(),
    ]
