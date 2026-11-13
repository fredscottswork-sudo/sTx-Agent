import {
  PATH_WORDLIST,
  RECON_UA,
  clientIp,
  createRateLimiter,
  mapPool,
  ndjsonResponse,
  normalizeTarget,
} from "@/lib/recon";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RATE = createRateLimiter(60_000, 3);
const PER_REQUEST_MS = 3_500;
const CONCURRENCY = 10;
const DEADLINE_MS = 50_000;

async function detectBase(domain: string, deadline: number): Promise<string | null> {
  for (const scheme of ["https", "http"] as const) {
    const ctl = new AbortController();
    const timer = setTimeout(
      () => ctl.abort(),
      Math.min(5_000, Math.max(1_200, deadline - Date.now())),
    );
    try {
      const res = await fetch(`${scheme}://${domain}/`, {
        method: "HEAD",
        redirect: "manual",
        signal: ctl.signal,
        cache: "no-store",
        headers: { "User-Agent": RECON_UA },
      });
      if (res.status > 0) return `${scheme}://${domain}`;
    } catch {
      /* next scheme */
    } finally {
      clearTimeout(timer);
    }
  }
  // Some servers reject HEAD — try a plain GET as fallback.
  for (const scheme of ["https", "http"] as const) {
    const ctl = new AbortController();
    const timer = setTimeout(
      () => ctl.abort(),
      Math.min(5_000, Math.max(1_200, deadline - Date.now())),
    );
    try {
      const res = await fetch(`${scheme}://${domain}/`, {
        redirect: "manual",
        signal: ctl.signal,
        cache: "no-store",
        headers: { "User-Agent": RECON_UA },
      });
      if (res.status > 0) return `${scheme}://${domain}`;
    } catch {
      /* next scheme */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function runPaths(domain: string, send: (o: unknown) => void) {
  const t0 = Date.now();
  const deadline = t0 + DEADLINE_MS;
  send({ type: "meta", domain, total: PATH_WORDLIST.length, startedAt: new Date().toISOString() });

  const base = await detectBase(domain, deadline);
  if (!base) {
    send({ type: "error", message: `Could not reach ${domain} over HTTP or HTTPS.` });
    return;
  }
  send({ type: "base", base });

  let done = 0;
  let hits = 0;
  let skipped = 0;
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= PATH_WORDLIST.length) return;
      const path = PATH_WORDLIST[i];
      if (Date.now() > deadline) {
        skipped++;
        done++;
        send({ type: "tick", done, hits, skipped });
        continue;
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), PER_REQUEST_MS);
      const started = Date.now();
      try {
        const res = await fetch(`${base}/${path}`, {
          redirect: "manual",
          signal: ctl.signal,
          cache: "no-store",
          headers: {
            "User-Agent": RECON_UA,
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          },
        });
        done++;
        if (res.status !== 404 && res.status !== 0) {
          hits++;
          const loc = res.headers.get("location");
          send({
            type: "hit",
            hit: {
              path,
              status: res.status,
              contentType: res.headers.get("content-type") || undefined,
              size: Number(res.headers.get("content-length") || 0) || undefined,
              redirect: loc ? loc.slice(0, 200) : undefined,
              ms: Date.now() - started,
            },
          });
        }
        send({ type: "tick", done, hits, skipped });
      } catch {
        done++;
        skipped++;
        send({ type: "tick", done, hits, skipped });
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  send({
    type: "done",
    base,
    checked: done,
    hits,
    skipped,
    ms: Date.now() - t0,
    note: "Verify hits manually — some servers answer 200 for missing paths (soft-404).",
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
  return ndjsonResponse((send) => runPaths(target, send));
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
  return ndjsonResponse((send) => runPaths(target, send));
}
