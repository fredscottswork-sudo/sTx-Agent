from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from stx_agent.agent import Agent
from stx_agent.config import (
    AppConfig,
    IndexSettings,
    MemorySettings,
    ModelProfile,
    NetworkSettings,
    ProviderSettings,
)
from stx_agent.policy import PermissionMode
from stx_agent.runtime import provider_factory
from stx_agent.tools import build_default_registry
from stx_agent.workspace import Workspace


class AnthropicLoopState:
    calls = 0
    requests: list[dict] = []


class AnthropicLoopHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args) -> None:
        return

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        AnthropicLoopState.requests.append(body)
        AnthropicLoopState.calls += 1
        if AnthropicLoopState.calls == 1:
            response = {
                "id": "msg-tool",
                "type": "message",
                "role": "assistant",
                "model": "claude-local-test",
                "content": [{
                    "type": "tool_use",
                    "id": "write-1",
                    "name": "workspace.write_file",
                    "input": {"path": "result.txt", "content": "written through Anthropic tool mapping\n"},
                }],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 30, "output_tokens": 12},
            }
        else:
            response = {
                "id": "msg-final",
                "type": "message",
                "role": "assistant",
                "model": "claude-local-test",
                "content": [{"type": "text", "text": "The file was written and the tool result was observed."}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 48, "output_tokens": 14},
            }
        payload = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class AnthropicIntegrationTests(unittest.TestCase):
    def test_agent_tool_loop_round_trips_through_native_messages_api(self) -> None:
        AnthropicLoopState.calls = 0
        AnthropicLoopState.requests = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), AnthropicLoopHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workspace = Workspace(root)
            profile = ModelProfile("default", "anthropic", "claude-local-test")
            config = AppConfig(
                autonomy="assisted",
                default_profile="default",
                max_tool_steps=3,
                providers={"anthropic": ProviderSettings(
                    "anthropic", "anthropic", f"http://127.0.0.1:{server.server_port}/v1",
                    api_key_env="STX_TEST_ANTHROPIC_KEY", timeout_seconds=3, require_api_key=True,
                )},
                profiles={"default": profile},
                permissions={
                    "filesystem.read": PermissionMode.ALLOW,
                    "filesystem.write": PermissionMode.CONFIRM,
                    "memory.read": PermissionMode.DENY,
                },
                index=IndexSettings(enabled=False),
                memory=MemorySettings(enabled=False),
                network=NetworkSettings(enabled=False),
            )
            tools = build_default_registry(
                config.index, config.memory, config.network,
                include_index=False, include_memory=False, include_network=False,
            )
            try:
                with patch.dict(os.environ, {"STX_TEST_ANTHROPIC_KEY": "local-test-key"}):
                    agent = Agent(
                        config=config,
                        workspace=workspace,
                        tools=tools,
                        provider_factory=provider_factory(config),
                        approval=lambda request: request.tool_name == "workspace.write_file",
                    )
                    result = agent.run("Create result.txt and tell me what happened.")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
            file_content = (root / "result.txt").read_text(encoding="utf-8")

        self.assertEqual(result.status, "completed")
        self.assertIn("tool result was observed", result.answer)
        self.assertEqual(file_content, "written through Anthropic tool mapping\n")
        self.assertEqual(AnthropicLoopState.calls, 2)
        second = AnthropicLoopState.requests[1]["messages"]
        assistant_turn = next(item for item in second if item["role"] == "assistant")
        tool_result = next(item for item in second if item["role"] == "user" and any(
            block.get("type") == "tool_result" for block in item["content"]
        ))
        self.assertEqual(assistant_turn["content"][0]["type"], "tool_use")
        self.assertEqual(tool_result["content"][0]["tool_use_id"], "write-1")


if __name__ == "__main__":
    unittest.main()
