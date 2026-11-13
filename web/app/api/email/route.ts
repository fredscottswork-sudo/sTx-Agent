import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import type { EmailDnsReport, EmailReport, GravatarAccount, RdapReport } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA = "STX-Trace/1.0 (OSINT workbench; public-data lookups)";

const PROVIDERS: Record<string, string> = {
  "gmail.com": "Google Gmail",
  "googlemail.com": "Google Gmail",
  "yahoo.com": "Yahoo Mail",
  "yahoo.co.uk": "Yahoo Mail UK",
  "yahoo.co.in": "Yahoo Mail India",
  "ymail.com": "Yahoo Mail",
  "outlook.com": "Microsoft Outlook",
  "hotmail.com": "Microsoft Hotmail",
  "hotmail.co.uk": "Microsoft Hotmail UK",
  "live.com": "Microsoft Live",
  "msn.com": "Microsoft MSN",
  "icloud.com": "Apple iCloud",
  "me.com": "Apple iCloud",
  "mac.com": "Apple iCloud",
  "proton.me": "Proton Mail",
  "protonmail.com": "Proton Mail",
  "pm.me": "Proton Mail",
  "gmx.com": "GMX",
  "gmx.net": "GMX",
  "gmx.de": "GMX",
  "mail.com": "Mail.com",
  "aol.com": "AOL Mail",
  "zoho.com": "Zoho Mail",
  "zohomail.com": "Zoho Mail",
  "yandex.com": "Yandex Mail",
  "yandex.ru": "Yandex Mail",
  "mail.ru": "Mail.ru",
  "rambler.ru": "Rambler",
  "qq.com": "Tencent QQ",
  "163.com": "NetEase 163",
  "126.com": "NetEase 126",
  "yeah.net": "NetEase Yeah",
  "tutanota.com": "Tutanota",
  "tuta.io": "Tutanota",
  "tutamail.com": "Tutanota",
  "fastmail.com": "Fastmail",
  "fastmail.fm": "Fastmail",
  "hey.com": "HEY",
  "cock.li": "cock.li",
  "hushmail.com": "Hushmail",
  "inbox.com": "Inbox.com",
  "inbox.lv": "Inbox.lv",
  "seznam.cz": "Seznam",
  "laposte.net": "La Poste",
  "orange.fr": "Orange",
  "free.fr": "Free",
  "web.de": "Web.de",
  "t-online.de": "T-Online",
  "naver.com": "Naver",
  "daum.net": "Daum",
  "hanmail.net": "Hanmail",
  "terra.com.br": "Terra",
  "uol.com.br": "UOL",
  "bol.com.br": "BOL",
};

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.info",
  "10minutemail.com", "tempmail.com", "temp-mail.org", "temp-mail.io", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
  "throwawaymail.com", "fakeinbox.com", "maildrop.cc", "tempr.email", "moakt.cc",
  "linshiyouxiang.net", "emailondeck.com", "33mail.com", "mytemp.email",
  "dropmail.me", "tmail.ws", "burnermail.io", "harakirimail.com", "spamgourmet.com",
  "mailsac.com", "guerrillamailblock.com", "pokemail.net", "byom.de", "tmailinator.com",
  "mintemail.com", "spam4.me", "crazymailing.com", "emailias.com", "getairmail.com",
]);

const DKIM_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "s1", "s2", "mail", "mx", "dkim", "smtp", "cm"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

