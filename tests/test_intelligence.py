from __future__ import annotations

from contextlib import closing
from pathlib import Path
import os
import sqlite3
import stat
import tempfile
import unittest

from stx_agent.config import MemorySettings
from stx_agent.indexing import ProjectIndex
from stx_agent.memory import MemoryStore
from stx_agent.policy import PermissionMode, Policy
from stx_agent.tools.base import ToolContext
from stx_agent.tools.intelligence import MemoryRememberTool
from stx_agent.tools.registry import ToolRegistry
from stx_agent.workspace import Workspace


class ProjectIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = Workspace(self.root)
        (self.root / "src").mkdir()
        (self.root / "src" / "checkout.py").write_text(
            "class CheckoutService:\n"
            "    def complete_order(self, order_id, retries=1):\n"
            "        return order_id\n\n"
            "async def load_checkout(cart_id):\n"
            "    return cart_id\n",
            encoding="utf-8",
        )
        (self.root / "README.md").write_text("Checkout application overview\n", encoding="utf-8")
        (self.root / ".env").write_text("API_KEY=must-not-be-indexed\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_index_extracts_python_symbols_and_skips_secrets(self) -> None:
        index = ProjectIndex(self.workspace)
        summary = index.index()
        self.assertGreaterEqual(summary.indexed, 2)
        self.assertGreaterEqual(summary.symbols, 3)
        symbols = index.symbols(path="src/checkout.py")
        names = {symbol["name"] for symbol in symbols}
        self.assertIn("CheckoutService", names)
        self.assertIn("complete_order", names)
        self.assertIn("load_checkout", names)
        results = index.search("checkout order")
        self.assertTrue(results)
        self.assertTrue(any(result["path"] == "src/checkout.py" for result in results))
        with closing(sqlite3.connect(index.database)) as connection:
            with connection:
                stored_paths = {row[0] for row in connection.execute("SELECT path FROM files")}
        self.assertNotIn(".env", stored_paths)

    def test_incremental_update_removal_and_context_retrieval(self) -> None:
        index = ProjectIndex(self.workspace)
        first = index.index()
        second = index.index()
        self.assertEqual(second.indexed, 0)
        self.assertGreaterEqual(second.unchanged, first.files_seen)
        (self.root / "src" / "checkout.py").write_text(
            "def process_refund(payment_id):\n    return payment_id\n", encoding="utf-8"
        )
        updated = index.index()
        self.assertEqual(updated.indexed, 1)
        self.assertTrue(index.symbols(query="process_refund"))
        (self.root / "README.md").unlink()
        removed = index.index()
        self.assertEqual(removed.removed, 1)
        context = index.retrieve_context("process refund payment", max_files=2, max_chars=3000)
        self.assertTrue(any(item["path"] == "src/checkout.py" for item in context))

    def test_file_limit_is_reported_without_deleting_unscanned_index_rows(self) -> None:
        index = ProjectIndex(self.workspace, max_files=1)
        result = index.index()
        self.assertTrue(result.truncated)


class MemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Workspace(self.temp.name)
        self.store = MemoryStore(self.workspace, retention_days=30)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_explicit_memory_persists_searches_and_can_be_forgotten(self) -> None:
        remembered = self.store.remember(
            "The checkout API uses idempotency keys for retries.",
            category="decision", importance=0.9, tags=["checkout", "api"],
        )
        reopened = MemoryStore(self.workspace, retention_days=30)
        results = reopened.search("checkout idempotency")
        self.assertEqual(results[0].memory_id, remembered.memory_id)
        self.assertEqual(results[0].category, "decision")
        self.assertTrue(reopened.forget(remembered.memory_id))
        self.assertFalse(reopened.forget(remembered.memory_id))
        self.assertEqual(reopened.search("checkout"), [])

    def test_read_only_memory_view_filters_expired_rows_without_purging(self) -> None:
        item = self.store.remember("Expired dashboard note", ttl_days=1)
        with closing(sqlite3.connect(self.store.database)) as connection:
            with connection:
                connection.execute("UPDATE memories SET expires_at=0 WHERE id=?", (item.memory_id,))
        before = {path.name for path in self.store.directory.iterdir()}
        self.assertEqual(MemoryStore.read_only_list(self.workspace), [])
        after = {path.name for path in self.store.directory.iterdir()}
        self.assertEqual(after, before)
        with closing(sqlite3.connect(self.store.database)) as connection:
            count = connection.execute("SELECT COUNT(*) FROM memories WHERE id=?", (item.memory_id,)).fetchone()[0]
        self.assertEqual(count, 1)

    def test_expired_memory_is_purged_and_database_is_private(self) -> None:
        item = self.store.remember("Short-lived note", ttl_days=1)
        with closing(sqlite3.connect(self.store.database)) as connection:
            with connection:
                connection.execute("UPDATE memories SET expires_at=0 WHERE id=?", (item.memory_id,))
        self.assertEqual(self.store.list(), [])
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.store.database.stat().st_mode), 0o600)

    def test_memory_dry_run_does_not_create_or_write_store(self) -> None:
        dry_root = Path(self.temp.name) / "dry-run-workspace"
        dry_root.mkdir()
        dry_workspace = Workspace(dry_root)
        tool = MemoryRememberTool(MemorySettings())
        context = ToolContext(
            dry_workspace,
            Policy({"memory.write": PermissionMode.CONFIRM}),
            dry_run=True,
        )
        result = ToolRegistry([tool]).execute("memory.remember", {"content": "a useful fact"}, context)
        self.assertTrue(result.ok)
        self.assertFalse(result.data["stored"])
        self.assertFalse((dry_workspace.root / ".stx").exists())

    def test_memory_rejects_invalid_category_and_credentials_like_content_is_not_special_cased(self) -> None:
        with self.assertRaises(ValueError):
            self.store.remember("text", category="unknown")
        with self.assertRaises(ValueError):
            self.store.remember("   ")


if __name__ == "__main__":
    unittest.main()
