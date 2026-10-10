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

Drop image files into `love-site/photos/` using these exact names:

| File | Where it appears |
|---|---|
| `01.jpg` | Stop 1 — "the day it started" |
| `02.jpg` | Stop 2 — "windows down, no complaints" |
| `03.jpg` | Stop 3 — "no skip, ever" |
| `04.jpg` | Stop 4 — "3% battery, 100% happy" |
| `05.jpg` | Stop 5 — "any road, as long as it's ours" |
| `06.jpg` | Gallery — "you, mid-sentence" |
| `07.jpg` | Gallery — "the view you 'didn't' like" |
| `08.jpg` | Gallery — "golden hour, no filter" |
| `09.jpg` | Gallery — "laughing at absolutely nothing" |
| `10.jpg` | Gallery — "the road home" |
| `11.jpg` | Gallery — "blurry. favourite." |
| `12.jpg` | Optional poster frame for the video |

**Any missing photo is fine.** Empty slots fall back to a tinted gradient with a
small ♡ — they read as "waiting for a better photo of you", not as a broken image.

To use different filenames, edit the `src` attributes in `index.html`.

### Keeping it fast

Photos are the only thing that can make this slow. Aim for:

- **~200–400 KB each**, sized around **1600px** on the long edge.
- `.webp` works great — just rename `01.jpg` → `01.webp` and update the `src`.

A quick way to shrink them (if you have ImageMagick):

```bash
cd photos
for f in *.jpg; do
  convert "$f" -resize 1600x1600\> -quality 82 "${f%.jpg}.webp"
done
```

---

## Adding the video

Put one file at `love-site/videos/our-video.mp4`.

- Keep it **under ~15 MB** so it loads on her phone without crying.
- An **MP4 (H.264)** plays everywhere. An optional `.webm` also works:

  ```html
  <video id="reel" controls playsinline preload="metadata" poster="photos/12.jpg">
    <source src="videos/our-video.mp4" type="video/mp4" />
  </video>
  ```

- It auto-pauses when she scrolls away, so it never shouts over the rest.
- If the file is missing, a small note appears instead of a broken player.

---

## Changing the words

Everything personal lives in `index.html` as plain text:

- Her name — in `<title>`, the `<h1>`, and the boarding-pass `passenger` row.
- The five stories — inside `<article class="stop">`.
- The letter — the `<ul class="hand">` list.
- The closing — the `#ticket` section.

### A few tips

- Keep her name as `Gloria&nbsp;Colete` in the headline so it never wraps mid-name.
- The hero uses `<em>` for the second line — that's what gets the peach→lilac gradient.
- If you add a stop, duplicate a whole `<article class="stop">` block and give the
  copy an `id="stop-6"`, then add it to the `STOPS` array in `script.js`.

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
- **Every feature is isolated**, so if one fails (an odd browser, a missing file) the
  rest of the page still works.
- Respects `prefers-reduced-motion`: reduced-motion visitors get a single still frame
  instead of an endless road.

---

## Tests

```bash
cd love-site/test
npm init -y && npm i jsdom
node smoke.test.js
```

Boots the real `index.html` and `script.js` in a simulated DOM and checks the loader,
reveals, map, counters, audio, empty-photo fallbacks, and that no `NaN` ever reaches
the canvas across a full dawn-to-night sweep.