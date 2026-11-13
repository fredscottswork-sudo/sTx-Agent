import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "stx-trace-images";
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB
const SIGN_TTL = 1800; // 30 minutes
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // purge hosted files after 24 h
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

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
  if (hits.size > 2000) hits.clear();
  return false;
}

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Best-effort purge of files older than 24h (runs opportunistically). */
async function cleanup(sb: { url: string; key: string }): Promise<void> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${sb.url}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${sb.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefix: "search/", limit: 200, sortBy: { column: "created_at", order: "desc" } }),
      });
      if (!res.ok) return;
      const items = (await res.json()) as { name?: string; created_at?: string }[];
      const cutoff = Date.now() - MAX_AGE_MS;
      const stale = items
        .filter((i) => i.name && i.created_at && Date.parse(i.created_at) < cutoff)
        .map((i) => `search/${i.name}`)
        .slice(0, 40);
      if (!stale.length) return;
      await fetch(`${sb.url}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${sb.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paths: stale }),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* cleanup is best-effort */
  }
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (rateLimited(ip)) {
    return Response.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });
  }
  const sb = supabase();
  if (!sb) {
    return Response.json(
      {
        error:
          "Image hosting is not configured on this deployment (SUPABASE_URL / SUPABASE_SERVICE_KEY missing). EXIF and gallery search still work.",
      },
      { status: 503 },
    );
  }

  let mime = "";
  let b64 = "";
  try {
    const body = (await req.json()) as { mime?: unknown; data?: unknown };
    mime = String(body.mime ?? "");
    b64 = String(body.data ?? "");
  } catch {
    /* fallthrough */
  }

  const ext = ALLOWED[mime];
  if (!ext) {
    return Response.json({ error: "Unsupported image type. Use JPEG, PNG, WEBP or GIF." }, { status: 400 });
  }
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (!b64 || approxBytes > MAX_BYTES) {
    return Response.json({ error: "Image too large (max 6 MB) or empty." }, { status: 413 });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error("size");
  } catch {
    return Response.json({ error: "Could not decode image data." }, { status: 400 });
  }

  const path = `search/${randomUUID()}.${ext}`;

  // 1) upload
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let up: Response;
    try {
      up = await fetch(`${sb.url}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${sb.key}`,
          "Content-Type": mime,
          "x-upsert": "false",
        },
        body: new Uint8Array(buf),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!up.ok) {
      const text = await up.text().catch(() => "");
      return Response.json(
        { error: `Storage upload failed (HTTP ${up.status}). ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
  } catch {
    return Response.json({ error: "Storage upload timed out." }, { status: 504 });
  }

  // 2) signed URL
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    let signRes: Response;
    try {
      signRes = await fetch(`${sb.url}/storage/v1/object/sign/${BUCKET}`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${sb.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: SIGN_TTL, paths: [path] }),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!signRes.ok) {
      return Response.json({ error: `Could not create signed URL (HTTP ${signRes.status}).` }, { status: 502 });
    }
    const data = (await signRes.json()) as { signedURL?: string };
    const signedPath = data.signedURL ?? "";
    const url = `${sb.url}/storage/v1${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`;

    // 3) opportunistic cleanup of old files
    void cleanup(sb);

    return Response.json(
      {
        url,
        expiresInSeconds: SIGN_TTL,
        note: "URL is a private expiring link — reverse-search engines fetch it immediately when you open a search.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Signed URL creation timed out." }, { status: 504 });
  }
}
