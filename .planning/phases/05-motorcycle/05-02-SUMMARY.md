# 05-02 SUMMARY — Procedural cafe racer + moto suspension visuals

**Status:** complete (no deploy). Commits: `9a9ac93` plan, `638132a` fixture, `5e38891` visuals, `85a166a` tests;
later polish was picked up by the orchestrator's WIP snapshots; this summary.

## Built (all procedural, no asset, no badges)
- **`visual/cafe-racer.ts`** — `buildCafeRacer(vehicle, options?)` + `cafeRacerVisual` (id `cafe-racer`, matches
  05-01's `visualKey`). Frame hardpoints default to the 05-01 content (`steeringPoints(FORK_RAKE…)`,
  `SWINGARM_PIVOT`); options override them.
  - gloss-black twin-cradle frame (bent tubes), alloy pivot plates, rear-sets with knurled pegs and levers;
  - air-cooled parallel twin: extruded crankcase, brushed covers with polished edges, 15+5 machined-edge fins,
    cam cover, faux throttle bodies, front sprocket;
  - 2-into-2 chrome headers with heat tint, upswept tapered peashooters with polished end caps;
  - lofted tank (blunt in side view, rounded in plan, knee dishes), Monza cap, pleated leather seat with piping,
    painted hump with leather back pad, tail light, side panels;
  - spoked wheels (lathed round-crown tyres, polished rims, 36/40 cross-laced spokes with nipples, hub flanges,
    rear sprocket carrier) posed from `wheelPosition`/`wheelRotation`, spun by `spin`;
  - chain: two link runs on the sprockets' external tangents, following the rear axle per frame.
  - Paint: deep red metallic MeshPhysical, clearcoat, object-space flakes, twin ivory stripes + gold pinstripes
    (shader, object space, tank and hump line up). Everything else is one palette material (`visual/palette.ts`).
  - X-ray: one shared dither uniform on paint + palette, additive fresnel ghost (paint geometry reused), shadows off
    above 0.5 — the DB11 technique.
- **`parts/moto-planar.ts`** — `buildMotoPlanar(susp, vehicle)` + `motoPlanarVisual` (id `moto-planar`).
  `parts/front.ts`, `parts/rear.ts`, `parts/common.ts`:
  - head tube + chassis brackets; steering assembly (alloy top yoke, black lower yoke, clip-ons, grips, levers,
    master cylinder, bar-end mirrors, twin clocks, chrome headlight with lens/reflector/lamp) turned about the
    steering axis by the front corner `steer`;
  - RSU: chrome stanchions, alloy sliders, rubber gaiters stretched per frame; USD: black outer tubes, gold
    stanchions, black axle feet; Telelever: tubes + gold lower bridge with ball joint, kit3d A-arm on the chassis
    pivot, coil-over to the arm; polished front fender; twin floating discs (cheap ring + dimple holes + carrier)
    and red calipers;
  - rear: twin-sided tapered box arm (brace placed at the link lug for the linkage so it clears the monoshock) or
    single-sided arm with hub carrier; twin coil-overs (mirrored, y from the definition) / single shock (outboard of
    the arm when the definition draws it at y = 0, otherwise it would sit inside the tyre) / monoshock + twin-plate
    rocker + dog-bone; rear disc + caliper on the arm.
  - Only POSE data: body pose, the named points (`axle`, `armJoint`; `pivot`, `axle`, `shockLower` |
    `swingarmLink`, `rockerLink`, `rockerShock`) resolved by name when `pointOrder` changes (hidden until present),
    front `steer`, both `spin`. Rest geometry from the definition; planar parts turn in the body x–y plane.
  - Colours via kit3d palette (COMPONENT_COLORS as sRGB): fork gold, swingarm, linkage (A-arm, rocker, dog-bone),
    spring yellow, damper blue. `setHighlight(role, 'f'|'r'|'all')` is emissive only; per-spring materials follow.
- **Test fixture** `tests/fixtures/05-02-moto-frame.ts` (contract types only, planar kinematics incl. 4-bar).
- **Node tests** `tests/features/motorcycle-visual.test.ts` (7): budget, NaN sweep (travel ±120 mm, lean −45..30°,
  steer ±0.35, pitch), tyres on the patch, rest points carried onto posed points, dog-bone length, highlight,
  hidden-until-points, x-ray, zero-alloc, and the same checks against the **real 05-01 `createSimulation`** for all
  three presets (40 seeks, amplification 1 and 3).

