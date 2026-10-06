"""Tool contracts shared by model-facing tools and the local executor."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from threading import Event
from typing import Any, Mapping

from ..policy import ApprovalCallback, Policy
from ..workspace import Workspace


@dataclass(frozen=True)
class ToolResult:
    ok: bool
    data: Any = None
    error: str | None = None

    @classmethod
    def success(cls, data: Any) -> "ToolResult":
        return cls(True, data=data)

    @classmethod
    def failure(cls, error: str) -> "ToolResult":
        return cls(False, error=error)

    def as_dict(self) -> dict[str, Any]:
        if self.ok:
            return {"ok": True, "data": self.data}
        return {"ok": False, "error": self.error}


@dataclass
class ToolContext:
    workspace: Workspace
    policy: Policy
    autonomy: str = "assisted"
    approval: ApprovalCallback | None = None
    dry_run: bool = False
    cancel_event: Event | None = None


class Tool(ABC):
    name: str
    description: str
    input_schema: dict[str, Any]
    required_capability: str

    def capability(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        return self.required_capability

    def risk(self, arguments: Mapping[str, Any], context: ToolContext):
        from ..policy import RiskLevel
        return RiskLevel.MEDIUM

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        return str(dict(arguments))[:1000]

    @abstractmethod
    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        """Run the operation. Implementations must honor context.dry_run."""
