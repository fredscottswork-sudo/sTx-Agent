// Isomorphic recon helpers — shared by the Recon panel (client) and /api/recon/* routes (server).
// Everything here either defines real network queries or pure analysis over their real results.

export interface DnsRecord {
  name: string;
  type: string;
  data: string[];
  ms: number;
  error?: string;
}

export interface HostProbe {
  host: string;
  url: string;
  status: number;
  statusText: string;
  title?: string;
  server?: string;
  poweredBy?: string;
  redirect?: string;
  tech: string[];
  cookies: string[];
  size?: number;
  contentType?: string;
  ms: number;
  error?: string;
  headers: Record<string, string>;
}

export interface TlsInfo {
  host: string;
  issuer?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
  san?: string[];
  protocol?: string;
  cipher?: string;
  authorized?: boolean;
  selfSigned?: boolean;
  ms: number;
  error?: string;
}

export interface AuditCheck {
  id: string;
  label: string;
  state: "pass" | "warn" | "fail" | "info";
  detail: string;
}

export interface AuditResult {
  url: string;
  score: number;
  grade: string;
  checks: AuditCheck[];
}

export interface DorkRow {
  label: string;
  query: string;
}

export interface DorkCat {
  id: string;
  label: string;
  rows: DorkRow[];
}

export interface PortResult {
  port: number;
  open: boolean;
  service: string;
  banner?: string;
  reason?: string;
  ms: number;
}

export interface PathHit {
  path: string;
  status: number;
  contentType?: string;
  size?: number;
  redirect?: string;
  ms: number;
}

export interface WaybackRow {
  url: string;
  ts: string;
  status: string;
  mime: string;
  tags: string[];
}

/* ─────────────────────────── constants ─────────────────────────── */

export const RECON_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const COMMON_PORTS: number[] = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995, 1433, 1521, 2049,
  3000, 3306, 3389, 5000, 5432, 5900, 6379, 8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090, 9200,
  11211, 27017,
];

export const SERVICE_NAMES: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3",
  111: "RPCBind", 135: "MSRPC", 139: "NetBIOS", 143: "IMAP", 443: "HTTPS", 445: "SMB",
  465: "SMTPS", 587: "Submission", 993: "IMAPS", 995: "POP3S", 1433: "MSSQL", 1521: "Oracle",
  2049: "NFS", 3000: "Dev server", 3306: "MySQL", 3389: "RDP", 5000: "HTTP-alt",
  5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 8000: "HTTP-alt", 8008: "HTTP-alt",
  8080: "HTTP-proxy", 8081: "HTTP-alt", 8443: "HTTPS-alt", 8888: "HTTP-alt", 9000: "HTTP-alt",
  9090: "Console", 9200: "Elasticsearch", 11211: "Memcached", 27017: "MongoDB",
};

/** Subdomain wordlist for DNS brute-force over DoH (~160 names). */
export const BRUTE_WORDS: string[] = [
  "www", "mail", "webmail", "smtp", "pop", "pop3", "imap", "ftp", "sftp", "vpn", "remote", "gw",
  "gateway", "dev", "dev2", "devel", "staging", "stage", "test", "testing", "qa", "uat", "sandbox",
  "demo", "beta", "alpha", "api", "api2", "apis", "app", "apps", "admin", "administrator",
  "portal", "dashboard", "panel", "console", "cdn", "static", "assets", "img", "images", "media",
  "files", "download", "downloads", "upload", "blog", "shop", "store", "cart", "checkout",
  "payment", "pay", "billing", "account", "accounts", "auth", "sso", "login", "id", "mfa", "ldap",
  "ad", "intranet", "extranet", "git", "gitlab", "github", "ci", "cd", "jenkins", "jira",
  "confluence", "wiki", "docs", "status", "monitor", "monitoring", "grafana", "kibana", "elastic",
  "db", "database", "mysql", "sql", "postgres", "mongo", "redis", "cache", "ns", "ns1", "ns2",
  "dns", "mx", "backup", "bak", "old", "new", "internal", "private", "public", "cloud", "aws",
  "azure", "gcp", "s3", "storage", "crm", "erp", "hr", "jobs", "career", "news", "press", "forum",
  "community", "support", "help", "helpdesk", "ticket", "m", "mobile", "amp", "ws", "webdisk",
  "cpanel", "whm", "webmail2", "mail2", "mx1", "mx2", "autodiscover", "autoconfig", "lyncdiscover",
  "sip", "meet", "zoom", "go", "links", "short", "track", "analytics", "stats", "report",
  "reports", "billing2", "secure", "secured", "safe", "shop2", "cdn2", "edge", "node1", "node2",
  "server", "srv", "host", "vps", "mailgate", "antivirus", "spam", "filter", "relay", "ns3",
  "www2", "www3", "site", "home", "in", "info", "my", "client", "clients", "partner", "partners",
  "vendor", "vendors", "stage2", "canary", "next", "edge2", "vpn2", "remote2", "citrix", "owa",
  "exchange", "sharepoint", "sap", "jira2", "bug", "bugs", "chat", "slack", "community2",
];

