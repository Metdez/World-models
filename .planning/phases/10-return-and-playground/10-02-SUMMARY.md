# 10-02 SUMMARY — GroundWorld zones and proving-ground content

## Built
- **`world/zones.ts`** (new): compiles a `WorldDefinition`'s zones. Rect zones: zone-local u (along heading from the start
  edge) / w (+ left). Path zones (spurs): `integratePlan` nodes at 0.25 m, nearest node + one arc-exact correction
  (~1e-6 m), straight extensions beyond the ends. Own base: flat, or z0 → z1 eased over `ZONE_EASE` = 10 m at both
  ends. `relief` = ISO 8608 roughness (one 512 m periodic LUT seeded from `seedOf(world.id)`, per-zone offset, class per
  zone) + M1 `featureHeight` (edges {width/2, kerb 0.3, seed}); the features fade out over the last 0.5 m inside a
  footprint (a feature never adds to an edge blend). `surfaceAt` = patch, else zone surface. 20 m cull grid (zones
  listed highest priority first). Exports for the renderer: `compileZones`, `zoneOutline`, `CompiledZone.toWorld`,
  `ZONE_EDGE`, `SKIRT*`.
- **`world/ground.ts`**: `buildGroundWorld(track, null)` is the 09-04 code, untouched (bit-identical). With a definition
  (`buildZonedWorld`):
  - `sample`: zones (priority desc) cover max(weight) of the point, weight 1 inside the footprint and smoothstep → 0 over
    the 0.5 m band OUTSIDE it, each zone adds what it covers beyond the zones above it (abutting zones meet without a
    dip, crossing bands at a corner are no steeper than one band); the rest is the loop corridor exactly as before, else
    field/terrain. Surface/zone = largest contributor. `s`/`l` NaN wherever a zone contributes (the plant then reads h,
    not the loop envelope).
  - zones within `LOOP_JOIN` = 60 m of the loop centreline (the spurs) take the loop's base plane (swell + bank, lateral
    clamped to the corridor) and blend to their own plane by smoothstep on |l| 18 → 60 m: the spur meets the loop at
    the loop's height and the paddock at 0.5 m.
  - `terrainHeight` = 09-04 blended terrain → field (z inside the rectangle, smoothstep over `blend` outside) → zone
    skirts (lowest priority first): at the footprint terrain = zone base − 0.05, back to the terrain over
    3 m + 10 × |difference| (≤ 12 m); inside the loop corridor a skirt only lowers (never pushes ground through the ribbon).
  - `inBounds` = field + 40 m ∪ 30 m round a footprint ∪ loop |l| ≤ 60.
  - Projection only when needed (zones near the loop, the corridor box, outside the field): annex points cost ~0.1 µs.
- **`content/proving-ground.ts`** (new, `provingGround`, id `proving-ground`, trackId `proving-loop`): §8.3 zones,
  stations, 7 slalom cones, 18 ISO 3888-2 cones, the circle, 5 signs (6 m ahead / 6 m right, facing the spawn).

### Zone table (world m; [S] sourced, [E] estimate / design input)
| zone | footprint | prio | z | surface (μ scale / c_rr from `SURFACES`) | roughness |
|---|---|---|---|---|---|
| spur-east | path (85, 8.5) 0°: clothoid 15 (0→1/25), arc R25 π/2−0.6, clothoid 15, line 18.649; w 8 → (117.851, 60.000) 90° | 4 | [0.477, 0.5] (loop base near the loop) | asphalt 1.0 / 0.012 [S AVL μ≈0.8–1] | A |
| spur-west | path (−60, 60) −90°: line 18.649, clothoid, arc, clothoid; w 8 → (−27.149, 8.500) 0° | 4 | [0.5, −0.155] | asphalt | A |
| apron | x −90…170, y 60…100 | 2 | 0.5 | asphalt | A |
| street-link | x 55…65, y 100…128 | 2 | 0.5 | asphalt | A |
| ride-street | x −240…60, y 120…128 (u = x + 240, w = y − 124) | 3 | 0.5 | asphalt; pavé patch u 100–160 (0.85 / 0.015 [E]) | B |
| dynamics-pad | x −240…80, y 240…430 | 2 | 0.5 | asphalt | A |
| pad-link | x −85…−75, y 128…240 | 2 | 0.5 | asphalt | A |
| braking-platform | x 130…165, y 100…430 (u = y − 100, w = 147.5 − x) | 3 | 0.5 | lanes u 160–260 (y 260–360): L1 x 138.5–143 dry; L2 x 143–147.5 asphalt-wet 0.65 / 0.014 [E]; L3 x 147.5–149.75 ceramic-wet 0.13 / 0.015 [S Nardò/AVL/AARC μ≈0.1], x 149.75–152 dry; L4 x 152–156.5 ceramic-wet | A |
| field | x −260…300, y 60…440, z 0.5, blend 30 | — | 0.5 | grass 0.45 / 0.06 [E] | — |

