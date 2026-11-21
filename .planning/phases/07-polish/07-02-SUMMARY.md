# 07-02 SUMMARY — Delivery hardening

**Status:** complete, deployed. **Commits:** `c0ea9e1` limiter, `ea792b2` protocol 2 (most of it was swept into the
orchestrator's WIP snapshot `ad02f6b` before I committed), `481e0e8` limit proof, `ec88231` CSP, `c78269c` fixture +
colour comment, `56b1eb4` bundle split + API no-store (spec timeout tweak swept into a WIP snapshot).
**Deploys** were made from private worktrees so that other executors' WIP snapshots (camera etc.) were not shipped:
`dcd7a86` = `96e8bcd` + my limiter/protocol files, then `eb9eda0` = `dcd7a86` + my later files. Neither commit is
on the branch; production `/api/health` reports `eb9eda0` (Version ID `e4baf902-6aa7-45a7-8f70-82ae2bb63ac0`).

## Built
1. **Global rate limits** — `worker/limiter.ts`: `Limiter` Durable Object (SQLite class, migration `v2`), one instance
   per route (`getByName('engineer' | 'rooms')`). Fixed 60 s windows counted for every request (valid or not, so the
   proof spends no neurons); engineer 6/min per `x-client-id` (else IP) + 40/min per IP; a UTC-day budget of 300 model
   calls (~6.6k of the 10k free neurons), after which the answer is the labelled rule answer (log outcome `budget`).
   Limiter unreachable → rule answer (never unmetered model calls). Rooms 10/min per IP. `RL_ENGINEER`/`RL_ROOMS`
   bindings and the per-isolate memory limiter removed.
2. **Host key out of the URL** — protocol 2 (`PROTOCOL_VERSION` 2; stale clients get 4400): host connects without
   `k=`, sends `{t:'auth', k}` as the first frame after every open; pending hosts get no welcome and no privileges;
   wrong key → close 4401. Cheap gaps closed: `PresenceSnapshot.hosts` (screen flips to the audience QR when the phone
   connects), `poll: null` on a closed poll clears it (remote: "Clear from screen"). Not done: screen → host
   state/catalogue echo (needs a new message + remote UI; deferred).
3. **CSP enforced** (`public/_headers`): `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'
   blob:; connect-src 'self' wss://suspension-lab.zh-a16.workers.dev blob: data:; img-src 'self' data: blob:;
   media-src 'self' blob:; font-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
   frame-ancestors 'none'; manifest-src 'self'` (no `unsafe-inline`, no `wss:` wildcard). A custom domain must be added
   to `connect-src` (or rely on CSP3 `'self'` ws matching).
4. **Bundle split** — `three` vendor chunk (three + postprocessing + camera-controls; cache-stable across deploys,
   parallel download); stats-gl (debug only), uqr QR encoder (big screen only) and the cafe-racer body visual (on
   first motorcycle use) are dynamic imports. Remote stays three-free (remote.html preloads only `ws-*.js`).
5. **API** — every `/api/*` answer gets `Cache-Control: no-store` unless set (404s/405s included).
6. **Leftovers** — `tests/fixtures/06-02-telemetry-carousel.json` regenerated from the sim (carousel at peak lateral
   g, MacPherson, through the client's `buildTelemetry`), engineer tests updated to its numbers; `COMPONENT_COLORS`
   comment says sRGB (contract + ARCHITECTURE).
7. Coordinator check: no deprecated Workers AI model in use (gemma-4-26b + glm-4.7-flash; both answered 200 via REST
   today); a 410 from both models already degrades to the labelled rule answer (test added).
   `run_worker_first` stays `/api/*`, `/ws/*`, `/r/*`.

## Bundle sizes (client, `vite build`)
| | before (HEAD at start) | after |
|---|---|---|
| main entry | 1,282.86 kB / 399.66 kB gzip | 290.17 kB / 109.96 kB gzip |
| three vendor (first paint) | — | 928.58 kB / 269.66 kB gzip |
| first-paint JS total | 1,282.86 / 399.66 | 1,218.75 / 379.62 (−5 %) |
| lazy | N8AO 204.7 | N8AO 204.7, stats-gl 33.1, cafe racer 14.4, QR 10.9 |
| remote | 11.7 + ws 21.8 | unchanged (no three) |
Honest note: first paint needs three, post and the sim; the remaining large wins (postprocessing 140 kB,
camera-controls 44 kB, engineer panel 14 kB) live in renderer/camera/engineer, owned by 07-01/07-03 — not touched.

## Deviations
- ROADMAP's 07-02 row (preload hints, weighted loading progress, preloadError reload, payload budget, offline e2e) was
  superseded by the orchestrator's brief for this run; none of those were done.
- `scripts/smoke-room.mjs` (07-04's) updated: protocol 2 auth frame, hosts + poll-clear checks, and a base-URL
  argument bug (without `--load`, the URL argument was ignored and production was hit).
- Per-address limit cannot be proven from this sandbox: the egress proxy rotates source IPs
  (`api.ipify.org` returned 3 different addresses in 6 calls). Unit-tested; the proof script reports it as info.

## Verification (real output)
```
$ node scripts/smoke-engineer-limit.mjs            # production, eb9eda0
ok   per client id: 6 allowed, request 7 limited — [400, 400, 400, 400, 400, 400, 429]
ok   concurrent burst of 10 from one client id: 6 passed, 4 limited
info per address with rotating client ids: first 429 at request none (41 if every request left from one address)
$ node scripts/smoke-engineer-limit.mjs --model     # production, dcd7a86 (1 model call)
ok   per client id: 6 allowed, request 7 limited — [200 model, 400, 400, 400, 400, 400, 429]
$ node scripts/smoke-room.mjs --load 100           # production: all 11 checks ok (host auth frame, hosts 1, poll cleared)
$ node scripts/smoke-room.mjs                      # production eb9eda0: smoke-room: all checks passed
$ curl production: / CSP enforced (above), max-age=0 must-revalidate; /assets/three-*.js max-age=31536000, immutable;
  /remote.html?room=ABCDE -> 307 /remote?room=ABCDE; /r/ABCDE -> 302 /remote.html?room=ABCDE;
  /api/health, /api/time, POST /api/engineer 400, /api/nope 404: all cache-control no-store
$ PLAYWRIGHT_BASE_URL=http://localhost:4373 (private build) playwright test 06-01 06-04 07-02 --trace off
  06-01 ×2 ✓, 06-04 ×2 ✓ (QR now lazy), 07-02 remote ✓; 07-02 CSP test timed out booting under load average 21,
  re-run alone ✓ (3.0m) after raising its boot budget to 150 s
```
Production e2e and `npm run check`: see the final report.
