# STX Trace — OSINT Workbench (v2)

A deployable web tool for **defensive, public-source OSINT** with high-accuracy classification:

- **Username sweep** — live NDJSON stream across **230 public profile endpoints** with an accuracy
  engine: retries, login-wall/homepage-redirect detection, bot-challenge detection, soft-404 body
  markers, username-echo verification and per-hit **confidence scoring** (high/low).
- **Email intelligence** — MX + NS + SPF + DMARC + BIMI + DKIM-selector posture, RDAP domain
  registration (registrar, created/expires, registrant), provider/disposable detection,
  address-format derivation, public Gravatar profile + owner-linked accounts, optional HIBP breach
  check, reverse-image dorks (Google Lens / Yandex / Bing / TinEye).
- **Phone analysis** — E.164/RFC3966 parse, country + line type, likely timezones, spam-registry
  and social dorks, WhatsApp draft link.
- **Identity deep search** — one name fanned across **seven sources**: Wikidata, Wikipedia, ORCID,
  Stack Exchange, GitHub, GitLab, Hacker News — plus 14 generated dorks.
- **AI face verification (1:1)** — runs 100% client-side. Fast (Tiny) or **Accurate (SSD
  MobileNet)** detector, 128-d descriptors, age/gender/expression read-outs, multi-face handling
  (largest face wins), landmark/box overlays, light-quality checks. Images never leave the device.
- **AI report** — deterministic **exposure score (0–100)** with factor breakdown, then an LLM-written
  brief (when `OPENAI_API_KEY` is set) or a deterministic analyst template.

Extras: variant username scanning (`john_doe → johndoe, john-doe…`), retry-inconclusive,
CSV/JSON export, filter + strict mode, contextual dork grids on every tab.

> **Authorized use only.** Public sources only — no authenticated scraping, no CAPTCHA/ACL bypass.
> Face verification compares two images you supply; it does not identify strangers from photo
> databases. You are responsible for lawful use in your jurisdiction.

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Deploy on Vercel

Standard Next.js app — repo root directory `web`, framework Next.js, build `npm run build`.
CLI: `vercel --cwd web`. (The `stx-trace` project is already connected to this repo.)

### Environment variables (all optional)

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | LLM-written reports in `/api/report` |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint override |
| `OPENAI_MODEL` | Model id (default `gpt-4o-mini`) |
| `HIBP_API_KEY` | Breach lookups on the Email tab |

Without keys everything still works (heuristic report engine, breach check skipped with a note).

## Architecture

- **Next.js 15 App Router** — UI split into `components/*-panel.tsx`, serverless functions under
  `app/api/*`, shared types in `lib/`, site catalog in `lib/sites.ts` (230 entries),
  report builders in `lib/report.ts`, exposure scoring in `lib/score.ts`, dork engines in
  `lib/dorks.ts`.
- **Streaming**: `/api/username` emits NDJSON; `maxDuration = 60`, concurrency 20, deadline-aware
  so partial scans always finish cleanly.
- **Accuracy rules** (per site): 404 → missing · soft-404 marker → missing · login/homepage
  redirect → inconclusive · bot challenge → inconclusive · 403/429 → blocked · 200 + found marker
  or username echo → found (high) · 200 without echo → found (low confidence, flagged).
- **Face models** self-hosted in `public/models/` (~13 MB: tiny + SSD detectors, landmarks,
  recognition, age/gender, expressions) — no third-party CDN dependency.
- **Rate limiting** best-effort in-memory per IP (12 scans/min on the sweep endpoint).

## Limits (by design)

- No tool finds "everything about a person" — only what is publicly reachable right now.
- Login-walled / bot-protected sites are **inconclusive**, never "not found".
- No paid data brokers, no account creation, no bypassing access controls.
