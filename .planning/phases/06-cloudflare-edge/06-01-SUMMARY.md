# 06-01 SUMMARY — Room Durable Object + Live Lab

**Status:** complete and deployed. **Commits:** `286e735` plan, `469aea4` schemas + pure reducers, `609cd4f` DO +
routes, `97587eb` live-lab feature, `249ab3d` smoke script.

## Built
- **`worker/schemas/room.ts`** (zod 4): upgrade query (`id`, `role`, `k`, `v`, `s`, `pv`) and every `ClientMessage`
  (strict objects, kebab ids, `NET_LIMITS` for poll text/options, ranges for `timeScale` 0.05–1 and `amplification`
  1–10). Typed `z.ZodType<ClientMessage>` / `<PresenterControls>` with `exactOptional`; a vitest type test asserts
  the schema output equals the contract types.
- **`worker/room-logic.ts`** (pure): unbiased room codes (rejection sampling over the 31-char alphabet), 32-char
  base64url host keys, timing-safe compare, `decideJoin` (protocol 4400, unknown private room 4404, host key 4401,
  room full 4503), token bucket (5/s, burst 10; drop with one `err rate`; 20 consecutive drops → 1008), UTF-8 frame
  size, presence from attachments (host excluded) + change detection, `mergeCtl` (seq+1), monotonic cue seq,
  poll tally, `reduceMessage` (message → effects), lazy alarm re-arm, expire-only-when-empty.
- **`worker/room.ts`** (I/O glue): hibernation API (`acceptWebSocket`, `serializeAttachment` `{id, role, vehicleId,
  suspensionId}`), `ping`→`pong` auto-response, rejected joins are accepted-then-closed so the browser sees the code;
  welcome (server time, presence, persisted ctl, poll tally), sync replies, presence flush ≤ 1 Hz with a timer only
  while dirty and no broadcast if the aggregate is unchanged, tally ≤ 2 Hz, SQLite `votes` (INSERT OR REPLACE, old
  polls' votes deleted when a new poll opens), ctl/poll persisted, 12 h alarm (re-armed at most hourly; postponed while
  sockets are connected; `deleteAll` when idle). RPC `init(hostKey)` claims a code once.
- **`worker/routes/rooms.ts`**: `POST /api/rooms` (RL_ROOMS by `cf-connecting-ip` → 429 `busy`; code retry ×3 → 503;
  `no-store`), other methods 405; `GET /ws/:code` (404 unless `LIVE` or a valid code, 426 without upgrade, forwards to
  `ROOM.getByName(code).fetch`); `GET /r/:code` → 302 `/remote.html?room=CODE` (private codes only).
- **`src/features/live-lab/`**: `room-service.ts` — ROOM service over `partysocket/ws` (0.5–1 s jittered min, ×1.5,
  max 8 s, `maxEnqueuedMessages: 0`, no reconnect on 44xx/45xx), 25 s `"ping"`, `/api/time` ×5 first fix, then
  8 WS probes at join, 2 every 30 s, 3 on tab visible; `time-sync.ts` (min-RTT best 3 of 16, first 3 samples jump,
  then ≤ 5 ms slew, > 1 s clock step jumps) → `clock.setOffset` → kernel live clock (§6.5). Pick sent on
  `sim:suspension`/`sim:vehicle` (500 ms trailing throttle) — ids only, never positions. Roles from flags:
  `?screen=1` creates a room (remembered in sessionStorage; recreated once on 4404), `?room=` joins as viewer (or
  screen), else `LIVE`. `store.room` kept current. Readout (`view.ts`, `live-lab.css`, tokens only): bottom-left glass
  chip "N in the lab", a 4 px distribution bar (own pick in accent) and a legend with the suspensions' short labels.
  Hidden until the welcome; hidden again on disconnect. `?e2e=1`: service provided, `connected: false`, no socket, no DOM.
- **`scripts/smoke-room.mjs [base] [--load N]`**: HTTP route checks, LIVE connectivity, private room with exact
  counts (2 viewers, pick propagation, clock sync vs `/api/time` and between clients), host key/forbidden/ctl/cue,
  poll + votes, validation/rate/size, close codes 4400/4404, leave, N-socket load with one observer.

Screenshot of the readout (1 browser + 3 socket viewers, local preview): "4 IN THE LAB", legend
"Multi-link 2 · Strut 1 · Wishbone 1", own pick (Strut) in accent.

## Deviations
1. **Extra close codes** 4404 (private code never created / expired) and 4503 (room full, cap 1000 sockets per room);
   §12.4 only names 4400/4401. Both are app-defined WS close codes, no contract type changes. The client treats
   4400–4599 as final.
