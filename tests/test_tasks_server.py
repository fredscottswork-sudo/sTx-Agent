from __future__ import annotations

from http.client import HTTPConnection
import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from stx_agent.config import AppConfig
from stx_agent.errors import ConfigError
from stx_agent.policy import ApprovalRequest, RiskLevel
from stx_agent.server import STXAPIServer
from stx_agent.task_store import TaskStore
from stx_agent.tasks import TaskManager
from stx_agent.workspace import Workspace


class ApprovalAgent:
    def __init__(self, approval, requested: threading.Event) -> None:
        self.approval = approval
        self.requested = requested

    def run(self, task, *, requested_profile=None):
        self.requested.set()
        approved = self.approval(ApprovalRequest(
            capability="terminal.execute",
            tool_name="terminal.run",
            risk=RiskLevel.HIGH,
            details="Run the explicitly requested diagnostic command",
        ))
        return type("Result", (), {
            "status": "completed",
            "answer": "approved" if approved else "denied",
            "model_turns": 1,
            "tool_calls": 1,
        })()


class TaskServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace(self.temp.name)
        self.config = AppConfig()
        self.requested = threading.Event()
        self.servers = []

    def tearDown(self) -> None:
        for server, thread in self.servers:
            server.close()
            thread.join(3)
        self.temp.cleanup()

    def start_server(self, *, token: str | None = None):
        patcher = patch.dict(os.environ, {}, clear=False)
        patcher.start()
        if token is None:
            os.environ.pop("STX_API_TOKEN", None)
        else:
            os.environ["STX_API_TOKEN"] = token
        create_agent = lambda config, workspace, **kwargs: ApprovalAgent(kwargs["approval"], self.requested)
        agent_patcher = patch("stx_agent.tasks.create_agent", side_effect=create_agent)
        agent_patcher.start()
        server = STXAPIServer(self.workspace, self.config, host="127.0.0.1", port=0, workers=1)
        thread = threading.Thread(target=server.httpd.serve_forever, daemon=True)
        thread.start()
        self.servers.append((server, thread))
        self.addCleanup(patcher.stop)
        self.addCleanup(agent_patcher.stop)
        self.addCleanup(thread.join, 3)
        self.addCleanup(server.close)
        return server

    def request(self, server, method: str, path: str, *, body=None, token: str | None = None, host: str | None = None):
        connection = HTTPConnection("127.0.0.1", server.httpd.server_port, timeout=3)
        headers = {}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if host is not None:
            headers["Host"] = host
        raw = json.dumps(body).encode() if body is not None else None
        connection.request(method, path, body=raw, headers=headers)
        response = connection.getresponse()
        payload = response.read()
        result = json.loads(payload) if response.getheader("Content-Type", "").startswith("application/json") else payload
        status = response.status
        connection.close()
        return status, result

    def test_dashboard_task_approval_and_completion_end_to_end(self) -> None:
        server = self.start_server()
        status, health = self.request(server, "GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(health["ok"])
        status, page = self.request(server, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"STX Control Center", page)
        status, created = self.request(server, "POST", "/api/tasks", body={"task": "Run a safe test"})
        self.assertEqual(status, 202)
        task_id = created["id"]
        self.assertTrue(self.requested.wait(2))
        deadline = time.monotonic() + 2
        pending = server.tasks.get(task_id)
        while pending["status"] != "awaiting_approval" and time.monotonic() < deadline:
            time.sleep(0.02)
            pending = server.tasks.get(task_id)
        self.assertEqual(pending["status"], "awaiting_approval")
        approval = pending["approvals"][0]
        status, result = self.request(
            server, "POST", f"/api/tasks/{task_id}/approvals/{approval['id']}",
            body={"approved": True},
        )
        self.assertEqual(status, 200)
        self.assertTrue(result["recorded"])
        deadline = time.monotonic() + 3
        final = server.tasks.get(task_id)
        while final["status"] not in {"completed", "failed"} and time.monotonic() < deadline:
            time.sleep(0.02)
            final = server.tasks.get(task_id)
        self.assertEqual(final["status"], "completed")
        self.assertEqual(final["answer"], "approved")
        self.assertEqual(final["approvals"][0]["status"], "approved")

    def test_cancelling_pending_approval_stops_task_and_denies_tool(self) -> None:
        server = self.start_server()
        status, created = self.request(server, "POST", "/api/tasks", body={"task": "Wait for approval"})
        self.assertEqual(status, 202)
        task_id = created["id"]
        self.assertTrue(self.requested.wait(2))
        deadline = time.monotonic() + 2
        task = server.tasks.get(task_id)
        while task["status"] != "awaiting_approval" and time.monotonic() < deadline:
            time.sleep(0.02)
            task = server.tasks.get(task_id)
        status, cancelled = self.request(server, "POST", f"/api/tasks/{task_id}/cancel", body={})
        self.assertEqual(status, 200)
        self.assertTrue(cancelled["cancelled"])
        deadline = time.monotonic() + 2
        task = server.tasks.get(task_id)
        while task["status"] not in {"cancelled", "failed"} and time.monotonic() < deadline:
            time.sleep(0.02)
            task = server.tasks.get(task_id)
        self.assertEqual(task["status"], "cancelled")
        self.assertEqual(task["approvals"][0]["status"], "denied")

    def test_loopback_host_allowlist_and_remote_token_auth(self) -> None:
        server = self.start_server(token="test-token-that-is-at-least-24-characters")
        status, _ = self.request(server, "GET", "/api/health")
        self.assertEqual(status, 401)
        token = "test-token-that-is-at-least-24-characters"
        status, _ = self.request(server, "GET", "/api/health", token=token, host="attacker.invalid")
        self.assertEqual(status, 403)
        status, body = self.request(server, "GET", "/api/health", token=token)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_task_retention_prunes_old_completed_records(self) -> None:
        store = TaskStore(self.workspace, retention_days=1, max_records=10)
        task = store.create("old task")
        store.update(task["id"], status="completed", answer="done")
        with sqlite3.connect(store.database) as connection:
            connection.execute(
                "UPDATE tasks SET updated_at=? WHERE id=?",
                ("2000-01-01T00:00:00+00:00", task["id"]),
            )
        reopened = TaskStore(self.workspace, retention_days=1, max_records=10)
        self.assertIsNone(reopened.get(task["id"]))

    def test_only_one_task_server_can_own_a_workspace_at_a_time(self) -> None:
        manager = TaskManager(self.workspace, self.config)
        try:
            with self.assertRaises(ConfigError):
                TaskManager(self.workspace, self.config)
        finally:
            manager.shutdown(wait=True)
        second = TaskManager(self.workspace, self.config)
        second.shutdown(wait=True)

    def test_non_loopback_bind_requires_long_token(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ConfigError):
                STXAPIServer(self.workspace, self.config, host="0.0.0.0", port=0)
        with patch.dict(os.environ, {"STX_API_TOKEN": "short"}):
            with self.assertRaises(ConfigError):
                STXAPIServer(self.workspace, self.config, host="0.0.0.0", port=0)

    def test_interrupted_tasks_are_marked_after_restart(self) -> None:
        store = TaskStore(self.workspace)
        task = store.create("unfinished")
        store.update(task["id"], status="running")
        reopened = TaskStore(self.workspace)
        self.assertEqual(reopened.get(task["id"])["status"], "interrupted")

    def test_task_history_is_bounded_and_list_hides_full_results(self) -> None:
        store = TaskStore(self.workspace, retention_days=30, max_records=10)
        created = []
        for number in range(12):
            item = store.create(f"instruction {number}")
            store.update(item["id"], status="completed", answer="private result")
            created.append(item["id"])
        tasks = store.list(limit=100)
        self.assertEqual(len(tasks), 10)
        self.assertNotIn("answer", tasks[0])
        self.assertIsNone(store.get(created[0]))


if __name__ == "__main__":
    unittest.main()
