"use client";

import type { ReactNode } from "react";
import type { CheckStatus, Confidence } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/client";

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

export function ConfidenceBadge({ confidence }: { confidence?: Confidence }) {
  if (!confidence) return null;
  const label = confidence === "high" ? "high conf." : confidence === "medium" ? "med conf." : "low conf.";
  const cls = confidence === "high" ? "pill good" : confidence === "medium" ? "pill info" : "pill warn";
  return <span className={`pill ${cls}`} title="Classification confidence">{label}</span>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-box">⚠ {error}</div>;
}

export function EmptyBox({ children }: { children: ReactNode }) {
  return <div className="empty-box mt14">{children}</div>;
}

export function DorkGrid({ dorks }: { dorks: { engine: string; url: string }[] }) {
  if (!dorks.length) return null;
  return (
    <div className="dork-grid">
      {dorks.map((d) => (
        <a key={d.engine + d.url} className="dork" href={d.url} target="_blank" rel="noopener noreferrer">
          {d.engine} <span>open ↗</span>
        </a>
      ))}
    </div>
  );
}
