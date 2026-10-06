# STX Agent architecture and implementation status

**Status:** local implementation increment; updated 2026-10-06. The repository began as a README-only project. This document distinguishes code in the tree from capabilities that remain planned or platform-dependent.

## Product principle

**Build. Execute. Verify. Improve.** STX is a self-hosted engineering workbench designed around user control, explicit permissions, bounded execution, observable results, and auditable seams. It is not an unrestricted “uncensored” model and does not claim that prompts alone make tool execution safe.

## Architecture

```text
CLI ───────────────┐                 Local dashboard / HTTP API
                   └──────┬──────────────────────┘
                          v
                   Task manager / SQLite
                          |
                          v
Agent runtime ─── metadata events ─── optional JSONL recorder
  |       |
  |       +── project index / explicit expiring memory
  v
Model router -> ModelProvider protocol -> OpenAI-compatible HTTP adapter(s)
  |
  +-> tool registry -> schema check -> policy/approval gate
       +-> workspace filesystem
       +-> direct-argv terminal / read-only Git
       +-> allowlisted public HTTPS text fetch (optional)
```

The CLI and local server use the same agent, provider, policy, and tool composition. SQLite files live under the workspace's `.stx/` directory. No model credentials are written there by STX. The task database does persist user task text, answers, and approval detail to support the dashboard; see the data-retention notes below.

### Request lifecycle

1. Resolve the selected workspace and parse TOML configuration. Provider keys are read from environment variables.
2. Select a configured model profile; explicit selection overrides the small transparent keyword router.
3. Incrementally refresh the local metadata/symbol index when enabled and permitted. Retrieve a bounded set of relevant source snippets and matching explicit memories; repository/memory content is labeled untrusted.
4. Ask the configured OpenAI-compatible endpoint for a response or tool calls.
5. Validate each tool call against its schema, capability policy, risk classification, and optional user approval. Execute only after authorization; return bounded observations.
6. Stop at a final response, cancellation, provider/tool failure, or configured step limit. The CLI and dashboard report observed status; they do not claim tests passed unless they actually ran.

### Core contracts

- **Provider:** consumes messages and JSON-schema tool declarations and normalizes provider responses. The current adapter speaks an OpenAI-compatible chat-completions/tool-call shape; it is an interoperability protocol, not native adapters for every provider.
- **Tool:** stable name, JSON input schema, capability, risk level, approval detail, and typed bounded result.
- **Policy:** allow/confirm/deny. Unlisted permissions are denied. Confirmation is host-enforced and independent of prompt text.
- **Agent:** bounded model/tool loop, context assembly, stop conditions, structured metadata events, and cooperative cancellation checks.
- **Workspace:** explicit root; paths resolved beneath it; symlink escapes rejected where supported; subprocess cwd is the workspace.
- **Index:** SQLite stores paths, hashes, sizes, language, and extracted symbols, not a duplicate source corpus. Bounded snippets are read from the current workspace on demand.
- **Memory:** explicit tool-mediated local records with category, importance, tags, and expiry. No automatic memory write or claim of secret detection.
- **Task service:** SQLite-backed task/approval records, a cross-platform advisory lock allowing one dashboard/task server per workspace, bounded background workers, task cancellation, restart marking (`interrupted`), and history retention/record caps. It is not checkpoint/replay: interrupted model/tool work is not resumed.
- **Web fetch:** optional HTTPS GET to owner-allowlisted hostnames, standard port only, public DNS resolution pinned to a validated IP, bounded text response, redirect revalidation, no cookies/auth headers. It is not a browser.
- **Events:** opt-in JSONL records metadata only. Task records store the prompt and answer locally for user-visible history; task errors omit provider exception text.

## Current implementation boundary

### Implemented in the repository

- Python 3.11+ package and CLI: `init`, `inspect`, `doctor`, `index`, `search`, `run`, and `serve`.
- TOML providers/profiles, environment-based credentials, autonomy settings, and per-capability permissions.
- OpenAI-compatible provider adapter, model routing, bounded tool loop, schema validation, typed tool results, usage reporting when supplied, and metadata events.
- Workspace summary, safe list/read/search/write tools, direct-argv terminal execution, read-only Git tools, risk classifications, dry-run, and policy confirmation.
- Incremental local file/symbol indexing, lexical ranking, bounded snippets, and explicit expiring project memory.
- Local HTTP API/dashboard for task submission, status/history, per-action approval/denial, and cancellation. Local loopback is the default; non-loopback bind requires `STX_API_TOKEN` (at least 24 characters). The built-in server has no TLS.
- Optional allowlisted public HTTPS text fetch with SSRF restrictions, enabled only by configuration and permission.
- Unit and integration tests for the above, including a local fake dashboard/API task approval flow; no hosted-model request is part of the suite.

