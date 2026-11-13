"use client";

// Contextual search-dork builders. Every URL opens a public search index.

export interface Dork {
  engine: string;
  url: string;
}

const enc = encodeURIComponent;

export function usernameDorks(username: string): Dork[] {
  const q = `"${username}"`;
  const siteQ = (site: string) => enc(`site:${site} "${username}"`);
  return [
    { engine: "Google", url: `https://www.google.com/search?q=${enc(q)}` },
    { engine: "Google — images", url: `https://www.google.com/search?q=${enc(q)}&tbm=isch` },
    { engine: "Google — news", url: `https://www.google.com/search?q=${enc(q)}&tbm=nws` },
    { engine: "DuckDuckGo", url: `https://duckduckgo.com/?q=${enc(q)}` },
    { engine: "Bing", url: `https://www.bing.com/search?q=${enc(q)}` },
    { engine: "Yandex", url: `https://yandex.com/search/?text=${enc(q)}` },
    { engine: "GitHub", url: `https://github.com/search?q=${enc(username)}&type=users` },
    { engine: "GitHub code", url: `https://github.com/search?q=${enc(q)}&type=code` },
    { engine: "Reddit", url: `https://www.reddit.com/search/?q=${enc(q)}` },
    { engine: "X / Twitter", url: `https://x.com/search?q=${enc(username)}&f=live` },
    { engine: "Pastebin", url: `https://duckduckgo.com/?q=${siteQ("pastebin.com")}` },
    { engine: "Keychain dumps", url: `https://duckduckgo.com/?q=${siteQ("keybase.io")}` },
    { engine: "Telegram", url: `https://duckduckgo.com/?q=${siteQ("t.me")}` },
    { engine: "Forums", url: `https://duckduckgo.com/?q=${enc(`"${username}" forum`)}` },
    { engine: "Breach dumps", url: `https://duckduckgo.com/?q=${enc(`"${username}" breach OR paste`)}` },
  ];
}

export function emailDorks(email: string, gravatarUrl?: string): Dork[] {
  const q = `"${email}"`;
  const siteQ = (site: string) => enc(`site:${site} "${email}"`);
  const dorks: Dork[] = [
    { engine: "Google", url: `https://www.google.com/search?q=${enc(q)}` },
    { engine: "Google — LinkedIn", url: `https://www.google.com/search?q=${enc(`site:linkedin.com "${email}"`)}` },
    { engine: "Google — code", url: `https://www.google.com/search?q=${enc(`site:github.com OR site:gitlab.com "${email}"`)}` },
    { engine: "DuckDuckGo", url: `https://duckduckgo.com/?q=${enc(q)}` },
    { engine: "Bing", url: `https://www.bing.com/search?q=${enc(q)}` },
    { engine: "Yandex", url: `https://yandex.com/search/?text=${enc(q)}` },
    { engine: "Pastebin", url: `https://duckduckgo.com/?q=${siteQ("pastebin.com")}` },
    { engine: "Reddit", url: `https://www.reddit.com/search/?q=${enc(q)}` },
    { engine: "GitHub", url: `https://github.com/search?q=${enc(email)}&type=commits` },
    { engine: "X / Twitter", url: `https://x.com/search?q=${enc(email)}&f=live` },
    { engine: "Facebook", url: `https://www.facebook.com/search/top?q=${enc(email)}` },
    { engine: "General dumps", url: `https://duckduckgo.com/?q=${enc(`"${email}" (pastebin OR dump OR leak)`)}` },
  ];
  if (gravatarUrl) {
    const g = enc(gravatarUrl);
    dorks.push(
      { engine: "Google Lens", url: `https://lens.google.com/uploadbyurl?url=${g}` },
      { engine: "Yandex Images", url: `https://yandex.com/images/search?rpt=imageview&url=${g}` },
      { engine: "Bing Images", url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${g}` },
      { engine: "TinEye", url: `https://tineye.com/search?url=${g}` },
    );
  }
  return dorks;
}

export function phoneDorks(e164: string, country?: string | null, national?: string | null): Dork[] {
  const no = e164.replace(/^\+/, "");
  const q = `"${e164}"`;
  const alt = national ? `"${national}"` : null;
  const qAll = alt ? `${q} OR ${alt}` : q;
  const dorks: Dork[] = [
    { engine: "Google", url: `https://www.google.com/search?q=${enc(qAll)}` },
    { engine: "Google — int'l", url: `https://www.google.com/search?q=${enc(`"${no}"`)}` },
    { engine: "DuckDuckGo", url: `https://duckduckgo.com/?q=${enc(qAll)}` },
    { engine: "Bing", url: `https://www.bing.com/search?q=${enc(qAll)}` },
    { engine: "Yandex", url: `https://yandex.com/search/?text=${enc(qAll)}` },
    { engine: "Truecaller", url: `https://www.google.com/search?q=${enc(`site:truecaller.com "${e164}"`)}` },
    { engine: "Shouldianswer", url: `https://www.google.com/search?q=${enc(`site:shouldianswer.com "${e164}"`)}` },
    { engine: "Tellows", url: `https://www.google.com/search?q=${enc(`site:tellows.com "${e164}"`)}` },
    { engine: "WhatsApp", url: `https://wa.me/${no}` },
    { engine: "Telegram", url: `https://duckduckgo.com/?q=${enc(`"${e164}" site:t.me`)}` },
    { engine: "Facebook", url: `https://www.facebook.com/search/top?q=${enc(e164)}` },
    { engine: "X / Twitter", url: `https://x.com/search?q=${enc(e164)}&f=live` },
  ];
  if (country) {
    dorks.push({ engine: "Country lookup", url: `https://www.google.com/search?q=${enc(`"${e164}" ${country}`)}` });
  }
  return dorks;
}

export function combinedDorks(input: { username?: string; email?: string; name?: string; phone?: string }): Dork[] {
  const parts = [input.username, input.email, input.name, input.phone].filter(Boolean);
  if (parts.length < 2) return [];
  const q = parts.map((p) => `"${p}"`).join(" ");
  return [
    { engine: "Cross-correlate", url: `https://www.google.com/search?q=${enc(q)}` },
    { engine: "DuckDuckGo", url: `https://duckduckgo.com/?q=${enc(q)}` },
    { engine: "Bing", url: `https://www.bing.com/search?q=${enc(q)}` },
    { engine: "Yandex", url: `https://yandex.com/search/?text=${enc(q)}` },
  ];
}

/** Derive scan variants from a username (deduped, excludes the original). */
export function usernameVariants(username: string): string[] {
  const u = username.toLowerCase();
  const out = new Set<string>();
  const stripped = u.replace(/[._-]/g, "");
  if (stripped !== u && stripped.length >= 3) out.add(stripped);
  const dotted = u.replace(/[_-]/g, ".");
  if (dotted !== u) out.add(dotted);
  const underscored = u.replace(/[.-]/g, "_");
  if (underscored !== u) out.add(underscored);
  const hyphened = u.replace(/[._]/g, "-");
  if (hyphened !== u) out.add(hyphened);
  return [...out].filter((v) => /^[a-z0-9._-]{3,40}$/.test(v)).slice(0, 3);
}
