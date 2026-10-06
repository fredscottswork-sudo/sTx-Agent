"""Permission decisions for agent tools.

Policy is deliberately independent from the CLI. The caller supplies an approval
callback so the same policy can be used by a future API or control center.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, IntEnum
from typing import Callable


class PermissionMode(str, Enum):
    ALLOW = "allow"
    CONFIRM = "confirm"
    DENY = "deny"


class RiskLevel(IntEnum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3


@dataclass(frozen=True)
class ApprovalRequest:
    capability: str
    tool_name: str
    risk: RiskLevel
    details: str


@dataclass(frozen=True)
class Authorization:
    allowed: bool
    reason: str
    confirmation_required: bool = False


ApprovalCallback = Callable[[ApprovalRequest], bool]


class Policy:
    """Evaluate configured permissions and autonomy-mode safeguards."""

    def __init__(self, permissions: dict[str, PermissionMode] | None = None) -> None:
        self.permissions = dict(permissions or {})

    def mode_for(self, capability: str) -> PermissionMode:
        # Unlisted capabilities are denied: new tools do not silently gain access.
        return self.permissions.get(capability, PermissionMode.DENY)

    def authorize(
        self,
        *,
        capability: str,
        tool_name: str,
        risk: RiskLevel,
        autonomy: str,
        details: str,
        approval: ApprovalCallback | None,
        dry_run: bool = False,
    ) -> Authorization:
        mode = self.mode_for(capability)
        if mode is PermissionMode.DENY:
            return Authorization(False, f"Permission '{capability}' is denied by policy.")

        requires_confirmation = mode is PermissionMode.CONFIRM
        if autonomy == "manual" and risk >= RiskLevel.MEDIUM:
            requires_confirmation = True
        elif autonomy == "assisted" and risk is RiskLevel.HIGH:
            requires_confirmation = True

        # Only tools that explicitly implement a side-effect-free preview may
        # bypass confirmation in dry-run mode. Reads can still disclose data.
        if dry_run and capability in {"filesystem.write", "terminal.execute", "git.modify", "memory.write", "network.fetch"}:
            return Authorization(True, "Dry run: the tool will return a proposal without performing the action.")

        if requires_confirmation:
            if approval is None:
                return Authorization(
                    False,
                    f"'{capability}' requires confirmation, but no approval interface is available.",
                    confirmation_required=True,
                )
            request = ApprovalRequest(capability, tool_name, risk, details)
            if not approval(request):
                return Authorization(False, "Action was not approved.", confirmation_required=True)
            return Authorization(True, "Action approved by the user.", confirmation_required=True)

        return Authorization(True, "Allowed by policy.")
