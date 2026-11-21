# 12-01 SUMMARY — Replays on D1 + Turnstile; worker frozen files

**Status:** complete, deployed, saving **ON** in production. Commits `84e90c9` (frozen files), `7828603` (route,
schema, migration, tests), `3f794a3` (CSP). Production `/api/health` → `3f794a3` (Version `23c505be-…`, then a
secret-only version from `wrangler secret put`), deployed from a private worktree of `3f794a3` (= `594a16a`, which was
already live, + only these three commits).

## In the Cloudflare account now
- **D1** `suspension-lab-replays`, id `012e9d77-53a2-46b2-b1df-57a244e5d078` (ENAM), migration `0001_replays.sql`
  applied `--remote` (and `--local` in the worktree for the local proof). Bound as `REPLAYS` (W1, id in both
  `wrangler.jsonc` and ARCH-M2 §W1). Proof rows deleted afterwards: table empty.
- **Turnstile widget** "suspension-lab replays", managed mode, domain `suspension-lab.zh-a16.workers.dev` (created via
  the API; the token had the permission). **Public site key `0x4AAAAAAGLbvJGTqk052mg6`** → 12-05 puts it in
  `src/features/replay/turnstile.ts`. Secret set with `wrangler secret put TURNSTILE_SECRET` (piped, never printed,
  never in the repo; the scratch copy was deleted). Rotate in the dashboard (Turnstile → widget → rotate secret) if needed.
- The switch: no `TURNSTILE_SECRET` ⇒ `POST /api/replays` = 503 `{"error":"not_configured","message":"Saving replays
  is not enabled on this server."}` (shown live before the secret was set). Turn off: `npx wrangler secret delete
  TURNSTILE_SECRET`.

## Built
- `wrangler.jsonc` = §W1, `worker/index.ts` = §W2 (SHA-256 pre-check matched `a69ed7a6806b…` / `86652866c350…`);
  `tests/arch/contracts-verbatim.test.ts` `M2_KINDS = 'CFW'`; `npm run typegen` → `REPLAYS: D1Database`;
  `worker/secrets.d.ts` (optional `TURNSTILE_SECRET`, `AE_SQL_TOKEN`); `worker/routes/insight.ts` 501 stub.
- `worker/routes/replays.ts` + `worker/schemas/replay.ts` + `worker/migrations/0001_replays.sql` (§12.1). POST order:
  secret present → `Content-Length` ≤ 96 KB and a streamed read capped at 96 KB (413) → UTF-8 JSON + strict zod
  envelope `{token ≤ 2048, data base64url}` (400) → data ≤ 87 382 chars / ≤ 64 KB decoded (413) → deflate-raw inflate
  capped at 1 MB (bomb → 400) → `decodeReplay` (CRC, ranges) and ticks/240 ≤ 600 s (400) → Limiter
  `getByName('replays')` 5/min per `cf-connecting-ip` + `budget: 2000`/UTC day (429 `busy`, 503 `daily_cap`) →
  siteverify (secret, response, remoteip; fail closed → 403 `turnstile`) → one D1 batch: purge ≤ 50 expired rows,
  insert, select by sha256 → 201 `{id, expiresAt}`. Any D1 error → 503 `storage_unavailable` (logged). GET: id regex
  (12 × `ROOM_CODE_ALPHABET`) → row with `expires_at > now` → 200 `public, max-age=300`; else 404 `no-store`. All other
  API answers `no-store` (W2 middleware). Stored: the validated compressed bytes (opaque) + sim_version, vehicle,
  suspension, seconds, bytes, sha256. No IP / UA / client id. Ids: `crypto.getRandomValues`, rejection sampling (~59 bits).
- `public/_headers`: `https://challenges.cloudflare.com` added to `script-src` and a new `frame-src` (nothing else).

