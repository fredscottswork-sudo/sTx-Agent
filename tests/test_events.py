from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

from stx_agent.events import JsonlEventRecorder, RunEvent
from stx_agent.tools.base import ToolResult
from stx_agent.tools.registry import ToolRegistry


class EventAndSerializationTests(unittest.TestCase):
    def test_event_recorder_writes_private_metadata_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "runs"
            recorder = JsonlEventRecorder(directory, "run-1")
            recorder(RunEvent("tool.completed", "run-1", {"name": "git.status", "ok": True}))
            path = directory / "run-1.jsonl"
            record = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(record["type"], "tool.completed")
            self.assertEqual(record["name"], "git.status")
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_oversized_tool_text_is_truncated_not_fully_dropped(self) -> None:
        serialized = ToolRegistry().serialize_result(ToolResult.success({"stdout": "x" * 100_000}))
        self.assertLessEqual(len(serialized), 64_000)
        payload = json.loads(serialized)
        self.assertIn("tool output truncated", payload["data"]["stdout"])


if __name__ == "__main__":
    unittest.main()
