// STX Trace — curated public-profile checks for username OSINT.
// Each entry builds a public profile URL. Status-code semantics:
//  - default: 200 => found, 404/410 => missing, 401/403/429 => unknown (blocked)
//  - hard: login-wall / client-rendered SPA where 200 is meaningless => unknown
//  - errorPattern: body matches => missing (soft-404 pages)
//  - foundPattern: body matches => found (when status alone is ambiguous)

export type SiteCategory =
  | "developer"
  | "social"
  | "gaming"
  | "creative"
  | "community"
  | "business"
  | "media";

export type Pattern = string | ((u: string) => RegExp);

export interface SiteDef {
  name: string;
  category: SiteCategory;
  build: (u: string) => string;
  hard?: boolean;
  errorPattern?: Pattern;
  foundPattern?: Pattern;
}

/** Compile a pattern (static string or per-username function) to a RegExp. */
export function compilePattern(p: Pattern | undefined, u: string): RegExp | null {
  if (!p) return null;
  return typeof p === "string" ? new RegExp(p, "i") : p(u);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const P = (u: string) => `@${escapeRegex(u)}`;

export const SITES: SiteDef[] = [
  // ── Developer / tech ─────────────────────────────────────────────
  { name: "GitHub", category: "developer", build: (u) => `https://github.com/${u}` },
  { name: "GitLab", category: "developer", build: (u) => `https://gitlab.com/${u}` },
  { name: "Bitbucket", category: "developer", build: (u) => `https://bitbucket.org/${u}` },
  { name: "Gitee", category: "developer", build: (u) => `https://gitee.com/${u}` },
  { name: "SourceForge", category: "developer", build: (u) => `https://sourceforge.net/u/${u}/` },
  { name: "Launchpad", category: "developer", build: (u) => `https://launchpad.net/~${u}` },
  { name: "Hugging Face", category: "developer", build: (u) => `https://huggingface.co/${u}` },
  { name: "npm", category: "developer", build: (u) => `https://www.npmjs.com/~${u}` },
  { name: "PyPI", category: "developer", build: (u) => `https://pypi.org/user/${u}` },
  { name: "RubyGems", category: "developer", build: (u) => `https://rubygems.org/profiles/${u}` },
  { name: "Docker Hub", category: "developer", build: (u) => `https://hub.docker.com/u/${u}` },
  { name: "dev.to", category: "developer", build: (u) => `https://dev.to/${u}` },
  { name: "Hashnode", category: "developer", build: (u) => `https://hashnode.com/@${u}` },
  { name: "CodePen", category: "developer", build: (u) => `https://codepen.io/${u}` },
  { name: "Replit", category: "developer", build: (u) => `https://replit.com/@${u}` },
  { name: "Observable", category: "developer", build: (u) => `https://observablehq.com/@${u}` },
  { name: "Kaggle", category: "developer", build: (u) => `https://www.kaggle.com/${u}` },
  { name: "HackerRank", category: "developer", build: (u) => `https://www.hackerrank.com/${u}` },
  { name: "Codeforces", category: "developer", build: (u) => `https://codeforces.com/profile/${u}` },
  { name: "AtCoder", category: "developer", build: (u) => `https://atcoder.jp/users/${u}` },
  { name: "OpenStreetMap", category: "developer", build: (u) => `https://www.openstreetmap.org/user/${u}` },
  { name: "Keybase", category: "developer", build: (u) => `https://keybase.io/${u}` },
  { name: "HackerOne", category: "developer", build: (u) => `https://hackerone.com/${u}` },
  { name: "TryHackMe", category: "developer", build: (u) => `https://tryhackme.com/p/${u}` },
  { name: "Wikipedia", category: "developer", build: (u) => `https://en.wikipedia.org/wiki/User:${u}` },
  { name: "Archive.org", category: "developer", build: (u) => `https://archive.org/details/@${u}` },
  { name: "itch.io", category: "developer", build: (u) => `https://${u}.itch.io` },

  // ── Social ───────────────────────────────────────────────────────
  {
    name: "X (Twitter)",
    category: "social",
    build: (u) => `https://x.com/${u}`,
    hard: true,
    errorPattern: "This account doesn't exist|this page doesn't exist",
    foundPattern: (u) => new RegExp(`\\(@${escapeRegex(u)}\\)`, "i"),
  },
  {
    name: "Instagram",
    category: "social",
    build: (u) => `https://www.instagram.com/${u}/`,
    errorPattern: "Sorry, this page isn't available",
  },
  {
    name: "Facebook",
    category: "social",
    build: (u) => `https://www.facebook.com/${u}`,
    hard: true,
    errorPattern: "This page isn't available|content isn't available",
  },
  {
    name: "Reddit",
    category: "social",
    build: (u) => `https://www.reddit.com/user/${u}/`,
    errorPattern: "nobody on Reddit goes by that name|Sorry, nobody on Reddit",
  },
  {
    name: "TikTok",
    category: "social",
    build: (u) => `https://www.tiktok.com/@${u}`,
    errorPattern: "couldn't find this account|couldn't find this user|couldn’t find this account",
  },
  { name: "Pinterest", category: "social", build: (u) => `https://www.pinterest.com/${u}/` },
  {
    name: "LinkedIn",
    category: "social",
    build: (u) => `https://www.linkedin.com/in/${u}`,
    hard: true,
    errorPattern: "page not found|This page doesn't exist",
  },
  {
    name: "Snapchat",
    category: "social",
    build: (u) => `https://www.snapchat.com/add/${u}`,
    hard: true,
    errorPattern: "couldn't find|doesn't exist",
  },
  {
    name: "Twitch",
    category: "social",
    build: (u) => `https://www.twitch.tv/${u}`,
    hard: true,
    errorPattern: "Sorry\\. Unless you've got a time machine",
  },
  { name: "YouTube", category: "social", build: (u) => `https://www.youtube.com/@${u}` },
  {
    name: "VK",
    category: "social",
    build: (u) => `https://vk.com/${u}`,
    errorPattern: "profile has been deleted|This page is not available",
  },
  { name: "Telegram", category: "social", build: (u) => `https://t.me/${u}` },
  { name: "Mastodon", category: "social", build: (u) => `https://mastodon.social/@${u}` },
  { name: "Bluesky", category: "social", build: (u) => `https://bsky.app/profile/${u}.bsky.social`, hard: true },
  { name: "Tumblr", category: "social", build: (u) => `https://${u}.tumblr.com` },
  { name: "WordPress", category: "social", build: (u) => `https://${u}.wordpress.com` },
  { name: "Substack", category: "social", build: (u) => `https://${u}.substack.com` },
  { name: "Medium", category: "social", build: (u) => `https://medium.com/@${u}` },
  { name: "LiveJournal", category: "social", build: (u) => `https://${u}.livejournal.com` },
  { name: "Dreamwidth", category: "social", build: (u) => `https://${u}.dreamwidth.net` },
  {
    name: "Quora",
    category: "social",
    build: (u) => `https://www.quora.com/profile/${u}`,
    hard: true,
  },
  { name: "About.me", category: "social", build: (u) => `https://about.me/${u}`, hard: true },
  { name: "Linktree", category: "social", build: (u) => `https://linktr.ee/${u}` },
  { name: "Bio.link", category: "social", build: (u) => `https://bio.link/${u}` },
  { name: "Gravatar", category: "social", build: (u) => `https://gravatar.com/${u}` },
  { name: "Flickr", category: "social", build: (u) => `https://www.flickr.com/people/${u}/` },
  { name: "Imgur", category: "social", build: (u) => `https://imgur.com/user/${u}` },
  { name: "Foursquare", category: "social", build: (u) => `https://foursquare.com/${u}` },
  { name: "Weibo", category: "social", build: (u) => `https://weibo.com/${u}`, hard: true },

  // ── Gaming ───────────────────────────────────────────────────────
  {
    name: "Steam",
    category: "gaming",
    build: (u) => `https://steamcommunity.com/id/${u}`,
    errorPattern: "The specified profile could not be found|profile not found",
  },
  { name: "Chess.com", category: "gaming", build: (u) => `https://www.chess.com/member/${u}` },
  { name: "Lichess", category: "gaming", build: (u) => `https://lichess.org/@/${u}` },
  { name: "NameMC", category: "gaming", build: (u) => `https://namemc.com/profile/${u}` },
  {
    name: "Pokémon Showdown",
    category: "gaming",
    build: (u) => `https://play.pokemonshowdown.com/users/${u}`,
  },
  { name: "Untappd", category: "gaming", build: (u) => `https://untappd.com/user/${u}` },
  {
    name: "Roblox",
    category: "gaming",
    build: (u) => `https://www.roblox.com/users/profile?username=${u}`,
    hard: true,
  },

  // ── Creative / media ─────────────────────────────────────────────
  { name: "DeviantArt", category: "creative", build: (u) => `https://www.deviantart.com/${u}` },
  { name: "ArtStation", category: "creative", build: (u) => `https://www.artstation.com/${u}` },
  { name: "Behance", category: "creative", build: (u) => `https://www.behance.net/${u}` },
  { name: "Dribbble", category: "creative", build: (u) => `https://dribbble.com/${u}` },
  { name: "SoundCloud", category: "creative", build: (u) => `https://soundcloud.com/${u}` },
  { name: "Bandcamp", category: "creative", build: (u) => `https://${u}.bandcamp.com` },
  { name: "ReverbNation", category: "creative", build: (u) => `https://www.reverbnation.com/${u}` },
  { name: "Last.fm", category: "media", build: (u) => `https://www.last.fm/user/${u}` },
  { name: "Discogs", category: "media", build: (u) => `https://www.discogs.com/user/${u}` },
  { name: "RateYourMusic", category: "media", build: (u) => `https://rateyourmusic.com/~${u}` },
  { name: "Letterboxd", category: "media", build: (u) => `https://letterboxd.com/${u}` },
  { name: "Trakt", category: "media", build: (u) => `https://trakt.tv/users/${u}` },
  { name: "MyAnimeList", category: "media", build: (u) => `https://myanimelist.net/profile/${u}` },

  // ── Community / forums ───────────────────────────────────────────
  {
    name: "Hacker News",
    category: "community",
    build: (u) => `https://news.ycombinator.com/user?id=${u}`,
    errorPattern: "No such user",
  },
  { name: "Lobsters", category: "community", build: (u) => `https://lobste.rs/u/${u}` },
  { name: "Indie Hackers", category: "community", build: (u) => `https://www.indiehackers.com/${u}` },
  { name: "Product Hunt", category: "community", build: (u) => `https://www.producthunt.com/@${u}` },

  // ── Business / funding ───────────────────────────────────────────
  { name: "Patreon", category: "business", build: (u) => `https://www.patreon.com/${u}` },
  { name: "Buy Me a Coffee", category: "business", build: (u) => `https://www.buymeacoffee.com/${u}` },
  { name: "Ko-fi", category: "business", build: (u) => `https://ko-fi.com/${u}` },
  { name: "Wellfound", category: "business", build: (u) => `https://wellfound.com/u/${u}` },
];

export function buildUrl(site: SiteDef, username: string): string {
  return site.build(username);
}