## Daily cap and free-tier budget
**2000 saves/UTC day** (the contract's `REPLAY_API.perDay`, global via the Limiter DO). Measured on D1: one insert =
**4 rows written** (table + PK autoindex + sha256 unique + expires index), a purge delete about the same, so a capped
day costs ≈ 8k (insert) + ≤ 8k (purges of 30-day-old rows) ≈ **16k of 100k writes/day** — leaves 80 % for everything
else. Reads: GET = 1 row, save select = 1 row, purge scan = expired rows only: negligible against 5 M/day. The binding
limit is **storage** (Free DB 500 MB): typical replays are 0.4–11 KB (11-03 sizes), so even 2000/day × 30 days ≈
60k rows ≈ 60–660 MB at typical sizes; a full DB answers a labelled 503 and the client can still offer a fragment link
(≤ 60 s). Realistic event traffic is orders of magnitude below the cap. Note: requests that pass validation spend one
budget unit even if Turnstile then fails (Limiter runs before siteverify, per §12.1, so bursts never reach siteverify).

## Verification (real output)
- `npx vitest run tests/worker tests/arch`: all green except 12-03's in-progress `engineer-drive-facts.test.ts`
  (typecheck errors in its own file at the time); `tests/worker/replays.test.ts` **15 passed** (fake D1 on
  `node:sqlite` running the real migration, real `Windows` limiter for the burst, stubbed siteverify with the documented
  test secrets `1x…AA` pass / `2x…AA` fail): 503 off, 201+GET round-trip+dedupe, 600 s accepted, ten 400 cases, three
  413 cases, bomb 400, 403 fail / unreachable, 429 on the 6th, 503 daily_cap (no siteverify), purge 50/save, D1 error
  503, GET 404 malformed/unknown/expired, 405 listing, id format/uniqueness, insight 501.
- `npm run lint:deps`: `✔ no dependency violations found (277 modules, 980 dependencies cruised)`.
- **Local end-to-end** (private worktree build, `vite preview --port 4391`, real workerd + local D1 + real Limiter DO +
  real siteverify with the always-pass TEST secret in the worktree's `.dev.vars`), proof script
  `…/scratchpad/proof/proof.ts`: all 15 checks ok — 400 ×5, 413 ×2, save 201 `N43PNDYY6GWV`, no-store, expires 30.000 d,
  load 200 same bytes (`public, max-age=300`), dedupe same id, 404 ×2, burst `201,201,201,429,429,429,429,429`;
  separately: seeded expired row → GET 404, next save purged it (count 0).
- **Production** (`https://suspension-lab.zh-a16.workers.dev`, real secret): before the secret: labelled 503 shown.
  After: 400 ×5, 413 ×2, fake token → 403 `turnstile`, 404 ×2 no-store, seeded live row → 200 `public, max-age=300`,
  seeded expired row → 404 (expiry on read); `/api/insight` 501; CSP header as above.
  **Not provable from this sandbox:** the per-address 429 — the egress rotates over 30+ addresses (40 requests → 32
  distinct `cdn-cgi/trace` IPs), same finding as 07-02; the Limiter DO itself is shown live on `/api/engineer`
  (per client id: `400×6, 429, 429`) and the replays rule locally and in unit tests. Production purge-on-write and a
  real 201 need a solved Turnstile challenge (headless Chromium gets the widget iframe but no token, as expected).
- `PLAYWRIGHT_BASE_URL=<production> npx playwright test tests/e2e/07-02-delivery.spec.ts --trace off`: **2 passed**
  (zero CSP violations with the new policy). Turnstile under our CSP in headless Chromium on production: `api.js`
  loads, the `challenges.cloudflare.com` widget frame renders; the only violations reported were the widget iframe's
  own policy (source inside challenges.cloudflare.com), none of ours.
- `npm run check` (tree at `202cb11`): typecheck clean; `✔ no dependency violations found (277 modules, 985
  dependencies cruised)`; `Test Files 2 failed | 102 passed | 1 skipped (105)`, `Tests 2 failed | 1057 passed | 12
  skipped (1071)` — both failures in 12-03's files: `no-id-branching` flags `src/features/engineer/rules.ts`
  (suspension ids) and `engineer.test.ts` number grounding. All 12-01 tests and the verbatim test pass.

## Deviations
1. Dedupe uses `ON CONFLICT(sha256) DO UPDATE SET expires_at = excluded.expires_at` instead of `DO NOTHING`: re-saving
   the same bytes refreshes the 30-day link and can never hand back an expired-but-unpurged row. Same single row.
2. Purge uses `DELETE … WHERE id IN (SELECT id … LIMIT 50)` (plain `DELETE … LIMIT` needs a SQLite compile option).
3. `not_configured` is checked first (no budget spent, no body read while saving is off), and carries a `message`.
4. Non-POST on `/api/replays` → 405 (no listing).
5. The test reaches `node:sqlite`/`node:fs` through non-literal dynamic imports because the worker tsconfig has only
   the Workers types (no `@types/node`).

## Lifted code
None.
