"""Bounded subprocess helper shared by terminal and Git read tools."""

from __future__ import annotations

from dataclasses import dataclass
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class ProcessResult:
    argv: list[str]
    return_code: int | None
    stdout: str
    stderr: str
    duration_seconds: float
    timed_out: bool
    stdout_truncated: bool
    stderr_truncated: bool
    cancelled: bool = False


class _Capture:
    def __init__(self, stream, max_bytes: int) -> None:
        self.stream = stream
        self.max_bytes = max_bytes
        self.data = bytearray()
        self.total = 0
        self.error: Exception | None = None

    def drain(self) -> None:
        try:
            while True:
                chunk = self.stream.read(8192)
                if not chunk:
                    return
                self.total += len(chunk)
                remaining = self.max_bytes - len(self.data)
                if remaining > 0:
                    self.data.extend(chunk[:remaining])
        except Exception as exc:  # surfaced in the result as truncated output
            self.error = exc

    @property
    def truncated(self) -> bool:
        return self.total > self.max_bytes or self.error is not None

    def text(self) -> str:
        text = self.data.decode("utf-8", errors="replace")
        if self.truncated:
            text += "\n[output truncated]"
        return text


def safe_child_environment() -> dict[str, str]:
    """Pass common runtime variables but omit API keys and arbitrary secrets."""
    allowed = {
        "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT",
        "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG",
        "LC_ALL", "LC_CTYPE", "TERM", "CI", "VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME",
    }
    return {key: value for key, value in os.environ.items() if key.upper() in allowed}


def _terminate_process_tree(process: subprocess.Popen) -> None:
    if os.name == "nt":
        try:
            process.terminate()
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            process.kill()
        except OSError:
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
        try:
            process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass
        try:
            # Kill any child that outlived the direct process but kept its pipes open.
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
    if process.poll() is None:
        try:
            process.kill()
        except OSError:
            pass
    process.wait()


def run_bounded_process(
    argv: Sequence[str],
    *,
    cwd: Path,
    timeout_seconds: float,
    output_limit_bytes: int = 32_000,
    env: dict[str, str] | None = None,
    cancel_event: threading.Event | None = None,
) -> ProcessResult:
    if not argv or any(not isinstance(item, str) or "\x00" in item for item in argv):
        raise ValueError("Command must be a non-empty array of strings without NUL bytes.")
    if timeout_seconds <= 0 or output_limit_bytes < 0:
        raise ValueError("timeout_seconds must be positive and output_limit_bytes non-negative.")
    start = time.monotonic()
    popen_kwargs = {
        "args": list(argv),
        "cwd": str(cwd),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "shell": False,
        "env": env if env is not None else safe_child_environment(),
        "bufsize": 0,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_kwargs["start_new_session"] = True

    process = subprocess.Popen(**popen_kwargs)
    assert process.stdout is not None and process.stderr is not None
    stdout_capture = _Capture(process.stdout, output_limit_bytes)
    stderr_capture = _Capture(process.stderr, output_limit_bytes)
    stdout_thread = threading.Thread(target=stdout_capture.drain, daemon=True)
    stderr_thread = threading.Thread(target=stderr_capture.drain, daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    timed_out = False
    cancelled = False
    deadline = start + timeout_seconds
    try:
        while process.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                cancelled = True
                _terminate_process_tree(process)
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                _terminate_process_tree(process)
                break
            if cancel_event is not None:
                cancel_event.wait(min(0.1, remaining))
            else:
                try:
                    process.wait(timeout=remaining)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    _terminate_process_tree(process)
                    break
        else:
            process.wait()
        if not timed_out and not cancelled and os.name != "nt":
            try:
                os.killpg(process.pid, 0)
            except (ProcessLookupError, OSError):
                pass
            else:
                # The command exited but left children in its process group.
                # Terminal.run is bounded work, not a detached-server launcher.
                _terminate_process_tree(process)
    except KeyboardInterrupt:
        _terminate_process_tree(process)
        raise
    finally:
        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
        process.stdout.close()
        process.stderr.close()
    duration = time.monotonic() - start
    return ProcessResult(
        list(argv), process.returncode, stdout_capture.text(), stderr_capture.text(),
        duration, timed_out, stdout_capture.truncated, stderr_capture.truncated, cancelled,
    )
