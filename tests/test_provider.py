from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from unittest.mock import patch
import unittest

from stx_agent.config import ModelProfile, ProviderSettings
from stx_agent.errors import ProviderError
from stx_agent.providers.openai_compatible import OpenAICompatibleProvider, parse_chat_completion


class _Response:
    def __init__(self, value: dict) -> None:
        self.value = json.dumps(value).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit: int = -1) -> bytes:
        return self.value[:limit]


class ProviderTests(unittest.TestCase):
    def test_normalizes_text_and_tool_calls(self) -> None:
        response = parse_chat_completion({
            "model": "test-model",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "workspace.inspect", "arguments": "{}"},
                    }],
                },
            }],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
        })
        self.assertIsNone(response.content)
        self.assertEqual(response.tool_calls[0].name, "workspace.inspect")
        self.assertEqual(response.tool_calls[0].arguments, {})
        self.assertEqual(response.assistant_message["tool_calls"][0]["id"], "call-1")
        self.assertEqual(response.usage["prompt_tokens"], 5)

    def test_rejects_invalid_tool_json_and_missing_choices(self) -> None:
        with self.assertRaises(ProviderError):
            parse_chat_completion({"choices": [{"message": {"tool_calls": [{
                "id": "x", "function": {"name": "tool", "arguments": "not json"},
            }]}}]})
        with self.assertRaises(ProviderError):
            parse_chat_completion({"choices": []})

    def test_provider_sends_configured_model_and_bearer_key(self) -> None:
        settings = ProviderSettings("test", "openai_compatible", "http://127.0.0.1:8000/v1", "STX_TEST_KEY", 2, True)
        profile = ModelProfile("default", "test", "test-model")
        with patch.dict("os.environ", {"STX_TEST_KEY": "secret-test-key"}):
            provider = OpenAICompatibleProvider(settings, profile)
        payload = {
            "choices": [{"message": {"role": "assistant", "content": "hello"}, "finish_reason": "stop"}],
            "model": "test-model",
        }
        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["auth"] = request.get_header("Authorization")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _Response(payload)

        with patch("stx_agent.providers.openai_compatible.urlopen", fake_urlopen):
            result = provider.complete([{"role": "user", "content": "hi"}], [])
        self.assertEqual(captured["url"], "http://127.0.0.1:8000/v1/chat/completions")
        self.assertEqual(captured["auth"], "Bearer secret-test-key")
        self.assertEqual(captured["body"]["model"], "test-model")
        self.assertEqual(captured["timeout"], 2)
        self.assertEqual(result.content, "hello")

    def test_local_openai_compatible_endpoint_round_trip(self) -> None:
        observed = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                observed["path"] = self.path
                length = int(self.headers.get("Content-Length", "0"))
                observed["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
                payload = json.dumps({
                    "model": "local-test",
                    "choices": [{
                        "message": {"role": "assistant", "content": "local response"},
                        "finish_reason": "stop",
                    }],
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            settings = ProviderSettings(
                "local", "openai_compatible", f"http://127.0.0.1:{server.server_port}/v1", timeout_seconds=3
            )
            profile = ModelProfile("default", "local", "local-test")
            provider = OpenAICompatibleProvider(settings, profile)
            result = provider.complete([{"role": "user", "content": "hello"}], [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(result.content, "local response")
        self.assertEqual(observed["path"], "/v1/chat/completions")
        self.assertEqual(observed["body"]["model"], "local-test")

    def test_required_missing_api_key_fails_before_network(self) -> None:
        settings = ProviderSettings("test", "openai_compatible", "https://example.invalid/v1", "STX_MISSING_KEY", 5, True)
        profile = ModelProfile("default", "test", "model")
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ProviderError, "STX_MISSING_KEY"):
                OpenAICompatibleProvider(settings, profile)

    def test_remote_http_is_rejected_unless_explicitly_allowed(self) -> None:
        profile = ModelProfile("default", "test", "model")
        settings = ProviderSettings("test", "openai_compatible", "http://api.example.invalid/v1")
        with self.assertRaisesRegex(ProviderError, "non-loopback HTTP"):
            OpenAICompatibleProvider(settings, profile)
        allowed_settings = ProviderSettings(
            "test", "openai_compatible", "http://api.example.invalid/v1", allow_insecure_http=True
        )
        self.assertIsInstance(OpenAICompatibleProvider(allowed_settings, profile), OpenAICompatibleProvider)


if __name__ == "__main__":
    unittest.main()
