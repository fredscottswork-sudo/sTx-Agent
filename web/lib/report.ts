import type { ReportPayload, SiteResult } from "@/lib/types";

export const SYSTEM_PROMPT = `You are the analysis engine of STX Trace, a defensive OSINT workbench.
You receive ONLY verified findings collected from public sources. Write a tight, professional
intelligence brief in Markdown with exactly these sections:
## Executive Summary
## Digital Footprint
## Identity Correlation
## Exposure & Risk
## Recommended Next Steps
## Confidence & Caveats

Rules:
- Use only facts present in the findings. Never invent identities, employers, locations, or accounts.
- Mark anything uncertain as "unverified". Distinguish found vs. blocked/inconclusive sources.
- If data is thin, say plainly that the footprint is small — do not pad.
- Face verification (if present) is 1:1 comparison of two user-supplied photos, not identification
  of a stranger; describe it that way.
- Be concise: under 700 words. No preamble before the first heading.`;

function fmtFound(results: SiteResult[]): string {
  return results
    .filter((r) => r.status === "found")
    .map((r) => `- ${r.site}: ${r.url}`)
    .join("\n");
}

export function buildFindingsText(p: ReportPayload): string {
  const lines: string[] = [];
  lines.push("TARGET INPUTS");
  if (p.target.username) lines.push(`- Username: ${p.target.username}`);
  if (p.target.email) lines.push(`- Email: ${p.target.email}`);
  if (p.target.phone) lines.push(`- Phone: ${p.target.phone}`);
  if (p.target.name) lines.push(`- Name: ${p.target.name}`);
  lines.push("");

  if (p.username?.results?.length) {
    const r = p.username.results;
    const found = r.filter((x) => x.status === "found");
    const missing = r.filter((x) => x.status === "missing");
    const unknown = r.filter((x) => x.status !== "found" && x.status !== "missing");
    lines.push(`USERNAME SWEEP — ${found.length} found, ${missing.length} not found, ${unknown.length} inconclusive/blocked (of ${r.length} sites checked).`);
    if (found.length) {
      lines.push("Confirmed profiles:");
      lines.push(fmtFound(r));
    }
    if (unknown.length) {
      lines.push(
        `Inconclusive (login walls / rate limits): ${unknown.map((x) => x.site).join(", ")}.`,
      );
    }
    lines.push("");
  }

  if (p.email) {
    const e = p.email;
    lines.push("EMAIL INTELLIGENCE");
    lines.push(`- Address: ${e.email}`);
    lines.push(`- Provider: ${e.provider ?? "unknown/custom domain"}; disposable: ${e.disposable ? "yes" : "no"}`);
    lines.push(`- Domain MX: ${e.mxOk ? e.mx.map((m) => `${m.exchange} (prio ${m.priority})`).join(", ") : "none found"}`);
    if (e.gravatar) {
      lines.push(`- Gravatar hash: ${e.gravatar.hash}; avatar: ${e.gravatar.hasAvatar ? "public" : "none"}`);
      if (e.gravatar.displayName) lines.push(`- Gravatar display name: ${e.gravatar.displayName}`);
      if (e.gravatar.location) lines.push(`- Gravatar location: ${e.gravatar.location}`);
      if (e.gravatar.description) lines.push(`- Gravatar bio: ${e.gravatar.description}`);
      if (e.gravatar.jobs?.length) lines.push(`- Gravatar jobs: ${e.gravatar.jobs.join("; ")}`);
      if (e.gravatar.accounts?.length) {
        lines.push(
          `- Linked accounts published by owner: ${e.gravatar.accounts.map((a) => `${a.shortname} → ${a.url}`).join("; ")}`,
        );
      }
    }
    if (e.breaches && e.breaches.length) {
      lines.push(`- Breaches (Have I Been Pwned): ${e.breaches.join(", ")}`);
    } else if (e.breaches) {
      lines.push("- Breaches (Have I Been Pwned): none found");
    } else {
      lines.push("- Breaches: not checked (no HIBP key configured)");
    }
    lines.push("");
  }

  if (p.phone) {
    const ph = p.phone;
    lines.push("PHONE INTELLIGENCE");
    lines.push(`- Input: ${ph.input}`);
    lines.push(`- E.164: ${ph.e164 ?? "n/a"}; valid: ${ph.valid ? "yes" : "no"}; possible: ${ph.possible ? "yes" : "no"}`);
    if (ph.country) lines.push(`- Country: ${ph.countryName ?? ph.country} (+${ph.countryCode})`);
    if (ph.type) lines.push(`- Type: ${ph.type}`);
    lines.push("");
  }

  if (p.identity) {
    const id = p.identity;
    lines.push("NAME / IDENTITY SEARCH");
    lines.push(`- Query name: ${id.name}`);
    if (id.wikidata.length) {
      lines.push("- Wikidata candidates:");
      for (const w of id.wikidata) {
        lines.push(`  - ${w.label} (${w.id})${w.description ? ` — ${w.description}` : ""} — ${w.url}${w.wikipedia ? ` — ${w.wikipedia}` : ""}`);
      }
    } else {
      lines.push("- Wikidata: no candidates");
    }
    if (id.orcid.length) {
      lines.push("- ORCID researcher candidates:");
      for (const o of id.orcid) {
        lines.push(`  - ${o.givenNames ?? "?"} ${o.familyNames ?? "?"} — ${o.url}`);
      }
    }
    lines.push("");
  }

  if (p.face) {
    lines.push("FACE VERIFICATION (1:1)");
    lines.push(`- Verdict: ${p.face.verdictLabel} (similarity ${p.face.similarity}%)`);
    lines.push(`- ${p.face.explanation}`);
    lines.push("");
  }

  if (!lines.length || lines.every((l) => !l.trim())) {
    lines.push("No findings collected yet.");
  }
  return lines.join("\n");
}

