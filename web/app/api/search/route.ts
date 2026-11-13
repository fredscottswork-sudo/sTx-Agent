import type {
  GhUserCandidate,
  HnCandidate,
  IdentityReport,
  OrcidCandidate,
  SeUserCandidate,
  WikidataCandidate,
  WikipediaCandidate,
} from "@/lib/types";

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

async function getText(url: string, timeoutMs = 9000): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    return await res.text();
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
interface WikiSearch {
  pages?: { title: string; key?: string; excerpt?: string; description?: string }[];
}
interface OrcidSearch {
  "expanded-result"?: {
    orcid?: { path?: string };
    "given-names"?: { value?: string };
    "family-names"?: { value?: string };
  }[];
}
interface SeUsers {
  items?: { display_name: string; link: string; reputation: number }[];
}
interface GhUsers {
  items?: { login: string; html_url: string }[];
}
interface GlUsers {
  username: string; web_url: string;
}
interface HnHits {
  hits?: { author: string; title?: string; url?: string; objectID?: string }[];
}

function buildDorks(name: string, location?: string) {
  const q = `${name}${location ? " " + location : ""}`.trim();
  const enc = encodeURIComponent;
  const siteQ = (site: string) => enc(`site:${site} "${q}"`);
  return [
    { engine: "Google", url: `https://www.google.com/search?q=${enc(`"${q}"`)}` },
    { engine: "Google — LinkedIn", url: `https://www.google.com/search?q=${siteQ("linkedin.com/in")}` },
    { engine: "Google — News", url: `https://www.google.com/search?q=${enc(`"${q}"`)}&tbm=nws` },
    { engine: "Google — Images", url: `https://www.google.com/search?q=${enc(`"${q}"`)}&tbm=isch` },
    { engine: "DuckDuckGo", url: `https://duckduckgo.com/?q=${enc(`"${q}"`)}` },
    { engine: "Bing", url: `https://www.bing.com/search?q=${enc(`"${q}"`)}` },
    { engine: "Yandex", url: `https://yandex.com/search/?text=${enc(`"${q}"`)}` },
    { engine: "X / Twitter", url: `https://x.com/search?q=${enc(q)}&f=live` },
    { engine: "GitHub users", url: `https://github.com/search?q=${enc(q)}&type=users` },
    { engine: "Reddit", url: `https://www.reddit.com/search/?q=${enc(q)}` },
    { engine: "YouTube", url: `https://www.youtube.com/results?search_query=${enc(q)}` },
    { engine: "Medium", url: `https://medium.com/search?q=${enc(q)}` },
    { engine: "Telegram", url: `https://duckduckgo.com/?q=${enc(`site:t.me "${q}"`)}` },
    { engine: "Pastebin", url: `https://duckduckgo.com/?q=${enc(`site:pastebin.com "${q}"`)}` },
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
  const tokens = name.split(/\s+/).filter(Boolean);
  const given = tokens[0] ?? "";
  const family = tokens[tokens.length - 1] ?? "";
  const isWesternOrder = tokens.length >= 2;

  // ── Wikidata + Wikipedia ──────────────────────────────────────────
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

  const wiki = await getJson<WikiSearch>(
    `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(name)}&limit=5`,
  );
  const wikipedia: WikipediaCandidate[] = (wiki?.pages ?? [])
    .filter((p) => p.title && p.title.toLowerCase() !== "main page")
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      extract: (p.excerpt ?? p.description ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
    }));
  if (wikipedia.length) notes.push(`${wikipedia.length} Wikipedia article match(es).`);

  // ── ORCID researcher registry ─────────────────────────────────────
  let orcid: OrcidCandidate[] = [];
  if (isWesternOrder) {
    const q = `given-names:"${given}" AND family-name:"${family}"`;
    const data = await getJson<OrcidSearch>(
      `https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(q)}&rows=5`,
      "application/json",
    );
    orcid = (data?.["expanded-result"] ?? [])
      .filter((r) => r.orcid?.path)
      .map((r) => ({
        orcid: r.orcid!.path!,
        givenNames: r["given-names"]?.value ?? null,
        familyNames: r["family-names"]?.value ?? null,
        url: `https://orcid.org/${r.orcid!.path}`,
      }));
    if (orcid.length) notes.push(`${orcid.length} possible researcher record(s) in the public ORCID registry.`);
  } else {
    notes.push("ORCID researcher lookup skipped — it needs at least a first and last name.");
  }

  // ── Stack Exchange network (Stack Overflow etc.) ──────────────────
  const se = await getJson<SeUsers>(
    `https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=${encodeURIComponent(name)}&site=stackoverflow&pagesize=5&filter=default`,
  );
  const stackexchange: SeUserCandidate[] = (se?.items ?? [])
    .filter((u) => u.display_name && u.link)
    .map((u) => ({ display_name: u.display_name, link: u.link, reputation: u.reputation, site: "Stack Overflow" }));
  if (stackexchange.length) notes.push(`${stackexchange.length} Stack Exchange profile candidate(s).`);

  // ── GitHub user search ────────────────────────────────────────────
  const gh = await getJson<GhUsers>(
    `https://api.github.com/search/users?q=${encodeURIComponent(name)}+in:fullname&per_page=5`,
  );
  const github: GhUserCandidate[] = (gh?.items ?? [])
    .filter((u) => u.login && u.html_url)
    .map((u) => ({ login: u.login, url: u.html_url }));
  if (github.length) notes.push(`${github.length} GitHub user(s) with this full name in their profile.`);

  // ── GitLab user search ────────────────────────────────────────────
  const gl = await getJson<GlUsers[]>(
    `https://gitlab.com/api/v4/users?search=${encodeURIComponent(name)}&per_page=5`,
  );
  const gitlab: GhUserCandidate[] = (Array.isArray(gl) ? gl : [])
    .filter((u) => u.username && u.web_url)
    .map((u) => ({ login: u.username, url: u.web_url }));
  if (gitlab.length) notes.push(`${gitlab.length} GitLab user candidate(s).`);

  // ── Hacker News (Algolia, author search) ──────────────────────────
  const hn = await getJson<HnHits>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(name)}&tags=author&hitsPerPage=5`,
  );
  const hackernews: HnCandidate[] = (hn?.hits ?? [])
    .filter((h) => h.author)
    .map((h) => ({
      author: h.author,
      title: h.title ?? "(comment)",
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    }));
  if (hackernews.length) notes.push(`${hackernews.length} Hacker News author hit(s).`);

  notes.push("Search-engine dorks below open public indexes in a new tab; run them to continue the trace.");
  if (location) notes.push(`Location qualifier applied: “${location}”.`);

  const report: IdentityReport = {
    name,
    wikidata,
    wikipedia,
    orcid,
    stackexchange,
    github,
    gitlab,
    hackernews,
    dorks: buildDorks(name, location),
    notes,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
