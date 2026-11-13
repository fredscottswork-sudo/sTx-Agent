"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CheckStatus,
  EmailReport,
  IdentityReport,
  PhoneReport,
  ReportPayload,
  SiteResult,
} from "@/lib/types";
import { copyText, downloadText, postJson, streamPost, STATUS_LABEL } from "@/lib/client";

/* ── Shared ─────────────────────────────────────────────── */

export function Card({
  title,
  ico,
  hint,
  right,
  children,
}: {
  title: string;
  ico?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2 className="card-title">
            {ico && <span className="ico">{ico}</span>}
            {title}
          </h2>
          {hint && <p className="card-hint">{hint}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: CheckStatus }) {
  return <span className={`pill ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-box">⚠ {error}</div>;
}

const CAT_ORDER: Record<string, number> = {
  found: 0,
  unknown: 1,
  skipped: 2,
  missing: 3,
};

/* ── Username ───────────────────────────────────────────── */

export function UsernamePanel({
  onCollect,
}: {
  onCollect: (patch: Partial<ReportPayload>) => void;
}) {
  const [username, setUsername] = useState("");
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SiteResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const resultsRef = useRef<SiteResult[]>([]);

  const stats = useMemo(() => {
    let found = 0,
      missing = 0,
      unknown = 0;
    for (const r of results) {
      if (r.status === "found") found++;
      else if (r.status === "missing") missing++;
      else unknown++;
    }
    return { found, missing, unknown };
  }, [results]);

  const sorted = useMemo(
    () => [...results].sort((a, b) => CAT_ORDER[a.status] - CAT_ORDER[b.status]),
    [results],
  );

  async function run() {
    const u = username.trim();
    if (!u || running) return;
    setRunning(true);
    setError(null);
    setResults([]);
    resultsRef.current = [];
    setProgress(0);
    setTotal(0);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      await streamPost("/api/username", { username: u }, (ev) => {
        if (ev.type === "meta") setTotal(ev.total);
        else if (ev.type === "result") {
          resultsRef.current = [...resultsRef.current, ev.result];
          setResults(resultsRef.current);
          setProgress(ev.progress);
        } else if (ev.type === "done") {
          onCollect({ username: { value: u, results: resultsRef.current } });
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed unexpectedly.");
    } finally {
      clearInterval(tick);
      setRunning(false);
      setElapsed((Date.now() - t0) / 1000);
    }
  }

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Card
      title="Username deep search"
      ico="@"
      hint={`Checks ${""}public profile URLs across ${""}social, developer, gaming and creative platforms. Results stream in live. Login-walled sites are reported as inconclusive rather than guessed.`}
      right={
        <span className="pill info mono">
          {results.length || total || "—"} sites
        </span>
      }
    >
      <div className="field-row">
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="e.g. fredscottswork"
          spellCheck={false}
          autoCapitalize="none"
          disabled={running}
        />
        <button className="btn btn-primary" onClick={run} disabled={running || !username.trim()}>
          {running ? "Scanning…" : "Run scan"}
        </button>
      </div>

      {running && (
        <div className="mt14">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {progress} / {total || "…"} checked
            </span>
            <span>{elapsed.toFixed(1)}s elapsed</span>
          </div>
        </div>
      )}

      {!running && results.length > 0 && (
        <div className="stats">
          <div className="stat good">
            <div className="stat-v">{stats.found}</div>
            <div className="stat-l">found</div>
          </div>
          <div className="stat warn">
            <div className="stat-v">{stats.unknown}</div>
            <div className="stat-l">inconclusive</div>
          </div>
          <div className="stat bad">
            <div className="stat-v">{stats.missing}</div>
            <div className="stat-l">not found</div>
          </div>
          <div className="stat blue">
            <div className="stat-v">{elapsed.toFixed(1)}s</div>
            <div className="stat-l">duration</div>
          </div>
        </div>
      )}

      <ErrorBox error={error} />

      {results.length > 0 && (
        <div className="site-list mt14">
          {sorted.map((r, i) => {
            const inner = (
              <>
                <span className={`dot ${r.status}`} />
                <span className="site-name">{r.site}</span>
                <span className="chip">{r.category}</span>
                <span className="site-note">{r.note ?? STATUS_LABEL[r.status]}</span>
                <span className="site-ms">{r.ms ? `${r.ms}ms` : ""}</span>
              </>
            );
            return r.status === "found" ? (
              <a key={`${r.site}-${i}`} className="site-row" href={r.url} target="_blank" rel="noopener noreferrer">
                {inner}
              </a>
            ) : (
              <div key={`${r.site}-${i}`} className="site-row">
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {results.length === 0 && !running && !error && (
        <div className="empty-box mt14">
          Enter a username to sweep {""}public profile endpoints. Only public pages are queried — no logins, no CAPTCHA bypass.
        </div>
      )}
    </Card>
  );
}

/* ── Email ──────────────────────────────────────────────── */

export function EmailPanel({ onCollect }: { onCollect: (patch: Partial<ReportPayload>) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EmailReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<EmailReport>("/api/email", { email: email.trim() });
      setReport(r);
      onCollect({ email: r });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  const g = report?.gravatar;

  return (
    <Card
      title="Email intelligence"
      ico="✉"
      hint="Validates the address, resolves domain mail records, detects providers and throwaway domains, and pulls the public Gravatar profile the owner published for that hash (linked accounts, display name, location)."
      right={
        report ? (
          <span className={`pill ${report.disposable ? "warn" : "good"}`}>
            {report.disposable ? "disposable" : "valid"}
          </span>
        ) : undefined
      }
    >
      <div className="field-row">
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="someone@example.com"
          spellCheck={false}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={run} disabled={busy || !email.trim()}>
          {busy ? "Looking up…" : "Run lookup"}
        </button>
      </div>

      <ErrorBox error={error} />

      {report && (
        <div className="mt14">
          <dl className="kv">
            <dt>Provider</dt>
            <dd>
              {report.provider ?? "custom domain"}
              {report.disposable && (
                <>
                  {" "}
                  <span className="pill warn">throwaway</span>
                </>
              )}
            </dd>
            <dt>Domain</dt>
            <dd>{report.domain}</dd>
            <dt>Mail exchangers</dt>
            <dd>
              {report.mxOk ? (
                report.mx.map((m) => `${m.exchange} (prio ${m.priority})`).join(", ")
              ) : (
                <span className="pill bad">no MX found</span>
              )}
            </dd>
            {g && (
              <>
                <dt>Gravatar hash</dt>
                <dd>
                  {g.hash}{" "}
                  {g.hasAvatar ? (
                    <a href={g.profileUrl ?? "#"} target="_blank" rel="noopener noreferrer">
                      public profile ↗
                    </a>
                  ) : (
                    <span className="pill dim">no avatar</span>
                  )}
                </dd>
              </>
            )}
            <dt>Breaches</dt>
            <dd>
              {report.breaches === null ? (
                <span className="muted">not checked (no API key)</span>
              ) : report.breaches.length === 0 ? (
                <span className="pill good">none found</span>
              ) : (
                <span className="pill bad">{report.breaches.length} breach(es)</span>
              )}
            </dd>
          </dl>

          {report.breaches && report.breaches.length > 0 && (
            <div className="link-list">
              {report.breaches.map((b) => (
                <span key={b} className="link-tag">
                  {b}
                </span>
              ))}
            </div>
          )}

          {g && (g.displayName || g.location || g.description || g.jobs?.length) && (
            <>
              <div className="section-sub">Owner-published Gravatar profile</div>
              <dl className="kv">
                {g.displayName && (
                  <>
                    <dt>Display name</dt>
                    <dd>{g.displayName}</dd>
                  </>
                )}
                {g.location && (
                  <>
                    <dt>Location</dt>
                    <dd>{g.location}</dd>
                  </>
                )}
                {g.description && (
                  <>
                    <dt>Bio</dt>
                    <dd>{g.description}</dd>
                  </>
                )}
                {g.jobs && g.jobs.length > 0 && (
                  <>
                    <dt>Jobs</dt>
                    <dd>{g.jobs.join(" · ")}</dd>
                  </>
                )}
              </dl>
            </>
          )}

          {g?.accounts && g.accounts.length > 0 && (
            <>
              <div className="section-sub">Linked accounts exposed by the owner</div>
              <div className="link-list">
                {g.accounts.map((a) => (
                  <a key={a.url + a.shortname} className="link-tag" href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.shortname} ↗
                  </a>
                ))}
              </div>
            </>
          )}

          <ul className="notes">
            {report.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {!report && !error && (
        <div className="empty-box mt14">
          Enter an email to resolve its public footprint — mail infrastructure, provider, Gravatar profile and (optionally) breach history.
        </div>
      )}
    </Card>
  );
}

/* ── Phone ──────────────────────────────────────────────── */

export function PhonePanel({ onCollect }: { onCollect: (patch: Partial<ReportPayload>) => void }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PhoneReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy || !phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<PhoneReport>("/api/phone", { phone: phone.trim() });
      setReport(r);
      onCollect({ phone: r });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  const e164 = report?.e164;
  const e164no = e164 ? e164.replace(/^\+/, "") : "";

  return (
    <Card
      title="Phone number analysis"
      ico="☎"
      hint="Parses and validates international numbers (E.164), identifies country and line type, and generates deep-search shortcuts. No calls or SMS are ever sent."
      right={
        report ? (
          <span className={`pill ${report.valid ? "good" : "warn"}`}>
            {report.valid ? "valid" : report.possible ? "possible" : "invalid"}
          </span>
        ) : undefined
      }
    >
      <div className="field-row">
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="+256 772 123 456"
          spellCheck={false}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={run} disabled={busy || !phone.trim()}>
          {busy ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      <ErrorBox error={error} />

      {report && (
        <div className="mt14">
          <dl className="kv">
            <dt>E.164</dt>
            <dd>{report.e164 ?? "—"}</dd>
            <dt>International</dt>
            <dd>{report.international ?? "—"}</dd>
            <dt>National</dt>
            <dd>{report.national ?? "—"}</dd>
            <dt>Country</dt>
            <dd>
              {report.countryName ?? report.country ?? "unknown"}{" "}
              {report.countryCode && <span className="pill info">{report.countryCode}</span>}
            </dd>
            <dt>Line type</dt>
            <dd>{report.type ?? "unknown"}</dd>
          </dl>

          {e164 && (
            <>
              <div className="section-sub">Deep-search shortcuts</div>
              <div className="dork-grid">
                <a
                  className="dork"
                  href={`https://www.google.com/search?q=${encodeURIComponent(`"${e164}"`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google <span>exact number</span>
                </a>
                <a
                  className="dork"
                  href={`https://duckduckgo.com/?q=${encodeURIComponent(`"${e164}"`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  DuckDuckGo <span>exact number</span>
                </a>
                <a
                  className="dork"
                  href={`https://www.google.com/search?q=${encodeURIComponent(`site:truecaller.com "${e164}"`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Truecaller <span>via index</span>
                </a>
                <a
                  className="dork"
                  href={`https://wa.me/${e164no}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp <span>chat draft</span>
                </a>
              </div>
            </>
          )}

          <ul className="notes mt14">
            {report.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {!report && !error && (
        <div className="empty-box mt14">
          Enter a number with country code (e.g. +256…) to validate it and open deep-search shortcuts.
        </div>
      )}
    </Card>
  );
}

/* ── Identity / name ────────────────────────────────────── */

interface IdentityResponse extends IdentityReport {
  dorks: { engine: string; url: string }[];
}

export function IdentityPanel({ onCollect }: { onCollect: (patch: Partial<ReportPayload>) => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<IdentityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<IdentityResponse>("/api/search", {
        name: name.trim(),
        location: location.trim(),
      });
      setReport(r);
      onCollect({ identity: r });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Identity deep search"
      ico="◉"
      hint="Correlates a name against public knowledge bases (Wikidata → Wikipedia) and the researcher registry ORCID, then arms you with ready-to-run search-engine dorks for the open web."
      right={report ? <span className="pill info mono">{report.wikidata.length + report.orcid.length} candidates</span> : undefined}
    >
      <div className="field-row">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Full name, e.g. Jane A. Doe"
          spellCheck={false}
          disabled={busy}
          style={{ flex: 2 }}
        />
        <input
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Location (optional)"
          spellCheck={false}
          disabled={busy}
          style={{ flex: 1, minWidth: 150 }}
        />
        <button className="btn btn-primary" onClick={run} disabled={busy || !name.trim()}>
          {busy ? "Searching…" : "Deep search"}
        </button>
      </div>

      <ErrorBox error={error} />

      {report && (
        <div className="mt14">
          {report.wikidata.length > 0 && (
            <>
              <div className="section-sub">Wikidata → Wikipedia candidates</div>
              <div className="cand-list">
                {report.wikidata.map((w) => (
                  <div key={w.id} className="cand">
                    <div className="cand-title">
                      {w.label} <span className="chip">{w.id}</span>
                    </div>
                    {w.description && <div className="cand-desc">{w.description}</div>}
                    <div className="cand-links">
                      <a href={w.url} target="_blank" rel="noopener noreferrer">
                        wikidata ↗
                      </a>
                      {w.wikipedia && (
                        <a href={w.wikipedia} target="_blank" rel="noopener noreferrer">
                          wikipedia ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report.orcid.length > 0 && (
            <>
              <div className="section-sub">ORCID researcher records</div>
              <div className="cand-list">
                {report.orcid.map((o) => (
                  <div key={o.orcid} className="cand">
                    <div className="cand-title">
                      {o.givenNames ?? "?"} {o.familyNames ?? "?"}{" "}
                      <span className="chip">{o.orcid}</span>
                    </div>
                    <div className="cand-links">
                      <a href={o.url} target="_blank" rel="noopener noreferrer">
                        orcid record ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-sub">Open-web dorks — run to continue the trace</div>
          <div className="dork-grid">
            {report.dorks.map((d) => (
              <a key={d.engine} className="dork" href={d.url} target="_blank" rel="noopener noreferrer">
                {d.engine} <span>open ↗</span>
              </a>
            ))}
          </div>

          <ul className="notes mt14">
            {report.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {!report && !error && (
        <div className="empty-box mt14">
          Enter a name to query public knowledge bases and generate targeted search dorks.
        </div>
      )}
    </Card>
  );
}

/* ── Report ─────────────────────────────────────────────── */

interface ReportResponse {
  engine: "llm" | "heuristic";
  model: string | null;
  text: string;
  findings: string;
  llmNote?: string;
}

export function ReportPanel({ findings }: { findings: Partial<ReportPayload> }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ready = {
    username: Boolean(findings.username?.results?.length),
    email: Boolean(findings.email),
    phone: Boolean(findings.phone),
    identity: Boolean(findings.identity),
    face: Boolean(findings.face),
  };
  const anyReady = Object.values(ready).some(Boolean);

  function payload(): ReportPayload {
    return {
      target: {
        username: findings.username?.value,
        email: findings.email?.email,
        phone: findings.phone?.e164 ?? findings.phone?.input,
        name: findings.identity?.name,
      },
      username: findings.username,
      email: findings.email,
      phone: findings.phone,
      identity: findings.identity,
      face: findings.face,
    };
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<ReportResponse>("/api/report", payload());
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doCopy() {
    if (!report) return;
    await copyText(report.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Card
      title="AI intelligence report"
      ico="☰"
      hint="Synthesizes every module you've run into a single structured brief. With OPENAI_API_KEY configured the narrative is written by an LLM; otherwise a deterministic analyst template is used."
      right={
        report ? (
          <span className={`pill ${report.engine === "llm" ? "good" : "warn"}`}>
            {report.engine === "llm" ? `LLM · ${report.model ?? "model"}` : "heuristic"}
          </span>
        ) : undefined
      }
    >
      <div className="readiness">
        <span className={`ready-chip ${ready.username ? "on" : ""}`}>
          {ready.username ? "✓" : "○"} username
        </span>
        <span className={`ready-chip ${ready.email ? "on" : ""}`}>{ready.email ? "✓" : "○"} email</span>
        <span className={`ready-chip ${ready.phone ? "on" : ""}`}>{ready.phone ? "✓" : "○"} phone</span>
        <span className={`ready-chip ${ready.identity ? "on" : ""}`}>
          {ready.identity ? "✓" : "○"} identity
        </span>
        <span className={`ready-chip ${ready.face ? "on" : ""}`}>{ready.face ? "✓" : "○"} face</span>
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={generate} disabled={busy || !anyReady}>
          {busy ? "Synthesizing…" : report ? "Regenerate report" : "Generate report"}
        </button>
        {report && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={doCopy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                downloadText(
                  `stx-trace-report-${new Date().toISOString().slice(0, 10)}.md`,
                  report.text,
                )
              }
            >
              Download .md
            </button>
          </>
        )}
        <span className="spacer" />
        {!anyReady && <span className="small muted">Run at least one module first.</span>}
      </div>

      <ErrorBox error={error} />

      {report?.llmNote && (
        <div className="engine-row">
          <span className="pill warn">note</span>
          <span className="small muted">{report.llmNote}</span>
        </div>
      )}

      {report && (
        <div className="engine-row">
          <span className="pill info">engine</span>
          <span className="small mono muted">
            {report.engine === "llm" ? `llm · ${report.model}` : "deterministic template"}
          </span>
        </div>
      )}

      {report ? (
        <pre className="report-pre">{report.text}</pre>
      ) : (
        !error && (
          <div className="empty-box">
            Collect findings from the other tabs, then generate a consolidated intelligence brief.
          </div>
        )
      )}
    </Card>
  );
}