function footprintRating(found: number): string {
  if (found >= 15) return "BROAD";
  if (found >= 6) return "MODERATE";
  if (found >= 1) return "THIN";
  return "MINIMAL";
}

export function buildHeuristicReport(p: ReportPayload, findings: string): string {
  const out: string[] = [];
  const ts = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const results = p.username?.results ?? [];
  const found = results.filter((r) => r.status === "found");
  const unknown = results.filter((r) => r.status !== "found" && r.status !== "missing");

  out.push(`# STX Trace — Intelligence Brief`);
  out.push("");
  out.push(`**Generated:** ${ts} · **Engine:** heuristic (set \`OPENAI_API_KEY\` for LLM synthesis)`);
  out.push("");

  out.push("## Executive Summary");
  const inputs = [
    p.target.username && `username \`${p.target.username}\``,
    p.target.email && `email \`${p.target.email}\``,
    p.target.phone && `phone \`${p.target.phone}\``,
    p.target.name && `name \`${p.target.name}\``,
  ].filter(Boolean);
  out.push(
    `Target inputs: ${inputs.length ? inputs.join(", ") : "none"}. ` +
      (results.length
        ? `Username sweep confirmed **${found.length}** public profile(s) across ${results.length} checked sites (footprint: **${footprintRating(found.length)}**).`
        : "No username sweep collected yet.") +
      (p.face ? ` Face check: **${p.face.verdictLabel}** (${p.face.similarity}% similarity).` : ""),
  );
  out.push("");

  out.push("## Digital Footprint");
  if (found.length) {
    out.push("Confirmed public profiles:");
    for (const r of found) out.push(`- [${r.site}](${r.url})`);
  } else {
    out.push("- No confirmed profiles collected yet.");
  }
  if (unknown.length) {
    out.push("");
    out.push(
      `Inconclusive sources (${unknown.length}): ${unknown.map((u) => u.site).join(", ")} — blocked, login-walled, or rate-limited; absence of a hit here is not evidence of absence.`,
    );
  }
  out.push("");

  out.push("## Identity Correlation");
  if (p.email) {
    const e = p.email;
    out.push(`- Email: ${e.provider ?? "custom domain"}${e.disposable ? " (disposable!)" : ""}; MX ${e.mxOk ? "present" : "missing"}.`);
    if (e.gravatar?.displayName) out.push(`- Gravatar display name: “${e.gravatar.displayName}”.`);
    if (e.gravatar?.location) out.push(`- Gravatar location: ${e.gravatar.location}.`);
    if (e.gravatar?.accounts?.length) {
      out.push(`- Owner-published linked accounts: ${e.gravatar.accounts.map((a) => a.shortname).join(", ")}.`);
    }
    if (e.breaches?.length) out.push(`- Appears in ${e.breaches.length} breach(es): ${e.breaches.slice(0, 8).join(", ")}${e.breaches.length > 8 ? "…" : ""}.`);
  }
  if (p.phone?.e164) {
    out.push(`- Phone parses to ${p.phone.e164} (${p.phone.countryName ?? "unknown country"}, ${p.phone.type ?? "type unknown"}).`);
  }
  if (p.identity?.wikidata.length) {
    out.push(`- Wikidata candidates: ${p.identity.wikidata.map((w) => `${w.label} (${w.id})`).join("; ")}.`);
  }
  if (p.identity?.orcid.length) {
    out.push(`- ORCID records: ${p.identity.orcid.map((o) => o.url).join("; ")}.`);
  }
  if (!p.email && !p.phone && !p.identity) out.push("- No identity inputs correlated yet.");
  out.push("");

  out.push("## Exposure & Risk");
  const risks: string[] = [];
  if (found.length >= 5) {
    risks.push(`Username reuse across ${found.length} platforms makes cross-site correlation trivial — any one account compromise can cascade.`);
  }
  if (p.email?.gravatar?.hasAvatar) {
    risks.push("A public Gravatar avatar/profile ties every site using that hash together — one hash links the whole footprint.");
  }
  if (p.email?.breaches?.length) {
    risks.push("Known breach exposure on this address — password reuse and credential-stuffing risk is elevated.");
  }
  if (p.email?.disposable) risks.push("Disposable address reduces persistence but also identity signal.");
  if (p.face && (p.face.verdict === "match" || p.face.verdict === "likely")) {
    risks.push("Face match means photos across accounts can be correlated by anyone running the same check.");
  }
  if (p.phone?.valid) {
    risks.push("A valid phone number is a persistent identifier — it links accounts, WhatsApp/Telegram presence, and data-broker records.");
  }
  if (!risks.length) risks.push("Footprint is currently minimal — keep it that way: unique usernames per site, no reused avatars.");
  for (const r of risks) out.push(`- ${r}`);
  out.push("");

  out.push("## Recommended Next Steps");
  out.push("- Review each confirmed profile's privacy settings and strip unnecessary public fields.");
  out.push("- Rotate any password reused on a breached site; enable MFA on the accounts above.");
  out.push("- Run the provided search dorks (Google, X, GitHub, Reddit) to catch non-enumerated pages.");
  out.push("- For ongoing monitoring, re-run this sweep periodically — public footprint changes.");
  if (process.env.OPENAI_API_KEY === undefined) {
    out.push("- Optional: set `OPENAI_API_KEY` on the deployment to enable LLM-written narrative synthesis.");
  }
  out.push("");

  out.push("## Confidence & Caveats");
  out.push("- Sources: public HTTP endpoints only. No authenticated scraping, no paywalled data, no data brokers.");
  out.push("- Status-code heuristics can produce false positives/negatives; login-walled sites are reported as inconclusive, not absent.");
  out.push("- Face verification compares two images you supply (1:1). It does not identify strangers from a database.");
  out.push("- No tool finds “everything” about a person — this brief covers only what is publicly reachable right now.");
  out.push("");
  out.push("---");
  out.push("");
  out.push("_Raw findings fed to this report:_");
  out.push("");
  out.push("```");
  out.push(findings.slice(0, 6000));
  out.push("```");
  return out.join("\n");
}
