# STX Agent

**Build. Execute. Verify. Improve.**

STX Agent is a self-hosted, policy-aware engineering-agent foundation from **ScottsTechX Enterprises (U) Ltd**. It is modular and auditable, but it is not an unrestricted or fully sandboxed autonomous system. Tool permissions are enforced by the host runtime; provider-side moderation and limits remain outside STX's control.

## Current implementation

The repository now includes a Python CLI and a local task dashboard with:

- Named model profiles with **OpenAI-compatible** and native **Anthropic Messages API** adapters; API keys are read from environment variables.
- A bounded model/tool loop, explicit routing, structured metadata events, and safe workspace-scoped file operations.
- Direct-argv terminal execution (`shell=False`), read-only Git tools, policy-gated writes and commands, approval requests, dry-run, time/output limits, and cancellation.
- Incremental SQLite repository metadata/symbol indexing and bounded lexical context retrieval.
- Explicit local project memories with search, user approval for writes/deletes, and expiry. The agent does not write memory automatically.
- A responsive multi-page local control center with live task/approval management, per-task model selection, cancellation, and confirmed deletion of finished history.
- Owner-facing management for explicit memory and the local project index, plus read-only views of provider readiness, active permissions, built-in tools, retention limits, and security-audit findings.
- A read-only `stx audit` command with stable check IDs, JSON output, and a strict mode for CI; it does not auto-fix settings or inspect OS-level ACLs.
- Optional HTTPS text fetching restricted to configured hostnames, public DNS addresses, bounded responses, and explicit confirmation. Fetched content is treated as untrusted input.

**Not yet implemented:** MCP transport, headless browser automation, arbitrary external plugin loading, native provider-specific adapters beyond OpenAI-compatible and Anthropic APIs, multi-agent orchestration, and OS/container sandbox isolation. This agent cannot override a model provider's safety rules, access, or content policy. “Uncensored” behavior is not promised. See the [capability matrix](docs/capability-matrix.md) and [platform notes](docs/platforms.md) for exact scope and limitations.

## Requirements and installation

- Python 3.11+
- Git for Git tools
- No third-party Python runtime dependencies
- A configured OpenAI-compatible or Anthropic endpoint and its required credentials for model-backed `run` tasks; local inspection, indexing, audits, and tests do not need model credentials

```bash
python -m pip install -e .
stx init
# Export the environment variable named by api_key_env; never put the key in TOML.
export OPENAI_API_KEY="..."    # Linux, macOS, Termux shells
stx doctor
```

Windows PowerShell example for a process-scoped key:

```powershell
$env:OPENAI_API_KEY = "..."
stx doctor
```

You can instead copy `stx.config.example.toml` to `stx.config.toml` and edit it. `stx init` never overwrites an existing file. Local config and `.stx/` data are excluded from Git by default. See [platform-specific instructions](docs/platforms.md).

## Commands

```bash
stx inspect                         # workspace summary, no model request
stx doctor                          # local runtime/configuration check
stx audit --json                    # read-only policy and storage posture report
stx index                           # incrementally index files and symbols
stx search checkout retries         # index, then search paths/symbols/source
stx run "Explain how checkout works" # interactive policy-gated model/tool loop
stx run --profile coding "..."     # select an explicitly configured profile
stx run --dry-run "..."            # preview proposed writes/commands
stx serve                           # local dashboard and task API on 127.0.0.1:8765
python -m unittest discover -s tests -v
```

The model router only selects configured profiles, uses small transparent keyword heuristics, and can be overridden with `--profile`. The control center is available at `http://127.0.0.1:8765/` while `stx serve` is running. It provides task and approval actions, memory/index management, a read-only audit, and a read-only view of active configuration; it does not edit TOML or install providers/plugins. Only one dashboard/task server may hold a workspace lock at a time. It has no login on loopback; do not expose it to a network without a strong `STX_API_TOKEN` and a TLS-terminating reverse proxy. The static UI can load to collect the token, but API data/actions require bearer authentication. The built-in HTTP server does not provide TLS.

## Permissions, data, and limits

The sample policy allows ordinary workspace reads and Git reads, denies sensitive-file reads, and requires confirmation for writes, terminal commands, memory changes, and network fetches. Unlisted capabilities are denied. Review `stx.config.toml` before relaxing policy. `stx run --yes` approves every confirmable action and is unsafe for untrusted workspaces.

Terminal execution uses an argv array, `shell=False`, a scrubbed child environment, bounded output/time, and process cleanup. It can still run arbitrary project code; **it is not an OS/container sandbox**. Windows process-tree termination and filesystem permission semantics differ from POSIX. Read [security notes](docs/architecture.md#security-and-technical-risks).

The local `.stx/` directory can contain SQLite index metadata, explicitly saved memories, task prompts/results, and approval details. POSIX permissions are tightened where available; on Windows, protect the workspace with NTFS ACLs. Task history is bounded by `[tasks]` retention settings. Memory has its own expiry setting. Do not store secrets in tasks or memories.

Optional `web.fetch` is off by default. To enable it, set `[network].enabled = true`, add exact hostnames or `*.subdomain.example` patterns to `[network].allowed_hosts`, and retain `"network.fetch" = "confirm"`. It only fetches public HTTPS text on port 443, blocks non-public DNS addresses and unapproved redirects, and does not send cookies or authorization headers. It is not a general browser or private-network client.

## Configuration and providers

TOML config supports named providers/profiles, autonomy, explicit capability permissions, tool-step limits, index/memory settings, network host allowlists, task retention, and opt-in metadata-only logs. Native adapters are available for the OpenAI-compatible chat-completions/tool-call shape and Anthropic's Messages API; keys remain in environment variables. Provider endpoint redirects are refused so prompts and keys are not forwarded to an unreviewed host. Local compatible servers can be used when their endpoints match the adapter. Non-loopback HTTP is refused unless the provider explicitly opts into insecure HTTP. The Anthropic adapter uses a bounded 4,096-token response budget and rejects temperatures above 1.

Run `stx audit` to inspect policy and local storage posture without contacting a model or changing files; use `--json` for automation and `--strict` to fail on warnings. The audit is a configuration review, not a sandbox or a complete operating-system security scanner.

See [the example config](stx.config.example.toml), [architecture](docs/architecture.md), [capability matrix](docs/capability-matrix.md), [platform notes](docs/platforms.md), and the [Hermes/OpenClaw comparative review](docs/comparative-analysis.md).

## Tests and verification

Run the standard-library suite with:

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
python -m compileall -q src tests
```

Unit/integration tests use temporary workspaces, fake model responses, and local HTTP servers; they do not make hosted-model requests. GitHub Actions is configured for Linux and Windows on Python 3.11 and 3.12. Termux/Android is documented as a target but is not available as a hosted CI runner here, so compatibility there still needs a real-device run.
