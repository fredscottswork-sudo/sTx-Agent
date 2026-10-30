"""Load the newsroom from Supabase at build time.

The site is generated statically, so the database is read during the build:
`python3 build.py` asks Supabase for published content and rewrites the
in-memory `content` module. If no database is configured (or it cannot be
reached) the bundled `content.py` library is used, so a fresh clone always
builds.

    SUPABASE_URL=... SUPABASE_ANON_KEY=... python3 build.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import content as C

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
TIMEOUT = 20


# --------------------------------------------------------------------------- #
# transport
# --------------------------------------------------------------------------- #
def _config() -> tuple[str, str] | None:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY") or ""
    if not base or not key:
        candidates = [os.environ.get("SUPABASE_CONFIG_FILE", ""),
                      str(Path(__file__).resolve().parent / "src" / "site.config.json")]
        for cfg in candidates:
            if cfg and os.path.exists(cfg):
                data = json.loads(open(cfg, encoding="utf-8").read())
                base = base or str(data.get("supabase_url", "")).rstrip("/")
                key = key or data.get("supabase_anon_key", "")
                if base and key:
                    break
    return (base, key) if base and key else None


def _get(base: str, key: str, table: str, params: str) -> list[dict]:
    url = f"{base}/rest/v1/{table}?{params}"
    req = urllib.request.Request(url, headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return json.loads(res.read().decode("utf-8"))


# --------------------------------------------------------------------------- #
# converters
# --------------------------------------------------------------------------- #
def _dt(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def _short_date(dt: datetime) -> str:
    return f"{dt.day} {MONTHS[dt.month - 1]} {dt.year}"


def _image_name(url: str | None) -> str | None:
    """`assets/img/foo-700.jpg` -> `foo`; absolute URLs pass through."""
    if not url:
        return None
    if url.startswith("http"):
        return url
    name = url.rsplit("/", 1)[-1]
    for suffix in ("-1400.jpg", "-900.jpg", "-700.jpg", "-450.jpg", ".jpg", ".png", ".webp"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def _body(blocks) -> list[tuple]:
    out: list[tuple] = []
    for b in blocks or []:
        kind = b.get("type", "p")
        if kind in ("p", "h2", "h3"):
            out.append((kind, b.get("text", "")))
        elif kind == "quote":
            item = ("quote", b.get("text", ""))
            if b.get("cite"):
                item = ("quote", b.get("text", ""), b["cite"])
            out.append(item)
        elif kind in ("ul", "ol"):
            out.append((kind, list(b.get("items") or [])))
        else:
            out.append(("p", b.get("text", "")))
    return out


# --------------------------------------------------------------------------- #
# loader
# --------------------------------------------------------------------------- #
def fetch() -> dict:
    cfg = _config()
    if not cfg:
        raise RuntimeError("no Supabase configuration")
    base, key = cfg

    sections = _get(base, key, "sections", "select=*&order=sort_order.asc")
    authors = _get(base, key, "authors", "select=*")
    stories = _get(base, key, "stories",
                   "select=*&status=eq.published&order=published_at.desc&limit=500")
    videos = _get(base, key, "videos",
                  "select=*&status=eq.published&order=published_at.desc&limit=200")
    shows = _get(base, key, "shows", "select=*&order=sort_order.asc")
    slots = _get(base, key, "schedule_slots", "select=*&order=day_group.asc,sort_order.asc")
    podcasts = _get(base, key, "podcasts", "select=*&order=published_at.desc&limit=200")
    presenters = _get(base, key, "presenters", "select=*&order=sort_order.asc")
    ticker = _get(base, key, "ticker_items", "select=*&active=eq.true&order=sort_order.asc")
    settings = _get(base, key, "settings", "select=*&is_public=eq.true")

    return {
        "sections": sections, "authors": authors, "stories": stories, "videos": videos,
        "shows": shows, "schedule": slots, "podcasts": podcasts, "presenters": presenters,
        "ticker": ticker, "settings": settings,
    }


def apply(data: dict) -> None:
    """Rewrite the content module from database rows."""
    live = next((s["value"] for s in data["settings"] if s["key"] == "live"), {}) or {}
    station = next((s["value"] for s in data["settings"] if s["key"] == "station"), {}) or {}

    # sections ---------------------------------------------------------
    section_order = [s["slug"] for s in data["sections"]]
    C.SECTIONS = {
        s["slug"]: {
            "name": s["name"],
            "desc": s.get("description") or "",
            "blurb": s.get("blurb") or "",
            "nav": s.get("in_nav", True),
        }
        for s in data["sections"]
    }
    C.SECTION_ORDER = section_order

    # authors ----------------------------------------------------------
    C.AUTHORS = {
        a["slug"]: {
            "name": a["name"], "role": a.get("role") or "", "bio": a.get("bio") or "",
            "initials": a.get("initials") or "".join(p[:1] for p in a["name"].split()[:2]).upper(),
        }
        for a in data["authors"]
    }
    for slug in ("newsroom", "staff"):
        C.AUTHORS.setdefault(slug, {"name": "UnderCover Newsroom", "role": "Newsroom",
                                    "bio": "", "initials": "UC"})

    # stories ----------------------------------------------------------
    stories = []
    for s in data["stories"]:
        flags = []
        if s.get("is_lead"):
            flags.append("lead")
        if s.get("is_top"):
            flags.append("top")
        if s.get("is_featured"):
            flags.append("featured")
        stories.append({
            "slug": s["slug"],
            "section": s.get("section_slug") or (section_order[0] if section_order else "news"),
            "kicker": s.get("kicker") or "",
            "title": s["title"],
            "deck": s.get("deck") or "",
            "author": s.get("author_slug") or "newsroom",
            "published": _dt(s.get("published_at")),
            "read": s.get("read_minutes") or 4,
            "image": _image_name(s.get("image_url")),
            "caption": s.get("image_caption") or "",
            "body": _body(s.get("body")),
            "tags": list(s.get("tags") or []),
            "flags": flags,
            "credit": s.get("image_credit") or "UnderCover Media",
            "location": s.get("location") or "",
        })
    if not stories:
        raise RuntimeError("no published stories in the database")
    C.STORIES = stories
    C.STORY_BY_SLUG = {s["slug"]: s for s in stories}

    # homepage ---------------------------------------------------------
    newest = sorted(stories, key=lambda s: s["published"], reverse=True)
    lead = next((s for s in newest if "lead" in s["flags"]), newest[0])
    used = {lead["slug"]}
    secondary = []
    for s in newest:
        if len(secondary) == 3:
            break
        if s["slug"] not in used:
            secondary.append(s["slug"])
            used.add(s["slug"])

    def pick(section: str, count: int) -> list[str]:
        chosen = [s["slug"] for s in newest if s["section"] == section and s["slug"] not in used][:count]
        used.update(chosen)
        return chosen

    C.HOMEPAGE = {
        "lead": lead["slug"],
        "secondary": secondary,
        "business": pick("business", 4),
        "sports": pick("sports", 3),
        "entertainment": pick("entertainment", 3),
        "opinion": pick("opinion", 3),
    }

    # most read: view counts when the site is live, newest otherwise
    scored = [s for s in data["stories"] if (s.get("views") or 0) > 0]
    if scored:
        ranked = sorted(scored, key=lambda s: s.get("views") or 0, reverse=True)[:6]
        C.MOST_READ = [s["slug"] for s in ranked]
    else:
        C.MOST_READ = [s["slug"] for s in newest[:6]]

    # broadcast ---------------------------------------------------------
    C.VIDEOS = [
        {
            "slug": v["slug"],
            "title": v["title"],
            "show": v.get("show_name") or "",
            "duration": v.get("duration") or "",
            "section": v.get("section") or "News",
            "image": _image_name(v.get("image_url")),
            "date": _short_date(_dt(v.get("published_at"))),
            "desc": v.get("description") or "",
            "flags": ["featured"] if v.get("is_featured") else [],
        }
        for v in data["videos"]
    ]

    C.SHOWS = [
        {
            "slug": sh["slug"],
            "name": sh["name"],
            "time": " – ".join(filter(None, [
                (sh.get("start_time") or "")[:5], (sh.get("end_time") or "")[:5]])),
            "days": sh.get("days") or "",
            "host": sh.get("host") or "",
            "desc": sh.get("description") or "",
            "tagline": sh.get("tagline") or "",
            "image": _image_name(sh.get("image_url")),
            "live": bool(sh.get("is_live")),
        }
        for sh in data["shows"]
    ]

    tabs: dict[str, list] = {}
    for slot in data["schedule"]:
        group = slot["day_group"]
        tabs.setdefault(group, []).append([slot["start_time"], slot["title"], slot.get("host") or ""])
    for group in ("Weekdays", "Saturday", "Sunday"):
        tabs.setdefault(group, [])
    C.SCHEDULE_TABS = tabs

    C.PODCASTS = [
        {
            "title": p["title"],
            "show": p.get("show_name") or "",
            "duration": p.get("duration") or "",
            "date": _short_date(_dt(p.get("published_at"))),
            "image": _image_name(p.get("image_url")),
            "desc": p.get("description") or "",
            "audio_url": p.get("audio_url") or "",
        }
        for p in data["podcasts"]
    ]

    C.PRESENTERS = [
        {
            "name": p["name"],
            "show": p.get("show_name") or "",
            "initials": p.get("initials") or "",
            "bio": p.get("bio") or "",
        }
        for p in data["presenters"]
    ]

    C.TICKER = [(t["label"], t["text"]) for t in data["ticker"]] or C.TICKER

    C.LIVE_NOW = {
        "show": live.get("show") or (C.SHOWS[0]["name"] if C.SHOWS else "UnderCover Radio"),
        "host": live.get("host") or (C.SHOWS[0]["host"] if C.SHOWS else ""),
        "topic": live.get("topic") or "",
        "started": live.get("started") or "",
        "stream_url": live.get("stream_url") or "",
    }

    if station:
        C.BRAND = {**C.BRAND, **{k: v for k, v in station.items() if v}}

    print(f"  content: {len(stories)} stories, {len(C.VIDEOS)} videos, "
          f"{len(C.SHOWS)} shows from Supabase", file=sys.stderr)


def load() -> str:
    """Best-effort: use the database, fall back to the bundled library."""
    if os.environ.get("CONTENT_SOURCE") == "local":
        return "local"
    if not _config():
        return "local"
    try:
        apply(fetch())
        return "supabase"
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError, ValueError) as exc:
        print(f"  content: Supabase unavailable ({exc}); using bundled content.py",
              file=sys.stderr)
        return "local"
