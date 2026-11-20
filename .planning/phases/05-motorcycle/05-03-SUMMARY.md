# 05-03 SUMMARY — Motorcycle integration

**Status:** complete (no deploy). Commits: `e5330c4` hardpoint fixes, `802572f` registration + insights, `49882ac`
telemetry, `2fe2c97` / `6ea0121` camera, `c13534e` attract, `2a628d6` integration tests, the glyph-range fix, and this
summary. The e2e spec and the engine/spoke visual rework were swept into the orchestrator's WIP snapshot `adf0322`
before I committed them; their content is what was tested.

## Built
- **`motorcycle/index.ts`**: registers the cafe racer, Classic / Modern / Telelever and both 05-02 visuals. The
  HUD's vehicle toggle (04-02) and the phone remote's `cafe-racer` / `moto-*` ids (06-04 `ctlStep`) work unchanged.
- **Hardpoints (05-02 known issues):**
  - Modern: `rockerShock` and `shockTop` are turned −30° about `rockerPivot`. A rigid rotation in the plane leaves
    the motion-ratio curve identical; MR is 0.327 → 0.492, against 0.491 before, which is rounding. The shock now
    leans forward, and every point of it stays within 0.21 m of the swingarm pivot. The tyre never comes closer
    than 0.24 m, so the clearance is at least 36 mm at all travel. The swingarm brace moves 0.1 m ahead of where the
    shock crosses the arm.
  - Single-sided: the shock carries y = −0.165, which puts it on the arm's side, outboard. The visual's workaround is
    removed.
  - The moto goldens are updated, because the hashes include the posed points: modern `49727a3b`, telelever
    `ef5f24be`, classic unchanged. The metrics report is otherwise identical.
- **Camera (rig.ts):**
  - Bike chase framing: distance 3.5–4.5 m, height 1.3–1.55 m, aim 0.62 m. Orbit and front-view shots are scaled
    ×0.62.
  - Bike close-ups are side views filmed in the **un-leaned** body frame with a level horizon, so the camera never
    rolls 40° or sinks under the road on the lean side:
    - f: aim half-way up the fork legs;
    - r: aim between the axle and the swingarm pivot, framing the shock and arm.
  - A single-sided arm is filmed from its own side. The layout is re-read when the suspension changes.
- **Telemetry:**
  - For a bike, the hero stat and the first tab read "Lean". It is the same TRUE field: a bike's wheel camber to the
    road is its lean.
  - The needle spans ±50° instead of ±6°.
  - Travel is the default trace on the bike.
  - The 2-corner F/R layout already existed.
- **Insights:** three single-track rules.
  - `lean` (roll phenomena): chip "Lean · lateral".
  - `fork-dive` (brake zone): chip "Travel front · trail · pitch". These are live TRUE values, so the Telelever's
    small trail drop shows by itself.
  - `squat` (launch, hairpin exit, run-in): chip "Travel rear · anti-squat", using the geometric `antiPitch`.

  The car's brake-dive and steer rules no longer fire for a bike. The swap delta chip compares travel instead of
  camber on a single-track vehicle. No template has digits or ranks a type (the existing tests check this).
- **Attract:** an 8 s bike beat after the car's brake dive. It shows the motorcycle in the fork close-up through the
  brake zone, captioned "On two wheels, the fork takes it.". The loop is still 60 s.
  - `vehicleId` is snapshotted and restored on exit.
  - The visitor's suspension is re-applied one frame after the vehicle returns, so the kernel's reset on a vehicle
    swap cannot overtake it.
- **Overlays:** no change needed. The 2-corner frame draws a force line and an IC for each end, crosses at the rest
  points and the motion-ratio trace.
- **Looks (second priority):** `visual/**`, about +3k triangles, draw calls unchanged.
  - The block is two round barrels with twin-lobed fins and a filleted waist (13 thicker fins), under a deeper-finned
    head.
  - The cam cover has a twin dome and a polished parting line, with plug caps on top.
  - The alternator cover and the clutch boss are domed, each with a polished rim ring. Bolt heads ring the covers,
    and a parting rib runs round the cases.
  - Spokes: 28 front and 32 rear, at 5.2 mm instead of 3.8 mm.

## Corrections applied (vs ROADMAP text)
- Right turn → the bike leans right → **roll > 0**, as the contract defines it. The e2e asserts this at the
  carousel.
- The Telelever's trail does not grow under braking; it falls less. The copy says only what the live numbers show.
- Lean is not amplified.

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (204 modules, 633 dependencies cruised)
 Test Files  57 passed | 1 skipped (58)
      Tests  644 passed | 11 skipped (655)
$ npx vitest run tests/features/motorcycle-visual.test.ts --silent=false
moto-classic: bike 6 draws / 79416 tris, suspension 19 draws / 42420 tris   (modern 16/31772, telelever 18/35404)
$ npx vite build --outDir <scratch>/b0503/dist ; python3 -m http.server 5313 (private)
$ SHOTS_DIR=<scratch>/shots PLAYWRIGHT_BASE_URL=http://127.0.0.1:5313 npx playwright test tests/e2e/05-03-motorcycle.spec.ts --trace off
[05-03] carousel {"section":"carousel","roll":0.5312719986301303,"ay":-7.8331955892017}
[05-03] brake moto-classic {"ax":-7.50,"pitch":0.0565,"front":0.0523,"rear":-0.0233}
[05-03] brake moto-modern {"ax":-7.50,"pitch":0.0601,"front":0.0538,"rear":-0.0264}
[05-03] brake moto-telelever {"ax":-7.50,"pitch":0.0302,"front":0.0188,"rear":-0.0194}
[05-03] app errors [] console []
  ✓  1 … car <-> motorcycle: presets, lean sign, fork dive, bike framings and screenshots (3.4m)
```
Screenshots (DPR 1, inspected), all in
`/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/`:
- `05-03-chase-carousel.png`
- `05-03-explore.png`
- `05-03-{classic,modern,telelever}-{fork,rear}-xray.png`

## Issues for other owners
- **`src/sim-core/moto/planar.ts` `clampIc` (05-01):** a telescopic fork's IC is at infinity. The NaN branch puts it
  at the unit direction, about 1.1 m from the contact patch, instead of IC_MAX (5 m), because `k` stays 1 for
  d < 5. The overlay therefore draws an IC ring at a point that does not exist. The fix is one line:
  `k = IC_MAX / d` in the NaN branch. I did not fix it because I do not own the file.
- **Close-up telemetry:** in a paused close-up, the compact telemetry card keeps the numbers from before the seek,
  because numbers are written only as sim time advances. This is 04-03 behaviour, not bike-specific.
- **Camera / x-ray:** the parallel layout executor's uncommitted `camera/index.ts` change forces x-ray on in
  close-up. In close-up you then cannot see the engine solid; the bike's palette meshes are dithered away.

## What looks off
- Bikes leaning toward the camera in a side close-up show the underside. The framing is still fine, but at full
  lean the tank comes close to the lens.
- The crankcase is still a dark slab behind the new covers. The tank profile and side panels are as 05-02 left
  them.
- In the explore view, wheel-dolly did not respond in my scratch runs (it may be SwiftShader timing). I did not
  investigate further.
