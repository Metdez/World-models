# 03-04 SUMMARY — kit3d part helpers + procedural `spatial-linkage` suspension visual

**Status:** complete (no deploy) · commits `d7f4db8` (plan), `ec1835a` (kit3d), `d6ab6ea` (visual + node tests),
then the e2e spec and this summary.

## Built
- **`src/kit3d/`** (three + contracts only)
  - `tube.ts`: `unitCylinder/unitSphere`, `updateTube` (zero-alloc a→b placement), `placeAlong`, baked tubes/discs/
    spheres, `mergeParts` (position/normal/uv, non-indexed), `bellowsGeometry` (rack gaiters/boots).
  - `rigid.ts`: `frameFrom3`, `restInverse`, `setRigid` (M = F(now)·F(rest)⁻¹), `setSwing` (single rod, minimal
    rotation), `platePolygon`, `bushingParts` (eye + rubber + steel sleeve), tubular `aArmGeometry` (tapered legs,
    bushed eyes on the pivot axis, ball-joint housing + ball + boot toward the upright, gusset, boss + braces for
    each extra pickup), `bracketTab` (chassis clevis cheeks).
  - `spring.ts`: shader-driven coil: geometry = (aT, aPhi) grid; `onBeforeCompile` replaces `begin_vertex`/
    `beginnormal_vertex` with the exact helix frame (closed dead turns at both ends, active pitch from one `uLen`
    uniform), a matching `MeshDepthMaterial` for the shadow pass, constant `customProgramCacheKey` so all springs
    share one program; `springVertex` is the same closed form in TS (fills bounds/normals, and is what the tests
    check); `clampSpringLength` = coil bind (2·r·N).
  - `damper.ts`: two rigid halves on the mount axis — body half (body, seal cap, lower fitting, lower seat +
    collar) on the lower mount, rod half (chrome rod, jounce bumper, upper fitting, upper seat) on the upper mount;
    fixed lengths, so the rod visibly slides in the body.
  - `hull.ts`: inflated `ConvexGeometry` (Fibonacci sphere pads) + `toCreasedNormals`, `lobedHull` (union of
    core+lobe hulls = spider-shaped casting).
  - `brake.ts`: drilled disc (2 staggered rows) + lathe hat, hub flange + 5 studs, fixed caliper (inboard/outboard
    halves bridged over the disc rim).
  - `materials.ts`: finish palette (every `COMPONENT_COLORS` role + rubber/steel/chrome/disc/caliper) as a 19×1
    colour map + roughness/metalness map; `paint(g, finish)` sets UVs to a texel, so a rigid body that mixes
    finishes is ONE draw call. Materials per role per corner differ only by emissive (highlight = emissive in the
    part colours, never a colour change); the spring keeps a plain-colour material for its shader.
- **`src/features/linkage-parts/`**
  - `layout.ts`: parts derived only from `AxleLinkage` data — 2 distance constraints sharing member + upright point
    = A-arm; any other distance = rod (steer point marks the tie rod); `strut` constraint = MacPherson; extras
    (spring seat on arm/link, ARB pickup) go to their member; best-conditioned point triples for the upright and
    chassis frames; rest points (AXLE → vehicle, right side mirrored, `springLower` per mount kind). No id branching.
  - `corner.ts`: one corner. Upright = lobed hull (hub boss core + one "bone" per upright point, strut clamp collar,
    caliper ear) + caliper in one mesh; disc + hub spin about the vehicle-left axis by `CornerFrame.spin`. A-arms and
    rods are rigid bodies (links keep their length by construction). Coil-over sizing from the data: spring travel
    bound from the lower-mount lever ratio; the upper seat sits on the rod below every arm/link/upright neck near the
    axis (rest pose + 50 mm), body length keeps the body under the seat at bump and the rod inside at droop.
    ARB: drop-link lean (up / fore / aft / inboard) and arm direction picked per corner by clearance at rest
    (±50 mm vertical envelope, tyre at ±0.4 rad lock); per frame the arm angle is the circle–sphere solution that
    keeps the drop link length; the drop link is a rigid rod. Rack gaiters stretch between the housing end and the
    inner ball joint. `capsules()`/`wheel()` are debug hooks for the tests.
  - `visual.ts`: `buildSpatialLinkage` (car only; throws for a motorcycle definition), 4 corners, ONE chassis mesh
    for all chassis-fixed parts (brackets, top mounts, rack housing with pinion tower), one ARB torso mesh per axle
    (highlightable); `update` resolves `pointOrder` names only when the array reference changes (hidden until the
    frame carries the points), `setHighlight(role, corner|'all')` (damper ⇄ strut aliased), `inspect`, `dispose`.
  - `index.ts`: contributes `spatial-linkage` to `registries.suspensionVisuals`.
