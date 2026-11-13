"use client";

import { useMemo, useState } from "react";
import type { ReportPayload } from "@/lib/types";
import { copyText, downloadText, postJson } from "@/lib/client";
import { exposureScore } from "@/lib/score";
import { Card, ErrorBox } from "./common";

interface ReportResponse {
  engine: "llm" | "heuristic";
  model: string | null;
  text: string;
  findings: string;
  score?: number;
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
  const liveScore = useMemo(() => exposureScore(findings), [findings]);

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

  const score = report?.score ?? liveScore.score;

  return (
    <Card
      title="AI intelligence report"
      ico="☰"
      hint="Merges every module into one structured brief with a deterministic exposure score. With OPENAI_API_KEY configured the narrative is written by an LLM; otherwise a deterministic analyst template is used."
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

      {anyReady && (
        <div className="score-strip">
          <div className="score-num" data-band={score >= 60 ? "high" : score >= 30 ? "mid" : "low"}>
            {score}
          </div>
          <div className="score-body">
            <div className="score-title">
              Exposure score —{" "}
              {score >= 60 ? "broad public footprint" : score >= 30 ? "moderate footprint" : "small footprint"}
            </div>
            <ul className="score-factors">
              {liveScore.factors.slice(0, 6).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
                downloadText(`stx-trace-report-${new Date().toISOString().slice(0, 10)}.md`, report.text)
              }
            >
              Download .md
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                downloadText(
                  `stx-trace-findings-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(payload(), null, 2),
                  "application/json",
                )
              }
            >
              Export findings
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
