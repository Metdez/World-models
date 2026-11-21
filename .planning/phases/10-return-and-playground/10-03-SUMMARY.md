# 10-03 SUMMARY — Proving-ground visuals; terrain from GroundWorld

All looks were judged under SwiftShader (headless software GL, 1280×720, DPR 1). Colours, AA and frame times are not what
a real GPU shows; a real-hardware pass is still owed.

## Built
- **`proving-ground/surface.ts`**: zone meshes whose every vertex is `world.sample(x, y).h`. Each zone is a grid in
  its own (u, w), extended by `ZONE_EDGE`. Rows carry their own columns, stitched by a merge walk as in the ribbon.
  Rows and columns sit on every patch and lane edge, so each quad has one surface. The ride-street features get
  dense rows and columns: bumps, sleepers and pothole at 3–5 cm, washboard at λ/12, pavé at the stone centres.
  A triangle is kept only by the zone that owns its centroid: the first footprint in priority order, else the
  nearest band. Material groups are asphalt, cobbles, wet asphalt and wet tiles. Vertex colours tint the zones and
  paint the features: concrete sleepers and step/twist blocks, a dark pothole.
  - Base step per tier: low 2 m, medium 1.5 m, high 1 m, with at most 16 k quads per zone (the pad is drawn at 2 m).
  - Ride street: rows every 0.5 m; at high also columns on the 0.8 m roughness rails.
  - `far` detail (4 m, no feature rows): used by the level-of-detail switch below.
- **`proving-ground/materials.ts`**: the track's own texture ids through `ctx.assets`; no new assets.
  - Asphalt: a far-scaled, blurred copy of the map breaks up the tiling.
  - Wet lanes: `MeshPhysicalMaterial`, clearcoat 1, roughness 0.15, albedo ×0.65. The environment reflection is
    scaled ×0.5 in the shader, because `envMapIntensity` is overridden by `scene.environmentIntensity`. Wet asphalt
    keeps the map; the wet tiles are dark basalt with a 0.6 m grout grid.
- **`proving-ground/markings.ts`**: one vertex-coloured decal mesh, lifted 8 mm with polygon offset. It is derived
  from the content, with no zone-id branching:
  - steering circle: solid line, dashed lane edges;
  - slalom: spot rings, run-up line and start bar;
  - ISO 3888-2: gate edge lines and gates;
  - braking lanes: lane lines, a dashed split edge, a yellow brake bar, an end bar and 10 m ticks;
  - ride street: edge lines (none over the cobbles), yellow bars around each module and a ring round the pothole;
  - link roads: edge lines and a dashed centre line.
