"""Composition root shared by the CLI and the local API server."""

from __future__ import annotations
from typing import Callable

from .agent import Agent
from .config import AppConfig, ModelProfile
from .policy import ApprovalCallback
from .providers.base import ModelProvider
from .providers.openai_compatible import OpenAICompatibleProvider
from .tools import build_default_registry
from .workspace import Workspace


def provider_factory(config: AppConfig) -> Callable[[ModelProfile], ModelProvider]:
    def create(profile: ModelProfile) -> ModelProvider:
        settings = config.providers.get(profile.provider)
        if settings is None:
            from .errors import ConfigError
            raise ConfigError(f"Provider '{profile.provider}' is not configured.")
        if settings.kind == "openai_compatible":
            return OpenAICompatibleProvider(settings, profile)
        if settings.kind == "anthropic":
            from .providers.anthropic import AnthropicProvider
            return AnthropicProvider(settings, profile)
        from .errors import ConfigError
        raise ConfigError(
            f"Provider kind '{settings.kind}' is not implemented. "
            "Supported kinds: 'openai_compatible', 'anthropic'."
        )
    return create


def create_agent(
    config: AppConfig,
    workspace: Workspace,
    *,
    approval: ApprovalCallback | None = None,
    dry_run: bool = False,
    cancel_event=None,
    event_sinks=None,
) -> Agent:
    return Agent(
        config=config,
        workspace=workspace,
        tools=build_default_registry(
            config.index, config.memory, config.network,
            include_index=config.index.enabled,
            include_memory=config.memory.enabled,
            include_network=config.network.enabled,
        ),
        provider_factory=provider_factory(config),
        approval=approval,
        dry_run=dry_run,
        cancel_event=cancel_event,
        event_sinks=event_sinks,
    )
