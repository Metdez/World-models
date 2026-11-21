# 12-04 SUMMARY — Phone driver

**Status:** complete (not deployed; the orchestrator deploys). **Commits:** `4904b89` plan, `20b6f5f` screen side,
`0ce2b83` remote driver panel, `e5efbd9` e2e, plus a fix commit (recovery actions, remote target shape, spec cleanup).
Earlier states of `src/remote/driver-panel.ts`, `tilt.ts`, `driver.css` were swept into WIP snapshot `ab3c45e`.
Worker, contracts, `wrangler.jsonc` untouched; 12-02's protocol was sufficient.

## Built
- **live-lab:** `room-service.ts` keeps `driverKey` from `POST /api/rooms` (stored with the screen room in sessionStorage)
  and exposes it as `ROOM.driverKey`. Rooms remembered from before this build have no key → the feature stays inert.
- **phone-drive (screen, `?screen=1`, never in e2e mode):**
  - Card "Drive from your phone" (right edge, vertically centred, the right column's free band): QR to
    `/remote.html?room=CODE#d=<driverKey>` (key only in the fragment; uqr chunk loaded lazily; a copy of presenter's
    `qr.ts` since features never import each other). Folds to its status line once a phone is connected
    ("Phone connected · press Gas to drive" / **"Driven from a phone"** + link word), "Show code" unfolds.
  - `'phone'` DRIVE source (`drive.addSource`): goes through the drive feature's arbiter, takeover edges, hysteresis,
    HumanDriver conditioning and aids (no bypass). Deliberate = phone asks to drive (flag 1) + input past small dead zones.
  - `link.ts` (pure): u32 sequence (latest wins; a jump back > 64 = a newer phone's stream, since the relay is ordered),
    one-packet interpolation whose period is the `r` spacing (downlink bunching does not stretch it), no extrapolation;
    silence > 250 ms → decay to neutral over 300 ms with a gentle brake (only when moving: a held brake at a standstill
    selects reverse); ≥ 1 s or `presence.drivers` 1→0 → lost → `drive:request auto` (Returning on/near the loop,
    immediate release from the annex — rule copied from drive/handback.ts) + top-centre note "Phone controller lost ·
    The car is returning to the lap". **Silence is counted per screen frame, each frame adding ≤ 100 ms**: a screen
    whose own main thread stalls (queued messages) does not blame the phone (found in e2e, see below).
  - The phone's "Hand back" (flag 1 falling edge) → Returning. Link badge: room→screen transit (synced clock) + silence,
    amber > 150 ms / red > 250 ms, worst level held 1 s. `tel` every 0.21 s (≤ 5/s, the room's tel bucket never drops)
    while a phone is present: km/h, gear, mode index, k bits (1 = `strike` event, 2 = `slide` event) only while the
    phone drives. While a phone drives, the drive feature's WASD hint row is hidden (CSS from phone-drive.css).
- **Remote driver panel (`src/remote/driver-panel.ts`, `tilt.ts`, `driver.css`):**
  - `#d=` key → sessionStorage (`sl-remote-driver:CODE`), fragment scrubbed; a fresh `#d=`/`#k=` replaces the other
    role's key. Socket `role=driver`, `{t:'auth'}` first frame on every open; close 4409 → "replaced" (final, no
    ping-pong; "Take the wheel back" reconnects = newest wins), 4401 → "This driving code has expired" + "Join as
    audience", 4404 → "Room CODE has ended" + "Enter a code"; full/outdated banners as before.
  - Landscape (844×390, 667×375): drag slider left (relative drag, 4 px dead band, spring back), speed/gear/mode +
    buttons centre, GAS over BRAKE right; tilt: BRAKE left / GAS right with a rotating wheel glyph. Portrait stacks.
    Targets ≥ 48 px, no scroll, pinch zoom off while driving.
  - Tilt: button → `DeviceMotionEvent.requestPermission()` called synchronously in the tap (no await before it),
    gravity `atan2(x, y)` relative to a captured neutral, sign learned from a "turn right" sample (≥ 10°), dead zone
    3°, lock 35°, exponent 1.4, One-Euro (1.5 Hz, 0.01, 1 Hz) on the angle; flat phone holds the last value; no motion
    events within 1 s → back to the slider with "open in Safari or Chrome". Re-centre button.
  - 30 Hz frames + immediate frames on pedal edges (press = 0.25 bite then 6/s ramp, release −0.25 then 12/s);
    tick skipped while `bufferedAmount > 0`; random initial sequence; no sending while hidden. Wake lock on the first
    touch, re-acquired on visibility. `tel` → speed/gear/mode text; `navigator.vibrate` ([12] kerb, [30] grip) where it
    exists (not iOS). Badge: median round trip of 1 Hz `sync` probes; "No screen" when `tel` is > 1.5 s old.

## Measured (local two-page run, private `vite preview`/workerd, port 4391, same machine)
- Phone input event → `in` frame at the screen's JS, n = 20: **min 5, p50 19, p90 32, max 34 ms** (other runs:
  p50 20–25, max 32–38). Includes the 30 Hz tick quantisation; local network only (production relay p50 ≈ 17 ms
  per 12-02 would add to this).
- Phone input event → the screen simulation's conditioned steer demand crossing ±0.05, n = 20: **p50 67–82 ms**,
  p90 86–99 ms in three runs, one run p90 493 / max 569 (the conditioned demand at speed is shaped by the steering
  limit/countersteer help, so some flicks cross the threshold late; not a link delay).
- Phone page closed → screen out of Manual: **1024–1076 ms** (Returning or immediate release).
- Phone bundle: 2 scripts, 23.2 kB + 23.8 kB (8.9 + 8.7 kB gzip), no three.js / `WebGLRenderer` (asserted).

## Verification (real output)
- `npm run check`: typecheck clean; `✔ no dependency violations found (285 modules, 1008 dependencies cruised)`;
  `Test Files 106 passed | 1 skipped (107)`, `Tests 1092 passed | 20 skipped (1112)`. (An earlier run had one
  failure in `tests/sim-core/path-driver.test.ts` "median step ≤ 25 us" timing under load — not mine, passed on rerun.)
- `tests/features/phone-drive.test.ts` 23 tests (seq order/new stream, failsafe timeline, stall cap, presence drop,
  interpolation from `r`, tel packing; tilt maths with synthetic gravity vectors: portrait, both landscapes, upside
  down, three axis-sign conventions, crooked neutral, sign learning across ±180, curve; One-Euro; slider/pedals; frame
  packing < 128 B; `#d=` parsing; close codes). `tests/features/live-lab-driver.test.ts` 2 tests.
- E2E `tests/e2e/12-04-phone.spec.ts` (`--trace off`, `?quality=low`, private build + preview, config restored after the
  preview was up), with `06-04-presenter.spec.ts` in the same run: **4 passed**.
  1. Rendered 1440×900 screen + CDP-touch phone: card + QR, pairing, key scrubbed, card paired, layout at 844×390 and
     667×375, GAS → Manual + "Driven from a phone", speed on both, drag right → steer right, tilt flow with synthetic
     `DeviceMotionEvent`s (sensors granted; this Chromium has `requestPermission`), second phone → first "replaced"
     and stays closed, second phone drives at once, close → leaves Manual + note, wrong key → sheet → audience,
     unknown room → sheet, bundle check.
  2. Screen without the render loop (`features=-renderer`): latency numbers above, close → out of Manual < 1.5 s,
     a non-screen viewer has the feature on and shows nothing.
- Screenshots (looked at): `…/scratchpad/shots/12-04-screen-card.png`, `12-04-screen-driving.png`,
  `12-04-screen-failsafe.png`, `12-04-phone-driving.png`, `12-04-phone-667.png`, `12-04-phone-tilt.png`,
  `12-04-phone-replaced.png`, `12-04-phone-denied.png`.

## Deviations / known gaps
1. **Tilt was not tried on a real phone.** Only synthetic gravity vectors (unit tests) and synthetic DeviceMotionEvents
   (e2e). iOS permission flow, sensor rates and axis signs on real devices are untested; haptics untested.
2. "Brake to a stop then hand back": the decay brakes gently (0.5) from 250 ms and the hand-back happens at 1 s (the
   roadmap's "Returning within 1.5 s"); the car is not necessarily stopped when the autopilot takes it.
3. Headless SwiftShader starves the rendered screen's message tasks (frames reach its JS in 1–3 s bursts); this is why
   silence is counted per frame with a 100 ms cap, and why the timed checks run on a screen without the render loop.
   Badges on that rendered screen flicker amber and the phone shows "No screen" in screenshots for the same reason.
4. `06-04-presenter.spec.ts` leaves its contexts open (its screen keeps rendering for the rest of the worker); my spec
   closes its own. In a full-suite run this can slow later specs.
5. `readRemoteTarget` returns `driverKey` only when present so 06-04's `presenter.test.ts` stays unchanged.
6. The `in` frame has no client timestamp (contract), so the screen badge measures room→screen + silence only; the
   phone badge measures its round trip to the room. A phone→screen one-way figure needs both (rehearsal: compare).
7. The screen role is unauthenticated (12-02 note): anyone joining as `screen` would get the `in` stream.

## Lifted code
None (One-Euro written from the published algorithm, Casiez et al. 2012; formulas from research m2/17).
