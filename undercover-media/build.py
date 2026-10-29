#!/usr/bin/env python3
"""Static site builder for the UnderCover Media prototype.

    python3 build.py          # build into ./public
    python3 build.py --serve  # build, then serve on http://0.0.0.0:8080

Content lives in content.py; visuals in src/; generated pages in public/.
"""

from __future__ import annotations

import html
import json
import shutil
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

import content as C

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
SRC = ROOT / "src"
SITE_URL = "https://undercover.media/"
BUILD_DATE = date.today()

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def long_date(d) -> str:
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def long_datetime(d) -> str:
    return f"{long_date(d)}, {d.strftime('%H:%M')}"


def clock(d) -> str:
    return d.strftime("%H:%M")


def dateline() -> str:
    return f"{DAYS[BUILD_DATE.weekday()]}, {BUILD_DATE.day} {MONTHS[BUILD_DATE.month - 1]} {BUILD_DATE.year}"


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def img(name: str, alt: str, base: str = "", sizes: str = "(max-width: 720px) 100vw, 33vw",
        eager: bool = False, cls: str = "") -> str:
    portrait = name.startswith("portrait")
    large, small = (900, 450) if portrait else (1400, 700)
    w, h = (900, 1264) if portrait else (1400, 768)
    src = f"{base}assets/img/{name}-{small}.jpg"
    srcset = f"{base}assets/img/{name}-{small}.jpg {small}w, {base}assets/img/{name}-{large}.jpg {large}w"
    loading = "eager" if eager else "lazy"
    extra = ' fetchpriority="high"' if eager else ""
    klass = f' class="{cls}"' if cls else ""
    return (f'<img src="{src}" srcset="{srcset}" sizes="{sizes}" width="{w}" height="{h}" '
            f'alt="{esc(alt)}" loading="{loading}" decoding="async"{extra}{klass}>')


# ---------------------------------------------------------------------------
# Icons
# ---------------------------------------------------------------------------

ICON_PATHS = {
    "search": '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
    "menu": '<path d="M3 6h18M3 12h18M3 18h18"/>',
    "close": '<path d="M5 5l14 14M19 5 5 19"/>',
    "play": '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    "pause": '<path d="M8 4.5v15M16 4.5v15" stroke-width="3.4"/>',
    "headphones": '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/>'
                  '<path d="M4 14h2.5v6H5.5A1.5 1.5 0 0 1 4 18.5zM20 14h-2.5v6h1A1.5 1.5 0 0 0 20 18.5z"/>',
    "arrow-right": '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
    "arrow-up": '<path d="M12 20V4"/><path d="M5 11l7-7 7 7"/>',
    "arrow-up-right": '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    "chevron-right": '<path d="M9 5l7 7-7 7"/>',
    "volume": '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.4 2"/>',
    "mail": '<rect x="3" y="5" width="18" height="14"/><path d="m3.5 6 8.5 7 8.5-7"/>',
    "pin": '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    "phone": '<path d="M6 3h3l2 5-2.4 1.6a12 12 0 0 0 5.8 5.8L16 13l5 2v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6 3z"/>',
    "share": '<circle cx="18" cy="5.5" r="2.6"/><circle cx="6" cy="12" r="2.6"/>'
             '<circle cx="18" cy="18.5" r="2.6"/><path d="M8.3 10.7 15.7 6.8M8.3 13.3l7.4 3.9"/>',
    "link": '<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.8 6"/>'
            '<path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
    "facebook": '<path d="M14.5 8.5h2.5V5h-2.7C11.6 5 10 6.8 10 9.4V11H7.5v3.5H10V21h3.6v-6.5H16l.6-3.5h-3v-1.3c0-.8.3-1.2 1.4-1.2z" fill="currentColor" stroke="none"/>',
    "x": '<path d="M4 4l16 16M20 4 4 20"/>',
    "instagram": '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r="1.2" fill="currentColor" stroke="none"/>',
    "youtube": '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M11 9.5 15.5 12 11 14.5z" fill="currentColor" stroke="none"/>',
    "whatsapp": '<path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.4-4.3a8.5 8.5 0 1 1 15.6-4.6z"/>'
                '<path d="M8.8 8.3c.3-.5.6-.5.9-.5h.7c.2 0 .5.1.6.5l.8 1.8c.1.2 0 .5-.1.7l-.6.7c-.1.1-.2.3-.1.5.4.8 1.4 1.8 2.4 2.2.2.1.4 0 .5-.1l.7-.7c.2-.2.4-.2.6-.1l1.8.8c.3.1.4.4.4.6v.7c0 .6-.4 1.2-1 1.4-.6.2-1.6.3-3.6-.7a11 11 0 0 1-4.6-4.5c-.8-1.5-.7-2.6-.4-3.3z" fill="currentColor" stroke="none"/>',
    "radio": '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>'
             '<path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    "tv": '<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="m8 2.5 4 3.5 4-3.5"/>',
    "mic": '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    "calendar": '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 2.8V6M16 2.8V6"/>',
    "check": '<path d="m4.5 12.5 4.5 4.5L19.5 6.5"/>',
    "external": '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
}


def icon(name: str, size: int = 16, cls: str = "icon") -> str:
    return (f'<svg class="{cls}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
            f'aria-hidden="true">{ICON_PATHS[name]}</svg>')