async function fetchJson<T>(url: string, timeoutMs = 8000, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function lookupDns(domain: string): Promise<EmailDnsReport> {
  const [ns, a, txt, dmarc, bimi] = await Promise.all([
    settle(dns.resolveNs(domain)),
    settle(dns.resolve4(domain)),
    settle(dns.resolveTxt(domain)),
    settle(dns.resolveTxt(`_dmarc.${domain}`)),
    settle(dns.resolveTxt(`default._bimi.${domain}`)),
  ]);

  const spf = (txt ?? [])
    .map((t) => t.join(""))
    .find((t) => t.toLowerCase().startsWith("v=spf1")) ?? null;

  const dmarcStr = (dmarc ?? []).map((t) => t.join("")).find((t) => t.toLowerCase().startsWith("v=dmarc1")) ?? null;
  const policyMatch = dmarcStr?.match(/\bp=(none|quarantine|reject)\b/i);

  const dkimRaw = await Promise.all(
    DKIM_SELECTORS.map(async (selector) => {
      const recs = await settle(dns.resolveTxt(`${selector}._domainkey.${domain}`));
      return { selector, present: Boolean(recs && recs.length > 0) };
    }),
  );

  return {
    ns: (ns ?? []).map((n) => n.replace(/\.$/, "")),
    a: a ?? [],
    spf,
    dmarc: dmarcStr,
    dmarcPolicy: policyMatch ? policyMatch[1].toLowerCase() : null,
    bimi: Boolean(bimi && bimi.length > 0),
    dkim: dkimRaw.filter((d) => d.present),
  };
}

function vcardName(entity: unknown): string | null {
  const e = entity as { vcardArray?: unknown } | null;
  const vc = e?.vcardArray;
  if (!Array.isArray(vc) || vc[0] !== "vcard" || !Array.isArray(vc[1])) return null;
  let org: string | null = null;
  for (const f of vc[1] as unknown[]) {
    if (!Array.isArray(f)) continue;
    if (f[0] === "fn" && typeof f[3] === "string" && f[3]) return f[3];
    if (f[0] === "org" && Array.isArray(f[3])) org = (f[3] as unknown[]).filter(Boolean).join(" ");
  }
  return org;
}

async function lookupRdap(domain: string): Promise<RdapReport | null> {
  const res = await fetchJson<Record<string, unknown>>(`https://rdap.org/domain/${encodeURIComponent(domain)}`, 9000);
  if (!res.ok || !res.data) return null;
  const d = res.data;
  const events = Array.isArray(d.events) ? (d.events as { eventAction?: string; eventDate?: string }[]) : [];
  const findEvent = (action: string) => events.find((e) => e.eventAction === action)?.eventDate ?? null;
  const entities = Array.isArray(d.entities) ? (d.entities as Record<string, unknown>[]) : [];
  let registrar: string | null = null;
  let registrantOrg: string | null = null;
  for (const ent of entities) {
    const roles = Array.isArray(ent.roles) ? (ent.roles as string[]) : [];
    if (roles.includes("registrar") && !registrar) registrar = vcardName(ent);
    if (roles.includes("registrant") && !registrantOrg) registrantOrg = vcardName(ent);
    // RDAP often nests the registrant under the registrar
    if (roles.includes("registrar") && !registrantOrg && Array.isArray(ent.entities)) {
      for (const sub of ent.entities as Record<string, unknown>[]) {
        const subRoles = Array.isArray(sub.roles) ? (sub.roles as string[]) : [];
        if (subRoles.includes("registrant")) registrantOrg = vcardName(sub) ?? registrantOrg;
      }
    }
  }
  return {
    registrar,
    registrantOrg,
    created: findEvent("registration"),
    expires: findEvent("expiration"),
    status: Array.isArray(d.status) ? (d.status as string[]).slice(0, 8) : [],
    raw: true,
  };
}

function buildFormats(local: string, domain: string): { formats: string[]; derived: boolean } {
  const parts = local.split(/[._\-+0-9]+/).filter((p) => p.length > 1);
  const out = new Set<string>();
  let first = "";
  let last = "";
  if (parts.length >= 2) {
    first = parts[0].toLowerCase();
    last = parts[parts.length - 1].toLowerCase();
  } else if (parts.length === 1 && parts[0].length >= 4) {
    first = parts[0].toLowerCase();
  }
  const add = (s: string) => {
    const v = s.replace(/[^a-z0-9._-]/g, "");
    if (v.length > 1) out.add(`${v}@${domain}`);
  };
  if (first && last) {
    add(`${first}.${last}`);
    add(`${first}${last}`);
    add(`${first}_${last}`);
    add(`${first}-${last}`);
    add(`${first[0]}${last}`);
    add(`${first}.${last[0]}`);
    add(`${last}.${first}`);
    add(`${last}${first}`);
    add(`${first[0]}.${last}`);
    add(`${last}${first[0]}`);
    add(`${first}${last[0]}`);
    add(`${first[0]}${last[0]}`);
    return { formats: [...out].slice(0, 12), derived: true };
  }
  if (first) {
    add(first);
    add(`${first}.${last || "last"}`);
    return { formats: [...out].slice(0, 6), derived: true };
  }
  return { formats: [], derived: false };
}

async function checkHibp(email: string): Promise<{ breaches: string[] | null; note?: string }> {
  const key = process.env.HIBP_API_KEY;
  if (!key) return { breaches: null, note: "Breach check skipped — set HIBP_API_KEY to enable Have I Been Pwned lookups." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      { signal: ctl.signal, headers: { "hibp-api-key": key, "User-Agent": UA } },
    );
    if (res.status === 404) return { breaches: [] };
    if (!res.ok) return { breaches: null, note: `Breach check failed (HTTP ${res.status}).` };
    const arr = (await res.json()) as { Name?: string; Title?: string }[];
    const names = arr.map((b) => b.Title || b.Name).filter(Boolean) as string[];
    return { breaches: names };
  } catch {
    return { breaches: null, note: "Breach check timed out." };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: unknown };
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    /* fallthrough */
  }

  const notes: string[] = [];
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return Response.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  const domain = email.split("@")[1];
  const local = email.split("@")[0];
  const disposable = DISPOSABLE.has(domain);
  const provider =
    PROVIDERS[domain] ??
    (domain.endsWith(".edu") ? "Educational institution" : domain.endsWith(".gov") ? "Government domain" : null);

  if (disposable) notes.push("Disposable/throwaway email domain — low identity signal.");
  if (provider) notes.push(`Known provider: ${provider}.`);
  if (provider === "Google Gmail" && /[._+]/.test(local)) {
    notes.push("Gmail ignores dots and plus-tags — john.doe, johndoe and john.doe+tag share one inbox.");
  }
  if (local.length >= 5 && /^[a-z0-9._-]+$/.test(local) && local.includes(".")) {
    notes.push("Local part looks like a real name pattern — worth correlating with identity searches.");
  }

  // ── DNS deep check (MX + NS + SPF/DMARC/BIMI + DKIM selectors) ──
  let mx: { exchange: string; priority: number }[] = [];
  let mxOk = false;
  try {
    const records = await dns.resolveMx(domain);
    // A single "." record is RFC 7505 null MX: domain explicitly refuses email.
    if (records.length === 1 && records[0].exchange.replace(/\.$/, "") === "") {
      notes.push("Domain publishes a null MX (RFC 7505) — it explicitly refuses email.");
      mxOk = false;
    } else if (records.length > 0) {
      mx = records
        .sort((a, b) => a.priority - b.priority)
        .map((r) => ({ exchange: r.exchange.replace(/\.$/, ""), priority: r.priority }));
      mxOk = true;
    } else {
      try {
        await dns.resolve4(domain);
        mxOk = true;
        notes.push("No explicit MX records, but the domain resolves — mail may use implicit A-record routing.");
      } catch {
        notes.push("Domain has no MX or A records — the address is likely undeliverable.");
      }
    }
  } catch {
    notes.push("DNS lookup failed for the domain — could be a typo or a parked domain.");
  }

  const dnsReport = await lookupDns(domain);
  if (dnsReport.spf) notes.push("SPF record present — sending servers are explicitly authorized.");
  else notes.push("No SPF record found — domain does not publish authorized senders.");
  if (dnsReport.dmarcPolicy) {
    notes.push(
      dnsReport.dmarcPolicy === "reject" || dnsReport.dmarcPolicy === "quarantine"
        ? `DMARC policy is “${dnsReport.dmarcPolicy}” — hardened against spoofing.`
        : `DMARC policy is “${dnsReport.dmarcPolicy}” — monitoring only, spoofing not blocked.`,
    );
  } else {
    notes.push("No DMARC record — domain owner has not published anti-spoofing policy.");
  }
  if (dnsReport.dkim.length > 0) {
    notes.push(`DKIM signing found for selector(s): ${dnsReport.dkim.map((d) => d.selector).join(", ")}.`);
  }
  if (dnsReport.bimi) notes.push("BIMI record present — brand logo published with verified email.");
  if (dnsReport.ns.length > 0) notes.push(`Name servers: ${dnsReport.ns.join(", ")}.`);

  // ── RDAP domain registration ──────────────────────────────────────
  const rdap = await lookupRdap(domain);
  if (rdap) {
    if (rdap.registrar) notes.push(`Domain registrar: ${rdap.registrar}.`);
    if (rdap.created) notes.push(`Domain registered: ${rdap.created.slice(0, 10)}.`);
    if (rdap.registrantOrg) notes.push(`Registrant org in RDAP: ${rdap.registrantOrg}.`);
    if (rdap.registrantOrg === null && rdap.raw) notes.push("RDAP registrant is privacy-protected or redacted.");
  } else {
    notes.push("RDAP registration data unavailable for this TLD.");
  }

  // ── Address format derivation (corporate domains) ─────────────────
  const { formats, derived } = !provider && !disposable ? buildFormats(local, domain) : { formats: [], derived: false };
  if (derived && formats.length > 0) {
    notes.push(`Derived ${formats.length} plausible address format(s) for this domain from the local part.`);
  }

  // ── Gravatar (public avatar + profile JSON) ───────────────────────
  const hash = md5(email);
  const imageUrl = `https://gravatar.com/avatar/${hash}`;
  const gravatar: EmailReport["gravatar"] = {
    hash,
    imageUrl,
    hasAvatar: false,
    profileUrl: null,
  };
  let avatarChecked = false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const av = await fetch(`${imageUrl}?d=404&s=128`, {
        signal: ctl.signal,
        headers: { "User-Agent": UA },
      });
      avatarChecked = true;
      gravatar.hasAvatar = av.ok;
      if (av.ok) {
        gravatar.profileUrl = `https://gravatar.com/${hash}`;
        notes.push("Public Gravatar avatar exists — the same image may appear on other sites (reverse-image searchable).");
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    if (!avatarChecked) notes.push("Gravatar avatar check could not be completed (network).");
  }

  if (gravatar.hasAvatar) {
    const prof = await fetchJson<Record<string, unknown>>(`https://gravatar.com/${hash}.json`);
    if (prof.ok && prof.data) {
      const entry = (Array.isArray((prof.data as { entry?: unknown[] }).entry)
        ? (prof.data as { entry: Record<string, unknown>[] }).entry[0]
        : null) ?? null;
      if (entry) {
        gravatar.profileUrl = `https://gravatar.com/${hash}`;
        if (typeof entry.displayName === "string") gravatar.displayName = entry.displayName;
        if (typeof entry.location === "string") gravatar.location = entry.location;
        if (typeof entry.description === "string") gravatar.description = entry.description;
        if (Array.isArray(entry.jobs)) {
          gravatar.jobs = entry.jobs
            .map((j) => (j && typeof j === "object" ? String((j as { organization?: string }).organization ?? "") : ""))
            .filter(Boolean)
            .slice(0, 5);
        }
        if (Array.isArray(entry.accounts)) {
          gravatar.accounts = entry.accounts
            .map((a) => {
              const acc = a as { shortname?: unknown; url?: unknown };
              return { shortname: String(acc.shortname ?? ""), url: String(acc.url ?? "") };
            })
            .filter((a: GravatarAccount) => a.shortname && a.url)
            .slice(0, 15);
        }
        notes.push("Public Gravatar profile found — exposes linked accounts, display name and location the owner published.");
      }
    }
  }

  const hibp = await checkHibp(email);
  if (hibp.note) notes.push(hibp.note);
  if (hibp.breaches && hibp.breaches.length > 0) {
    notes.push(`${hibp.breaches.length} breach(es) linked to this address.`);
  } else if (hibp.breaches) {
    notes.push("No breaches found in Have I Been Pwned.");
  }

  const report: EmailReport = {
    email,
    valid: true,
    provider,
    disposable,
    domain,
    mx,
    mxOk,
    dns: dnsReport,
    rdap,
    formats,
    gravatar,
    breaches: hibp.breaches,
    notes,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
