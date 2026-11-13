import tls from "node:tls";
import {
  BRUTE_WORDS,
  RECON_UA,
  auditFromHeaders,
  clientIp,
  createRateLimiter,
  detectTech,
  dohQuery,
  extractTitle,
  mapPool,
  ndjsonResponse,
  normalizeTarget,
  type DnsRecord,
  type HostProbe,
  type TlsInfo,
} from "@/lib/recon";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RATE = createRateLimiter(60_000, 4);
const DEADLINE_MS = 52_000;
const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA", "SRV", "DS"];
const HOST_CAP = 24;

function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return Promise.resolve("");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  return (async () => {
    try {
      while (n < cap) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.length;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
    const buf = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
      buf.set(c, o);
      o += c.length;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  })();
}

async function fetchCt(domain: string, deadline: number): Promise<{
  subs: string[];
  ms: number;
  error?: string;
}> {
  const t0 = Date.now();
  const budget = Math.min(24_000, Math.max(2_000, deadline - Date.now()));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budget);
  try {
    const res = await fetch(`https://crt.sh/?q=%25.${domain}&output=json`, {
      signal: ctl.signal,
      headers: { "User-Agent": RECON_UA },
    });
    if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
    const text = await res.text();
    const rows = JSON.parse(text.slice(0, 4_000_000)) as { name_value?: string }[];
    const set = new Set<string>();
    for (const r of rows) {
      for (const raw of (r.name_value || "").split("\n")) {
        const n = raw.trim().toLowerCase().replace(/^\*\./, "");
        if (n === domain || n.endsWith(`.${domain}`)) set.add(n);
      }
      if (set.size > 600) break;
    }
    return { subs: [...set].slice(0, 400), ms: Date.now() - t0 };
  } catch (e) {
    return {
      subs: [],
      ms: Date.now() - t0,
      error: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeHost(host: string, deadline: number): Promise<HostProbe> {
  const t0 = Date.now();
  const budget = Math.min(5_000, Math.max(1_500, deadline - Date.now()));
  for (const scheme of ["https", "http"] as const) {
    const url = `${scheme}://${host}/`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budget);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: ctl.signal,
        cache: "no-store",
        headers: {
          "User-Agent": RECON_UA,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const setCookies =
        typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      const html = await readCapped(res, 150_000);
      const finalUrl = res.url || url;
      return {
        host,
        url: finalUrl,
        status: res.status,
        statusText: res.statusText,
        title: extractTitle(html),
        server: headers["server"],
        poweredBy: headers["x-powered-by"],
        redirect: finalUrl !== url ? finalUrl : undefined,
        tech: detectTech(headers, html, setCookies),
        cookies: setCookies,
        size: html.length,
        contentType: headers["content-type"],
        ms: Date.now() - t0,
        headers,
      };
    } catch {
      /* try next scheme */
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    host,
    url: `https://${host}/`,
    status: 0,
    statusText: "",
    tech: [],
    cookies: [],
    ms: Date.now() - t0,
    error: "unreachable",
    headers: {},
  };
}

function probeTls(host: string, deadline: number): Promise<TlsInfo> {
  const t0 = Date.now();
  const timeout = Math.min(5_000, Math.max(1_500, deadline - Date.now()));
  return new Promise((resolve) => {
    let settled = false;
    const done = (info: TlsInfo) => {
      if (settled) return;
      settled = true;
      resolve(info);
    };
    try {
      const sock = tls.connect(
        { host, port: 443, servername: host, rejectUnauthorized: false, timeout },
        () => {
          const c = sock.getPeerCertificate();
          const cipher = sock.getCipher();
          done({
            host,
            issuer:
              (c.issuer as Record<string, string> | undefined)?.organizationName ||
              (c.issuer as Record<string, string> | undefined)?.CN ||
              "",
            subject: (c.subject as Record<string, string> | undefined)?.CN || "",
            validFrom: c.valid_from,
            validTo: c.valid_to,
            san: (c.subjectaltname || "").split(",").slice(0, 12),
            protocol: sock.getProtocol() || undefined,
            cipher: cipher ? `${cipher.name} (${cipher.version})` : undefined,
            authorized: sock.authorized,
            selfSigned: (() => {
              const x = sock.getPeerX509Certificate?.();
              return Boolean(x && x.issuer === x.subject);
            })(),
            ms: Date.now() - t0,
          });
          sock.end();
        },
      );
      sock.on("error", (e) => done({ host, ms: Date.now() - t0, error: e.message }));
      sock.on("timeout", () => {
        sock.destroy();
        done({ host, ms: Date.now() - t0, error: "timeout" });
      });
    } catch (e) {
      done({ host, ms: Date.now() - t0, error: e instanceof Error ? e.message : "failed" });
    }
  });
}

interface FileFetch {
  kind: "robots" | "security" | "sitemap";
  status: number;
  lines: number;
  excerpt: string;
  ms: number;
  error?: string;
}

async function fetchFile(
  domain: string,
  path: string,
  kind: FileFetch["kind"],
  deadline: number,
): Promise<FileFetch> {
  const t0 = Date.now();
  const budget = Math.min(5_000, Math.max(1_500, deadline - Date.now()));
  for (const scheme of ["https", "http"] as const) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budget);
    try {
      const res = await fetch(`${scheme}://${domain}${path}`, {
        signal: ctl.signal,
        redirect: "follow",
        cache: "no-store",
        headers: { "User-Agent": RECON_UA, Accept: "text/plain,*/*" },
      });
      const text = await readCapped(res, 12_000);
      const lines = text.split("\n").filter((l) => l.trim());
      return {
        kind,
        status: res.status,
        lines: lines.length,
        excerpt: lines.slice(0, 12).join("\n").slice(0, 900),
        ms: Date.now() - t0,
      };
    } catch {
      /* next scheme */
    } finally {
      clearTimeout(timer);
    }
  }
  return { kind, status: 0, lines: 0, excerpt: "", ms: Date.now() - t0, error: "unreachable" };
}

