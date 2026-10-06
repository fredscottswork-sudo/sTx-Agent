from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from stx_agent.agent import Agent
from stx_agent.config import AppConfig, ModelProfile
from stx_agent.providers.base import ProviderResponse, ToolCall
from stx_agent.tools import build_default_registry
from stx_agent.workspace import Workspace
from stx_agent.policy import PermissionMode


class ScriptedProvider:
    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []

    def complete(self, messages, tools):
        self.calls.append((list(messages), list(tools)))
        if not self.turns:
            raise AssertionError("fake provider ran out of scripted responses")
        return self.turns.pop(0)


def tool_turn(call_id: str, name: str, arguments: dict) -> ProviderResponse:
    call = ToolCall(call_id, name, arguments)
    return ProviderResponse(
        content=None,
        tool_calls=[call],
        assistant_message={
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": "{}"},
            }],
        },
    )


def text_turn(content: str) -> ProviderResponse:
    return ProviderResponse(content, [], {"role": "assistant", "content": content})


class AgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace(self.temp.name)
        self.profile = ModelProfile("default", "fake", "unit-model")
        self.config = AppConfig(
            autonomy="assisted",
            default_profile="default",
            max_tool_steps=3,
            profiles={"default": self.profile},
            permissions={
                "filesystem.read": PermissionMode.ALLOW,
                "filesystem.write": PermissionMode.ALLOW,
                "filesystem.read_sensitive": PermissionMode.DENY,
                "terminal.execute": PermissionMode.CONFIRM,
                "git.read": PermissionMode.ALLOW,
            },
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def build(self, provider, *, dry_run=False, approval=None, events=None):
        return Agent(
            config=self.config,
            workspace=self.workspace,
            tools=build_default_registry(),
            provider_factory=lambda profile: provider,
            dry_run=dry_run,
            approval=approval,
            event_sinks=[events] if events is not None else None,
        )

    def test_loop_executes_tool_observes_result_then_returns_final_answer(self) -> None:
        provider = ScriptedProvider([
            tool_turn("call-1", "workspace.write_file", {"path": "result.txt", "content": "verified\n"}),
            text_turn("I wrote result.txt. No tests were run."),
        ])
        events = []
        result = self.build(provider, events=events.append).run("Create result.txt")
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.tool_calls, 1)
        self.assertEqual(result.model_turns, 2)
        self.assertEqual((Path(self.temp.name) / "result.txt").read_text(encoding="utf-8"), "verified\n")
        self.assertEqual(result.answer, "I wrote result.txt. No tests were run.")
        self.assertNotIn(self.temp.name, provider.calls[0][0][1]["content"])
        tool_message = provider.calls[1][0][-1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertIn('"ok":true', tool_message["content"])
        self.assertTrue(any(event.event_type == "tool.completed" for event in events))

    def test_tool_denial_is_returned_to_model_without_side_effect(self) -> None:
        provider = ScriptedProvider([
            tool_turn("call-1", "terminal.run", {"argv": ["echo", "no"]}),
            text_turn("The terminal action was denied; nothing was executed."),
        ])
        result = self.build(provider).run("Run an unapproved command")
        self.assertEqual(result.status, "completed")
        self.assertFalse(result.tools[0].ok)
        self.assertIn("requires confirmation", provider.calls[1][0][-1]["content"].lower())

    def test_dry_run_previews_write_and_does_not_change_disk(self) -> None:
        provider = ScriptedProvider([
            tool_turn("call-1", "workspace.write_file", {"path": "preview.txt", "content": "planned\n"}),
            text_turn("The write is only a proposal."),
        ])
        result = self.build(provider, dry_run=True).run("Create preview.txt")
        self.assertEqual(result.status, "completed")
        self.assertFalse((Path(self.temp.name) / "preview.txt").exists())
        self.assertIn('"written":false', provider.calls[1][0][-1]["content"])

    def test_step_budget_stops_without_claiming_completion(self) -> None:
        self.config = AppConfig(
            autonomy=self.config.autonomy,
            default_profile=self.config.default_profile,
            max_tool_steps=1,
            profiles=self.config.profiles,
            permissions=self.config.permissions,
        )
        provider = ScriptedProvider([
            tool_turn("call-1", "workspace.inspect", {}),
            tool_turn("call-2", "workspace.inspect", {}),
        ])
        result = self.build(provider).run("Inspect this project")
        self.assertEqual(result.status, "step_limit")
        self.assertEqual(result.tool_calls, 1)
        self.assertIn("No final verification response", result.answer)

    def test_provider_usage_is_preserved(self) -> None:
        final = ProviderResponse("done", [], {"role": "assistant", "content": "done"}, usage={"total_tokens": 9})
        result = self.build(ScriptedProvider([final])).run("Explain")
        self.assertEqual(result.usage["total_tokens"], 9)

    def test_denied_workspace_read_does_not_auto_index_or_send_summary(self) -> None:
        source = Path(self.temp.name) / "private_source.py"
        source.write_text("sensitive workspace detail", encoding="utf-8")
        self.config = AppConfig(
            autonomy=self.config.autonomy,
            default_profile=self.config.default_profile,
            max_tool_steps=self.config.max_tool_steps,
            profiles=self.config.profiles,
            permissions={"filesystem.read": PermissionMode.DENY},
        )
        provider = ScriptedProvider([text_turn("No workspace was read." )])
        self.build(provider).run("Summarize this project")
        context_text = "\n".join(str(message.get("content", "")) for message in provider.calls[0][0])
        self.assertNotIn("private_source.py", context_text)
        self.assertNotIn("sensitive workspace detail", context_text)
        self.assertFalse((Path(self.temp.name) / ".stx").exists())

    def test_agent_retrieves_relevant_code_and_explicit_memory(self) -> None:
        from stx_agent.memory import MemoryStore

        source = Path(self.temp.name) / "checkout.py"
        source.write_text(
            "def checkout_order(cart_id, idempotency_key):\n    return cart_id\n",
            encoding="utf-8",
        )
        MemoryStore(self.workspace).remember(
            "Checkout retries must reuse the same idempotency key.",
            category="decision", tags=["checkout"],
        )
        self.config = AppConfig(
            autonomy=self.config.autonomy,
            default_profile=self.config.default_profile,
            max_tool_steps=self.config.max_tool_steps,
            profiles=self.config.profiles,
            permissions={**self.config.permissions, "memory.read": PermissionMode.ALLOW},
        )
        provider = ScriptedProvider([text_turn("The code and saved decision were retrieved." )])
        self.build(provider).run("Explain checkout retries")
        context_text = "\n".join(str(message.get("content", "")) for message in provider.calls[0][0])
        self.assertIn("checkout_order", context_text)
        self.assertIn("idempotency key", context_text)

    def test_provider_failure_emits_metadata_and_propagates(self) -> None:
        class FailedProvider:
            def complete(self, messages, tools):
                from stx_agent.errors import ProviderError
                raise ProviderError("offline")

        events = []
        with self.assertRaisesRegex(Exception, "offline"):
            self.build(FailedProvider(), events=events.append).run("Explain")
        event_types = [event.event_type for event in events]
        self.assertIn("model.failed", event_types)
        self.assertIn("run.failed", event_types)


if __name__ == "__main__":
    unittest.main()
