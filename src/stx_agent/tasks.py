"""Bounded background task execution and user-mediated approvals."""

from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import sqlite3
from pathlib import Path
from threading import Event, RLock
import time
from typing import Any

from .config import AppConfig
from .events import JsonlEventRecorder, RunEvent
from .policy import ApprovalRequest
from .runtime import create_agent
from .task_store import TaskStore
from .workspace import Workspace
from .workspace_lock import WorkspaceServerLock


class TaskManager:
    def __init__(self, workspace: Workspace, config: AppConfig, *, workers: int = 2) -> None:
        if not 1 <= workers <= 8:
            raise ValueError("workers must be from 1 to 8")
        self.workspace = workspace
        self.config = config
        self._workspace_lock = WorkspaceServerLock(workspace)
        self._workspace_lock.acquire()
        try:
            self.store = TaskStore(
                workspace,
                retention_days=config.tasks.retention_days,
                max_records=config.tasks.max_records,
            )
        except Exception:
            self._workspace_lock.release()
            raise
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="stx-task")
        self._lock = RLock()
        self._cancel: dict[str, Event] = {}
        self._approval_events: dict[str, Event] = {}
        self._shutdown = False
        self._max_pending_approvals_seconds = 300

    def submit(
        self,
        instruction: str,
        *,
        profile: str | None = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        if not instruction.strip() or len(instruction) > 20_000:
            raise ValueError("task must contain 1 to 20000 characters")
        if profile is not None and not isinstance(profile, str):
            raise ValueError("profile must be a string or null")
        if profile is not None and profile not in self.config.profiles:
            raise ValueError(f"Unknown model profile: {profile}")
        if not isinstance(dry_run, bool):
            raise ValueError("dry_run must be a boolean")
        with self._lock:
            if self._shutdown:
                raise RuntimeError("task manager is shutting down")
            if self.store.unfinished_count() >= 100:
                raise ValueError("too many queued or active tasks (maximum 100)")
            task = self.store.create(instruction, profile, dry_run=dry_run)
            cancel_event = Event()
            self._cancel[task["id"]] = cancel_event
            self._pool.submit(self._run, task["id"], instruction, profile, dry_run, cancel_event)
            return task

    def _event_sink(self, task_id: str, event: RunEvent) -> None:
        # Persist only event type/time and basic counters, never prompts or tool results.
        safe_event = {"type": event.event_type, "timestamp": event.timestamp}
        fields: dict[str, Any] = {"last_event": safe_event}
        turn = event.fields.get("turn")
        if isinstance(turn, int):
            fields["model_turns"] = turn
        tool_calls = event.fields.get("tool_calls")
        if isinstance(tool_calls, int):
            fields["tool_calls"] = tool_calls
        self.store.update(task_id, **fields)

    def _approval_callback(self, task_id: str, cancel_event: Event):
        def request_approval(request: ApprovalRequest) -> bool:
            approval_id = self.store.create_approval(task_id, request)
            event = Event()
            with self._lock:
                self._approval_events[approval_id] = event
            self.store.update(task_id, status="awaiting_approval")
            deadline = time.monotonic() + self._max_pending_approvals_seconds
            try:
                while True:
                    status = self.store.approval_status(approval_id)
                    if status != "pending":
                        return status == "approved"
                    if cancel_event.is_set():
                        self.store.resolve_approval(task_id, approval_id, False)
                        return False
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self.store.resolve_approval(task_id, approval_id, False)
                        return False
                    event.wait(min(0.25, remaining))
                    event.clear()
            finally:
                with self._lock:
                    self._approval_events.pop(approval_id, None)
                if not cancel_event.is_set():
                    self.store.update(task_id, status="running")
        return request_approval

    def _run(
        self,
        task_id: str,
        instruction: str,
        profile: str | None,
        dry_run: bool,
        cancel_event: Event,
    ) -> None:
        with self._lock:
            self.store.update(task_id, status="cancelling" if cancel_event.is_set() else "running")
        try:
            sinks = [lambda event: self._event_sink(task_id, event)]
            if self.config.logging.enabled:
                log_directory = Path(self.config.logging.directory)
                if not log_directory.is_absolute():
                    log_directory = self.workspace.root / log_directory
                recorder_holder: dict[str, JsonlEventRecorder] = {}

                def record(event: RunEvent) -> None:
                    if event.event_type == "run.started":
                        recorder_holder["recorder"] = JsonlEventRecorder(log_directory, event.run_id)
                    recorder = recorder_holder.get("recorder")
                    if recorder:
                        recorder(event)

                sinks.append(record)
            agent = create_agent(
                self.config,
                self.workspace,
                approval=self._approval_callback(task_id, cancel_event),
                dry_run=dry_run,
                cancel_event=cancel_event,
                event_sinks=sinks,
            )
            result = agent.run(instruction, requested_profile=profile)
            with self._lock:
                status = "cancelled" if result.status == "cancelled" or cancel_event.is_set() else result.status
                self.store.update(
                    task_id,
                    status=status,
                    answer=result.answer,
                    error=None,
                    model_turns=result.model_turns,
                    tool_calls=result.tool_calls,
                )
                if status == "cancelled":
                    self.store.close_pending_approvals(task_id, "cancelled")
        except Exception as exc:
            # Avoid persisting provider exception text that could contain untrusted or
            # sensitive response material. Detailed diagnostics stay with the CLI host.
            with self._lock:
                if cancel_event.is_set():
                    self.store.update(task_id, status="cancelled", answer="Task cancelled by the user.", error=None)
                else:
                    self.store.update(
                        task_id,
                        status="failed",
                        error=f"Task failed ({type(exc).__name__}). Check the local server logs.",
                    )
        finally:
            with self._lock:
                self._cancel.pop(task_id, None)

    def get(self, task_id: str) -> dict[str, Any] | None:
        return self.store.get(task_id)

    def list(self, *, limit: int = 50) -> list[dict[str, Any]]:
        return self.store.list(limit=limit)

    def cancel(self, task_id: str) -> bool:
        task = self.store.get(task_id)
        if task is None or task["status"] not in {"queued", "running", "awaiting_approval", "cancelling"}:
            return False
        with self._lock:
            event = self._cancel.get(task_id)
            if event is None or not self.store.request_cancel(task_id):
                return False
            event.set()
        for approval in task.get("approvals", []):
            if approval["status"] == "pending":
                self.store.resolve_approval(task_id, approval["id"], False)
                with self._lock:
                    approval_event = self._approval_events.get(approval["id"])
                if approval_event:
                    approval_event.set()
        return True

    def respond_to_approval(self, task_id: str, approval_id: str, *, approved: bool) -> bool:
        if not isinstance(approved, bool):
            raise ValueError("approved must be a boolean")
        if not self.store.resolve_approval(task_id, approval_id, approved):
            return False
        with self._lock:
            event = self._approval_events.get(approval_id)
        if event:
            event.set()
        return True

    def shutdown(self, *, wait: bool = True) -> None:
        with self._lock:
            if self._shutdown:
                return
            self._shutdown = True
            events = list(self._cancel.values())
        for event in events:
            event.set()
        try:
            self._pool.shutdown(wait=wait, cancel_futures=True)
            if wait:
                try:
                    remaining = self.store.list(limit=100)
                    for task in remaining:
                        if task["status"] in {"queued", "running", "awaiting_approval", "cancelling"}:
                            self.store.update(task["id"], status="interrupted")
                except (OSError, sqlite3.Error):
                    # Workspace deletion or a damaged local task DB must not prevent shutdown.
                    pass
        finally:
            if wait:
                self._workspace_lock.release()