async function probeCors(domain: string, deadline: number) {
  const t0 = Date.now();
  const budget = Math.min(5_000, Math.max(1_500, deadline - Date.now()));
  const probeOrigin = "https://stx-trace-cors-probe.example";
  for (const scheme of ["https", "http"] as const) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budget);
    try {
      const res = await fetch(`${scheme}://${domain}/`, {
        method: "OPTIONS",
        redirect: "manual",
        signal: ctl.signal,
        cache: "no-store",
        headers: {
          Origin: probeOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "content-type",
          "User-Agent": RECON_UA,
        },
      });
      const acao = res.headers.get("access-control-allow-origin");
      const acac = res.headers.get("access-control-allow-credentials");
      const methods = res.headers.get("access-control-allow-methods");
      let risk: string;
      if (!acao) risk = "not configured — same-origin only (default, good)";
      else if (acao === "*" && acac === "true") risk = "CRITICAL — wildcard origin with credentials";
      else if (acao === "*") risk = "wildcard origin — any site can read public responses";
      else if (acao === probeOrigin) risk = "reflects arbitrary origins — verify allow-list";
      else risk = `restricted to ${acao}`;
      return {
        status: res.status,
        acao,
        acac,
        methods,
        risk,
        ms: Date.now() - t0,
      };
    } catch {
      /* next scheme */
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, acao: null, acac: null, methods: null, risk: "unreachable", error: "unreachable", ms: Date.now() - t0 };
}

