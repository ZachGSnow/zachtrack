# Browser tests

Playwright tests against the production build, served by `wrangler pages dev`
so the real service worker, `public/_headers` (CSP) and the sync Function are
used. Chromium at Pixel 7 size, in `America/New_York`.

```bash
npx playwright install chromium   # once
npm run e2e
```

`playwright.config.ts` builds the app and starts the server itself. Locally an
already running server on port 8789 is reused, so stop it after changing code.

| File | What it covers |
|---|---|
| `app.spec.ts` | Service worker blocked, sync responses faked: a fresh local-only install, sample data imported through Profile > Import file and shown on the trackables, detail, Journey and Data screens with no console or CSP errors, imported settings shown, "Login expired" with Log in again, refused records listed by name, a trackable chart line keeping its pill's color when an earlier field is hidden, a field renamed and given a new unit in the edit sheet with BMI still following the renamed weight field, the Navy body-fat column right after BMI with its Profile settings, trackable kinds and goals, one-tap logging with undo, the home-screen shortcuts, the fasting schedule and hit rate, and pinning, archiving, reordering and tag filters. |
| `sync-timer.spec.ts` | Service worker blocked: a fast started and then ended on another device arrives through sync pulls and the Fasting tab follows it without a reload; starting and ending a fast on this device still works. |
| `service-worker.spec.ts` | The real generated service worker: the app shell opens offline, while `?reauth=`, `/cdn-cgi/` and `/api/` navigations are never answered with it (ARCHITECTURE.md 4.9). Emptying `navigateFallbackDenylist` makes four of these fail. |
| `sample-data.ts` | Three weeks of fictional sample data for the starter trackables (weekly waist, neck and hip in one entry), relative to today, from a seeded generator. Also used for the README screenshots. |
| `screenshots.capture.ts` | `npm run screenshots` only (not part of `npm run e2e`): imports the sample data and writes `docs/screenshots/*.png` at phone size. Look at every image before committing it (standards: normal operation, sample data only). |

Data only ever lives in the test browser's own storage; nothing reaches
Cloudflare. The sync Function is reachable, but without an Access token it
refuses every request, which is what the service worker tests rely on.
