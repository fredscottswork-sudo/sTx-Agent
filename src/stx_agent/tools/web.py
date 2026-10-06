"""Consent-gated HTTPS text fetches with host allowlists and SSRF defenses."""

from __future__ import annotations
from html.parser import HTMLParser
import http.client
from ipaddress import ip_address
import re
import socket
import ssl
from typing import Any, Mapping
from urllib.parse import urljoin, urlsplit

from ..config import NetworkSettings
from ..policy import RiskLevel
from .base import Tool, ToolContext, ToolResult


_ALLOWED_TYPES = {
    "text/plain", "text/html", "text/markdown", "application/json",
    "application/xml", "text/xml", "application/xhtml+xml",
}
_REDIRECTS = {301, 302, 303, 307, 308}


class _HTMLText(HTMLParser):
    _BLOCKS = {"address", "article", "br", "div", "footer", "h1", "h2", "h3", "h4", "li", "p", "pre", "section", "table", "tr"}
    _HIDDEN = {"script", "style", "noscript", "svg", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._HIDDEN:
            self.hidden_depth += 1
        elif not self.hidden_depth and tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._HIDDEN and self.hidden_depth:
            self.hidden_depth -= 1
        elif not self.hidden_depth and tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth:
            self.parts.append(data)

    def text(self) -> str:
        lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Direct HTTPS connection that uses the IP already checked against SSRF."""

    def __init__(self, hostname: str, address: str, timeout: float) -> None:
        super().__init__(hostname, 443, timeout=timeout, context=ssl.create_default_context())
        self._pinned_address = address

    def connect(self) -> None:
        raw_socket = socket.create_connection((self._pinned_address, self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
        except Exception:
            raw_socket.close()
            raise


def _normalized_host(host: str) -> str:
    return host.encode("idna").decode("ascii").lower().rstrip(".")


def _host_allowed(host: str, patterns: tuple[str, ...]) -> bool:
    for pattern in patterns:
        if pattern.startswith("*."):
            suffix = pattern[1:]
            if host.endswith(suffix) and host != pattern[2:]:
                return True
        elif host == pattern:
            return True
    return False


def _public_addresses(host: str) -> list[str]:
    results = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    addresses = []
    for result in results:
        address = result[4][0].split("%", 1)[0]
        parsed = ip_address(address)
        if not parsed.is_global:
            raise ValueError("Hostname resolves to a non-public network address")
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise ValueError("Hostname did not resolve to an address")
    return addresses


def _display_url(parsed) -> str:
    path = parsed.path or "/"
    return f"https://{parsed.hostname}{path[:300]}"


class WebFetchTool(Tool):
    name = "web.fetch"
    description = (
        "Fetch public text content over HTTPS from an owner-allowlisted hostname. "
        "GET only; responses are untrusted reference data, with no cookies or auth headers."
    )
    required_capability = "network.fetch"
    input_schema = {
        "type": "object",
        "properties": {"url": {"type": "string", "minLength": 9, "maxLength": 4000}},
        "required": ["url"],
        "additionalProperties": False,
    }

    def __init__(self, settings: NetworkSettings) -> None:
        self.settings = settings

    def risk(self, arguments: Mapping[str, Any], context: ToolContext) -> RiskLevel:
        return RiskLevel.HIGH

    def approval_details(self, arguments: Mapping[str, Any], context: ToolContext) -> str:
        try:
            parsed = urlsplit(str(arguments.get("url", "")))
            return f"Fetch public text from {_display_url(parsed)} (HTTPS GET; no credentials or cookies sent)"
        except Exception:
            return "Fetch a user-allowlisted HTTPS URL"

    def _parse_allowed(self, url: str):
        if len(url) > 4_000:
            raise ValueError("URL is too long")
        parsed = urlsplit(url)
        if parsed.scheme.lower() != "https" or not parsed.hostname:
            raise ValueError("Only absolute HTTPS URLs are supported")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Credentials embedded in URLs are not allowed")
        if parsed.port not in (None, 443):
            raise ValueError("Only the standard HTTPS port is supported")
        host = _normalized_host(parsed.hostname)
        if not _host_allowed(host, self.settings.allowed_hosts):
            raise ValueError("Hostname is not in [network].allowed_hosts")
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        return parsed, host, path

    def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if not self.settings.enabled:
            return ToolResult.failure("Network fetch is disabled in configuration.")
        url = arguments["url"]
        if context.dry_run:
            try:
                parsed, host, _ = self._parse_allowed(url)
                return ToolResult.success({
                    "dry_run": True,
                    "executed": False,
                    "host": host,
                    "url": _display_url(parsed),
                })
            except (ValueError, UnicodeError) as exc:
                return ToolResult.failure(str(exc))
        try:
            for redirect_count in range(4):
                parsed, host, request_path = self._parse_allowed(url)
                address = _public_addresses(host)[0]
                connection = _PinnedHTTPSConnection(host, address, self.settings.timeout_seconds)
                try:
                    connection.request(
                        "GET", request_path,
                        headers={
                            "User-Agent": "STX-Agent/0.1 (policy-gated repository assistant)",
                            "Accept": "text/plain, text/html, text/markdown, application/json, application/xml",
                            "Connection": "close",
                        },
                    )
                    response = connection.getresponse()
                    if response.status in _REDIRECTS:
                        location = response.getheader("Location")
                        if not location or redirect_count >= 3:
                            return ToolResult.failure("HTTPS redirect limit reached or Location was missing.")
                        url = urljoin(url, location)
                        continue
                    media_type = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
                    if media_type not in _ALLOWED_TYPES:
                        return ToolResult.failure(f"Unsupported response content type: {media_type or 'unknown'}")
                    raw = response.read(self.settings.max_response_bytes + 1)
                    truncated = len(raw) > self.settings.max_response_bytes
                    raw = raw[:self.settings.max_response_bytes]
                    charset_match = re.search(r"charset\s*=\s*['\"]?([\w.-]+)", response.getheader("Content-Type", ""), re.IGNORECASE)
                    charset = charset_match.group(1) if charset_match else "utf-8"
                    try:
                        text = raw.decode(charset, errors="replace")
                    except LookupError:
                        text = raw.decode("utf-8", errors="replace")
                    if media_type in {"text/html", "application/xhtml+xml"}:
                        parser = _HTMLText()
                        parser.feed(text)
                        text = parser.text()
                    text = "".join(ch for ch in text if ch in "\n\r\t" or ch.isprintable())
                    if len(text) > 30_000:
                        text, truncated = text[:30_000], True
                    return ToolResult.success({
                        "status": response.status,
                        "url": _display_url(parsed),
                        "content_type": media_type,
                        "text": text,
                        "truncated": truncated,
                        "untrusted_content": True,
                    })
                finally:
                    connection.close()
            return ToolResult.failure("HTTPS redirect limit reached.")
        except (OSError, ssl.SSLError, http.client.HTTPException, ValueError, UnicodeError) as exc:
            message = str(exc)
            if "allowed_hosts" in message or "HTTPS" in message or "Credentials" in message or "Hostname" in message or "port" in message or "URL" in message:
                return ToolResult.failure(message)
            return ToolResult.failure(f"HTTPS fetch failed ({type(exc).__name__}); response content was not retrieved.")
