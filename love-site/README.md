# For Gloria Colete 💗

A single-page love letter disguised as an endless road trip. Scroll to drive — the
world carries you from dawn to midnight, and the words arrive at each stop.

**You do NOT need Google Drive for this.** See [Adding photos](#adding-photos).

---

## Run it locally

```bash
cd love-site
python3 -m http.server 4173
# open http://localhost:4173
```

Any static server works. There is no build step and no dependencies.

---

## Adding photos

Photos live in `love-site/photos/`. They are **WebP**, cropped to 4:5 (the polaroid
aspect) and sized for the web, so the page stays fast.

| File | Where it appears |
|---|---|
| `hero.webp` | Her portrait, top of the page |
| `01.webp` | Stop 1 — "the day it started" |
| `02.webp` | Stop 2 — "windows down, no complaints" |
| `03.webp` | Stop 3 — "no skip, ever" |
| `04.webp` | Stop 4 — "3% battery, 100% happy" |
| `05.webp` | Stop 5 — "any road, as long as it's ours" |
| `06.webp` | Gallery — "five more minutes" |
| `07.webp` | Gallery — "the outfit in question" |
| `08.webp` | Gallery — "the day we all turned up" |
| `09.webp` | Gallery — "the blue-hour version of you" |
| `10.webp` | Gallery — "caught mid-joke" |

**Any missing photo is fine.** Empty slots fall back to a tinted gradient with a
small ♡ — they read as "waiting for a better photo of you", not as a broken image.

### Replacing one

```bash
cd love-site/photos
convert YOUR_NEW_PHOTO.jpg -gravity north -resize 1200x1500^ -extent 1200x1500 \
        -strip -quality 78 06.webp
```

- `-gravity` picks which part survives the crop: `north` for portraits where the
  face is high up, `center` for full-body shots, `south` if her face is at the bottom.
- `1200x1500` is 4:5 — matching it means the browser never crops awkwardly.
- JPEG works too, just change the `src` extension in `index.html`.

---

## Adding videos

Clips live in `love-site/videos/`, named `clip-01.mp4` … `clip-08.mp4`. They appear
as the playlist under the main player — click any clip to swap it in.

To change the list, edit `CLIPS` near the bottom of `script.js`:

```js
const CLIPS = [
  { src: 'videos/clip-01.mp4', cap: 'the one that started it' },
  { src: 'videos/clip-02.mp4', cap: 'you, mid-sentence' },
  // ...
];
```

- The `cap` is the handwritten caption under the player — make them personal.
- Durations are read automatically from each file.
- Vertical phone clips automatically get a vertical frame, so nothing is letterboxed.
- The player pauses itself when she scrolls away, so it never shouts over the rest.

**Keep total video under ~15 MB** so it loads quickly on her phone.

---

## Changing the words

Everything personal lives in `index.html` as plain text:

- Her name — in `<title>`, the `<h1>`, and the boarding-pass `passenger` row.
- The five stories — inside `<article class="stop">`.
- The gallery captions — the `<figcaption>` under each `.shot`.
- The letter — the `<ul class="hand">` list.
- The closing — the `#ticket` section.

### A few tips

- Keep her name as `Gloria&nbsp;Colete` in the headline so it never wraps mid-name.
- The hero uses `<em>` for the second line — that's what gets the peach→lilac gradient.
- If you add a stop, duplicate a whole `<article class="stop">` block, give the copy
  an `id="stop-6"`, then add it to the `STOPS` array in `script.js`.

---

## Deploying to Vercel

**Easiest — drag and drop:**

1. Go to [vercel.com/new](https://vercel.com/new) → **Project** → *Upload…*
2. Drag the whole `love-site` folder onto the page.
3. Deploy. Done — no framework preset, no build command.

**Or with the CLI:**

```bash
npm i -g vercel
cd love-site
vercel          # preview
vercel --prod   # the real one
```

Because it's a plain static bundle, it deploys in seconds and costs nothing.

---

## What's actually going on

- **The road** is a real 3D projection drawn to `<canvas>` every frame — lane lines,
  rumble shoulders, roadside trees and lamps receding into fog. No images, no video.
- **Time of day** is driven by scroll position: dawn at the top, midday in the middle,
  golden hour at the gallery, stars by the letter.
- **The music** is synthesised live with the Web Audio API (a four-chord pad). There is
  no audio file — the top-right button starts and stops it.
- **The route map** inks itself in as you scroll, and each pin lights up when you reach
  that stop.
- **Photos** are cropped to 4:5 and lean toward the cursor as you move over them.
- **Every feature is isolated**, so if one fails (an odd browser, a missing file) the
  rest of the page still works.
- Respects `prefers-reduced-motion`: reduced-motion visitors get a single still frame
  instead of an endless road.

---

## Tests

```bash
cd love-site/test
npm init -y && npm i jsdom
node smoke.test.js      # expects a server running on :4173
```

Boots the real `index.html` and `script.js` in a simulated DOM and checks the loader,
reveals, map maths, counters, audio, the video playlist, that every photo URL actually
resolves, and that no `NaN` ever reaches the canvas across a full dawn-to-night sweep.