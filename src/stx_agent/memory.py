"""Explicit, local, expiring project memory backed by SQLite.

Nothing is persisted automatically. The agent can only write memories by calling a
policy-gated memory tool, and expired records are purged during access.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

from .workspace import Workspace

MEMORY_CATEGORIES = {"project", "decision", "preference", "error", "episode", "working"}


@dataclass(frozen=True)
class MemoryItem:
    memory_id: str
    category: str
    content: str
    importance: float
    created_at: float
    expires_at: float
    tags: list[str]

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.memory_id,
            "category": self.category,
            "content": self.content,
            "importance": self.importance,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "tags": self.tags,
        }


class MemoryStore:
    def __init__(self, workspace: Workspace, *, retention_days: int = 180) -> None:
        if not 1 <= retention_days <= 3650:
            raise ValueError("retention_days must be from 1 to 3650")
        self.workspace = workspace
        self.retention_days = retention_days
        self.directory = workspace.root / ".stx"
        self.database = self.directory / "memory.sqlite3"
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.directory, 0o700)
        except OSError:
            pass
        with self._connection() as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    content TEXT NOT NULL,
                    importance REAL NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    tags_json TEXT NOT NULL
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS memories_expiry_idx ON memories(expires_at)")
        try:
            os.chmod(self.database, 0o600)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
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

    def _purge_expired(self, connection: sqlite3.Connection, now: float) -> None:
        connection.execute("DELETE FROM memories WHERE expires_at <= ?", (now,))

    def remember(
        self,
        content: str,
        *,
        category: str = "project",
        importance: float = 0.5,
        ttl_days: int | None = None,
        tags: list[str] | None = None,
    ) -> MemoryItem:
        if category not in MEMORY_CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(sorted(MEMORY_CATEGORIES))}")
        if not isinstance(content, str) or not content.strip() or len(content) > 8_000:
            raise ValueError("memory content must contain 1 to 8000 characters")
        if isinstance(importance, bool) or not isinstance(importance, (int, float)) or not 0 <= importance <= 1:
            raise ValueError("importance must be between 0 and 1")
        ttl = self.retention_days if ttl_days is None else ttl_days
        if isinstance(ttl, bool) or not isinstance(ttl, int) or not 1 <= ttl <= 3650:
            raise ValueError("ttl_days must be from 1 to 3650")
        clean_tags = []
        for tag in tags or []:
            value = str(tag).strip().lower()[:64]
            if value and value not in clean_tags:
                clean_tags.append(value)
        clean_tags = clean_tags[:20]
        now = time.time()
        memory_id = uuid.uuid4().hex
        expires = now + ttl * 86400
        with self._connection() as connection:
            self._purge_expired(connection, now)
            connection.execute(
                "INSERT INTO memories(id,category,content,importance,created_at,expires_at,tags_json) VALUES(?,?,?,?,?,?,?)",
                (memory_id, category, content.strip(), float(importance), now, expires, json.dumps(clean_tags)),
            )
        return MemoryItem(memory_id, category, content.strip(), float(importance), now, expires, clean_tags)

    def search(self, query: str, *, limit: int = 10) -> list[MemoryItem]:
        if not 1 <= limit <= 50:
            raise ValueError("memory search limit must be from 1 to 50")
        tokens = {token.lower() for token in query.split() if len(token) >= 2}
        now = time.time()
        with self._connection() as connection:
            self._purge_expired(connection, now)
            rows = connection.execute(
                "SELECT id,category,content,importance,created_at,expires_at,tags_json "
                "FROM memories WHERE expires_at > ? ORDER BY importance DESC, created_at DESC LIMIT 500",
                (now,),
            ).fetchall()
        ranked: list[tuple[float, MemoryItem]] = []
        for row in rows:
            tags = json.loads(row["tags_json"])
            haystack = f"{row['category']} {row['content']} {' '.join(tags)}".lower()
            matched = sum(1 for token in tokens if token in haystack)
            if tokens and matched == 0:
                continue
            age_days = max(0.0, (now - float(row["created_at"])) / 86400)
            recency = 1.0 / (1.0 + age_days / 30.0)
            score = matched * 2 + float(row["importance"]) + recency
            item = MemoryItem(
                row["id"], row["category"], row["content"], float(row["importance"]),
                float(row["created_at"]), float(row["expires_at"]), tags,
            )
            ranked.append((score, item))
        ranked.sort(key=lambda pair: (-pair[0], -pair[1].created_at))
        return [item for _, item in ranked[:limit]]

    def list(self, *, limit: int = 50) -> list[MemoryItem]:
        if not 1 <= limit <= 100:
            raise ValueError("memory list limit must be from 1 to 100")
        now = time.time()
        with self._connection() as connection:
            self._purge_expired(connection, now)
            rows = connection.execute(
                "SELECT id,category,content,importance,created_at,expires_at,tags_json "
                "FROM memories WHERE expires_at > ? ORDER BY created_at DESC LIMIT ?",
                (now, limit),
            ).fetchall()
        return [MemoryItem(
            row["id"], row["category"], row["content"], float(row["importance"]),
            float(row["created_at"]), float(row["expires_at"]), json.loads(row["tags_json"]),
        ) for row in rows]

    def forget(self, memory_id: str) -> bool:
        with self._connection() as connection:
            cursor = connection.execute("DELETE FROM memories WHERE id=?", (memory_id,))
            return cursor.rowcount > 0