def sprite() -> str:
    symbols = "".join(
        f'<symbol id="i-{name}" viewBox="0 0 24 24">{paths}</symbol>'
        for name, paths in ICON_PATHS.items()
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">{symbols}</svg>'


# ---------------------------------------------------------------------------
# Shared chrome
# ---------------------------------------------------------------------------

NAV = [
    ("home", "Home", "index.html"),
    ("news", "News", "news.html"),
    ("business", "Business", "business.html"),
    ("sports", "Sports", "sports.html"),
    ("entertainment", "Entertainment", "entertainment.html"),
    ("opinion", "Opinion", "opinion.html"),
    ("watch", "Watch", "watch.html"),
    ("listen", "Listen", "listen.html"),
]

SOCIALS = [
    ("Facebook", "facebook", "https://facebook.com/"),
    ("X", "x", "https://x.com/"),
    ("Instagram", "instagram", "https://instagram.com/"),
    ("YouTube", "youtube", "https://youtube.com/"),
]

BRAND_MARK = (
    '<svg class="brand__mark" viewBox="0 0 64 64" role="img" aria-label="UnderCover Media">'
    '<rect width="64" height="64" fill="#0B0B0C"/>'
    '<path d="M19 13v18a13 13 0 0 0 26 0V13" fill="none" stroke="#fff" stroke-width="6"/>'
    '<rect x="14" y="50" width="36" height="5" fill="#E10600"/>'
    "</svg>"
)


def listen_button(base: str, cls: str = "btn-listen", label: str = "Listen Live") -> str:
    return (
        f'<button class="{cls}" type="button" data-radio-toggle aria-pressed="false" '
        f'aria-label="Listen live to UnderCover Radio">'
        f'{icon("headphones", 17)}<span>{label}</span>'
        f'<span class="btn-listen__state"><span class="live-dot"></span>'
        f'<span data-listen-label>On air</span></span></button>'
    )


def header(active: str, base: str) -> str:
    nav_links = []
    for slug, label, href in NAV:
        current = ' aria-current="page"' if slug == active else ""
        nav_links.append(f'<a href="{base}{href}"{current}>{label}</a>')
    drawer_links = []
    for slug, label, href in NAV:
        current = ' aria-current="page"' if slug == active else ""
        drawer_links.append(
            f'<a href="{base}{href}"{current}>{label}{icon("chevron-right", 16)}</a>'
        )
    social = "".join(
        f'<a href="{url}" aria-label="{name}" rel="noopener">{icon(glyph, 14)}</a>'
        for name, glyph, url in SOCIALS
    )
    return f"""
<div class="topbar">
  <div class="wrap topbar__inner">
    <p class="topbar__date" style="margin:0"><b>{dateline()}</b> &nbsp;·&nbsp; {C.BRAND['city']}</p>
    <nav class="topbar__nav" aria-label="Secondary">
      <a class="topbar__live" href="{base}listen.html"><span class="live-dot"></span> On air now</a>
      <a href="{base}about.html">About</a>
      <a href="{base}about.html#contact">Contact</a>
      <a href="{base}about.html#advertise">Advertise</a>
    </nav>
    <div class="topbar__social">{social}</div>
  </div>
</div>

<header class="site-head" id="site-head">
  <div class="masthead">
    <div class="wrap masthead__inner">
      <a class="brand" href="{base}index.html" aria-label="UnderCover Media — home">
        {BRAND_MARK}
        <span class="brand__type">
          <span class="brand__name">Under<em>cover</em></span>
          <span class="brand__sub">Media</span>
        </span>
      </a>
      <p class="masthead__tag">{C.BRAND['tagline']}</p>
      <div class="masthead__actions">
        <button class="icon-btn icon-btn--search" type="button" data-search-open aria-label="Search UnderCover Media">{icon("search", 18)}</button>
        {listen_button(base)}
        <button class="icon-btn icon-btn--menu" type="button" data-drawer-open aria-label="Open menu" aria-controls="drawer" aria-expanded="false">{icon("menu", 20)}</button>
      </div>
    </div>
  </div>
  <nav class="nav" aria-label="Primary">
    <div class="wrap nav__inner">
      {''.join(nav_links)}
      <span class="nav__spacer"></span>
      <a class="nav__live" href="{base}watch.html">{icon("tv", 15)} UnderCover TV</a>
    </div>
  </nav>
</header>
"""


def ticker() -> str:
    items = "".join(
        f'<span class="ticker__item"><b>{esc(label)}</b>{esc(text)}</span>'
        for label, text in C.TICKER
    )
    return f"""
<div class="ticker" aria-label="Breaking news">
  <span class="ticker__label"><span class="live-dot"></span> {BUILD_DATE.day} {MONTHS[BUILD_DATE.month - 1][:3]} · Live</span>
  <div class="ticker__track">
    <div class="ticker__move">{items}{items}</div>
  </div>
</div>
"""


def drawer(active: str, base: str) -> str:
    links = []
    for slug, label, href in NAV:
        current = ' aria-current="page"' if slug == active else ""
        links.append(f'<a href="{base}{href}"{current}>{label}{icon("chevron-right", 16)}</a>')
    return f"""
<div class="drawer" id="drawer" aria-hidden="true">
  <div class="drawer__scrim" data-drawer-close></div>
  <div class="drawer__panel" role="dialog" aria-modal="true" aria-label="Site menu">
    <div class="drawer__head">
      <span class="brand__name" style="font-size:18px">Under<em style="font-style:normal;color:var(--red)">cover</em></span>
      <button class="icon-btn" type="button" data-drawer-close aria-label="Close menu">{icon("close", 18)}</button>
    </div>
    <nav class="drawer__nav" aria-label="Mobile">{''.join(links)}</nav>
    <div class="drawer__cta">
      {listen_button(base, cls="btn btn--block", label="Listen Live")}
      <button class="btn btn--ghost btn--block" type="button" data-search-open style="margin-top:10px">{icon("search", 16)} Search</button>
    </div>
    <div class="drawer__foot">
      <a href="{base}about.html">About UnderCover</a>
      <a href="{base}about.html#contact">Contact the newsroom</a>
      <a href="{base}about.html#advertise">Advertise</a>
      <p style="margin-top:18px">96.4 FM Kampala<br>{C.BRAND['email']}</p>
    </div>
  </div>
</div>
"""


def search_overlay(base: str) -> str:
    terms = ["Budget", "Cranes", "Coffee", "Kampala", "Radio"]
    chips = "".join(f'<button type="button" data-search-term="{t}">{t}</button>' for t in terms)
    return f"""
<div class="search" id="search" role="dialog" aria-modal="true" aria-label="Search UnderCover Media" aria-hidden="true" hidden>
  <div class="wrap">
    <div class="search__bar">
      {icon("search", 26)}
      <input id="search-input" type="search" placeholder="Search stories, people, places…" autocomplete="off" aria-label="Search stories">
      <button class="search__close" type="button" data-search-close aria-label="Close search">{icon("close", 18)}</button>
    </div>
    <div class="search__hint"><span>Popular</span>{chips}</div>
    <div class="search__results" id="search-results"></div>
  </div>
</div>
"""


def player(base: str) -> str:
    live = C.LIVE_NOW
    bars = "".join("<i></i>" for _ in range(8))
    return f"""
<aside class="player" id="player" aria-label="UnderCover Radio live player" aria-hidden="true">
  <div class="player__inner">
    <button class="player__btn" type="button" aria-label="Play live radio" aria-pressed="false">
      <svg class="icon-play" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>
      <svg class="icon-pause" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5v15M16 4.5v15" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>
    </button>
    <div class="player__meta">
      <div class="player__now"><span class="live-dot"></span> Live · UnderCover Radio</div>
      <div class="player__show">{esc(live['show'])}</div>
      <div class="player__host">with {esc(live['host'])} · {esc(C.BRAND['frequency'])}</div>
    </div>
    <div class="player__wave" aria-hidden="true">{bars}</div>
    <div class="player__actions">
      <div class="player__vol">
        {icon("volume", 15)}
        <input id="player-volume" type="range" min="0" max="100" value="80" aria-label="Volume">
      </div>
      <button class="player__close" type="button" aria-label="Close player">{icon("close", 14)}</button>
    </div>
  </div>
</aside>
"""


def video_modal() -> str:
    return f"""
<dialog class="video-modal" id="video-modal" aria-label="Video player">
  <button class="video-modal__close" type="button" data-video-close aria-label="Close video">{icon("close", 16)}</button>
  <div class="video-modal__media">
    <img id="video-modal-image" src="" alt="" width="1400" height="768">
    <div class="video-modal__overlay">
      <div class="video-card__play"><span>{icon("play", 15)}</span></div>
      <p class="video-modal__note"><b>Playback is not connected in this prototype.</b>
      The player, artwork and metadata are wired and ready — connect an HLS, Mux or Vimeo
      endpoint to take it live.</p>
    </div>
  </div>
  <div class="video-modal__body">
    <div>
      <span class="kicker" id="video-modal-show"></span>
      <h3 id="video-modal-title"></h3>
    </div>
    <span class="video-modal__dur" id="video-modal-duration"></span>
  </div>
</dialog>
"""


def footer(base: str) -> str:
    sections = "".join(
        f'<li><a href="{base}{slug}.html">{C.SECTIONS[slug]["name"]}</a></li>'
        for slug in C.SECTION_ORDER
    )
    social = "".join(
        f'<a href="{url}" aria-label="{name}" rel="noopener">{icon(glyph, 15)}</a>'
        for name, glyph, url in SOCIALS
    )
    return f"""
<footer class="footer">
  <div class="wrap">
    <div class="footer__top">
      <div class="footer__brand">
        <a class="brand" href="{base}index.html" aria-label="UnderCover Media — home">
          {BRAND_MARK}
          <span class="brand__type">
            <span class="brand__name">Under<em>cover</em></span>
            <span class="brand__sub">Media</span>
          </span>
        </a>
        <p class="footer__tagline">{C.BRAND['tagline']}</p>
        <div class="footer__social">{social}</div>
      </div>
      <div>
        <h3>Sections</h3>
        <ul>{sections}<li><a href="{base}watch.html">Watch</a></li><li><a href="{base}listen.html">Listen</a></li></ul>
      </div>
      <div>
        <h3>The station</h3>
        <ul>
          <li><a href="{base}listen.html">Live radio</a></li>
          <li><a href="{base}listen.html#schedule">Programme guide</a></li>
          <li><a href="{base}listen.html#podcasts">Podcasts</a></li>
          <li><a href="{base}watch.html">UnderCover TV</a></li>
          <li><a href="{base}listen.html#presenters">Presenters</a></li>
        </ul>
      </div>
      <div>
        <h3>Newsroom</h3>
        <ul class="footer__contact">
          <li>{icon("pin", 14)}<span>{C.BRAND['studio']}</span></li>
          <li>{icon("mail", 14)}<span><a href="mailto:{C.BRAND['email']}">{C.BRAND['email']}</a></span></li>
          <li>{icon("phone", 14)}<span><a href="tel:{C.BRAND['phone'].replace(' ', '')}">{C.BRAND['phone']}</a></span></li>
          <li>{icon("radio", 14)}<span>{C.BRAND['frequency']}</span></li>
        </ul>
      </div>
    </div>
    <div class="footer__note">
      UnderCover Media is a design prototype. Stories, names, presenters, schedules and
      imagery in this build are illustrative and do not report real events. Any resemblance
      to actual reporting is coincidental.
    </div>
    <div class="footer__bottom">
      <span>© {BUILD_DATE.year} UnderCover Media. All rights reserved.</span>
      <nav aria-label="Legal">
        <a href="{base}about.html">About</a>
        <a href="{base}about.html#standards">Editorial standards</a>
        <a href="{base}about.html#contact">Contact</a>
        <a href="{base}about.html#advertise">Advertise</a>
      </nav>
    </div>
  </div>
</footer>
"""


def layout(title: str, description: str, active: str, main: str, base: str = "",
           og_image: str = "hero-politics", with_ticker: bool = True,
           jsonld: dict | None = None, body_class: str = "") -> str:
    tick = ticker() if with_ticker else ""
    ld = ""
    if jsonld:
        ld = f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="#0B0B0C">
<meta property="og:type" content="website">
<meta property="og:site_name" content="UnderCover Media">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:image" content="{SITE_URL}assets/img/{og_image}-1400.jpg">
<meta property="og:url" content="{SITE_URL}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{base}assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="{base}assets/fonts/archivo-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{base}assets/fonts/newsreader-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{base}assets/css/style.css">
<script defer src="{base}assets/js/app.js"></script>
{ld}
</head>
<body data-base="{base}" class="{body_class}">
<a class="skip-link" href="#main">Skip to content</a>
{sprite()}
{header(active, base)}
{tick}
<main id="main">
{main}
</main>
{footer(base)}
{player(base)}
{search_overlay(base)}
{drawer(active, base)}
{video_modal()}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<button class="to-top" type="button" aria-label="Back to top">{icon("arrow-up", 16)}</button>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Component helpers
# ---------------------------------------------------------------------------

def section_name(slug: str) -> str:
    return C.SECTIONS[slug]["name"]


def author_of(story: dict) -> dict:
    return C.AUTHORS[story["author"]]


def story_url(story: dict) -> str:
    return f"{story['slug']}/"


def story_card(story: dict, base: str, extra: str = "", show_deck: bool = True,
               eager: bool = False, sizes: str = "(max-width: 720px) 100vw, (max-width: 1024px) 46vw, 31vw") -> str:
    author = author_of(story)
    deck = f'<p class="card__deck">{esc(story["deck"])}</p>' if show_deck else ""
    return f"""
<article class="card {extra}">
  <a class="card__media" href="{base}{story_url(story)}" tabindex="-1" aria-hidden="true">
    {img(story['image'], story['caption'], base, sizes, eager)}
  </a>
  <div class="card__body">
    <span class="kicker">{esc(story['kicker'])}</span>
    <h3 class="card__title"><a href="{base}{story_url(story)}">{esc(story['title'])}</a></h3>
    {deck}
    <div class="meta" style="margin-top:9px">
      <span>{esc(author['name'])}</span><i class="dot"></i>
      <time datetime="{story['published'].isoformat()}" data-rel>{long_date(story['published'])}</time>
    </div>
  </div>
</article>
"""


def story_row(story: dict, base: str) -> str:
    return f"""
<article class="story-row">
  <a class="story-row__media" href="{base}{story_url(story)}" tabindex="-1" aria-hidden="true">
    {img(story['image'], story['caption'], base, "112px", False)}
  </a>
  <div>
    <span class="kicker">{esc(story['kicker'])}</span>
    <h4><a href="{base}{story_url(story)}">{esc(story['title'])}</a></h4>
    <div class="meta"><time datetime="{story['published'].isoformat()}" data-rel>{long_date(story['published'])}</time></div>
  </div>
</article>
"""


def opinion_card(story: dict, base: str) -> str:
    author = author_of(story)
    return f"""
<article class="opinion-card">
  <div class="opinion-card__author">
    <span class="avatar">{esc(author['initials'])}</span>
    <div>
      <div class="opinion-card__name">{esc(author['name'])}</div>
      <div class="opinion-card__role">{esc(author['role'])}</div>
    </div>
  </div>
  <p class="opinion-card__quote"><a href="{base}{story_url(story)}">“{esc(story['title'])}”</a></p>
  <p class="opinion-card__excerpt">{esc(story['deck'])}</p>
</article>
"""


def most_read(base: str, slugs: list[str], limit: int = 6) -> str:
    items = "".join(
        f'<li class="most__item"><h3><a href="{base}{story_url(C.STORY_BY_SLUG[s])}">'
        f'{esc(C.STORY_BY_SLUG[s]["title"])}</a></h3></li>'
        for s in slugs[:limit] if s in C.STORY_BY_SLUG
    )
    return f'<ol class="most__list">{items}</ol>'


def video_card(v: dict, base: str, featured: bool = False) -> str:
    return f"""
<a class="video-card" href="#" data-video data-title="{esc(v['title'])}" data-show="{esc(v['show'])}"
   data-image="{esc(v['image'])}" data-duration="{esc(v['duration'])}">
  <div class="video-card__media">
    {img(v['image'], v['title'], base, "(max-width: 720px) 100vw, 33vw")}
    <span class="video-card__play"><span>{icon("play", 14)}</span></span>
    <span class="video-card__dur">{esc(v['duration'])}</span>
  </div>
  <div class="video-card__body">
    <span class="video-card__show">{esc(v['show'])}</span>
    <h3 class="video-card__title">{esc(v['title'])}</h3>
    <div class="video-card__meta">{esc(v['date'])} · {esc(v['section'])}</div>
  </div>
</a>
"""


def newsletter_card() -> str:
    n = C.NEWSLETTER
    return f"""
<div class="newsletter-card">
  <span class="kicker kicker--paper">{esc(n['title'])}</span>
  <h2>The story beneath the story,<br>in your inbox</h2>
  <p>{esc(n['desc'])} Join {esc(n['count'])} readers.</p>
  <form class="newsletter-form" data-newsletter>
    <label class="sr-only" for="nl-email">Email address</label>
    <input id="nl-email" type="email" name="email" placeholder="you@example.com" required>
    <button class="btn" type="submit">Sign up free {icon("arrow-right", 15)}</button>
  </form>
  <small>No spam. Unsubscribe in one click. By signing up you agree to our privacy note.</small>
</div>
"""


def section_head(title: str, slug: str = "", base: str = "", sub: str = "") -> str:
    link = ""
    if slug:
        label = f"All {title.lower()}" if slug != "home" else "More"
        link = f'<a class="link-arrow" href="{base}{slug}.html">All {esc(title.lower())} {icon("arrow-right", 13)}</a>'
    sub_html = f'<p class="sec__sub">{esc(sub)}</p>' if sub else ""
    return f"""
<div class="sec__head">
  <div>
    <h2 class="sec__title">{esc(title)}</h2>
    {sub_html}
  </div>
  {link}
</div>
"""


# ---------------------------------------------------------------------------
# Home page
# ---------------------------------------------------------------------------

def page_home() -> str:
    base = ""
    lead = C.STORY_BY_SLUG[C.HOMEPAGE["lead"]]
    latest = sorted(
        [s for s in C.STORIES if s["slug"] != lead["slug"]],
        key=lambda s: s["published"], reverse=True,
    )[:5]

    lead_html = f"""
<section class="hero">
  <div class="wrap">
    <div class="hero__grid">
      <div class="hero__main">
        <article class="lead">
          <a class="lead__media" href="{story_url(lead)}" tabindex="-1" aria-hidden="true">
            {img(lead['image'], lead['caption'], base, "(max-width: 900px) 100vw, 60vw", True)}
            <span class="lead__flag">{esc(lead['kicker'])}</span>
          </a>
          <div class="lead__body">
            <span class="kicker">{esc(section_name(lead['section']))}</span>
            <h1><a href="{story_url(lead)}">{esc(lead['title'])}</a></h1>
            <p class="lead__deck">{esc(lead['deck'])}</p>
            <div class="lead__byline">
              <span class="byline">By {esc(author_of(lead)['name'])} <span>· {esc(author_of(lead)['role'])}</span></span>
              <span class="meta"><time datetime="{lead['published'].isoformat()}">{long_datetime(lead['published'])}</time><i class="dot"></i>{lead['read']} min read</span>
            </div>
          </div>
        </article>
      </div>
      <aside class="hero__rail" aria-label="Latest headlines">
        <div class="rail__head">
          <h2 class="rail__title">Latest</h2>
          <a class="meta" href="news.html" style="font-weight:800;color:var(--ink)">All news →</a>
        </div>
        {''.join(f'''
        <article class="latest__item">
          <h3><a href="{story_url(s)}">{esc(s['title'])}</a></h3>
          <time class="latest__time" datetime="{s['published'].isoformat()}" data-rel>{clock(s['published'])}</time>
        </article>''' for s in latest)}
        <div class="latest__more">
          <a class="link-arrow" href="news.html">More headlines {icon("arrow-right", 13)}</a>
        </div>
        <div class="rail-onair">
          <div class="rail-onair__label"><span class="live-dot"></span> On air now</div>
          <div class="rail-onair__show">{esc(C.LIVE_NOW['show'])}</div>
          <div class="rail-onair__host">with {esc(C.LIVE_NOW['host'])} · {esc(C.BRAND['frequency'])}</div>
          {listen_button(base, cls="btn btn--block", label="Listen Live")}
        </div>
      </aside>
    </div>
  </div>
</section>
"""

    shortcuts = f'''
<section class="shortcuts" aria-label="Quick links">
  <div class="wrap">
    <div class="shortcuts__inner">
      <button class="shortcut" type="button" data-radio-toggle>
        {icon("headphones", 19)}
        <span class="shortcut__label"><b>Listen live</b><span>96.4 FM · on air now</span></span>
      </button>
      <a class="shortcut" href="watch.html">
        {icon("tv", 19)}
        <span class="shortcut__label"><b>Watch</b><span>UnderCover TV</span></span>
      </a>
      <a class="shortcut" href="listen.html#schedule">
        {icon("calendar", 19)}
        <span class="shortcut__label"><b>Programme guide</b><span>Today on air</span></span>
      </a>
      <a class="shortcut" href="#newsletter">
        {icon("mail", 19)}
        <span class="shortcut__label"><b>The Cover Note</b><span>Free newsletter</span></span>
      </a>
    </div>
  </div>
</section>
'''

    secondary = "".join(story_card(C.STORY_BY_SLUG[s], base, show_deck=True) for s in C.HOMEPAGE["secondary"])
    top_stories = f"""
<section class="sec">
  <div class="wrap">
    {section_head("Top stories", "news", base, "Reported, verified, and worth your time")}
    <div class="grid-3">{secondary}</div>
  </div>
</section>
"""

    live = C.LIVE_NOW
    radio_band = f"""
<section class="radio-band" aria-labelledby="on-air-title">
  <div class="wrap radio-band__inner">
    <div>
      <span class="on-air"><span class="live-dot"></span> On air now</span>
      <h2 id="on-air-title">{esc(live['show'])}</h2>
      <p class="radio-band__host">with <b>{esc(live['host'])}</b> · {esc(C.BRAND['frequency'])}</p>
      <p class="radio-band__topic">{esc(live['topic'])}</p>
      <div class="radio-band__actions">
        {listen_button(base, cls="btn")}
        <a class="link-arrow link-arrow--paper" href="listen.html#schedule">Programme guide {icon("arrow-right", 13)}</a>
      </div>
      <div class="radio-band__next">
        <span><b>10:00</b> The Briefing</span>
        <span><b>12:00</b> Market Watch</span>
        <span><b>16:00</b> The Afternoon Drive</span>
      </div>
    </div>
    <div class="radio-band__visual">
      <span class="radio-band__badge"><span class="live-dot"></span> Live studio</span>
      {img("radio-studio", "A presenter on air in the UnderCover radio studio", base, "(max-width: 900px) 100vw, 34vw")}
      <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>
  </div>
</section>
"""

    biz = [C.STORY_BY_SLUG[s] for s in C.HOMEPAGE["business"]]
    business = f"""
<section class="sec">
  <div class="wrap">
    {section_head("Business", "business", base, C.SECTIONS['business']['desc'])}
    <div class="split">
      <div class="split__main">{story_card(biz[0], base, "card--lead", True, False, "(max-width: 1024px) 100vw, 52vw")}</div>
      <div class="split__side">{''.join(story_row(s, base) for s in biz[1:])}</div>
    </div>
  </div>
</section>
"""

    sports = [C.STORY_BY_SLUG[s] for s in C.HOMEPAGE["sports"]]
    sports_html = f"""
<section class="sec">
  <div class="wrap">
    {section_head("Sports", "sports", base, C.SECTIONS['sports']['desc'])}
    <div class="split">
      <div class="split__main">{story_card(sports[0], base, "card--lead", True, False, "(max-width: 1024px) 100vw, 52vw")}</div>
      <div class="split__side">{''.join(story_row(s, base) for s in sports[1:])}</div>
    </div>
  </div>
</section>
"""

    videos = C.VIDEOS[1:4]
    multimedia = f"""
<section class="mm" aria-labelledby="watch-title">
  <div class="wrap">
    <div class="mm__head">
      <div>
        <h2 class="sec__title" id="watch-title">Watch</h2>
        <p class="sec__sub" style="color:rgba(255,255,255,.5);margin-top:8px">Documentaries, explainers and the stories that need pictures</p>
      </div>
      <a class="link-arrow link-arrow--paper" href="watch.html">All video {icon("arrow-right", 13)}</a>
    </div>
    <div class="mm__grid">{''.join(video_card(v, base) for v in videos)}</div>
  </div>
</section>
"""

    ent = [C.STORY_BY_SLUG[s] for s in C.HOMEPAGE["entertainment"]]
    entertainment = f"""
<section class="sec">
  <div class="wrap">
    {section_head("Entertainment", "entertainment", base, C.SECTIONS['entertainment']['desc'])}
    <div class="grid-3">{''.join(story_card(s, base) for s in ent)}</div>
  </div>
</section>
"""

    opinions = [C.STORY_BY_SLUG[s] for s in C.HOMEPAGE["opinion"]]
    opinion = f"""
<section class="opinion-band" aria-labelledby="opinion-title">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <h2 class="sec__title" id="opinion-title">Opinion</h2>
        <p class="sec__sub" style="margin-top:8px">Argument, analysis and the occasional provocation</p>
      </div>
      <a class="link-arrow" href="opinion.html">All opinion {icon("arrow-right", 13)}</a>
    </div>
    <div class="opinion-grid">{''.join(opinion_card(s, base) for s in opinions)}</div>
  </div>
</section>
"""

    most = f"""
<section class="wrap" id="newsletter">
  <div class="most">
    <div>
      <div class="sec__head" style="margin-bottom:10px">
        <h2 class="sec__title" style="font-size:20px">Most read</h2>
        <span class="sec__sub">Updated hourly</span>
      </div>
      {most_read(base, C.MOST_READ)}
    </div>
    {newsletter_card()}
  </div>
</section>
"""

    main = lead_html + shortcuts + top_stories + radio_band + business + sports_html + multimedia + entertainment + opinion + most
    return layout(
        title="UnderCover Media — The story beneath the story",
        description="Ugandan news, business, sport, culture and live radio from Kampala. UnderCover Media reports the story beneath the story.",
        active="home",
        main=main,
        base=base,
    )


# ---------------------------------------------------------------------------
# Category page
# ---------------------------------------------------------------------------

def page_category(slug: str) -> str:
    base = ""
    sec = C.SECTIONS[slug]
    stories = sorted(
        [s for s in C.STORIES if s["section"] == slug],
        key=lambda s: s["published"], reverse=True,
    )
    if not stories:
        return ""
    lead, rest = stories[0], stories[1:]
    author = author_of(lead)

    in_section_most = [s for s in C.MOST_READ if C.STORY_BY_SLUG[s]["section"] == slug]
    for s in stories:
        if s["slug"] not in in_section_most:
            in_section_most.append(s["slug"])
    side = "".join(story_row(C.STORY_BY_SLUG[s], base) for s in in_section_most[:4])

    related_sections = [x for x in C.SECTION_ORDER if x != slug][:3]
    cross = ""
    for other in related_sections:
        picks = [s for s in C.STORIES if s["section"] == other][:2]
        if picks:
            cross += f"""
<div>
  <div class="side-head">{esc(section_name(other))}</div>
  {''.join(story_row(s, base) for s in picks) if len(picks) < 3 else ''}
</div>"""

    main = f"""
<section class="page-head">
  <div class="wrap">
    <div class="page-head__kicker">{icon("arrow-right", 14)} Section</div>
    <h1>{esc(sec['name'])}</h1>
    <p>{esc(sec['desc'])} {esc(sec['blurb'])}</p>
    <div class="page-head__stats">
      <div class="page-head__stat"><b>{len(stories)}</b><span>Stories this week</span></div>
      <div class="page-head__stat"><b>{C.BRAND['frequency'].split(' ')[0]}</b><span>FM · radio desk</span></div>
      <div class="page-head__stat"><b>Kampala</b><span>Newsroom</span></div>
    </div>
  </div>
</section>

<section class="wrap">
  <div class="cat-grid">
    <article class="cat-lead">
      <a class="cat-lead__media" href="{story_url(lead)}" tabindex="-1" aria-hidden="true">
        {img(lead['image'], lead['caption'], base, "(max-width: 900px) 100vw, 58vw", True)}
      </a>
      <div style="padding-top:16px">
        <span class="kicker">{esc(lead['kicker'])}</span>
        <h2><a href="{story_url(lead)}">{esc(lead['title'])}</a></h2>
        <p class="cat-lead__deck">{esc(lead['deck'])}</p>
        <div class="meta" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
          <span class="byline">By {esc(author['name'])}</span><i class="dot"></i>
          <time datetime="{lead['published'].isoformat()}">{long_datetime(lead['published'])}</time><i class="dot"></i>{lead['read']} min read
        </div>
      </div>
    </article>
    <aside class="cat-grid__side">
      <div class="side-head">Most read in {esc(sec['name'])}</div>
      {side}
      <div class="side-box--listen side-box" style="margin-top:26px;padding:22px">
        <span class="kicker kicker--paper">UnderCover Radio</span>
        <h3 style="color:#fff">Listen live while you read</h3>
        <p style="color:rgba(255,255,255,.65);font-family:var(--sans);font-size:12.5px;line-height:1.5">
          The Kampala Morning is on air now with {esc(C.LIVE_NOW['host'])}.
        </p>
        {listen_button(base, cls="btn btn--block", label="Listen Live")}
      </div>
    </aside>
  </div>
</section>

<section class="wrap">
  <div class="cat-list cat-list--3">
    {''.join(story_card(s, base, show_deck=False) for s in rest)}
  </div>
</section>

<section class="wrap" style="padding-bottom:44px">
  <div class="sec__head" style="border-top:1px solid var(--ink);padding-top:22px">
    <h2 class="sec__title">Elsewhere on UnderCover</h2>
    <a class="link-arrow" href="index.html">Front page {icon("arrow-right", 13)}</a>
  </div>
  <div class="cat-list cat-list--3" style="border-top:0;padding-top:0;margin-top:0">{cross}</div>
</section>
"""
    return layout(
        title=f"{sec['name']} — UnderCover Media",
        description=f"{sec['desc']} {sec['blurb']}",
        active=slug,
        main=main,
        base=base,
    )


# ---------------------------------------------------------------------------
# Article page
# ---------------------------------------------------------------------------

def body_blocks(story: dict) -> str:
    out = []
    for kind, value in story["body"]:
        if kind == "p":
            out.append(f"<p>{esc(value)}</p>")
        elif kind == "h2":
            out.append(f"<h2>{esc(value)}</h2>")
        elif kind == "quote":
            text, attrib = value
            out.append(f"<blockquote>“{esc(text)}”<cite>— {esc(attrib)}</cite></blockquote>")
        elif kind == "ul":
            out.append("<ul>" + "".join(f"<li>{esc(i)}</li>" for i in value) + "</ul>")
    return "\n".join(out)


def page_article(story: dict) -> str:
    base = "../"
    author = author_of(story)
    sec = section_name(story["section"])
    related = [s for s in C.STORIES if s["section"] == story["section"] and s["slug"] != story["slug"]][:3]
    if len(related) < 3:
        extra = [s for s in C.STORIES if s["slug"] not in [r["slug"] for r in related] and s["slug"] != story["slug"]]
        related += extra[: 3 - len(related)]

    share_url = SITE_URL + story["slug"] + "/"
    share_text = quote(story["title"])
    tags = "".join(f'<a class="tag" href="{base}{story["section"]}.html">{esc(t)}</a>' for t in story["tags"])

    side = f"""
<aside class="article-side" aria-label="Related reading">
  <div class="side-box">
    <div class="side-head">Most read</div>
    <ol class="most__list" style="grid-template-columns:1fr">
      {''.join(f'<li class="most__item"><h3><a href="{base}{s}/">{esc(C.STORY_BY_SLUG[s]["title"])}</a></h3></li>' for s in C.MOST_READ[:4])}
    </ol>
  </div>
  <div class="side-box side-box--listen">
    <span class="kicker kicker--paper">On air now</span>
    <h3>{esc(C.LIVE_NOW['show'])}</h3>
    <p>with {esc(C.LIVE_NOW['host'])} · {esc(C.BRAND['frequency'])}</p>
    {listen_button(base, cls="btn btn--block", label="Listen Live")}
    <p style="margin-top:14px;margin-bottom:0;font-size:10.5px;letter-spacing:.04em">
      <a href="{base}listen.html" style="color:#fff;border-bottom:1px solid rgba(255,255,255,.3)">Full programme guide →</a>
    </p>
  </div>
</aside>
"""

    main = f"""
<div class="read-progress" id="read-progress" aria-hidden="true"></div>
<article>
  <header class="article-head">
    <div class="wrap">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="{base}index.html">Home</a><span>/</span>
        <a href="{base}{story['section']}.html">{esc(sec)}</a>
      </nav>
      <span class="kicker kicker--box">{esc(story['kicker'])}</span>
      <h1>{esc(story['title'])}</h1>
      <p class="article-head__deck">{esc(story['deck'])}</p>
      <div class="article-byline">
        <div class="article-byline__who">
          <span class="avatar avatar--red">{esc(author['initials'])}</span>
          <div>
            <div class="article-byline__name">{esc(author['name'])}</div>
            <div class="article-byline__role">{esc(author['role'])}</div>
          </div>
        </div>
        <div class="article-byline__meta meta">
          <time datetime="{story['published'].isoformat()}">{long_datetime(story['published'])}</time>
          <i class="dot"></i>{story['read']} min read
          <i class="dot"></i>{esc(story['location'])}
        </div>
        <div class="share">
          <button class="share__btn" type="button" data-share="copy" aria-label="Copy link">{icon("link", 14)}</button>
          <a class="share__btn" href="https://wa.me/?text={share_text}%20{quote(share_url)}" target="_blank" rel="noopener" aria-label="Share on WhatsApp">{icon("whatsapp", 14)}</a>
          <a class="share__btn" href="https://twitter.com/intent/tweet?url={quote(share_url)}&text={share_text}" target="_blank" rel="noopener" aria-label="Share on X">{icon("x", 14)}</a>
          <a class="share__btn" href="https://www.facebook.com/sharer/sharer.php?u={quote(share_url)}" target="_blank" rel="noopener" aria-label="Share on Facebook">{icon("facebook", 14)}</a>
        </div>
      </div>
    </div>
  </header>

  <div class="wrap article-hero">
    <figure>
      {img(story['image'], story['caption'], base, "(max-width: 1320px) 100vw, 1240px", True)}
      <figcaption>{esc(story['caption'])} <b>{esc(story['credit'])}</b></figcaption>
    </figure>
  </div>

  <div class="wrap">
    <div class="article-layout">
      <div class="article-body">
        {body_blocks(story)}
        <div class="article-tags">{tags}</div>
        <div class="author-box">
          <span class="avatar">{esc(author['initials'])}</span>
          <div>
            <div class="role">{esc(author['role'])}</div>
            <h3>{esc(author['name'])}</h3>
            <p>{esc(author['bio'])}</p>
          </div>
        </div>
      </div>
      {side}
    </div>
  </div>
</article>

<section class="related">
  <div class="wrap">
    <div class="sec__head" style="margin-bottom:4px">
      <h2 class="sec__title">More from {esc(sec)}</h2>
      <a class="link-arrow" href="{base}{story['section']}.html">All {esc(sec.lower())} {icon("arrow-right", 13)}</a>
    </div>
    <div class="related__grid">
      {''.join(story_card(s, base, show_deck=False) for s in related)}
    </div>
  </div>
</section>

<section class="wrap" style="padding:34px 0 46px">
  <div class="newsletter-card" style="max-width:720px">
    <span class="kicker kicker--paper">{esc(C.NEWSLETTER['title'])}</span>
    <h2>Never miss the story beneath the story</h2>
    <p>{esc(C.NEWSLETTER['desc'])}</p>
    <form class="newsletter-form" data-newsletter>
      <label class="sr-only" for="nl-article">Email address</label>
      <input id="nl-article" type="email" name="email" placeholder="you@example.com" required>
      <button class="btn" type="submit">Sign up free {icon("arrow-right", 15)}</button>
    </form>
  </div>
</section>
"""

    jsonld = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": story["title"],
        "description": story["deck"],
        "datePublished": story["published"].isoformat(),
        "author": {"@type": "Person", "name": author["name"]},
        "publisher": {"@type": "Organization", "name": "UnderCover Media"},
        "image": [SITE_URL + f"assets/img/{story['image']}-1400.jpg"],
        "articleSection": sec,
    }

    return layout(
        title=f"{story['title']} — UnderCover Media",
        description=story["deck"],
        active=story["section"],
        main=main,
        base=base,
        og_image=story["image"],
        with_ticker=False,
        jsonld=jsonld,
    )


