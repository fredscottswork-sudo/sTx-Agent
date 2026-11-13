import {
  RECON_UA,
  classifyUrlTags,
  clientIp,
  createRateLimiter,
  ndjsonResponse,
  normalizeTarget,
  type WaybackRow,
} from "@/lib/recon";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RATE = createRateLimiter(60_000, 6);
const STREAM_CAP = 400;

interface NormRow {
  url: string;
  ts: string;
  status: string;
  mime: string;
}

async function fetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": RECON_UA, Accept: accept },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Source 1: Internet Archive CDX (array-of-arrays with header row). */
async function tryArchiveOrg(domain: string, timeoutMs: number): Promise<NormRow[]> {
  const cdx =
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*` +
    `&output=json&fl=original,timestamp,statuscode,mimetype&collapse=urlkey` +
    `&filter=statuscode:200&limit=2500`;
  const text = await fetchText(cdx, timeoutMs, "application/json");
  const json = JSON.parse(text) as string[][];
  if (!Array.isArray(json)) throw new Error("unexpected CDX payload");
  return json
    .slice(1)
    .filter((r) => Array.isArray(r) && r[0])
    .map((r) => ({ url: r[0], ts: r[1] || "", status: r[2] || "", mime: r[3] || "" }));
}

/** Source 2: Common Crawl index (JSONL) — used when archive.org is unreachable. */
async function tryCommonCrawl(domain: string, timeoutMs: number): Promise<NormRow[]> {
  const collText = await fetchText(
    "https://index.commoncrawl.org/collinfo.json",
    Math.min(7_000, timeoutMs),
    "application/json",
  );
  const colls = JSON.parse(collText) as { id?: string; "cdx-api"?: string }[];
  const api = colls?.[0]?.["cdx-api"];
  if (!api) throw new Error("no Common Crawl index available");
  const query =
    `${api}?url=${encodeURIComponent(domain + "/*")}&output=json&limit=1500`;
  const text = await fetchText(
    query,
    Math.max(4_000, timeoutMs - 7_000),
    "application/json, text/plain",
  );
  const rows: NormRow[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const o = JSON.parse(l) as {
        url?: string;
        timestamp?: string;
        status?: string;
        mime?: string;
      };
      if (o.url) {
        rows.push({
          url: o.url,
          ts: o.timestamp || "",
          status: String(o.status ?? ""),
          mime: o.mime || "",
        });
      }
    } catch {
      /* skip unparsable line */
    }
  }
  if (!rows.length) throw new Error("empty Common Crawl response");
  return rows;
}

async function runHistory(domain: string, send: (o: unknown) => void) {
  const t0 = Date.now();
  send({ type: "meta", domain, startedAt: new Date().toISOString() });

  // Hard deadline: stay well under maxDuration with two sources.
  const hardDeadline = t0 + 44_000;
  let rows: NormRow[] = [];
  let source = "";
  let lastErr = "";

  const remaining = () => hardDeadline - Date.now();

  // Source 1 — Internet Archive
  if (remaining() > 12_000) {
    try {
      rows = await tryArchiveOrg(domain, Math.min(18_000, remaining() - 8_000));
      source = "archive.org";
    } catch (e) {
      lastErr = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "failed";
      send({ type: "note", message: `archive.org unavailable (${lastErr}) — trying Common Crawl…` });
    }
  }

  // Source 2 — Common Crawl
  if (!source && remaining() > 8_000) {
    try {
      rows = await tryCommonCrawl(domain, Math.min(24_000, remaining() - 2_000));
      source = "commoncrawl";
    } catch (e) {
      lastErr = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "failed";
    }
  }

  if (!source) {
    send({
      type: "error",
      message: `Web-archive lookup failed (${lastErr || "no source reachable"}). Both archive.org and Common Crawl were unreachable — try again later.`,
    });
    return;
  }

  send({ type: "source", source, received: rows.length });

  const streamed: WaybackRow[] = [];
  let interestingCount = 0;
  const extCounts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.url) continue;
    const tags = classifyUrlTags(r.url);
    if (!tags.length) continue;
    interestingCount++;
    for (const t of tags) extCounts[t] = (extCounts[t] || 0) + 1;
    if (streamed.length < STREAM_CAP) {
      const row: WaybackRow = {
        url: r.url,
        ts: r.ts,
        status: r.status,
        mime: r.mime,
        tags,
      };
      streamed.push(row);
      send({ type: "url", row });
    }
  }

  send({
    type: "done",
    source,
    total: rows.length,
    interesting: interestingCount,
    streamed: streamed.length,
    capped: rows.length >= 1500,
    tagCounts: Object.entries(extCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count })),
    ms: Date.now() - t0,
  });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (RATE(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }
  let domain = "";
  try {
    const body = (await req.json()) as { domain?: unknown };
    domain = String(body?.domain ?? "");
  } catch {
    /* fallthrough */
  }
  const target = normalizeTarget(domain);
  if (!target) {
    return Response.json({ error: "Enter a valid domain, e.g. example.com." }, { status: 400 });
  }
  return ndjsonResponse((send) => runHistory(target, send));
}

export async function GET(req: Request) {
  const ip = clientIp(req);
  if (RATE(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }
  const url = new URL(req.url);
  const target = normalizeTarget(url.searchParams.get("domain") || "");
  if (!target) {
    return Response.json({ error: "Enter a valid domain, e.g. example.com." }, { status: 400 });
  }
  return ndjsonResponse((send) => runHistory(target, send));
}
