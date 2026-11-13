"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReportPayload } from "@/lib/types";
import { UsernamePanel } from "@/components/username-panel";
import { EmailPanel } from "@/components/email-panel";
import { PhonePanel } from "@/components/phone-panel";
import { IdentityPanel } from "@/components/identity-panel";
import { ReportPanel } from "@/components/report-panel";
import { FacePanel } from "@/components/face-panel";

type TabId = "username" | "email" | "phone" | "identity" | "face" | "report";

const TABS: { id: TabId; label: string }[] = [
  { id: "username", label: "@ Username" },
  { id: "email", label: "✉ Email" },
  { id: "phone", label: "☎ Phone" },
  { id: "identity", label: "◉ Identity" },
  { id: "face", label: "▣ Face verify" },
  { id: "report", label: "☰ AI report" },
];

const AGREEMENT_KEY = "stx-trace-agreed-v1";

export default function Home() {
  const [tab, setTab] = useState<TabId>("username");
  const [findings, setFindings] = useState<Partial<ReportPayload>>({});
  const [agreed, setAgreed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setAgreed(localStorage.getItem(AGREEMENT_KEY) === "1");
    } catch {
      setAgreed(true);
    }
  }, []);

  const collect = useCallback((patch: Partial<ReportPayload>) => {
    setFindings((f) => ({ ...f, ...patch }));
  }, []);

  const readyCount = [
    findings.username?.results?.length,
    findings.email,
    findings.phone,
    findings.identity,
    findings.face,
  ].filter(Boolean).length;

  const foundCount = findings.username?.results?.filter((r) => r.status === "found").length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">STX</div>
          <div>
            <div className="brand-name">STX TRACE</div>
            <div className="brand-sub">OSINT workbench · public data only</div>
          </div>
        </div>
        <div className="top-actions">
          {foundCount > 0 && <span className="pill good">@{foundCount} hits</span>}
          <span className="pill info">modules run: {readyCount}/5</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setAgreed(false)}>
            Terms
          </button>
        </div>
      </header>

      <div className="flowbar">
        <span className="flow-chip">
          <b>1</b> @username sweep · 230 sites
        </span>
        <span className="flow-chip">
          <b>2</b> email · phone · identity ×7 sources
        </span>
        <span className="flow-chip">
          <b>3</b> AI face verify (fast/accurate)
        </span>
        <span className="flow-chip">
          <b>4</b> exposure score + AI report
        </span>
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "report" && readyCount > 0 && <span className="tab-count">{readyCount}</span>}
          </button>
        ))}
      </nav>

      <main>
        <div className={`tabpanel ${tab === "username" ? "" : "hidden"}`}>
          <UsernamePanel onCollect={collect} />
        </div>
        <div className={`tabpanel ${tab === "email" ? "" : "hidden"}`}>
          <EmailPanel onCollect={collect} />
        </div>
        <div className={`tabpanel ${tab === "phone" ? "" : "hidden"}`}>
          <PhonePanel onCollect={collect} />
        </div>
        <div className={`tabpanel ${tab === "identity" ? "" : "hidden"}`}>
          <IdentityPanel onCollect={collect} />
        </div>
        <div className={`tabpanel ${tab === "face" ? "" : "hidden"}`}>
          <FacePanel onCollect={collect} />
        </div>
        <div className={`tabpanel ${tab === "report" ? "" : "hidden"}`}>
          <ReportPanel findings={findings} />
        </div>
      </main>

      <footer className="foot">
        <span>
          Authorized, defensive research only. Public sources only — no authenticated scraping, no
          bypassing access controls, no harassment. You are responsible for lawful use in your
          jurisdiction.
        </span>
        <span className="mono">STX Trace · sTx-Agent</span>
      </footer>

      {agreed === false && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h1>STX Trace — permitted use</h1>
            <div className="modal-sub">read before continuing</div>
            <ul>
              <li>
                <strong>Public data only.</strong> The tool queries pages anyone can visit. It never
                logs into accounts, bypasses CAPTCHAs, or accesses private/paid data.
              </li>
              <li>
                <strong>Face verification is 1:1.</strong> It compares two photos you supply. It does
                not identify unknown people from photo databases, and images stay in your browser.
              </li>
              <li>
                <strong>Legitimate purposes.</strong> Research, due diligence on yourself/your
                organization, security testing you are authorized to perform, journalism, or finding
                your own leaked data. Not for stalking, doxxing, discrimination, or harassment.
              </li>
              <li>
                <strong>Accuracy is not guaranteed.</strong> Results are heuristics over public
                sources; verify anything important independently.
              </li>
            </ul>
            <button
              className="btn btn-primary"
              onClick={() => {
                try {
                  localStorage.setItem(AGREEMENT_KEY, "1");
                } catch {
                  /* ignore */
                }
                setAgreed(true);
              }}
            >
              I understand — use STX Trace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
