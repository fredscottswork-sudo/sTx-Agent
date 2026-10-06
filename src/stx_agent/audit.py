"""Read-only, deterministic security posture checks for an STX workspace.

The audit reports configuration and local file-mode observations only. It never
contacts providers, executes tools, changes settings, or claims to be an OS sandbox.
"""

from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import os
from pathlib import Path
import stat
from typing import Any, Literal
from urllib.parse import urlsplit

from .config import AppConfig
from .policy import PermissionMode
from .workspace import Workspace

Severity = Literal["critical", "warning", "info"]
_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}
_KNOWN_PROVIDER_KINDS = {"openai_compatible", "anthropic"}
_DATA_DATABASES = ("index.sqlite3", "memory.sqlite3", "tasks.sqlite3")


@dataclass(frozen=True)
class AuditFinding:
    check_id: str
    severity: Severity
    title: str
    detail: str
    remediation: str | None = None

    def as_dict(self) -> dict[str, str]:
        finding = {
            "check_id": self.check_id,
            "severity": self.severity,
            "title": self.title,
            "detail": self.detail,
        }
        if self.remediation:
            finding["remediation"] = self.remediation
        return finding


@dataclass(frozen=True)
class AuditReport:
    findings: tuple[AuditFinding, ...]

    @property
    def summary(self) -> dict[str, int]:
        return {
            severity: sum(1 for finding in self.findings if finding.severity == severity)
            for severity in ("critical", "warning", "info")
        }

    @property
    def has_critical(self) -> bool:
        return self.summary["critical"] > 0

    @property
    def has_warnings(self) -> bool:
        return self.summary["warning"] > 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "summary": self.summary,
            "findings": [finding.as_dict() for finding in self.findings],
        }