/** Content-discovery wordlist for the URL finder (~110 paths). */
export const PATH_WORDLIST: string[] = [
  ".env", ".env.local", ".env.backup", ".env.production", ".env.staging", ".git", ".git/config",
  ".git/HEAD", ".svn/entries", ".DS_Store", ".htaccess", ".htpasswd", "web.config", ".npmrc",
  ".netrc", ".dockerenv", "Dockerfile", "docker-compose.yml", "id_rsa", ".aws/credentials",
  "wp-config.php.bak", "config.php.bak", "configuration.php.bak", "settings.py", "composer.json",
  "package.json", "backup.zip", "backup.tar.gz", "backup.sql", "dump.sql", "database.sql",
  "site.zip", "www.zip", "db.sql", "data.sql", ".well-known/security.txt", "security.txt",
  "robots.txt", "sitemap.xml", "sitemap_index.xml", "crossdomain.xml", "clientaccesspolicy.xml",
  "phpinfo.php", "info.php", "test.php", "debug.php", "i.php", "error.log", "debug.log",
  "access.log", "app.log", "laravel.log", "php_errors.log", "admin", "admin/", "administrator",
  "administrator/", "admin/login", "login", "login/", "wp-admin", "wp-admin/", "wp-login.php",
  "wp-content/debug.log", "wp-includes/", "user", "users", "account", "accounts", "dashboard",
  "panel", "manager", "console", "backend", "control", "cpanel", "phpmyadmin", "adminer.php",
  "adminer", "myadmin", "server-status", "server-info", "server-status?auto", "elmah.axd",
  "trace.axd", "jmx-console", "manager/html", "solr/admin", "actuator", "actuator/health",
  "actuator/env", "actuator/metrics", "metrics", "health", "status", "info", "debug", "graphql",
  "graphql/console", "graphiql", "swagger", "swagger.json", "swagger-ui.html", "openapi.json",
  "api", "api/", "api/v1", "api/v2", "v1", "v2", "rest", "docs", "redoc", "rpc", "jsonrpc",
  "elmah", "trace", "console/login", "debugger", "phpinfo", "test", "dev", "staging", "old",
  "backup", "bak", "tmp", "temp", "upload", "uploads", "files", "private", "secret", "secrets",
];

/* ─────────────────────────── helpers ─────────────────────────── */

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeTarget(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, ""); // strip scheme
  s = s.split("/")[0];
  s = s.split("?")[0];
  s = s.split("#")[0];
  s = s.split(":")[0]; // strip port
  s = s.replace(/\.$/, "");
  if (!s || s.length > 253 || !DOMAIN_RE.test(s)) return null;
  return s;
}

