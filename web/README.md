# STX Trace — OSINT Workbench

A deployable web tool for **defensive, public-source OSINT**: deep-search a username across ~84
platforms, enrich an email (MX, provider, Gravatar profile, optional breach check), analyze a
phone number, correlate a name against Wikidata/ORCID, run **AI face verification (1:1)** entirely
in the browser, and synthesize everything into an **AI-written intelligence report**.

> **Authorized use only.** Public sources only — no authenticated scraping, no CAPTCHA/ACL bypass.
> Face verification compares two images you supply; it does not identify strangers from photo
> databases. You are responsible for lawful use in your jurisdiction.

## Modules

| Tab | What it does | Backend |
| --- | --- | --- |
| `@ Username` | Streams presence checks against 84 public profile URLs (status-code + soft-404 heuristics, login walls reported as *inconclusive*) | `POST /api/username` (NDJSON stream) |
| `✉ Email` | Syntax, domain MX records, provider/disposable detection, public Gravatar profile + linked accounts, optional Have I Been Pwned | `POST /api/email` |
| `☎ Phone` | Full E.164 parse/validation, country + line type, deep-search shortcuts | `POST /api/phone` |
| `◉ Identity` | Wikidata → Wikipedia candidates, ORCID researcher records, generated Google/X/GitHub/Reddit dorks | `POST /api/search` |
| `▣ Face verify` | Two-photo face verification with a128-d descriptor model — **runs100 % client-side** (TensorFlow.js), images never leave the device | none (static `/models`) |
| `☰ AI report` | Merges all findings into a structured brief; LLM narrative when configured, deterministic analyst template otherwise | `POST /api/report` |

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build && npm start   # production
```

## Deploy on Vercel

The project is a standard Next.js app — import the repo, set **Root Directory = `web`**, framework
= Next.js, and deploy. (CLI: `vercel --cwd web`.)

### Environment variables (all optional)

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables LLM-written reports via `/api/report` |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint override (default `https://api.openai.com/v1`) |
| `OPENAI_MODEL` | Model id (default `gpt-4o-mini`) |
| `HIBP_API_KEY` | Enables breach lookups on the Email tab |

Without keys everything still works: reports use the built-in heuristic engine, breach checks are
skipped with a visible note.

## Architecture notes

- **Next.js 15 App Router** — UI in `app/page.tsx`, serverless functions under `app/api/*`,
  shared types in `lib/`, site catalog in `lib/sites.ts`, report builders in `lib/report.ts`.
- **Streaming**: the username sweep emits NDJSON events so the UI updates as each check lands;
  `maxDuration = 60` bounds the serverless time budget.
- **Face models** are self-hosted in `public/models/` (tiny face detector + 68-point landmarks +
  128-d recognition net, ~7 MB, browser-cached) — no third-party CDN dependency.
- **Rate limiting** is best-effort in-memory per IP (per instance).
- Verdict bands for face distance: `≤0.45` match · `≤0.60` likely · `≤0.75` uncertain · `>0.75`
  different (euclidean, face-api descriptors).

## Limits (by design)

- No result can be "everything about a person" — only what is publicly reachable right now.
- Login-walled / bot-protected sites are reported as **inconclusive**, never as "not found".
- No paid data brokers, no account creation, no bypassing access controls.