Ride street [E, scaled-down NATC/Nardò modules]: washboard u 20–80 (25 mm, λ 1.8 m); pavé u 100–160 (stone 0.15,
±12 mm, joints 8 mm); sleepers 8 × 30 mm at u 180 + 5k; single-wheel steps 40 mm left (u 235) / 80 mm right (u 250),
0.6 m long; twist bumps 60 mm × 3 m at u 265/271/277/283 alternating; pothole u 293, w 0.8, r 0.3, 50 mm.
Pad: circle (−170, 335) R 40 [E]; slalom y 280, x −90…60 every 25 m [E]; ISO 3888-2 [S] from x −120 on y 400, W 1.95:
gates 2.395 (x −120/−114/−108), 2.95 centred 403.6725 (x −94.5/−89/−83.5), 3.0 (x −71/−65/−59).
Stations: ride-street (−230, 124, 0°), steering-pad (−130, 335, 90°), slalom (−170, 280, 0°), lane-change (−200, 400, 0°),
braking-platform (149.75, 110, 90°; `suspension: false`, caption "…approximate surface grip. A tyre grip demonstration,
not a suspension lesson.").

## Measured (real output)
- Spur ends vs §8.3: 1.40 mm, 0.0000° (both); joins: spur-east at loop s 85.0, l 8.500, heading diff 0.0000°;
  spur-west at s 1623.6, l 8.500, 0.0000° (centre 8.5 m off = near edge on the 4.5 m road edge).
- Clearance from the real loop centreline: apron 60.0, street-link 100, braking-platform 100, ride-street 120,
  pad-link 128, dynamics-pad 240 m; props ≥ 116 m, spawns ≥ 110 m; field edge 60 m, its blend reaches 30 m (corridor
  18 m). Loop corridor h/base/surface/s **bit-identical** with and without the world wherever no zone contributes (> 7000
  points), goldens unchanged.
- Continuity, 0.25 m grid, 0.1 m steps: field (7.3 M pairs, x −260…300, y 30…440) **17.5 mm** (loop terrain + field
  blend at (−194.5, 44.25)); east spur join box **16.9 mm** (skirt beside the spur); west **17.3 mm**; terrain lines
  from the loop edge into the field 11.5 mm. Excluded (deliberate M1 feature shapes, steeper by design): pavé joints,
  sleepers (≈31 mm/0.1 m), single-wheel steps (≈21/42 mm), twist-bump 0.15 m lateral edges, pothole (≈25 mm).
- Split-μ: car in L3 → L wheels `ceramic-wet`, R wheels `asphalt` (per wheel); lanes and lead-in/safety asserted.
- Roughness: same id → identical, other id → different (> 0.5 mm), pad relief 0.5–10 mm.
- Plant drive at 11 m/s (pure pursuit, aids on): loop → east spur → apron and apron → west spur → loop: finite, 0
  faults, worst per-step road-input change 6.1 / 4.1 mm (both on the loop's own class-C roughness).
- `sample`: 1.63 µs/call mixed points (0.1 µs inside annex zones); sampled heap profile 144 B over 200 000 calls
  (one site, path-zone `local`), i.e. allocation-free in steady state. World build 108 ms (bare 40 ms).
- `npm run check`: typecheck — my files clean; `tsc -p tsconfig.node.json` fails only in 10-01's in-progress
  `tests/fixtures/10-01-returning.ts` / `tests/sim-core/zz-scratch-one.test.ts` (`sim.world` possibly undefined).
  depcruise `✔ no dependency violations found (246 modules, 830 dependencies cruised)`. vitest: `Test Files 3 failed |
  87 passed | 1 skipped (91)`, `Tests 3 failed | 874 passed | 11 skipped (888)` — all three failures are 10-01's
  (returning H2, its scratch test, and `drive-plant` "request(auto) releases at once (shortcut until 10-01)" which
  10-01's Returning supersedes). Mine: 30/30 incl. goldens, world-ground, plant-ground, plant-no-alloc.

## Deviations
1. **Edge band outside the footprint** (as §8.1) but composed by max coverage, not product: two bands crossing at a
   corner reached 20.6 mm/0.1 m with the product.
2. **Features fade over the last 0.5 m inside a footprint** (washboard spans the full street width: its edge blend gave
   22.7 mm).
3. **Spur base near the loop follows the loop** (§8.1 says linear z0→z1): the loop rises 0.17 m along the 33 m the
   east spur runs beside it, a linear base stepped 8–16 cm into the corridor. z0 values are the loop base at the joins
   (0.477 / −0.155; §8.3 had 0.473 / −0.156, the road h incl. roughness).
4. **Skirts both lower and raise** (§8.1: min(terrain, base − 0.05)) with width 3 m + 10 × |Δ| ≤ 12 m: the terrain
   beside the west spur lies 0.6 m below it (min only = a 0.6 m cliff at the spur edge); never raised inside the loop
   corridor.
5. Spur arc angle = exact π/2 − 0.6 (0.970796) instead of 0.9708; ends still 1.4 mm from §8.3's rounded coordinates.
6. Spawns: ride-street (−236 → −230) and braking-platform (y 105 → 110) moved to 10 m from their zone's start edge
   (acceptance: ≥ 10 m inside). The ride street is 8 m wide: its spawn is 4 m from the sides (asserted: car fits).
7. μ cannot blend at a zone/patch edge: `GroundHit.surface` is a discrete kind (contract frozen); the surface switches at
   weight 0.5 / the patch edge. Normal: the contract has no normal field — the plant fits its plane through `base`, which
   zones provide (flat/eased planes, loop plane near the loop).
8. A world definition without `zones`/`field` (the kernel test's stub `{ id, trackId }`) grounds like no world.
9. Steep designed ride-street features are excluded from the 2 cm continuity criterion (they are the M1 RoadFeature
   shapes, steeper by design); the spur/field/zone-edge composition meets 2 cm everywhere.

## For the orchestrator (outside my files)
- **plant.ts `locate()`** still decides zone and out-of-bounds from the loop projection: `zone` is only 'loop'/'terrain'
  and |l| > 60 raises **out-of-bounds everywhere in the annex** (paddock already at l 60–100). Needs: `world.inBounds(x,
  y)` for the OOB timer and `world.sample(...).zone` (or the CG hit's zone) for zone events. Not owned by any phase-10
  plan as far as I can see; 10-04's OOB fade/reset will fire in the annex until this changes.
- No simulation change needed to register: `simulation.ts` already builds `worldFor(track, catalog.world?.(trackId))`;
  10-03 registers `provingGround` in `registries.worlds`.

## What 10-03 needs (renderer)
- Terrain: `sim.current.world.terrainHeight(x, y)` (loop terrain + field + skirts; a 2 m grid over
  x −300…340, y −10…480 costs 170 ms, ~2 µs/point) — skirts are 3–12 m wide, the field blend 30 m.
- Zone meshes: `compileZones(provingGround).zones` (priority order) → `zoneOutline(zone, step)` (closed CCW polygon,
  Float64Array x,y pairs) and `zone.toWorld(u, w, out)`; heights `world.sample(x, y, NaN, hit).h` (rows ≤ 0.25 m on the
  ride street features, 0.5 m elsewhere). In the 0.5 m `ZONE_EDGE` band outside each footprint the physics blends
  zone → terrain (≤ 5 cm): extend zone meshes by `ZONE_EDGE` or accept ≤ 5 cm; the terrain under a footprint is base −
  0.05 (hidden). Spurs overlay the loop ribbon's kerb/apron/grass where they start/end (spur-east x 85…~100, y 4.5–18;
  spur-west the mirror at x −27…−45): draw spurs above the ribbon there (polygonOffset).
- Surfaces: `zone.def.surface`, patches `zone.def.patches` (u, w ranges in zone-local) → `toWorld` for the wet
  patches and lane lines (L1–L4 boundaries at w 4.5, 0, −2.25 (split), −4.5, −9 on the braking platform, x = 147.5 − w).
- Props: `provingGround.props` — `cone` (x, y), `circle` (−170, 335, R 40), `sign` (x, y, heading rad, station id).
- Copy: `provingGround.stations[*].name/caption/experiment` (no digits; tested in `tests/arch/world-copy.test.ts`).

## What 10-04 needs
- `world.station(id)` → spawn {x, y, heading rad}; ids `ride-street`, `steering-pad`, `slalom`, `lane-change`,
  `braking-platform`. T10 lane: ISO 3888-2 from x −120 on y 400 heading +x, gates above; run-up from the spawn 80 m.
- OOB: see plant.ts note above (`world.inBounds` is correct for the annex).

## Lifted code
None.
