"""Local-only HTTP API and static control dashboard."""

from __future__ import annotations

import ipaddress
import json
import os
import secrets
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .audit import audit_workspace
from .config import AppConfig
from .errors import ConfigError, WorkspaceError
from .indexing import ProjectIndex
from .memory import MEMORY_CATEGORIES, MemoryStore
from .policy import PermissionMode, Policy
from .tasks import TaskManager
from .tools import build_default_registry
from .workspace import Workspace


_DASHBOARD = Path(__file__).with_name("dashboard")
_MAX_BODY_BYTES = 64_000


def _is_loopback(value: str) -> bool:
    if value.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(value.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


class STXHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class STXRequestHandler(BaseHTTPRequestHandler):
    server_version = "STX-Agent"
    sys_version = ""

    @property
    def stx_server(self) -> "STXAPIServer":
        return self.server.stx_server  # type: ignore[attr-defined,no-any-return]

    def log_message(self, format: str, *args: Any) -> None:
        # Avoid recording task prompts, request paths, and authorization headers.
        print(f"stx-server: {self.client_address[0]} {self.command or '-'} request")

    def _set_headers(self, *, content_type: str, content_length: int, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        )
        self.end_headers()

    def _json(self, data: Any, *, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._set_headers(content_type="application/json; charset=utf-8", content_length=len(payload), status=status)
        self.wfile.write(payload)

    def _static(self, filename: str) -> None:
        allowed = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "app.css": "text/css; charset=utf-8"}
        if filename not in allowed:
            self._json({"error": "not_found"}, status=404)
            return
        try:
            payload = (_DASHBOARD / filename).read_bytes()
        except OSError:
            self._json({"error": "dashboard_unavailable"}, status=404)
            return
        self._set_headers(content_type=allowed[filename], content_length=len(payload))
        self.wfile.write(payload)

    def _authorized(self) -> bool:
        expected = self.stx_server.api_token
        if expected is None:
            return True
        supplied = self.headers.get("Authorization", "")
        scheme, _, value = supplied.partition(" ")
        return (
            scheme.lower() == "bearer" and bool(value)
            and secrets.compare_digest(value.encode("utf-8"), expected.encode("utf-8"))
        )

    def _host_allowed(self) -> bool:
        raw = self.headers.get("Host", "")
        if not raw or "\r" in raw or "\n" in raw:
            return False
        try:
            host = urlsplit("//" + raw).hostname or ""
        except ValueError:
            return False
        bind_host = self.stx_server.host
        if _is_loopback(bind_host):
            return host.lower() in {"localhost", "127.0.0.1", "::1", bind_host.lower()}
        # Remote binds require a token. Accept the configured interface or DNS
        # names only with that authentication boundary in place.
        return self.stx_server.api_token is not None

    def _body(self) -> dict[str, Any]:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ValueError("Content-Type must be application/json")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if size < 0 or size > _MAX_BODY_BYTES:
            raise ValueError(f"Request body must not exceed {_MAX_BODY_BYTES} bytes")
        raw = self.rfile.read(size)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be valid UTF-8 JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object")
        return value

    def _guard(self) -> bool:
        if not self._host_allowed():
            self._json({"error": "invalid_host"}, status=403)
            return False
        if not self._authorized():
            self._json({"error": "unauthorized", "message": "A valid Bearer token is required."}, status=401)
            return False
        return True

    def _require_management_permission(self, capability: str, *, confirmed: bool) -> bool:
        mode = Policy(self.stx_server.config.permissions).mode_for(capability)
        if mode is PermissionMode.DENY:
            self._json({
                "error": "permission_denied",
                "message": f"'{capability}' is denied by the active policy.",
            }, status=403)
            return False
        if mode is PermissionMode.CONFIRM and not confirmed:
            self._json({
                "error": "confirmation_required",
                "message": f"'{capability}' requires an explicit owner confirmation.",
            }, status=403)
            return False
        return True

    @staticmethod
    def _confirmed(value: Any) -> bool:
        return value is True or (isinstance(value, str) and value.lower() in {"1", "true", "yes"})

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/" or path in {"/app.js", "/app.css"}:
            if not self._host_allowed():
                self._json({"error": "invalid_host"}, status=403)
                return
            self._static("index.html" if path == "/" else path.lstrip("/"))
            return
        if not self._guard():
            return
        if path == "/api/health":
            self._json({"ok": True, "service": "stx-agent", "version": __version__})
        elif path == "/api/overview":
            self._json(self.stx_server.overview())
        elif path == "/api/settings":
            self._json(self.stx_server.settings_snapshot())
        elif path == "/api/audit":
            self._json(audit_workspace(
                self.stx_server.workspace,
                self.stx_server.config,
                config_path=self.stx_server.config.config_path,
            ).as_dict())
        elif path == "/api/index":
            self._json(self.stx_server.index_status())
        elif path == "/api/workspace":
            if self._require_management_permission(
                "filesystem.read",
                confirmed=self._confirmed(query.get("confirmed", [""])[0]),
            ):
                self._json(self.stx_server.workspace.summary(include_root=False))
        elif path == "/api/approvals":
            try:
                limit = int(query.get("limit", ["100"])[0])
                self._json({"approvals": self.stx_server.tasks.pending_approvals(limit=limit)})
            except (TypeError, ValueError) as exc:
                self._json({"error": "invalid_limit", "message": str(exc)}, status=400)
        elif path == "/api/tasks":
            try:
                limit = int(query.get("limit", ["50"])[0])
                if not 1 <= limit <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                self._json({"error": "invalid_limit", "message": "limit must be from 1 to 100"}, status=400)
                return
            self._json({"tasks": self.stx_server.tasks.list(limit=limit)})
        elif path == "/api/memory":
            if not self.stx_server.config.memory.enabled:
                self._json({"enabled": False, "items": []})
                return
            if not self._require_management_permission(
                "memory.read",
                confirmed=self._confirmed(query.get("confirmed", [""])[0]),
            ):
                return
            try:
                limit = int(query.get("limit", ["50"])[0])
                search = query.get("q", [""])[0]
                items = MemoryStore.read_only_list(
                    self.stx_server.workspace,
                    limit=limit,
                    query=search,
                )
                self._json({"enabled": True, "items": [item.as_dict() for item in items]})
            except (TypeError, ValueError) as exc:
                self._json({"error": "invalid_request", "message": str(exc)}, status=400)
            except sqlite3.Error:
                self._json({"error": "memory_unavailable", "message": "The local memory database could not be read."}, status=503)
        elif path.startswith("/api/tasks/"):
            task_id = path.removeprefix("/api/tasks/")
            if not task_id or "/" in task_id:
                self._json({"error": "not_found"}, status=404)
                return
            task = self.stx_server.tasks.get(task_id)
            self._json(task if task is not None else {"error": "not_found"}, status=200 if task else 404)
        else:
            self._json({"error": "not_found"}, status=404)

    def do_POST(self) -> None:
        if not self._guard():
            return
        path = urlsplit(self.path).path
        try:
            body = self._body()
        except ValueError as exc:
            self._json({"error": "invalid_request", "message": str(exc)}, status=400)
            return
        try:
            if path == "/api/index":
                if set(body) - {"force", "confirmed"}:
                    raise ValueError("Index requests accept only 'force' and 'confirmed'")
                force = body.get("force", False)
                if not isinstance(force, bool):
                    raise ValueError("force must be a boolean")
                if not self.stx_server.config.index.enabled:
                    self._json({"error": "index_disabled", "message": "Workspace indexing is disabled in configuration."}, status=409)
                    return
                if not self._require_management_permission(
                    "filesystem.read", confirmed=self._confirmed(body.get("confirmed", False))
                ):
                    return
                settings = self.stx_server.config.index
                result = ProjectIndex(
                    self.stx_server.workspace,
                    max_files=settings.max_files,
                    max_file_bytes=settings.max_file_bytes,
                ).index(force=force)
                self._json({"summary": result.as_dict(), "status": self.stx_server.index_status()})
                return
            if path == "/api/memory":
                allowed = {"content", "category", "importance", "ttl_days", "tags", "confirmed"}
                unexpected = set(body) - allowed
                if unexpected:
                    raise ValueError(f"Unexpected fields: {', '.join(sorted(unexpected))}")
                if not self.stx_server.config.memory.enabled:
                    self._json({"error": "memory_disabled", "message": "Explicit memory is disabled in configuration."}, status=409)
                    return
                if not self._require_management_permission(
                    "memory.write", confirmed=self._confirmed(body.get("confirmed", False))
                ):
                    return
                content = body.get("content")
                category = body.get("category", "project")
                importance = body.get("importance", 0.5)
                ttl_days = body.get("ttl_days")
                tags = body.get("tags", [])
                if not isinstance(content, str) or not isinstance(category, str):
                    raise ValueError("content and category must be strings")
                if isinstance(importance, bool) or not isinstance(importance, (int, float)):
                    raise ValueError("importance must be a number")
                if ttl_days is not None and (isinstance(ttl_days, bool) or not isinstance(ttl_days, int)):
                    raise ValueError("ttl_days must be an integer")
                if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
                    raise ValueError("tags must be an array of strings")
                item = MemoryStore(
                    self.stx_server.workspace,
                    retention_days=self.stx_server.config.memory.retention_days,
                ).remember(
                    content,
                    category=category,
                    importance=importance,
                    ttl_days=ttl_days,
                    tags=tags,
                )
                self._json({"stored": True, "item": item.as_dict()}, status=201)
                return
            if path == "/api/tasks":
                allowed = {"task", "profile", "dry_run"}
                unexpected = set(body) - allowed
                if unexpected:
                    raise ValueError(f"Unexpected fields: {', '.join(sorted(unexpected))}")
                task = body.get("task")
                if not isinstance(task, str):
                    raise ValueError("task must be a string")
                created = self.stx_server.tasks.submit(
                    task, profile=body.get("profile"), dry_run=body.get("dry_run", False)
                )
                self._json(created, status=202)
                return
            parts = path.strip("/").split("/")
            if len(parts) == 4 and parts[0:2] == ["api", "tasks"] and parts[3] == "cancel":
                task_id = parts[2]
                if body:
                    raise ValueError("Cancellation request body must be empty")
                cancelled = self.stx_server.tasks.cancel(task_id)
                self._json({"cancelled": cancelled}, status=200 if cancelled else 409)
                return
            if len(parts) == 5 and parts[0:2] == ["api", "tasks"] and parts[3] == "approvals":
                approved = body.get("approved")
                if set(body) != {"approved"} or not isinstance(approved, bool):
                    raise ValueError("Request must contain only a boolean 'approved' field")
                accepted = self.stx_server.tasks.respond_to_approval(
                    parts[2], parts[4], approved=approved
                )
                self._json({"recorded": accepted}, status=200 if accepted else 409)
                return
            self._json({"error": "not_found"}, status=404)
        except ValueError as exc:
            self._json({"error": "invalid_request", "message": str(exc)}, status=400)
        except WorkspaceError as exc:
            self._json({"error": "workspace_error", "message": str(exc)}, status=400)
        except sqlite3.Error:
            self._json({"error": "storage_unavailable", "message": "The local database operation could not be completed."}, status=503)
        except RuntimeError:
            self._json({"error": "server_shutting_down"}, status=503)

    def do_OPTIONS(self) -> None:
        self._json({"error": "method_not_allowed"}, status=405)

    def do_PUT(self) -> None:
        self._json({"error": "method_not_allowed"}, status=405)

    def do_DELETE(self) -> None:
        if not self._guard():
            return
        path = urlsplit(self.path).path
        try:
            body = self._body()
        except ValueError as exc:
            self._json({"error": "invalid_request", "message": str(exc)}, status=400)
            return
        if set(body) - {"confirmed"}:
            self._json({"error": "invalid_request", "message": "Delete requests accept only 'confirmed'."}, status=400)
            return
        confirmed = self._confirmed(body.get("confirmed", False))
        if path.startswith("/api/memory/"):
            memory_id = path.removeprefix("/api/memory/")
            if len(memory_id) != 32 or any(char not in "0123456789abcdef" for char in memory_id.lower()):
                self._json({"error": "not_found"}, status=404)
                return
            if not self.stx_server.config.memory.enabled:
                self._json({"error": "memory_disabled", "message": "Explicit memory is disabled in configuration."}, status=409)
                return
            if not self._require_management_permission("memory.write", confirmed=confirmed):
                return
            database = self.stx_server.workspace.root / ".stx" / "memory.sqlite3"
            deleted = False
            if database.is_file():
                try:
                    deleted = MemoryStore(
                        self.stx_server.workspace,
                        retention_days=self.stx_server.config.memory.retention_days,
                    ).forget(memory_id)
                except WorkspaceError as exc:
                    self._json({"error": "workspace_error", "message": str(exc)}, status=400)
                    return
                except sqlite3.Error:
                    self._json({"error": "storage_unavailable", "message": "The local memory database could not be updated."}, status=503)
                    return
            self._json({"deleted": deleted}, status=200 if deleted else 404)
            return
        if path.startswith("/api/tasks/"):
            task_id = path.removeprefix("/api/tasks/")
            if len(task_id) != 32 or any(char not in "0123456789abcdef" for char in task_id.lower()):
                self._json({"error": "not_found"}, status=404)
                return
            if not self._require_management_permission("tasks.history.delete", confirmed=confirmed):
                return
            existing = self.stx_server.tasks.get(task_id)
            if existing is None:
                self._json({"error": "not_found"}, status=404)
                return
            deleted = self.stx_server.tasks.delete_finished(task_id)
            if not deleted:
                self._json({"error": "task_active", "message": "Active tasks cannot be deleted. Cancel them first."}, status=409)
                return
            self._json({"deleted": True})
            return
        self._json({"error": "not_found"}, status=404)


class STXAPIServer:
    def __init__(self, workspace: Workspace, config: AppConfig, *, host: str = "127.0.0.1", port: int = 8765, workers: int = 2) -> None:
        self.workspace = workspace
        self.config = config
        self.host = host
        self.port = port
        self.api_token = os.environ.get("STX_API_TOKEN") or None
        if not _is_loopback(host) and not self.api_token:
            raise ConfigError("Binding the API to a non-loopback address requires STX_API_TOKEN.")
        if self.api_token is not None and (len(self.api_token) < 24 or not self.api_token.isascii()):
            raise ConfigError("STX_API_TOKEN must be at least 24 ASCII characters.")
        self.tasks = TaskManager(workspace, config, workers=workers)
        try:
            self.httpd = STXHTTPServer((host, port), STXRequestHandler)
        except Exception:
            self.tasks.shutdown(wait=True)
            raise
        self.httpd.stx_server = self  # type: ignore[attr-defined]
        self._stop = threading.Event()

    def overview(self) -> dict[str, Any]:
        counts = self.tasks.status_counts()
        active_statuses = {"queued", "running", "awaiting_approval", "cancelling"}
        review_statuses = {"failed", "incomplete", "provider_error", "step_limit", "interrupted", "cancelled"}
        return {
            "service": "stx-agent",
            "version": __version__,
            "workspace_name": self.workspace.root.name,
            "autonomy": self.config.autonomy,
            "model_profiles": len(self.config.profiles),
            "task_counts": counts,
            "active_tasks": sum(count for status, count in counts.items() if status in active_statuses),
            "pending_approvals": self.tasks.pending_approval_count(),
            "needs_review": sum(count for status, count in counts.items() if status in review_statuses),
        }

    def settings_snapshot(self) -> dict[str, Any]:
        policy = Policy(self.config.permissions)
        providers = []
        for name, provider in sorted(self.config.providers.items()):
            key_present = bool(provider.api_key_env and os.environ.get(provider.api_key_env))
            providers.append({
                "name": name,
                "kind": provider.kind,
                "endpoint": provider.base_url,
                "api_key_required": provider.require_api_key,
                "credential_present": key_present,
                "ready": not provider.require_api_key or key_present,
                "timeout_seconds": provider.timeout_seconds,
            })
        profiles = []
        for name, profile in sorted(self.config.profiles.items()):
            provider = self.config.providers[profile.provider]
            profiles.append({
                "name": name,
                "provider": profile.provider,
                "provider_kind": provider.kind,
                "model": profile.model,
                "temperature": profile.temperature,
                "endpoint": provider.base_url,
                "credential_ready": not provider.require_api_key or bool(
                    provider.api_key_env and os.environ.get(provider.api_key_env)
                ),
            })
        registry = build_default_registry(
            self.config.index,
            self.config.memory,
            self.config.network,
            include_index=self.config.index.enabled,
            include_memory=self.config.memory.enabled,
            include_network=self.config.network.enabled,
        )
        tools = [
            {**tool, "permission": policy.mode_for(tool["capability"]).value}
            for tool in registry.describe()
        ]
        return {
            "schema_version": 1,
            "workspace_name": self.workspace.root.name,
            "config_present": bool(self.config.config_path and self.config.config_path.is_file()),
            "config_editing": "read_only",
            "agent": {
                "autonomy": self.config.autonomy,
                "default_profile": self.config.default_profile,
                "max_tool_steps": self.config.max_tool_steps,
            },
            "providers": providers,
            "profiles": profiles,
            "permissions": [
                {"capability": name, "mode": mode.value}
                for name, mode in sorted(self.config.permissions.items())
            ],
            "tools": tools,
            "index": {
                "enabled": self.config.index.enabled,
                "max_files": self.config.index.max_files,
                "max_file_bytes": self.config.index.max_file_bytes,
                "context_files": self.config.index.context_files,
                "context_chars": self.config.index.context_chars,
            },
            "memory": {
                "enabled": self.config.memory.enabled,
                "retention_days": self.config.memory.retention_days,
                "categories": sorted(MEMORY_CATEGORIES),
            },
            "network": {
                "enabled": self.config.network.enabled,
                "allowed_hosts": list(self.config.network.allowed_hosts),
                "timeout_seconds": self.config.network.timeout_seconds,
                "max_response_bytes": self.config.network.max_response_bytes,
            },
            "tasks": {
                "retention_days": self.config.tasks.retention_days,
                "max_records": self.config.tasks.max_records,
            },
        }

    def index_status(self) -> dict[str, Any]:
        data_directory = self.workspace.root / ".stx"
        database = data_directory / "index.sqlite3"
        if data_directory.is_symlink() or database.is_symlink():
            return {"available": False, "files": 0, "symbols": 0, "last_indexed_at": None, "error": "symlink"}
        if not database.is_file():
            return {"available": False, "files": 0, "symbols": 0, "last_indexed_at": None}
        try:
            # immutable=1 keeps a status read from creating WAL/SHM sidecars. If
            # an index is being updated concurrently, this view may be a prior snapshot.
            connection = sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=5)
            try:
                row = connection.execute(
                    "SELECT COUNT(*),COALESCE(SUM(size),0),MAX(indexed_at) FROM files"
                ).fetchone()
                symbols = connection.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
            finally:
                connection.close()
        except sqlite3.Error:
            return {"available": False, "files": 0, "symbols": 0, "last_indexed_at": None, "error": "unreadable"}
        return {
            "available": True,
            "files": int(row[0]),
            "bytes": int(row[1]),
            "symbols": int(symbols),
            "last_indexed_at": row[2],
        }

    def serve_forever(self) -> None:
        display_host = f"[{self.host}]" if ":" in self.host else self.host
        print(f"STX Agent dashboard: http://{display_host}:{self.httpd.server_port}/")
        if self.api_token:
            print("API authentication is enabled; the dashboard will prompt for the bearer token.")
        print("Press Ctrl+C to stop. This HTTP server does not provide TLS.")
        try:
            self.httpd.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
            pass
        finally:
            self.close()

    def close(self) -> None:
        if self._stop.is_set():
            return
        self._stop.set()
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tasks.shutdown(wait=True)
