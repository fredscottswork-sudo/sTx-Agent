import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import type { EmailReport, GravatarAccount } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA = "STX-Trace/1.0 (OSINT workbench; public-data lookups)";

const PROVIDERS: Record<string, string> = {
  "gmail.com": "Google Gmail",
  "googlemail.com": "Google Gmail",
  "yahoo.com": "Yahoo Mail",
  "yahoo.co.uk": "Yahoo Mail UK",
  "ymail.com": "Yahoo Mail",
  "outlook.com": "Microsoft Outlook",
  "hotmail.com": "Microsoft Hotmail",
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
  "mail.com": "Mail.com",
  "aol.com": "AOL Mail",
  "zoho.com": "Zoho Mail",
  "yandex.com": "Yandex Mail",
  "yandex.ru": "Yandex Mail",
  "mail.ru": "Mail.ru",
  "qq.com": "Tencent QQ",
  "163.com": "NetEase 163",
  "126.com": "NetEase 126",
  "tutanota.com": "Tutanota",
  "tuta.io": "Tutanota",
  "fastmail.com": "Fastmail",
  "hey.com": "HEY",
  "cock.li": "cock.li",
  "hushmail.com": "Hushmail",
  "inbox.com": "Inbox.com",
};

const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "throwawaymail.com",
  "fakeinbox.com",
  "maildrop.cc",
  "tempr.email",
  "moakt.cc",
  "linshiyouxiang.net",
  "emailondeck.com",
  "33mail.com",
  "mytemp.email",
  "dropmail.me",
  "tmail.ws",
  "burnermail.io",
  "harakirimail.com",
  "kagi.com",
  "spamgourmet.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; data: T | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHibp(email: string): Promise<{ breaches: string[] | null; note?: string }> {
  const key = process.env.HIBP_API_KEY;
  if (!key) return { breaches: null, note: "Breach check skipped — set HIBP_API_KEY to enable Have I Been Pwned lookups." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        signal: ctl.signal,
        headers: { "hibp-api-key": key, "User-Agent": UA },
      },
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
    return Response.json(
      { error: "That doesn't look like a valid email address." },
      { status: 400 },
    );
  }

  const domain = email.split("@")[1];
  const local = email.split("@")[0];
  const disposable = DISPOSABLE.has(domain);
  const provider =
    PROVIDERS[domain] ??
    (domain.endsWith(".edu") ? "Educational institution" : domain.endsWith(".gov") ? "Government domain" : null);

  if (disposable) notes.push("Disposable/throwaway email domain — low identity signal.");
  if (provider) notes.push(`Known provider: ${provider}.`);
  if (local.length >= 5 && /^[a-z0-9._-]+$/.test(local) && local.includes(".")) {
    notes.push("Local part looks like a real name pattern — worth correlating with identity searches.");
  }

  // MX lookup
  let mx: { exchange: string; priority: number }[] = [];
  let mxOk = false;
  try {
    const records = await dns.resolveMx(domain);
    if (records.length > 0) {
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

  // Gravatar (public avatar + public profile JSON)
  const hash = md5(email);
  const gravatar: EmailReport["gravatar"] = {
    hash,
    hasAvatar: false,
    profileUrl: null,
  };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const av = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404&s=128`, {
        signal: ctl.signal,
        headers: { "User-Agent": UA },
      });
      gravatar.hasAvatar = av.ok;
      if (av.ok) {
        gravatar.profileUrl = `https://gravatar.com/${hash}`;
        notes.push("Public Gravatar avatar exists for this address — the same avatar may appear on other sites.");
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    notes.push("Gravatar avatar check could not be completed (network).");
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
              return {
                shortname: String(acc.shortname ?? ""),
                url: String(acc.url ?? ""),
              };
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
  } else if (hibp.breaches && hibp.breaches.length === 0) {
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
    gravatar,
    breaches: hibp.breaches,
    notes,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
