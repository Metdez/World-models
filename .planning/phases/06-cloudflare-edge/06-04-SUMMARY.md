# 06-04 SUMMARY — Presenter remote + poll + remote page

**Status:** complete (not deployed; the orchestrator deploys). **Commits:** `b951dd5` plan, `6d0c685` presenter,
`79c06e3` poll, `06c2f82` remote page. Later polish (card relayout, copy, sticky header, tests, e2e spec) was swept
into the orchestrator's WIP snapshots `351e06b`/`1376cb1` before I committed it.

## Built
- **`src/features/presenter/`** (screen only, `?screen=1`, not in e2e mode): `apply.ts` (pure) — `ctlStep(prev, next,
  currentVehicle, offered)` ignores stale/duplicate `seq`, applies only changed fields in a fixed order (vehicle before
  suspension), drops a suspension the target vehicle does not offer and unknown vehicles (no kernel warnings), re-asserts
  the suspension after a vehicle swap, seeks on a section change but never on the first state after a (re)load;
  `cueAction` (front wheel → `fl` / `f` for the motorcycle, whole car → `null`, replay → seek to the section start);
  `remoteLinks` (audience `/r/CODE`, host `/remote.html?room=CODE#k=KEY`). `qr.ts`: `uqr.encode` → one SVG path, colours
  from CSS. Card in the left column under the D5 vehicle tag (horizontal QR | code): presenter QR (warn-tinted) until the
  first host `ctl` arrives (or the room already has `seq > 0`), then the audience QR + short URL; flip button and a
  "Hide" fold to a `Join · CODE` pill; follows `hudVisible`. Cues also emit `room:cue`.
- **`src/features/poll/`**: bars card bottom-right above the D5 segmented controls (live → "Final result" for 20 s after
  close → hidden; a closed poll is not shown after a reload). Non-screen viewers in a private room get the same card with
  tappable options (vote chip). `bars.ts` (largest-remainder percentages, single leader).
- **`src/remote/`** (`remote.html` unchanged): own partysocket link (`connection.ts`: host with `#k=` key → stored in
  sessionStorage per room and the fragment removed from the address bar; audience otherwise; close codes →
  denied/gone/full/outdated states with recovery UI; 25 s ping). `catalogue.ts` from sim-core content (car, three
  suspensions with copy, 12 proving-loop sections) + contract motorcycle ids. Host panel: vehicle, suspension (+
  descriptor), view, x-ray, overlays (engineer lines), speed (real/half/quarter), amplify ×2.5, attract, camera cues,
  section grid (tap active = replay cue), poll (open preset "Which suspension should we run next?", live bars, close,
  "Run <winner>", new poll). Audience: waiting card with presence count → big ballot buttons with live bars and "Your
  vote" (re-vote replaces) → final result. Join form when no/unknown code. Tokens only, ≥ 48 px targets, sticky header.
- **Bundle:** remote = `remote-*.js` 11.6 kB + shared `ws-*.js` 21.8 kB (partysocket, contracts, sim-core content,
  ui/dom; source map checked: no three.js) — the spec asserts no `WebGLRenderer`/three in any script the page loads and
  < 80 kB total.
- **Redirect:** `vite preview` (workerd assets): `/remote.html?room=ABCDE` → `307 Location: /remote?room=ABCDE` (query
  kept); the browser keeps the `#k=` fragment across the redirect (verified in the e2e: host role reached via
  `/remote.html?…#k=`). `/r/CODE` → 302 `/remote.html?room=CODE` → 307 `/remote?room=CODE`. Production uses the same
  assets engine (`html_handling` default), so the same two hops are expected there.

## Deviations
1. Screen e2e page runs `?screen=1&quality=low&debug=1`, not `e2e=1`: e2e mode keeps the room offline by contract (§6.6),
   as in 06-01's second test.
2. Added the `overlay` (engineer lines) toggle — it is in `PresenterControls`; cheap.
3. Poll % maths duplicated in `src/remote/widgets.ts` (`shares`) and `src/features/poll/bars.ts` — depcruise forbids
   remote↔features imports; a unit test asserts both agree.
4. Unset `ctl` fields show the app's start state on the remote (`initialState()`), since the remote cannot see the screen.

## Protocol gaps (worker frozen; for the orchestrator)
1. **Host key in the WS upgrade query** (`/ws/CODE?…&k=KEY`, 06-01 design). The key never appears in page URLs, but the
   upgrade URL is a query string and Workers observability (`head_sampling_rate: 1`) logs request URLs. Fix needs a
   worker change (e.g. key in the first message or `Sec-WebSocket-Protocol`).
2. **No screen → host state echo / catalogue.** The remote cannot know what the screen actually runs (local changes,
   motorcycle availability, real preset ids). Motorcycle ids are the contract ids; the screen ignores unknown ones.
3. **No "host connected" signal** (presence excludes the host), so the screen flips to the audience QR on the first host
   `ctl` rather than on join.
4. **A closed poll cannot be cleared** (`poll: null` on a closed poll is a no-op); the screen hides it after 20 s locally.

## Known gaps / what looks off
- The 06-01 live-lab readout and the 04-03 telemetry card overlap at bottom-left (not mine; visible in screenshots).
- In debug mode the stats panel covers the vehicle tag (debug only).
- Votes are per anonymous client id (localStorage), as in 06-01.

## Verification (real output)
```
$ npx tsc -p tsconfig.app.json && npx tsc -p tsconfig.worker.json   -> OK
$ npx tsc -p tsconfig.node.json  -> 6 errors, all in other executors' files
  (tests/e2e/04-04-overlays.spec.ts, untracked tests/sim-core/_scratch/*)
$ npm run lint:deps  -> ✔ no dependency violations found
$ npx vitest run tests/features/presenter.test.ts tests/features/live-lab-presence.test.ts tests/worker
  Test Files 10 passed | 1 skipped (11); Tests 113 passed | 11 skipped (124)   (presenter.test.ts: 12 tests)
  Full `npx vitest run`: failures only in camera, linkage-parts, teaching-overlays, vehicle-view, kernel/app+loop,
  sim-core golden/simulation and untracked _scratch (other plans mid-work: ride7dof.ts modified, timeouts under load).
$ npx vite build --outDir <scratch>/dist0604 && npx vite preview --outDir <scratch>/dist0604 --port 4317
$ PLAYWRIGHT_BASE_URL=http://localhost:4317 npx playwright test tests/e2e/06-04-presenter.spec.ts --trace off
  ✓ presenter phone drives the big screen; audience votes show as live bars (2.6m)
  ✓ remote: redirect keeps the room, unknown rooms offer the code form at 360x640 (6.1s)
  2 passed (2.7m)
```
Screenshots (DPR 1): `06-04-screen-code.png`, `06-04-host.png` (390×844 full page), `06-04-host-360.png`,
`06-04-host-360-scrolled.png`, `06-04-audience.png`, `06-04-screen-poll.png` in the session scratchpad `shots/`.
