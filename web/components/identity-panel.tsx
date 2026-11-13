"use client";

import { useState } from "react";
import type { IdentityReport, ReportPayload } from "@/lib/types";
import { postJson } from "@/lib/client";
import { Card, DorkGrid, EmptyBox, ErrorBox } from "./common";

export function IdentityPanel({ onCollect }: { onCollect: (patch: Partial<ReportPayload>) => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<IdentityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<IdentityReport>("/api/search", {
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

  const candidateCount = report
    ? report.wikidata.length +
      report.wikipedia.length +
      report.orcid.length +
      report.stackexchange.length +
      report.github.length +
      report.gitlab.length +
      report.hackernews.length
    : 0;

  return (
    <Card
      title="Identity deep search"
      ico="◉"
      hint="Fans out one name across seven public sources — Wikidata, Wikipedia, ORCID, Stack Exchange, GitHub, GitLab and Hacker News — then arms you with contextual dorks for the open web."
      right={report ? <span className="pill info mono">{candidateCount} candidates</span> : undefined}
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
              <div className="section-sub">Wikidata → Wikipedia entities</div>
              <div className="cand-list">
                {report.wikidata.map((w) => (
                  <div key={w.id} className="cand">
                    <div className="cand-title">
                      {w.label} <span className="chip">{w.id}</span>
                    </div>
                    {w.description && <div className="cand-desc">{w.description}</div>}
                    <div className="cand-links">
                      <a href={w.url} target="_blank" rel="noopener noreferrer">wikidata ↗</a>
                      {w.wikipedia && (
                        <a href={w.wikipedia} target="_blank" rel="noopener noreferrer">wikipedia ↗</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report.wikipedia.length > 0 && (
            <>
              <div className="section-sub">Wikipedia article matches</div>
              <div className="cand-list">
                {report.wikipedia.map((w) => (
                  <div key={w.url} className="cand">
                    <div className="cand-title">{w.title}</div>
                    {w.extract && <div className="cand-desc">{w.extract}</div>}
                    <div className="cand-links">
                      <a href={w.url} target="_blank" rel="noopener noreferrer">read ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report.github.length + report.gitlab.length > 0 && (
            <>
              <div className="section-sub">Developer accounts (GitHub / GitLab)</div>
              <div className="cand-list">
                {report.github.map((g) => (
                  <div key={"gh" + g.login} className="cand">
                    <div className="cand-title">
                      {g.login} <span className="chip">github</span>
                    </div>
                    <div className="cand-links">
                      <a href={g.url} target="_blank" rel="noopener noreferrer">profile ↗</a>
                    </div>
                  </div>
                ))}
                {report.gitlab.map((g) => (
                  <div key={"gl" + g.login} className="cand">
                    <div className="cand-title">
                      {g.login} <span className="chip">gitlab</span>
                    </div>
                    <div className="cand-links">
                      <a href={g.url} target="_blank" rel="noopener noreferrer">profile ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report.stackexchange.length > 0 && (
            <>
              <div className="section-sub">Stack Exchange profiles</div>
              <div className="cand-list">
                {report.stackexchange.map((s) => (
                  <div key={s.link} className="cand">
                    <div className="cand-title">
                      {s.display_name}{" "}
                      <span className="chip">rep {s.reputation}</span>
                    </div>
                    <div className="cand-links">
                      <a href={s.link} target="_blank" rel="noopener noreferrer">profile ↗</a>
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
                      {o.givenNames ?? "?"} {o.familyNames ?? "?"} <span className="chip">{o.orcid}</span>
                    </div>
                    <div className="cand-links">
                      <a href={o.url} target="_blank" rel="noopener noreferrer">orcid record ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report.hackernews.length > 0 && (
            <>
              <div className="section-sub">Hacker News authors</div>
              <div className="cand-list">
                {report.hackernews.map((h, i) => (
                  <div key={h.author + i} className="cand">
                    <div className="cand-title">
                      {h.author} <span className="chip">hn</span>
                    </div>
                    <div className="cand-desc">{h.title}</div>
                    <div className="cand-links">
                      <a href={h.url} target="_blank" rel="noopener noreferrer">post ↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-sub">Open-web dorks — run to continue the trace</div>
          <DorkGrid dorks={report.dorks} />

          <ul className="notes mt14">
            {report.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {!report && !error && (
        <EmptyBox>
          Enter a name to query seven public sources at once and generate targeted search dorks.
        </EmptyBox>
      )}
    </Card>
  );
}
