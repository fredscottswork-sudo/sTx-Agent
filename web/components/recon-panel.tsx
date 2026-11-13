"use client";

import { useMemo, useRef, useState } from "react";
import { copyText, downloadText, streamPost } from "@/lib/client";
import {
  bingUrl,
  ddgUrl,
  dohQuery,
  emailPatterns,
  googleUrl,
  githubSearchUrl,
  hackingDorks,
} from "@/lib/recon";
import type {
  AuditResult,
  DnsRecord,
  DorkCat,
  HostProbe,
  PathHit,
  PortResult,
  TlsInfo,
  WaybackRow,
} from "@/lib/recon";
import { Card, EmptyBox, ErrorBox } from "./common";

type Mode = "domain" | "ports" | "paths" | "history" | "dorks" | "people";

const MODES: { id: Mode; label: string }[] = [
  { id: "domain", label: "🛰 Domain recon" },
  { id: "ports", label: "🔌 Port scan" },
  { id: "paths", label: "🧭 URL finder" },
  { id: "history", label: "📜 Wayback" },
  { id: "dorks", label: "🔎 Google dorks" },
  { id: "people", label: "👤 People hunter" },
];

const PHASE_PCT: Record<string, number> = {
  ct: 0.1,
  dns: 0.18,
  brute: 0.38,
  probe: 0.72,
  tls: 0.84,
  files: 0.93,
  audit: 0.98,
  done: 1,
};

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "good";
  if (status >= 300 && status < 400) return "info";
  if (status >= 400 && status < 500) return "warn";
  return "bad";
}

function daysLeft(validTo?: string): string {
  if (!validTo) return "";
  const d = Math.round((Date.parse(validTo) - Date.now()) / 86_400_000);
  if (Number.isNaN(d)) return "";
  return d >= 0 ? `${d}d left` : `expired ${-d}d ago`;
}

function csvEscape(c: string): string {
  return `"${String(c).replace(/"/g, '""')}"`;
}