2. **`/r/:code`** returns 404 for `LIVE` and malformed codes (only private rooms have an audience page).
3. **Join of an unknown private code is refused** (4404) so arbitrary codes cannot instantiate rooms without
   `POST /api/rooms` (which is rate limited).
4. **Welcome presence** uses the last broadcast snapshot when one exists (avoids O(N²) attachment reads during a join
   burst); the joiner is included in the flush ≤ 1 s later.
5. **Readout placement** bottom-left; 04-02 (HUD) can move `.sl-live-lab` if it collides.
6. **Tests**: `tests/features/live-lab-{time-sync,presence}.test.ts` (feature-owner rule §9.3.4) in addition to the
   `tests/worker/room*.test.ts` named in ROADMAP. The DO test drives the class with a fake `DurableObjectState`;
   node cannot build a 101 Response/WebSocketPair, so the upgrade path is covered by the smoke and the e2e spec.
7. The e2e spec's second test boots without `e2e` (uses `?debug=1` for hooks) to exercise the real DO in workerd;
   its boot budget is 60 s because two full-speed SwiftShader pages share a CPU.

## For 06-04 (presenter/poll)
`ctx.services.get(ROOM)`: `on('ctl' | 'cue' | 'poll' | 'welcome', h)` (returns the remover), `send(msg)`,
`code`/`role`/`hostKey`/`connected`. On a screen, `hostKey` is set once the room is created (async; listen for
`welcome` or watch `store.room.connected`). Initial `ctl`/`poll` arrive in `welcome`. Host messages from non-hosts get
`err forbidden`.

## Known gaps
- One DO per room, capped at 1000 sockets (research 17: shard tree needed above ~1.5k; v2 deferred item).
- Votes are one per anonymous client id (localStorage), not Sybil-proof.
- Clock sync error is bounded by half the path asymmetry (measured below: offsets of two clients agree to ~1 ms).
- Presence counts screens and audience phones as "in the lab" (contract: everyone but the host).

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (150 modules, 430 dependencies cruised)
 Test Files  43 passed | 1 skipped (44)
      Tests  471 passed | 11 skipped (482)
(06-01 alone: room-logic 27, room-schemas 7, room-do 13, room-routes 7, live-lab 12 tests)
$ npm run build            -> ✓ built (exit 0)
$ npx playwright test tests/e2e/06-01-live.spec.ts --trace off   (vite preview)
  ✓ e2e mode: live-lab is offline, provides no readout and causes no errors
  ✓ two viewers see each other and the suspension distribution (real Room DO in workerd)
$ node scripts/smoke-room.mjs http://localhost:4173 --load 300   -> all 11 checks ok
  load: 300 joined in 893 ms; 1 presence broadcast during the join
```
**Deployed** (authorised for this plan): `CI=1 WRANGLER_SEND_METRICS=false npm run deploy` from a clean tree at
HEAD `252e672` (includes other executors' committed 03-01/03-03/06-02/06-03 work up to that commit; only an untracked
03-01 SUMMARY was outside git). Version ID `4823517a-5bb3-446f-a3a7-9b10d29e79a9`, `/api/health` version `252e672`.
```
$ node scripts/smoke-room.mjs https://suspension-lab.zh-a16.workers.dev --load 300
ok   HTTP routes: /r/:code 302, /ws bad code 404, /ws without upgrade 426
ok   LIVE room: welcome + sync over the public room — 1 in the lab
ok   two viewers: presence 2 with their suspension distribution — viewers 2 {"multilink":1,"macpherson":1}
ok   pick: suspension change reaches the other viewer (coalesced, <= 1 Hz) — {"double-wishbone":1,"macpherson":1} after 1038 ms
ok   clock sync: ... — offset -6.7 / -5.6 ms (http -0.4), min RTT 37 ms, lap-time diff 1.1 ms of 83.72 s
ok   host: wrong key 4401, viewer ctl forbidden, host ctl reaches the screen with seq — ctl seq 1, viewers 3 (host excluded)
ok   poll: host opens, audience votes once each (re-vote replaces), tally broadcast — counts 0/2/0, closed with 0/2/0
ok   validation: bad message -> err, oversize -> 1009, flooding -> err rate
ok   protocol mismatch 4400, unknown private room 4404
ok   leaving updates presence — viewers 1
ok   load: 300 sockets in one room — 300 joined in 5203 ms; dist {"multilink":100,"double-wishbone":100,"macpherson":101}; 6 presence broadcasts during the join
smoke-room: all checks passed
$ npm run smoke:live -> all checks passed (version 252e672)
$ PLAYWRIGHT_BASE_URL=https://suspension-lab.zh-a16.workers.dev npx playwright test tests/e2e/06-01-live.spec.ts --trace off
  2 passed (1.5m)
```
