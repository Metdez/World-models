# 04-04 SUMMARY — Teaching overlays

**Status:** complete (no deploy). The commits are `3b010e8` (plan), `fa8c1e3` (construction, ghost and load arrows)
and `e44fcfa` (trace and wiring). The later tuning and the e2e spec were swept into the orchestrator's "WIP
snapshot" commits before I could commit them myself (`351e06b`…`e4f282a`), so they have no 04-04 commit of their own.

## Built (`src/features/teaching-overlays/`)
- **`lines.ts`** is a fat-line batch: three's `LineSegments2` with a preallocated interleaved buffer that is written
  in place. `instanceCount` is the number of segments used, so there is one instanced draw per layer.
  - The colour stroke is additive, so fading a stroke is just a colour ramp.
  - Under it sits a wider casing drawn with multiply blending. The casing shares the position buffer, so strokes
    read against both sky and asphalt.
  - `depthTest` is off, so the overlay is visible through the car.
  - Non-finite endpoints are dropped and never reach the GPU.
  - A per-batch `gain` dims a whole group.
  - Draw calls: **3** (ghost/secondary layer, casing, primary).
- **`construction.ts`** builds everything from POSE fields, `sim.restPose()` and the definition's constraints. There
  is no id branching.
  - **Per corner:**
    - A *force line* runs from the contact patch through the IC, shown as a mint stroke. Past the IC it continues
      dashed to the roll centre when the RC lies beyond the IC.
    - The IC is drawn as a ring.
    - Each A-arm (two distances sharing a member) and each strut gets a dotted coral line: where that part's
      instantaneous plane cuts the front-view plane. For the strut this is the plane through the top mount, normal
      to the strut axis.
    - The node test checks these lines against the sim's velocity-based IC. Worst miss: **6.3 mm** MacPherson,
      **5.8 mm** double wishbone. Multi-link has no A-arms, so it shows only the force line.
  - **Per axle:**
    - a ground line between the contact patches;
    - a dashed centreline;
    - the RC as a ring;
    - a 28-sample RC trail, stored in the body frame and re-posed every frame, so it shows migration relative to the
      car.
  - **Far or infinite ICs:** lines are clamped at 2.6 m and fade over the last 35 %. When the IC is out of reach the
    arm lines shrink to 0.9 m hints. A NaN or ∞ IC or RC is skipped.
  - **Ghost rest pose** (thin additive layer):
    - the linkage skeleton (every constraint, the upright spokes and the spring);
    - a tyre outline: two sidewall circles plus four tread lines, placed by the upright's rigid transform
      F_rest·F_live⁻¹ applied to the live wheel pose.
    - Motorcycle: a cross at each rest point.
  - **Load arrows:** length ∝ load. Each has a contact-patch ellipse, coloured by grip use (model estimate, no
    number shown): base colour, warn above 0.8, red above 1.
  - **Axle emphasis:** the axle nearer the camera is drawn at full strength and the far one at about 0.3 when seen
    head-on. From the side both are full strength.
- **`trace.ts`** is the "Camber vs travel" canvas panel, top right below the HUD buttons.
  - It has one plot per axle. Each plot shows:
    - the current curve, from `kinematics()` and limited to the usable travel;
    - the **previous suspension's curve, faint and dashed**, copied on `sim:suspension` and labelled "faint:
      <label>";
    - L/R dots at the **true** `travel` / `camberBody`;
    - the **true** roll-centre height in mm.
  - Value labels come from the curves.
  - Live numbers use a glyph writer, which makes no string per tick. Redraws run at ≤ 30 Hz.
  - Motorcycle: the panel plots motion ratio vs travel instead.
- **`index.ts`:**
  - The layer is active while `store.overlay === 'engineer'`. Entering close-up switches it on; the user can switch
    it off there again.
  - The panel also follows `hudVisible`.
  - The trail resets on swap, vehicle change and seek.
  - The camera position, in the sim frame, is passed in for axle emphasis.
- Amplification: the geometry follows the amplified POSE. The numbers are TRUE values (`rollCentreHeight`, `travel`,
  `camberBody`).