# ---------------------------------------------------------------------------
# Watch page
# ---------------------------------------------------------------------------

def page_watch() -> str:
    base = ""
    featured = C.VIDEOS[0]
    grid_videos = C.VIDEOS[1:]
    shows = [
        ("The Final Whistle", "Sport, analysis and the arguments that follow", "football"),
        ("UnderCover Explains", "One story, four charts, six minutes", "hero-politics"),
        ("UnderCover Sessions", "Live music from the city's best rooms", "music-live"),
        ("UnderCover Reports", "Long-form documentaries from our reporters", "market-business"),
    ]

    main = f"""
<section class="watch-hero">
  <div class="wrap">
    <div class="mm__head" style="margin-bottom:22px">
      <div>
        <div class="page-head__kicker" style="margin-bottom:10px">{icon("tv", 16)} UnderCover TV</div>
        <h1 style="font-size:clamp(34px,5vw,60px);color:#fff;line-height:.95;text-transform:uppercase;font-weight:900;letter-spacing:-.035em">Watch</h1>
      </div>
      <a class="link-arrow link-arrow--paper" href="listen.html">Listen instead {icon("headphones", 13)}</a>
    </div>
    <div class="watch-hero__grid">
      <a class="featured-video" href="#" data-video data-title="{esc(featured['title'])}" data-show="{esc(featured['show'])}"
         data-image="{esc(featured['image'])}" data-duration="{esc(featured['duration'])}">
        <div class="featured-video__media">
          {img(featured['image'], featured['title'], base, "(max-width: 900px) 100vw, 60vw", True)}
          <span class="featured-video__play"><span>{icon("play", 20)}</span></span>
          <span class="video-card__dur" style="right:12px;bottom:12px;font-size:11px;padding:5px 8px">{esc(featured['duration'])}</span>
        </div>
        <div class="featured-video__body">
          <span class="kicker">Now showing · {esc(featured['show'])}</span>
          <h2>{esc(featured['title'])}</h2>
          <p>{esc(featured['desc'])}</p>
        </div>
      </a>
      <aside class="watch-side" aria-label="More video">
        <div class="watch-side__head">Latest video</div>
        {''.join(f'''
        <a class="side-video" href="#" data-video data-title="{esc(v['title'])}" data-show="{esc(v['show'])}" data-image="{esc(v['image'])}" data-duration="{esc(v['duration'])}">
          <div class="side-video__media">
            {img(v['image'], v['title'], base, "118px")}
            <span class="video-card__dur">{esc(v['duration'])}</span>
          </div>
          <div>
            <h4>{esc(v['title'])}</h4>
            <span>{esc(v['show'])}</span>
          </div>
        </a>''' for v in C.VIDEOS[1:5])}
        <div class="live-tv" style="margin-top:24px">
          <span class="live-tv__badge" style="position:static;display:inline-flex;margin-bottom:14px"><span class="live-dot"></span> Live TV</span>
          <h3 style="margin-top:0">UnderCover TV is on air</h3>
          <p>Rolling news, live from the Kampala studio. Weekdays 06:00–09:00 and 18:00–21:00.</p>
          <button class="btn btn--paper" type="button" data-video data-title="UnderCover TV — live from Kampala" data-show="UnderCover TV" data-image="radio-studio" data-duration="LIVE" style="margin-top:6px">{icon("play", 14)} Watch live</button>
        </div>
      </aside>
    </div>
  </div>
</section>

<section class="mm" style="padding-top:34px">
  <div class="wrap">
    <div class="mm__head">
      <h2 class="sec__title">Latest videos</h2>
      <span class="sec__sub" style="color:rgba(255,255,255,.45)">{len(grid_videos)} new films & explainers</span>
    </div>
    <div class="mm__grid">{''.join(video_card(v, base) for v in grid_videos)}</div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <h2 class="sec__title">Programmes</h2>
        <p class="sec__sub">Four strands, one newsroom</p>
      </div>
      <a class="link-arrow" href="listen.html">Radio schedule {icon("arrow-right", 13)}</a>
    </div>
    <div class="mm__grid mm__grid--4" style="gap:26px;color:var(--ink)">
      {''.join(f'''
      <article>
        <div class="card__media" style="aspect-ratio:1">
          {img(im, name, base, "(max-width: 720px) 50vw, 24vw")}
        </div>
        <div class="card__body">
          <span class="kicker">Programme</span>
          <h3 class="card__title" style="font-size:18px">{esc(name)}</h3>
          <p class="card__deck">{esc(desc)}</p>
        </div>
      </article>''' for name, desc, im in shows)}
    </div>
  </div>
</section>

<section class="wrap" style="padding-bottom:46px">
  <div class="newsletter-card" style="max-width:820px">
    <span class="kicker kicker--paper">The Cover Note</span>
    <h2>Watch less. Understand more.</h2>
    <p>Our editors pick the three films worth your evening, every Friday.</p>
    <form class="newsletter-form" data-newsletter>
      <label class="sr-only" for="nl-watch">Email address</label>
      <input id="nl-watch" type="email" name="email" placeholder="you@example.com" required>
      <button class="btn" type="submit">Get the watchlist {icon("arrow-right", 15)}</button>
    </form>
  </div>
</section>
"""
    return layout(
        title="Watch — UnderCover Media",
        description="Documentaries, explainers and live TV from the UnderCover Media newsroom in Kampala.",
        active="watch",
        main=main,
        base=base,
        with_ticker=True,
    )


