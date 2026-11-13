"use client";

import { useMemo, useRef, useState } from "react";
import type { CheckStatus, ReportPayload, SiteResult } from "@/lib/types";
import { downloadText, streamPost, STATUS_LABEL } from "@/lib/client";
import { usernameDorks, usernameVariants } from "@/lib/dorks";
import { Card, ConfidenceBadge, DorkGrid, EmptyBox, ErrorBox } from "./common";

type Filter = "all" | "found" | "unknown" | "missing";

const CAT_ORDER: Record<string, number> = { found: 0, unknown: 1, skipped: 2, missing: 3 };

export function UsernamePanel({
  onCollect,
}: {
  onCollect: (patch: Partial<ReportPayload>) => void;
}) {
  const [username, setUsername] = useState("");
  const [running, setRunning] = useState(false);
  const [passLabel, setPassLabel] = useState<string>("");
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SiteResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [strict, setStrict] = useState(false);
  const [variantsOn, setVariantsOn] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const resultsRef = useRef<SiteResult[]>([]);

  const stats = useMemo(() => {
    let found = 0,
      missing = 0,
      unknown = 0,
      lowConf = 0;
    for (const r of results) {
      if (r.status === "found") {
        found++;
        if (r.confidence === "low") lowConf++;
      } else if (r.status === "missing") missing++;
      else unknown++;
    }
    return { found, missing, unknown, lowConf };
  }, [results]);

  const visible = useMemo(() => {
    let list = results;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    if (strict) list = list.filter((r) => !(r.status === "found" && r.confidence === "low"));
    return [...list].sort((a, b) => CAT_ORDER[a.status] - CAT_ORDER[b.status]);
  }, [results, filter, strict]);

  function mergeResults(next: SiteResult[]) {
    resultsRef.current = [...resultsRef.current, ...next];
    setResults(resultsRef.current);
  }

  async function runPass(
    u: string,
    opts: { sites?: string[]; variant?: string; label: string; replaceSites?: boolean },
  ): Promise<void> {
    setPassLabel(opts.label);
    setProgress(0);
    setTotal(0);
    const body: Record<string, unknown> = { username: u };
    if (opts.sites?.length) body.sites = opts.sites;
    const collected: SiteResult[] = [];
    await streamPost("/api/username", body, (ev) => {
      if (ev.type === "meta") setTotal(ev.total);
      else if (ev.type === "result") {
        const r: SiteResult = ev.result;
        if (opts.variant) r.variant = opts.variant;
        if (opts.replaceSites) {
          resultsRef.current = resultsRef.current.filter(
            (x) => !(x.site === r.site && (x.variant ?? "") === (opts.variant ?? "")),
          );
        }
        collected.push(r);
        resultsRef.current = [...resultsRef.current, r];
        setResults(resultsRef.current);
        setProgress(ev.progress);
      }
    });
    // ensure final state consistent
    setResults(resultsRef.current);
    return;
  }

  async function run() {
    const u = username.trim();
    if (!u || running) return;
    setRunning(true);
    setError(null);
    resultsRef.current = [];
    setResults([]);
    setLastScan(u);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      await runPass(u, { label: `primary · ${u}` });
      onCollect({ username: { value: u, results: resultsRef.current } });

      if (variantsOn) {
        const variants = usernameVariants(u);
        for (let i = 0; i < variants.length; i++) {
          await runPass(variants[i], {
            variant: variants[i],
            label: `variant ${i + 1}/${variants.length} · ${variants[i]}`,
          });
          onCollect({ username: { value: u, results: resultsRef.current } });
        }
      }
      onCollect({ username: { value: u, results: resultsRef.current } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      clearInterval(tick);
      setRunning(false);
      setPassLabel("");
      setElapsed((Date.now() - t0) / 1000);
    }
  }

  async function retryUnknowns() {
    if (running || !lastScan) return;
    const unknownSites = [
      ...new Set(
        resultsRef.current
          .filter((r) => (r.status === "unknown" || r.status === "skipped") && !r.variant)
          .map((r) => r.site),
      ),
    ];
    if (!unknownSites.length) return;
    setRunning(true);
    setError(null);
    try {
      await runPass(lastScan, {
        sites: unknownSites,
        label: `retry ${unknownSites.length} inconclusive · ${lastScan}`,
        replaceSites: true,
      });
      onCollect({ username: { value: lastScan, results: resultsRef.current } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setRunning(false);
      setPassLabel("");
    }
  }

  function exportCsv() {
    const rows = [
      ["site", "url", "category", "status", "confidence", "variant", "note", "ms"],
      ...resultsRef.current.map((r) => [
        r.site,
        r.url,
        r.category,
        r.status,
        r.confidence ?? "",
        r.variant ?? "",
        r.note ?? "",
        String(r.ms),
      ]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadText(`stx-trace-username-${lastScan ?? "scan"}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportJson() {
    downloadText(
      `stx-trace-username-${lastScan ?? "scan"}.json`,
      JSON.stringify({ username: lastScan, generatedAt: new Date().toISOString(), results: resultsRef.current }, null, 2),
    );
  }

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Card
      title="Username deep search"
      ico="@"
      hint={`Live sweep of ${""}public profile endpoints across ${""}social, developer, gaming, creative, finance and community platforms — with retries, login-wall detection and per-hit confidence scoring.`}
      right={<span className="pill info mono">{total || results.length || "—"} sites</span>}
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

      <div className="row mt8">
        <label className="consent" style={{ minWidth: 240 }}>
          <input type="checkbox" checked={variantsOn} onChange={(e) => setVariantsOn(e.target.checked)} disabled={running} />
          <span>Also scan derived variants (john_doe → johndoe, john-doe, …)</span>
        </label>
        <span className="spacer" />
        {results.length > 0 && !running && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={retryUnknowns} title="Re-check inconclusive sites">
              Retry inconclusive
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
              Export CSV
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportJson}>
              Export JSON
            </button>
          </>
        )}
      </div>

      {running && (
        <div className="mt14">
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {passLabel || "scanning"} — {progress} / {total || "…"} checked
            </span>
            <span>{elapsed.toFixed(1)}s elapsed</span>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <>
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
              <div className="stat-v">{stats.lowConf}</div>
              <div className="stat-l">low-confidence</div>
            </div>
          </div>

          <div className="row">
            {(["all", "found", "unknown", "missing"] as Filter[]).map((f) => (
              <button
                key={f}
                className={`btn btn-ghost btn-sm ${filter === f ? "active-filter" : ""}`}
                onClick={() => setFilter(f)}
                style={filter === f ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
              >
                {f === "all" ? "All" : STATUS_LABEL[f]}
              </button>
            ))}
            <label className="consent" style={{ minWidth: 200 }}>
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              <span>Strict mode (hide low-confidence hits)</span>
            </label>
            <span className="spacer" />
            <span className="small mono muted">showing {visible.length} / {results.length}</span>
          </div>
        </>
      )}

      <ErrorBox error={error} />

      {visible.length > 0 && (
        <div className="site-list mt14">
          {visible.map((r, i) => {
            const inner = (
              <>
                <span className={`dot ${r.status}`} />
                <span className="site-name">
                  {r.site}
                  {r.variant && <span className="chip" style={{ marginLeft: 8 }}>var: {r.variant}</span>}
                </span>
                <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                  <ConfidenceBadge confidence={r.confidence} />
                  <span className="chip">{r.category}</span>
                </span>
                <span className="site-note">{r.note ?? STATUS_LABEL[r.status]}</span>
                <span className="site-ms">{r.ms ? `${r.ms}ms` : ""}</span>
              </>
            );
            return r.status === "found" ? (
              <a key={`${r.site}-${r.variant ?? ""}-${i}`} className="site-row" href={r.url} target="_blank" rel="noopener noreferrer">
                {inner}
              </a>
            ) : (
              <div key={`${r.site}-${r.variant ?? ""}-${i}`} className="site-row">
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {results.length === 0 && !running && !error && (
        <EmptyBox>
          Enter a username to sweep public profile endpoints. Only public pages are queried — no logins, no CAPTCHA bypass.
        </EmptyBox>
      )}

      {results.length > 0 && (
        <>
          <div className="section-sub">Username dorks — run to catch anything the sweep missed</div>
          <DorkGrid dorks={usernameDorks(lastScan ?? username.trim())} />
        </>
      )}
    </Card>
  );
}
