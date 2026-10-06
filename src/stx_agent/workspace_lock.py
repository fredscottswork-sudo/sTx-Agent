"""Cross-platform advisory lock for one dashboard task manager per workspace."""

from __future__ import annotations
import os
from pathlib import Path
from threading import Lock

from .errors import ConfigError
from .workspace import Workspace


_LOCAL_LOCKS: set[str] = set()
_LOCAL_LOCKS_GUARD = Lock()


class WorkspaceServerLock:
    def __init__(self, workspace: Workspace) -> None:
        self.path = workspace.root / ".stx" / "server.lock"
        self._key = str(self.path.resolve()).casefold() if os.name == "nt" else str(self.path.resolve())
        self._handle = None
        self._locked = False

    def acquire(self) -> None:
        if self.path.parent.is_symlink() or self.path.is_symlink():
            raise ConfigError("The STX workspace lock path must not be a symbolic link.")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.parent.is_symlink() or self.path.is_symlink():
            raise ConfigError("The STX workspace lock path must not be a symbolic link.")
        with _LOCAL_LOCKS_GUARD:
            if self._key in _LOCAL_LOCKS:
                raise ConfigError("Another STX dashboard/task server already holds this workspace lock.")
            _LOCAL_LOCKS.add(self._key)
        try:
            try:
                os.chmod(self.path.parent, 0o700)
            except OSError:
                pass
            self._handle = self.path.open("a+b")
            if self.path.stat().st_size == 0:
                self._handle.write(b"\0")
                self._handle.flush()
            self._handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._locked = True
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
        except (OSError, BlockingIOError) as exc:
            if self._handle is not None:
                self._handle.close()
                self._handle = None
            with _LOCAL_LOCKS_GUARD:
                _LOCAL_LOCKS.discard(self._key)
            raise ConfigError("Another STX dashboard/task server already holds this workspace lock.") from exc

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        try:
            if self._locked:
                if os.name == "nt":
                    import msvcrt
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            handle.close()
            self._handle = None
            self._locked = False
            with _LOCAL_LOCKS_GUARD:
                _LOCAL_LOCKS.discard(self._key)