See [capability-matrix.md](capability-matrix.md) for tested scope and caveats.

### Deferred or not claimed

- Native Anthropic, Gemini, or other provider-specific wire adapters; the current supported protocol is OpenAI-compatible.
- MCP client/server lifecycle and remote tool discovery.
- Headless browser/computer-use automation.
- Arbitrary dynamic plugin loading or a plugin marketplace. Built-in tools use the `Tool` interface, but there is no third-party plugin loader.
- True resumable task checkpoints, multi-agent orchestration, retries/replanning policies, and distributed workers.
- OS/container sandbox isolation. `shell=False`, a scrubbed child environment, limits, policy, and process cleanup are defense-in-depth, not a sandbox.
- Native model management, cost/quality benchmarking, voice/computer-control surfaces, and unattended deployment.

These are not silently enabled by “autonomous” mode. Any future support must be opt-in and separately policy-gated.

## Security and technical risks

| Risk | Current mitigation | Remaining limitation |
|---|---|---|
| Generated commands run arbitrary project code | argv arrays, `shell=False`, approval defaults, env scrubbing, bounded time/output, cancellation, process-group cleanup on POSIX | No OS/container sandbox. Windows process-tree termination is limited to the direct process; users must not treat this as safe isolation. |
| Workspace path escape | Resolve paths against workspace; reject traversal and symlink escapes in supported cases | Hostile concurrent filesystem changes and all platform-specific reparse-point races are not fully eliminated. |
| Secrets enter model context | Sensitive paths denied by default; source and tool output bounded; API keys come from environment; avoid secrets in tasks/memory | No perfect secret detector. User-approved sensitive reads or task text may leave for the configured model endpoint. |
| Provider endpoint is untrusted | Endpoint is explicit; credentials not embedded in URL; secure HTTP defaults; provider timeout | OpenAI-compatible APIs vary; hosted provider retention/moderation is outside STX. |
| Browser/dashboard is exposed | Loopback by default; Host checks; remote bind requires bearer token; JSON-only bounded request bodies; restrictive CSP | HTTP has no TLS. Use a trusted TLS reverse proxy for remote access; protect the token and host OS. |
| Network tool accesses internal services | Off by default; exact/subdomain allowlist; HTTPS/443 only; DNS IP validation/pinning; non-global IPs blocked; redirects rechecked; response caps | Public allowlisted domains can still serve malicious prompt injection. DNS/host policy must be reviewed; this is not a general browser. |
| Task history contains private user data | Local `.stx/` database, configurable retention and maximum records; bounded outputs | Prompts/answers/approval detail are persisted until pruned or removed. POSIX mode bits are best-effort; Windows protection depends on ACLs. |
| Memory is incorrect or sensitive | Explicit policy-gated remember/forget; expiry; local-only storage | STX does not semantically validate the truth/sensitivity of owner-approved memory. Review and delete it. |
| Agent over-executes or loops | Per-run tool-step cap, time/output bounds, errors surfaced to model, explicit cancellation | Cancellation is cooperative between operations; an in-flight provider HTTP call can take up to its configured timeout. No full checkpoint/replay or adversarial prompt-injection benchmark. |
| False completion claim | Run status and observed results are reported; step-limit/cancel/failure statuses are explicit | Independent code review and task-specific verification remain necessary. |

### Local data and permissions

`.stx/index.sqlite3` stores inventory metadata and symbols; `.stx/memory.sqlite3` stores explicit user-approved memory; `.stx/tasks.sqlite3` stores task prompts, answers, statuses, and approval details. `stx.config.toml` may name environment variables but should not contain key values. Optional event JSONL is metadata-only. Task history is pruned by `[tasks].retention_days` and `[tasks].max_records`; memory expiration is controlled separately. On POSIX, directories/files are tightened to `0700`/`0600` where supported. On Windows, configure workspace ACLs and do not assume Unix chmod semantics.

## Verification and platform status

- The current local suite uses `unittest`, fake provider responses, temporary workspaces, and local HTTP servers. It does not make a hosted-model request.
- GitHub Actions is configured for Ubuntu and Windows with Python 3.11/3.12. The branch's remote CI results must be checked separately; local Linux tests do not prove Windows behavior.
- Termux is a target, but there is no Termux CI runner in this repository. Android process lifecycle, storage permissions, and package installation still require a real-device smoke test. See [platform notes](platforms.md).

## Evolution path

The original roadmap is now partially delivered: indexing/memory, persistent asynchronous task records, a dashboard/API, and constrained HTTP text fetch exist. MCP, native provider adapters, browser automation, plugin loading, resumable execution, and OS sandboxing remain future work. Changes should extend provider/tool/policy boundaries, include failure-mode tests, and update the capability matrix without conflating “implemented” with “verified on every platform.”