- **Tests**: `tests/features/kit3d.test.ts` (10), `tests/features/linkage-parts.test.ts` (32),
  `tests/e2e/03-04-parts.spec.ts` (3).

## Verification (real output)
```
$ npx vitest run tests/features/kit3d.test.ts tests/features/linkage-parts.test.ts --reporter=verbose
macpherson: min part clearance 18.2 mm, min tyre/rim-proxy clearance -21.7 mm    · 41 draw calls
double-wishbone: min part clearance -15.2 mm (known hardpoint conflict upperArm.front / rod: 15.2 mm) · 45 draw calls
multilink: min part clearance -20.8 mm (known: upperRear/rod 4.0, upperFront/rod 10.3,
           rod/upright.upperFrontOuter 20.8, rod/upright.upperRearOuter 15.6 mm)  · 53 draw calls
      Tests  42 passed (42)
$ npm run check
✔ no dependency violations found (117 modules, 322 dependencies cruised)
 Test Files  31 passed (31)
      Tests  331 passed (331)
$ npm run build
dist/client/assets/main-35VAlOnQ.js   902.85 kB │ gzip: 276.89 kB
✓ built in 583ms
$ npx playwright test tests/e2e/03-04-parts.spec.ts --trace off
  ✓ macpherson / double-wishbone / multilink: closeup renders with linkage-parts on, zero console errors and warnings
  3 passed (1.0m)
```
Node tests pose the visual from the 02-02 tables (static, ±full travel incl. the 20 mm grid margin, full lock both
ways, bump+lock, droop+lock) AND from the live 02-04 simulation (24 seeks over a lap, amplification ×3): all corners
visible, no NaN, rigid link lengths constant (< 0.1 mm), right side mirrored, both front wheels steer the same way,
upright matrix orthonormal, highlight emissive-only per corner, `update` allocates nothing (heap delta < 64 kB over
20 000 updates with `--expose-gc`), spring wire radius constant at every length (1e-9), outward winding of every
generated geometry, ≤ 60 draw calls.

**Screenshots** (throwaway harness, studio HDRI, AgX, shadows, DPR 1; harness not committed) in
`/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/`:
`03-04-{macpherson,double-wishbone,multilink}-{static,bump,droop,steered}.png` (front-left corner),
`03-04-*-steered-tyre.png` (ghost tyre/rim proxy), `03-04-multilink-rear.png`, `03-04-double-wishbone-rear.png`,
`03-04-macpherson-axle-steered.png`, `03-04-double-wishbone-highlight-upper-arm.png`, live-sim frames
`03-04-live-{multilink-t40,double-wishbone-t60,macpherson-t20}-amp3.png`, and the app close-ups
`03-04-app-*.png`. Only console notice in the harness: Chromium's "GPU stall due to ReadPixels" (screenshots).
Inspected: spring compresses with constant wire and coils bind visibly at bump, rod slides in the body, strut
assembly on the MacPherson, two A-arms on the wishbone, five distinct rods on the multi-link, rack gaiters
stretch/compress with steering, ARB arms twist differently left/right under roll.