## Measured
- Draw calls: bike **6** (paint, palette, 2 wheels, 2 chain runs; +1 ghost only in x-ray). Suspension: Classic 19,
  Modern 16, Telelever 18. Totals **22–25**. Triangles: bike 76k, suspension 32–42k (≈108–119k total).
- Live sim: carried-point error 0.00 mm (axles, rocker shock point, Telelever shock point, twin-shock lower);
  lowest tyre vertex 2–16 mm below the sim contact patch (tyre drawn unloaded; the patch is on the loaded crown);
  max lean 36°.
- `update()` heap delta after 20 000 updates of both visuals: −136 kB..−7.5 kB (no retained allocation; a probe
  with 100 000 calls showed < 5 kB).

## Verification (real output)
```
$ npx vitest run tests/features/motorcycle-visual.test.ts --silent=false
moto-classic: bike 6 draws / 76440 tris, suspension 19 draws / 42420 tris
moto-modern: bike 6 draws / 76440 tris, suspension 16 draws / 31772 tris
moto-telelever: bike 6 draws / 76440 tris, suspension 18 draws / 35404 tris
moto-classic (live sim): carried point error 0.00 mm, lowest tyre point minus contact patch -16.2..-2.3 mm, max lean 36.0 deg
moto-modern (live sim): carried point error 0.00 mm, lowest tyre point minus contact patch -16.2..-2.3 mm, max lean 36.0 deg
moto-telelever (live sim): carried point error 0.00 mm, lowest tyre point minus contact patch -15.4..-1.9 mm, max lean 36.0 deg
      Tests  7 passed (7)
$ npm run check
typecheck ok; ✔ no dependency violations found (204 modules, 631 dependencies cruised)
 Test Files  3 failed | 52 passed | 1 skipped (56)
      Tests  5 failed | 616 passed | 11 skipped (632)
```
The 5 failures are not in my files: `golden.test.ts` ×3 and `kinematics-table.test.ts` multilink (an uncommitted
edit to `src/sim-core/content/susp-multilink.ts` by another executor), and `simulation.test.ts` still expecting the
phase-5 moto stub to throw (02-04's test, stale since 05-01 landed).

Screenshots (DPR 1, 1280×720, airfield HDRI, AgX, inspected):
`/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/05-02-{side,front34-lean,rear34,classic-fork-twinshock,modern-linkage-xray,telelever-front}.png`
(harness: `scratchpad/harness-moto/`, private vite on port 5207; not committed).

## For 05-03
- Register `cafeRacerVisual` (vehicleVisuals) and `motoPlanarVisual` (suspensionVisuals).
- The front end (yokes, bars, headlight, fork) and discs/calipers live in the suspension visual (as the car's
  brakes do), so the bike has no front end if no suspension visual is mounted; no `replacedBySuspension` stand-ins.
- Highlight roles: `fork`, `swingarm`, `linkage` (Telelever A-arm, rocker, dog-bone), `spring`, `damper`.
- Debug hooks: `inspect()` on both visuals (meshes, hubs, link end points).

## Deviations / notes
- Telelever steering: 05-01 steers about the head → joint line; the visual turns the steering group about the
  definition's rake axis and re-aims the lower fork at the posed joint, so the axle/joint are exact and only the
  upper tubes may differ by a fraction of a degree at full lock.
- Modern content: the monoshock (x ≈ −0.39..−0.40) passes within a few mm of the rear tyre's front at rest
  (tyre front at x ≈ −0.403); visible only in x-ray close-ups. Hardpoints not edited (05-01's).
- Kit3d's drilled disc (56-segment holes, 15k tris per disc) was replaced by a cheap ring + dimples in `common.ts`.
- No code lifted; three.js addons only.

## What still looks off
- Engine cases are a plain extrusion (flat black slab) — reads simple up close; the covers are flat discs.
- Spokes are busy/thin at a distance (aliasing in SwiftShader), fine up close.
- Tank side profile is still a little low/teardrop versus a real Thruxton; the side panels are plain plates.
- No rider, cables, brake lines or wiring; front fender stays are simple loops.