export function ReconPanel() {
  const [mode, setMode] = useState<Mode>("domain");

  return (
    <Card
      title="Recon suite"
      ico="🛰"
      hint="Six real scanners — live DNS over HTTPS, certificate transparency, TLS handshakes, HTTP header audits, TCP port connects, content discovery and Wayback Machine history. Every row is an actual network response; nothing is simulated."
      right={<span className="pill info mono">6 tools</span>}
    >
      <div className="mode-toggle recon-modes" role="radiogroup" aria-label="Recon tool">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            className={`mode-btn ${mode === m.id ? "on" : ""}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "domain" && <DomainMode />}
      {mode === "ports" && <PortsMode />}
      {mode === "paths" && <PathsMode />}
      {mode === "history" && <HistoryMode />}
      {mode === "dorks" && <DorksMode />}
      {mode === "people" && <PeopleMode />}
    </Card>
  );
}

/* ─────────────────────── domain recon ─────────────────────── */

interface CtState {
  count: number;
  subs: string[];
  ms: number;
  error?: string;
}
interface BruteState {
  hits: { sub: string; ips: string[]; wildcard: boolean }[];
  checked: number;
  ms: number;
  error?: string;
}
interface FileState {
  kind: string;
  status: number;
  lines: number;
  excerpt: string;
  ms: number;
  error?: string;
}

function DomainMode() {
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState("");
  const [pct, setPct] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [wildcard, setWildcard] = useState<{ active: boolean; ips: string[] } | null>(null);
  const [ct, setCt] = useState<CtState | null>(null);
  const [brute, setBrute] = useState<BruteState | null>(null);
  const [hosts, setHosts] = useState<HostProbe[]>([]);
  const [tls, setTls] = useState<TlsInfo[]>([]);
  const [files, setFiles] = useState<FileState[]>([]);
  const [cors, setCors] = useState<Record<string, unknown> | null>(null);
  const [rdap, setRdap] = useState<Record<string, unknown> | null>(null);
  const [net, setNet] = useState<Record<string, unknown> | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [done, setDone] = useState<Record<string, unknown> | null>(null);
  const hostsRef = useRef<HostProbe[]>([]);
  const tlsRef = useRef<TlsInfo[]>([]);

  const subList = useMemo(() => {
    const map = new Map<string, { sources: Set<string>; wildcard: boolean }>();
    for (const s of ct?.subs ?? []) {
      map.set(s, { sources: new Set(["CT"]), wildcard: false });
    }
    for (const h of brute?.hits ?? []) {
      const e = map.get(h.sub) ?? { sources: new Set<string>(), wildcard: false };
      e.sources.add(h.wildcard ? "brute?" : "brute");
      if (h.wildcard) e.wildcard = true;
      map.set(h.sub, e);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ct, brute]);

  async function run() {
    const t = target.trim();
    if (!t || running) return;
    setRunning(true);
    setError(null);
    setPct(0);
    setPhase("starting");
    setElapsed(0);
    setRecords([]);
    setWildcard(null);
    setCt(null);
    setBrute(null);
    setHosts([]);
    setTls([]);
    setFiles([]);
    setCors(null);
    setRdap(null);
    setNet(null);
    setAudit(null);
    setDone(null);
    hostsRef.current = [];
    tlsRef.current = [];
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      await streamPost("/api/recon/domain", { domain: t }, (ev) => {
        switch (ev.type) {
          case "phase":
            setPhase(ev.label || ev.phase);
            setPct((p) => Math.max(p, PHASE_PCT[ev.phase] ?? p));
            break;
          case "dns":
            setRecords(ev.records);
            setWildcard(ev.wildcard);
            break;
          case "ct":
            setCt({ count: ev.count, subs: ev.subs, ms: ev.ms, error: ev.error });
            break;
          case "brute":
            setBrute({ hits: ev.hits, checked: ev.checked, ms: ev.ms, error: ev.error });
            break;
          case "host":
            hostsRef.current = [...hostsRef.current, ev.probe];
            setHosts(hostsRef.current);
            break;
          case "tls":
            tlsRef.current = [...tlsRef.current, ev.info];
            setTls(tlsRef.current);
            break;
          case "file":
            setFiles((f) => [...f, ev as unknown as FileState]);
            break;
          case "cors":
            setCors(ev);
            break;
          case "rdap":
            setRdap(ev);
            break;
          case "net":
            setNet(ev);
            break;
          case "audit":
            if (!ev.skipped) setAudit(ev.result as AuditResult);
            break;
          case "done":
            setDone(ev);
            setPct(1);
            setPhase("done");
            break;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recon failed.");
    } finally {
      clearInterval(tick);
      setRunning(false);
      setElapsed((Date.now() - t0) / 1000);
    }
  }

  const fails = audit?.checks.filter((c) => c.state === "fail").length ?? 0;
  const warns = audit?.checks.filter((c) => c.state === "warn").length ?? 0;
  const liveHosts = hosts.filter((h) => h.status > 0).length;

  function exportJson() {
    downloadText(
      `stx-trace-recon-${target.trim()}.json`,
      JSON.stringify(
        {
          domain: target.trim(),
          generatedAt: new Date().toISOString(),
          dns: records,
          wildcard,
          certificateTransparency: ct,
          dnsBruteForce: brute,
          hosts,
          tls,
          files,
          cors,
          rdap,
          net,
          audit,
        },
        null,
        2,
      ),
    );
  }

  return (
    <>
      <div className="field-row mt14">
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="target domain — e.g. example.com"
          spellCheck={false}
          autoCapitalize="none"
          disabled={running}
        />
        <button className="btn btn-primary" onClick={run} disabled={running || !target.trim()}>
          {running ? "Scanning…" : "Run recon"}
        </button>
      </div>
      <div className="small muted mt8">
        Actively probes the target (DNS, TLS, HTTP, TCP) from our server. Only scan domains you own
        or have permission to test.
      </div>

      {running && (
        <div className="mt14">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <div className="progress-meta">
            <span>{phase}</span>
            <span>{elapsed.toFixed(1)}s elapsed</span>
          </div>
        </div>
      )}

      <ErrorBox error={error} />

      {(records.length > 0 || hosts.length > 0 || ct || brute) && (
        <div className="stats">
          <div className="stat blue">
            <div className="stat-v">{subList.length}</div>
            <div className="stat-l">subdomains</div>
          </div>
          <div className="stat">
            <div className="stat-v">{hosts.length}</div>
            <div className="stat-l">hosts probed</div>
          </div>
          <div className="stat">
            <div className="stat-v">{liveHosts}</div>
            <div className="stat-l">responding</div>
          </div>
          <div className={`stat ${audit ? (audit.grade === "A" || audit.grade === "B" ? "good" : audit.grade === "F" ? "bad" : "warn") : ""}`}>
            <div className="stat-v">{audit?.grade ?? "—"}</div>
            <div className="stat-l">security grade</div>
          </div>
          <div className={`stat ${fails ? "bad" : warns ? "warn" : "good"}`}>
            <div className="stat-v">
              {audit ? `${fails}/${warns}` : "—"}
            </div>
            <div className="stat-l">fails / warns</div>
          </div>
        </div>
      )}

      {audit && (
        <>
          <div className="section-sub">Security header audit — {audit.url}</div>
          <div className="audit-wrap">
            <div className={`grade-badge g-${audit.grade.toLowerCase()}`} title={`score ${audit.score}/100`}>
              {audit.grade}
            </div>
            <div className="check-list">
              {audit.checks.map((c) => (
                <div key={c.id} className={`check-row ${c.state}`}>
                  <span className="check-ic">
                    {c.state === "pass" ? "✓" : c.state === "warn" ? "!" : c.state === "fail" ? "✕" : "·"}
                  </span>
                  <span className="check-label">{c.label}</span>
                  <span className="check-detail">{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {hosts.length > 0 && (
        <>
          <div className="section-sub">Live hosts ({hosts.length})</div>
          <div className="log-list">
            {hosts.map((h) => (
              <div key={h.host + h.url} className="log-row">
                <a
                  className={`dot ${h.status > 0 ? (h.status < 400 ? "found" : "unknown") : "missing"}`}
                  title={h.host}
                />
                <span className="grow mono">
                  <a href={h.url} target="_blank" rel="noopener noreferrer">
                    {h.host}
                  </a>
                </span>
                {h.error ? (
                  <span className="pill bad">{h.error}</span>
                ) : (
                  <span className={`pill ${statusClass(h.status)}`}>
                    {h.status} {h.statusText}
                  </span>
                )}
                <span className="grow muted small" title={h.title}>
                  {h.title || h.redirect || ""}
                </span>
                <span className="row" style={{ gap: 5 }}>
                  {(h.tech ?? []).slice(0, 5).map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </span>
                <span className="small muted mono">{h.ms}ms</span>
              </div>
            ))}
          </div>
        </>
      )}

      {subList.length > 0 && (
        <>
          <div className="section-sub">
            Subdomains ({subList.length}) — CT = certificate transparency, brute = DNS wordlist
          </div>
          <div className="link-list">
            {subList.map(([name, meta]) => (
              <a
                key={name}
                className="link-tag"
                href={`https://${name}`}
                target="_blank"
                rel="noopener noreferrer"
                title={meta.wildcard ? "wildcard DNS — may not be a real host" : [...meta.sources].join(" + ")}
              >
                {name.replace(`.${target.trim().toLowerCase()}`, "")}
                <span className="sub-src"> {[...meta.sources].join("+")} </span>
              </a>
            ))}
          </div>
          {wildcard?.active && (
            <div className="small warn-text mt8">
              ⚠ Wildcard DNS detected ({wildcard.ips.join(", ")}) — brute-force hits resolving to
              those IPs may be false positives.
            </div>
          )}
        </>
      )}

      {records.length > 0 && (
        <>
          <div className="section-sub">DNS records (over HTTPS · Cloudflare + Google)</div>
          <div className="dns-table">
            {records.map((r) => (
              <div key={r.type} className="dns-row">
                <b>{r.type}</b>
                <span>
                  {r.error && <em className="warn-text">{r.error}</em>}
                  {!r.error && r.data.length === 0 && <em className="muted">no records</em>}
                  {r.data.map((d) => (
                    <span key={d} className="dns-val">
                      {d}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {tls.length > 0 && (
        <>
          <div className="section-sub">TLS certificates (real handshake)</div>
          {tls.map((t) => (
            <div key={t.host} className="cand mt8">
              <div className="cand-title">
                {t.host}{" "}
                {t.error ? (
                  <span className="pill bad">{t.error}</span>
                ) : (
                  <span className={`pill ${t.selfSigned || t.authorized === false ? "warn" : "good"}`}>
                    {t.selfSigned ? "self-signed" : t.authorized === false ? "untrusted chain" : "trusted"}
                  </span>
                )}
              </div>
              {!t.error && (
                <dl className="kv">
                  <dt>Issuer</dt>
                  <dd>{t.issuer || "—"}</dd>
                  <dt>Subject</dt>
                  <dd>{t.subject || "—"}</dd>
                  <dt>Valid</dt>
                  <dd>
                    {t.validFrom} → {t.validTo} {daysLeft(t.validTo) && `· ${daysLeft(t.validTo)}`}
                  </dd>
                  <dt>SANs</dt>
                  <dd>{(t.san ?? []).slice(0, 6).join(", ") || "—"}</dd>
                  <dt>Protocol</dt>
                  <dd>
                    {t.protocol} · {t.cipher}
                  </dd>
                </dl>
              )}
            </div>
          ))}
        </>
      )}

      {files.some((f) => f.status > 0) && (
        <>
          <div className="section-sub">Well-known files</div>
          {files
            .filter((f) => f.status > 0)
            .map((f) => (
              <div key={f.kind} className="cand mt8">
                <div className="cand-title">
                  {f.kind === "robots" ? "robots.txt" : f.kind === "security" ? ".well-known/security.txt" : "sitemap.xml"}{" "}
                  <span className={`pill ${statusClass(f.status)}`}>HTTP {f.status}</span>{" "}
                  <span className="chip">{f.lines} lines</span>
                </div>
                {f.excerpt && <pre className="report-pre">{f.excerpt}</pre>}
              </div>
            ))}
        </>
      )}

      {cors && (
        <>
          <div className="section-sub">CORS configuration (OPTIONS probe)</div>
          <div className={`cand mt8 ${String(cors.risk || "").startsWith("CRITICAL") ? "cand-crit" : ""}`}>
            <div className="cand-title">{String(cors.risk ?? cors.error ?? "—")}</div>
            <dl className="kv">
              <dt>Allow-Origin</dt>
              <dd>{String(cors.acao ?? "not sent")}</dd>
              <dt>Allow-Credentials</dt>
              <dd>{String(cors.acac ?? "not sent")}</dd>
              <dt>Allow-Methods</dt>
              <dd>{String(cors.methods ?? "not sent")}</dd>
            </dl>
          </div>
        </>
      )}

      {rdap && (
        <>
          <div className="section-sub">Domain registration (RDAP)</div>
          <dl className="kv">
            <dt>Registrar</dt>
            <dd>{String(rdap.registrar || rdap.error || "—")}</dd>
            <dt>Created</dt>
            <dd>{String(rdap.created || "—")}</dd>
            <dt>Expires</dt>
            <dd>{String(rdap.expires || "—")}</dd>
            <dt>Status</dt>
            <dd>{(Array.isArray(rdap.status) ? (rdap.status as string[]) : []).join(", ") || "—"}</dd>
            <dt>Nameservers</dt>
            <dd>{(Array.isArray(rdap.nameservers) ? (rdap.nameservers as string[]) : []).join(", ") || "—"}</dd>
          </dl>
        </>
      )}

      {net && (
        <>
          <div className="section-sub">Network identity</div>
          <dl className="kv">
            <dt>IPv4</dt>
            <dd>{String(net.ip || "—")}</dd>
            <dt>Reverse DNS</dt>
            <dd>{String(net.ptr || net.ptrError || "—")}</dd>
            <dt>Netname</dt>
            <dd>{String(net.org || "—")}</dd>
            <dt>Country</dt>
            <dd>{String(net.country || "—")}</dd>
          </dl>
        </>
      )}

      {done && (
        <div className="row mt14">
          <span className="small muted mono">
            completed in {((done.ms as number) / 1000).toFixed(1)}s
            {done.note ? ` · ${String(done.note)}` : ""}
          </span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={exportJson}>
            Export JSON
          </button>
        </div>
      )}

      {!records.length && !running && !error && (
        <EmptyBox>
          Enter a domain to run the full recon pass: DNS records, certificate transparency,
          DNS brute-force, HTTP probes, TLS, security audit, CORS, RDAP and reverse DNS.
        </EmptyBox>
      )}
    </>
  );
}

/* ─────────────────────── port scan ─────────────────────── */

function PortsMode() {
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PortResult[]>([]);
  const [ip, setIp] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<Record<string, unknown> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef<PortResult[]>([]);

  const open = results.filter((r) => r.open);

  async function run() {
    const t = target.trim();
    if (!t || running) return;
    setRunning(true);
    setError(null);
    setResults([]);
    ref.current = [];
    setIp("");
    setNote("");
    setDone(null);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      await streamPost("/api/recon/ports", { host: t }, (ev) => {
        if (ev.type === "resolved") setIp(ev.ip);
        else if (ev.type === "port") {
          ref.current = [...ref.current, ev as PortResult];
          setResults(ref.current);
        } else if (ev.type === "note") setNote(ev.message);
        else if (ev.type === "done") setDone(ev);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Port scan failed.");
    } finally {
      clearInterval(tick);
      setRunning(false);
      setElapsed((Date.now() - t0) / 1000);
    }
  }

  const openSet = new Set(open.map((r) => r.port));
  const scanned = new Set(results.map((r) => r.port));

  function exportCsv() {
    const rows = [
      ["port", "state", "service", "banner", "reason", "ms"],
      ...results.map((r) => [
        String(r.port),
        r.open ? "open" : "closed",
        r.service,
        r.banner ?? "",
        r.reason ?? "",
        String(r.ms),
      ]),
    ];
    downloadText(
      `stx-trace-ports-${target.trim()}.csv`,
      rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <>
      <div className="field-row mt14">
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="domain or IPv4 — e.g. example.com"
          spellCheck={false}
          autoCapitalize="none"
          disabled={running}
        />
        <button className="btn btn-primary" onClick={run} disabled={running || !target.trim()}>
          {running ? "Scanning…" : "Scan 38 ports"}
        </button>
      </div>
      <div className="small muted mt8">
        Real TCP connects from our server against the common-service list (21–27017), with banner
        grabbing on open ports.
      </div>

      {running && (
        <div className="progress-meta mt8">
          <span>
            {scanned.size} / 38 probed{ip ? ` · ${ip}` : ""}
          </span>
          <span>{elapsed.toFixed(1)}s</span>
        </div>
      )}

      <ErrorBox error={error} />
      {note && <div className="error-box">⚠ {note}</div>}

      {results.length > 0 && (
        <div className="stats">
          <div className="stat good">
            <div className="stat-v">{open.length}</div>
            <div className="stat-l">open</div>
          </div>
          <div className="stat">
            <div className="stat-v">{results.length - open.length}</div>
            <div className="stat-l">closed/filtered</div>
          </div>
          <div className="stat blue">
            <div className="stat-v">{ip || "—"}</div>
            <div className="stat-l">resolved IP</div>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <>
          <div className="section-sub">Open ports</div>
          <div className="log-list">
            {open.map((r) => (
              <div key={r.port} className="log-row">
                <span className="pill good mono">{r.port}</span>
                <span className="grow">
                  <b>{r.service || "unknown"}</b>
                </span>
                <span className="grow mono small muted" title={r.banner}>
                  {r.banner || "no banner"}
                </span>
                <span className="small muted mono">{r.ms}ms</span>
              </div>
            ))}
          </div>
        </>
      )}

      {results.length > 0 && (
        <>
          <div className="section-sub">All probed ports</div>
          <div className="port-grid">
            {results.map((r) => (
              <span
                key={r.port}
                className={`port-chip ${r.open ? "open" : ""}`}
                title={`${r.port}/${r.service || "?"} — ${r.open ? "open" : r.reason || "closed"}`}
              >
                {r.port}
              </span>
            ))}
          </div>
          {done && (
            <div className="row mt14">
              <span className="small muted mono">
                {((done.ms as number) / 1000).toFixed(1)}s · {String(done.open)} open
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
                Export CSV
              </button>
            </div>
          )}
        </>
      )}

      {!results.length && !running && !error && (
        <EmptyBox>
          Enter a host to TCP-connect scan the 38 most common service ports with banner grabbing.
        </EmptyBox>
      )}
    </>
  );
}

/* ─────────────────────── URL finder ─────────────────────── */

function PathsMode() {
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [hits, setHits] = useState<PathHit[]>([]);
  const [tick, setTick] = useState({ done: 0, hits: 0, skipped: 0 });
  const [total, setTotal] = useState(110);
  const [done, setDone] = useState<Record<string, unknown> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function run() {
    const t = target.trim();
    if (!t || running) return;
    setRunning(true);
    setError(null);
    setHits([]);
    setBase("");
    setTick({ done: 0, hits: 0, skipped: 0 });
    setDone(null);
    setElapsed(0);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      await streamPost("/api/recon/paths", { domain: t }, (ev) => {
        if (ev.type === "meta") setTotal(ev.total);
        else if (ev.type === "base") setBase(ev.base);
        else if (ev.type === "hit") setHits((h) => [...h, ev.hit as PathHit]);
        else if (ev.type === "tick") setTick({ done: ev.done, hits: ev.hits, skipped: ev.skipped });
        else if (ev.type === "done") {
          setDone(ev);
          setTick({ done: ev.checked, hits: ev.hits, skipped: ev.skipped });
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "URL discovery failed.");
    } finally {
      clearInterval(timer);
      setRunning(false);
      setElapsed((Date.now() - t0) / 1000);
    }
  }

  const pct = total > 0 ? Math.round((tick.done / total) * 100) : 0;

  function exportCsv() {
    const rows = [
      ["path", "status", "content_type", "size", "redirect", "ms"],
      ...hits.map((h) => [
        h.path,
        String(h.status),
        h.contentType ?? "",
        String(h.size ?? ""),
        h.redirect ?? "",
        String(h.ms),
      ]),
    ];
    downloadText(
      `stx-trace-urls-${target.trim()}.csv`,
      rows.map((r) => r.map(csvEscape).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <>
      <div className="field-row mt14">
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="domain — e.g. example.com"
          spellCheck={false}
          autoCapitalize="none"
          disabled={running}
        />
        <button className="btn btn-primary" onClick={run} disabled={running || !target.trim()}>
          {running ? "Fuzzing…" : "Find hidden URLs"}
        </button>
      </div>
      <div className="small muted mt8">
        Requests {`{base}/`} against 110 sensitive paths (env files, git, backups, admin panels,
        APIs) and reports everything that isn&apos;t a 404.
      </div>

      {running && (
        <div className="mt14">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {base || "detecting base URL"} — {tick.done} / {total} paths · {tick.hits} hits
            </span>
            <span>{elapsed.toFixed(1)}s</span>
          </div>
        </div>
      )}

      <ErrorBox error={error} />

      {hits.length > 0 && (
        <div className="stats">
          <div className="stat good">
            <div className="stat-v">{hits.filter((h) => h.status < 300).length}</div>
            <div className="stat-l">2xx hits</div>
          </div>
          <div className="stat warn">
            <div className="stat-v">{hits.filter((h) => h.status >= 300 && h.status < 500).length}</div>
            <div className="stat-l">3xx/4xx</div>
          </div>
          <div className="stat bad">
            <div className="stat-v">{hits.filter((h) => h.status >= 500).length}</div>
            <div className="stat-l">5xx</div>
          </div>
          <div className="stat blue">
            <div className="stat-v">{tick.done}</div>
            <div className="stat-l">paths tried</div>
          </div>
        </div>
      )}

      {hits.length > 0 && (
        <>
          <div className="section-sub">Discovered URLs</div>
          <div className="log-list">
            {hits.map((h) => (
              <div key={h.path} className="log-row">
                <span className={`pill ${statusClass(h.status)} mono`}>{h.status}</span>
                <span className="grow mono">
                  <a href={`${base}/${h.path}`} target="_blank" rel="noopener noreferrer">
                    /{h.path}
                  </a>
                </span>
                <span className="chip">{(h.contentType || "").split(";")[0] || "?"}</span>
                <span className="small muted mono">{h.size ? `${h.size}B` : ""}</span>
                <span className="small muted mono">{h.ms}ms</span>
              </div>
            ))}
          </div>
          {done && (
            <div className="row mt14">
              <span className="small muted mono">
                {String(done.note)}
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
                Export CSV
              </button>
            </div>
          )}
        </>
      )}

      {!hits.length && !running && !error && (
        <EmptyBox>
          Enter a domain to probe 110 sensitive paths (`.env`, `.git`, backups, admin panels, API
          docs) against the live server.
        </EmptyBox>
      )}
    </>
  );
}

/* ─────────────────────── wayback history ─────────────────────── */

function HistoryMode() {
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WaybackRow[]>([]);
  const [done, setDone] = useState<Record<string, unknown> | null>(null);
  const [received, setReceived] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function run() {
    const t = target.trim();
    if (!t || running) return;
    setRunning(true);
    setError(null);
    setRows([]);
    setDone(null);
    setReceived(null);
    setElapsed(0);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      await streamPost("/api/recon/history", { domain: t }, (ev) => {
        if (ev.type === "received") setReceived(ev.count);
        else if (ev.type === "url") setRows((r) => [...r, ev.row as WaybackRow]);
        else if (ev.type === "done") setDone(ev);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wayback lookup failed.");
    } finally {
      clearInterval(timer);
      setRunning(false);
      setElapsed((Date.now() - t0) / 1000);
    }
  }

  const tagCounts = (done?.tagCounts as { tag: string; count: number }[] | undefined) ?? [];

  function exportJson() {
    downloadText(
      `stx-trace-wayback-${target.trim()}.json`,
      JSON.stringify({ domain: target.trim(), generatedAt: new Date().toISOString(), rows }, null, 2),
    );
  }

  return (
    <>
      <div className="field-row mt14">
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="domain — e.g. example.com"
          spellCheck={false}
          autoCapitalize="none"
          disabled={running}
        />
        <button className="btn btn-primary" onClick={run} disabled={running || !target.trim()}>
          {running ? "Fetching…" : "Pull archive history"}
        </button>
      </div>
      <div className="small muted mt8">
        Queries the Internet Archive CDX API for every archived URL of the target (up to 2,500
        unique) and flags sensitive ones: env files, backups, logs, admin paths, leaky parameters.
      </div>

      {running && (
        <div className="progress-meta mt8">
          <span>
            {rows.length} interesting of {received ?? "…"} archived URLs
          </span>
          <span>{elapsed.toFixed(1)}s</span>
        </div>
      )}

      <ErrorBox error={error} />

      {done && (
        <div className="stats">
          <div className="stat blue">
            <div className="stat-v">{String(done.total)}</div>
            <div className="stat-l">archived URLs</div>
          </div>
          <div className={`stat ${Number(done.interesting) > 0 ? "warn" : ""}`}>
            <div className="stat-v">{String(done.interesting)}</div>
            <div className="stat-l">sensitive</div>
          </div>
          <div className="stat">
            <div className="stat-v">{String(done.streamed)}</div>
            <div className="stat-l">listed</div>
          </div>
        </div>
      )}

      {tagCounts.length > 0 && (
        <div className="link-list">
          {tagCounts.map((t) => (
            <span key={t.tag} className="chip">
              {t.tag}: {t.count}
            </span>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="section-sub">Sensitive archived URLs</div>
          <div className="log-list">
            {rows.map((r) => (
              <div key={r.url + r.ts} className="log-row">
                <a
                  className="grow mono small"
                  href={`https://web.archive.org/web/${r.ts}/${r.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={r.url}
                >
                  {r.url}
                </a>
                <span className="row" style={{ gap: 5 }}>
                  {r.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </span>
                <span className="small muted mono">{r.ts.slice(0, 8)}</span>
              </div>
            ))}
          </div>
          <div className="row mt14">
            <span className="small muted mono">
              {done && Number(done.interesting) > Number(done.streamed)
                ? `showing first ${String(done.streamed)} of ${String(done.interesting)} sensitive URLs`
                : "all sensitive URLs listed"}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={exportJson}>
              Export JSON
            </button>
          </div>
        </>
      )}

      {!rows.length && !running && !error && (
        <EmptyBox>
          Enter a domain to pull its Internet Archive history and flag exposed files, backups and
          leaky parameters.
        </EmptyBox>
      )}
    </>
  );
}

/* ─────────────────────── Google dorks ─────────────────────── */

function DorksMode() {
  const [target, setTarget] = useState("");
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(hackingDorks("example.com").map((c) => c.id)),
  );
  const cats = useMemo(() => (target.trim() ? hackingDorks(target.trim()) : null), [target]);
  const visible: DorkCat[] = cats ? cats.filter((c) => enabled.has(c.id)) : [];

  function toggle(id: string) {
    setEnabled((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function copyAll() {
    copyText(visible.flatMap((c) => c.rows.map((r) => r.query)).join("\n"));
  }

  return (
    <>
      <div className="field-row mt14">
        <input
          className="input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="target domain — e.g. example.com"
          spellCheck={false}
          autoCapitalize="none"
        />
        <button className="btn btn-ghost" onClick={copyAll} disabled={!visible.length}>
          Copy all queries
        </button>
      </div>
      <div className="small muted mt8">
        Builds real advanced-search queries (Google hacking / dorks) from your target and opens them
        in the search engines — exposed files, secrets, admin panels, leaks, cloud buckets.
      </div>

      {!target.trim() && (
        <EmptyBox>Enter a domain to generate dork categories.</EmptyBox>
      )}

      {cats && (
        <>
          <div className="row mt14">
            {cats.map((c) => (
              <button
                key={c.id}
                className={`btn btn-ghost btn-sm ${enabled.has(c.id) ? "active-filter" : ""}`}
                style={
                  enabled.has(c.id)
                    ? { borderColor: "var(--accent)", color: "var(--accent)" }
                    : undefined
                }
                onClick={() => toggle(c.id)}
              >
                {c.label} ({c.rows.length})
              </button>
            ))}
          </div>

          {visible.map((c) => (
            <div key={c.id} className="mt14">
              <div className="section-sub">{c.label}</div>
              <div className="dork-list">
                {c.rows.map((r) => (
                  <div key={r.query} className="dork-row">
                    <span className="dork-q" title={r.query}>
                      {r.query}
                    </span>
                    <span className="dork-actions">
                      <a href={googleUrl(r.query)} target="_blank" rel="noopener noreferrer">
                        Google
                      </a>
                      <a href={bingUrl(r.query)} target="_blank" rel="noopener noreferrer">
                        Bing
                      </a>
                      <a href={ddgUrl(r.query)} target="_blank" rel="noopener noreferrer">
                        DDG
                      </a>
                      <button onClick={() => copyText(r.query)}>copy</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ─────────────────────── people hunter ─────────────────────── */

interface GhUser {
  login: string;
  html_url: string;
  avatar_url: string;
  name?: string;
  bio?: string;
  location?: string;
  blog?: string;
}

function PeopleMode() {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mx, setMx] = useState<string[]>([]);
  const [mxDns, setMxDns] = useState<string>("");
  const [patterns, setPatterns] = useState<string[]>([]);
  const [gh, setGh] = useState<GhUser[]>([]);
  const [ghNote, setGhNote] = useState("");

  async function run() {
    const n = name.trim();
    const d = domain.trim().toLowerCase();
    if (!n || !d || running) return;
    setRunning(true);
    setError(null);
    setMx([]);
    setMxDns("");
    setPatterns([]);
    setGh([]);
    setGhNote("");
    try {
      const parts = n.split(/\s+/).filter(Boolean);
      const first = parts[0];
      const last = parts[parts.length - 1];
      const pats = emailPatterns(first, last, d);
      setPatterns(pats);

      // Real MX lookup over DNS-over-HTTPS.
      const mxRes = await dohQuery(d, "MX", 6000);
      if (mxRes.error) setMxDns(mxRes.error);
      else {
        setMx(mxRes.data);
        setMxDns(mxRes.data.length ? "" : "no MX records — mail not configured for this domain");
      }

      // Real GitHub user search (public API, CORS-enabled).
      try {
        const res = await fetch(
          `https://api.github.com/search/users?q=${encodeURIComponent(n)}&per_page=5`,
          { headers: { Accept: "application/vnd.github+json" } },
        );
        if (res.status === 403 || res.status === 429) {
          setGhNote("GitHub rate limit reached — try again in a minute.");
        } else if (res.ok) {
          const j = (await res.json()) as { items?: { login: string; html_url: string; avatar_url: string }[] };
          const items = (j.items ?? []).slice(0, 5);
          const full = await Promise.all(
            items.map(async (u) => {
              try {
                const pr = await fetch(`https://api.github.com/users/${u.login}`);
                if (!pr.ok) return { ...u } as GhUser;
                const p = (await pr.json()) as GhUser;
                return {
                  login: u.login,
                  html_url: u.html_url,
                  avatar_url: u.avatar_url,
                  name: p.name ?? undefined,
                  bio: p.bio ?? undefined,
                  location: p.location ?? undefined,
                  blog: p.blog ?? undefined,
                };
              } catch {
                return { ...u } as GhUser;
              }
            }),
          );
          setGh(full);
          if (!full.length) setGhNote("No GitHub accounts matched that name.");
        } else {
          setGhNote(`GitHub search returned HTTP ${res.status}.`);
        }
      } catch {
        setGhNote("GitHub search unreachable from this network.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "People search failed.");
    } finally {
      setRunning(false);
    }
  }

  const dorks = name.trim()
    ? [
        { label: "LinkedIn", q: `site:linkedin.com/in "${name.trim()}"` },
        { label: "GitHub", q: `site:github.com "${name.trim()}"` },
        { label: "Name + domain", q: `"${name.trim()}" "${domain.trim()}"` },
        { label: "Emails", q: `"${name.trim()}" email` },
      ]
    : [];

  return (
    <>
      <div className="field-row mt14">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="full name — e.g. Jane Doe"
          spellCheck={false}
          disabled={running}
        />
        <input
          className="input"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="email domain — e.g. company.com"
          spellCheck={false}
          autoCapitalize="none"
          disabled={running}
        />
        <button
          className="btn btn-primary"
          onClick={run}
          disabled={running || !name.trim() || !domain.trim()}
        >
          {running ? "Searching…" : "Hunt"}
        </button>
      </div>
      <div className="small muted mt8">
        Real MX lookups (DNS-over-HTTPS) + real GitHub account search + dork patterns for finding
        the person&apos;s public footprint. Pattern addresses are hypotheses until you verify them.
      </div>

      <ErrorBox error={error} />

      {patterns.length > 0 && (
        <>
          <div className="section-sub">
            Email patterns for {name.trim()} @{domain.trim()}
          </div>
          <div className="log-list">
            <div className="log-row">
              <span className="grow">
                <b>Mail exchanger</b>
              </span>
              {mxDns ? (
                <span className="pill warn">{mxDns}</span>
              ) : (
                mx.map((m) => (
                  <span key={m} className="pill good mono">
                    {m.replace(/^\d+\s+/, "")}
                  </span>
                ))
              )}
            </div>
            {patterns.map((p) => (
              <div key={p} className="log-row">
                <span className="grow mono">{p}</span>
                <a href={googleUrl(`"${p}"`)} target="_blank" rel="noopener noreferrer" className="dork-link">
                  Google
                </a>
                <a href={bingUrl(`"${p}"`)} target="_blank" rel="noopener noreferrer" className="dork-link">
                  Bing
                </a>
                <button className="btn btn-ghost btn-sm" onClick={() => copyText(p)}>
                  Copy
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {dorks.length > 0 && (
        <>
          <div className="section-sub">Person dorks</div>
          <div className="dork-list">
            {dorks.map((d) => (
              <div key={d.q} className="dork-row">
                <span className="dork-q" title={d.q}>
                  <b>{d.label}:</b> {d.q}
                </span>
                <span className="dork-actions">
                  <a href={googleUrl(d.q)} target="_blank" rel="noopener noreferrer">
                    Google
                  </a>
                  <a href={bingUrl(d.q)} target="_blank" rel="noopener noreferrer">
                    Bing
                  </a>
                  <a href={githubSearchUrl(d.q)} target="_blank" rel="noopener noreferrer">
                    GitHub
                  </a>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {(gh.length > 0 || ghNote) && (
        <>
          <div className="section-sub">GitHub matches (live API)</div>
          {ghNote && <div className="small muted">{ghNote}</div>}
          <div className="cand-list mt8">
            {gh.map((u) => (
              <div key={u.login} className="cand">
                <div className="cand-title">
                  <img
                    src={u.avatar_url}
                    alt=""
                    width={26}
                    height={26}
                    style={{ borderRadius: "50%", verticalAlign: "middle", marginRight: 8 }}
                  />
                  {u.name || u.login}
                  <span className="chip" style={{ marginLeft: 8 }}>
                    @{u.login}
                  </span>
                </div>
                <div className="cand-desc">
                  {[u.bio, u.location, u.blog].filter(Boolean).join(" · ") || "no bio"}
                </div>
                <div className="cand-links">
                  <a className="link-tag" href={u.html_url} target="_blank" rel="noopener noreferrer">
                    profile ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!patterns.length && !running && !error && (
        <EmptyBox>
          Enter a name and their email domain to generate verified MX-backed email patterns,
          GitHub matches and people dorks.
        </EmptyBox>
      )}
    </>
  );
}
