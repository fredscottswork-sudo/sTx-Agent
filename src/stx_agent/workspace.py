"""Workspace-scoped filesystem access with conservative secret-file handling."""

from __future__ import annotations

from dataclasses import dataclass
import difflib
import os
from pathlib import Path
from typing import Any

from .errors import WorkspaceError

_IGNORED_DIRS = {
    ".git", ".stx", ".venv", "venv", "node_modules", "__pycache__", ".next",
    ".cache", ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build",
    "target", "coverage", "htmlcov",
}
_SECRET_NAMES = {
    "id_rsa", "id_ed25519", "credentials", "credentials.json", "secrets.json",
    ".npmrc", ".pypirc", ".netrc", ".git-credentials", "dockerconfig.json", "kubeconfig",
    "stx.config.toml",
}
_SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".env", ".token", ".secret"}
_SECRET_DIRS = {
    ".git", ".stx", ".ssh", ".aws", ".azure", ".gcloud", ".kube", "secrets", "credentials",
}
_TEXT_LIMIT_BYTES = 256 * 1024
_SEARCH_FILE_LIMIT = 2500
_MAX_DIFF_CHARS = 64_000
_MAX_DIFF_LINES = 1_500


def format_text_diff(old: str, new: str, *, from_file: str, to_file: str) -> str:
    """Create a small unified diff without pathological work on huge inputs."""
    if len(old) + len(new) > _MAX_DIFF_CHARS:
        return "[diff omitted: combined text exceeds the preview limit]\n"
    old_lines = old.splitlines(keepends=True)
    new_lines = new.splitlines(keepends=True)
    if len(old_lines) + len(new_lines) > _MAX_DIFF_LINES:
        return "[diff omitted: too many lines for a safe preview]\n"
    return "".join(difflib.unified_diff(old_lines, new_lines, fromfile=from_file, tofile=to_file))