# ---------------------------------------------------------------------------
# Listen page
# ---------------------------------------------------------------------------

def page_listen() -> str:
    base = ""
    live = C.LIVE_NOW
    tabs = "".join(
        f'<button class="tab" type="button" role="tab" id="tab-{name.lower()}" aria-selected="{"true" if i == 0 else "false"}" aria-controls="panel-{name.lower()}">{esc(name)}</button>'
        for i, name in enumerate(C.SCHEDULE_TABS)
    )
    panels = ""
    for i, (name, rows) in enumerate(C.SCHEDULE_TABS.items()):
        rows_html = ""
        for time, show, host in rows:
            is_now = name == "Weekdays" and show == live["show"]
            now = ('<span class="schedule__now"><span class="live-dot"></span> On air</span>' if is_now else '<span class="schedule__now" aria-hidden="true"></span>')
            rows_html += f"""
      <div class="schedule__row">
        <span class="schedule__time">{esc(time)}</span>
        <span class="schedule__show">{esc(show)}</span>
        <span class="schedule__host">{esc(host)}</span>
        {now}
      </div>"""
        panels += f"""
    <div class="schedule__panel{' is-active' if i == 0 else ''}" id="panel-{name.lower()}" role="tabpanel" aria-labelledby="tab-{name.lower()}">
      {rows_html}
    </div>"""

    presenters = "".join(f"""
    <article class="presenter">
      <span class="avatar avatar--red">{esc(p['initials'])}</span>
      <div><h3>{esc(p['name'])}</h3><div class="show">{esc(p['show'])}</div></div>
      <p>{esc(p['bio'])}</p>
    </article>""" for p in C.PRESENTERS)

    podcasts = "".join(f"""
    <article class="podcast">
      <a class="podcast__art" href="#" data-video data-title="{esc(p['title'])}" data-show="{esc(p['show'])}" data-image="{esc(p['image'])}" data-duration="{esc(p['duration'])}" aria-label="Play {esc(p['title'])}">
        {img(p['image'], p['title'], base, "108px")}
        <span class="podcast__play"><span>{icon("play", 12)}</span></span>
      </a>
      <div>
        <span class="kicker">{esc(p['show'])}</span>
        <h3><a href="#" data-video data-title="{esc(p['title'])}" data-show="{esc(p['show'])}" data-image="{esc(p['image'])}" data-duration="{esc(p['duration'])}">{esc(p['title'])}</a></h3>
        <p>{esc(p['desc'])}</p>
        <div class="meta">{esc(p['date'])}<i class="dot"></i>{esc(p['duration'])}</div>
      </div>
    </article>""" for p in C.PODCASTS)

    stats = "".join(
        f'<div class="page-head__stat"><b>{esc(v)}</b><span>{esc(l)}</span></div>' for v, l in C.STATS
    )

    main = f"""
<section class="listen-hero">
  <div class="wrap listen-hero__inner">
    <div>
      <div class="page-head__kicker">{icon("radio", 16)} UnderCover Radio</div>
      <h1>Kampala<br>sounds<br><em>different</em><br>here.</h1>
      <p class="listen-hero__desc">News you can trust, music you actually want, and a phone line that stays open. From the first traffic report to the last dedication.</p>
      <div class="listen-hero__cta">
        {listen_button(base, cls="btn", label="Listen Live")}
        <a class="btn btn--ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" href="#schedule">Programme guide {icon("arrow-right", 14)}</a>
      </div>
      <div class="freqs">
        <span><b>96.4 FM</b> Kampala</span>
        <span><b>104.1 FM</b> Gulu</span>
        <span><b>91.7 FM</b> Mbarara</span>
        <span><b>DStv 893</b> TV simulcast</span>
      </div>
    </div>
    <div class="listen-hero__player">
      {img("radio-studio", "The UnderCover radio studio during a live broadcast", base, "(max-width: 900px) 100vw, 40vw", True)}
      <div class="listen-hero__bar">
        <span class="avatar avatar--red" style="width:40px;height:40px;font-size:12px">AN</span>
        <div style="flex:1;min-width:0">
          <div class="meta" style="margin-bottom:4px"><span class="live-dot" style="color:var(--red)"></span> Live now</div>
          <div style="font-family:var(--sans);font-size:15px;font-weight:800">{esc(live['show'])}</div>
          <div class="meta" style="margin-top:4px;text-transform:none;letter-spacing:.02em">with {esc(live['host'])}</div>
        </div>
        <button class="player__btn" type="button" data-radio-toggle aria-label="Play live radio">
          <svg class="icon-play" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>
          <svg class="icon-pause" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5v15M16 4.5v15" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>
  </div>
</section>

<section class="wrap">
  <div class="schedule" id="schedule">
    <div class="schedule__head">
      <div>
        <h2 class="sec__title">Programme guide</h2>
        <p class="sec__sub" style="margin-top:8px">All times East Africa Time (EAT)</p>
      </div>
      <div class="tabs" role="tablist" aria-label="Programme guide days" data-tabs>
        {tabs}
      </div>
    </div>
    {panels}
  </div>
</section>

<section class="wrap">
  <div class="presenters" id="presenters">
    <div class="sec__head">
      <div>
        <h2 class="sec__title">The voices</h2>
        <p class="sec__sub">Broadcasters who also report</p>
      </div>
      <a class="link-arrow" href="about.html#team">Newsroom team {icon("arrow-right", 13)}</a>
    </div>
    <div class="presenter-grid">{presenters}</div>
  </div>
</section>

<section class="wrap">
  <div class="podcasts" id="podcasts">
    <div class="sec__head">
      <div>
        <h2 class="sec__title">Podcasts</h2>
        <p class="sec__sub">Missed it live? It is here by lunchtime.</p>
      </div>
      <span class="link-arrow" style="border-color:var(--line-2);color:var(--muted)">Apple · Spotify · RSS</span>
    </div>
    <div class="podcast-grid">{podcasts}</div>
  </div>
</section>

<section class="wrap" style="padding-bottom:48px">
  <div class="listen-hero__player" style="border:1px solid var(--line);background:var(--paper-2);color:var(--ink);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:26px 28px;gap:24px">
    <div>
      <span class="kicker">UnderCover TV</span>
      <h2 style="font-size:26px;margin:8px 0 6px">Prefer to watch?</h2>
      <p style="margin:0;font-family:var(--sans);font-size:13px;color:var(--muted)">Live from the Kampala studio, weekdays from 06:00.</p>
    </div>
    <a class="btn btn--ink" href="watch.html">{icon("tv", 15)} Go to Watch</a>
  </div>
</section>
"""
    return layout(
        title="Listen — UnderCover Radio",
        description="Listen live to UnderCover Radio: 96.4 FM Kampala. Programme guide, presenters and podcasts.",
        active="listen",
        main=main,
        base=base,
        with_ticker=False,
    )


