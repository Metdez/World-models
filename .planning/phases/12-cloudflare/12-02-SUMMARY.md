# 12-02 SUMMARY — Room driver role

**Status:** complete, deployed. **Commits:** `cb481a8` reducers/schemas/lanes, `9242dc1` DO glue + route + smoke.
**Deploy:** from a private worktree at `9242dc1` (= live `3f794a3` from 12-01 + my two commits, nothing else);
production `/api/health` reports `9242dc1` (Version ID `3542a740-65d2-417f-be6e-6e4eb1fc20aa`). Contract unchanged.

## Built
- **Pairing.** `POST /api/rooms` generates a separate `driverKey` (same 24-byte base64url generator) and calls
  `ROOM.init(hostKey, driverKey)`; the DO stores both; the response carries `driverKey`. `role=driver` upgrades are
  accepted only in rooms with a stored driver key (LIVE and rooms created before this deploy → 4401) and stay
  `pending` until the first frame `{t:'auth',k}` matches the driver key (timing-safe compare; the host key is not
  a driver key). Keys never appear in URLs.
- **One driver, newest wins** (ARCH-M2 §12.2 / contract comment "one at a time, newest wins"): a newly authenticated
  driver closes every older authenticated driver with **4409 `replaced`** (a 4xxx code, so the old phone does not
  reconnect and two phones cannot ping-pong). Pending drivers count nowhere.
- **Rate lanes** (`LANES` in `room-logic.ts`): `general` 5/s burst 10 (unchanged for viewer/screen/host/audience),
  `driver` 90/s burst 30 for every frame of a driver socket, `tel` 5/s burst 5 for a screen's `tel` only (so the
  screen's own sync/pick budget is untouched). Over-rate → dropped + one `err rate`; 20 consecutive drops → 1008.
  Frame caps: driver 128 B, others 1024 B → 1009.
- **Point-to-point relay.** `in` from the authenticated driver → `{...in, r: Date.now()}` to `screen` sockets only;
  `tel` from a screen → the authenticated driver only; `in`/`tel` from any other role → `err forbidden`. Never
  broadcast, never stored, no `touch()` on this path. Sockets are accepted with their role as a hibernation tag, so
  targets come from `ctx.getWebSockets('screen' | 'driver')` (no scan of the audience; survives hibernation — the
  tag is the "role → socket set" of §12.2, kept by the runtime instead of an in-memory cache). The sender's
  attachment is cached in a `WeakMap` (no structured clone per 60 Hz frame).
- **Validation:** strict zod: `in` n u32, s −1000..1000, th/br 0..1000, f 0..7 (integers, no extra keys);
  `tel` v 0..999, g −1..12, m 0..3, k 0..3. `gst` still unparsed / forbidden (12-07).
- **Presence:** `drivers` (authenticated, 0 or 1) always present; drivers are not counted in `viewers`;
  `samePresence` compares it. Coalescing unchanged (≤ 1 Hz).
- **Hibernation:** no new timers, alarms or storage writes; caches (buckets, attachments) rebuild lazily.
- **Unchanged:** host auth, ctl/cue, poll/vote, LIVE, close codes 4400/4401/4404/4503, ping/pong auto-response.

## Hand-off to 12-04 (phone client) — exact sequence
1. Screen: `POST /api/rooms` → `{ code, hostKey, driverKey }`; QR `/remote.html?room=CODE#d=<driverKey>`.
2. Phone: `new WebSocket('wss://<host>/ws/<CODE>?id=<uuid>&role=driver&pv=3')` (no key in the URL).
3. On **every** open send first `{"t":"auth","k":"<driverKey>"}`. Anything else before the welcome → `err forbidden`.
4. Wait for `{t:'welcome', role:'driver', …}` (also carries presence/ctl/poll; the driver then also receives the
   normal low-rate broadcasts `presence`, `ctl`, `cue`, `poll` — ignore them).
5. Stream `{"t":"in","n":<u32>,"s":<-1000..1000>,"th":<0..1000>,"br":<0..1000>,"f":<0..7>}` (integers only; any
   extra key such as a client time is rejected as `bad-message`). Budget: 90 frames/s sustained, burst 30, all
   frames of the socket (including `sync`) share it; each frame ≤ 128 B. 30 Hz + edge frames + 1 Hz `sync` is
   ~40/s, well inside. The literal text `ping` is answered `pong` by the runtime.
6. Receive `{t:'tel',v,g,m,k}` from the screen (≤ 5/s).
7. Close codes: **4401** wrong key / room without driver key / LIVE (final: show "pair again"); **4409** another
   phone took the wheel (final); 4400 protocol; 4404 unknown room; 1009 frame > 128 B; 1008 sustained flooding.
   Reconnect (with a fresh `auth`) only on non-4xxx closes.