def _is_loopback_host(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.lower()
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost" or host.endswith(".localhost")


def _permission_finding(path: Path, *, label: str, check_id: str) -> AuditFinding | None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    except OSError:
        return AuditFinding(
            check_id=f"storage.permission_check_failed.{check_id}",
            severity="info",
            title=f"Could not inspect {label} permissions",
            detail="The audit could not read filesystem metadata for this path.",
        )

    if stat.S_ISLNK(info.st_mode):
        return AuditFinding(
            check_id=f"storage.symlink.{check_id}",
            severity="warning",
            title=f"{label} is a symbolic link",
            detail="The audit does not follow this link or verify the target's access controls.",
            remediation="Verify the link target is trusted, remains within the intended storage boundary, and has restrictive permissions.",
        )

    if os.name == "nt":
        return None
    mode = stat.S_IMODE(info.st_mode)
    if mode & 0o077:
        return AuditFinding(
            check_id=f"storage.permissions_broad.{check_id}",
            severity="warning",
            title=f"{label} is accessible beyond the owner",
            detail="Group or other permission bits are set; this path may contain configuration or private task data.",
            remediation="Restrict access to the intended account (typically chmod 600 for files and chmod 700 for directories on POSIX systems).",
        )
    return None


def audit_workspace(
    workspace: Workspace,
    config: AppConfig,
    *,
    config_path: Path | None = None,
) -> AuditReport:
    """Collect bounded, local-only security findings for a workspace and config."""
    findings: list[AuditFinding] = []

    def add(
        check_id: str,
        severity: Severity,
        title: str,
        detail: str,
        remediation: str | None = None,
    ) -> None:
        findings.append(AuditFinding(check_id, severity, title, detail, remediation))

    effective_config = config_path or config.config_path
    if effective_config is not None and not effective_config.exists():
        add(
            "config.not_found", "info", "Configuration file is not present",
            "STX is using safe unconfigured defaults; no model profile is available until configuration is created.",
            "Run 'stx init' and review the generated permissions before starting an agent run.",
        )
    if not config.profiles:
        add(
            "model.no_profiles", "info", "No model profiles are configured",
            "The agent cannot send a model request until at least one provider and model profile are configured.",
        )

    if config.autonomy == "autonomous":
        add(
            "agent.autonomous_mode", "warning", "Autonomous mode is configured",
            "Some actions can proceed without an interactive approval when their capability policy allows them.",
            "Use assisted or manual mode, or keep write, terminal, network, and sensitive-read capabilities at confirm/deny unless unattended execution is intentional.",
        )

    sensitive_mode = config.permissions.get("filesystem.read_sensitive", PermissionMode.DENY)
    if sensitive_mode is PermissionMode.ALLOW:
        severity: Severity = "critical" if config.autonomy == "autonomous" else "warning"
        add(
            "policy.sensitive_reads_allowed", severity, "Sensitive-file reads are not denied by capability policy",
            "A model-directed read may return credential-like files to the configured provider. Manual/assisted modes can still require confirmation for high-risk reads; autonomous mode does not add that safeguard. This is not a claim that STX can detect every secret.",
            "Set permissions.filesystem.read_sensitive = 'confirm' or 'deny' and keep credentials outside the workspace.",
        )
    elif sensitive_mode is PermissionMode.CONFIRM:
        add(
            "policy.sensitive_reads_confirmable", "info", "Sensitive-file reads can be approved",
            "If approved, the selected file content may be sent to the configured model provider.",
            "Deny sensitive reads when a task does not require them; never assume approval itself removes provider-side retention risk.",
        )

    for capability, check_id, label in (
        ("filesystem.write", "policy.file_writes_unconfirmed", "Workspace file writes"),
        ("terminal.execute", "policy.terminal_unconfirmed", "Terminal execution"),
        ("git.modify", "policy.git_modification_unconfirmed", "Git modifications"),
        ("memory.write", "policy.memory_writes_unconfirmed", "Memory writes"),
        ("tasks.history.delete", "policy.task_history_deletion_unconfirmed", "Task-history deletion"),
    ):
        if config.permissions.get(capability, PermissionMode.DENY) is PermissionMode.ALLOW:
            add(
                check_id, "warning", f"{label} are configured to allow",
                f"Capability '{capability}' does not require a policy-level approval; command risk and autonomy rules may still add checks.",
                f"Set permissions.{capability} = 'confirm' or 'deny' unless unattended use is deliberate.",
            )

    if config.network.enabled:
        if not config.network.allowed_hosts:
            add(
                "network.enabled_without_hosts", "info", "Network text fetch is enabled with no hosts",
                "The fetch tool has no configured host to contact and will reject requests.",
                "Add narrowly scoped hostnames only if network research is required, or disable [network].enabled.",
            )
        wildcard_hosts = [host for host in config.network.allowed_hosts if host.startswith("*.")]
        if wildcard_hosts:
            add(
                "network.wildcard_allowlist", "warning", "The network allowlist contains wildcard domains",
                "Wildcard entries trust every matching subdomain; the audit does not resolve or contact those hosts.",
                "Prefer exact hostnames where possible and review redirect/DNS behavior before enabling fetches.",
            )
        if config.permissions.get("network.fetch", PermissionMode.DENY) is PermissionMode.ALLOW:
            add(
                "policy.network_fetch_unconfirmed", "warning", "Allowlisted network fetch uses allow policy",
                "The capability mode itself does not request approval. Fetched public web text is untrusted input and may require additional safeguards for unattended use.",
                "Use confirm/deny for network.fetch unless unattended requests to the reviewed allowlist are intentional.",
            )

    for name, provider in sorted(config.providers.items()):
        if provider.kind not in _KNOWN_PROVIDER_KINDS:
            add(
                f"provider.unsupported_kind.{name}", "warning", "A provider kind is not implemented",
                "The selected provider profile will fail before making a model request.",
                "Use openai_compatible or anthropic, or add and test an adapter before selecting this provider.",
            )
        try:
            parsed = urlsplit(provider.base_url)
            _ = parsed.port
        except ValueError:
            continue  # load_config normally rejects malformed endpoints.
        if parsed.scheme == "http" and not _is_loopback_host(parsed.hostname):
            if provider.allow_insecure_http:
                add(
                    f"provider.cleartext_remote_http.{name}", "critical", "A remote provider uses explicitly allowed cleartext HTTP",
                    "Task and context data, and possibly the provider API key, can be observed or modified in transit.",
                    "Use HTTPS. Only permit remote HTTP on a fully trusted isolated network, and rotate any key already sent over an untrusted path.",
                )
            else:
                add(
                    f"provider.remote_http_blocked.{name}", "warning", "A remote provider URL uses HTTP",
                    "The adapter will reject this endpoint unless insecure HTTP is explicitly enabled; no network request was made by the audit.",
                    "Change the endpoint to HTTPS rather than opting into cleartext transport.",
                )

    if config.tasks.retention_days > 365:
        add(
            "data.task_retention_long", "warning", "Task history retention exceeds one year",
            "Task prompts, answers, and approval details remain in local SQLite history until pruned or removed.",
            "Choose the shortest retention period that meets your needs and protect the workspace storage.",
        )
    if config.logging.enabled:
        add(
            "observability.metadata_logging_enabled", "info", "Metadata event logging is enabled",
            "Event files record run metadata, not hidden reasoning; the local task database still stores prompts and answers separately.",
            "Review log and task retention before sharing or backing up workspace data.",
        )

    if effective_config is not None and effective_config.exists():
        finding = _permission_finding(effective_config, label="The configuration file", check_id="config")
        if finding:
            findings.append(finding)

    data_directory = workspace.root / ".stx"
    finding = _permission_finding(data_directory, label="The STX data directory", check_id="data_directory")
    if finding:
        findings.append(finding)
    for database_name in _DATA_DATABASES:
        finding = _permission_finding(
            data_directory / database_name,
            label=f"The {database_name} database",
            check_id=f"database_{database_name.removesuffix('.sqlite3')}",
        )
        if finding:
            findings.append(finding)

    if os.name == "nt" and (
        (effective_config is not None and effective_config.exists()) or data_directory.exists()
    ):
        add(
            "platform.windows_acl_review", "info", "Windows access is governed by ACLs",
            "POSIX mode bits are not a reliable confidentiality check on Windows; this audit did not inspect NTFS ACL entries.",
            "Use icacls or Windows security settings to restrict the config file and .stx directory to the intended account.",
        )

    findings.sort(key=lambda item: (_SEVERITY_ORDER[item.severity], item.check_id))
    return AuditReport(tuple(findings))
