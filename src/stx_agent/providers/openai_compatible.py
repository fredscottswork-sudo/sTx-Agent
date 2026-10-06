"""OpenAI Chat Completions-compatible HTTP adapter using only the stdlib."""

from __future__ import annotations

import ipaddress
import json
import os
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

from ..config import ModelProfile, ProviderSettings
from ..errors import ProviderError
from .base import ProviderResponse, ToolCall

_MAX_RESPONSE_BYTES = 10 * 1024 * 1024


def parse_chat_completion(payload: Mapping[str, Any]) -> ProviderResponse:
    """Validate and normalize the first Chat Completions choice."""
    try:
        choices = payload["choices"]
        if not isinstance(choices, list) or not choices:
            raise ValueError("response has no choices")
        choice = choices[0]
        message = choice["message"]
        if not isinstance(message, dict):
            raise ValueError("choice message is not an object")
        content = message.get("content")
        if content is not None and not isinstance(content, str):
            # Some compatible endpoints return structured content parts. Preserve
            # textual parts without leaking arbitrary provider-specific objects.
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") for part in content
                    if isinstance(part, dict) and isinstance(part.get("text", ""), str)
                )
            else:
                raise ValueError("assistant content is not text")

        calls: list[ToolCall] = []
        raw_calls = message.get("tool_calls") or []
        if not isinstance(raw_calls, list):
            raise ValueError("tool_calls is not an array")
        for raw_call in raw_calls:
            if not isinstance(raw_call, dict) or not isinstance(raw_call.get("function"), dict):
                raise ValueError("tool call is malformed")
            function = raw_call["function"]
            call_id = raw_call.get("id")
            name = function.get("name")
            raw_arguments = function.get("arguments", "{}")
            if not isinstance(call_id, str) or not call_id:
                raise ValueError("tool call has no id")
            if not isinstance(name, str) or not name:
                raise ValueError("tool call has no function name")
            if isinstance(raw_arguments, str):
                try:
                    arguments = json.loads(raw_arguments)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"arguments for tool '{name}' are not valid JSON") from exc
            else:
                arguments = raw_arguments
            if not isinstance(arguments, dict):
                raise ValueError(f"arguments for tool '{name}' must be a JSON object")
            calls.append(ToolCall(call_id, name, arguments))

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
        if not isinstance(usage, dict):
            usage = {}
        model = payload.get("model")
        if model is not None and not isinstance(model, str):
            model = None
        finish_reason = choice.get("finish_reason")
        if finish_reason is not None and not isinstance(finish_reason, str):
            finish_reason = None
        return ProviderResponse(content, calls, assistant_message, model, finish_reason, usage)
    except (KeyError, TypeError, ValueError) as exc:
        raise ProviderError(f"Model endpoint returned an invalid Chat Completions response: {exc}") from exc


class OpenAICompatibleProvider:
    """Adapter for OpenAI-compatible cloud APIs and local model endpoints."""

    def __init__(self, settings: ProviderSettings, profile: ModelProfile) -> None:
        self.settings = settings
        self.profile = profile
        self._api_key = os.environ.get(settings.api_key_env) if settings.api_key_env else None
        if settings.require_api_key and not self._api_key:
            env_name = settings.api_key_env or "(not configured)"
            raise ProviderError(f"Provider '{settings.name}' requires environment variable {env_name}.")
        try:
            parsed_url = urlsplit(settings.base_url)
            valid_url = (
                parsed_url.scheme in {"https", "http"}
                and bool(parsed_url.hostname)
                and parsed_url.username is None
                and parsed_url.password is None
                and not parsed_url.query
                and not parsed_url.fragment
            )
            _ = parsed_url.port
        except ValueError:
            valid_url = False
        if not valid_url:
            raise ProviderError(
                f"Provider '{settings.name}' base_url must be an http(s) URL without embedded credentials, query, or fragment."
            )
        if parsed_url.scheme == "http":
            host = (parsed_url.hostname or "").lower()
            try:
                loopback = ipaddress.ip_address(host).is_loopback
            except ValueError:
                loopback = host == "localhost" or host.endswith(".localhost")
            if not loopback and not settings.allow_insecure_http:
                raise ProviderError(
                    f"Provider '{settings.name}' uses non-loopback HTTP; use HTTPS or explicitly set allow_insecure_http = true."
                )

    def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
    ) -> ProviderResponse:
        body: dict[str, Any] = {
            "model": self.profile.model,
            "messages": list(messages),
            "temperature": self.profile.temperature,
        }
        if tools:
            body["tools"] = list(tools)
            body["tool_choice"] = "auto"
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = Request(
            f"{self.settings.base_url.rstrip('/')}/chat/completions",
            data=encoded,
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.settings.timeout_seconds) as response:
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise ProviderError("Model response exceeded the 10 MiB safety limit.")
        except HTTPError as exc:
            body_preview = ""
            try:
                body_preview = exc.read(2000).decode("utf-8", errors="replace")
            except OSError:
                pass
            detail = f": {body_preview}" if body_preview else ""
            raise ProviderError(f"Model endpoint returned HTTP {exc.code}{detail}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise ProviderError(f"Could not reach model endpoint: {exc}") from exc

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProviderError("Model endpoint returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise ProviderError("Model endpoint returned a non-object JSON response.")
        if "error" in payload:
            error = payload["error"]
            if isinstance(error, dict):
                message = error.get("message", "unknown provider error")
            else:
                message = str(error)
            raise ProviderError(f"Model endpoint error: {message}")
        return parse_chat_completion(payload)