## Deviations
1. **Spring is shader-driven** (caller + SUMMARY.md "spring shader"), not the CPU variant ROADMAP mentions; the TS
   mirror gives the CPU maths for tests/bounds. Bugs found only by rendering (research 22's GLSL had never run):
   `active` is a reserved GLSL word (compile error), the research's index winding was inward (back faces
   rendered), and a geometry without a `normal` attribute makes three force flat shading — all fixed and tested.
2. **Palette materials** (one draw per rigid body) instead of one material per finish: per-material meshes would
   be ~140 draws for the suspension alone against the §18 budget (car + suspension ≤ 90). Now 41/45/53 — the DB11
   visual has to fit in the remaining 37–49.
3. **Colour space:** `COMPONENT_COLORS` is documented as "Linear-sRGB hex" but its values are AxleLab's sRGB hexes
   (tyre #14161a would be mid-grey if linear). Used as sRGB (`new Color(hex)` / sRGB palette texture). If other
   features read it as linear the colours will differ — the orchestrator may want to fix the contract comment.
4. Disc, caliper and hub are part of this visual (they move with the solved upright incl. camber/toe).

## For the orchestrator / later plans
- **03-03 (vehicle-view / DB11):** hide the DB11's own brake disc + caliper as well as its stock suspension meshes,
  or they duplicate this visual's brakes (mine: disc+hub mesh under the upright, caliper merged into the upright
  mesh). The DB11 wheel must be checked against the parts: my tyre/rim proxy (solid annulus r 0.245–0.382 m,
  ±0.125 m) reports overlaps (worst over all poses): lower-arm legs near the ball joints entering the rim barrel
  (MacPherson 22 mm, DW 24 mm; the ball joints sit at r ≈ 0.227 m inside a 20" wheel by design), the coil-over's
  lower end against the tyre's inner wall (DW 24 mm, ML damper 32 / lower seat 22 / spring 15 mm) and the
  multi-link lower links (45 / 77 mm, they leave the wheel steeply). Much of this is the crude proxy; verify with
  the real wheel mesh.
- **Hardpoint conflicts (02-02 content; I did not edit it):** the test allow-lists these with their depth so new
  ones still fail:
  - double-wishbone REAR: the coil-over axis (`springSeat` [0.07, 0.70, 0.17] → `springTop` [0.08, 0.62, 0.70])
    passes through the upper arm's front leg (rod overlap 15 mm). Moving both to x ≈ 0.00 centres the axis between
    the legs (leg x ≈ ±0.069 at y 0.64); the motion ratio changes a little, so re-run the 02-02 gates.
  - multilink: the damper rod passes the upper links within ~4 mm (rear, static) / 10 mm (front at lock), and at
    full lock the upright's necks to `upperFrontOuter`/`upperRearOuter` swing into the rod (21/16 mm). A front
    `springTop` further inboard (y ≈ 0.58) and/or upper outer joints spread fore/aft would clear it.
- Lifted/adapted code: none copied verbatim. Ideas/patterns from **KRoshanK/AxleLab** (MIT, © 2026 KRoshanK) —
  `orientY/between` tube placement, `bootGeometry` bellows profile idea, palette metalness/roughness values — credit
  in CREDITS.md / code credits. three.js addons used as-is (ConvexGeometry, BufferGeometryUtils, MIT).

## Known gaps
- Looks judged in SwiftShader with a studio HDRI in a harness; the app still shows the 01-04 placeholder until
  03-03 mounts the visual, so the e2e currently proves only "feature on, healthy boot, no shader warnings in the
  app"; it becomes the real check at the phase gate.
- The upright is a convex-hull union (reads as a casting, faceted seams visible up close); no CV joints/half-shafts
  (the contract has no drive-shaft points), no brake lines.
- Clearance checks use capsules (upright lobes approximated hub → joint); the ARB placement rule is a small
  candidate search, not an optimiser.
- No compression heat tint on the spring (research 10 idea) — not in the plan.
