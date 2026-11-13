"use client";

import { useState } from "react";
import type { PhoneReport, ReportPayload } from "@/lib/types";
import { postJson } from "@/lib/client";
import { phoneDorks } from "@/lib/dorks";
import { Card, DorkGrid, EmptyBox, ErrorBox } from "./common";

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

  return (
    <Card
      title="Phone number analysis"
      ico="☎"
      hint="Full international parse (E.164/RFC3966), country + line-type classification, likely timezones, plus deep-search shortcuts across spam registries and social indexes. No calls or SMS are ever sent."
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
            <dt>RFC 3966</dt>
            <dd>{report.rfc3966 ?? "—"}</dd>
            <dt>Country</dt>
            <dd>
              {report.countryName ?? report.country ?? "unknown"}{" "}
              {report.countryCode && <span className="pill info">{report.countryCode}</span>}
            </dd>
            <dt>Line type</dt>
            <dd>{report.type ?? "unknown"}</dd>
            <dt>Likely timezone(s)</dt>
            <dd>
              {report.timezones.length ? (
                report.timezones.map((t) => (
                  <span key={t} className="pill info" style={{ marginRight: 6 }}>
                    {t}
                  </span>
                ))
              ) : (
                <span className="muted">unknown</span>
              )}
            </dd>
          </dl>

          {report.e164 && (
            <>
              <div className="section-sub">Deep-search shortcuts</div>
              <DorkGrid dorks={phoneDorks(report.e164, report.countryName, report.national)} />
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
        <EmptyBox>
          Enter a number with country code (e.g. +256…) to validate it, classify the line and open
          deep-search shortcuts.
        </EmptyBox>
      )}
    </Card>
  );
}
