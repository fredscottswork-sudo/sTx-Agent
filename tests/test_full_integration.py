from __future__ import annotations

from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest

from stx_agent.config import AppConfig, ModelProfile, ProviderSettings
from stx_agent.policy import PermissionMode
from stx_agent.server import STXAPIServer
from stx_agent.workspace import Workspace


class FakeModelState:
    lock = threading.Lock()
    calls = 0
    requests = []


class FakeModelHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length))
        with FakeModelState.lock:
            FakeModelState.calls += 1
            FakeModelState.requests.append(request)
            call_number = FakeModelState.calls
        if call_number == 1:
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "write-1",
                    "type": "function",
                    "function": {
                        "name": "workspace.write_file",
                        "arguments": json.dumps({"path": "result.txt", "content": "verified by the integrated agent\n"}),
                    },
                }],
            }
            finish_reason = "tool_calls"
        else:
            message = {"role": "assistant", "content": "I wrote the file after approval and verified the observed result."}
            finish_reason = "stop"
        payload = json.dumps({
            "choices": [{"message": message, "finish_reason": finish_reason}],
            "model": "fake-local-model",
            "usage": {"total_tokens": 42},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class FullIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.saved_api_token = os.environ.pop("STX_API_TOKEN", None)
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace(self.temp.name)
        FakeModelState.calls = 0
        FakeModelState.requests = []
        self.model_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeModelHandler)
        self.model_thread = threading.Thread(target=self.model_server.serve_forever, daemon=True)
        self.model_thread.start()
        provider = ProviderSettings(
            name="test", kind="openai_compatible",
            base_url=f"http://127.0.0.1:{self.model_server.server_port}/v1",
            timeout_seconds=5, require_api_key=False,
        )
        profile = ModelProfile("default", "test", "fake-local-model")
        self.config = AppConfig(
            default_profile="default",
            max_tool_steps=4,
            providers={"test": provider},
            profiles={"default": profile},
            permissions={
                "filesystem.read": PermissionMode.ALLOW,
                "filesystem.write": PermissionMode.CONFIRM,
                "memory.read": PermissionMode.ALLOW,
            },
        )
        self.server = STXAPIServer(self.workspace, self.config, host="127.0.0.1", port=0, workers=1)
        self.server_thread = threading.Thread(target=self.server.httpd.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        self.server.close()
        self.server_thread.join(3)
        self.model_server.shutdown()
        self.model_server.server_close()
        self.model_thread.join(3)
        self.temp.cleanup()
        if self.saved_api_token is not None:
            os.environ["STX_API_TOKEN"] = self.saved_api_token

    def api(self, method: str, path: str, *, body=None):
        connection = HTTPConnection("127.0.0.1", self.server.httpd.server_port, timeout=5)
        headers = {"Content-Type": "application/json"} if body is not None else {}
        encoded = json.dumps(body).encode() if body is not None else None
        connection.request(method, path, body=encoded, headers=headers)
        response = connection.getresponse()
        data = json.loads(response.read())
        status = response.status
        connection.close()
        return status, data

    def test_dashboard_model_policy_write_approval_and_final_answer(self) -> None:
        status, created = self.api("POST", "/api/tasks", body={"task": "Create the result file with the requested text."})
        self.assertEqual(status, 202)
        task_id = created["id"]
        deadline = time.monotonic() + 5
        task = self.server.tasks.get(task_id)
        while task["status"] != "awaiting_approval" and time.monotonic() < deadline:
            time.sleep(0.02)
            task = self.server.tasks.get(task_id)
        self.assertEqual(task["status"], "awaiting_approval")
        approval = task["approvals"][0]
        self.assertEqual(approval["tool_name"], "workspace.write_file")
        status, approved = self.api(
            "POST", f"/api/tasks/{task_id}/approvals/{approval['id']}", body={"approved": True}
        )
        self.assertEqual(status, 200)
        self.assertTrue(approved["recorded"])
        deadline = time.monotonic() + 5
        task = self.server.tasks.get(task_id)
        while task["status"] not in {"completed", "failed"} and time.monotonic() < deadline:
            time.sleep(0.02)
            task = self.server.tasks.get(task_id)
        self.assertEqual(task["status"], "completed")
        self.assertIn("after approval", task["answer"])
        self.assertEqual((Path(self.temp.name) / "result.txt").read_text(encoding="utf-8"), "verified by the integrated agent\n")
        self.assertEqual(FakeModelState.calls, 2)
        second_messages = FakeModelState.requests[1]["messages"]
        self.assertTrue(any(message.get("role") == "tool" for message in second_messages))


if __name__ == "__main__":
    unittest.main()
