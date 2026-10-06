"""Stable model-provider contract, independent of a specific vendor SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, Sequence


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ProviderResponse:
    content: str | None
    tool_calls: list[ToolCall]
    assistant_message: dict[str, Any]
    model: str | None = None
    finish_reason: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)


class ModelProvider(Protocol):
    """A provider accepts normalized messages and JSON-schema tool declarations."""

    def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
    ) -> ProviderResponse:
        """Return one assistant turn or raise a provider-specific error."""
