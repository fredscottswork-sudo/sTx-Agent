from __future__ import annotations

import socket
import tempfile
import unittest
from unittest.mock import patch

from stx_agent.config import NetworkSettings
from stx_agent.policy import Policy, PermissionMode, RiskLevel
from stx_agent.tools.base import ToolContext
from stx_agent.tools.registry import ToolRegistry
from stx_agent.tools.web import WebFetchTool
from stx_agent.workspace import Workspace


class FakeResponse:
    def __init__(self, status=200, headers=None, body=b"") -> None:
        self.status = status
        self.headers = headers or {"Content-Type": "text/html; charset=utf-8"}
        self.body = body

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read(self, size=-1):
        return self.body[:size]


class FakeConnection:
    responses = []
    requests = []

    def __init__(self, host, address, timeout):
        self.host, self.address, self.timeout = host, address, timeout

    def request(self, method, path, *, headers):
        self.requests.append((self.host, method, path, headers))

    def getresponse(self):
        return self.responses.pop(0)

    def close(self):
        pass


class WebToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace(self.temp.name)
        self.settings = NetworkSettings(
            enabled=True,
            allowed_hosts=("docs.example.org", "*.read.example.org"),
            timeout_seconds=5,
            max_response_bytes=1024,
        )
        FakeConnection.responses = []
        FakeConnection.requests = []
        self.tool = WebFetchTool(self.settings)
        self.context = ToolContext(
            self.workspace,
            Policy({"network.fetch": PermissionMode.CONFIRM}),
            autonomy="assisted",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_https_text_fetch_sanitizes_html_and_does_not_return_query(self) -> None:
        FakeConnection.responses = [FakeResponse(body=(
            b"<html><head><script>steal secrets()</script><style>hidden</style></head>"
            b"<body><h1>Docs</h1><p>Safe &amp; useful <b>content</b>.</p></body></html>"
        ))]
        with patch("stx_agent.tools.web._public_addresses", return_value=["93.184.216.34"]), \
             patch("stx_agent.tools.web._PinnedHTTPSConnection", FakeConnection):
            result = self.tool.execute({"url": "https://docs.example.org/guide?token=private"}, self.context)
        self.assertTrue(result.ok)
        self.assertIn("Safe & useful content", result.data["text"])
        self.assertNotIn("steal secrets", result.data["text"])
        self.assertNotIn("token=private", result.data["url"])
        self.assertTrue(result.data["untrusted_content"])
        self.assertEqual(FakeConnection.requests[0][1], "GET")
        self.assertEqual(self.tool.risk({"url": "https://docs.example.org"}, self.context), RiskLevel.HIGH)
        self.assertNotIn("token=private", self.tool.approval_details({"url": "https://docs.example.org/?token=private"}, self.context))

    def test_dry_run_validates_allowlist_without_network_access(self) -> None:
        context = ToolContext(
            self.workspace, Policy({"network.fetch": PermissionMode.CONFIRM}), dry_run=True
        )
        with patch("stx_agent.tools.web._public_addresses") as resolve, \
             patch("stx_agent.tools.web._PinnedHTTPSConnection") as connection:
            result = ToolRegistry([self.tool]).execute(
                "web.fetch", {"url": "https://docs.example.org/guide?token=private"}, context
            )
        self.assertTrue(result.ok)
        self.assertFalse(result.data["executed"])
        self.assertNotIn("token=private", result.data["url"])
        resolve.assert_not_called()
        connection.assert_not_called()

    def test_private_dns_and_unapproved_redirect_are_rejected(self) -> None:
        with patch("stx_agent.tools.web.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 443))
        ]):
            result = self.tool.execute({"url": "https://docs.example.org/"}, self.context)
        self.assertFalse(result.ok)
        self.assertIn("non-public", result.error)

        FakeConnection.responses = [FakeResponse(
            status=302,
            headers={"Location": "https://attacker.invalid/steal"},
        )]
        with patch("stx_agent.tools.web._public_addresses", return_value=["93.184.216.34"]), \
             patch("stx_agent.tools.web._PinnedHTTPSConnection", FakeConnection):
            result = self.tool.execute({"url": "https://docs.example.org/"}, self.context)
        self.assertFalse(result.ok)
        self.assertIn("not in [network].allowed_hosts", result.error)

    def test_only_https_and_allowlisted_hosts_are_fetchable(self) -> None:
        for url in (
            "http://docs.example.org/",
            "https://unknown.example.org/",
            "https://user:pass@docs.example.org/",
            "https://docs.example.org:8443/",
        ):
            result = self.tool.execute({"url": url}, self.context)
            self.assertFalse(result.ok, url)

    def test_tool_registry_requires_policy_confirmation(self) -> None:
        registry = ToolRegistry([self.tool])
        result = registry.execute("web.fetch", {"url": "https://docs.example.org/"}, self.context)
        self.assertFalse(result.ok)
        self.assertIn("requires confirmation", result.error)


if __name__ == "__main__":
    unittest.main()
