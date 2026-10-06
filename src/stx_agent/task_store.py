"""Local SQLite persistence for the dashboard's durable task and approval records."""

from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import uuid
from typing import Any

from .workspace import Workspace

_ACTIVE = {"queued", "running", "awaiting_approval", "cancelling"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskStore:
    def __init__(self, workspace: Workspace, *, retention_days: int = 90, max_records: int = 2_000) -> None:
        if not 1 <= retention_days <= 3650 or not 10 <= max_records <= 100_000:
            raise ValueError("invalid task retention settings")
        self.workspace = workspace
        self.retention_days = retention_days
        self.max_records = max_records
        self.directory = workspace.root / ".stx"
        self.database = self.directory / "tasks.sqlite3"
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.directory, 0o700)
        except OSError:
            pass
        with self._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    instruction TEXT NOT NULL,
                    requested_profile TEXT,
                    status TEXT NOT NULL,
                    answer TEXT,
                    error TEXT,
                    dry_run INTEGER NOT NULL DEFAULT 0,
                    model_turns INTEGER NOT NULL DEFAULT 0,
                    tool_calls INTEGER NOT NULL DEFAULT 0,
                    last_event TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS tasks_created_idx ON tasks(created_at DESC);
                CREATE TABLE IF NOT EXISTS approvals (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    tool_name TEXT NOT NULL,
                    capability TEXT NOT NULL,
                    risk TEXT NOT NULL,
                    details TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS approvals_task_idx ON approvals(task_id, status);
            """)
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("UPDATE tasks SET status='interrupted', updated_at=? WHERE status IN ('queued','running','awaiting_approval','cancelling')", (_now(),))
            connection.execute("UPDATE approvals SET status='interrupted', updated_at=? WHERE status='pending'", (_now(),))
            self._prune(connection)
        try:
            os.chmod(self.database, 0o600)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _prune(self, connection: sqlite3.Connection) -> None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=self.retention_days)).isoformat()
        active = tuple(_ACTIVE)
        placeholders = ",".join("?" for _ in active)
        connection.execute(
            f"DELETE FROM tasks WHERE status NOT IN ({placeholders}) AND updated_at < ?",
            (*active, cutoff),
        )
        connection.execute(
            f"DELETE FROM tasks WHERE id IN (SELECT id FROM tasks WHERE status NOT IN ({placeholders}) "
            "ORDER BY created_at DESC LIMIT -1 OFFSET ?)",
            (*active, self.max_records),
        )

    def create(self, instruction: str, requested_profile: str | None = None, *, dry_run: bool = False) -> dict[str, Any]:
        task_id, now = uuid.uuid4().hex, _now()
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO tasks(id,instruction,requested_profile,status,dry_run,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)",
                (task_id, instruction, requested_profile, int(dry_run), now, now),
            )
            self._prune(connection)
        return self.get(task_id)  # type: ignore[return-value]

    def update(self, task_id: str, **fields: Any) -> bool:
        allowed = {"status", "answer", "error", "model_turns", "tool_calls", "last_event"}
        values = {key: value for key, value in fields.items() if key in allowed}
        if isinstance(values.get("answer"), str) and len(values["answer"]) > 100_000:
            values["answer"] = values["answer"][:100_000] + "\n[stored answer truncated at 100000 characters]"
        if isinstance(values.get("error"), str):
            values["error"] = values["error"][:2_000]
        if not values:
            return self.get(task_id) is not None
        values["updated_at"] = _now()
        if "last_event" in values and not isinstance(values["last_event"], (str, type(None))):
            values["last_event"] = json.dumps(values["last_event"], ensure_ascii=False)
        clause = ",".join(f"{key}=?" for key in values)
        with self._connection() as connection:
            cursor = connection.execute(
                f"UPDATE tasks SET {clause} WHERE id=?", (*values.values(), task_id)
            )
            if values.get("status") not in (None, *_ACTIVE):
                self._prune(connection)
            return cursor.rowcount > 0

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            task["dry_run"] = bool(task["dry_run"])
            if task.get("last_event"):
                try:
                    task["last_event"] = json.loads(task["last_event"])
                except (TypeError, json.JSONDecodeError):
                    pass
            task["approvals"] = [dict(item) for item in connection.execute(
                "SELECT id,task_id,tool_name,capability,risk,details,status,created_at,updated_at "
                "FROM approvals WHERE task_id=? ORDER BY created_at", (task_id,),
            ).fetchall()]
            return task

    def list(self, *, limit: int = 50) -> list[dict[str, Any]]:
        if not 1 <= limit <= 100:
            raise ValueError("task list limit must be from 1 to 100")
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT id,substr(instruction,1,240) AS instruction,requested_profile,status,dry_run,"
                "model_turns,tool_calls,last_event,created_at,updated_at "
                "FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            tasks = []
            for row in rows:
                item = dict(row)
                item["dry_run"] = bool(item["dry_run"])
                if item.get("last_event"):
                    try:
                        item["last_event"] = json.loads(item["last_event"])
                    except (TypeError, json.JSONDecodeError):
                        pass
                tasks.append(item)
            return tasks

    def request_cancel(self, task_id: str) -> bool:
        active = tuple(_ACTIVE)
        placeholders = ",".join("?" for _ in active)
        with self._connection() as connection:
            cursor = connection.execute(
                f"UPDATE tasks SET status='cancelling',updated_at=? WHERE id=? AND status IN ({placeholders})",
                (_now(), task_id, *active),
            )
            return cursor.rowcount > 0

    def unfinished_count(self) -> int:
        placeholders = ",".join("?" for _ in _ACTIVE)
        with self._connection() as connection:
            return int(connection.execute(
                f"SELECT COUNT(*) FROM tasks WHERE status IN ({placeholders})", tuple(_ACTIVE)
            ).fetchone()[0])

    def create_approval(self, task_id: str, request) -> str:
        approval_id, now = uuid.uuid4().hex, _now()
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO approvals(id,task_id,tool_name,capability,risk,details,status,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,'pending',?,?)",
                (approval_id, task_id, request.tool_name, request.capability,
                 request.risk.name.lower(), request.details, now, now),
            )
        return approval_id

    def resolve_approval(self, task_id: str, approval_id: str, approved: bool) -> bool:
        status, now = ("approved" if approved else "denied"), _now()
        with self._connection() as connection:
            cursor = connection.execute(
                "UPDATE approvals SET status=?, updated_at=? WHERE id=? AND task_id=? AND status='pending'",
                (status, now, approval_id, task_id),
            )
            return cursor.rowcount > 0

    def approval_status(self, approval_id: str) -> str | None:
        with self._connection() as connection:
            row = connection.execute("SELECT status FROM approvals WHERE id=?", (approval_id,)).fetchone()
            return str(row[0]) if row else None

    def close_pending_approvals(self, task_id: str, status: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE approvals SET status=?, updated_at=? WHERE task_id=? AND status='pending'",
                (status, _now(), task_id),
            )
