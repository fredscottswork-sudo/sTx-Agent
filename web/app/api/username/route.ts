import { SITE_CATALOG, buildUrl, compilePattern, escapeRegex, findSites, type SiteDef } from "@/lib/sites";
import type { CheckStatus, Confidence, SiteResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PER_REQUEST_MS = 4000;
const RETRY_MS = 2500;
const BODY_CAP = 300_000;
const DEADLINE_MS = 54_000; // stay under maxDuration
const CONCURRENCY = 20;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;

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

function echoRegex(username: string): RegExp {
  const u = escapeRegex(username);
  return new RegExp(
    [
      `<title>[^<]*\\b${u}\\b`,
      `property=["']og:url["'][^>]*${u}`,
      `rel=["']canonical["'][^>]*${u}`,
      `href=["']/(?:u|user|users|profile|member|members|people)/${u}(?:[/?#"'&]|["'])`,
      `href=["']/${u}(?:[/?#"'&]|["'])`,
      `@[?]${u}\\b`,
      `"username"\\s*:\\s*"${u}"`,
      `"login"\\s*:\\s*"${u}"`,
      `steamcommunity\\.com/id/${u}`,
      `${u}\\.bsky\\.social`,
    ].join("|"),
    "i",
  );
}

const LOGIN_RE = /\/(login|log-in|signin|sign-in|signup|sign-up|auth|oauth|account\/login|users\/sign_in)(\/|$|\?)/i;

const CHALLENGE_RE =
  /client challenge|just a moment\.\.\.|checking your browser|attention required|ddos protection by|enable javascript and cookies to continue|verifying you are human|cloudflare ray id|why have i been blocked/i;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Range: `bytes=0-${BODY_CAP}`,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > BODY_CAP ? text.slice(0, BODY_CAP) : text;
  } catch {
    return "";
  }
}

function classify(
  site: SiteDef,
  username: string,
  url: string,
  res: Response,
  body: string,
): SiteResult {
  const base = { site: site.name, url, category: site.category };
  const errRe = compilePattern(site.errorPattern, username);
  const foundRe = compilePattern(site.foundPattern, username);
  const status = res.status;

  let finalPath = "";
  try {
    finalPath = new URL(res.url || url).pathname;
  } catch {
    /* ignore */
  }
  const originalPath = new URL(url).pathname;

  // Auth-wall redirects prove nothing
  if (LOGIN_RE.test(finalPath)) {
    return { ...base, status: "unknown", note: "redirected to login wall", ms: 0 };
  }
  if (status === 200 && finalPath === "/" && originalPath !== "/") {
    return { ...base, status: "unknown", note: "redirected to homepage", ms: 0 };
  }

  if (status === 404 || status === 410) {
    return { ...base, status: "missing", confidence: "high", ms: 0 };
  }

  if (errRe && body && errRe.test(body)) {
    return { ...base, status: "missing", confidence: "high", note: "soft-404 marker in page", ms: 0 };
  }

  if (status === 200 || status === 206) {
    if (body && CHALLENGE_RE.test(body)) {
      return { ...base, status: "unknown", note: "bot challenge page — inconclusive", ms: 0 };
    }
    if (foundRe && body && foundRe.test(body)) {
      return { ...base, status: "found", confidence: "high", note: "profile marker matched", ms: 0 };
    }
    if (!site.hard) {
      if (body && echoRegex(username).test(body)) {
        return { ...base, status: "found", confidence: "high", note: "username echoed in page", ms: 0 };
      }
      return {
        ...base,
        status: "found",
        confidence: "low",
        note: "HTTP 200 but username not echoed — possible soft-404",
        ms: 0,
      };
    }
    return {
      ...base,
      status: "unknown",
      note: "login wall / client-rendered page — inconclusive",
      ms: 0,
    };
  }

  if ([401, 403, 429, 451, 999].includes(status)) {
    return { ...base, status: "unknown", note: `blocked (HTTP ${status})`, ms: 0 };
  }
  return { ...base, status: "unknown", note: `HTTP ${status}`, ms: 0 };
}

async function checkSite(site: SiteDef, username: string, deadline: number): Promise<SiteResult> {
  const url = buildUrl(site, username);
  const t0 = Date.now();
  const base = { site: site.name, url, category: site.category };
  if (Date.now() > deadline) {
    return { ...base, status: "skipped", note: "time budget exhausted", ms: 0 };
  }

  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const timeout = attempt === 0 ? PER_REQUEST_MS : RETRY_MS;
    if (Date.now() + timeout > deadline + 1500) break;
    try {
      res = await fetchWithTimeout(url, timeout);
      break;
    } catch (e) {
      lastErr = e instanceof Error && e.name === "AbortError" ? "timeout" : "network error";
      // brief pause before retry
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  if (!res) {
    return { ...base, status: "unknown", note: `${lastErr || "unreachable"} after retry`, ms: Date.now() - t0 };
  }

  const needsBody =
    res.status === 200 ||
    res.status === 206 ||
    [401, 403, 429, 451, 999].includes(res.status) ||
    Boolean(site.errorPattern || site.foundPattern);
  const body = needsBody ? await readBody(res) : "";
  const result = classify(site, username, url, res, body);
  result.ms = Date.now() - t0;
  return result;
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
  let siteNames: string[] | undefined;
  try {
    const body = (await req.json()) as { username?: unknown; sites?: unknown };
    username = String(body?.username ?? "").trim();
    if (Array.isArray(body?.sites)) siteNames = body.sites.slice(0, 300).map(String);
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

  const catalog = (siteNames && findSites(siteNames)) || SITE_CATALOG;
  const deadline = Date.now() + DEADLINE_MS;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      send({ type: "meta", total: catalog.length, username });
      let idx = 0;
      let done = 0;
      let found = 0;
      let missing = 0;
      let unknown = 0;
      const t0 = Date.now();
      const worker = async () => {
        for (;;) {
          const i = idx++;
          if (i >= catalog.length) return;
          const r = await checkSite(catalog[i], username, deadline);
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
