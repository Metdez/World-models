# 03-03 SUMMARY — DB11 visual + vehicle-view runtime

**Status:** complete (no deploy). Commits: `6fb0d33` plan, `3a80f4b` DB11 visual, `dd3ed4a` vehicle-view runtime,
`f14548a` compile/trim fix, `5729336` tests + e2e, a shadow-pass trim, the palette merge, and this summary.

## Built
- **`car/db11/visual.ts`** builds the `db11` VehicleVisual. `car/index.ts` now also registers it, next to the
  coupe and the three suspensions.
  - **Loading:** GLTFLoader with MeshoptDecoder, by asset id `car/aston-martin-db11`. `buildDb11(scene, vehicle)`
    is pure, so node tests parse the real GLB.
  - **Orientation and placement:** the root is rotated +π/2 about Y (glTF +Z forward → three +X). Placement is
    measured from the four tyre meshes:
    - the front wheel centres land at x = `cgToFront`;
    - the wheel centres sit at the tyre radius;
    - the car is centred laterally;
    - the offset is +6 mm over the mesh's own 0.376 m.
  - **Baking and merging:** every mesh is baked into the car frame. Quantised attributes become float metres, and
    mirrored matrices flip the winding (`bake.ts`).
  - **Palettes:** the 18 plain finishes share two **palette materials** (`dark`: plastics, interior and engine at
    0.45 env; `bright`: metals, lights and wheels). Each is a MeshStandard whose colour, roughness (G), metalness
    (B) and emissive come from a one-row texture, read through a constant per-part UV texel (the 03-04 approach).
    Paint, gloss-black roof, glass, lens and tail lens keep their own materials. The draw calls are:
    - the body: 7 meshes;
    - each corner: 1 wheel mesh (tyre and rim, spinning), plus a disc (spinning) and a caliper (steer only), which
      are hidden when a suspension visual is mounted;
    - 1 x-ray ghost.

    With the procedural suspension mounted the car draws **11 meshes**, measured in the e2e. Total frame calls at
    the high tier are 171, against the 250 cap of the 03-02 spec. An earlier per-finish merge drew 29 meshes and
    pushed that spec to 260.
  - **Hubs:** one hub per corner is found by position (front x > 0, left three −Z). Inside it:
    - a `spin` group (rim, tyre, disc), rotated by `−CornerFrame.spin` about three Z;
    - the caliper, which steers and cambers but does not spin.

    The hub takes its world pose straight from `wheelPosition`/`wheelRotation`, so travel, camber, toe and steer
    are the solved ones. The body takes `bodyPosition`/`bodyRotation`; amplification is the sim's.
  - **Materials** (`materials.ts`, 23 finishes): all 53 GLB materials are mapped, which is tested.
    - Paint: deep metallic racing green `#0c3324`, MeshPhysical clearcoat 1 / 0.035. It has object-space
      procedural flakes under the coat; the GLB has no UVs, so they are GLSL, and they fade with distance.
    - Glass: tinted window glass (no transmission); a clear headlight lens; smoked red tail lenses.
    - Lights: DRLs emissive ×4 (above the bloom threshold); tail lights emissive.
    - Wheels: rubber tyres, machined rim faces, dark barrels, cast-iron discs, red calipers (no clearcoat; they are
      palette finishes).
    - The rest: leather interior, plus trim and underbody with reduced env reflection.
  - **Hidden** (`HIDDEN_NODES`; every rule is tested to match a real node):
    - the stand-in suspension: `tierod_F/R`, `swaybar_F/R`, `subframe_F/R`, `strut_F`, `steeringbox`,
      `lowerarm_F_a/_F_b/_R`, `upperarm_R`, `hub_F/R`, `spring_R`, `shock_R`, `halfshaft_R`;
    - `amdb11_brakedisc_RR`, a second, smaller disc sitting inside the front-left one;
    - `engine_v8` and `intake_v8`, which overlap the V12;
    - all `amdb11_signal_*` meshes, which are coincident copies of the running and tail lights (z-fighting);
    - `amdb11_badging*` meshes smaller than 0.3 m (logos, scripts, caliper lettering). Larger "badging" meshes are
      trim and are drawn black.
    - Kept: `bumperbar_F`, `diff`, `strutbrace` (body/drivetrain).
  - **X-ray** (`shaders.ts`, GLSL):
    - Every body finish gets a screen-door dither (interleaved gradient noise discard), driven by one shared
      uniform. Toggling it never recompiles, and depth writes are kept.
    - An additive fresnel ghost shell (paint, roof, glass and lenses merged, depthWrite off, renderOrder 10) fades
      in.
    - Body shadows switch off above 0.5.
