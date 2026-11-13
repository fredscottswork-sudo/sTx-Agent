import { SITES, buildUrl, compilePattern, type SiteDef } from "@/lib/sites";
import type { CheckStatus, SiteResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PER_REQUEST_MS = 4200;
const DEADLINE_MS = 52000; // stay under maxDuration
const CONCURRENCY = 14;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;

// Best-effort in-memory per-IP limit (resets per instance / cold start).
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function checkSite(site: SiteDef, username: string, deadline: number): Promise<SiteResult> {
  const url = buildUrl(site, username);
  const t0 = Date.now();
  const base = { site: site.name, url, category: site.category };
  if (Date.now() > deadline) {
    return { ...base, status: "skipped", note: "time budget exhausted", ms: 0 };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PER_REQUEST_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "follow",
        signal: ctl.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    let status: CheckStatus = "unknown";
    const errRe = compilePattern(site.errorPattern, username);
    const foundRe = compilePattern(site.foundPattern, username);
    const needsBody = Boolean(errRe || foundRe);

    if (res.status === 404 || res.status === 410) {
      status = "missing";
    } else if (res.status === 200) {
      if (needsBody) {
        const text = (await res.text().catch(() => "")).slice(0, 250_000);
        if (errRe && errRe.test(text)) status = "missing";
        else if (foundRe) status = foundRe.test(text) ? "found" : "unknown";
        else status = site.hard ? "unknown" : "found";
      } else {
        status = site.hard ? "unknown" : "found";
      }
    } else if ([401, 403, 429, 451, 999].includes(res.status) && needsBody) {
      const text = (await res.text().catch(() => "")).slice(0, 250_000);
      if (errRe && errRe.test(text)) status = "missing";
      else status = "unknown";
    } else {
      status = "unknown";
    }

    let note: string | undefined;
    if (status === "unknown") {
      note =
        res.status === 200 && site.hard
          ? "login wall / client-rendered page — inconclusive"
          : `HTTP ${res.status}`;
    }
    return { ...base, status, note, ms: Date.now() - t0 };
  } catch (e) {
    const note =
      e instanceof Error && e.name === "AbortError" ? "timeout" : "network error / blocked";
    return { ...base, status: "unknown", note, ms: Date.now() - t0 };
  }
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (rateLimited(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }

  let username = "";
  try {
    const body = (await req.json()) as { username?: unknown };
    username = String(body?.username ?? "").trim();
  } catch {
    /* fallthrough */
  }
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(username)) {
    return Response.json(
      {
        error:
          "Invalid username. Use 1–40 characters: letters, numbers, dot (.), underscore (_), hyphen (-).",
      },
      { status: 400 },
    );
  }

  const deadline = Date.now() + DEADLINE_MS;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      send({ type: "meta", total: SITES.length, username });
      let idx = 0;
      let done = 0;
      let found = 0;
      let missing = 0;
      let unknown = 0;
      const t0 = Date.now();
      const worker = async () => {
        for (;;) {
          const i = idx++;
          if (i >= SITES.length) return;
          const r = await checkSite(SITES[i], username, deadline);
          if (r.status === "found") found++;
          else if (r.status === "missing") missing++;
          else unknown++;
          done++;
          send({ type: "result", result: r, progress: done });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
      send({ type: "done", found, missing, unknown, ms: Date.now() - t0 });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
