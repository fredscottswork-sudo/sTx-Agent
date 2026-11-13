"use client";

import { useState } from "react";
import type { EmailReport, ReportPayload } from "@/lib/types";
import { postJson } from "@/lib/client";
import { emailDorks } from "@/lib/dorks";
import { Card, DorkGrid, EmptyBox, ErrorBox } from "./common";

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
  const dns = report?.dns;

  return (
    <Card
      title="Email intelligence"
      ico="✉"
      hint="MX + NS + SPF/DMARC/BIMI/DKIM posture, RDAP domain registration, provider & disposable detection, address-format derivation, public Gravatar profile with linked accounts, reverse-image hooks and optional breach history."
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
          {busy ? "Deep lookup…" : "Run lookup"}
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
            {dns && (
              <>
                <dt>Name servers</dt>
                <dd>{dns.ns.length ? dns.ns.join(", ") : <span className="muted">none found</span>}</dd>
                <dt>SPF</dt>
                <dd>
                  {dns.spf ? (
                    <span className="pill good" title={dns.spf}>present</span>
                  ) : (
                    <span className="pill bad">missing</span>
                  )}{" "}
                  <span className="small mono muted">{dns.spf ? dns.spf.slice(0, 90) : ""}</span>
                </dd>
                <dt>DMARC</dt>
                <dd>
                  {dns.dmarcPolicy ? (
                    <span className={`pill ${dns.dmarcPolicy === "none" ? "warn" : "good"}`}>
                      p={dns.dmarcPolicy}
                    </span>
                  ) : (
                    <span className="pill bad">missing</span>
                  )}
                </dd>
                <dt>DKIM selectors</dt>
                <dd>
                  {dns.dkim.length ? (
                    dns.dkim.map((d) => (
                      <span key={d.selector} className="pill good" style={{ marginRight: 6 }}>
                        {d.selector}
                      </span>
                    ))
                  ) : (
                    <span className="muted">none of the common selectors found</span>
                  )}
                </dd>
                <dt>BIMI</dt>
                <dd>{dns.bimi ? <span className="pill good">present</span> : <span className="muted">absent</span>}</dd>
              </>
            )}
            {report.rdap && (
              <>
                <dt>Registrar</dt>
                <dd>{report.rdap.registrar ?? <span className="muted">redacted</span>}</dd>
                <dt>Registered</dt>
                <dd>{report.rdap.created ? report.rdap.created.slice(0, 10) : <span className="muted">unknown</span>}</dd>
                <dt>Expires</dt>
                <dd>{report.rdap.expires ? report.rdap.expires.slice(0, 10) : <span className="muted">unknown</span>}</dd>
                <dt>Registrant</dt>
                <dd>{report.rdap.registrantOrg ?? <span className="muted">privacy-protected / redacted</span>}</dd>
                <dt>Domain status</dt>
                <dd>{report.rdap.status.length ? report.rdap.status.join(", ") : <span className="muted">—</span>}</dd>
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

          {report.formats.length > 0 && (
            <>
              <div className="section-sub">Plausible address formats on this domain</div>
              <div className="link-list">
                {report.formats.map((f) => (
                  <span key={f} className="link-tag">
                    {f}
                  </span>
                ))}
              </div>
            </>
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

          <div className="section-sub">Email dorks & reverse image search</div>
          <DorkGrid dorks={emailDorks(report.email, g?.hasAvatar ? g.imageUrl : undefined)} />
        </div>
      )}

      {!report && !error && (
        <EmptyBox>
          Enter an email for a full deep lookup — mail infrastructure, DNS security posture, domain
          registration, provider, Gravatar profile and (optionally) breach history.
        </EmptyBox>
      )}
    </Card>
  );
}
