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
const CDX_LIMIT = 2500;
const STREAM_CAP = 400;

async function runHistory(domain: string, send: (o: unknown) => void) {
  const t0 = Date.now();
  send({ type: "meta", domain, startedAt: new Date().toISOString() });

  const cdx =
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*` +
    `&output=json&fl=original,timestamp,statuscode,mimetype&collapse=urlkey` +
    `&filter=statuscode:200&limit=${CDX_LIMIT}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 28_000);
  let rows: string[][] = [];
  try {
    const res = await fetch(cdx, {
      signal: ctl.signal,
      cache: "no-store",
      headers: { "User-Agent": RECON_UA },
    });
    if (!res.ok) throw new Error(`archive.org HTTP ${res.status}`);
    const json = (await res.json()) as string[][];
    rows = Array.isArray(json) ? json.slice(1) : [];
  } catch (e) {
    send({
      type: "error",
      message: `Wayback lookup failed: ${e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "unknown error"}`,
    });
    return;
  } finally {
    clearTimeout(timer);
  }

  send({ type: "received", count: rows.length, capped: rows.length >= CDX_LIMIT });

  const streamed: WaybackRow[] = [];
  let interestingCount = 0;
  const extCounts: Record<string, number> = {};
  for (const r of rows) {
    const [url = "", ts = "", status = "", mime = ""] = r;
    if (!url) continue;
    const tags = classifyUrlTags(url);
    if (!tags.length) continue;
    interestingCount++;
    for (const t of tags) extCounts[t] = (extCounts[t] || 0) + 1;
    if (streamed.length < STREAM_CAP) {
      const row: WaybackRow = { url, ts, status, mime, tags };
      streamed.push(row);
      send({ type: "url", row });
    }
  }

  send({
    type: "done",
    total: rows.length,
    interesting: interestingCount,
    streamed: streamed.length,
    capped: rows.length >= CDX_LIMIT,
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
