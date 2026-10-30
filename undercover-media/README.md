# UnderCover Media

**The story beneath the story.**
A complete, responsive news-and-radio website for a Ugandan media house — the newsroom
depth of a daily paper, the multimedia surfaces of a TV station, and the always-on
presence of an FM radio brand.

Black, white and red. Built by hand, no frameworks, no trackers, no external requests.

---

## Live deployment

- **Production:** <https://undercover-media.vercel.app>
- **Vercel project:** `undercover-media` (team *fredscottswork-1879's projects*)
- **Root directory:** `undercover-media/public` — no build step, the generated
  files are served as-is; `src/vercel.json` ships with the output
- Pushes to the branch/main trigger a fresh deployment; `public/` must be rebuilt
  and committed (`python3 build.py`) before pushing content changes

## Run it

```bash
cd undercover-media
python3 build.py          # generates public/
python3 build.py --serve  # generates and serves on http://0.0.0.0:8080
```

Any static server works — the output in `public/` has no build dependencies:

```bash
cd public && python3 -m http.server 8080
```

Deploy by uploading `public/` to Netlify, Vercel, Cloudflare Pages, GitHub Pages,
S3 or any web server. Builds only need Python 3.10+ and the standard library.

---

## What's in the box

| Page | File | What it does |
| --- | --- | --- |
| Front page | `index.html` | Lead story + latest rail, top stories, on-air band, business, sport, watch, entertainment, opinion, most-read, newsletter |
| Sections | `news.html`, `business.html`, `sports.html`, `entertainment.html`, `opinion.html` | Section hero, lead story, most-read rail, story grid, cross-links |
| Articles | `<slug>/index.html` (30 pages) | Kicker, headline, standfirst, byline, drop cap, pull quotes, tags, author box, sticky sidebar, related stories, reading progress, share |
| Watch | `watch.html` | Featured film, latest video grid, live TV, programme strands, video lightbox |
| Listen | `listen.html` | Live radio hero, tabbed programme guide, presenters, podcasts, frequencies |
| About | `about.html` | Mission, editorial standards, team, contact, advertise |
| Extras | `404.html`, `sitemap.xml`, `robots.txt`, `assets/search-index.json` | — |

### Radio, front and centre

- A **Listen Live** button sits in the masthead of every page, in the mobile menu, in the
  home shortcuts strip, in the front-page on-air panel and in the article sidebar.
- Pressing it opens a **docked player** (fixed to the bottom of the viewport) with play/pause,
  a live equaliser, show and presenter metadata, volume and a close button. It is keyboard
  accessible, traps nothing, and is `inert` while closed.
- The Listen page adds a full **programme guide** with weekday/Saturday/Sunday tabs and the
  show currently on air marked with a pulsing dot.

By default the player runs in **demo mode** (animated, no audio) because no stream is
connected yet. To go live, set one line in `src/js/app.js`:

```js
const STREAM_URL = "https://stream.example.com/undercover-96.4.mp3";
```

An Icecast/Shoutcast MP3 or AAC URL is enough. The player uses the native `Audio`
element, so HLS (`.m3u8`) needs a browser that supports it natively.

---

## Brand identity

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#0B0B0C` | Text, broadcast bands, footer |
| Paper | `#FFFFFF` / `#F6F5F2` | Backgrounds and quiet bands |
| Signal red | `#E10600` | Kickers, live states, the Listen button, rules |
| Type — display | Archivo (variable, wght 100–900, wdth 62–125%) | Headlines, navigation, metadata |
| Type — body | Newsreader (variable, optical size axis) | Article text, standfirsts, pull quotes |

The mark is a white **U** on black with a red rule underneath — an *underline* for
**undercover**. The same red square/rule motif repeats in section headers, list bullets,
drop caps and the live dot, so the site reads as one brand across news, TV and radio.

Both typefaces are self-hosted WOFF2 files in `src/fonts/` (subset to Latin). Nothing is
fetched from Google Fonts or any third-party CDN.

### Layout language

- Newspaper column rules (1px hairlines) instead of cards floating on grey.
- A single 1320px grid, with 3-column story bands and 2-column split blocks.
- Black broadcast bands break the page rhythm and give audio/video their own space.
- Sharp corners, heavy condensed headlines, generous serif body text.
- Mobile-first breakpoints at 1180 / 1024 / 900 / 720 / 400px; the masthead compacts on
  scroll and collapses to logo + Listen + menu on phones.

---

## Editing content

Everything editorial lives in **`content.py`**:

- `SECTIONS`, `AUTHORS`, `STORIES` (headline, standfirst, body blocks, tags, images)
- `TICKER`, `MOST_READ`, `HOMEPAGE` curation
- `VIDEOS`, `SHOWS`, `PODCASTS`, `PRESENTERS`, `SCHEDULE_TABS`
- `LIVE_NOW`, `NEWSLETTER`, `BRAND`

Body blocks are tuples: `("p", text)`, `("h2", text)`, `("quote", (text, attribution))`
and `("ul", [items])`. Add a story to `STORIES`, rebuild, and it appears in its section,
in search and in the sitemap automatically.

### Images

Source photographs live in `src/images/` (originals) with pre-optimised `src/images/opt/`
variants at 1400/700px (900/450 for portraits). The build copies only the optimised files
into `public/assets/img/`. Cards use `srcset`, explicit `width`/`height`, lazy loading and
`fetchpriority="high"` on the lead image only.

To swap in your own photography, drop files in `src/images/`, regenerate the two widths
with ImageMagick, and update the image name in `content.py`:

```bash
cd src/images
convert photo.jpg -resize 1400x -strip -interlace Plane -quality 82 opt/photo-1400.jpg
convert photo.jpg -resize 700x  -strip -interlace Plane -quality 80 opt/photo-700.jpg
```

---

## Interaction, without a framework

`src/js/app.js` is ~400 lines of vanilla ES2015+, loaded with `defer`:

- Sticky masthead that compacts on scroll
- Mobile drawer with scrim, `inert` handling and `Escape` support
- Full-screen search over a generated `search-index.json` (weighted title/standfirst/tag
  matching, `/` to open, `Esc` to close)
- Docked radio player and Listen buttons wired from one `data-radio-toggle` hook
- Video lightbox (`<dialog>`) populated from `data-*` attributes
- Programme-guide tabs, relative timestamps ("2h ago"), copy-link sharing, reading
  progress, back-to-top and form feedback toasts

The site is fully readable with JavaScript disabled: all stories, navigation and
schedules are static HTML. JavaScript only adds layers on top.

## Accessibility & performance

- Landmarks (`header`, `nav`, `main`, `aside`, `footer`), a skip link, one `h1` per page,
  visible red focus rings and labelled icon buttons.
- Decorative SVGs are `aria-hidden`; off-screen chrome is `inert` until opened.
- `prefers-reduced-motion` switches off the ticker marquee, equalisers and transitions.
- No third-party scripts, fonts, analytics or iframes — one CSS file, one JS file, local
  fonts, compressed JPEGs.
- Print stylesheet strips the chrome for a clean article print.

---

## Project layout

```
undercover-media/
├── content.py            # all editorial content and site copy
├── build.py              # static generator: pages, sitemap, search index
├── src/
│   ├── css/style.css     # design system (~2.6k lines)
│   ├── js/app.js         # interaction layer
│   ├── fonts/            # self-hosted variable fonts
│   ├── images/           # originals + opt/ resized variants
│   └── favicon.svg
└── public/               # generated site — deploy this folder
```

---

## Note on the content

This is a **design prototype**. Every story, name, presenter, schedule, frequency and
photograph in the build is illustrative and does not report real events. Swap in real
reporting, real presenters and licensed photography before publishing. The site says as
much in its footer and in the video player.
