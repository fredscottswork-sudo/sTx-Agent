"""Command-line entry point for the first STX Agent foundation."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
from typing import Sequence

from . import __version__
from .agent import Agent
from .config import AppConfig, load_config, write_default_config
from .errors import ConfigError, STXError
from .events import JsonlEventRecorder, RunEvent
from .indexing import ProjectIndex
from .runtime import provider_factory as _provider_factory
from .tools import build_default_registry
from .workspace import Workspace


def _common_workspace(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--workspace", type=Path, default=Path.cwd(), help="workspace root (default: current directory)")


def _config_path(value: Path | None, workspace: Workspace) -> Path:
    if value is None:
        return workspace.root / "stx.config.toml"
    return value if value.is_absolute() else workspace.root / value


def _load_for_workspace(value: Path | None, workspace: Workspace) -> AppConfig:
    path = _config_path(value, workspace)
    return load_config(path)


def _approval(*, approve_all: bool):
    def approve(request) -> bool:
        print(
            f"\n[approval required] {request.tool_name} "
            f"({request.capability}, {request.risk.name.lower()} risk)\n  {request.details}",
            file=sys.stderr,
        )
        if approve_all:
            return True
        if not sys.stdin.isatty():
            print("  Denied: no interactive terminal. Configure a narrower explicit policy to allow this action.", file=sys.stderr)
            return False
        try:
            answer = input("  Approve this action? [y/N] ").strip().lower()
        except EOFError:
            return False
        return answer in {"y", "yes"}
    return approve


def _progress(event: RunEvent) -> None:
    fields = event.fields
    if event.event_type == "route.selected":
        print(
            f"[route] {fields.get('profile')} → {fields.get('provider')} / {fields.get('model')} "
            f"({fields.get('reason')})",
            file=sys.stderr,
        )
    elif event.event_type == "model.request_started":
        print(f"[model] turn {fields.get('turn')}…", file=sys.stderr)
    elif event.event_type == "model.failed":
        print(f"[model] failed ({fields.get('error_type')})", file=sys.stderr)
    elif event.event_type == "tool.started":
        print(f"[tool] {fields.get('name')}…", file=sys.stderr)
    elif event.event_type == "tool.completed":
        state = "ok" if fields.get("ok") else "failed/denied"
        print(
            f"[tool] {fields.get('name')}: {state} ({fields.get('duration_seconds')}s)",
            file=sys.stderr,
        )
    elif event.event_type == "run.completed":
        print(
            f"[run] {fields.get('status')} — {fields.get('tool_calls')} tool call(s), "
            f"{fields.get('model_turns')} model turn(s)",
            file=sys.stderr,
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stx",
        description="STX Agent — Build. Execute. Verify. Improve.",
    )
    parser.add_argument("--version", action="version", version=f"STX Agent {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    init_parser = commands.add_parser("init", help="create a starter local configuration")
    _common_workspace(init_parser)
    init_parser.add_argument("--config", type=Path, help="configuration file path (default: <workspace>/stx.config.toml)")

    inspect_parser = commands.add_parser("inspect", help="summarize a workspace without using a model")
    _common_workspace(inspect_parser)

    index_parser = commands.add_parser("index", help="incrementally index repository files and symbols")
    _common_workspace(index_parser)
    index_parser.add_argument("--config", type=Path, help="configuration file path")
    index_parser.add_argument("--force", action="store_true", help="re-parse every eligible file")

    search_parser = commands.add_parser("search", help="search project paths, symbols, and source text")
    search_parser.add_argument("query", nargs="+", help="search terms")
    _common_workspace(search_parser)
    search_parser.add_argument("--config", type=Path, help="configuration file path")
    search_parser.add_argument("--limit", type=int, default=20, help="maximum results (1–100)")

    serve_parser = commands.add_parser("serve", help="start the local dashboard and task API")
    _common_workspace(serve_parser)
    serve_parser.add_argument("--config", type=Path, help="configuration file path")
    serve_parser.add_argument("--host", default="127.0.0.1", help="bind address (non-loopback requires STX_API_TOKEN)")
    serve_parser.add_argument("--port", type=int, default=8765, help="HTTP port (default: 8765)")
    serve_parser.add_argument("--workers", type=int, default=2, help="concurrent background tasks (1–8)")

    doctor_parser = commands.add_parser("doctor", help="check local runtime, Git, and model configuration")
    _common_workspace(doctor_parser)
    doctor_parser.add_argument("--config", type=Path, help="configuration file path")

    run_parser = commands.add_parser("run", help="run an engineering task with the configured model")
    run_parser.add_argument("task", nargs="+", help="task instruction")
    _common_workspace(run_parser)
    run_parser.add_argument("--config", type=Path, help="configuration file path")
    run_parser.add_argument("--profile", help="explicit model profile (for example: coding)")
    run_parser.add_argument("--max-tool-steps", type=int, help="override the configured tool-call limit (1–100)")
    run_parser.add_argument("--dry-run", action="store_true", help="preview supported side effects without writing, executing commands, changing memory, or fetching URLs")
    run_parser.add_argument("--yes", action="store_true", help="approve policy-confirmable actions (use only in a trusted workspace)")
    return parser


def _run_init(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    config_path = _config_path(args.config, workspace)
    write_default_config(config_path)
    print(f"Created {config_path}")
    print("Set the configured API key environment variable, then review permissions before running tasks.")
    return 0


def _run_inspect(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    print(json.dumps(workspace.summary(), indent=2, ensure_ascii=False))
    return 0


def _run_index(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    config = _load_for_workspace(args.config, workspace)
    result = ProjectIndex(
        workspace,
        max_files=config.index.max_files,
        max_file_bytes=config.index.max_file_bytes,
    ).index(force=args.force)
    print(json.dumps(result.as_dict(), indent=2))
    return 0


def _run_search(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    config = _load_for_workspace(args.config, workspace)
    if not 1 <= args.limit <= 100:
        raise ConfigError("--limit must be from 1 to 100.")
    index = ProjectIndex(
        workspace,
        max_files=config.index.max_files,
        max_file_bytes=config.index.max_file_bytes,
    )
    indexed = index.index()
    results = index.search(" ".join(args.query), limit=args.limit)
    print(json.dumps({"index": indexed.as_dict(), "results": results}, indent=2, ensure_ascii=False))
    return 0


def _run_serve(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    config = _load_for_workspace(args.config, workspace)
    if not 0 <= args.port <= 65535:
        raise ConfigError("--port must be from 0 to 65535.")
    if not 1 <= args.workers <= 8:
        raise ConfigError("--workers must be from 1 to 8.")
    from .server import STXAPIServer
    STXAPIServer(
        workspace, config, host=args.host, port=args.port, workers=args.workers
    ).serve_forever()
    return 0


def _run_doctor(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    path = _config_path(args.config, workspace)
    print(f"Python: {sys.version.split()[0]} (requires 3.11+)")
    print(f"Git: {shutil.which('git') or 'not found'}")
    print(f"Workspace: {workspace.root}")
    if not path.exists():
        print(f"Config: not found ({path}); run 'stx init' to create one")
        return 0
    config = load_config(path)
    print(f"Config: {path}")
    print(f"Autonomy: {config.autonomy}; max tool calls: {config.max_tool_steps}")
    print(f"Project index: {'enabled' if config.index.enabled else 'disabled'} (max {config.index.max_files} files)")
    print(f"Explicit memory: {'enabled' if config.memory.enabled else 'disabled'} (retention {config.memory.retention_days} days)")
    print(f"HTTPS text fetch: {'enabled' if config.network.enabled else 'disabled'} (allowlisted hosts: {len(config.network.allowed_hosts)})")
    print(f"Task history: {config.tasks.retention_days} days, up to {config.tasks.max_records} completed records")
    if not config.profiles:
        print("Models: no profiles configured")
    else:
        print("Models:")
        for name, profile in sorted(config.profiles.items()):
            settings = config.providers[profile.provider]
            key_status = "not required" if not settings.require_api_key else (
                "present" if settings.api_key_env and os.environ.get(settings.api_key_env) else
                f"missing {settings.api_key_env}"
            )
            print(f"  {name}: {profile.model} via {settings.base_url} (API key: {key_status})")
    if not shutil.which("git"):
        print("Warning: Git commands will not be available.")
    print("Note: doctor checks configuration only; it does not make a network/model request.")
    return 0


def _run_task(args: argparse.Namespace) -> int:
    workspace = Workspace(args.workspace)
    config = _load_for_workspace(args.config, workspace)
    if args.max_tool_steps is not None and not 1 <= args.max_tool_steps <= 100:
        raise ConfigError("--max-tool-steps must be from 1 to 100.")
    task = " ".join(args.task)
    sinks = [_progress]
    if config.logging.enabled:
        log_directory = Path(config.logging.directory)
        if not log_directory.is_absolute():
            log_directory = workspace.root / log_directory
        # One metadata-only event file per run; the run ID is not yet known here,
        # so attach the recorder lazily on run.started.
        recorder_holder: dict[str, JsonlEventRecorder] = {}

        def record(event: RunEvent) -> None:
            if event.event_type == "run.started":
                recorder_holder["recorder"] = JsonlEventRecorder(log_directory, event.run_id)
            recorder = recorder_holder.get("recorder")
            if recorder:
                recorder(event)
        sinks.append(record)

    if args.yes:
        print("Warning: --yes approves every action that policy marks confirmable.", file=sys.stderr)
    agent = Agent(
        config=config,
        workspace=workspace,
        tools=build_default_registry(
            config.index,
            config.memory,
            config.network,
            include_index=config.index.enabled,
            include_memory=config.memory.enabled,
            include_network=config.network.enabled,
        ),
        provider_factory=_provider_factory(config),
        approval=_approval(approve_all=args.yes),
        dry_run=args.dry_run,
        event_sinks=sinks,
    )
    result = agent.run(task, requested_profile=args.profile, max_tool_steps=args.max_tool_steps)
    print(result.answer)
    if result.status != "completed":
        print(f"STX run status: {result.status}; review partial work before continuing.", file=sys.stderr)
        return 1
    if result.tools:
        ran = [item.name for item in result.tools if item.ok]
        failed = [item.name for item in result.tools if not item.ok]
        print("\nObserved tool calls: " + (", ".join(ran) if ran else "none succeeded"), file=sys.stderr)
        if failed:
            print("Failed or denied: " + ", ".join(failed), file=sys.stderr)
    if args.dry_run:
        print("Dry run: writes, terminal commands, memory changes, and network fetches were not executed.", file=sys.stderr)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            return _run_init(args)
        if args.command == "inspect":
            return _run_inspect(args)
        if args.command == "index":
            return _run_index(args)
        if args.command == "search":
            return _run_search(args)
        if args.command == "serve":
            return _run_serve(args)
        if args.command == "doctor":
            return _run_doctor(args)
        if args.command == "run":
            return _run_task(args)
        parser.error(f"Unknown command: {args.command}")
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
    except (STXError, OSError, ValueError) as exc:
        print(f"stx: error: {exc}", file=sys.stderr)
        return 2
    return 0
