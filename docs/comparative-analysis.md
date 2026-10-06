# STX Agent: Hermes Agent and OpenClaw architecture review

**Review date:** 2026-10-06

**Purpose:** identify strong public engineering patterns, honest STX gaps, and a safe next-step plan. This is not a product ranking or an exhaustive security certification.

## What was reviewed

I took a breadth-first inventory of the complete, non-truncated Git trees exposed by GitHub for the upstream `main` branches, then read focused source areas and official architecture/security documentation. The snapshots inspected were:

- [Hermes Agent tree at `9dcab1e`](https://github.com/NousResearch/hermes-agent/tree/9dcab1e440cdc482320af002e44036b947d6d709): 18,901 tree entries, including tests, apps, plugins, docs, and skills.
- [OpenClaw tree at `cc7e664`](https://github.com/openclaw/openclaw/tree/cc7e664dfe34fd3b0bd53473dc10d033dc5c0e29): 54,899 tree entries, including tests, extensions, packages, apps, and docs.

Tree counts are not source-file or lines-of-code counts. The upstream projects are far too large for a responsible line-by-line review in one change. This review therefore does **not** claim every file, dependency, runtime path, or vulnerability was audited.

Focused Hermes source review: [`agent/conversation_loop.py`](https://github.com/NousResearch/hermes-agent/blob/9dcab1e440cdc482320af002e44036b947d6d709/agent/conversation_loop.py), [`agent/context_engine.py`](https://github.com/NousResearch/hermes-agent/blob/9dcab1e440cdc482320af002e44036b947d6d709/agent/context_engine.py), [`agent/memory_manager.py`](https://github.com/NousResearch/hermes-agent/blob/9dcab1e440cdc482320af002e44036b947d6d709/agent/memory_manager.py), [`tools/registry.py`](https://github.com/NousResearch/hermes-agent/blob/9dcab1e440cdc482320af002e44036b947d6d709/tools/registry.py), [`tools/approval.py`](https://github.com/NousResearch/hermes-agent/blob/9dcab1e440cdc482320af002e44036b947d6d709/tools/approval.py), and [`gateway/run.py`](https://github.com/NousResearch/hermes-agent/blob/9dcab1e440cdc482320af002e44036b947d6d709/gateway/run.py). The [official Hermes architecture guide](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture) describes a shared runner, multiple provider API modes, session persistence/search, skills, memory/context seams, tool backends, gateway, and scheduling.

Focused OpenClaw source review: [`src/security/audit.ts`](https://github.com/openclaw/openclaw/blob/cc7e664dfe34fd3b0bd53473dc10d033dc5c0e29/src/security/audit.ts) and its [finding types](https://github.com/openclaw/openclaw/blob/cc7e664dfe34fd3b0bd53473dc10d033dc5c0e29/src/security/audit.types.ts), [`src/agents/embedded-agent-runner.ts`](https://github.com/openclaw/openclaw/blob/cc7e664dfe34fd3b0bd53473dc10d033dc5c0e29/src/agents/embedded-agent-runner.ts), [`src/gateway/server.ts`](https://github.com/openclaw/openclaw/blob/cc7e664dfe34fd3b0bd53473dc10d033dc5c0e29/src/gateway/server.ts), and [`src/agents/installed-skill-runtime.ts`](https://github.com/openclaw/openclaw/blob/cc7e664dfe34fd3b0bd53473dc10d033dc5c0e29/src/agents/installed-skill-runtime.ts). The official [OpenClaw security audit guide](https://docs.openclaw.ai/gateway/security/running-the-audit) and [trust model](https://docs.openclaw.ai/gateway/security/trust-model) explain its operational audit and gateway trust boundary.

No upstream source code was copied into STX. The comparison uses public architectural ideas and independently implemented code.

## Comparative findings

| Area | Hermes Agent | OpenClaw | STX today and implication |
|---|---|---|---|
| Architectural center | One agent runtime with CLI, gateway, ACP, API, and batch entry points | Gateway/control plane coordinates sessions, channels, routing, plugins, and devices | STX has a small shared agent runtime used by CLI and a local task API/dashboard. Its owner control center now also manages tasks/approvals, explicit memory, indexing, audit, and read-only settings. Keep this core small until identity and isolation contracts are strong. |
| Model APIs | Provider runtime resolves numerous provider/model combinations and multiple wire formats | Broad provider ecosystem through extensions | STX now supports OpenAI-compatible chat completions and a native Anthropic Messages adapter. Add providers through a tested protocol seam, not by assuming all APIs are wire-compatible. |
| Tool lifecycle | Large registry/toolset system, approval flow, multiple execution backends | Extensible tool, channel, provider and node surfaces, with policies and sandboxing options | STX exposes a smaller fixed built-in registry and host-enforced allow/confirm/deny policy. No external tool/plugin loader or OS sandbox exists. |
| Sessions and memory | Persistent SQLite session state/search, memory providers, context engine/compression, and reusable skills | Session-oriented gateway state, workspace context, skill/plugin mechanisms, and memory extensions | STX has durable task records, explicit expiring SQLite memory, and a local lexical code index, but no searchable conversation history, semantic memory, compression, or skills. |
| Reusable procedures | Built-in and optional skills, with agent-side creation/refinement capabilities | Human-authored/installed skills plus skill-management surfaces | STX has no skills yet. The safe next design is reviewed, versioned instruction bundles with provenance and explicit activation—not unreviewed self-modification or executable downloads. |
| Communications and scheduling | Long-running gateway with many adapters and cron jobs | Gateway is the product center for many channels, sessions, plugins, devices, and automation | STX currently serves local CLI/dashboard/API only; it has no chat gateway, mobile node, plugin marketplace, or scheduler. These are substantial projects, not checkboxes. |
| Security operations | Approval and backend-specific security controls are integrated in the runtime | Dedicated trust-model docs, stable audit findings, optional deep checks, and scoped remediations | STX now has a smaller, local-only, read-only `stx audit`. It is deliberately not presented as equivalent to OpenClaw's broader deployment audit. Neither prompts nor the STX audit are a sandbox. |
| Evaluation and reliability | Large tests/evals across many integrations and providers | Large test surface across gateway, plugins, platforms, tools, and security controls | STX currently has focused unit/integration tests and CI. It has no independently reproduced task-quality benchmark, live provider test suite, or Termux device evidence. |

## Changes made from this review

### Native Anthropic provider adapter

STX adds an independently implemented adapter for Anthropic's Messages API alongside OpenAI-compatible endpoints. It maps STX tool schemas, assistant tool calls, and tool results between the two API shapes; keeps credentials in the configured environment variable; enforces HTTPS for remote endpoints by default; rejects redirects; bounds response size; and rejects unsupported temperatures. Fake/local HTTP tests exercise the wire contract without using a hosted model or sending credentials to the real provider.

This closes a concrete interoperability gap but is not parity with the much broader provider catalogs in Hermes or OpenClaw. Streaming, provider-specific OAuth, retry/fallback policy, Gemini-native APIs, and provider-specific capability discovery remain future work.

### Read-only `stx audit`

STX adds stable check IDs and human/JSON output for local policy, insecure provider transport, wildcard host allowlists, data retention, and observable POSIX file modes. `--strict` makes warnings fail in automation. It performs no network probes, no command execution, no auto-fixes, and no config writes. Windows ACLs are explicitly not inspected; the command reports that limitation when relevant.

This is a smaller scope than OpenClaw's gateway/deployment-oriented audit and is not a substitute for OS isolation, a dependency scanner, a manual review, or a remote service exposure assessment.

### Owner control center expansion

STX's dependency-free dashboard has been extended into a responsive owner console for current task status, approval decisions, per-task profiles, cancellation, confirmed removal of finished task records, explicit memory CRUD, and policy-confirmed index refreshes. It also surfaces sanitized provider readiness, effective permissions, built-in tools, runtime limits, and the read-only audit. Provider secrets are never returned by the settings API. TOML editing, provider installation, external plugins, roles, and multi-user management remain intentionally out of scope until safe persistence and identity boundaries are designed.

The GUI is independently implemented with the repository's existing standard-library HTTP service and static assets; no Hermes or OpenClaw source was copied. A broader UI does not imply feature parity or a more capable agent runtime.

## What “better” should mean—and how not to overclaim it

A blanket claim that STX is “better than Hermes” or “better than OpenClaw” would not be supported by this review. They have far broader surface area and years of integration work. STX should compete on a deliberately testable target:

1. **Permission correctness:** denied operations have no side effects; approvals identify the exact action; policies default closed for unknown capabilities.
2. **Evidence-backed completion:** report actual tool/test results and explicit failure or uncertainty; never imply verification from a model answer alone.
3. **Data minimization and provenance:** show which task/context/memory data can leave the device; keep user-approved facts distinct from retrieved untrusted text.
4. **Portability:** run the same deterministic safety tests on Linux and Windows and publish real Termux device results separately.
5. **Reproducibility:** compare agents on fixed public tasks, same model/version/budget, multiple trials, recorded costs, and published failures. Do not use star counts or a best-case demo as an engineering benchmark.

## Prioritized roadmap

1. **Reviewed skills with provenance:** human/agent-authored drafts, content hashes and origin metadata, explicit human review before activation, version/rollback, progressive disclosure, and read-only install by default. Skills must never elevate tool permissions or execute code by themselves.
2. **Evidence ledger and session retrieval:** searchable task/run history with bounded, redacted structured events, data-retention controls, and explicit trust labels for user input, local files, memory, model output, and tool observations. Persist evidence/actions/results, not hidden reasoning.
3. **Context quality and resilience:** measured token/context budgets, truncation visibility, optional compaction with provenance, interruption/failure tests, and no silent context corruption.
4. **Provider conformance:** add native APIs only with schema/round-trip tests, local fake endpoints, key isolation, error redaction, and published supported capabilities. Add streaming only with interruption and partial-response tests.
5. **Execution isolation:** design a true per-task OS/container boundary with filesystem/network/resource policy and explicit platform-specific backends. Direct argv, environment scrubbing, and confirmation are not a sandbox.
6. **More surfaces later:** gateway channels, schedulers, subagents, MCP, and external plugins only after requester identity, authorization, lifecycle, persistence, and abuse tests exist. Separate mutually untrusted users into separate trust boundaries.
7. **Reproducible evaluation:** establish correctness, security, cost, latency, and cross-platform benchmarks before making comparative performance claims.

## Source index

- Hermes Agent repository and [architecture documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture).
- OpenClaw repository, [security audit guide](https://docs.openclaw.ai/gateway/security/running-the-audit), and [trust model](https://docs.openclaw.ai/gateway/security/trust-model).
- STX implementation status and platform caveats: [capability matrix](capability-matrix.md), [platform notes](platforms.md), [architecture](architecture.md).
