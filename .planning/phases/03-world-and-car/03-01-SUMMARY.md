# 03-01 SUMMARY — Track view

**Status:** complete (not deployed).
**Commits:**
- `e3d6e6f` plan
- `e2fcb09` ribbon + materials
- `a7a8325` terrain, props, feature init
- `e5fd99b` tests + e2e + 4-chunk culling
- `f64371d` removes the scratch harness that a WIP snapshot swept in
- this summary

## Built (`src/features/track/`)

### `ribbon.ts` — the road is the simulation's surface

Every vertex is `BuiltTrack.toWorld(s, l)` passed through `simToThree`, with y = `roadHeight(s, l)`. UV = (l, s) in metres. The sample formula is the same as `toWorld`'s, done once per row.

**Rows** (stations along s):
- a uniform base grid at the tier's `trackResolution` (1 / 0.5 / 0.25 m), with spacing L / ceil(L / res) so the loop closes evenly;
- base rows inside a feature zone are replaced by the zone's own rows (`featureZones`):

| feature | row spacing | extra columns |
|---|---|---|
| cosine bump | 5 cm | 5 cm across its lateral band |
| pothole | 5 cm | 5 cm across its diameter |
| kerb strike | 10 cm | 1.5 cm steps on both 6 cm kerb-edge ramps, strike side only |
| washboard | shortest wavelength / 12 (high) or / 7 | — |
| humps | 15 cm | — |
| pavé | one row per stone centre (aligned to the sim's 12 cm stone grid) | high only: one column per stone centre across the asphalt |
| crest / dip | base rows (it is smooth macro elevation) | — |

**Columns:**
- band edges ±4.5 / ±6 / ±8 / ±18 m;
- the sim's ISO-8608 rail multiples of 0.8 m across the asphalt (roughness is linear between rails, so the mesh is exact laterally);
- each zone's extra columns.

**Stitching:** consecutive rows with different column sets are joined by a merge walk. There are no T-junction cracks.

**Closing row:** the row at s = L repeats row 0. Its normals are welded to row 0's, and every along-track texture/stripe period is rounded to a whole number per lap, so the closure has no seam.

**Material groups** (bands): asphalt, cobbles (asphalt band inside the pavé), kerb, apron (2 m shoulder), grass. The ribbon is drawn as 4 chunks along s that share one vertex buffer (own index and groups, own bounding sphere), so off-screen parts are frustum-culled. That is at most 17 groups + terrain + cones + boards = 20 draw calls per pass.

**Mesh sizes:**

| tier | vertices | triangles | build time |
|---|---|---|---|
| low | 56 k | 106 k | ≈ 0.2 s |
| medium | 84 k | 159 k | ≈ 0.1 s |
| high | 177 k | 338 k | ≈ 0.3 s |

### `materials.ts` — MeshStandardMaterial + `onBeforeCompile` (GLSL)

Each variant has its own `customProgramCacheKey`.

**Asphalt** (CC0 `asphalt_track` diffuse + normal):
- far-scale mottle against tiling;
- darker, smoother rubbered wheel tracks along the driving line (`aPaint.x`);
- AA'd (`fwidth`) white edge lines, section-start ticks, a start-line chequer at the `start-line` prop;
- yellow bars before and after the washboard, bump, pavé and humps, and a yellow ring around the pothole;
- paint wears in the wheel tracks and is smoother than the asphalt.

**Kerbs:** AA red/white stripes (2 m period, whole number per lap) on corners tighter than about R150–260 m and on the strike side of the raised kerb strike, with a crisp start. Elsewhere the kerbs are plain concrete grey.

**Other surfaces:**
- Apron: the asphalt texture, lighter.
- Cobbles: CC0 `cobblestone_floor_08` diffuse + normal at a 1.1 m tile.
- Grass: CC0 `grass_ground` mapped in world space, so the runoff grass and the terrain match. It is recoloured to a mown green and two far scales break the tiling.

Roughness and AO maps are skipped to stay inside the VRAM budget: 6 textures, about 32 MB with mips. Anisotropy follows `store.quality`.

### `terrain.ts`

One indexed grid: 4 m cells over the track's bounding box + 40 m, then growing ×1.25 per step out to 4.5 km (33 k vertices, 66 k triangles, ≈ 0.15 s). Height comes from the nearest centreline point:
- **under asphalt/kerb/apron:** 0.3 m below the road plane (hidden);
- **under runoff grass:** 6 cm below `roadHeight`;
- **beyond the runoff edge:** 3 cm below it, dipping 0.6 m over 30 m, then blending over 20–220 m into a long-wave field. That field is fully fogged long before its edge.

### `props.ts`

- One `InstancedMesh` of ISO-DLC cones from `track.props` (vertex-coloured orange/white).
- One merged mesh of low section signboards on the right apron, 4 m into each section, toed in towards the road. Names come from the content (no digits) on a single canvas atlas in Geist Sans with the accent bar.

### `index.ts`

Contributes the proving loop as before, then on init:
- loads textures via `ctx.assets`;
- builds everything at the boot tier;
- disposes everything on teardown;
- has no per-frame work.

## Deviations / notes for the orchestrator

1. **Placeholder shortcut.** `index.ts` hides the renderer placeholder's ground disc and centreline line by
   name/type (`scene.getObjectByName('placeholder')`). They would z-fight the road while no vehicle visual is
   registered. This is commented as a shortcut and goes when the placeholder is deleted (03-02 SUMMARY note 6).
2. **Frame budget at high is exceeded by the full frame, not by the track.**
   - At t = 14 the high tier measures **265 calls** with the DB11 + suspension visuals, and 111 without `vehicle-view`.
   - N8AO's prepass renders every mesh a second time, so every feature's calls double at high.
   - The track's share is ≤ 20 per pass (node-tested ≤ 30).
   - The 03-02 high-tier e2e asserts ≤ 250 for the full frame, so it may fail once the car is in. That is the
     car's (90-call) share × 2 passes plus shadow. My e2e asserts that the frame without the vehicle leaves the
     car its 90 (111 ≤ 160).
3. **Horizon haze line.**
   - The terrain runs to 4.5 km, but the environment's linear fog colour (HDRI 2–8° band, sky-ish) is lighter
     than the HDRI's own ground just above the horizon, so a thin light line shows where the fogged ground meets
     the background.
   - Fixing it is an environment change (fog colour sampled just below the horizon, or exponential fog); I can't
     edit `environment/`.
4. **Pavé stones are pyramids.** The mesh is exact at stone centres (and on the 0.8 m rails / base rows). Between
   them it interpolates linearly, so the mesh deviates from the true surface by up to about the joint depth plus
   stone amplitude (≈ 1 cm) in places. The cobblestone texture carries the look.
5. **Roughness** shorter than the tier's row spacing is not resolved between vertices. A node test asserts
   < 12 mm on both wheel paths of the driving line over the whole lap (high tier).
6. No code lifted. Assets: the four CC0 Poly Haven texture sets already in the manifest and CREDITS.

## Known gaps
- Looks tuned by eye under SwiftShader only. A real-GPU pass should check the asphalt sheen at low sun and the
  grass tint.
- The washboard and humps are visible through lighting and the yellow bars. The bump is small at chase distance,
  which matches its 5 cm reality.
- No barriers or tyre walls (kept minimal on purpose).

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (128 modules, 362 dependencies cruised)
 Test Files  33 passed (33)
      Tests  355 passed (355)
$ npx vitest run tests/features/track.test.ts
      Tests  11 passed (11)
  (vertex == toWorld/roadHeight for low+high tiers; plan area == L × 36 m to 1e-3 with no negative triangles;
   closing row == row 0; chunk budget ≤ 30; dense feature rows; mesh-vs-roadHeight on wheel paths < 12 mm;
   terrain under paved bands)
$ npx playwright test tests/e2e/03-01-track.spec.ts --trace off
high t=14 draw calls: full frame 265, without the vehicle 111; triangles 1197814 / 744146
  ✓ high tier (shadow, AO, fine ribbon) compiles cleanly; without the car the frame leaves the car its budget (57.1s)
  ✓ track textures load, the road renders around the lap with zero console errors and warnings  (earlier run, 3.0m)
```
Full `npm run e2e`: see the final report. Concurrent executors rebuilding `dist/` under a running `vite preview`
make every later spec time out in `waitForReady`.

Screenshots (DPR 1, inspected) are in the session scratchpad `shots/`:
- app chase camera: `03-01-app-t{1,15,30,50,62,82}.png`, `03-01-app-high-t14.png`;
- scratch free-camera harness (not committed): `03-01-h-{overview,hairpin,bump,pothole,strike,pave,wash,dlc,carousel,seam,start}.png`.

Fixed during review:
- `half` is a reserved word in GLSL;
- grass read grey-brown;
- plain kerbs were too bright;
- the apron looked like gravel;
- kerb-strike stripes showed on both sides;
- the kerb paint start was smeared.
