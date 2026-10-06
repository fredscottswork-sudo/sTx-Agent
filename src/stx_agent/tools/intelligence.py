"""Repository index and explicit-memory tools."""

from __future__ import annotations
from typing import Any, Mapping

from ..config import IndexSettings, MemorySettings
from ..indexing import ProjectIndex
from ..memory import MEMORY_CATEGORIES, MemoryStore
from ..policy import RiskLevel
from ..workspace import Workspace
from .base import Tool, ToolContext, ToolResult


class ProjectIndexTool(Tool):
    name = "project.index"
    description = "Incrementally index workspace file metadata and language symbols in a local SQLite database."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object",
        "properties": {"force": {"type": "boolean"}},
        "required": [],
        "additionalProperties": False,
    }

    def __init__(self, settings: IndexSettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        index = ProjectIndex(
            context.workspace,
            max_files=self.settings.max_files,
            max_file_bytes=self.settings.max_file_bytes,
        )
        return ToolResult.success(index.index(force=arguments.get("force", False)).as_dict())


class ProjectSearchTool(Tool):
    name = "project.search"
    description = "Search the incremental project index by task terms, file names, symbols, and source text."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": 500},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50},
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def __init__(self, settings: IndexSettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        index = ProjectIndex(
            context.workspace,
            max_files=self.settings.max_files,
            max_file_bytes=self.settings.max_file_bytes,
        )
        return ToolResult.success(index.search(arguments["query"], limit=arguments.get("limit", 20)))


class ProjectSymbolsTool(Tool):
    name = "project.symbols"
    description = "List indexed function, class, and symbol signatures, optionally filtered by path or name."
    required_capability = "filesystem.read"
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "maxLength": 1000},
            "query": {"type": "string", "maxLength": 100},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500},
        },
        "required": [],
        "additionalProperties": False,
    }

    def __init__(self, settings: IndexSettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        index = ProjectIndex(
            context.workspace,
            max_files=self.settings.max_files,
            max_file_bytes=self.settings.max_file_bytes,
        )
        return ToolResult.success(index.symbols(
            path=arguments.get("path"),
            query=arguments.get("query"),
            limit=arguments.get("limit", 100),
        ))


class MemorySearchTool(Tool):
    name = "memory.search"
    description = "Search explicit, expiring local project memories. Memory is never populated automatically."
    required_capability = "memory.read"
    input_schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "maxLength": 500},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "required": [],
        "additionalProperties": False,
    }

    def __init__(self, settings: MemorySettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.LOW

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        store = MemoryStore(context.workspace, retention_days=self.settings.retention_days)
        query = arguments.get("query", "")
        items = store.search(query, limit=arguments.get("limit", 10)) if query else store.list(limit=arguments.get("limit", 10))
        return ToolResult.success([item.as_dict() for item in items])


class MemoryRememberTool(Tool):
    name = "memory.remember"
    description = (
        "Persist a concise, useful project fact or decision locally with expiration. "
        "Never store credentials, private personal data, or entire files."
    )
    required_capability = "memory.write"
    input_schema = {
        "type": "object",
        "properties": {
            "content": {"type": "string", "minLength": 1, "maxLength": 8000},
            "category": {"type": "string", "enum": sorted(MEMORY_CATEGORIES)},
            "importance": {"type": "number", "minimum": 0, "maximum": 1},
            "ttl_days": {"type": "integer", "minimum": 1, "maximum": 3650},
            "tags": {
                "type": "array", "maxItems": 20,
                "items": {"type": "string", "maxLength": 64},
            },
        },
        "required": ["content"],
        "additionalProperties": False,
    }

    def __init__(self, settings: MemorySettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.MEDIUM

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        content = str(arguments.get("content", ""))
        preview = content[:500] + ("…" if len(content) > 500 else "")
        return f"Store {arguments.get('category', 'project')} memory ({len(content)} chars): {preview}"

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if context.dry_run:
            return ToolResult.success({
                "dry_run": True,
                "stored": False,
                "category": arguments.get("category", "project"),
                "content_characters": len(arguments.get("content", "")),
                "ttl_days": arguments.get("ttl_days", self.settings.retention_days),
            })
        store = MemoryStore(context.workspace, retention_days=self.settings.retention_days)
        item = store.remember(
            arguments["content"],
            category=arguments.get("category", "project"),
            importance=arguments.get("importance", 0.5),
            ttl_days=arguments.get("ttl_days"),
            tags=arguments.get("tags", []),
        )
        return ToolResult.success(item.as_dict())


class MemoryForgetTool(Tool):
    name = "memory.forget"
    description = "Permanently remove one local memory by its ID."
    required_capability = "memory.write"
    input_schema = {
        "type": "object",
        "properties": {"id": {"type": "string", "minLength": 1, "maxLength": 64}},
        "required": ["id"],
        "additionalProperties": False,
    }

    def __init__(self, settings: MemorySettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.MEDIUM

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        return f"Permanently delete local memory {arguments.get('id')}"

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if context.dry_run:
            return ToolResult.success({"dry_run": True, "deleted": False, "id": arguments["id"]})
        store = MemoryStore(context.workspace, retention_days=self.settings.retention_days)
        return ToolResult.success({"deleted": store.forget(arguments["id"]), "id": arguments["id"]})


def built_in_intelligence_tools(index_settings: IndexSettings, memory_settings: MemorySettings) -> list[Tool]:
    return [
        ProjectIndexTool(index_settings),
        ProjectSearchTool(index_settings),
        ProjectSymbolsTool(index_settings),
        MemorySearchTool(memory_settings),
        MemoryRememberTool(memory_settings),
        MemoryForgetTool(memory_settings),
    ]