- **`proving-ground/props.ts`**: one `InstancedMesh` of lathe cones (orange with a white band, square base), and one
  merged mesh of station signboards (canvas atlas in the track's style), each placed on the GroundWorld.
- **`proving-ground/index.ts`**:
  - Contributes `provingGround` to `registries.worlds` and draws whatever world the simulation grounds on.
  - Chunks: each large or feature zone alone, the rest together. Each chunk is a `BoxLOD`: the tier mesh near, the
    `far` mesh when the camera is more than 100 m from the chunk's bounding box.
  - `performance.measure` probes record build times.
  - e2e only: `globalThis.__annexView(eye, target)` renders a free test view into its own target (the canvas has no
    depth buffer), tone-mapped with AgX.
- **`track/terrain.ts`**: re-baked from the GroundWorld; the local terrain maths is gone.
  - Visible vertices are `world.sample(x, y).h`. Off the ribbon and zones that equals `terrainHeight`; in the 0.5 m
    past the runoff edge it is the road/terrain blend. Hidden vertices are `terrainHeight`.
  - Adaptive quadtree over the loop, field and zones. A 4 m cell splits (to 2 m, then 1 m) where the coarse grid
    bends and the linear error exceeds 1 cm on visible ground. Flat runs merge to 8 m and 16 m. A coarse leaf next to
    finer leaves is drawn as a fan, so there are no cracks. Leaves wholly under the ribbon or a zone are left out. The
    outer ring is unchanged.
  - `groundHeight` is kept only as an alias of sim-core's `loopTerrainHeight`, for `tests/sim-core/world-ground.test.ts`.
- **`track/ribbon.ts`**:
  - The ribbon runs 0.5 m past the runoff edge (18 → 18.5 m), on the GroundWorld's road→terrain blend. The terrain is
    sampled at the runoff edge and the outer edge of every row. Quarter columns are added only where the terrain/road
    step exceeds 3 cm.
  - With a world, the ribbon makes way for the link roads: dense rows, columns on the spur footprint and band
    crossings, `world.sample` heights where a zone contributes, and the triangles inside a spur footprint left out.
- **`track/index.ts`**: passes `sim.current.world` (or a bare GroundWorld) to the ribbon and terrain.

## Measured (real output)

### Node checks

| Check | Result |
|---|---|
| Zone mesh vertices vs `world.sample` | within 1 mm (float32) on low, medium, high and the far LOD |
| Ride-street features between vertices (high) | humps 3.3, washboard 4.3, steps/twist 2.9, pothole 1.2 mm; pavé 17.6 mm (stone centres only; joints in the texture) |
| Other zones between vertices (high) | spurs 3.6 / 3.5, platform 3.7, apron 3.4, street-link 6.0, pad 5.1, pad-link 4.7 mm |
| Overlap and coverage | drawn once (shared-edge hits < 0.2 %); no holes; material = `sample().surface` everywhere |
| Link-road joins | covered with no hole; inside the footprint only the link road draws |
| Ribbon vertices | = `roadHeight` to |l| 17.5; the blend band within 5 mm of `sample` (3.6 mm measured); spur-overlay vertices = `sample` within 1 mm; no ribbon triangle inside a spur |
| Terrain vertices | = GroundWorld (visible: `sample`, hidden: `terrainHeight`), with and without the world |
| Terrain between vertices, 111 877 visible points | p99 7.4 mm, p99.9 11.1 mm, worst 36.2 mm. The worst is beside a competing loop section (19 986 such points), where the drawn grass used to be off by up to 3.46 m |
| Terrain vs paved bands | stays below them |

### Triangles per pass, node

| Mesh | low | medium | high |
|---|---|---|---|
| Annex ground (near) | 84 784 | 139 904 | 196 991 |
| Annex ground (far LOD) | 14 094 | 14 094 | 14 094 |
| Markings | 13 850 | 13 850 | 13 850 |
| Cones | 25 × 252 (instanced) | 25 × 252 | 25 × 252 |
| Terrain, bare | 68 487 (M1: 66 k) | 68 487 | 68 487 |
| Terrain, with world | 116 467 | 116 467 | 116 467 |

The annex draws 11 calls per pass: 8 ground groups, markings, cones and signs.

### Draw calls, `renderer.info`, high tier, SwiftShader

| View | Calls | Triangles |
|---|---|---|
| Loop t = 14, without the annex | 171 | 1 357 575 |
| Loop t = 14, with the annex | 188 | 1 473 917 |
| Steering pad | 158 | 694 076 |
| Braking platform | 172 | 776 570 |
| Ride street | 193 | **1 640 229 (over the 1.5 M budget)** |

At the ride street the near street mesh (doubled by the AO prepass) and the whole M1 high-tier ribbon are in view; see
Known gaps. The `03-01-track` high spec reports 188 calls / 1 473 917 triangles (without the vehicle: 70 / 1 024 097).

### Load times, low tier

| Probe | Browser (SwiftShader, machine loaded by other executors) | Node |
|---|---|---|
| `track-ribbon` | 253–609 ms | bare ~120–190 ms, with spur cut ~220–330 ms |
| `track-terrain` | 384–1119 ms | bare ~240–340 ms, with world ~460–560 ms (M1 terrain ≈ 150 ms) |
| `proving-ground-meshes` | 188–531 ms | 130–270 ms |

The terrain is the cost: about 120 k GroundWorld samples, ~3 µs each near the loop. It is not a blow-up, but it is
2–4× the M1 terrain.

### Commands
```
$ npm run check
✔ no dependency violations found (254 modules, 875 dependencies cruised)
 Test Files  92 passed | 1 skipped (93)
      Tests  917 passed | 11 skipped (928)
$ npx vite build --outDir <scratch>/x1003/build ; vite preview --port 5713 (deploy config restored after the preview was up)
$ PLAYWRIGHT_BASE_URL=http://localhost:5713 npx playwright test 10-03-ground 03-01-track smoke --trace off
```
```
✓ 03-01-track › track textures load … zero console errors (2.7m)
✓ 03-01-track › high tier … (46.1s)            high t=14: 188 calls, 1 473 917 triangles
✓ 10-03-ground › stations, overview and spur joins render; budgets and load time (1.8m)
✓ 10-03-ground › draw calls with and without the annex (high tier) (2.0m)
✓ 10-03-ground › ?features=-proving-ground boots and draws no annex (17.1s)
✓ smoke × 3
8 passed (8.3m)
```
- Spawning works at every station: `mode manual`, zone = the station's zone (10-01's plant fix had landed).

