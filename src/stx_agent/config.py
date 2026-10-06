"""Dependency-free TOML configuration for the STX Agent core."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite
import os
from pathlib import Path
import tomllib
from typing import Any
from urllib.parse import urlsplit

from .errors import ConfigError
from .policy import PermissionMode


@dataclass(frozen=True)
class ProviderSettings:
    name: str
    kind: str
    base_url: str
    api_key_env: str | None = None
    timeout_seconds: float = 60.0
    require_api_key: bool = False
    allow_insecure_http: bool = False


@dataclass(frozen=True)
class ModelProfile:
    name: str
    provider: str
    model: str
    temperature: float = 0.2


@dataclass(frozen=True)
class LoggingSettings:
    enabled: bool = False
    directory: str = ".stx/runs"


@dataclass(frozen=True)
class IndexSettings:
    enabled: bool = True
    max_files: int = 10_000
    max_file_bytes: int = 512_000
    context_files: int = 6
    context_chars: int = 18_000


@dataclass(frozen=True)
class MemorySettings:
    enabled: bool = True
    retention_days: int = 180


@dataclass(frozen=True)
class NetworkSettings:
    enabled: bool = False
    allowed_hosts: tuple[str, ...] = ()
    timeout_seconds: int = 15
    max_response_bytes: int = 300_000


@dataclass(frozen=True)
class TaskSettings:
    retention_days: int = 90
    max_records: int = 2_000


@dataclass(frozen=True)
class AppConfig:
    autonomy: str = "assisted"
    default_profile: str = "default"
    max_tool_steps: int = 12
    providers: dict[str, ProviderSettings] = field(default_factory=dict)
    profiles: dict[str, ModelProfile] = field(default_factory=dict)
    permissions: dict[str, PermissionMode] = field(default_factory=dict)
    logging: LoggingSettings = field(default_factory=LoggingSettings)
    index: IndexSettings = field(default_factory=IndexSettings)
    memory: MemorySettings = field(default_factory=MemorySettings)
    network: NetworkSettings = field(default_factory=NetworkSettings)
    tasks: TaskSettings = field(default_factory=TaskSettings)
    config_path: Path | None = None


DEFAULT_CONFIG_TEXT = '''# STX Agent local configuration. Keep API keys in environment variables.
[agent]
autonomy = "assisted" # manual | assisted | autonomous
default_profile = "default"
max_tool_steps = 12

[providers.openai]
kind = "openai_compatible"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
timeout_seconds = 60
require_api_key = true
allow_insecure_http = false # Set true only for a trusted non-loopback endpoint.

# Optional native Anthropic Messages API provider.
# [providers.anthropic]
# kind = "anthropic"
# base_url = "https://api.anthropic.com/v1"
# api_key_env = "ANTHROPIC_API_KEY"
# timeout_seconds = 60
# require_api_key = true

[models.default]
provider = "openai"
model = "gpt-4o-mini" # Replace with a model supported by your endpoint.
temperature = 0.2

# Optional profiles used by the transparent task router. They may use different providers/models.
# [models.fast]
# provider = "openai"
# model = "gpt-4o-mini"
# [models.coding]
# provider = "openai"
# model = "YOUR_CODING_MODEL"
# [models.reasoning]
# provider = "openai"
# model = "YOUR_REASONING_MODEL"
# [models.anthropic]
# provider = "anthropic"
# model = "YOUR_ANTHROPIC_MODEL"
# temperature = 0.2 # Anthropic API accepts 0–1.

[permissions]
"filesystem.read" = "allow"
"filesystem.read_sensitive" = "deny"
"filesystem.write" = "confirm"
"terminal.execute" = "confirm"
"git.read" = "allow"
"git.modify" = "confirm"
"network.fetch" = "confirm"
"tasks.history.delete" = "confirm"

[logging]
enabled = false # When enabled, only event metadata is recorded by the core.
directory = ".stx/runs"

[index]
enabled = true
max_files = 10000
max_file_bytes = 512000
context_files = 6
context_chars = 18000

[memory]
enabled = true
retention_days = 180

[network]
enabled = false
allowed_hosts = [] # Exact names or subdomain patterns such as "*.docs.example.com".
timeout_seconds = 15
max_response_bytes = 300000

[tasks]
retention_days = 90
max_records = 2000
'''

_DEFAULT_PERMISSIONS = {
    "filesystem.read": PermissionMode.ALLOW,
    "filesystem.read_sensitive": PermissionMode.DENY,
    "filesystem.write": PermissionMode.CONFIRM,
    "terminal.execute": PermissionMode.CONFIRM,
    "git.read": PermissionMode.ALLOW,
    "git.modify": PermissionMode.CONFIRM,
    "memory.read": PermissionMode.ALLOW,
    "memory.write": PermissionMode.CONFIRM,
    "network.fetch": PermissionMode.CONFIRM,
    "tasks.history.delete": PermissionMode.CONFIRM,
}


def _as_table(value: Any, name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"Configuration section [{name}] must be a table.")
    return value


def _as_int(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ConfigError(f"'{name}' must be an integer from {minimum} to {maximum}.")
    return value


def _as_number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError(f"'{name}' must be a number from {minimum} to {maximum}.")
    try:
        finite = isfinite(float(value))
    except (OverflowError, ValueError):
        finite = False
    if not finite or not minimum <= value <= maximum:
        raise ConfigError(f"'{name}' must be a number from {minimum} to {maximum}.")
    return float(value)


def load_config(path: Path | None) -> AppConfig:
    """Load a TOML file, or return safe defaults when it does not exist."""
    if path is None or not path.exists():
        return AppConfig(config_path=path)
    try:
        with path.open("rb") as handle:
            raw = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"Could not read configuration '{path}': {exc}") from exc

    agent = _as_table(raw.get("agent"), "agent")
    autonomy = agent.get("autonomy", "assisted")
    if not isinstance(autonomy, str) or autonomy not in {"manual", "assisted", "autonomous"}:
        raise ConfigError("[agent].autonomy must be 'manual', 'assisted', or 'autonomous'.")
    default_profile = agent.get("default_profile", "default")
    if not isinstance(default_profile, str) or not default_profile:
        raise ConfigError("[agent].default_profile must be a non-empty string.")
    max_tool_steps = _as_int(agent.get("max_tool_steps", 12), "agent.max_tool_steps", 1, 100)

    provider_tables = _as_table(raw.get("providers"), "providers")
    providers: dict[str, ProviderSettings] = {}
    for name, item in provider_tables.items():
        table = _as_table(item, f"providers.{name}")
        kind = table.get("kind", "openai_compatible")
        base_url = table.get("base_url", "")
        api_key_env = table.get("api_key_env")
        if not isinstance(kind, str) or not kind:
            raise ConfigError(f"Provider '{name}' requires a non-empty kind.")
        if not isinstance(base_url, str) or not base_url:
            raise ConfigError(f"Provider '{name}' requires a non-empty base_url.")
        try:
            parsed_url = urlsplit(base_url)
            valid_url = parsed_url.scheme in {"http", "https"} and bool(parsed_url.hostname)
            # Credentials and query strings do not belong in URLs that doctor/logs display.
            valid_url = valid_url and parsed_url.username is None and parsed_url.password is None
            valid_url = valid_url and not parsed_url.query and not parsed_url.fragment
            _ = parsed_url.port
        except ValueError:
            valid_url = False
        if not valid_url:
            raise ConfigError(
                f"Provider '{name}' base_url must be an http(s) URL without embedded credentials, query, or fragment."
            )
        if api_key_env is not None and (not isinstance(api_key_env, str) or not api_key_env):
            raise ConfigError(f"Provider '{name}' api_key_env must be a non-empty string or omitted.")
        timeout = _as_number(table.get("timeout_seconds", 60), f"providers.{name}.timeout_seconds", 1, 600)
        require_key = table.get("require_api_key", False)
        if not isinstance(require_key, bool):
            raise ConfigError(f"Provider '{name}' require_api_key must be a boolean.")
        allow_insecure_http = table.get("allow_insecure_http", False)
        if not isinstance(allow_insecure_http, bool):
            raise ConfigError(f"Provider '{name}' allow_insecure_http must be a boolean.")
        providers[name] = ProviderSettings(
            name=name,
            kind=kind,
            base_url=base_url.rstrip("/"),
            api_key_env=api_key_env,
            timeout_seconds=timeout,
            require_api_key=require_key,
            allow_insecure_http=allow_insecure_http,
        )

    profile_tables = _as_table(raw.get("models"), "models")
    profiles: dict[str, ModelProfile] = {}
    for name, item in profile_tables.items():
        table = _as_table(item, f"models.{name}")
        provider_name = table.get("provider")
        model_name = table.get("model")
        if not isinstance(provider_name, str) or provider_name not in providers:
            raise ConfigError(f"Model profile '{name}' references an unknown provider '{provider_name}'.")
        if not isinstance(model_name, str) or not model_name:
            raise ConfigError(f"Model profile '{name}' requires a non-empty model name.")
        temperature = _as_number(table.get("temperature", 0.2), f"models.{name}.temperature", 0, 2)
        if providers[provider_name].kind == "anthropic" and temperature > 1:
            raise ConfigError(f"Model profile '{name}' uses Anthropic, whose temperature must be from 0 to 1.")
        profiles[name] = ModelProfile(name, provider_name, model_name, temperature)

    permission_table = _as_table(raw.get("permissions"), "permissions")
    permissions = dict(_DEFAULT_PERMISSIONS)
    for capability, value in permission_table.items():
        try:
            permissions[capability] = PermissionMode(value)
        except (ValueError, TypeError) as exc:
            raise ConfigError(
                f"Permission '{capability}' must be one of: allow, confirm, deny."
            ) from exc

    logging_table = _as_table(raw.get("logging"), "logging")
    logging_enabled = logging_table.get("enabled", False)
    logging_directory = logging_table.get("directory", ".stx/runs")
    if not isinstance(logging_enabled, bool):
        raise ConfigError("[logging].enabled must be a boolean.")
    if not isinstance(logging_directory, str) or not logging_directory:
        raise ConfigError("[logging].directory must be a non-empty path string.")

    index_table = _as_table(raw.get("index"), "index")
    index_enabled = index_table.get("enabled", True)
    if not isinstance(index_enabled, bool):
        raise ConfigError("[index].enabled must be a boolean.")
    index_settings = IndexSettings(
        enabled=index_enabled,
        max_files=_as_int(index_table.get("max_files", 10_000), "index.max_files", 1, 50_000),
        max_file_bytes=_as_int(index_table.get("max_file_bytes", 512_000), "index.max_file_bytes", 1_024, 2_000_000),
        context_files=_as_int(index_table.get("context_files", 6), "index.context_files", 0, 20),
        context_chars=_as_int(index_table.get("context_chars", 18_000), "index.context_chars", 0, 60_000),
    )

    memory_table = _as_table(raw.get("memory"), "memory")
    memory_enabled = memory_table.get("enabled", True)
    if not isinstance(memory_enabled, bool):
        raise ConfigError("[memory].enabled must be a boolean.")
    memory_settings = MemorySettings(
        enabled=memory_enabled,
        retention_days=_as_int(memory_table.get("retention_days", 180), "memory.retention_days", 1, 3650),
    )

    network_table = _as_table(raw.get("network"), "network")
    network_enabled = network_table.get("enabled", False)
    if not isinstance(network_enabled, bool):
        raise ConfigError("[network].enabled must be a boolean.")
    raw_hosts = network_table.get("allowed_hosts", [])
    if not isinstance(raw_hosts, list) or len(raw_hosts) > 100:
        raise ConfigError("[network].allowed_hosts must be an array of up to 100 hostnames.")
    allowed_hosts: list[str] = []
    for raw_host in raw_hosts:
        if not isinstance(raw_host, str) or not raw_host or len(raw_host) > 255 or any(ch.isspace() for ch in raw_host):
            raise ConfigError("[network].allowed_hosts entries must be valid hostnames.")
        wildcard = raw_host.startswith("*.")
        hostname = raw_host[2:] if wildcard else raw_host
        if "*" in hostname or not hostname or hostname.startswith(".") or hostname.endswith("."):
            raise ConfigError(f"Invalid network hostname pattern: {raw_host}")
        try:
            ascii_host = hostname.encode("idna").decode("ascii").lower()
            parsed_host = urlsplit("https://" + ascii_host)
            if parsed_host.hostname != ascii_host or parsed_host.port is not None or parsed_host.path or parsed_host.query:
                raise ValueError
        except (UnicodeError, ValueError) as exc:
            raise ConfigError(f"Invalid network hostname pattern: {raw_host}") from exc
        normalized = ("*." if wildcard else "") + ascii_host
        if normalized not in allowed_hosts:
            allowed_hosts.append(normalized)
    network_settings = NetworkSettings(
        enabled=network_enabled,
        allowed_hosts=tuple(allowed_hosts),
        timeout_seconds=_as_int(network_table.get("timeout_seconds", 15), "network.timeout_seconds", 1, 60),
        max_response_bytes=_as_int(network_table.get("max_response_bytes", 300_000), "network.max_response_bytes", 1_024, 2_000_000),
    )
    task_table = _as_table(raw.get("tasks"), "tasks")
    task_settings = TaskSettings(
        retention_days=_as_int(task_table.get("retention_days", 90), "tasks.retention_days", 1, 3650),
        max_records=_as_int(task_table.get("max_records", 2_000), "tasks.max_records", 10, 100_000),
    )

    return AppConfig(
        autonomy=autonomy,
        default_profile=default_profile,
        max_tool_steps=max_tool_steps,
        providers=providers,
        profiles=profiles,
        permissions=permissions,
        logging=LoggingSettings(logging_enabled, logging_directory),
        index=index_settings,
        memory=memory_settings,
        network=network_settings,
        tasks=task_settings,
        config_path=path,
    )


def write_default_config(path: Path, *, overwrite: bool = False) -> None:
    """Create a starter config without overwriting local owner settings.

    On POSIX, create the file with owner-only permissions at the filesystem call,
    rather than relying on a later chmod. Windows access control remains ACL-based.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT
    flags |= os.O_TRUNC if overwrite else os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor: int | None = None
    try:
        descriptor = os.open(path, flags, 0o600)
        if os.name == "posix" and hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = None
            handle.write(DEFAULT_CONFIG_TEXT)
    except FileExistsError as exc:
        raise ConfigError(f"Configuration already exists: {path} (it was not changed).") from exc
    except OSError as exc:
        raise ConfigError(f"Could not write configuration '{path}': {exc}") from exc
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
