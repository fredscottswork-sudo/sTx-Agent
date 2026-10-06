"""Local-only HTTP API and static control dashboard."""

from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import secrets
import threading
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .config import AppConfig
from .errors import ConfigError
from .policy import PermissionMode, Policy
from .tasks import TaskManager
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

    def do_GET(self) -> None:
        if not self._guard():
            return
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == "/":
            self._static("index.html")
        elif path in {"/app.js", "/app.css"}:
            self._static(path.lstrip("/"))
        elif path == "/api/health":
            self._json({"ok": True, "service": "stx-agent", "version": "0.1.0"})
        elif path == "/api/workspace":
            if Policy(self.stx_server.config.permissions).mode_for("filesystem.read") is not PermissionMode.ALLOW:
                self._json({"error": "permission_denied", "message": "filesystem.read must be explicitly allowed for workspace metadata access"}, status=403)
            else:
                self._json(self.stx_server.workspace.summary(include_root=False))
        elif path == "/api/tasks":
            query = parse_qs(parsed.query)
            try:
                limit = int(query.get("limit", ["50"])[0])
                if not 1 <= limit <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                self._json({"error": "invalid_limit", "message": "limit must be from 1 to 100"}, status=400)
                return
            self._json({"tasks": self.stx_server.tasks.list(limit=limit)})
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
        except RuntimeError:
            self._json({"error": "server_shutting_down"}, status=503)

    def do_OPTIONS(self) -> None:
        self._json({"error": "method_not_allowed"}, status=405)

    def do_PUT(self) -> None:
        self._json({"error": "method_not_allowed"}, status=405)

    def do_DELETE(self) -> None:
        self._json({"error": "method_not_allowed"}, status=405)


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
