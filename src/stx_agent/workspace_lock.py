"""Cross-platform advisory lock for one dashboard task manager per workspace."""

from __future__ import annotations
import os
from pathlib import Path

from .errors import ConfigError
from .workspace import Workspace


class WorkspaceServerLock:
    def __init__(self, workspace: Workspace) -> None:
        self.path = workspace.root / ".stx" / "server.lock"
        self._handle = None
        self._locked = False

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass
        self._handle = self.path.open("a+b")
        try:
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
            self._handle.close()
            self._handle = None
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
