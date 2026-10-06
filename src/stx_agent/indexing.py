"""Incremental local project metadata index and relevance-ranked context retrieval.

The index stores paths, hashes, and extracted symbol signatures in SQLite. It does
not duplicate source contents; bounded snippets are read from the workspace only
when the agent needs relevant context.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import time
from typing import Any

from .errors import WorkspaceError
from .workspace import Workspace

_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{1,63}")
_STOP_WORDS = {
    "about", "after", "all", "also", "and", "are", "before", "build", "can", "change",
    "code", "create", "does", "file", "fix", "for", "from", "have", "into", "issue",
    "make", "need", "not", "project", "should", "that", "the", "then", "this", "with",
}
_LANGUAGES = {
    ".py": "python", ".pyi": "python", ".js": "javascript", ".jsx": "javascript",
    ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".tsx": "typescript",
    ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".swift": "swift",
    ".cs": "csharp", ".cpp": "cpp", ".cc": "cpp", ".c": "c", ".h": "c",
    ".hpp": "cpp", ".php": "php", ".rb": "ruby", ".md": "markdown", ".toml": "toml",
    ".yaml": "yaml", ".yml": "yaml", ".json": "json", ".sql": "sql", ".sh": "shell",
}
_GENERIC_SYMBOLS = {
    "javascript": re.compile(r"\b(?:function|class)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
    "typescript": re.compile(r"\b(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
    "go": re.compile(r"\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(|\btype\s+([A-Za-z_][\w]*)\s+(?:struct|interface)"),
    "rust": re.compile(r"\b(?:fn|struct|enum|trait|type)\s+([A-Za-z_][\w]*)"),
    "java": re.compile(r"\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)|\b(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\], ?]+\s+([A-Za-z_$][\w$]*)\s*\("),
}


@dataclass(frozen=True)
class IndexSummary:
    files_seen: int
    indexed: int
    unchanged: int
    skipped_large: int
    skipped_binary: int
    removed: int
    symbols: int
    truncated: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "files_seen": self.files_seen,
            "indexed": self.indexed,
            "unchanged": self.unchanged,
            "skipped_large": self.skipped_large,
            "skipped_binary": self.skipped_binary,
            "removed": self.removed,
            "symbols": self.symbols,
            "truncated": self.truncated,
        }


class ProjectIndex:
    """A bounded, incremental SQLite inventory for one workspace."""

    def __init__(
        self,
        workspace: Workspace,
        *,
        max_files: int = 10_000,
        max_file_bytes: int = 512_000,
    ) -> None:
        if not 1 <= max_files <= 50_000:
            raise ValueError("max_files must be from 1 to 50000")
        if not 1_024 <= max_file_bytes <= 2_000_000:
            raise ValueError("max_file_bytes must be from 1024 to 2000000")
        self.workspace = workspace
        self.max_files = max_files
        self.max_file_bytes = max_file_bytes
        self.directory = workspace.root / ".stx"
        self.database = self.directory / "index.sqlite3"
        self._prepare()

    def _prepare(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.directory, 0o700)
        except OSError:
            pass
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS files (
                    path TEXT PRIMARY KEY,
                    digest TEXT NOT NULL,
                    mtime_ns INTEGER NOT NULL,
                    size INTEGER NOT NULL,
                    language TEXT NOT NULL,
                    indexed_at REAL NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS symbols (
                    path TEXT NOT NULL,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    line INTEGER NOT NULL,
                    signature TEXT NOT NULL,
                    FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS symbols_name_idx ON symbols(name)")
        try:
            os.chmod(self.database, 0o600)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
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

    @staticmethod
    def _extract_symbols(content: str, language: str) -> list[tuple[str, str, int, str]]:
        symbols: list[tuple[str, str, int, str]] = []
        if language == "python":
            try:
                tree = ast.parse(content)
            except (SyntaxError, ValueError):
                tree = None
            if tree is not None:
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        params = [item.arg for item in node.args.posonlyargs + node.args.args]
                        if node.args.vararg:
                            params.append("*" + node.args.vararg.arg)
                        params.extend(item.arg for item in node.args.kwonlyargs)
                        if node.args.kwarg:
                            params.append("**" + node.args.kwarg.arg)
                        kind = "async function" if isinstance(node, ast.AsyncFunctionDef) else "function"
                        signature = f"{node.name}({', '.join(params)})"
                        symbols.append((node.name, kind, node.lineno, signature))
                    elif isinstance(node, ast.ClassDef):
                        bases = ", ".join(ast.unparse(base) for base in node.bases[:5])
                        signature = f"class {node.name}" + (f"({bases})" if bases else "")
                        symbols.append((node.name, "class", node.lineno, signature))
                return sorted(symbols, key=lambda item: (item[2], item[0]))[:5000]

        matcher = _GENERIC_SYMBOLS.get(language)
        if matcher:
            for line_number, line in enumerate(content.splitlines(), start=1):
                match = matcher.search(line)
                if not match:
                    continue
                name = next((group for group in match.groups() if group), None)
                if name:
                    symbols.append((name, "symbol", line_number, line.strip()[:300]))
                    if len(symbols) >= 5000:
                        break
        return symbols

    def index(self, *, force: bool = False) -> IndexSummary:
        files, truncated = self.workspace._walk_files(self.workspace.root, max_files=self.max_files + 1)
        files = files[:self.max_files]
        indexed = unchanged = skipped_large = skipped_binary = removed = symbol_total = 0
        seen_paths: set[str] = set()
        connection = self._connect()
        try:
            with connection:
                for file_path in files:
                    relative = file_path.relative_to(self.workspace.root).as_posix()
                    seen_paths.add(relative)
                    try:
                        stat = file_path.stat()
                        if stat.st_size > self.max_file_bytes:
                            skipped_large += 1
                            connection.execute("DELETE FROM files WHERE path=?", (relative,))
                            continue
                        existing = connection.execute(
                            "SELECT digest, mtime_ns, size FROM files WHERE path=?", (relative,)
                        ).fetchone()
                        if not force and existing and existing["mtime_ns"] == stat.st_mtime_ns and existing["size"] == stat.st_size:
                            unchanged += 1
                            continue
                        with file_path.open("rb") as handle:
                            raw = handle.read(self.max_file_bytes + 1)
                        if len(raw) > self.max_file_bytes:
                            skipped_large += 1
                            connection.execute("DELETE FROM files WHERE path=?", (relative,))
                            continue
                        content = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        skipped_binary += 1
                        connection.execute("DELETE FROM files WHERE path=?", (relative,))
                        continue
                    except OSError:
                        continue

                    digest = hashlib.sha256(raw).hexdigest()
                    if not force and existing and existing["digest"] == digest:
                        connection.execute(
                            "UPDATE files SET mtime_ns=?, size=? WHERE path=?",
                            (stat.st_mtime_ns, stat.st_size, relative),
                        )
                        unchanged += 1
                        continue
                    language = _LANGUAGES.get(file_path.suffix.lower(), "text")
                    symbols = self._extract_symbols(content, language)
                    connection.execute(
                        "INSERT INTO files(path,digest,mtime_ns,size,language,indexed_at) VALUES(?,?,?,?,?,?) "
                        "ON CONFLICT(path) DO UPDATE SET digest=excluded.digest, mtime_ns=excluded.mtime_ns, "
                        "size=excluded.size, language=excluded.language, indexed_at=excluded.indexed_at",
                        (relative, digest, stat.st_mtime_ns, stat.st_size, language, time.time()),
                    )
                    connection.execute("DELETE FROM symbols WHERE path=?", (relative,))
                    connection.executemany(
                        "INSERT INTO symbols(path,name,kind,line,signature) VALUES(?,?,?,?,?)",
                        [(relative, name, kind, line, signature) for name, kind, line, signature in symbols],
                    )
                    indexed += 1
                    symbol_total += len(symbols)

                if not truncated:
                    connection.execute("CREATE TEMP TABLE IF NOT EXISTS scanned_paths(path TEXT PRIMARY KEY)")
                    connection.execute("DELETE FROM scanned_paths")
                    connection.executemany("INSERT INTO scanned_paths(path) VALUES(?)", [(path,) for path in seen_paths])
                    connection.execute("DELETE FROM files WHERE path NOT IN (SELECT path FROM scanned_paths)")
                    removed = int(connection.execute("SELECT changes()").fetchone()[0])
        finally:
            connection.close()
        total_symbols = self.symbol_count()
        return IndexSummary(len(files), indexed, unchanged, skipped_large, skipped_binary, removed, total_symbols, truncated)

    def symbol_count(self) -> int:
        with self._connection() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM symbols").fetchone()
            return int(row["count"])

    def search(self, query: str, *, limit: int = 20) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        if not 1 <= limit <= 100:
            raise ValueError("search limit must be from 1 to 100")
        tokens = [token.lower() for token in _TOKEN_RE.findall(query) if token.lower() not in _STOP_WORDS]
        if not tokens:
            tokens = [query.strip().lower()[:80]]
        scores: dict[str, dict[str, Any]] = {}

        def add(path: str, points: int, reason: str, symbol: dict[str, Any] | None = None) -> None:
            item = scores.setdefault(path, {"path": path, "score": 0, "reasons": set(), "symbols": [], "matches": []})
            item["score"] += points
            item["reasons"].add(reason)
            if symbol and len(item["symbols"]) < 12:
                item["symbols"].append(symbol)

        with self._connection() as connection:
            file_rows = connection.execute("SELECT path FROM files").fetchall()
            symbol_rows = connection.execute("SELECT path,name,kind,line,signature FROM symbols").fetchall()
        for row in file_rows:
            path = row["path"]
            folded = path.lower()
            for token in tokens:
                if token in folded:
                    add(path, 3, f"path contains '{token}'")
        for row in symbol_rows:
            folded_name = row["name"].lower()
            folded_signature = row["signature"].lower()
            matching = [token for token in tokens if token in folded_name or token in folded_signature]
            if matching:
                add(
                    row["path"], 5 * len(matching), "symbol/signature match",
                    {"name": row["name"], "kind": row["kind"], "line": row["line"], "signature": row["signature"]},
                )

        # Literal code matches contribute evidence even when a language parser is not available.
        text_terms = [token for token in tokens if len(token) >= 3][:4]
        for token in text_terms:
            try:
                result = self.workspace.search_text(token, limit=min(100, limit * 4))
            except WorkspaceError:
                continue
            for match in result["matches"]:
                add(match["path"], 2, f"text match '{token}'")
                item = scores[match["path"]]
                if len(item["matches"]) < 8:
                    item["matches"].append({"line": match["line"], "text": match["text"]})

        ranked = sorted(scores.values(), key=lambda item: (-item["score"], item["path"]))[:limit]
        return [
            {
                **item,
                "reasons": sorted(item["reasons"]),
            }
            for item in ranked
        ]

    def symbols(self, *, path: str | None = None, query: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        if not 1 <= limit <= 500:
            raise ValueError("symbol limit must be from 1 to 500")
        clauses: list[str] = []
        values: list[Any] = []
        if path:
            resolved = self.workspace.resolve(path, must_exist=True)
            relative = resolved.relative_to(self.workspace.root).as_posix()
            clauses.append("path=?")
            values.append(relative)
        if query:
            clauses.append("(lower(name) LIKE ? OR lower(signature) LIKE ?)")
            pattern = f"%{query.lower()[:100]}%"
            values.extend([pattern, pattern])
        sql = "SELECT path,name,kind,line,signature FROM symbols"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY path,line LIMIT ?"
        values.append(limit)
        with self._connection() as connection:
            rows = connection.execute(sql, values).fetchall()
        return [dict(row) for row in rows]

    def retrieve_context(
        self,
        task: str,
        *,
        max_files: int = 6,
        max_chars: int = 18_000,
        max_file_bytes: int = 64_000,
    ) -> list[dict[str, str]]:
        if max_files <= 0 or max_chars <= 0:
            return []
        results = self.search(task, limit=max_files)
        context: list[dict[str, str]] = []
        remaining = max_chars
        terms = [token.lower() for token in _TOKEN_RE.findall(task) if token.lower() not in _STOP_WORDS]
        for result in results:
            if remaining <= 0:
                break
            try:
                content_data = self.workspace.read_text(result["path"], max_bytes=max_file_bytes)
            except WorkspaceError:
                continue
            lines = content_data["content"].splitlines()
            if not lines:
                continue
            scored: list[tuple[int, int]] = []
            for index, line in enumerate(lines):
                line_folded = line.lower()
                score = sum(1 for term in terms if term in line_folded)
                if score:
                    scored.append((score, index))
            selected: set[int] = set()
            if scored:
                for _, index in sorted(scored, key=lambda item: (-item[0], item[1]))[:40]:
                    selected.update(range(max(0, index - 1), min(len(lines), index + 2)))
            else:
                selected.update(range(min(len(lines), 40)))
            excerpt = "\n".join(f"{index + 1}: {lines[index]}" for index in sorted(selected))
            excerpt = excerpt[:min(4_000, remaining)]
            if not excerpt:
                continue
            context.append({"path": result["path"], "content": excerpt, "reason": "; ".join(result["reasons"][:4])})
            remaining -= len(excerpt)
        return context
