"""Small, transparent model-profile router for the first runtime."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Mapping

from .config import ModelProfile
from .errors import ConfigError


@dataclass(frozen=True)
class Route:
    profile: ModelProfile
    reason: str


_REASONING_WORDS = re.compile(
    r"\b(architect(?:ure)?|design|trade[- ]?off|diagnos(?:e|is)|debug|analy[sz]e|plan|security review|root cause|complex)\b",
    re.IGNORECASE,
)
_CODING_WORDS = re.compile(
    r"\b(implement|add|build|write|fix|refactor|change|modify|code|test|failing|bug|feature)\b",
    re.IGNORECASE,
)
_FAST_WORDS = re.compile(
    r"\b(summarize|summary|explain|classify|quick|simple|search|list)\b",
    re.IGNORECASE,
)


class ModelRouter:
    """Choose an explicitly configured profile; heuristics never invent models."""

    def __init__(self, profiles: Mapping[str, ModelProfile], default_profile: str = "default") -> None:
        self.profiles = profiles
        self.default_profile = default_profile

    def select(self, task: str, requested_profile: str | None = None) -> Route:
        if not self.profiles:
            raise ConfigError("No model profiles are configured. Run 'stx init' and edit stx.config.toml.")

        if requested_profile:
            profile = self.profiles.get(requested_profile)
            if profile is None:
                available = ", ".join(sorted(self.profiles))
                raise ConfigError(f"Unknown model profile '{requested_profile}'. Available profiles: {available}")
            return Route(profile, "explicit profile selection")

        selected_name: str | None = None
        reason = "configured default profile"
        if _REASONING_WORDS.search(task) and "reasoning" in self.profiles:
            selected_name, reason = "reasoning", "task contains architecture, diagnosis, or analysis cues"
        elif _CODING_WORDS.search(task) and "coding" in self.profiles:
            selected_name, reason = "coding", "task contains implementation or debugging cues"
        elif _FAST_WORDS.search(task) and "fast" in self.profiles:
            selected_name, reason = "fast", "task appears to be a lightweight information task"

        selected_name = selected_name or self.default_profile
        profile = self.profiles.get(selected_name)
        if profile is None:
            # A single-profile configuration is convenient and safe as a fallback.
            if len(self.profiles) == 1:
                profile = next(iter(self.profiles.values()))
                reason = f"only configured profile available ({profile.name})"
            else:
                raise ConfigError(
                    f"Default model profile '{self.default_profile}' is not configured."
                )
        return Route(profile, reason)
