# 03-01 SUMMARY — Track view

**Status:** complete (not deployed).
**Commits:**
- `e3d6e6f` plan
- `e2fcb09` ribbon + materials
- `a7a8325` terrain, props, feature init
- `e5fd99b` tests + e2e + 4-chunk culling
- `f64371d` removes the scratch harness that a WIP snapshot swept in
- `2910b84` one road shader, gated markings
- `5fdf6fe` road-first / field-last render order
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

**Material groups:**
- `road` = asphalt + kerbs + apron (2 m shoulder), one shader that switches on |l|;
- `cobbles` (the asphalt band inside the pavé);
- `grass`.

The ribbon is drawn as 4 chunks along s that share one vertex buffer (each with its own index, groups and bounding sphere), so off-screen parts are frustum-culled. That is at most 9 groups + terrain + cones + boards = **≤ 12 draw calls per pass**. The road draws first (renderOrder −1) and the field last (+1), so hidden ground fails the depth test early. In SwiftShader that roughly halved the high-tier frame.

**Mesh sizes:**

| tier | vertices | triangles | build time |
|---|---|---|---|
| low | 56 k | 106 k | ≈ 0.2 s |
| medium | 84 k | 159 k | ≈ 0.1 s |
| high | 177 k | 338 k | ≈ 0.3 s |

### `materials.ts` — MeshStandardMaterial + `onBeforeCompile` (GLSL)

Each variant has its own `customProgramCacheKey`.

**Road** (CC0 `asphalt_track` diffuse + normal); on the asphalt:
- darker, smoother rubbered wheel tracks along the driving line (`aPaint.x`);
- AA'd (`fwidth`) white edge lines, section-start ticks, a start-line chequer at the `start-line` prop;
- yellow bars before and after the washboard, bump, pavé and humps, and a yellow ring around the pothole;
- paint wears in the wheel tracks and is smoother than the asphalt;
- the marking loop runs only where a per-vertex gate (`vMark`, within 1.5 m of a mark along s) says so.

**Kerbs** (same shader): AA red/white stripes (2 m period, whole number per lap) on corners tighter than about R150–260 m and on the strike side of the raised kerb strike, with a crisp start. Elsewhere the kerbs are plain light grey.

**Other surfaces:**
- Apron (same shader): the asphalt, lighter and duller.
- Cobbles: CC0 `cobblestone_floor_08` diffuse + normal at a 1.1 m tile.
- Grass: CC0 `grass_ground` mapped in world space, so the runoff grass and the terrain match. It is recoloured to a mown green and two far scales break the tiling.

Roughness and AO maps, and the concrete set, are skipped to stay inside the VRAM budget: 5 textures, about 27 MB with mips, and about 4 MB downloaded. Anisotropy follows `store.quality`.

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
2. **Frame budget.**
   - At high, t = 14 measures **213 draw calls** with the DB11 + suspension visuals; without `vehicle-view` it
     measured 53–95 across runs.
   - The N8AO prepass renders every mesh a second time, so every feature's calls double at high.
   - The track uses ≤ 12 per pass, node-tested ≤ 30.
   - Triangles: 1.20 M at high, of which the track is ≤ 338 k ribbon + 66 k terrain per pass when everything is
     in view.
3. **SwiftShader cost / e2e timing.**
   - The textured, lit ground covers most of the screen, so under SwiftShader a high-tier frame takes about
     1.4 s (about 2.5 s before the render-order fix, measured at load average ≈ 7).
   - In the full suite, the 60 s high-tier specs of 03-02 and 03-04 pass in 52–60 s on an otherwise idle
     server. They timed out while other executors loaded the machine (load average 7–8).
   - **Recommend `test.setTimeout(120_000)` in those high-tier specs**, as 03-03 did.
4. **Horizon haze line.**
   - The terrain runs to 4.5 km, but the environment's linear fog colour (HDRI 2–8° band, sky-ish) is lighter
     than the HDRI's own ground just above the horizon, so a thin light line shows where the fogged ground meets
     the background.
   - Fixing it is an environment change (fog colour sampled just below the horizon, or exponential fog); I can't
     edit `environment/`.
5. **Pavé stones are pyramids.** The mesh is exact at stone centres (and on the 0.8 m rails / base rows). Between
   them it interpolates linearly, so the mesh deviates from the true surface by up to about the joint depth plus
   stone amplitude (≈ 1 cm) in places. The cobblestone texture carries the look.
6. **Roughness** shorter than the tier's row spacing is not resolved between vertices. A node test asserts
   < 12 mm on both wheel paths of the driving line over the whole lap (high tier).
7. No code lifted. Assets: the four CC0 Poly Haven texture sets already in the manifest and CREDITS.

## Known gaps
- Looks tuned by eye under SwiftShader only. A real-GPU pass should check the asphalt sheen at low sun and the
  grass tint.
- The washboard and humps are visible through lighting and the yellow bars. The bump is small at chase distance,
  which matches its 5 cm reality.
- No barriers or tyre walls (kept minimal on purpose).

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (150 modules, 430 dependencies cruised)
 Test Files  43 passed | 1 skipped (44)
      Tests  473 passed | 11 skipped (484)
$ npx vitest run tests/features/track.test.ts
      Tests  11 passed (11)
```
The track test checks:
- vertex == toWorld/roadHeight for the low and high tiers;
- plan area == L × 36 m to 1e-3, with no negative triangles;
- closing row == row 0;
- the chunks share the buffers and stay inside the draw budget;
- dense feature rows;
- mesh vs roadHeight on the wheel paths < 12 mm;
- terrain under the paved bands.

```
$ npm run build            ✓ built
$ npx playwright test (PLAYWRIGHT_BASE_URL = private snapshot of this build, see below)
  ✓ 03-01-track › track textures load, the road renders around the lap with zero console errors and warnings (1.6m)
high t=14 draw calls: full frame 213, without the vehicle 95; triangles 1197814 / 744146
  ✓ 03-01-track › high tier (shadow, AO, fine ribbon) compiles cleanly; without the car the frame leaves the car its budget (28.8s)
  ✓ smoke × 3
  ✓ 03-02-env × 3, 03-04-parts × 3 (52–60 s each, default 60 s timeout, after the render-order fix)
```
Full suite before the render-order fix: 15 passed, 6 failed, 1 skipped.
- 03-02 high and closeup, 03-04 × 3: 60 s timeouts at load average 7.5.
- 06-02 chips: a 60 s timeout in `locator.press`. That spec isn't mine.

**Why a private snapshot:**
- Other executors rebuild `dist/` while a `vite preview` is running. The preview then serves `index.html` for the
  new hashed chunks, and every later spec times out in `waitForReady`. This happened to two full runs.
- So e2e ran against a private copy of `dist/` served by `wrangler dev -c <copy>/suspension_lab/wrangler.json`
  (the same workerd and Worker).

Screenshots (DPR 1, inspected) are in the session scratchpad `shots/`:
- final build: `03-01-final-t{12,30}-high.png`, `03-01-final-t62-med.png`, `03-01-v2-t{8,19}-high.png`;
- e2e: `03-01-app-t{1,15,30,50,62,82}.png`, `03-01-app-high-t14.png`;
- scratch free-camera harness (not committed): `03-01-h-{overview,hairpin,bump,pothole,strike,pave,wash,dlc,carousel,seam,start}.png`.

Fixed during review:
- `half` is a reserved word in GLSL;
- grass read grey-brown;
- plain kerbs were too bright;
- the apron looked like gravel;
- kerb-strike stripes showed on both sides;
- the kerb paint start was smeared;
- the SwiftShader cost was too high (render order, one road shader, gated markings).
