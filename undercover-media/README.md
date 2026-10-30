# UnderCover Media

A complete newsroom product: a broadcast-grade news site, a live radio presence,
and a staff-only CMS — "Studio" — with a real Postgres database behind it.

**Live:** <https://undercover-media.vercel.app>
**Studio:** <https://undercover-media.vercel.app/admin/>

---

## What is in the box

| Piece | Where | What it does |
| --- | --- | --- |
| Public site | `public/` (40+ pages) | Dense news front page, section desks, articles, Watch, Listen, About |
| Newsroom CMS | `/admin/` | Auth, story editor, broadcast, media library, audience, settings, publishing |
| Database | Supabase `ayiqeykdcsgwtickgqyc` | Postgres + row-level security + storage + auth |
| Generator | `build.py` | Turns the database into static HTML, CSS, JSON and sitemaps |
| Design system | `src/css/style.css` | Black / white / signal-red, mobile-first, ~2.9k lines |
| Motion + behaviour | `src/js/app.js` | Player, search, drawers, tabs, read-aloud |

### The editorial product
- Front page: lead story, latest rail, on-air card, ticker, section desks,
  "most read", newsletter, video rail, opinion.
- Article pages: dateline, byline, share rail, **read-aloud** (Web Speech API),
  reading progress, related links, structured data.
- Watch: video rail and modal player with per-video metadata.
- Listen: on-air hero, player bar, frequency table, tabbed schedule, presenters, podcasts.
- Mobile-first throughout, keyboard accessible, `prefers-reduced-motion` respected.

### The Studio (admin)
| Screen | Capability |
| --- | --- |
| Overview | Published/draft counts, reads, subscribers, open messages, recent edits, last build |
| Stories | Search + filter, full editor (headline, standfirst, block body, tags, lead image, SEO, flags) |
| Media library | Drag-and-drop upload to Supabase Storage, copy URL, delete |
| Videos / Shows / Schedule / Podcasts / Presenters | Full CRUD |
| Ticker | The breaking-news line, ordered and toggled |
| Newsletter / Inbox | Subscriber list with CSV export; contact messages with "handled" state |
| Settings | Station identity, stream URL, deploy hook, publish button |

Every write is attributed and logged to `activity_log`.

---

## Architecture

```
 Supabase Postgres  ──►  build.py (python3)  ──►  static HTML on Vercel
   ▲        ▲                  ▲
   │        │                  │ env: SUPABASE_URL / SUPABASE_ANON_KEY
   │        └── Supabase Auth  │      (or src/site.config.json)
   │                           │
   └──── Studio (/admin) ──────┘
         supabase-js in the browser, RLS enforced by Postgres
```

- The **public site is pre-rendered**, so it is fast, crawlable and cheap to host.
- The **CMS is live** — saving a story writes to Postgres immediately.
- **Publishing** is a rebuild: press *Publish site* (or push to `main`) and Vercel
  re-runs `python3 build.py`, which reads the database and regenerates the pages.
- If the database is unreachable at build time, the generator falls back to
  `content.py`, so a fresh clone always builds.

### Security model
- `anon` can read **published** content only; drafts, subscribers and messages are invisible.
- All writes require a row in `staff` (`is_staff()`), enforced by RLS — not by the UI.
- The browser only ever holds the **anon** key. The service-role key stays out of the repo.
- Storage: public read, staff-only write, in the `media` bucket.

---

## Run it

```bash
cd undercover-media
python3 build.py          # writes public/
python3 build.py --serve  # build + preview on http://localhost:8080
```

No dependencies: the generator is stdlib-only Python 3.11+.

```bash
# build from the live database instead of content.py
export SUPABASE_URL="https://ayiqeykdcsgwtickgqyc.supabase.co"
export SUPABASE_ANON_KEY="…"          # public key, safe in a browser
python3 build.py
cat public/assets/build.json          # {"source": "supabase", …}
```

To force the bundled content instead: `CONTENT_SOURCE=local python3 build.py`.

---

## Studio

Sign in at `/admin/` with a staff account. The first account is created during
setup; **change its password in Supabase → Authentication → Users** before handing
the site to a client. Additional staff are added to `auth.users`, then given a row in
`public.staff` (see `db/01_schema.sql`).

Typical flow:

1. **Stories → + New story** — write, set section, author, tags, lead image.
2. Set **Status: published** and a publish date.
3. Press **Publish site** (needs `publishing → deploy_hook`, see below) or push to `main`.
4. The build reads the database, and the front page updates in about a minute.

### Connecting the publish button
Vercel → Project → Settings → Git → Deploy Hooks → create one for `main`.
Paste the URL into **Studio → Settings → Publishing → deploy_hook** and save.
The button then triggers a rebuild for anyone on staff.

### Live radio
Set **Settings → Live → stream_url** to an Icecast/AAC/HLS URL. The player bar and
the Listen page pick it up on the next build. Until then the player runs in demo mode.

---

## Database

Schema and policies live in `db/01_schema.sql`; the importer is `db/02_import.sql`.

| Table | Rows | Notes |
| --- | --- | --- |
| `stories` | 30 | body is JSON blocks: `p`, `h2`, `h3`, `quote`, `ul`, `ol` |
| `sections` / `authors` | 5 / 8 | taxonomy |
| `videos` / `shows` / `schedule_slots` | 7 / 8 / 21 | broadcast slate |
| `podcasts` / `presenters` / `ticker_items` | 5 / 4 / 4 | radio experience |
| `settings` | 3 | station, live, publishing (public/private per row) |
| `media` / `subscribers` / `messages` / `activity_log` | — | CMS operations |

**Re-seeding:** `build.py` writes `public/assets/seed.json` from `content.py`.
Import it with:

```sql
select public.import_seed(content::jsonb) from net._http_response where id = <request>;
```

(or paste the JSON into `select public.import_seed('…'::jsonb)`).

---

## Design system

| Token | Value |
| --- | --- |
| Ink | `#0b0b0c` |
| Paper | `#f6f5f2` |
| Signal red | `#e10600` (`--red-2` `#b80400`, `--red-d` `#ff2d1f`) |
| Type | Archivo Variable (UI/headlines) · Newsreader Variable (editorial) |
| Station | 96.4 FM Kampala · 104.1 Gulu · 91.7 Mbarara · DStv 893 |

Layout language: masthead + ticker, rule-led section heads, dense multi-column
desks, side rails for "most read" and "on air", red used only for signal.

---

## Deploy

Vercel project **undercover-media** — root `undercover-media`,
build `python3 build.py`, output `public`.

```bash
python3 build.py
git add -A && git commit -m "Publish"
git push                     # branch → preview; main → production
```

---

## Handover checklist

- [ ] Change the starter staff password; add real staff rows.
- [ ] Point the `deploy_hook` at the client's Vercel project.
- [ ] Connect a stream URL and the real frequencies.
- [ ] Replace the placeholder video URLs in **Videos**.
- [ ] Swap the stock imagery for the client's photography (`src/images/`).
- [ ] Add the client's domain in Vercel → Domains.
- [ ] Export `subscribers` before migrating ESPs.

---

*Demo content, presenters and companies are fictional. Built with the standard
library, Supabase and Vercel — no framework lock-in.*