@dataclass(frozen=True)
class Workspace:
    root: Path

    def __init__(self, root: Path | str) -> None:
        resolved = Path(root).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise WorkspaceError(f"Workspace is not a directory: {resolved}")
        object.__setattr__(self, "root", resolved)

    def resolve(self, path: str | Path, *, must_exist: bool = False) -> Path:
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            candidate = self.root / candidate
        try:
            resolved = candidate.resolve(strict=must_exist)
            resolved.relative_to(self.root)
        except (OSError, RuntimeError, ValueError) as exc:
            raise WorkspaceError(f"Path is outside the workspace or cannot be resolved: {path}") from exc
        return resolved

    @staticmethod
    def is_sensitive_path(path: Path) -> bool:
        name = path.name.lower()
        if name in _SECRET_NAMES or path.suffix.lower() in _SECRET_SUFFIXES:
            return True
        if name.startswith(".env") and name not in {".env.example", ".env.sample", ".env.template"}:
            return True
        return any(part.lower() in _SECRET_DIRS for part in path.parts)

    def _walk_files(self, start: Path, *, max_files: int) -> tuple[list[Path], bool]:
        try:
            start_resolved = self.resolve(start, must_exist=True)
        except WorkspaceError:
            raise
        if self.is_sensitive_path(start_resolved):
            raise WorkspaceError("Listing/searching secret or internal metadata directories is disabled.")
        if not start_resolved.is_dir():
            raise WorkspaceError(f"Not a directory: {start}")

        found: list[Path] = []
        truncated = False
        for current, dirs, filenames in os.walk(start_resolved, topdown=True, followlinks=False):
            dirs[:] = sorted(
                name for name in dirs
                if name.lower() not in _IGNORED_DIRS and not self.is_sensitive_path(Path(current) / name)
            )
            for filename in sorted(filenames):
                file_path = Path(current) / filename
                if self.is_sensitive_path(file_path):
                    continue
                try:
                    resolved_file = file_path.resolve(strict=True)
                    resolved_file.relative_to(self.root)
                except (OSError, RuntimeError, ValueError):
                    continue
                if self.is_sensitive_path(resolved_file):
                    continue
                found.append(file_path)
                if len(found) >= max_files:
                    truncated = True
                    return found, truncated
        return found, truncated

    def list_files(self, path: str = ".", *, limit: int = 200) -> dict[str, Any]:
        if not 1 <= limit <= 1000:
            raise WorkspaceError("File listing limit must be from 1 to 1000.")
        directory = self.resolve(path, must_exist=True)
        files, truncated = self._walk_files(directory, max_files=limit + 1)
        files = files[:limit]
        return {
            "path": directory.relative_to(self.root).as_posix() or ".",
            "files": [item.relative_to(self.root).as_posix() for item in files],
            "truncated": truncated or len(files) > limit,
        }

    def read_text(
        self, path: str, *, max_bytes: int = _TEXT_LIMIT_BYTES, allow_sensitive: bool = False
    ) -> dict[str, Any]:
        raw_path = Path(path).expanduser()
        target = self.resolve(path, must_exist=True)
        if not allow_sensitive and (self.is_sensitive_path(raw_path) or self.is_sensitive_path(target)):
            raise WorkspaceError("This path looks like a secret or credential file; explicit sensitive-file permission is required.")
        if not target.is_file():
            raise WorkspaceError(f"Not a regular file: {path}")
        try:
            with target.open("rb") as handle:
                raw = handle.read(max_bytes + 1)
            if len(raw) > max_bytes:
                raise WorkspaceError(f"File exceeds the per-read limit of {max_bytes} bytes.")
        except WorkspaceError:
            raise
        except OSError as exc:
            raise WorkspaceError(f"Could not read '{path}': {exc}") from exc
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise WorkspaceError(f"File is not valid UTF-8 text: {path}") from exc
        return {"path": target.relative_to(self.root).as_posix(), "content": content, "bytes": len(raw)}

    def search_text(self, query: str, path: str = ".", *, limit: int = 50) -> dict[str, Any]:
        if not query:
            raise WorkspaceError("Search query must not be empty.")
        if len(query) > 500:
            raise WorkspaceError("Search query must be at most 500 characters.")
        if not 1 <= limit <= 200:
            raise WorkspaceError("Search result limit must be from 1 to 200.")
        directory = self.resolve(path, must_exist=True)
        files, file_truncated = self._walk_files(directory, max_files=_SEARCH_FILE_LIMIT + 1)
        files = files[:_SEARCH_FILE_LIMIT]
        query_folded = query.casefold()
        matches: list[dict[str, Any]] = []
        skipped_large = 0
        files_scanned = 0
        bytes_scanned = 0
        total_scan_limit = 64 * 1024 * 1024
        scan_truncated = False
        for file_path in files:
            remaining = total_scan_limit - bytes_scanned
            if remaining <= 0:
                scan_truncated = True
                break
            try:
                with file_path.open("rb") as handle:
                    raw = handle.read(min(_TEXT_LIMIT_BYTES + 1, remaining + 1))
                files_scanned += 1
                bytes_scanned += len(raw)
                if len(raw) > remaining:
                    scan_truncated = True
                    break
                if len(raw) > _TEXT_LIMIT_BYTES:
                    skipped_large += 1
                    continue
                content = raw.decode("utf-8")
                for line_number, line in enumerate(content.splitlines(), start=1):
                    if query_folded in line.casefold():
                        matches.append({
                            "path": file_path.relative_to(self.root).as_posix(),
                            "line": line_number,
                            "text": line[:400],
                        })
                        if len(matches) >= limit:
                            return {
                                "query": query,
                                "matches": matches,
                                "truncated": True,
                                "files_scanned": files_scanned,
                                "bytes_scanned": bytes_scanned,
                                "skipped_large_files": skipped_large,
                            }
            except (OSError, UnicodeDecodeError):
                # Binary files and unreadable entries are not useful text-search results.
                continue
        return {
            "query": query,
            "matches": matches,
            "truncated": file_truncated or scan_truncated,
            "files_scanned": files_scanned,
            "bytes_scanned": bytes_scanned,
            "skipped_large_files": skipped_large,
        }

    def write_text(self, path: str, content: str, *, max_bytes: int = 1_000_000) -> dict[str, Any]:
        import hashlib
        import tempfile

        raw_path = Path(path).expanduser()
        target = self.resolve(path, must_exist=False)
        if self.is_sensitive_path(raw_path) or self.is_sensitive_path(target):
            raise WorkspaceError("Writing secret/credential paths is disabled by the filesystem tool.")
        if not isinstance(content, str):
            raise WorkspaceError("File content must be text.")
        encoded = content.encode("utf-8")
        if len(encoded) > max_bytes:
            raise WorkspaceError(f"Content is {len(encoded)} bytes; the write limit is {max_bytes} bytes.")
        if target.exists() and not target.is_file():
            raise WorkspaceError(f"Not a regular file: {path}")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Re-resolve after creating parents so symlinked parent directories cannot escape.
            target = self.resolve(target, must_exist=False)
            if self.is_sensitive_path(target):
                raise WorkspaceError("Writing secret/credential paths is disabled by the filesystem tool.")
            overwritten = target.exists()
            if overwritten and target.stat().st_size > max_bytes:
                raise WorkspaceError(
                    f"Existing file is larger than the {max_bytes}-byte safe replacement limit."
                )
            if overwritten:
                with target.open("rb") as handle:
                    old_bytes = handle.read(max_bytes + 1)
                if len(old_bytes) > max_bytes:
                    raise WorkspaceError(
                        f"Existing file is larger than the {max_bytes}-byte safe replacement limit."
                    )
                old = old_bytes.decode("utf-8")
            else:
                old = ""
            old_mode = target.stat().st_mode & 0o777 if overwritten else None
            relative_name = target.relative_to(self.root).as_posix()
            diff = format_text_diff(
                old,
                content,
                from_file=f"a/{relative_name}",
                to_file=f"b/{relative_name}",
            )
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{target.name}.stx-tmp-", dir=target.parent
            )
            temporary = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                if old_mode is not None:
                    os.chmod(temporary, old_mode)
                os.replace(temporary, target)
            finally:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
        except WorkspaceError:
            raise
        except (OSError, UnicodeDecodeError) as exc:
            raise WorkspaceError(f"Could not write '{path}': {exc}") from exc
        return {
            "path": target.relative_to(self.root).as_posix(),
            "bytes": len(encoded),
            "overwritten": overwritten,
            "sha256": hashlib.sha256(encoded).hexdigest(),
            "diff": diff[:12000],
            "diff_truncated": len(diff) > 12000 or diff.startswith("[diff omitted:"),
        }

    def summary(self, *, max_entries: int = 80, include_root: bool = True) -> dict[str, Any]:
        try:
            children = sorted(self.root.iterdir(), key=lambda item: item.name.casefold())
        except OSError as exc:
            raise WorkspaceError(f"Could not inspect workspace: {exc}") from exc
        entries = [
            {"name": child.name, "kind": "directory" if child.is_dir() else "file"}
            for child in children
            if child.name.lower() not in _IGNORED_DIRS and not self.is_sensitive_path(child)
        ]
        markers = [
            name for name in (
                "pyproject.toml", "package.json", "Cargo.toml", "go.mod", "pom.xml",
                "build.gradle", "requirements.txt", "Makefile", "README.md", "README",
            ) if (self.root / name).exists()
        ]
        result: dict[str, Any] = {
            "top_level_entries": entries[:max_entries],
            "entries_truncated": len(entries) > max_entries,
            "project_markers": markers,
        }
        if include_root:
            result["root"] = str(self.root)
        return result
