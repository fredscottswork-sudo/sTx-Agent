"""Native Anthropic Messages API adapter using only the Python standard library.

The agent/provider boundary remains normalized to STX's internal tool-call shape;
this module owns only the wire-format translation and HTTP request.
"""

from __future__ import annotations

import ipaddress
import json
import os
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request

from ..config import ModelProfile, ProviderSettings
from ..errors import ProviderError
from .base import ProviderResponse, ToolCall
from .transport import urlopen

_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
_MAX_OUTPUT_TOKENS = 4096
_ANTHROPIC_VERSION = "2023-06-01"


def _validate_endpoint(settings: ProviderSettings):
    try:
        parsed = urlsplit(settings.base_url)
        valid = (
            parsed.scheme in {"https", "http"}
            and bool(parsed.hostname)
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
        )
        _ = parsed.port
    except ValueError:
        valid = False
        parsed = None
    if not valid or parsed is None:
        raise ProviderError(
            f"Provider '{settings.name}' base_url must be an http(s) URL without embedded credentials, query, or fragment."
        )
    if parsed.scheme == "http":
        host = (parsed.hostname or "").lower()
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = host == "localhost" or host.endswith(".localhost")
        if not loopback and not settings.allow_insecure_http:
            raise ProviderError(
                f"Provider '{settings.name}' uses non-loopback HTTP; use HTTPS or explicitly set allow_insecure_http = true."
            )
    return parsed


def _as_content_blocks(content: Any, *, role: str) -> list[dict[str, Any]]:
    if content is None:
        return []
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    if isinstance(content, list):
        blocks: list[dict[str, Any]] = []
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text" or not isinstance(part.get("text"), str):
                raise ProviderError(f"Non-text {role} content blocks are not supported by this adapter.")
            blocks.append({"type": "text", "text": part["text"]})
        return blocks
    raise ProviderError(f"Cannot translate non-text {role} content to the Anthropic Messages API.")


def _merge_message(messages: list[dict[str, Any]], role: str, blocks: list[dict[str, Any]]) -> None:
    if not blocks:
        return
    if messages and messages[-1]["role"] == role:
        messages[-1]["content"].extend(blocks)
    else:
        messages.append({"role": role, "content": blocks})