export function apexOf(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const DOH_URLS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

/** DNS-over-HTTPS query (works from browser and server). */
export async function dohQuery(
  name: string,
  type: string,
  timeoutMs = 5000,
): Promise<{ data: string[]; ms: number; error?: string }> {
  const t0 = Date.now();
  const TYPE: Record<string, number> = {
    A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2, TXT: 16, SOA: 6, CAA: 257, SRV: 33, PTR: 12,
    DS: 43, DNSKEY: 48,
  };
  const want = TYPE[type.toUpperCase()];
  if (!want) return { data: [], ms: 0, error: `unsupported type ${type}` };
  let lastErr = "";
  for (const base of DOH_URLS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const url = `${base}?name=${encodeURIComponent(name)}&type=${type}`;
      const headers: Record<string, string> =
        base.includes("cloudflare") ? { accept: "application/dns-json" } : {};
      const res = await fetch(url, { headers, signal: ctl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { Answer?: { type: number; data: string }[]; Status?: number };
      const data = (j.Answer ?? [])
        .filter((a) => a.type === want)
        .map((a) => (type.toUpperCase() === "TXT" ? a.data.replace(/"/g, "") : a.data));
      return { data, ms: Date.now() - t0 };
    } catch (e) {
      lastErr = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "failed";
    } finally {
      clearTimeout(timer);
    }
  }
  return { data: [], ms: Date.now() - t0, error: lastErr || "DoH failed" };
}

export function createRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();
  return (ip: string): boolean => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(ip, arr);
      return true;
    }
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return false;
  };
}

export function ndjsonResponse(
  run: (send: (obj: unknown) => void) => Promise<void>,
): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };
      try {
        await run(send);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "scan failed" });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
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

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
}

/* ─────────────────────── tech detection ─────────────────────── */

interface TechRule {
  test: string;
  name: string;
}

const HEADER_RULES: TechRule[] = [
  { test: "cf-ray", name: "Cloudflare" },
  { test: "server:cloudflare", name: "Cloudflare" },
  { test: "x-sucuri-", name: "Sucuri WAF" },
  { test: "x-amz-cf-", name: "CloudFront" },
  { test: "x-vercel-id", name: "Vercel" },
  { test: "x-goog-", name: "Google Cloud" },
  { test: "x-azure-", name: "Azure" },
  { test: "x-cache", name: "CDN cache" },
  { test: "server:nginx", name: "nginx" },
  { test: "server:apache", name: "Apache" },
  { test: "server:microsoft-iis", name: "IIS" },
  { test: "server:litespeed", name: "LiteSpeed" },
  { test: "server:openresty", name: "OpenResty" },
  { test: "server:caddy", name: "Caddy" },
  { test: "server:gws", name: "Google Frontend" },
  { test: "x-powered-by:express", name: "Express" },
  { test: "x-powered-by:php", name: "PHP" },
  { test: "x-powered-by:asp.net", name: "ASP.NET" },
  { test: "x-powered-by:next.js", name: "Next.js" },
  { test: "x-aspnet-version", name: "ASP.NET" },
  { test: "x-generator:", name: "CMS (x-generator)" },
  { test: "alt-svc:h3", name: "HTTP/3" },
  { test: "report-to:", name: "Reporting API" },
  { test: "nel:", name: "Network Error Logging" },
];

const COOKIE_RULES: TechRule[] = [
  { test: "phpsessid", name: "PHP" },
  { test: "jsessionid", name: "Java" },
  { test: "asp.net_sessionid", name: "ASP.NET" },
  { test: "aspsessionid", name: "ASP" },
  { test: "laravel_session", name: "Laravel" },
  { test: "connect.sid", name: "Express" },
  { test: "xsrf-token", name: "XSRF token" },
  { test: "wp-settings-", name: "WordPress" },
  { test: "wordpress_logged_in", name: "WordPress" },
  { test: "ssegs", name: "Drupal" },
  { test: "selenium", name: "Selenium" },
  { test: "_shopify", name: "Shopify" },
  { test: "__cfduid", name: "Cloudflare" },
  { test: "awsalb", name: "AWS ELB" },
  { test: "play_session", name: "Play Framework" },
  { test: "rack.session", name: "Rack" },
  { test: "_rails_session", name: "Ruby on Rails" },
];