# ---------------------------------------------------------------------------
# About page
# ---------------------------------------------------------------------------

def page_about() -> str:
    base = ""
    values = [
        ("We show our work", "Documents, data and named sources wherever it is safe to name them. Anonymous sourcing is a last resort, explained to readers."),
        ("We correct in public", "Corrections are published at the top of the story, dated, and never quietly edited away."),
        ("We separate news from opinion", "Opinion is labelled, signed and kept out of the reporting columns."),
        ("We listen", "A weekly listener panel reviews our output. Their notes go to the editors, not the bin."),
    ]
    values_html = "".join(f'<div class="value"><h3>{esc(t)}</h3><p>{esc(d)}</p></div>' for t, d in values)
    team = "".join(f"""
    <article class="presenter">
      <span class="avatar">{esc(p['initials'])}</span>
      <div><h3>{esc(p['name'])}</h3><div class="show">{esc(p['role'])}</div></div>
      <p>{esc(p['bio'])}</p>
    </article>""" for p in C.AUTHORS.values())

    main = f"""
<section class="page-head">
  <div class="wrap">
    <div class="page-head__kicker">{icon("arrow-right", 14)} About</div>
    <h1>The story<br>beneath the story</h1>
    <p>UnderCover Media is an independent Ugandan newsroom built around a simple idea: the first draft of a story is rarely the true one. We stay for the second, the third and the document nobody wanted to release.</p>
    <div class="page-head__stats">{''.join(f'<div class="page-head__stat"><b>{esc(v)}</b><span>{esc(l)}</span></div>' for v, l in C.STATS)}</div>
  </div>
</section>

<section class="wrap">
  <div class="about-grid">
    <div class="prose">
      <h2>Who we are</h2>
      <p>We are a newsroom of {len(C.AUTHORS)} reporters, editors and broadcasters working from Kimathi Avenue in Kampala, with correspondents in twelve districts. We publish on this site, broadcast on 96.4 FM and stream every programme live.</p>
      <p>UnderCover was founded in {C.BRAND['founded']} by a group of journalists who wanted to build the kind of newsroom they had spent their careers wishing existed: small enough to move quickly, funded in a way that does not depend on a single advertiser, and stubborn about the difference between what is said and what is true.</p>
      <p>Our radio desk and our newsroom sit in the same room. A story that breaks on air is filed for the site before the bulletin ends; a story that breaks online is on air within the hour.</p>

      <h2 id="standards">Editorial standards</h2>
      <p>We follow the Code of Ethics for the Ugandan press and add a few rules of our own. If we get something wrong, tell us: <a href="mailto:{C.BRAND['email']}" style="border-bottom:1px solid var(--line-2)">{C.BRAND['email']}</a>.</p>
      <ul>
        <li>Every story names its reporter and its editor.</li>
        <li>Every claim about a person is put to that person before publication.</li>
        <li>Every correction is dated, visible and permanent.</li>
        <li>Every sponsored piece is labelled as such, at the top.</li>
        <li>No payment is accepted for coverage. Ever.</li>
      </ul>

      <h2 id="advertise">Advertise with us</h2>
      <p>We work with brands that want to reach an informed Ugandan audience without interrupting it. That means sponsored series, branded studio sessions and radio features — always labelled, never disguised as news.</p>
      <p>For rates and audience data, write to <a href="mailto:ads@undercover.media" style="border-bottom:1px solid var(--line-2)">ads@undercover.media</a>.</p>

      <h2>How we are funded</h2>
      <p>Reader memberships, advertising and syndication. Our accounts are audited annually and a summary is published each year. We do not take money from political parties or candidates.</p>

      <h2 id="contact">Contact the newsroom</h2>
      <p>News tips, corrections and story ideas: <a href="mailto:{C.BRAND['email']}" style="border-bottom:1px solid var(--line-2)">{C.BRAND['email']}</a>. For sensitive material, ask for our Signal number — we will send it.</p>
    </div>
    <aside>
      <div class="contact-card">
        <h3>Newsroom</h3>
        <p>
          {esc(C.BRAND['studio'])}<br>
          {esc(C.BRAND['city'])}<br><br>
          <a href="mailto:{C.BRAND['email']}">{C.BRAND['email']}</a><br>
          <a href="tel:{C.BRAND['phone'].replace(' ', '')}">{C.BRAND['phone']}</a><br><br>
          Studio line (on air)<br>
          <a href="tel:+256414000111">+256 414 000 111</a>
        </p>
      </div>
      <div class="values" style="margin-top:28px">
        {values_html}
      </div>
    </aside>
  </div>
</section>

<section class="wrap">
  <div class="team-grid" id="team">
    <div style="grid-column:1/-1">
      <h2 class="sec__title">The newsroom</h2>
      <p class="sec__sub" style="margin-top:8px">Reporters, editors and broadcasters</p>
    </div>
    {team}
  </div>
</section>

<section class="wrap" style="padding-bottom:48px">
  <div class="newsletter-card" style="max-width:820px">
    <span class="kicker kicker--paper">The Cover Note</span>
    <h2>One email. Every weekday.</h2>
    <p>{esc(C.NEWSLETTER['desc'])}</p>
    <form class="newsletter-form" data-newsletter>
      <label class="sr-only" for="nl-about">Email address</label>
      <input id="nl-about" type="email" name="email" placeholder="you@example.com" required>
      <button class="btn" type="submit">Sign up free {icon("arrow-right", 15)}</button>
    </form>
  </div>
</section>
"""
    return layout(
        title="About — UnderCover Media",
        description="Who we are, how we report and how to reach the UnderCover Media newsroom in Kampala.",
        active="about",
        main=main,
        base=base,
    )


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def copy_assets() -> None:
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    PUBLIC.mkdir(parents=True)
    shutil.copytree(SRC / "css", PUBLIC / "assets" / "css")
    shutil.copytree(SRC / "js", PUBLIC / "assets" / "js")
    shutil.copytree(SRC / "fonts", PUBLIC / "assets" / "fonts")
    (PUBLIC / "assets" / "img").mkdir(parents=True)
    for f in (SRC / "images" / "opt").glob("*.jpg"):
        shutil.copy2(f, PUBLIC / "assets" / "img" / f.name)
    favicon = SRC / "favicon.svg"
    if favicon.exists():
        shutil.copy2(favicon, PUBLIC / "assets" / "favicon.svg")


