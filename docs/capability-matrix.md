# Capability matrix and evaluation plan

This is an implementation/status matrix, not a product ranking. “Implemented” means code and local tests exist; it does **not** imply hosted-provider success, production readiness, or support verified on every OS. Current test evidence is recorded in the project change summary and CI workflows.

| Capability | Implemented now | Tested/verified scope | Not yet delivered / caveat |
|---|---|---|---|
| Model connection | Configurable named providers/profiles through OpenAI-compatible chat-completions and native Anthropic Messages adapters; environment-based keys; redirects refused | Response parsing, tool-call normalization, fake/local HTTP endpoints, missing credentials, redirect rejection and endpoint safety for both adapters | Native Gemini and other provider-specific protocols; Anthropic adapter is non-streaming with a fixed 4,096-token output budget; provider behavior/moderation cannot be overridden by STX |
| Routing and agent loop | Transparent profile selection, bounded tool loop, JSON-schema subset validation, structured outcomes, explicit incomplete status for common token/context truncation reasons | Unit tests for routing, malformed calls, tool observations, denial, provider errors, truncation, and step limits | Cost-aware/benchmark-optimized routing, true checkpoints/replay, multi-agent orchestration |
| Workspace operations | Bounded inspect/list/read/search and atomic writes; symlink/path checks | Temporary-workspace confinement, sensitive path defaults, size limits, diff/output tests | Hardening against hostile concurrent filesystem races on every OS |
| Terminal and Git | Direct argv with `shell=False`, scrubbed child environment, timeout/output bounds and cancellation; read-only Git tools | Local process execution, timeout/output truncation, cancellation and Git behavior in this Linux environment | A real OS/container sandbox; broad process-tree isolation on Windows; Git write/commit workflows |
| Project indexing | Incremental SQLite paths/hashes/languages/symbols; Python AST and selected generic symbol patterns; lexical search and bounded current-source snippets | Unit tests for symbol extraction, updates, removals, file caps, and context retrieval | Semantic/vector index, complete language parsers, call/reference graph, large-monorepo benchmarks |
| Memory | Explicit user-mediated local record/search/forget, tags, importance, TTL and purge | Persistence, retrieval, expiration, deletion and POSIX file mode tests | Automatic memory extraction; semantic truth/sensitivity validation |
| Durable tasks | Local SQLite task history, bounded worker pool, status, restart-to-interrupted behavior, cancellation, approvals and retention caps | Local fake-agent/API integration covers submission, approval, completion, auth and history behavior | Resume/replan from checkpoints; distributed workers; stress/load testing |
| Dashboard/API | Responsive multi-page owner control center; live tasks/approvals, per-task profile selection, cancellation, confirmed finished-history deletion, memory CRUD, policy-gated re-indexing, read-only settings/audit | Local HTTP tests cover settings redaction, audit/settings/overview endpoints, no-side-effect index/memory reads, confirmation/deny paths, CRUD, task deletion guards, approvals, auth, CSP/static shell | In-dashboard TOML editing, built-in TLS, production auth/roles, multi-user operation, hosted deployment; static UI is intentionally served before API authentication so remote owners can enter the bearer token |
| Security audit | Read-only `stx audit`; stable check IDs, local config/policy/storage checks, JSON output and `--strict` exit status | Unit/CLI tests use temporary configs, assert no side effects, and cover permissive policy, cleartext HTTP, wildcard hosts, retention and POSIX mode warnings | Not a complete OS scanner, remote gateway probe, dependency scanner, auto-fixer, sandbox, or NTFS ACL inspector |
| Network research | Optional HTTPS text fetch with exact/subdomain host allowlist, public-IP checks/pinning, redirect revalidation, response caps and approval | Unit tests with fake responses/DNS for sanitization, allowlist, redirects and private IP denial | Browser automation, JavaScript rendering, private-network access, auth/cookie sessions; internet live fetch not required by tests |
| MCP/plugins | No external MCP or dynamic plugin loader | Internal `Tool` extension interface only | MCP protocol/lifecycle, server trust, plugin signing/isolation and permissions |
| Cross-platform | Standard-library implementation targeting Linux, Windows and Termux | Local Linux test suite; GitHub Actions matrix configured for Ubuntu/Windows + Python 3.11/3.12 | Remote CI results must be checked; Termux/Android needs a real-device smoke test; Windows ACL and process semantics differ |
| “Uncensored” behavior | STX allows owner-selected compatible endpoints/models subject to provider API behavior | Configuration/provider adapter tests only; no claim of content policy behavior | No promise to remove provider safeguards, bypass platform rules, or guarantee any model's response policy |

## Design references

- [Claude Code permissions](https://docs.anthropic.com/en/docs/claude-code/permissions) describes permission modes and host-side enforcement. STX similarly enforces policy in local runtime code rather than relying on prompt instructions.
- [Aider repository maps](https://aider.chat/docs/repomap.html) is a public design reference for compact symbol/context maps. STX has a small incremental index and lexical retrieval, but no complete repository graph.
- [OpenHands SDK architecture](https://docs.openhands.dev/sdk/arch/overview) documents distinct agent, LLM, tool, event, workspace, and server boundaries. STX uses modular boundaries as general engineering practice, not as a claim of parity.
- [OpenClaw security audit](https://docs.openclaw.ai/gateway/security/running-the-audit) is a public operational-security reference. STX's audit is a smaller, local-only, read-only implementation; it does not claim equivalent coverage or copy upstream code.
- [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-03-26) is a public protocol reference. STX does not implement MCP; server discovery/trust, consent, policy, and lifecycle still need an audited design.

These are public design references, not endorsements or claims that STX matches the referenced products.

## Benchmark rules

1. Use public or internally authorized tasks with fixed repository revisions and explicit acceptance criteria.
2. Publish model/provider, prompt/configuration, permission mode, tool versions, cost/usage, runtime, and failure handling with each result.
3. Separate unit reliability tests (confinement, policy, timeouts, approvals) from task-level coding quality.
4. Run multiple trials for stochastic models; publish distributions and failures rather than a best run.
5. Do not claim superiority over another agent without an independently reproducible comparison.