- Screen side: `role=screen` receives `{t:'in',n,s,th,br,f,r}` (`r` = room receive time, comparable with the
  `sync` offset for link age); drop `n` ≤ last (wrapping u32). Send `{t:'tel',v,g,m,k}` ≤ 5/s (own bucket, burst 5).
  `presence.drivers` flips 1 → 0 within ≤ 1 s of the phone's socket closing. **Driver-silence detection is the
  screen's job** (250 ms decay / 1 s Returning from frame arrival): the DO deliberately has no timers (hibernation),
  and a phone that sleeps without closing TCP produces no close event anyway.

## Verification (real output)
- `npx vitest run tests/worker/room*` → 64 passed (logic 33 incl. 5 driver tests, schemas 7, DO 18 incl. 4 driver
  tests: pairing/relay/isolation/takeover, 60 Hz × 30 s = 1800/1800 relayed in order with 150/150 tel and 30/30 screen
  syncs and no storage/alarm change, flood + 128 B cap, pre-12-02 room; routes incl. `driverKey`).
- `npm run check`: worker tsc fails only in `tests/worker/replays.test.ts` (12-01, `node:*` types); app/node tsc and
  depcruise clean; vitest 1024 passed, 3 failed + 1 file failed to load, all outside my files:
  `tests/worker/engineer-drive-facts.test.ts` (load), `tests/worker/engineer.test.ts` (number grounding) — 12-03 in
  progress; `tests/arch/no-id-branching.test.ts` (src/features); `tests/sim-core/replay.test.ts` allocation test.
- Local `vite preview` (workerd, private worktree, port 4391): `node scripts/smoke-room.mjs http://localhost:4391` →
  all 13 checks ok; 60 Hz × 30 s: 1800/1800, relay min 0.5 / p50 1.2 / p95 5.3 / p99 22.3 / max 104.8 ms.
- Production (`9242dc1`): `node scripts/smoke-room.mjs` → **smoke-room: all checks passed** (all M1 checks green):
  - wrong/host/LIVE driver keys closed 4401/4401/4401; pending `in` and viewer `in` → forbidden; presence viewers 3 + drivers 1
  - **60 Hz × 30 s: 1800/1800 delivered in order, 0 drops, 0 err; relay phone→DO→screen min 15.4 / p50 16.8 /
    p95 19.5 / p99 22.4 / max 60.0 ms** (both sockets from this container; min WS RTT to the edge 18 ms);
    audience/viewer/viewer received 0/0/0 `in`/`tel` frames; tel 150/150 to the driver
  - newer driver → older closed 4409, tel follows the new driver, drivers 1 → 0
- Production `--drive-hz 30 --drive-s 5 --load 100` (ROADMAP criterion ≥ 140/150): 150/150, p50 17.6 / p95 21.2 /
  max 24.5 ms; 100 sockets joined in 914 ms with 1 presence broadcast.

## Cost of a 1-hour demo (DO pricing, m2/21: incoming WS 20:1, outgoing free)
Incoming per hour at 60 Hz: 216,000 `in` + 18,000 `tel` (5 Hz) + ~7,200 `sync` (1 Hz, phone + screen) ≈ 241k
messages → **≈ 12.1k billed requests** (12 % of the Free 100k/day; $0.0018 at $0.15/M on Paid). At the 30 Hz the
phone will actually send: ≈ 133k messages → ≈ 6.7k billed. Outgoing relay (216k `in` to the screen, 18k `tel`) is free.
Duration: the streaming room stays awake ≈ 0.125 GB × 3,600 s = 450 GB-s/h (3.5 % of the Free 13,000 GB-s/day;
≈ $0.006/h beyond the Paid allowance). Storage rows written on the drive path: 0. Idle rooms still hibernate.

## Deviations / known gaps
- **"Second driver refused"** in the brief vs the binding ARCH-M2 §12.2 + frozen contract ("newest wins"): I kept
  newest-wins — the second phone takes the wheel and the first is closed 4409 (final). This is what lets a phone
  that lost its connection re-pair instantly. A room never has two drivers. If "first driver keeps it" is wanted,
  it is a one-line reducer change plus a contract comment change (orchestrator's call).
- The `screen` role is unauthenticated (M1 design): anyone who connects with `role=screen` receives the `in` stream
  and can send `tel` to the driver phone. The data is harmless (steering values, a speed readout); audience phones
  (`/remote.html`) never connect as screen. A screen key would need a contract change.
- No server-side "keep only the newest frame under screen backpressure": workerd exposes no `bufferedAmount` on the
  server socket. Latest-wins is the screen's `n` check; phones skip a tick when their `bufferedAmount > 0`.
- Not touched: `wrangler.jsonc`, `worker/index.ts`, contracts. No lifted code, no new dependencies.
