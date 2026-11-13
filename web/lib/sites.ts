// STX Trace — curated public-profile checks for username OSINT.
// Classification rules (accuracy engine):
//  - 404/410            → missing (high confidence)
//  - soft-404 body match (errorPattern) → missing (high confidence)
//  - 200 + foundPattern match          → found (high confidence)
//  - 200 + body echoes the username    → found (high confidence)
//  - 200 without echo                  → found (low confidence, possible soft-404)
//  - login/signup redirect or hard wall → unknown (inconclusive)
//  - 401/403/429/451/999, timeout, network error → unknown (inconclusive)
//  - transient network error gets one retry

export type SiteCategory =
  | "developer"
  | "social"
  | "gaming"
  | "creative"
  | "community"
  | "business"
  | "media"
  | "knowledge"
  | "messaging"
  | "finance"
  | "shopping"
  | "other";

export type Pattern = string | ((u: string) => RegExp);

export interface SiteDef {
  name: string;
  category: SiteCategory;
  build: (u: string) => string;
  /** Login-wall / client-rendered SPA where 200 alone proves nothing. */
  hard?: boolean;
  errorPattern?: Pattern;
  foundPattern?: Pattern;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a pattern (static string or per-username function) to a RegExp. */
export function compilePattern(p: Pattern | undefined, u: string): RegExp | null {
  if (!p) return null;
  return typeof p === "string" ? new RegExp(p, "i") : p(u);
}

export const SITES: SiteDef[] = [
  // ══ Developer / tech (58) ═══════════════════════════════════════
  { name: "GitHub", category: "developer", build: (u) => `https://github.com/${u}`,
    foundPattern: (u) => new RegExp(`<title>[^<]*\\(${escapeRegex(u)}\\)`, "i") },
  { name: "GitLab", category: "developer", build: (u) => `https://gitlab.com/${u}` },
  { name: "Bitbucket", category: "developer", build: (u) => `https://bitbucket.org/${u}` },
  { name: "Codeberg", category: "developer", build: (u) => `https://codeberg.org/${u}` },
  { name: "SourceHut", category: "developer", build: (u) => `https://sr.ht/~${u}` },
  { name: "Gitee", category: "developer", build: (u) => `https://gitee.com/${u}` },
  { name: "SourceForge", category: "developer", build: (u) => `https://sourceforge.net/u/${u}/` },
  { name: "Launchpad", category: "developer", build: (u) => `https://launchpad.net/~${u}` },
  { name: "Hugging Face", category: "developer", build: (u) => `https://huggingface.co/${u}` },
  { name: "npm", category: "developer", build: (u) => `https://www.npmjs.com/~${u}` },
  { name: "PyPI", category: "developer", build: (u) => `https://pypi.org/user/${u}` },
  { name: "RubyGems", category: "developer", build: (u) => `https://rubygems.org/profiles/${u}` },
  { name: "crates.io", category: "developer", build: (u) => `https://crates.io/users/${u}` },
  { name: "Packagist", category: "developer", build: (u) => `https://packagist.org/~${u}` },
  { name: "Anaconda", category: "developer", build: (u) => `https://anaconda.org/${u}` },
  { name: "Docker Hub", category: "developer", build: (u) => `https://hub.docker.com/u/${u}` },
  { name: "dev.to", category: "developer", build: (u) => `https://dev.to/${u}` },
  { name: "Hashnode", category: "developer", build: (u) => `https://hashnode.com/@${u}` },
  { name: "CodePen", category: "developer", build: (u) => `https://codepen.io/${u}` },
  { name: "JSFiddle", category: "developer", build: (u) => `https://jsfiddle.net/user/${u}` },
  { name: "CodeSandbox", category: "developer", build: (u) => `https://codesandbox.io/u/${u}` },
  { name: "Replit", category: "developer", build: (u) => `https://replit.com/@${u}` },
  { name: "Observable", category: "developer", build: (u) => `https://observablehq.com/@${u}` },
  { name: "Kaggle", category: "developer", build: (u) => `https://www.kaggle.com/${u}` },
  { name: "HackerRank", category: "developer", build: (u) => `https://www.hackerrank.com/${u}` },
  { name: "Codeforces", category: "developer", build: (u) => `https://codeforces.com/profile/${u}` },
  { name: "AtCoder", category: "developer", build: (u) => `https://atcoder.jp/users/${u}` },
  { name: "CodeChef", category: "developer", build: (u) => `https://www.codechef.com/users/${u}` },
  { name: "Codewars", category: "developer", build: (u) => `https://www.codewars.com/users/${u}` },
  { name: "Exercism", category: "developer", build: (u) => `https://exercism.org/profiles/${u}` },
  { name: "SPOJ", category: "developer", build: (u) => `https://www.spoj.com/users/${u}` },
  { name: "Kattis", category: "developer", build: (u) => `https://open.kattis.com/users/${u}` },
  { name: "HackerEarth", category: "developer", build: (u) => `https://www.hackerearth.com/@${u}` },
  { name: "OpenStreetMap", category: "developer", build: (u) => `https://www.openstreetmap.org/user/${u}` },
  { name: "Keybase", category: "developer", build: (u) => `https://keybase.io/${u}` },
  { name: "HackerOne", category: "developer", build: (u) => `https://hackerone.com/${u}` },
  { name: "TryHackMe", category: "developer", build: (u) => `https://tryhackme.com/p/${u}` },
  { name: "DigitalOcean", category: "developer", build: (u) => `https://www.digitalocean.com/community/users/${u}` },
  { name: "Meta Discuss", category: "developer", build: (u) => `https://meta.discourse.org/u/${u}` },
  { name: "Python Discourse", category: "developer", build: (u) => `https://discuss.python.org/u/${u}` },
  { name: "OpenAI Forum", category: "developer", build: (u) => `https://community.openai.com/u/${u}` },
  { name: "Obsidian Forum", category: "developer", build: (u) => `https://forum.obsidian.md/u/${u}` },
  { name: "GitLab Forum", category: "developer", build: (u) => `https://forum.gitlab.com/u/${u}` },
  { name: "Cloudflare Community", category: "developer", build: (u) => `https://community.cloudflare.com/u/${u}` },
  { name: "freeCodeCamp Forum", category: "developer", build: (u) => `https://forum.freecodecamp.org/u/${u}` },
  { name: "Wikipedia", category: "developer", build: (u) => `https://en.wikipedia.org/wiki/User:${u}` },
  { name: "Wiktionary", category: "knowledge", build: (u) => `https://en.wiktionary.org/wiki/User:${u}` },
  { name: "Wikiquote", category: "knowledge", build: (u) => `https://en.wikiquote.org/wiki/User:${u}` },
  { name: "Archive.org", category: "developer", build: (u) => `https://archive.org/details/@${u}` },
  { name: "itch.io", category: "developer", build: (u) => `https://${u}.itch.io` },
  { name: "Gist", category: "developer", build: (u) => `https://gist.github.com/${u}` },
  { name: "SlideShare", category: "knowledge", build: (u) => `https://www.slideshare.net/${u}` },
  { name: "Issuu", category: "knowledge", build: (u) => `https://issuu.com/${u}` },
  { name: "Polywork", category: "developer", build: (u) => `https://polywork.com/${u}` },
  { name: "LeetCode", category: "developer", build: (u) => `https://leetcode.com/${u}`, hard: true,
    errorPattern: "404|page not found" },

  // ══ Social (55) ═════════════════════════════════════════════════
  { name: "X (Twitter)", category: "social", build: (u) => `https://x.com/${u}`,
    hard: true,
    errorPattern: "This account doesn't exist|this page doesn't exist",
    foundPattern: (u) => new RegExp(`\\(@${escapeRegex(u)}\\)`, "i") },
  { name: "Instagram", category: "social", build: (u) => `https://www.instagram.com/${u}/`,
    errorPattern: "Sorry, this page isn't available" },
  { name: "Facebook", category: "social", build: (u) => `https://www.facebook.com/${u}`,
    hard: true,
    errorPattern: "This page isn't available|content isn't available",
    foundPattern: (u) => new RegExp(`facebook\\.com/${escapeRegex(u)}[\"'?/]`, "i") },
  { name: "Reddit", category: "social", build: (u) => `https://www.reddit.com/user/${u}/`,
    errorPattern: "nobody on Reddit goes by that name|Sorry, nobody on Reddit" },
  { name: "TikTok", category: "social", build: (u) => `https://www.tiktok.com/@${u}`,
    errorPattern: "couldn't find this account|couldn't find this user|couldn’t find this account",
    foundPattern: (u) => new RegExp(`"@${escapeRegex(u)}"|tiktok\\.com/@${escapeRegex(u)}`, "i") },
  { name: "Pinterest", category: "social", build: (u) => `https://www.pinterest.com/${u}/` },
  { name: "LinkedIn", category: "social", build: (u) => `https://www.linkedin.com/in/${u}`,
    hard: true,
    errorPattern: "page not found|This page doesn't exist",
    foundPattern: (u) => new RegExp(`linkedin\\.com/in/${escapeRegex(u)}`, "i") },
  { name: "Threads", category: "social", build: (u) => `https://www.threads.net/@${u}`, hard: true,
    errorPattern: "Sorry, this page isn't available" },
  { name: "Snapchat", category: "social", build: (u) => `https://www.snapchat.com/add/${u}`,
    hard: true,
    errorPattern: "couldn't find|doesn't exist" },
  { name: "Twitch", category: "social", build: (u) => `https://www.twitch.tv/${u}`,
    hard: true,
    errorPattern: "Sorry\\. Unless you've got a time machine",
    foundPattern: (u) => new RegExp(`twitch\\.tv/${escapeRegex(u)}[\"'/?#]`, "i") },
  { name: "YouTube", category: "social", build: (u) => `https://www.youtube.com/@${u}` },
  { name: "VK", category: "social", build: (u) => `https://vk.com/${u}`,
    errorPattern: "profile has been deleted|This page is not available" },
  { name: "Telegram", category: "social", build: (u) => `https://t.me/${u}` },
  { name: "Mastodon", category: "social", build: (u) => `https://mastodon.social/@${u}` },
  { name: "Pixelfed", category: "social", build: (u) => `https://pixelfed.social/${u}` },
  { name: "Misskey", category: "social", build: (u) => `https://misskey.io/@${u}` },
  { name: "Lemmy", category: "social", build: (u) => `https://lemmy.world/u/${u}` },
  { name: "Bluesky", category: "social", build: (u) => `https://bsky.app/profile/${u}.bsky.social`, hard: true },
  { name: "Gab", category: "social", build: (u) => `https://gab.com/${u}` },
  { name: "Gettr", category: "social", build: (u) => `https://gettr.com/user/${u}` },
  { name: "Truth Social", category: "social", build: (u) => `https://truthsocial.com/@${u}` },
  { name: "Minds", category: "social", build: (u) => `https://minds.com/${u}` },
  { name: "Tumblr", category: "social", build: (u) => `https://${u}.tumblr.com` },
  { name: "WordPress", category: "social", build: (u) => `https://${u}.wordpress.com` },
  { name: "Ghost", category: "social", build: (u) => `https://${u}.ghost.io` },
  { name: "Substack", category: "social", build: (u) => `https://${u}.substack.com` },
  { name: "Medium", category: "social", build: (u) => `https://medium.com/@${u}` },
  { name: "LiveJournal", category: "social", build: (u) => `https://${u}.livejournal.com` },
  { name: "Dreamwidth", category: "social", build: (u) => `https://${u}.dreamwidth.net` },
  { name: "Quora", category: "social", build: (u) => `https://www.quora.com/profile/${u}`, hard: true },
  { name: "About.me", category: "social", build: (u) => `https://about.me/${u}`, hard: true },
  { name: "Linktree", category: "social", build: (u) => `https://linktr.ee/${u}` },
  { name: "Bio.link", category: "social", build: (u) => `https://bio.link/${u}` },
  { name: "Beacons", category: "social", build: (u) => `https://beacons.ai/${u}` },
  { name: "Solo.to", category: "social", build: (u) => `https://solo.to/${u}` },
  { name: "Gravatar", category: "social", build: (u) => `https://gravatar.com/${u}` },
  { name: "Flickr", category: "social", build: (u) => `https://www.flickr.com/people/${u}/` },
  { name: "500px", category: "social", build: (u) => `https://500px.com/${u}` },
  { name: "Unsplash", category: "social", build: (u) => `https://unsplash.com/@${u}` },
  { name: "Pexels", category: "social", build: (u) => `https://www.pexels.com/@${u}` },
  { name: "Imgur", category: "social", build: (u) => `https://imgur.com/user/${u}` },
  { name: "Foursquare", category: "social", build: (u) => `https://foursquare.com/${u}` },
  { name: "Weibo", category: "social", build: (u) => `https://weibo.com/${u}`, hard: true },
  { name: "MySpace", category: "social", build: (u) => `https://myspace.com/${u}` },
  { name: "Wattpad", category: "social", build: (u) => `https://www.wattpad.com/user/${u}` },
  { name: "Quotev", category: "social", build: (u) => `https://quotev.com/${u}` },
  { name: "Blogger", category: "social", build: (u) => `https://${u}.blogspot.com`, hard: true },
  { name: "Venmo", category: "social", build: (u) => `https://venmo.com/${u}`, hard: true,
    errorPattern: "can't find|cannot find" },

  // ══ Gaming (22) ═════════════════════════════════════════════════
  { name: "Steam", category: "gaming", build: (u) => `https://steamcommunity.com/id/${u}`,
    errorPattern: "The specified profile could not be found|profile not found",
    foundPattern: (u) => new RegExp(`steamcommunity\\.com/id/${escapeRegex(u)}`, "i") },
  { name: "Chess.com", category: "gaming", build: (u) => `https://www.chess.com/member/${u}` },
  { name: "Lichess", category: "gaming", build: (u) => `https://lichess.org/@/${u}` },
  { name: "NameMC", category: "gaming", build: (u) => `https://namemc.com/profile/${u}` },
  { name: "Pokémon Showdown", category: "gaming", build: (u) => `https://play.pokemonshowdown.com/users/${u}` },
  { name: "Roblox", category: "gaming", build: (u) => `https://www.roblox.com/users/profile?username=${u}`,
    hard: true },
  { name: "FACEIT", category: "gaming", build: (u) => `https://www.faceit.com/en/players/${u}` },
  { name: "PSNProfiles", category: "gaming", build: (u) => `https://psnprofiles.com/${u}` },
  { name: "Speedrun.com", category: "gaming", build: (u) => `https://www.speedrun.com/user/${u}` },
  { name: "Game Jolt", category: "gaming", build: (u) => `https://gamejolt.com/@${u}` },
  { name: "Newgrounds", category: "gaming", build: (u) => `https://${u}.newgrounds.com` },
  { name: "Untappd", category: "gaming", build: (u) => `https://untappd.com/user/${u}` },
  { name: "Duolingo", category: "gaming", build: (u) => `https://www.duolingo.com/profile/${u}`, hard: true },
  { name: "Quizlet", category: "gaming", build: (u) => `https://quizlet.com/${u}` },

  // ══ Creative / design (16) ══════════════════════════════════════
  { name: "DeviantArt", category: "creative", build: (u) => `https://www.deviantart.com/${u}` },
  { name: "ArtStation", category: "creative", build: (u) => `https://www.artstation.com/${u}` },
  { name: "Behance", category: "creative", build: (u) => `https://www.behance.net/${u}` },
  { name: "Dribbble", category: "creative", build: (u) => `https://dribbble.com/${u}` },
  { name: "Carbonmade", category: "creative", build: (u) => `https://${u}.carbonmade.com`, hard: true },
  { name: "Canva", category: "creative", build: (u) => `https://www.canva.com/${u}`, hard: true },
  { name: "Figma Community", category: "creative", build: (u) => `https://www.figma.com/@${u}` },
  { name: "Notion", category: "creative", build: (u) => `https://www.notion.so/${u}`, hard: true },
  { name: "Are.na", category: "creative", build: (u) => `https://www.are.na/${u}` },
  { name: "Read.cv", category: "creative", build: (u) => `https://read.cv/${u}` },
  { name: "Cargo", category: "creative", build: (u) => `https://cargo.site/${u}`, hard: true },
  { name: "Format", category: "creative", build: (u) => `https://format.com/${u}`, hard: true },
  { name: "SmugMug", category: "creative", build: (u) => `https://${u}.smugmug.com`, hard: true },
  { name: "Pixieset", category: "creative", build: (u) => `https://${u}.pixieset.com`, hard: true },
  { name: "Adobe Portfolio", category: "creative", build: (u) => `https://${u}.myportfolio.com` },
  { name: "Coroflot", category: "creative", build: (u) => `https://www.coroflot.com/${u}` },

  // ══ Music / audio / video (20) ══════════════════════════════════
  { name: "SoundCloud", category: "media", build: (u) => `https://soundcloud.com/${u}` },
  { name: "Bandcamp", category: "media", build: (u) => `https://${u}.bandcamp.com` },
  { name: "ReverbNation", category: "media", build: (u) => `https://www.reverbnation.com/${u}` },
  { name: "Mixcloud", category: "media", build: (u) => `https://www.mixcloud.com/${u}` },
  { name: "Vimeo", category: "media", build: (u) => `https://vimeo.com/${u}` },
  { name: "Dailymotion", category: "media", build: (u) => `https://www.dailymotion.com/${u}` },
  { name: "Rumble", category: "media", build: (u) => `https://rumble.com/user/${u}` },
  { name: "Odysee", category: "media", build: (u) => `https://odysee.com/@${u}` },
  { name: "Bitchute", category: "media", build: (u) => `https://www.bitchute.com/channel/${u}` },
  { name: "Last.fm", category: "media", build: (u) => `https://www.last.fm/user/${u}` },
  { name: "Discogs", category: "media", build: (u) => `https://www.discogs.com/user/${u}` },
  { name: "RateYourMusic", category: "media", build: (u) => `https://rateyourmusic.com/~${u}` },
  { name: "Reverb", category: "media", build: (u) => `https://reverb.com/users/${u}` },
  { name: "BandLab", category: "media", build: (u) => `https://www.bandlab.com/@${u}` },
  { name: "Letterboxd", category: "media", build: (u) => `https://letterboxd.com/${u}` },
  { name: "Trakt", category: "media", build: (u) => `https://trakt.tv/users/${u}` },
  { name: "MyAnimeList", category: "media", build: (u) => `https://myanimelist.net/profile/${u}` },
  { name: "AniList", category: "media", build: (u) => `https://anilist.co/user/${u}` },
  { name: "Kitsu", category: "media", build: (u) => `https://kitsu.app/users/${u}` },
  { name: "AO3", category: "media", build: (u) => `https://archiveofourown.org/users/${u}` },
  { name: "FanFiction.net", category: "media", build: (u) => `https://www.fanfiction.net/u/${u}` },
  { name: "Scribd", category: "media", build: (u) => `https://www.scribd.com/${u}`, hard: true },

  // ══ Community / forums (18) ═════════════════════════════════════
  { name: "Hacker News", category: "community", build: (u) => `https://news.ycombinator.com/user?id=${u}`,
    errorPattern: "No such user" },
  { name: "Lobsters", category: "community", build: (u) => `https://lobste.rs/u/${u}` },
  { name: "Indie Hackers", category: "community", build: (u) => `https://www.indiehackers.com/${u}` },
  { name: "Product Hunt", category: "community", build: (u) => `https://www.producthunt.com/@${u}` },
  { name: "MetaFilter", category: "community", build: (u) => `https://www.metafilter.com/user/${u}` },
  { name: "Slashdot", category: "community", build: (u) => `https://slashdot.org/~${u}` },
  { name: "Fark", category: "community", build: (u) => `https://www.fark.com/users/${u}` },
  { name: "Gaia Online", category: "community", build: (u) => `https://www.gaiaonline.com/profile/${u}` },
  { name: "Nextdoor", category: "community", build: (u) => `https://nextdoor.com/profile/${u}`, hard: true },
  { name: "Meetup", category: "community", build: (u) => `https://www.meetup.com/members/${u}`, hard: true },
  { name: "Couchsurfing", category: "community", build: (u) => `https://www.couchsurfing.com/people/${u}` },
  { name: "InterPals", category: "community", build: (u) => `https://www.interpals.net/${u}`, hard: true },
  { name: "PenPal World", category: "community", build: (u) => `https://www.penpalworld.com/profiles/${u}`,
    hard: true },
  { name: "Blogger Profile", category: "community", build: (u) => `https://www.blogger.com/profile/${u}`,
    hard: true },
  { name: "Disqus", category: "community", build: (u) => `https://disqus.com/by/${u}/` },
  { name: "Commento", category: "community", build: (u) => `https://commento.io/${u}`, hard: true },
  { name: "Tildes", category: "community", build: (u) => `https://tildes.net/user/${u}` },
  { name: "Ravelry", category: "community", build: (u) => `https://www.ravelry.com/people/${u}` },

  // ══ Business / professional (16) ════════════════════════════════
  { name: "Wellfound", category: "business", build: (u) => `https://wellfound.com/u/${u}` },
  { name: "Crunchbase", category: "business", build: (u) => `https://www.crunchbase.com/person/${u}`,
    hard: true, errorPattern: "page not found|not found" },
  { name: "Calendly", category: "business", build: (u) => `https://calendly.com/${u}` },
  { name: "Gumroad", category: "business", build: (u) => `https://gumroad.com/${u}` },
  { name: "Patreon", category: "business", build: (u) => `https://www.patreon.com/${u}` },
  { name: "Buy Me a Coffee", category: "business", build: (u) => `https://www.buymeacoffee.com/${u}` },
  { name: "Ko-fi", category: "business", build: (u) => `https://ko-fi.com/${u}` },
  { name: "Liberapay", category: "business", build: (u) => `https://liberapay.com/${u}` },
  { name: "Open Collective", category: "business", build: (u) => `https://opencollective.com/${u}` },
  { name: "SubscribeStar", category: "business", build: (u) => `https://subscribestar.com/${u}` },
  { name: "Payhip", category: "business", build: (u) => `https://payhip.com/${u}`, hard: true },
  { name: "PayPal.me", category: "business", build: (u) => `https://paypal.me/${u}` },
  { name: "Webflow", category: "business", build: (u) => `https://webflow.com/${u}`, hard: true },
  { name: "Carrd", category: "business", build: (u) => `https://${u}.carrd.co` },

  // ══ Knowledge / education (16) ══════════════════════════════════
  { name: "Khan Academy", category: "knowledge", build: (u) => `https://www.khanacademy.org/profile/${u}`,
    hard: true },
  { name: "Codecademy", category: "knowledge", build: (u) => `https://www.codecademy.com/profiles/${u}` },
  { name: "Coursera", category: "knowledge", build: (u) => `https://www.coursera.org/user/${u}`, hard: true },
  { name: "edX", category: "knowledge", build: (u) => `https://www.edx.org/u/${u}`, hard: true },
  { name: "Udemy", category: "knowledge", build: (u) => `https://www.udemy.com/user/${u}` },
  { name: "Skillshare", category: "knowledge", build: (u) => `https://www.skillshare.com/profile/${u}`,
    hard: true },
  { name: "DataCamp", category: "knowledge", build: (u) => `https://www.datacamp.com/profile/${u}`,
    hard: true },
  { name: "ResearchGate", category: "knowledge", build: (u) => `https://www.researchgate.net/profile/${u}`,
    hard: true, errorPattern: "page not found|not found" },
  { name: "Academia.edu", category: "knowledge", build: (u) => `https://independent.academia.edu/${u}`,
    hard: true },
  { name: "Google Scholar", category: "knowledge", build: (u) => `https://scholar.google.com/citations?user=${u}`,
    errorPattern: "not found|does not exist" },
  { name: "Semantic Scholar", category: "knowledge", build: (u) => `https://www.semanticscholar.org/author/${u}`,
    hard: true },
  { name: "Zenodo", category: "knowledge", build: (u) => `https://zenodo.org/communities/${u}`, hard: true },
  { name: "Figshare", category: "knowledge", build: (u) => `https://figshare.com/authors/${u}`, hard: true },
  { name: "OpenReview", category: "knowledge", build: (u) => `https://openreview.net/profile?username=${u}`,
    hard: true },
  { name: "Speaker Deck", category: "knowledge", build: (u) => `https://speakerdeck.com/${u}` },
  { name: "GitBook", category: "knowledge", build: (u) => `https://${u}.gitbook.io`, hard: true },

  // ══ Messaging / identity (8) ════════════════════════════════════
  { name: "Line", category: "messaging", build: (u) => `https://line.me/R/ti/p/@${u}`, hard: true },
  { name: "Skype", category: "messaging", build: (u) => `https://join.skype.com/add/${u}`, hard: true },

  // ══ Finance / crypto (12) ═══════════════════════════════════════
  { name: "TradingView", category: "finance", build: (u) => `https://www.tradingview.com/u/${u}` },
  { name: "StockTwits", category: "finance", build: (u) => `https://stocktwits.com/${u}` },
  { name: "eToro", category: "finance", build: (u) => `https://www.etoro.com/people/${u}`, hard: true },
  { name: "Investing.com", category: "finance", build: (u) => `https://www.investing.com/${u}`, hard: true },
  { name: "Seeking Alpha", category: "finance", build: (u) => `https://seekingalpha.com/contributors/${u}`,
    hard: true },
  { name: "MarketWatch", category: "finance", build: (u) => `https://www.marketwatch.com/${u}`, hard: true },
  { name: "Binance", category: "finance", build: (u) => `https://www.binance.com/en/feed/profile/${u}`,
    hard: true },
  { name: "CoinMarketCap", category: "finance", build: (u) => `https://coinmarketcap.com/${u}`, hard: true },
  { name: "CoinGecko", category: "finance", build: (u) => `https://www.coingecko.com/en/${u}`, hard: true },
  { name: "OpenSea", category: "finance", build: (u) => `https://opensea.io/${u}`, hard: true },
  { name: "Etherscan", category: "finance", build: (u) => `https://etherscan.io/name/${u}.eth`,
    errorPattern: "not found|no records found" },
  { name: "ENS App", category: "finance", build: (u) => `https://app.ens.domains/${u}.eth`,
    errorPattern: "not found" },

  // ══ Shopping / reviews (10) ═════════════════════════════════════
  { name: "Depop", category: "shopping", build: (u) => `https://www.depop.com/${u}` },
  { name: "Etsy", category: "shopping", build: (u) => `https://www.etsy.com/shop/${u}`, hard: true },
  { name: "eBay", category: "shopping", build: (u) => `https://www.ebay.com/str/${u}`, hard: true },
  { name: "Poshmark", category: "shopping", build: (u) => `https://poshmark.com/${u}`, hard: true },
  { name: "Vinted", category: "shopping", build: (u) => `https://www.vinted.com/member/${u}`, hard: true },
  { name: "Grailed", category: "shopping", build: (u) => `https://www.grailed.com/${u}`, hard: true },
  { name: "StockX", category: "shopping", build: (u) => `https://stockx.com/users/${u}`, hard: true },
  { name: "Yelp", category: "shopping", build: (u) => `https://www.yelp.com/user_details?user_id=${u}`,
    hard: true },
  { name: "TripAdvisor", category: "shopping", build: (u) => `https://www.tripadvisor.com/Profile/${u}`,
    hard: true },
  { name: "Trustpilot", category: "shopping", build: (u) => `https://www.trustpilot.com/users/${u}`,
    hard: true },

  // ══ Misc / tools (10) ═══════════════════════════════════════════
  { name: "Pastebin", category: "other", build: (u) => `https://pastebin.com/u/${u}` },
  { name: "Urlscan.io", category: "other", build: (u) => `https://urlscan.io/user/${u}` },
  { name: "VirusTotal", category: "other", build: (u) => `https://www.virustotal.com/gui/user/${u}` },
];

/** Deduplicate entries that intentionally share a URL pattern (e.g. Reddit twice). */
const seen = new Set<string>();
export const SITE_CATALOG: SiteDef[] = SITES.filter((s) => {
  const key = `${s.name}|${s.build("__probe__")}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

export function buildUrl(site: SiteDef, username: string): string {
  return site.build(username);
}

export function findSites(names: string[]): SiteDef[] | null {
  if (!names || names.length === 0) return null;
  const byName = new Map(SITE_CATALOG.map((s) => [s.name, s]));
  const out: SiteDef[] = [];
  for (const n of names) {
    const s = byName.get(String(n));
    if (s) out.push(s);
  }
  return out.length > 0 ? out : null;
}
