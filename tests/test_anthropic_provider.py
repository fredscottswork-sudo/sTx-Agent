from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading
from unittest.mock import patch
import unittest

from stx_agent.config import AppConfig, ModelProfile, ProviderSettings
from stx_agent.errors import ConfigError, ProviderError
from stx_agent.runtime import provider_factory
from stx_agent.providers.anthropic import (
    AnthropicProvider,
    parse_anthropic_message,
    translate_messages,
    translate_tools,
)
from stx_agent.providers.openai_compatible import OpenAICompatibleProvider


class AnthropicProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile = ModelProfile("default", "anthropic", "claude-test")

    def test_translates_system_assistant_tool_calls_and_tool_results(self) -> None:
        messages = [
            {"role": "system", "content": "base instructions"},
            {"role": "system", "content": "untrusted repository excerpts"},
            {"role": "user", "content": "inspect this file"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "workspace.read_file", "arguments": '{"path":"README.md"}'},
                }],
            },
            {"role": "tool", "tool_call_id": "call-1", "name": "workspace.read_file", "content": "{\"ok\":true}"},
        ]
        system, translated = translate_messages(messages)
        self.assertEqual(system, "base instructions\n\nuntrusted repository excerpts")
        self.assertEqual([item["role"] for item in translated], ["user", "assistant", "user"])
        self.assertEqual(translated[1]["content"][0]["type"], "tool_use")
        self.assertEqual(translated[1]["content"][0]["input"], {"path": "README.md"})
        self.assertEqual(translated[2]["content"][0]["type"], "tool_result")
        self.assertEqual(translated[2]["content"][0]["tool_use_id"], "call-1")

    def test_translates_openai_shaped_tool_schemas(self) -> None:
        tool = {
            "type": "function",
            "function": {
                "name": "workspace.read_file",
                "description": "Read a workspace file.",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
            },
        }
        self.assertEqual(translate_tools([tool]), [{
            "name": "workspace.read_file",
            "description": "Read a workspace file.",
            "input_schema": tool["function"]["parameters"],
        }])

    def test_parses_text_tool_calls_and_usage(self) -> None:
        response = parse_anthropic_message({
            "id": "msg-1",
            "model": "claude-test",
            "stop_reason": "tool_use",
            "content": [
                {"type": "text", "text": "I will inspect that file."},
                {"type": "tool_use", "id": "tool-1", "name": "workspace.read_file", "input": {"path": "README.md"}},
            ],
            "usage": {"input_tokens": 42, "output_tokens": 9},
        })
        self.assertEqual(response.content, "I will inspect that file.")
        self.assertEqual(response.tool_calls[0].arguments, {"path": "README.md"})
        self.assertEqual(response.assistant_message["tool_calls"][0]["id"], "tool-1")
        self.assertEqual(response.model, "claude-test")
        self.assertEqual(response.usage["input_tokens"], 42)

    def test_rejects_malformed_messages_and_tool_blocks(self) -> None:
        with self.assertRaisesRegex(ProviderError, "missing an id or name"):
            translate_messages([{"role": "assistant", "tool_calls": [{"function": {"name": "x"}}]}])
        with self.assertRaisesRegex(ProviderError, "must be an array"):
            parse_anthropic_message({"content": "not an array"})
        with self.assertRaisesRegex(ProviderError, "must be an object"):
            parse_anthropic_message({"content": [{"type": "tool_use", "id": "t", "name": "x", "input": []}]})
        with self.assertRaisesRegex(ProviderError, "Non-text user content"):
            translate_messages([{"role": "user", "content": [{"type": "image", "source": {}}]}])

    def test_local_anthropic_endpoint_round_trip(self) -> None:
        observed: dict[str, object] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                observed["path"] = self.path
                observed["api_key"] = self.headers.get("x-api-key")
                observed["authorization"] = self.headers.get("Authorization")
                observed["version"] = self.headers.get("anthropic-version")
                length = int(self.headers.get("Content-Length", "0"))
                observed["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
                payload = json.dumps({
                    "id": "msg-local",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-test",
                    "content": [{"type": "tool_use", "id": "tool-local", "name": "workspace.read_file", "input": {"path": "README.md"}}],
                    "stop_reason": "tool_use",
                    "usage": {"input_tokens": 17, "output_tokens": 4},
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format, *args) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        settings = ProviderSettings(
            "anthropic", "anthropic", f"http://127.0.0.1:{server.server_port}/v1",
            api_key_env="STX_TEST_ANTHROPIC_KEY", timeout_seconds=3, require_api_key=True,
        )
        messages = [
            {"role": "system", "content": "Only use tools according to policy."},
            {"role": "user", "content": "Read README."},
        ]
        tools = [{
            "type": "function",
            "function": {"name": "workspace.read_file", "description": "Read a file.", "parameters": {"type": "object", "properties": {}}},
        }]
        try:
            with patch.dict(os.environ, {"STX_TEST_ANTHROPIC_KEY": "local-test-key"}):
                provider = AnthropicProvider(settings, self.profile)
            result = provider.complete(messages, tools)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(result.tool_calls[0].name, "workspace.read_file")
        self.assertEqual(result.usage["output_tokens"], 4)
        self.assertEqual(observed["path"], "/v1/messages")
        self.assertEqual(observed["api_key"], "local-test-key")
        self.assertIsNone(observed["authorization"])
        self.assertEqual(observed["version"], "2023-06-01")
        body = observed["body"]
        self.assertEqual(body["model"], "claude-test")
        self.assertEqual(body["max_tokens"], 4096)
        self.assertEqual(body["system"], "Only use tools according to policy.")
        self.assertEqual(body["tools"][0]["name"], "workspace.read_file")

    def test_both_adapters_refuse_endpoint_redirects(self) -> None:
        destination_hits: list[str] = []

        class DestinationHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                destination_hits.append("unexpected")
                self.send_response(200)
                self.end_headers()

            def log_message(self, format, *args) -> None:
                return

        destination = ThreadingHTTPServer(("127.0.0.1", 0), DestinationHandler)
        destination_thread = threading.Thread(target=destination.serve_forever, daemon=True)
        destination_thread.start()

        def make_redirect_handler():
            location = f"http://127.0.0.1:{destination.server_port}/collect"

            class RedirectHandler(BaseHTTPRequestHandler):
                def do_POST(self) -> None:
                    self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    self.send_response(302)
                    self.send_header("Location", location)
                    self.send_header("Content-Length", "0")
                    self.end_headers()

                def log_message(self, format, *args) -> None:
                    return

            return RedirectHandler

        source_servers: list[ThreadingHTTPServer] = []
        source_threads: list[threading.Thread] = []
        try:
            for kind, adapter in (("openai_compatible", OpenAICompatibleProvider), ("anthropic", AnthropicProvider)):
                source = ThreadingHTTPServer(("127.0.0.1", 0), make_redirect_handler())
                source_thread = threading.Thread(target=source.serve_forever, daemon=True)
                source_thread.start()
                source_servers.append(source)
                source_threads.append(source_thread)
                settings = ProviderSettings(
                    "test", kind, f"http://127.0.0.1:{source.server_port}/v1",
                    api_key_env="STX_REDIRECT_TEST_KEY", timeout_seconds=3, require_api_key=True,
                )
                profile = ModelProfile("default", "test", "test-model")
                with patch.dict(os.environ, {"STX_REDIRECT_TEST_KEY": "must-not-follow"}):
                    provider = adapter(settings, profile)
                    with self.assertRaisesRegex(ProviderError, "HTTP 302"):
                        provider.complete([{"role": "user", "content": "private prompt"}], [])
            self.assertEqual(destination_hits, [])
        finally:
            for source, source_thread in zip(source_servers, source_threads):
                source.shutdown()
                source.server_close()
                source_thread.join(timeout=2)
            destination.shutdown()
            destination.server_close()
            destination_thread.join(timeout=2)

    def test_requires_key_rejects_insecure_remote_http_and_unsupported_temperature(self) -> None:
        settings = ProviderSettings("anthropic", "anthropic", "https://api.anthropic.com/v1", "STX_MISSING", require_api_key=True)
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ProviderError, "STX_MISSING"):
                AnthropicProvider(settings, self.profile)
        with self.assertRaisesRegex(ProviderError, "non-loopback HTTP"):
            AnthropicProvider(ProviderSettings("anthropic", "anthropic", "http://api.example.invalid/v1"), self.profile)
        with self.assertRaisesRegex(ProviderError, "temperature must be from 0 to 1"):
            AnthropicProvider(
                ProviderSettings("anthropic", "anthropic", "https://api.anthropic.com/v1"),
                ModelProfile("default", "anthropic", "claude-test", temperature=1.5),
            )

    def test_runtime_selects_native_anthropic_adapter(self) -> None:
        config = AppConfig(
            providers={"anthropic": ProviderSettings("anthropic", "anthropic", "https://api.anthropic.com/v1")},
            profiles={"default": self.profile},
        )
        self.assertIsInstance(provider_factory(config)(self.profile), AnthropicProvider)
        unsupported = ModelProfile("unsupported", "other", "model")
        with self.assertRaisesRegex(ConfigError, "Supported kinds"):
            provider_factory(AppConfig(
                providers={"other": ProviderSettings("other", "unsupported", "https://example.invalid/v1")},
                profiles={"unsupported": unsupported},
            ))(unsupported)


if __name__ == "__main__":
    unittest.main()
