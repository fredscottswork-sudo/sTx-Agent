"""Schema validation, policy enforcement, and dispatch for tools."""

from __future__ import annotations

import json
from math import isfinite
from typing import Any, Mapping

from ..policy import RiskLevel
from .base import Tool, ToolContext, ToolResult


class ToolInputError(ValueError):
    pass


def _is_json_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return isfinite(float(value))
    except (OverflowError, ValueError):
        return False


def _validate_type(value: Any, expected: str, path: str) -> None:
    checks = {
        "object": lambda item: isinstance(item, dict),
        "array": lambda item: isinstance(item, list),
        "string": lambda item: isinstance(item, str),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "number": _is_json_number,
        "boolean": lambda item: isinstance(item, bool),
        "null": lambda item: item is None,
    }
    if expected not in checks:
        raise ToolInputError(f"Unsupported schema type '{expected}' at {path}.")
    if not checks[expected](value):
        raise ToolInputError(f"Expected {expected} at {path}.")


def validate_schema(value: Any, schema: Mapping[str, Any], path: str = "arguments") -> None:
    """Validate the JSON Schema subset used by STX tools (no third-party package)."""
    expected_type = schema.get("type")
    if isinstance(expected_type, str):
        _validate_type(value, expected_type, path)
    if "enum" in schema and value not in schema["enum"]:
        raise ToolInputError(f"Value at {path} must be one of {schema['enum']!r}.")

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                raise ToolInputError(f"Missing required argument '{path}.{key}'.")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extras = set(value) - set(properties)
            if extras:
                raise ToolInputError(f"Unexpected argument(s) at {path}: {', '.join(sorted(extras))}.")
        for key, child in value.items():
            if key in properties:
                validate_schema(child, properties[key], f"{path}.{key}")
        if "minProperties" in schema and len(value) < schema["minProperties"]:
            raise ToolInputError(f"Too few properties at {path}.")
        if "maxProperties" in schema and len(value) > schema["maxProperties"]:
            raise ToolInputError(f"Too many properties at {path}.")
    elif isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            raise ToolInputError(f"Too few items at {path}.")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise ToolInputError(f"Too many items at {path}.")
        item_schema = schema.get("items")
        if item_schema:
            for index, item in enumerate(value):
                validate_schema(item, item_schema, f"{path}[{index}]")
    elif isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            raise ToolInputError(f"Value at {path} is too short.")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            raise ToolInputError(f"Value at {path} is too long.")
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise ToolInputError(f"Value at {path} is below its minimum.")
        if "maximum" in schema and value > schema["maximum"]:
            raise ToolInputError(f"Value at {path} exceeds its maximum.")


class ToolRegistry:
    def __init__(self, tools: list[Tool] | None = None) -> None:
        self._tools: dict[str, Tool] = {}
        for tool in tools or []:
            self.register(tool)

    def register(self, tool: Tool) -> None:
        if not tool.name or tool.name in self._tools:
            raise ValueError(f"Tool name is empty or already registered: {tool.name!r}")
        self._tools[tool.name] = tool

    def names(self) -> list[str]:
        return sorted(self._tools)

    def model_schemas(self, context: ToolContext | None = None) -> list[dict[str, Any]]:
        schemas = []
        for name in sorted(self._tools):
            tool = self._tools[name]
            capability = tool.required_capability
            if context is not None and context.policy.mode_for(capability).value == "deny":
                # Dynamic sensitive-file access is still checked after a call; the
                # ordinary read tool remains available for non-sensitive paths.
                if not name.startswith("workspace.read_file"):
                    continue
            schemas.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            })
        return schemas

    def execute(self, name: str, arguments: Any, context: ToolContext) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult.failure(f"Unknown tool '{name}'.")
        if not isinstance(arguments, dict):
            return ToolResult.failure("Tool arguments must be a JSON object.")
        try:
            validate_schema(arguments, tool.input_schema)
        except ToolInputError as exc:
            return ToolResult.failure(f"Invalid input: {exc}")

        try:
            capability = tool.capability(arguments, context)
            risk = tool.risk(arguments, context)
            authorization = context.policy.authorize(
                capability=capability,
                tool_name=tool.name,
                risk=risk,
                autonomy=context.autonomy,
                details=tool.approval_details(arguments, context),
                approval=context.approval,
                dry_run=context.dry_run,
            )
            if not authorization.allowed:
                return ToolResult.failure(authorization.reason)
            return tool.execute(arguments, context)
        except Exception as exc:
            # Tool failures become observations for the model; do not return tracebacks
            # or silently retry an operation with side effects.
            return ToolResult.failure(f"{type(exc).__name__}: {exc}")

    def serialize_result(self, result: ToolResult) -> str:
        payload = result.as_dict()

        def encode(value: Any) -> str:
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

        try:
            serialized = encode(payload)
        except (TypeError, ValueError):
            return encode({"ok": False, "error": "Tool returned non-JSON data."})
        if len(serialized) <= 64_000:
            return serialized

        def shrink(value: Any, string_limit: int, collection_limit: int) -> Any:
            if isinstance(value, str):
                return value if len(value) <= string_limit else value[:string_limit] + "\n[tool output truncated]"
            if isinstance(value, dict):
                entries = list(value.items())
                limited = {
                    key: shrink(item, string_limit, collection_limit)
                    for key, item in entries[:collection_limit]
                }
                if len(entries) > collection_limit:
                    limited["_stx_omitted_fields"] = len(entries) - collection_limit
                return limited
            if isinstance(value, list):
                items = [shrink(item, string_limit, collection_limit) for item in value[:collection_limit]]
                if len(value) > collection_limit:
                    items.append(f"[{len(value) - collection_limit} additional items omitted]")
                return items
            return value

        for string_limit, collection_limit in ((12_000, 100), (6_000, 50), (2_000, 20), (500, 10), (100, 1)):
            serialized = encode(shrink(payload, string_limit, collection_limit))
            if len(serialized) <= 64_000:
                return serialized
        return encode({"ok": False, "error": "Tool result exceeded the response limit and was omitted."})