- **Contract convention (no contract change):** a vehicle visual sets `userData.replacedBySuspension = true` on its
  stand-in parts (the DB11's discs and calipers). vehicle-view hides them while a suspension visual is mounted and
  shows them when none is registered. This follows the orchestrator decision.
- **`vehicle-view/runtime.ts` + `index.ts`:**
  - **Loading:** on init and on `sim:vehicle` it loads the vehicle's visual and builds EVERY suspension visual of
    that vehicle from the registries (`visualKey` → builder).
  - **Compiling:** before compiling, it poses the car at the current frame, sets x-ray to 1 and forces every object
    visible. Otherwise spatial-linkage's hidden corners and the other suspensions would not compile. It then
    compiles and restores the state.
  - **Swaps:** `sim:suspension` only toggles visibility. Only the active suspension visual is updated.
  - **X-ray:** fades over 0.4 s following `store.xray`; it is instant with `reducedMotion`.
  - **Highlights:** `highlight` events are routed with their duration, counted down on frame dt, and re-applied to
    the new visual after a swap.
  - **Reloads:** a vehicle reload disposes everything; stale async loads are dropped.
  - **No suspension visual:** with none registered it still shows the car, with its own brakes.

## Measured (real)
- Tyres on the road:
  - Node test, 40 seeks over a lap: the lowest tyre vertex is never above the sim's contact patch (max 0.0 mm). It
    sinks at most 37 mm, which is the loaded-tyre deflection plus camber, because the mesh is drawn at the unloaded
    radius.
  - e2e, ray cast onto the 03-01 road (tyre bottom vs road):
    - t=5: 17 / 17 / 8 / 7 mm into the road;
    - t=9.75: 21 / 8 / 19 / 11 mm;
    - t=20: 17 / 8 / 19 / 9 mm;
    - t=51.65: 19 / 4 / 17 / 7 mm.
- Wheels in the arches: the hub in the body frame stays within 30 mm (x), 50 mm (lateral, track change + camber)
  and 10 mm (height vs travel) of the static wheel centre at every frame.
- Orientation:
  - e2e: the fl hub is at body x = +1.43 and the rl hub at −1.49; left is at three −Z.
  - Node: positive spin moves the top of the wheel forward.
  - Node, hairpin (right-hand, steer −8.3°): the front hub yaws right.
- `update()` creates no objects. Churn is 15–156 B per call depending on JIT state: V8 boxes doubles across three
  setters, the same effect 02-04 reports. Retained heap after GC is ≤ 8 kB over 20 000 calls.

- Frame cost in SwiftShader at the high tier (SwiftShader only; frame rates there are meaningless):
  - 7.19 s/frame with everything;
  - 7.13 s/frame without vehicle-view;
  - 2.90 s/frame without the track;
  - 2.30 s/frame with neither.

  The car costs little; the 03-01 track dominates. Because of that, the 03-02 high/closeup specs and the 03-04
  close-up specs (60 s budget, element screenshots wait for stable frames) now time out in SwiftShader. Their
  error is `locator.screenshot: Test timeout`, not an assertion about my output. Those specs are not mine and I
  did not edit them.

### Procedural suspension vs the REAL wheel mesh (orchestrator request)
The 03-04 capsules were tested against the real tyre, rim barrel and rim face vertices over 48 seeks per type at
true scale. The figures are worst depths. It is vertex-based: a wheel vertex inside a part's capsule.

- **Double wishbone:** no interpenetration > 2 mm.
- **MacPherson:** the coil spring and its lower seat sit inside the wheel at all four corners, all lap long. This
  is geometry, not a transient:
  - spring vs tyre inner wall: 21–23 mm;
  - spring vs rim barrel: 17–19 mm;
  - lower seat vs rim barrel: 18–22 mm;
  - lower seat vs tyre: 4–10 mm.
- **Multi-link:**
  - the upright necks to `upperFrontOuter`/`upperRearOuter` against the rim barrel: 12–15 mm, and against the
    tyre: 4–8 mm (front and rear);
  - `lowerRear` (front) against the rim barrel and the tyre: 10–11 mm;
  - `lowerFront` (rear) against the tyre: 8–10 mm, and against the rim barrel: 9–11 mm;
  - the rear damper against the rim barrel: 15–17 mm.

The full list is printed by `tests/features/vehicle-view.test.ts` ("reports procedural suspension parts…"). Hardpoint
data was not edited.

## Deviations / notes for the orchestrator
1. **Compile without KHR_parallel_shader_compile:** where the extension is missing (SwiftShader, some Firefox
   builds), `renderer.compileAsync` logs a one-time three.js warning. That warning failed every other spec's
   zero-warning check. vehicle-view therefore calls the synchronous `renderer.compile(scene, camera)` there, and
   `render.compile()` everywhere else. The renderer's own `compile()` (03-02) would warn the same way if anyone else
   calls it in tests.
2. **Sim-core bug (02-04, not mine):** `seek(33.48673…)` (0.4 × lap, pavé) returns a diverged ride state (heave
   7.5e8 m) on a fresh simulation. Reproduce with `sim.seek(0.4 * sim.lapDuration); sim.sample(1, 1).heave`. My node
   test skips and reports that one frame.
3. Hairpin "full lock": the autopilot's maximum road-wheel steer over the lap is 8.3° (t = 9.75 s). The close-up
   shows that, not rack lock.
4. The e2e uses a test-only camera: three's `__THREE_DEVTOOLS__` observe hook plus a `renderer.render` wrapper that
   places a perspective camera in the car frame. Nothing was added to `src`.
5. **The dist race:** `npm run e2e` rebuilds `dist/` and `vite preview` reuses port 4173. Parallel executors
   rebuilding `dist` mid-run made pages load stale chunk names, so boots never became ready. For a reliable run I
   built into a private `--outDir` and served it statically (`PLAYWRIGHT_BASE_URL`). Static serving has no Worker,
   so the 06-01 WebSocket and `?debug=1` `/api/time` specs cannot pass there.
6. Not done (optional/stretch):
   - the wheel motion-blur crossfade;
   - steering-wheel rotation in the interior;
   - a sidewall normal map (no UVs).
7. Credits: no code lifted. The DB11 attribution is unchanged and already covers "re-materialed, badges hidden".

## What still looks off
- The rear diffuser/plate area under the bumper reads as a light grey panel. It is the GLB's dark plastics at a
  grazing angle to the bright sky, even at 0.45 env.
- The paint reads slightly teal under the bright overcast sky in the top view. The GLB's front-arch liner edge
  shows a thin light strip in close-ups.
- The x-ray ghost is a uniform light-blue shell; the dense front bumper area stacks up brighter.
- The GLB discs, shown only without linkage-parts, are flat (not drilled).
- In the side view the coloured 03-04 parts are visible through the rim spokes (expected).

## Verification (real output)
```
$ npx vitest run tests/features/vehicle-view.test.ts --silent=false
  db11 meshes: 20 (8 brake stand-ins, 1 x-ray ghost)
  sim-core diverged after seek at lap time(s) 33.487 (skipped)
  tyre bottom vs contact patch over a lap: max 0.0 mm above, max 37.2 mm below
  update(): 100 B short-lived churn per call, retained 7688 B
      Tests  14 passed (14)
$ npm run check
✔ no dependency violations found (150 modules, 430 dependencies cruised)
 Test Files  43 passed | 1 skipped (44)
      Tests  473 passed | 11 skipped (484)
  (an earlier run under machine load failed once in tests/sim-core/simulation.test.ts "step cost" — 02-04's file;
   it passes alone)
$ npm run build
dist/client/assets/main-DHHrEoFH.js   1,068.45 kB │ gzip: 328.19 kB
✓ built in 960ms
$ npx playwright test tests/e2e/03-03-car.spec.ts   (private build, PLAYWRIGHT_BASE_URL; see note 5)
[03-03] mounted { car: true, placeholderVisible: false, flx: 1.432, rlx: -1.489, flz: -0.844, meshes: 11 }
  ✓ DB11 mounted, oriented forward, tyres on the road; screenshots (3.9m)
  ✓ every suspension is pre-built; swaps toggle visibility; the car works without suspension visuals (1.9m)
```
Official `npm run e2e` (shared tree, other executors rebuilding `dist/` and running suites at the same time):
```
run 1 (before the parallel-compile fix): 03-02/03-04 failed on three's KHR_parallel_shader_compile warning -> fixed
latest run: ✓ 02-04 ×3, ✓ 03-01 track #1; then from test 5 on every page boot timed out (14× waitForFunction 20 s,
            3× 60 s): the stale-dist race of note 5, including my own spec.  17 failed | 1 skipped | 4 passed (11.6m)
private build (vite build --outDir scratch + static server), 03-02/03-03/03-04 specs:
  ✓ 03-02 low · ✓ 03-03 ×2 · ✘ 03-02 high/closeup and 03-04 ×3: locator/page.screenshot timeouts at the high tier in
  SwiftShader (7 s/frame, dominated by the track; see Measured)
```
**Not green**, for environmental reasons (race and SwiftShader cost). The orchestrator should rerun the suite on a
quiet tree.

Screenshots (DPR 1, inspected):
- `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/`
  `03-03-{three-quarter-front,side,rear,top,front-wheel-lock,xray,own-brakes}.png`
