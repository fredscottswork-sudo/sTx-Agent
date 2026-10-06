"""Structured, metadata-only run events and an opt-in local JSONL recorder."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class RunEvent:
    event_type: str
    run_id: str
    fields: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def as_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "run_id": self.run_id,
            "type": self.event_type,
            **self.fields,
        }


EventSink = Callable[[RunEvent], None]


class JsonlEventRecorder:
    """Append low-sensitivity event metadata to a private local JSONL file."""

    def __init__(self, directory: Path, run_id: str) -> None:
        self.directory = directory
        self.path = directory / f"{run_id}.jsonl"

    def __call__(self, event: RunEvent) -> None:
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        payload = (json.dumps(event.as_dict(), ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
        descriptor = os.open(self.path, flags, 0o600)
        try:
            try:
                if hasattr(os, "fchmod"):
                    os.fchmod(descriptor, 0o600)
                else:
                    os.chmod(self.path, 0o600)
            except OSError:
                pass
            view = memoryview(payload)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("Could not append complete event record.")
                view = view[written:]
        finally:
            os.close(descriptor)