const HTML_RULES: TechRule[] = [
  { test: "wp-content", name: "WordPress" },
  { test: "wp-includes", name: "WordPress" },
  { test: "/_next/static", name: "Next.js" },
  { test: "__nuxt", name: "Nuxt" },
  { test: "ng-version", name: "Angular" },
  { test: "data-reactroot", name: "React" },
  { test: "react-root", name: "React" },
  { test: "id=\"root\" data-reactroot", name: "React" },
  { test: "window.__vue__", name: "Vue" },
  { test: "data-v-app", name: "Vue" },
  { test: "cdn.shopify.com", name: "Shopify" },
  { test: "static.wixstatic.com", name: "Wix" },
  { test: "squarespace.com", name: "Squarespace" },
  { test: "ghost-", name: "Ghost" },
  { test: "drupal.js", name: "Drupal" },
  { test: "/media/jomres", name: "Joomla" },
  { test: "joomla!", name: "Joomla" },
  { test: "generator\" content=\"wordpress", name: "WordPress" },
  { test: "generator\" content=\"drupal", name: "Drupal" },
  { test: "generator\" content=\"joomla", name: "Joomla" },
  { test: "generator\" content=\"hugo", name: "Hugo" },
  { test: "generator\" content=\"gatsby", name: "Gatsby" },
  { test: "generator\" content=\"hexo", name: "Hexo" },
  { test: "cdn.tailwindcss.com", name: "Tailwind CSS" },
  { test: "bootstrap.min.css", name: "Bootstrap" },
  { test: "jquery.min.js", name: "jQuery" },
  { test: "google-analytics.com/analytics.js", name: "Google Analytics" },
  { test: "gtag/js", name: "Google Tag" },
  { test: "googletagmanager.com", name: "Google Tag Manager" },
  { test: "static.hotjar.com", name: "Hotjar" },
  { test: "cdn.segment.com", name: "Segment" },
  { test: "js.stripe.com", name: "Stripe" },
  { test: "paypal.com/sdk", name: "PayPal" },
  { test: "recaptcha", name: "reCAPTCHA" },
  { test: "hcaptcha.com", name: "hCaptcha" },
  { test: "turnstile.js", name: "Cloudflare Turnstile" },
  { test: "fonts.googleapis.com", name: "Google Fonts" },
  { test: "typekit.net", name: "Adobe Typekit" },
  { test: "intercom.io", name: "Intercom" },
  { test: "zendesk", name: "Zendesk" },
  { test: "hubspot", name: "HubSpot" },
  { test: "crisp.chat", name: "Crisp" },
  { test: "tidio.co", name: "Tidio" },
];

export function detectTech(
  headers: Record<string, string>,
  html: string,
  setCookies: string[],
): string[] {
  const found = new Set<string>();
  const hEntries = Object.entries(headers).map(([k, v]) => `${k}:${v}`.toLowerCase());
  const hBlob = hEntries.join("\n");
  for (const r of HEADER_RULES) if (hBlob.includes(r.test)) found.add(r.name);
  const cBlob = setCookies.join("\n").toLowerCase();
  for (const r of COOKIE_RULES) if (cBlob.includes(r.test)) found.add(r.name);
  const doc = html.slice(0, 80_000).toLowerCase();
  for (const r of HTML_RULES) if (doc.includes(r.test)) found.add(r.name);
  const gen = doc.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,60})/);
  if (gen) found.add(gen[1].trim());
  const powered = headers["x-powered-by"];
  if (powered && !hEntries.some((e) => e.startsWith("x-powered-by:"))) found.add(powered);
  return [...found].slice(0, 14);
}

export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 160) : undefined;
}

/* ─────────────────────── security audit ─────────────────────── */