def translate_messages(messages: Sequence[Mapping[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """Map STX's normalized message history to Anthropic's role/content format."""
    system_parts: list[str] = []
    translated: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role == "system":
            if content is not None and not isinstance(content, str):
                raise ProviderError("System content must be text for the Anthropic Messages API.")
            if content:
                system_parts.append(content)
            continue
        if role == "user":
            _merge_message(translated, "user", _as_content_blocks(content, role="user"))
            continue
        if role == "assistant":
            blocks = _as_content_blocks(content, role="assistant")
            raw_calls = message.get("tool_calls") or []
            if not isinstance(raw_calls, list):
                raise ProviderError("Assistant tool_calls must be an array.")
            for raw_call in raw_calls:
                if not isinstance(raw_call, Mapping) or not isinstance(raw_call.get("function"), Mapping):
                    raise ProviderError("Assistant tool call is malformed.")
                function = raw_call["function"]
                call_id = raw_call.get("id")
                name = function.get("name")
                raw_arguments = function.get("arguments", "{}")
                if isinstance(raw_arguments, str):
                    try:
                        arguments = json.loads(raw_arguments)
                    except json.JSONDecodeError as exc:
                        raise ProviderError(f"Tool arguments for '{name}' are not valid JSON.") from exc
                else:
                    arguments = raw_arguments
                if not isinstance(call_id, str) or not call_id or not isinstance(name, str) or not name:
                    raise ProviderError("Assistant tool call is missing an id or name.")
                if not isinstance(arguments, dict):
                    raise ProviderError(f"Tool arguments for '{name}' must be a JSON object.")
                blocks.append({"type": "tool_use", "id": call_id, "name": name, "input": arguments})
            _merge_message(translated, "assistant", blocks)
            continue
        if role == "tool":
            call_id = message.get("tool_call_id")
            if not isinstance(call_id, str) or not call_id:
                raise ProviderError("Tool result is missing its tool_call_id.")
            if not isinstance(content, str):
                raise ProviderError("Tool result content must be text.")
            _merge_message(translated, "user", [{
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": content,
            }])
            continue
        raise ProviderError(f"Unsupported message role for Anthropic Messages API: {role!r}.")

    return "\n\n".join(system_parts), translated


def translate_tools(tools: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI-shaped STX tool schemas to Anthropic input schemas."""
    translated: list[dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, Mapping) or not isinstance(tool.get("function"), Mapping):
            raise ProviderError("STX tool schema is not an OpenAI-compatible function declaration.")
        function = tool["function"]
        name = function.get("name")
        description = function.get("description", "")
        schema = function.get("parameters", {"type": "object", "properties": {}})
        if not isinstance(name, str) or not name or not isinstance(description, str):
            raise ProviderError("STX tool schema is missing a valid name or description.")
        if not isinstance(schema, Mapping):
            raise ProviderError(f"Input schema for '{name}' must be an object.")
        translated.append({"name": name, "description": description, "input_schema": dict(schema)})
    return translated


def parse_anthropic_message(payload: Mapping[str, Any]) -> ProviderResponse:
    """Validate and normalize a Messages API response."""
    raw_content = payload.get("content")
    if not isinstance(raw_content, list):
        raise ProviderError("Anthropic response content must be an array.")
    text_parts: list[str] = []
    calls: list[ToolCall] = []
    for block in raw_content:
        if not isinstance(block, Mapping):
            raise ProviderError("Anthropic response contains a malformed content block.")
        kind = block.get("type")
        if kind == "text":
            text = block.get("text")
            if isinstance(text, str):
                text_parts.append(text)
        elif kind == "tool_use":
            call_id, name, arguments = block.get("id"), block.get("name"), block.get("input", {})
            if not isinstance(call_id, str) or not call_id or not isinstance(name, str) or not name:
                raise ProviderError("Anthropic tool_use block is missing an id or name.")
            if not isinstance(arguments, Mapping):
                raise ProviderError(f"Arguments for Anthropic tool '{name}' must be an object.")
            calls.append(ToolCall(call_id, name, dict(arguments)))

    content = "\n".join(text_parts) if text_parts else None
    assistant_message: dict[str, Any] = {"role": "assistant", "content": content}
    if calls:
        assistant_message["tool_calls"] = [
            {
                "id": call.call_id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False, separators=(",", ":")),
                },
            }
            for call in calls
        ]
    usage = payload.get("usage") or {}
    if not isinstance(usage, Mapping):
        usage = {}
    model = payload.get("model")
    if not isinstance(model, str):
        model = None
    finish_reason = payload.get("stop_reason")
    if not isinstance(finish_reason, str):
        finish_reason = None
    return ProviderResponse(content, calls, assistant_message, model, finish_reason, dict(usage))


class AnthropicProvider:
    """Adapter for Anthropic's native Messages API."""

    def __init__(self, settings: ProviderSettings, profile: ModelProfile) -> None:
        self.settings = settings
        self.profile = profile
        self._api_key = os.environ.get(settings.api_key_env) if settings.api_key_env else None
        if settings.require_api_key and not self._api_key:
            env_name = settings.api_key_env or "(not configured)"
            raise ProviderError(f"Provider '{settings.name}' requires environment variable {env_name}.")
        _validate_endpoint(settings)
        if profile.temperature > 1:
            raise ProviderError("Anthropic temperature must be from 0 to 1.")

    def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
    ) -> ProviderResponse:
        system, translated_messages = translate_messages(messages)
        body: dict[str, Any] = {
            "model": self.profile.model,
            "max_tokens": _MAX_OUTPUT_TOKENS,
            "messages": translated_messages,
            "temperature": self.profile.temperature,
        }
        if system:
            body["system"] = system
        if tools:
            body["tools"] = translate_tools(tools)
            body["tool_choice"] = {"type": "auto"}
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "anthropic-version": _ANTHROPIC_VERSION,
        }
        if self._api_key:
            headers["x-api-key"] = self._api_key
        request = Request(
            f"{self.settings.base_url.rstrip('/')}/messages",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.settings.timeout_seconds) as response:
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise ProviderError("Anthropic response exceeded the 10 MiB safety limit.")
        except HTTPError as exc:
            # Avoid echoing provider error bodies: they may reflect request content.
            code = exc.code
            exc.close()
            raise ProviderError(f"Anthropic endpoint returned HTTP {code}.") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise ProviderError(f"Could not reach Anthropic endpoint: {type(exc).__name__}.") from exc

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProviderError("Anthropic endpoint returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise ProviderError("Anthropic endpoint returned a non-object JSON response.")
        if "error" in payload:
            error = payload["error"]
            error_type = error.get("type") if isinstance(error, dict) else None
            suffix = f" ({error_type})" if isinstance(error_type, str) else ""
            raise ProviderError(f"Anthropic endpoint reported an API error{suffix}.")
        try:
            return parse_anthropic_message(payload)
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError(f"Anthropic endpoint returned an invalid Messages response: {exc}") from exc
