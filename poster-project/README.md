# Welcome-Home Poster — Talent Search Initiative CEO homecoming

Parametric poster generator (Pillow). One layout, three outputs in `out/`:

| File | Use |
|---|---|
| `out/poster_A3_print.png` / `.pdf` | A3 print @ 300 dpi |
| `out/poster_social_feed_1080x1350.png` | WhatsApp / Instagram feed |
| `out/poster_story_1080x1920.png` | WhatsApp status / IG story |

`index.html` is a small gallery page for previewing all three
(`python3 -m http.server 8080 --directory poster-project`).

## Swapping in the real assets

Drop files into `assets/` with these exact names — the script picks them up
automatically on the next `python3 poster.py` run (no code changes needed):

- `assets/ceo-photo.jpg` — portrait of the CEO (any orientation; centre-cropped to a circle)
- `assets/tsi-logo.png` — Talent Search Initiative logo (header, replaces the "TSI" badge)
- `assets/scottstechx-logo.jpg` — in place (dark-tile sponsor card)
- `assets/pizza-origin-logo.jpg` — in place (white sponsor card)

Extra sponsor logos: append them to the `cards` list in `poster.py`
(each is auto-fitted into a rounded card).

## Editing the copy

All text lives in the `CONTENT` dict at the top of `poster.py`
(name, title, message lines, footer credit, etc.).

## Rebuild

```bash
python3 -m pip install Pillow     # only runtime dependency
python3 poster-project/poster.py
```

Fonts (OFL): Montserrat family + Great Vibes in `fonts/` (git-ignored;
re-download: Montserrat from github.com/JulietaUla/Montserrat, Great Vibes from
google/fonts `ofl/greatvibes`).