export function auditFromHeaders(
  finalUrl: string,
  headers: Record<string, string>,
  setCookies: string[],
): AuditResult {
  const h = (k: string) => (headers[k.toLowerCase()] || "").trim();
  const checks: AuditCheck[] = [];
  let score = 100;
  const add = (c: AuditCheck, passW = 0, warnW = 0, failW = 0) => {
    checks.push(c);
    if (c.state === "pass") score -= passW;
    else if (c.state === "warn") score -= warnW;
    else if (c.state === "fail") score -= failW;
  };

  const isHttps = finalUrl.startsWith("https://");
  add(
    isHttps
      ? { id: "https", label: "HTTPS enforced", state: "pass", detail: "final URL is https" }
      : { id: "https", label: "HTTPS enforced", state: "fail", detail: "served over plain HTTP" },
    0, 0, 20,
  );

  const hsts = h("strict-transport-security");
  if (!isHttps) {
    add({ id: "hsts", label: "HSTS", state: "info", detail: "n/a without HTTPS" }, 0, 0, 0);
  } else if (!hsts) {
    add({ id: "hsts", label: "HSTS", state: "fail", detail: "header missing" }, 0, 0, 15);
  } else {
    const ma = Number((hsts.match(/max-age=(\d+)/) || [])[1] || 0);
    const sub = /includesubdomains/i.test(hsts);
    const pre = /preload/i.test(hsts);
    if (ma >= 15552000 && sub) {
      add({
        id: "hsts", label: "HSTS", state: "pass",
        detail: `max-age=${ma}${sub ? "; includeSubDomains" : ""}${pre ? "; preload" : ""}`,
      }, 0, 0, 0);
    } else if (ma >= 300000) {
      add({
        id: "hsts", label: "HSTS", state: "warn",
        detail: `short max-age=${ma}${sub ? "" : " (no includeSubDomains)"}`,
      }, 0, 7, 0);
    } else {
      add({ id: "hsts", label: "HSTS", state: "fail", detail: `weak max-age=${ma}` }, 0, 0, 15);
    }
  }

  const csp = h("content-security-policy");
  if (!csp) {
    add({ id: "csp", label: "Content-Security-Policy", state: "fail", detail: "header missing" }, 0, 0, 15);
  } else if (/unsafe-eval/i.test(csp)) {
    add({ id: "csp", label: "Content-Security-Policy", state: "fail", detail: "contains 'unsafe-eval'" }, 0, 0, 15);
  } else if (/unsafe-inline/i.test(csp)) {
    add({ id: "csp", label: "Content-Security-Policy", state: "warn", detail: "contains 'unsafe-inline'" }, 0, 8, 0);
  } else {
    add({ id: "csp", label: "Content-Security-Policy", state: "pass", detail: `${csp.split(";").length} directives` }, 0, 0, 0);
  }

  const nosniff = h("x-content-type-options").toLowerCase();
  add(
    nosniff === "nosniff"
      ? { id: "nosniff", label: "X-Content-Type-Options", state: "pass", detail: "nosniff" }
      : { id: "nosniff", label: "X-Content-Type-Options", state: "fail", detail: "missing" },
    0, 0, 10,
  );

  const xfo = h("x-frame-options");
  const frameAncestors = /frame-ancestors/i.test(csp);
  add(
    xfo || frameAncestors
      ? {
          id: "frame", label: "Frame protection",
          state: "pass",
          detail: xfo ? `X-Frame-Options: ${xfo}` : "CSP frame-ancestors",
        }
      : { id: "frame", label: "Frame protection", state: "fail", detail: "clickjacking protection missing" },
    0, 0, 10,
  );

  const ref = h("referrer-policy");
  add(
    ref
      ? { id: "ref", label: "Referrer-Policy", state: "pass", detail: ref }
      : { id: "ref", label: "Referrer-Policy", state: "warn", detail: "header missing" },
    0, 5, 0,
  );

  const perm = h("permissions-policy") || h("feature-policy");
  add(
    perm
      ? { id: "perm", label: "Permissions-Policy", state: "pass", detail: `${perm.split(",").length} directives` }
      : { id: "perm", label: "Permissions-Policy", state: "warn", detail: "header missing" },
    0, 5, 0,
  );

  if (setCookies.length === 0) {
    add({ id: "cookies", label: "Cookie flags", state: "info", detail: "no cookies set" }, 0, 0, 0);
  } else {
    const missingSecure = setCookies.filter((c) => !/;\s*secure/i.test(c)).length;
    const missingHttp = setCookies.filter((c) => !/;\s*httponly/i.test(c)).length;
    const missingSame = setCookies.filter((c) => !/;\s*samesite/i.test(c)).length;
    const detail = `${setCookies.length} cookie(s): ${missingSecure} w/o Secure, ${missingHttp} w/o HttpOnly, ${missingSame} w/o SameSite`;
    if (missingSecure > 0 && isHttps) {
      add({ id: "cookies", label: "Cookie flags", state: "fail", detail }, 0, 0, 10);
    } else if (missingHttp > 0 || missingSame > 0 || missingSecure > 0) {
      add({ id: "cookies", label: "Cookie flags", state: "warn", detail }, 0, 5, 0);
    } else {
      add({ id: "cookies", label: "Cookie flags", state: "pass", detail }, 0, 0, 0);
    }
  }

  const srv = h("server");
  add(
    !srv
      ? { id: "server", label: "Server disclosure", state: "pass", detail: "Server header not sent" }
      : /\d/.test(srv)
        ? { id: "server", label: "Server disclosure", state: "warn", detail: `version disclosed: ${srv}` }
        : { id: "server", label: "Server disclosure", state: "pass", detail: `server: ${srv}` },
    0, 5, 0,
  );

  const xp = h("x-powered-by");
  add(
    xp
      ? { id: "powered", label: "X-Powered-By", state: "warn", detail: `discloses: ${xp}` }
      : { id: "powered", label: "X-Powered-By", state: "pass", detail: "not sent" },
    0, 5, 0,
  );

  const coop = h("cross-origin-opener-policy");
  add(
    coop
      ? { id: "coop", label: "Cross-Origin-Opener-Policy", state: "pass", detail: coop }
      : { id: "coop", label: "Cross-Origin-Opener-Policy", state: "warn", detail: "header missing" },
    0, 3, 0,
  );

  score = Math.max(0, Math.min(100, score));
  return { url: finalUrl, score, grade: gradeFrom(score), checks };
}