Screenshots (inspected over several rounds), session scratchpad `shots/10-03-*.png`:
- stations: `ride-street`, `steering-pad`, `slalom`, `lane-change`, `braking-platform`;
- free test views: `overview`, `overview-annex`, `spur-east`, `spur-west`, `ride-washboard`, `ride-pave`,
  `ride-sleepers`, `ride-steps-twist`, `ride-pothole`, `circle`, `slalom`, `lane-gates`, `wet-lanes`;
- `no-annex`.

## Deviations
1. **Markings are decal geometry**, one mesh with vertex colours, not `onBeforeCompile`. Geometry is exact on any
   surface, needs no per-pixel loop under SwiftShader, and costs one draw.
2. **Grid density.**
   - The high tier uses 1 m (not 0.5 m), with ≤ 16 k quads per zone; the error is ≤ 6 mm everywhere.
   - Ride-street rows are 0.5 m with 3–5 cm feature rows.
   - The pavé is resolved at the stone centres only (17.6 mm between them). Resolving the joints needs 3 rows per
     stone, about 190 k vertices.
3. **A far level of detail** (4 m, no feature rows) is drawn beyond 100 m from each chunk's box, to keep the 1.5 M
   triangle budget at the M1 measuring point.
4. **The ribbon is 1 m wider** (to 18.5 m), carrying the GroundWorld's road/terrain blend. Without it the terrain
   mesh missed the physics by up to 13 cm right at the ribbon edge beside competing sections.
5. **Terrain without a world is not vertex-equal to the M1 build.**
   - Per 09-04 it is now the bare GroundWorld's blended terrain. The test asserts equality with that.
   - The old `groundHeight` survives as an alias. `tests/sim-core/world-ground.test.ts` (not mine) is now
     tautological: the orchestrator may drop it.
6. **e2e-only global `__annexView`** lives in the proving-ground feature, inert without `?e2e=1`. The kernel's test
   hooks have no camera access.
7. **The annex loads its four textures itself.** Features cannot share the track's textures, so this costs about
   22 MB more VRAM (the 64 MB budget was ~27 MB used).

## Known gaps
- **Ride-street view at high: 1.64 M triangles (over 1.5 M).** The street's near mesh is about 100 k triangles, doubled
  by the AO prepass, and the M1 ribbon at high (338 k, doubled) is in view. A ribbon level of detail would fix it; it is
  outside this plan's acceptance.
- **The wet tiles' grout grid shows only up close.** At grazing angles the reflection dominates and both wet lanes read
  alike: dark and glossy.
- **WIP snapshot.** A snapshot commit (`58e6cf4`) swept my in-progress files, including two scratch tests, which
  `763a060` removes.
- **Shared scratchpad.** Another executor overwrote `scratchpad/rebuild.sh`, so one of my early e2e rounds measured a
  stale build. Final runs use `scratchpad/x1003/`.

## Lifted code
None.
