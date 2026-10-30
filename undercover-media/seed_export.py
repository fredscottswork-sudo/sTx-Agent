"""Export the editorial library as a JSON document that maps 1:1 onto the
Supabase tables.

`build.py` writes the result to `public/assets/seed.json`, which serves two
purposes:

1. it seeds the CMS (`select public.import_seed(<json>)`), and
2. it is the fallback dataset for installs that have not connected a database
   yet, so a fresh clone still builds a complete site.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import content as C

UTC = timezone.utc


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:70] or "item"


def iso(value, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=UTC)
    else:
        dt = datetime.strptime(str(value), fmt).replace(tzinfo=UTC)
    return dt.isoformat()


def blocks(body) -> list[dict]:
    """content.py block tuples -> structured blocks the editor understands."""
    out: list[dict] = []
    for b in body:
        kind = b[0]
        if kind in ("p", "h2", "h3"):
            out.append({"type": kind, "text": b[1]})
        elif kind == "quote":
            item = {"type": "quote", "text": b[1]}
            if len(b) > 2 and b[2]:
                item["cite"] = b[2]
            out.append(item)
        elif kind in ("ul", "ol"):
            out.append({"type": kind, "items": list(b[1])})
        else:
            out.append({"type": "p", "text": str(b[1])})
    return out


def image(name: str | None, size: int = 700) -> str | None:
    return f"assets/img/{name}-{size}.jpg" if name else None


def sections() -> list[dict]:
    order = C.SECTION_ORDER
    rows = []
    for slug in order:
        s = C.SECTIONS[slug]
        rows.append({
            "slug": slug,
            "name": s["name"],
            "description": s.get("desc"),
            "blurb": s.get("blurb"),
            "sort_order": order.index(slug),
            "in_nav": bool(s.get("nav", True)),
        })
    return rows


def authors() -> list[dict]:
    return [
        {"slug": slug, "name": a["name"], "role": a.get("role"),
         "bio": a.get("bio"), "initials": a.get("initials")}
        for slug, a in C.AUTHORS.items()
    ]


def stories() -> list[dict]:
    rows = []
    for s in C.STORIES:
        flags = set(s.get("flags") or [])
        rows.append({
            "slug": s["slug"],
            "section_slug": s["section"],
            "kicker": s.get("kicker"),
            "title": s["title"],
            "deck": s.get("deck"),
            "body": blocks(s["body"]),
            "author_slug": s.get("author"),
            "image_url": image(s.get("image")),
            "image_caption": s.get("caption"),
            "image_credit": s.get("credit"),
            "location": s.get("location"),
            "tags": list(s.get("tags") or []),
            "read_minutes": s.get("read", 4),
            "status": "published",
            "is_lead": "lead" in flags,
            "is_top": "top" in flags,
            "is_featured": "featured" in flags,
            "published_at": iso(s["published"]),
        })
    return rows


def videos() -> list[dict]:
    return [
        {
            "slug": v["slug"],
            "title": v["title"],
            "show_name": v.get("show"),
            "section": v.get("section"),
            "duration": v.get("duration"),
            "description": v.get("desc"),
            "image_url": image(v.get("image")),
            "is_featured": "featured" in (v.get("flags") or []),
            "status": "published",
            "published_at": iso(f"{v['date']} 12:00", "%d %b %Y %H:%M"),
        }
        for v in C.VIDEOS
    ]


def shows() -> list[dict]:
    rows = []
    for i, sh in enumerate(C.SHOWS):
        times = re.findall(r"\d{2}:\d{2}", sh.get("time", ""))
        rows.append({
            "slug": sh["slug"],
            "name": sh["name"],
            "tagline": sh.get("tagline"),
            "description": sh.get("desc"),
            "host": sh.get("host"),
            "days": sh.get("days"),
            "start_time": f"{times[0]}:00" if times else None,
            "end_time": f"{times[1]}:00" if len(times) > 1 else None,
            "image_url": image(sh.get("image")),
            "is_live": bool(sh.get("live")),
            "sort_order": i,
        })
    return rows


def schedule() -> list[dict]:
    show_slugs = {sh["name"]: sh["slug"] for sh in C.SHOWS}
    rows = []
    for group, slots in C.SCHEDULE_TABS.items():
        for i, slot in enumerate(slots):
            start, title, host = (list(slot) + [None, None])[:3]
            rows.append({
                "day_group": group,
                "start_time": start,
                "title": title,
                "host": host,
                "show_slug": show_slugs.get(title),
                "sort_order": i,
            })
    return rows


def podcasts() -> list[dict]:
    rows = []
    for pod in C.PODCASTS:
        rows.append({
            "slug": slugify(pod["title"]),
            "title": pod["title"],
            "show_name": pod.get("show"),
            "description": pod.get("desc"),
            "duration": pod.get("duration"),
            "image_url": image(pod.get("image")),
            "audio_url": None,
            "published_at": iso(datetime.strptime(pod["date"], "%d %b %Y").replace(tzinfo=UTC)),
        })
    return rows


def presenters() -> list[dict]:
    return [
        {
            "slug": slugify(p["name"]),
            "name": p["name"],
            "show_name": p.get("show"),
            "initials": p.get("initials"),
            "bio": p.get("bio"),
            "sort_order": i,
        }
        for i, p in enumerate(C.PRESENTERS)
    ]


def ticker() -> list[dict]:
    return [{"label": label, "text": text, "sort_order": i}
            for i, (label, text) in enumerate(C.TICKER)]


def settings() -> list[dict]:
    return [
        {"key": "station", "label": "Station details", "is_public": True, "value": {
            "name": C.BRAND["name"],
            "tagline": C.BRAND["tagline"],
            "email": C.BRAND["email"],
            "phone": C.BRAND["phone"],
            "studio": C.BRAND["studio"],
            "frequency": C.BRAND["frequency"],
            "frequency_extra": C.BRAND["frequency_extra"],
        }},
        {"key": "live", "label": "Live radio stream", "is_public": True, "value": {
            "stream_url": "",
            "show": C.LIVE_NOW["show"],
            "host": C.LIVE_NOW["host"],
            "topic": C.LIVE_NOW["topic"],
            "started": C.LIVE_NOW["started"],
        }},
        {"key": "publishing", "label": "Publishing pipeline", "is_public": False, "value": {
            "deploy_hook": "",
            "auto_publish": False,
        }},
    ]


def document() -> dict:
    return {
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "sections": sections(),
        "authors": authors(),
        "stories": stories(),
        "videos": videos(),
        "shows": shows(),
        "schedule_slots": schedule(),
        "podcasts": podcasts(),
        "presenters": presenters(),
        "ticker_items": ticker(),
        "settings": settings(),
    }


def dumps() -> str:
    return json.dumps(document(), ensure_ascii=False, indent=1)