async function fetchRdap(domain: string, deadline: number) {
  const t0 = Date.now();
  const budget = Math.min(8_000, Math.max(2_000, deadline - Date.now()));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budget);
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: ctl.signal,
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": RECON_UA, Accept: "application/rdap+json, application/json" },
    });
    if (!res.ok) throw new Error(`RDAP HTTP ${res.status}`);
    const j = (await res.json()) as {
      status?: string[];
      handle?: string;
      events?: { eventAction: string; eventDate: string }[];
      nameservers?: { ldhName?: string }[];
      entities?: { roles?: string[]; vcardArray?: unknown }[];
    };
    const ev = (a: string) => j.events?.find((e) => e.eventAction === a)?.eventDate;
    let registrar = "";
    for (const ent of j.entities ?? []) {
      if (!ent.roles?.includes("registrar")) continue;
      const vc = ent.vcardArray as [string, [string, ...string[]][]] | undefined;
      const fn = vc?.[1]?.find((x) => x[0] === "fn");
      if (fn) registrar = String(fn[3] ?? "");
    }
    return {
      registrar,
      created: ev("registration"),
      expires: ev("expiration"),
      changed: ev("last changed"),
      status: (j.status ?? []).slice(0, 6),
      nameservers: (j.nameservers ?? []).map((n) => n.ldhName || "").filter(Boolean).slice(0, 8),
      handle: j.handle,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "failed",
      ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeNet(ip: string | undefined, deadline: number) {
  const t0 = Date.now();
  if (!ip) return { error: "no A record to resolve", ms: Date.now() - t0 };
  const rev = ip.split(".").reverse().join(".");
  const ptr = await dohQuery(`${rev}.in-addr.arpa`, "PTR", 4000);
  let org: string | undefined;
  let country: string | undefined;
  let handle: string | undefined;
  const ctl = new AbortController();
  const timer = setTimeout(
    () => ctl.abort(),
    Math.min(7_000, Math.max(1_500, deadline - Date.now())),
  );
  try {
    const res = await fetch(`https://rdap.org/ip/${ip}`, {
      signal: ctl.signal,
      redirect: "follow",
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as { name?: string; country?: string; handle?: string };
      org = j.name;
      country = j.country;
      handle = j.handle;
    }
  } catch {
    /* rdap optional */
  } finally {
    clearTimeout(timer);
  }
  return {
    ip,
    ptr: ptr.data[0],
    ptrError: ptr.error,
    org,
    country,
    handle,
    ms: Date.now() - t0,
  };
}

async function runDomain(domain: string, send: (o: unknown) => void) {
  const t0 = Date.now();
  const deadline = t0 + DEADLINE_MS;
  send({ type: "meta", domain, startedAt: new Date().toISOString() });

  // Certificate transparency runs in the background while DNS work happens.
  send({ type: "phase", phase: "ct", label: "certificate transparency (crt.sh)" });
  const ctPromise = fetchCt(domain, deadline);

  send({ type: "phase", phase: "dns", label: "DNS over HTTPS" });
  const dnsStart = Date.now();
  const results = await mapPool(DNS_TYPES, 6, (t) => dohQuery(domain, t, 4_500));
  const records: DnsRecord[] = results.map((r, i) => ({
    name: domain,
    type: DNS_TYPES[i],
    data: r.data,
    ms: r.ms,
    error: r.error,
  }));
  const wildcardProbe = await dohQuery(
    `stx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${domain}`,
    "A",
    4_000,
  );
  const wildcard = {
    active: wildcardProbe.data.length > 0 && !wildcardProbe.error,
    ips: wildcardProbe.data,
  };
  send({ type: "dns", records, wildcard, ms: Date.now() - dnsStart });

  const ct = await ctPromise;
  send({ type: "ct", subs: ct.subs, count: ct.subs.length, ms: ct.ms, error: ct.error });

  // DNS brute-force (real DoH lookups against a wordlist)
  send({ type: "phase", phase: "brute", label: `DNS brute-force · ${BRUTE_WORDS.length} names` });
  const bruteStart = Date.now();
  let bruteHits: { sub: string; ips: string[]; wildcard: boolean }[] = [];
  let bruteChecked = 0;
  let bruteError: string | undefined;
  if (Date.now() > deadline - 14_000) {
    bruteError = "skipped — time budget";
  } else {
    const wcSet = new Set(wildcard.ips);
    const outs = await mapPool(BRUTE_WORDS, 20, async (w) => {
      const r = await dohQuery(`${w}.${domain}`, "A", 3_500);
      if (r.error) bruteError = r.error;
      return { w, r };
    });
    bruteChecked = outs.length;
    bruteHits = outs
      .filter((o) => o.r.data.length > 0)
      .map((o) => ({
        sub: `${o.w}.${domain}`,
        ips: o.r.data,
        wildcard: wildcard.active && o.r.data.every((ip) => wcSet.has(ip)),
      }));
  }
  send({
    type: "brute",
    hits: bruteHits,
    checked: bruteChecked,
    wildcard,
    ms: Date.now() - bruteStart,
    error: bruteError,
  });

  // Build host list: apex first, then resolved brute hits, then CT names.
  const seen = new Set<string>([domain]);
  const hosts: string[] = [domain];
  for (const h of bruteHits) {
    if (!seen.has(h.sub)) {
      seen.add(h.sub);
      hosts.push(h.sub);
    }
    if (hosts.length >= HOST_CAP) break;
  }
  for (const s of ct.subs) {
    if (hosts.length >= HOST_CAP) break;
    if (!seen.has(s)) {
      seen.add(s);
      hosts.push(s);
    }
  }

  send({ type: "phase", phase: "probe", label: `HTTP probe · ${hosts.length} hosts` });
  let apexProbe: HostProbe | null = null;
  await mapPool(hosts, 6, async (host) => {
    const p = await probeHost(host, deadline);
    if (host === domain) apexProbe = p;
    send({ type: "host", probe: p });
  });

  send({ type: "phase", phase: "tls", label: "TLS certificates" });
  const tlsHosts = [domain, ...hosts.slice(1, 7)].filter(
    (h, i, a) => a.indexOf(h) === i,
  );
  await mapPool(tlsHosts, 4, async (h) => {
    const info = await probeTls(h, deadline);
    send({ type: "tls", info });
  });

  send({ type: "phase", phase: "files", label: "robots · security.txt · sitemap" });
  const aRecord = records.find((r) => r.type === "A")?.data?.[0];
  const [files, cors, rdap, net] = await Promise.all([
    Promise.all([
      fetchFile(domain, "/robots.txt", "robots", deadline),
      fetchFile(domain, "/.well-known/security.txt", "security", deadline),
      fetchFile(domain, "/sitemap.xml", "sitemap", deadline),
    ]),
    probeCors(domain, deadline),
    fetchRdap(domain, deadline),
    probeNet(aRecord, deadline),
  ]);
  for (const f of files) send({ type: "file", ...f });
  send({ type: "cors", ...cors });
  send({ type: "rdap", ...rdap });
  send({ type: "net", ...net });

  send({ type: "phase", phase: "audit", label: "security header audit" });
  let grade: string | undefined;
  const probe = apexProbe as HostProbe | null;
  if (probe && !probe.error) {
    const result = auditFromHeaders(probe.url, probe.headers, probe.cookies);
    grade = result.grade;
    send({ type: "audit", result });
  } else {
    send({ type: "audit", skipped: true });
  }

  send({
    type: "done",
    ms: Date.now() - t0,
    hosts: hosts.length,
    subs: new Set([...bruteHits.map((b) => b.sub), ...ct.subs]).size,
    grade,
    note: Date.now() > deadline - 2_000 ? "completed within time budget" : undefined,
  });
}

function parseDomain(req: Request): string | null {
  let raw = "";
  const url = new URL(req.url);
  if (req.method === "GET") {
    raw = url.searchParams.get("domain") || "";
  }
  return normalizeTarget(raw);
}

async function readBodyDomain(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { domain?: unknown };
    return normalizeTarget(String(body?.domain ?? ""));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (RATE(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }
  const domain = await readBodyDomain(req);
  if (!domain) {
    return Response.json(
      { error: "Enter a valid domain, e.g. example.com (no path, no IP)." },
      { status: 400 },
    );
  }
  return ndjsonResponse((send) => runDomain(domain, send));
}

export async function GET(req: Request) {
  const ip = clientIp(req);
  if (RATE(ip)) {
    return Response.json(
      { error: "Rate limit exceeded — wait a minute and try again." },
      { status: 429 },
    );
  }
  const domain = parseDomain(req);
  if (!domain) {
    return Response.json(
      { error: "Enter a valid domain, e.g. example.com (no path, no IP)." },
      { status: 400 },
    );
  }
  return ndjsonResponse((send) => runDomain(domain, send));
}
