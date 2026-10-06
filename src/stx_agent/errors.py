"""Shared, user-presentable STX Agent exceptions."""


class STXError(Exception):
    """Base class for expected, user-presentable failures."""


class ConfigError(STXError):
    """Raised when local configuration is invalid or incomplete."""


class ProviderError(STXError):
    """Raised when a model provider cannot produce a valid response."""


class WorkspaceError(STXError):
    """Raised for workspace access or filesystem boundary violations."""
