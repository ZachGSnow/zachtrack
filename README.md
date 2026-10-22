# ZachTrack

**A local-first fasting timer and "track anything" PWA, with private two-way sync through your own Cloudflare account.**

[![CI](https://github.com/ZachGSnow/zachtrack/actions/workflows/ci.yml/badge.svg)](https://github.com/ZachGSnow/zachtrack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<!-- TODO: screenshot from sample data, saved under docs/ and referenced as ![ZachTrack](docs/screenshot.png) -->

## Why

Fasting apps and habit trackers each hold one slice of the picture, usually in
someone else's cloud. ZachTrack keeps fasts, body measurements, nutrition,
sleep, mood and anything else you define in one installable app that works
offline. Your data lives on your devices and in a D1 database in your own
Cloudflare account, behind Cloudflare Access, with no login code of its own.

## Features

- **Fasting timer** with preset methods (16:8, 18:6, OMAD and more) or count-up,
  a gauge ring with tappable metabolic-zone markers, and one fast per start day.
- **Trackables:** define anything to track, with number (optional unit),
  rating (custom scale) or yes/no fields. Each field chooses how several
  entries on one day combine (`sum` for Water, `last` for Weight, `average`).
  A starter set (Body Measurements, Vitals, Nutrition, Sleep, Wellness,
  Activity, Menstrual Cycle, Male Health) is created on a new install and is
  fully editable.
- **People and birthdays:** an "ages" display mode shows live ages and
  birthday countdowns instead of occurrence stats.
- **Tables first:** the Data tab, Journey and each trackable show rows per
  day, week or month with a 7-day rolling average or change vs the previous
  period, an Avg / Change / Per-week trend footer, and a Copy button that puts
  TSV on the clipboard. Each has a chart view (ECharts) behind a toggle.
- **BMI** derived from a Weight field and your height.
- **Offline and installable** (service worker, Android/Chrome PWA).
- **Two-way sync** across devices: per-record last-write-wins, deletes that
  propagate, conflicts reported instead of guessed, and a sync status pill
  with a per-device history of the last 5 syncs.

US units only (lb, in, &deg;F).

## Quick start

Needs Node.js 22 or newer.

```bash
git clone https://github.com/ZachGSnow/zachtrack.git
cd zachtrack
npm install
npm run dev
```

Open the printed URL. Without a sync backend the app runs local-only: data
stays in the browser's IndexedDB and the starter trackables are created on
first launch.

## Deploy your own (Cloudflare)

Everything below fits Cloudflare's free plan. Each deployment is separate:
your data goes to your account only.

1. **Config:** `copy wrangler.toml.example wrangler.toml` (Windows) or
   `cp wrangler.toml.example wrangler.toml`. `wrangler.toml` is git-ignored.
2. **Database:** `npx wrangler d1 create zachtrack-db`, put the printed id in
   `database_id`, then apply the schema:
   `npx wrangler d1 execute zachtrack-db --remote --file=./d1/schema.sql`
3. **Pages project:** `npm run build`, then
   `npx wrangler pages deploy dist --project-name=zachtrack --branch=main`
   (the first run creates the project).
4. **Custom domain:** Pages > zachtrack > Custom domains (dashboard).
5. **Access:** Zero Trust > Access > Applications > add a self-hosted app for
   your custom domain **and** `zachtrack.pages.dev`, with one Allow policy for
   your email and the One-time PIN login method. Then Pages > zachtrack >
   Settings > enable the access policy for preview deployments
   (`*.zachtrack.pages.dev`).
6. **Vars:** set `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN` and (recommended)
   `ACCESS_AUD` in `wrangler.toml`, then build and deploy again.

Install the app from your custom domain in Chrome (Add to Home screen).

## Configuration

All values live in `wrangler.toml` (start from `wrangler.toml.example`).

| Setting | Required | What it is |
|---|---|---|
| `database_id` | yes | Your D1 database id (`wrangler d1 create` prints it) |
| `OWNER_EMAIL` | yes | The only email the sync endpoint accepts; must match your Access policy |
| `ACCESS_TEAM_DOMAIN` | yes | Your Zero Trust team domain, e.g. `your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | recommended | The Access application's AUD tag (Access > Applications > your app > Overview) |

If `OWNER_EMAIL` or `ACCESS_TEAM_DOMAIN` is missing, the sync endpoint refuses
every request instead of running unchecked.

## Backups

D1 keeps point-in-time history for 7 days on the free plan. For longer,
`workers/backup/` is a small scheduled Worker that writes a restore-ready SQL
file of the whole database to a private R2 bucket every night at 09:00 UTC
(`zachtrack-db/YYYY-MM-DD.sql`). It has no public URL. A bucket lifecycle rule
deletes files after 30 days.

Set up once:

```bash
npx wrangler r2 bucket create zachtrack-backups
npx wrangler r2 bucket lifecycle add zachtrack-backups expire-30-days --expire-days 30
cd workers/backup
cp wrangler.toml.example wrangler.toml   # set database_id; git-ignored
npx wrangler deploy
```

Restore (replaces every row in the app tables):

```bash
npx wrangler r2 object get zachtrack-backups/zachtrack-db/2026-10-22.sql --remote --file=restore.sql
npx wrangler d1 execute zachtrack-db --remote --file=restore.sql
```

Restored rows get a new sync sequence number, so every device pulls them.
Devices then push their own local data as usual, and the newer version of each
record wins; to roll every device back too, clear the site data on each device
before it syncs again. The file is health data: keep it out of the repo and out
of synced folders, and delete it when done.

## How it works

- **Local-first:** every read and write goes through Dexie (IndexedDB). The UI
  never waits on the network.
- **Sync:** `POST /api/sync` is a Pages Function (`functions/api/sync.ts`) over
  D1. The client pushes its full dataset; the server upserts each record only
  if its `updatedAt` is newer, in a few batched queries per request (under the
  free plan's 50-subrequest limit). Pulls use a server-assigned sequence
  number as the cursor, so device clocks don't affect what gets pulled.
- **Auth:** Cloudflare Access does the login. The Function also verifies the
  Access JWT (RS256 signature against the team's published keys, issuer,
  expiry, audience, email), because `*.pages.dev` hostnames can reach it
  without Access (`server/access.ts`).
- **Input checks:** every incoming record is validated against the schema
  (`server/validate.ts`); a bad one is skipped and reported back, and the
  rest of the sync goes through.
- **Headers:** `public/_headers` sets a strict Content-Security-Policy
  (same-origin only, no framing), HSTS and related headers; sync responses
  are never cached.

Stack: Vite, Svelte 5 (runes), TypeScript, Tailwind CSS 4, Dexie,
vite-plugin-pwa, ECharts, Cloudflare Pages + Functions + D1 + Access.

[ARCHITECTURE.md](ARCHITECTURE.md) covers the design decisions, the sync
protocol, the real bugs hit along the way and how they were fixed.

## Your data and privacy

- **What is stored:** fasts, trackable definitions, entries (values, notes,
  tags, timestamps) and settings (height, goal weight).
- **Where:** in each browser's IndexedDB, and, if you deploy the backend, in
  your own D1 database. Nothing is sent anywhere else. The app has no
  analytics.
- **In what form:** plain JSON in IndexedDB and plain rows in D1. D1 is
  encrypted at rest by Cloudflare; the app adds no encryption of its own.
- **Deleting:** deleting a record removes it locally and marks it deleted in
  D1 (`deletedAt`), so other devices delete it too. The server also clears a
  deleted fast's or entry's notes, tags, ratings and values; a small row with
  the id, dates and `deletedAt` stays. For rows deleted before v1.0.1, run
  `d1/scrub-deleted.sql` once. Clearing site data removes the local copy;
  dropping the D1 database removes the server copy. Neither is a secure erase,
  and D1 Time Travel keeps earlier versions for 7 days.
- **Per-device only:** sync history and view preferences stay in that
  browser's `localStorage`.

## Testing

```bash
npm run check   # svelte-check + tsc for the app, configs, Functions and tests
npm test        # Vitest
npm run build
```

CI runs all three on Linux and Windows with Node 22 and 24.

**Verified by tests:**
- Day math across DST changes (run in `America/New_York`): streaks, ranges,
  calendar-day stepping. These tests failed on the earlier code and found real
  bugs.
- Same-day aggregation (`sum`, `last`, `average`) and the metric table rollups,
  rolling averages and TSV copy.
- Access JWT verification: valid tokens pass; forged, foreign-key, `alg: none`,
  expired, not-yet-valid, wrong-issuer, wrong-audience and wrong-email tokens
  fail; key caching, rotation, and at most one forced refetch per 5 minutes.
- The sync endpoint end to end against a local D1 built from `d1/schema.sql`:
  fail-closed config, round trip of every record type, last-write-wins,
  one-fast-per-day rejection, deletes vs newer edits, a 240-record push in
  one request, malformed records rejected one by one without failing the
  batch, unknown delete types skipped, content cleared on delete, and
  `d1/scrub-deleted.sql`.

**Verified by hand:**
- The Access certs format against a live team's `/cdn-cgi/access/certs`
  endpoint (RS256 keys that import with the same WebCrypto call the Function
  uses).
- Record validation against a copy of a real database: every live record
  passes.
- The CSP under `wrangler pages dev`: every tab and the charts render with no
  violations.

**Not verified by automated tests:** the Svelte UI, the service worker's
re-login flow (ARCHITECTURE.md 4.9) and Access's own redirects. Those are
checked by hand after a deploy.

## Health information

The fasting zone descriptions are general information, not medical advice.
Talk to a doctor before extended fasting.

## License

[MIT](LICENSE) &copy; Zach Snow
