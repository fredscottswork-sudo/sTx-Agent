import type { IdentityReport, OrcidCandidate, WikidataCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA = "STX-Trace/1.0 (OSINT workbench; public-data lookups)";
const NAME_RE = /^[\p{L}\p{M}'’. \-]{2,80}$/u;

async function getJson<T>(url: string, accept = "application/json", timeoutMs = 9000): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: accept } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface WdSearch {
  search?: { id: string; label: string; description?: string }[];
}
interface WdEntities {
  entities?: Record<string, { sitelinks?: Record<string, { title: string }> }>;
}
interface OrcidSearch {
  "expanded-result"?: {
    orcid?: { path?: string };
    "given-names"?: { value?: string };
    "family-names"?: { value?: string };
  }[];
}

function buildDorks(name: string, location?: string) {
  const q = `${name}${location ? " " + location : ""}`.trim();
  const enc = encodeURIComponent;
  const siteQ = (site: string) => enc(`site:${site} "${q}"`);
  return [
    { engine: "Google", url: `https://www.google.com/search?q=${enc(`"${q}"`)}` },
    { engine: "Google — LinkedIn", url: `https://www.google.com/search?q=${siteQ("linkedin.com/in")}` },
    { engine: "Google — News", url: `https://www.google.com/search?q=${enc(`"${q}"`)}&tbm=nws` },
    { engine: "DuckDuckGo", url: `https://duckduckgo.com/?q=${enc(`"${q}"`)}` },
    { engine: "Bing", url: `https://www.bing.com/search?q=${enc(`"${q}"`)}` },
    { engine: "X / Twitter", url: `https://x.com/search?q=${enc(q)}&f=live` },
    { engine: "GitHub users", url: `https://github.com/search?q=${enc(q)}&type=users` },
    { engine: "Reddit", url: `https://www.reddit.com/search/?q=${enc(q)}` },
    { engine: "YouTube", url: `https://www.youtube.com/results?search_query=${enc(q)}` },
    { engine: "Medium", url: `https://medium.com/search?q=${enc(q)}` },
  ];
}

export async function POST(req: Request) {
  let name = "";
  let location = "";
  try {
    const body = (await req.json()) as { name?: unknown; location?: unknown };
    name = String(body?.name ?? "").trim();
    location = String(body?.location ?? "").trim().slice(0, 60);
  } catch {
    /* fallthrough */
  }

  if (!NAME_RE.test(name)) {
    return Response.json(
      { error: "Enter a real-looking name (letters, spaces, hyphens, apostrophes; 2–80 chars)." },
      { status: 400 },
    );
  }

  const notes: string[] = [];

  // ── Wikidata entity search ────────────────────────────────────────
  const wd = await getJson<WdSearch>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=10&format=json`,
  );
  let wikidata: WikidataCandidate[] = [];
  if (wd?.search && wd.search.length > 0) {
    wikidata = wd.search.slice(0, 6).map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description ?? null,
      url: `https://www.wikidata.org/wiki/${s.id}`,
      wikipedia: null,
    }));
    // Resolve English Wikipedia sitelinks for the top few matches
    const ids = wikidata.slice(0, 4).map((w) => w.id).join("|");
    const ents = await getJson<WdEntities>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=sitelinks&sitefilter=enwiki&format=json`,
    );
    if (ents?.entities) {
      for (const w of wikidata) {
        const site = ents.entities[w.id]?.sitelinks?.enwiki;
        if (site?.title) w.wikipedia = `https://en.wikipedia.org/wiki/${encodeURIComponent(site.title.replace(/ /g, "_"))}`;
      }
    }
    notes.push(`${wikidata.length} possible public-entity match(es) on Wikidata — verify before assuming identity.`);
  } else {
    notes.push("No Wikidata entities matched this name.");
  }

  // ── ORCID researcher registry (public records) ────────────────────
  let orcid: OrcidCandidate[] = [];
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const given = tokens[0];
    const family = tokens[tokens.length - 1];
    const q = `given-names:"${given}" AND family-name:"${family}"`;
    const data = await getJson<OrcidSearch>(
      `https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(q)}&rows=5`,
      "application/json",
    );
    const rows = data?.["expanded-result"] ?? [];
    orcid = rows
      .filter((r) => r.orcid?.path)
      .map((r) => ({
        orcid: r.orcid!.path!,
        givenNames: r["given-names"]?.value ?? null,
        familyNames: r["family-names"]?.value ?? null,
        url: `https://orcid.org/${r.orcid!.path}`,
      }));
    if (orcid.length > 0) {
      notes.push(`${orcid.length} possible researcher record(s) in the public ORCID registry.`);
    }
  } else {
    notes.push("ORCID researcher lookup skipped — it needs at least a first and last name.");
  }

  notes.push("Search-engine dorks below open public indexes in a new tab; run them to continue the trace.");
  if (location) notes.push(`Location qualifier applied: “${location}”.`);

  const report: IdentityReport = {
    name,
    wikidata,
    orcid,
    notes,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(
    { ...report, dorks: buildDorks(name, location) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