def build_index() -> list[dict]:
    index = []
    for s in C.STORIES:
        index.append({
            "title": s["title"],
            "section": section_name(s["section"]),
            "deck": s["deck"],
            "url": f"{s['slug']}/",
            "image": f"assets/img/{s['image']}-700.jpg",
            "tags": s["tags"],
            "date": s["published"].isoformat(),
        })
    return index


def main() -> None:
    copy_assets()
    write(PUBLIC / "index.html", page_home())
    for slug in C.SECTION_ORDER:
        write(PUBLIC / f"{slug}.html", page_category(slug))
    for story in C.STORIES:
        write(PUBLIC / story["slug"] / "index.html", page_article(story))
    write(PUBLIC / "watch.html", page_watch())
    write(PUBLIC / "listen.html", page_listen())
    write(PUBLIC / "about.html", page_about())
    write(PUBLIC / "assets" / "search-index.json", json.dumps(build_index(), ensure_ascii=False))
    write(PUBLIC / "404.html", layout(
        title="Page not found — UnderCover Media",
        description="That page has moved, or never existed.",
        active="",
        main='<section class="center-page wrap"><h1>404</h1>'
             '<p>That page has moved, or never existed. Try the front page.</p>'
             '<p><a class="btn" href="index.html">Back to the front page</a></p></section>',
    ))
    # sitemap + robots
    urls = ["", "news.html", "business.html", "sports.html", "entertainment.html",
            "opinion.html", "watch.html", "listen.html", "about.html"]
    urls += [f"{s['slug']}/" for s in C.STORIES]
    parts = []
    for u in urls:
        parts.append(f"<url><loc>{SITE_URL}{u}</loc><lastmod>{BUILD_DATE.isoformat()}</lastmod></url>")
    write(PUBLIC / "sitemap.xml",
          '<?xml version="1.0" encoding="UTF-8"?>'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
          + "".join(parts) + "</urlset>")
    write(PUBLIC / "robots.txt",
          f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}sitemap.xml\n")

    count = len(list(PUBLIC.rglob("*.html")))
    print(f"Built {count} pages into {PUBLIC.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
    if "--serve" in sys.argv:
        import http.server
        import socketserver
        port = 8080
        handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(PUBLIC), **kw)  # noqa: E731
        with socketserver.TCPServer(("0.0.0.0", port), handler) as httpd:
            print(f"Serving http://0.0.0.0:{port}")
            httpd.serve_forever()
