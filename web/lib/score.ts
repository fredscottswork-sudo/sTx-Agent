import type { ReportPayload, SiteResult } from "@/lib/types";

/** Deterministic exposure score (0–100): breadth + confidence + sensitive signals. */
export function exposureScore(p: Partial<ReportPayload>): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;
  const results: SiteResult[] = p.username?.results ?? [];
  const strong = results.filter((r) => r.status === "found" && r.confidence !== "low");
  const weak = results.filter((r) => r.status === "found" && r.confidence === "low");
  if (strong.length) {
    const pts = Math.min(45, strong.length * 4);
    score += pts;
    factors.push(`+${pts} — ${strong.length} confirmed profile(s)`);
  }
  if (weak.length) {
    const pts = Math.min(8, weak.length * 2);
    score += pts;
    factors.push(`+${pts} — ${weak.length} low-confidence lead(s)`);
  }
  if (p.email?.gravatar?.hasAvatar) {
    score += 10;
    factors.push("+10 — public Gravatar avatar (cross-site correlatable)");
  }
  if (p.email?.gravatar?.accounts?.length) {
    const pts = Math.min(10, p.email.gravatar.accounts.length * 2);
    score += pts;
    factors.push(`+${pts} — ${p.email.gravatar.accounts.length} owner-linked account(s)`);
  }
  if (p.email?.breaches?.length) {
    const pts = Math.min(15, p.email.breaches.length * 5);
    score += pts;
    factors.push(`+${pts} — ${p.email.breaches.length} breach(es)`);
  }
  if (p.email?.dns && !p.email.dns.dmarcPolicy) {
    score += 4;
    factors.push("+4 — email domain lacks DMARC");
  }
  if (p.phone?.valid) {
    score += 8;
    factors.push("+8 — valid phone number exposed");
  }
  if (p.identity && p.identity.wikidata.length + p.identity.github.length + p.identity.stackexchange.length > 0) {
    score += 8;
    factors.push("+8 — name correlates to public profiles");
  }
  if (p.face && (p.face.verdict === "match" || p.face.verdict === "likely")) {
    score += 7;
    factors.push("+7 — photos mutually correlatable via face match");
  }
  if (score === 0) factors.push("no significant public footprint collected");
  return { score: Math.min(100, score), factors };
}