export function gradeFrom(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

/* ─────────────────────── Google hacking dorks ─────────────────────── */

export function googleUrl(q: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
export function bingUrl(q: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
}
export function ddgUrl(q: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}
export function githubSearchUrl(q: string): string {
  return `https://github.com/search?q=${encodeURIComponent(q)}&type=code`;
}

export function hackingDorks(target: string): DorkCat[] {
  const t = target.trim();
  const s = (q: string) => ({ label: q, query: q });
  const st = (q: string) => ({ label: q.replace(`site:${t} `, ""), query: `site:${t} ${q.replace(`site:${t} `, "")}` });
  return [
    {
      id: "files",
      label: "Exposed files",
      rows: ["ext:env", "ext:sql", "ext:bak", "ext:log", "ext:yml", "ext:yaml", "ext:cfg", "ext:ini", "ext:conf", "ext:pem", "ext:key", "ext:old", "ext:save", "ext:swp", "ext:zip", "ext:tar.gz"]
        .map((x) => s(`site:${t} ${x}`)),
    },
    {
      id: "secrets",
      label: "Secrets & configs",
      rows: [
        s(`"DB_PASSWORD" site:${t}`),
        s(`"AWS_SECRET_ACCESS_KEY" site:${t}`),
        s(`"BEGIN PRIVATE KEY" site:${t}`),
        s(`site:${t} inurl:.git`),
        s(`site:${t} inurl:config password`),
        s(`site:${t} intext:"api_key"`),
        s(`site:${t} intext:"client_secret"`),
        s(`site:${t} inurl:.env`),
      ],
    },
    {
      id: "admin",
      label: "Admin & login panels",
      rows: [
        st("inurl:admin"),
        st("inurl:login"),
        st("inurl:dashboard"),
        st("inurl:phpmyadmin"),
        st("inurl:wp-admin"),
        st("inurl:manager"),
        st(`intitle:"admin login"`),
        st("inurl:portal/login"),
      ],
    },
    {
      id: "dirs",
      label: "Open directories",
      rows: [
        st(`intitle:"index of"`),
        st(`intitle:"index of" "parent directory"`),
        st("inurl:backup"),
        st("inurl:snapshot"),
        st("inurl:dump"),
      ],
    },
    {
      id: "errors",
      label: "Errors & debug output",
      rows: [
        st(`intext:"syntax error"`),
        st(`"SQL syntax" `),
        st(`intext:"stack trace"`),
        st(`intext:"Fatal error"`),
        st(`inurl:trace`),
        st(`inurl:debug`),
        st(`"Warning: mysql_query"`),
      ],
    },
    {
      id: "surface",
      label: "Subdomains & environments",
      rows: [
        s(`site:*.${t} -www`),
        st("inurl:staging"),
        st("inurl:dev."),
        st("inurl:test."),
        st("inurl:internal"),
        st("inurl:vpn"),
      ],
    },
    {
      id: "docs",
      label: "Documents",
      rows: ["pdf", "docx", "xlsx", "csv", "pptx", "txt"].map((x) => s(`site:${t} filetype:${x}`)),
    },
    {
      id: "people",
      label: "Emails & people",
      rows: [
        st(`intext:"@${t}"`),
        st("inurl:author"),
        st("filetype:vcf"),
        st("filetype:csv email"),
        s(`"@"${t} password`),
      ],
    },
    {
      id: "leaks",
      label: "Code & paste leaks",
      rows: [
        s(`site:github.com "${t}"`),
        s(`site:gitlab.com "${t}"`),
        s(`site:pastebin.com "${t}"`),
        s(`site:bitbucket.org "${t}"`),
        s(`site:gist.github.com "${t}"`),
        s(`"${t}" filetype:sql`),
      ],
    },
    {
      id: "cms",
      label: "CMS & API endpoints",
      rows: [
        st("inurl:/wp-json/wp/v2/users"),
        st("inurl:/wp-content/uploads"),
        st("inurl:graphql"),
        st("inurl:actuator"),
        st("inurl:server-status"),
        st("inurl:api/docs"),
        st("inurl:.well-known/openid-configuration"),
      ],
    },
    {
      id: "cloud",
      label: "Cloud storage",
      rows: [
        s(`site:s3.amazonaws.com "${t}"`),
        s(`site:*.s3.amazonaws.com "${t}"`),
        s(`site:storage.googleapis.com "${t}"`),
        s(`site:blob.core.windows.net "${t}"`),
        s(`site:drive.google.com "${t}"`),
      ],
    },
  ];
}

/* ─────────────────────── people hunter ─────────────────────── */

export function emailPatterns(first: string, last: string, domain: string): string[] {
  const f = first.toLowerCase().replace(/[^a-z0-9]/g, "");
  const l = last.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!f || !l) return [];
  const fl = f[0];
  const raw = [
    `${f}@${domain}`,
    `${l}@${domain}`,
    `${f}.${l}@${domain}`,
    `${f}${l[0]}@${domain}`,
    `${fl}.${l}@${domain}`,
    `${f}_${l}@${domain}`,
    `${l}.${f}@${domain}`,
    `${fl}${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${f}${l.length > 1 ? l.slice(0, 2) : l}@${domain}`,
  ];
  return [...new Set(raw)];
}

/* ─────────────────────── wayback classification ─────────────────────── */

const SENSITIVE_EXT_RE =
  /\.(env|bak|sql|log|yml|yaml|toml|ini|cfg|conf|key|pem|p12|pfx|zip|tar|gz|tgz|swp|old|orig|save|tmp|db|sqlite3?|csv)(\?|#|$)/i;
const SENSITIVE_PATH_RE =
  /\/(admin|administrator|backup|config|console|debug|dashboard|phpinfo|phpmyadmin|manager|metrics|panel|private|server-status|setup|shell|snapshot|trace|upload|wp-admin|wp-content\/debug|\.git|\.env|\.aws|actuator|elmah|trace\.axd)/i;
const SENSITIVE_PARAM_RE =
  /[?&](password|passwd|pwd|secret|token|api_key|apikey|auth|session|sid|redirect|url|file|path|cmd|eval|query|email|ssn|card|cvv|key)=/i;
const LOG_RE = /\/(access|error|debug|app|laravel|php|request)\.log(\?|#|$)/i;

export function classifyUrlTags(url: string): string[] {
  const tags: string[] = [];
  if (SENSITIVE_EXT_RE.test(url)) tags.push("sensitive-ext");
  if (LOG_RE.test(url)) tags.push("log-file");
  if (SENSITIVE_PATH_RE.test(url)) tags.push("sensitive-path");
  if (SENSITIVE_PARAM_RE.test(url)) tags.push("sensitive-param");
  if (/\/\.git\//i.test(url)) tags.push("git");
  return tags;
}