## Verification (real output)
```
$ npx vitest run tests/features/teaching-overlays.test.ts --silent=false
macpherson: worst arm-plane line miss from the sim IC: 6.3 mm
double-wishbone: worst arm-plane line miss from the sim IC: 5.8 mm
multilink: worst arm-plane line miss from the sim IC: 0.0 mm   (no A-arm/strut planes)
construction.draw(): heap delta over 20000 calls -8416 B
      Tests  10 passed (10)
$ npx tsc -p tsconfig.app.json        -> clean
$ npx tsc -p tsconfig.worker.json     -> clean
$ npm run lint:deps                   -> ✔ no dependency violations found (204 modules, 631 dependencies cruised)
$ npx vite build --outDir <scratch>/dist0404 ; python3 -m http.server 4404 (static, private)
$ SHOTS_DIR=<scratch>/shots PLAYWRIGHT_BASE_URL=http://localhost:4404 npx playwright test tests/e2e/04-04-overlays.spec.ts --trace off
[04-04] overlay {"visible":true,"layers":[{"name":"teaching-overlays:ghost","visible":true,"count":371,"finite":true},
  {"name":"teaching-overlays:construction:casing","visible":true,"count":160,"finite":true},
  {"name":"teaching-overlays:construction","visible":true,"count":160,"finite":true}],"panel":true}
  ✓  1 [chromium] › tests/e2e/04-04-overlays.spec.ts › engineer overlay: construction lines per suspension, trace
       keeps the previous type, close-up defaults it on (3.3m)
  1 passed (3.3m)
```
**`npm run check` is NOT green, and the cause is outside my files:**
- `tsc -p tsconfig.node.json` fails only in the untracked `tests/sim-core/_scratch/*.test.ts`, which belongs to the
  parallel sim-fix executor.
- `vitest` (full) has 10 failures, all in other owners' files: golden hashes, kinematics-table multilink,
  linkage-parts multilink, kernel app/loop, and the simulation motorcycle stub. They come from the in-progress
  `susp-multilink.ts` hardpoint edits and the phase-5 motorcycle work.
- My test file plus `tests/arch` pass: 37/37.

Node tests cover:
- the geometry helpers: plane intersection, the parallel case, the fade;
- the glyph writer (true minus, no "-0", NaN shown as "—");
- the plot range;
- all three car types on live sim frames at ×1 and ×2.5: finite buffers, within capacity;
- an IC forced to 1000 m (every vertex stays within LINE_MAX + 2 m of the car);
- NaN/∞ IC and RC;
- a 2-corner motorcycle frame;
- zero allocation over 20 000 `draw()` calls.

Screenshots (DPR 1, `?e2e=1&quality=low&paused=1&t=20&amp=2.5`, x-ray on, test-only camera in the car frame), all
inspected:
- `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-04-front-macpherson.png`
- `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-04-front-double-wishbone.png`
- `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-04-front-multilink.png`
- `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-04-chase-multilink.png`
- `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-04-trace-after-swap.png`

## Deviations
1. Construction lines use fat lines (LineSegments2, MIT three addon) rather than 1 px `LineSegments`, so they stay
   legible. There are still 3 draws in total.
2. "Close-up defaults it on" is done by this feature writing `overlay = 'engineer'` when the view enters `closeup`.
   04-01/04-02 may do the same; the write is idempotent.
3. Multi-link: its links are single rods, so no virtual-arm lines are drawn. Rod pairs do not define an exact plane,
   and drawing one would be dishonest. It shows the force line, the IC and the RC only.
4. The contact-patch ellipse length grows with √(load / nominalLoad). It is only a visual: no tyre pressure is
   modelled and no number is shown.
5. Stretch CSS2D part labels: skipped.

## What still looks off
- From straight ahead, both axles' constructions still overlap. The far axle is dimmed to about 0.3, which helps but
  does not remove the overlap. A real front-view director shot from 04-01 will look cleaner than my test camera.
- The MacPherson front IC is out of reach at this moment, so its strut/arm lines are only short hints. The
  convergence reads best on the double wishbone.
- The trace's y-range covers both the current and the previous curve. After a swap from a type with a large camber
  range, the current curve can look flat.
- The force lines over the light-blue x-ray ghost shell lose some contrast (the additive strokes sit on a bright
  base).
- No credits needed: no code was lifted, and the three.js addons are already credited.
