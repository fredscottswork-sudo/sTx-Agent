import net from "node:net";
import { promises as dnsPromises } from "node:dns";
import {
  COMMON_PORTS,
  SERVICE_NAMES,
  clientIp,
  createRateLimiter,
  ndjsonResponse,
  type PortResult,
} from "@/lib/recon";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RATE = createRateLimiter(60_000, 4);
const CONNECT_TIMEOUT_MS = 750;
const BANNER_WAIT_MS = 400;
const CONCURRENCY = 14;
const DEADLINE_MS = 50_000;

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(s: string): boolean {
  const m = s.match(IPV4_RE);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
}

function cleanBanner(buf: Buffer): string {
  return buf
    .toString("utf8")
    .replace(/[^\x20-\x7e]+/g, " ")
    .trim()
    .slice(0, 100);
}

function scanPort(ip: string, port: number, deadline: number): Promise<PortResult> {
  const t0 = Date.now();
  const service = SERVICE_NAMES[port] || "";
  const budget = Math.min(CONNECT_TIMEOUT_MS, Math.max(400, deadline - Date.now()));
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout = setTimeout(
      () => finish({ port, open: false, reason: "timeout" }),
      budget,
    );
    const finish = (r: Omit<PortResult, "ms" | "service">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ...r, service, ms: Date.now() - t0 });
    };
    const sock = net.connect({ host: ip, port });
    sock.on("connect", () => {
      // Connected → give the service a moment to send an unsolicited banner (SSH/SMTP/FTP).
      clearTimeout(timer);
      timer = setTimeout(() => finish({ port, open: true }), BANNER_WAIT_MS);
      sock.once("data", (d: Buffer) => finish({ port, open: true, banner: cleanBanner(d) }));
    });
    sock.on("error", (e: NodeJS.ErrnoException) =>
      finish({ port, open: false, reason: e.code || "error" }),
    );
    sock.on("close", () => finish({ port, open: false, reason: "closed" }));
  });
}

async function resolveHost(host: string): Promise<{ ip?: string; error?: string }> {
  if (isIpv4(host)) return { ip: host };
  try {
    const r = await dnsPromises.lookup(host, { family: 4 });
    return { ip: r.address };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "DNS resolution failed" };
  }
}

async function runPorts(host: string, send: (o: unknown) => void) {
  const t0 = Date.now();
  const deadline = t0 + DEADLINE_MS;
  send({ type: "meta", host, total: COMMON_PORTS.length, startedAt: new Date().toISOString() });

  const resolved = await resolveHost(host);
  if (!resolved.ip) {
    send({ type: "error", message: `Could not resolve ${host}: ${resolved.error}` });
    return;
  }
  const ip = resolved.ip;
  send({ type: "resolved", ip, host });

  let open = 0;
  let closed = 0;
  let filtered = 0;
  const errors: Record<string, number> = {};
  let idx = 0;
  await (async () => {
    const worker = async () => {
      for (;;) {
        const i = idx++;
        if (i >= COMMON_PORTS.length) return;
        if (Date.now() > deadline) {
          closed++;
          send({ type: "port", port: COMMON_PORTS[i], open: false, service: "", reason: "budget", ms: 0 });
          continue;
        }
        const r = await scanPort(ip, COMMON_PORTS[i], deadline);
        if (r.open) open++;
        else {
          closed++;
          if (r.reason && r.reason !== "timeout") errors[r.reason] = (errors[r.reason] || 0) + 1;
          if (r.reason === "timeout") filtered++;
        }
        send({ type: "port", ...r });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  })();

  // Honest signal: if even 80/443 produced connection resets from this environment,
  // outbound TCP is likely filtered and results are incomplete.
  const suspicious =
    open === 0 && (errors.ECONNRESET || 0) + (errors.EPERM || 0) + (errors.EHOSTUNREACH || 0) >= 8;
  if (suspicious) {
    send({
      type: "note",
      message:
        "All connections were reset by the scanning environment — outbound TCP appears filtered. Treat these results as inconclusive.",
    });
  }

  send({ type: "done", ip, open, closed, filtered, errors, ms: Date.now() - t0 });
}

function parseHostParam(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const cleaned = raw.replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0].replace(/\.$/, "");
  if (isIpv4(cleaned)) return cleaned;
  if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (RATE(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }
  let host = "";
  try {
    const body = (await req.json()) as { host?: unknown };
    host = String(body?.host ?? "").trim();
  } catch {
    /* fallthrough */
  }
  const target = parseHostParam(host);
  if (!target) {
    return Response.json(
      { error: "Enter a domain or IPv4 address to scan." },
      { status: 400 },
    );
  }
  return ndjsonResponse((send) => runPorts(target, send));
}

export async function GET(req: Request) {
  const ip = clientIp(req);
  if (RATE(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }
  const target = parseHostParam(new URL(req.url).searchParams.get("host") || "");
  if (!target) {
    return Response.json(
      { error: "Enter a domain or IPv4 address to scan." },
      { status: 400 },
    );
  }
  return ndjsonResponse((send) => runPorts(target, send));
}
