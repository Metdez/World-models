# 07-01 SUMMARY — Render performance + visual polish

**Status:** complete (no deploy). All looks were judged under SwiftShader (headless software GL, ≈ 0.1–1 frame/s,
machine load 9–17): colours, AA and frame times are NOT what a real GPU shows. A real-hardware pass is still owed.
Commits: `8332a7b` (plan + clampIc), WIP snapshot `ad02f6b` (swept in: camera, attract, overlay focus, governor
ceiling), `236f75d`, `b4dd15f`, `e9d8c77`, `617e7d4`, `27dada0`, `2de8c74`, and this summary.

## Built
1. **Bike close-up** (`camera/index.ts`, `camera/rig.ts`, `motorcycle/visual/cafe-racer.ts`)
   - Bike x-ray now ghosts **bodywork only** (tank, hump, side panels via the paint mesh; seat, battery box, badges,
     tail via a new `body:bodywork` palette mesh). Frame, engine, exhausts stay solid (bike 6 → 7 draws).
   - Close-up x-ray rule: car → on (as before); bike fork (`f`) → solid; bike rear (`r`) → bodywork ghost, so the
     Modern monoshock reads. One `syncXray()` handles entering, corner changes and vehicle swaps.
   - Side framing films the **outside of the lean** (hysteresis 0.17 rad, once per corner, glide or cut per reduced
     motion) and follows 85 % of a lean away from the lens, so the eye stays square to the bike's side and never
     sees the underside. A single-sided arm keeps its fixed side (un-leaned frame, as before).
   - Overlay in close-up draws only the focused corner/end (`construction.draw(..., focus)`); a car keeps its axle's
     ground line up to the centreline and the RC. Fixes the opposite front corner's lines at the left of frame.
2. **`clampIc`** (`sim-core/moto/planar.ts`): an IC at infinity sits at IC_MAX (5 m), so the overlay fades the line
   and draws no ring. Moto goldens did not change (IC is not hashed); sim-core 220/220 green.
3. **Explore**: zoom range per vehicle (car 3.4–16 m, bike 1.6–9 m); handover from a close-up backs off to
   1.9 × min distance. Wheel zoom verified working (07-01-after1-car-explore-34 → -zoomout); pinch is camera-controls'
   default two-finger dolly (not exercised, no touch device here).
4. **Attract**: hero orbit opens on a cut at a front-left three-quarter (−0.55 rad) and turns 0.12 rad/s toward the
   profile; director time = the sim's own lap-time progress ÷ time scale, so seeks land on their section `lead`
   seconds in, on any machine; the bike beat no longer forces x-ray.
5. **Bike looks**: crankcase is a lofted rounded-box casting (was a flat extrusion) with a 5-rib finned sump; engine
   paint a touch lighter/glossier; clutch cable and brake hose loop from the levers to the lower yoke (splitter).
   +13.7k triangles, no extra draws. Tank profile and header routing unchanged (they read fine in the new shots).
6. **Car**: MacPherson top mount plate/isolator hang under the hardpoint, r 0.075 → 0.058. Node test raycasts the real
   DB11 shell: clearance −11 mm (poked through the wing) → +11 mm; DW 173 mm, ML 154 mm. Paint hue `0x103a1c`
   (reads green, not teal); `underbody` near-black, rough, non-metal (diffuser no longer a light grey panel).
7. **Performance**
   - FXAA on the low tier (inside the same EffectPass).
   - Governor: `ceiling` = lowest ratio found slow; climbing never returns to it → no oscillation (test with a cliff
     load fails without it, passes with ≤ 4 changes over 10 min).
   - CSS2DRenderer walked the whole scene and allocated every frame with no labels in the app: it now runs only
     once a CSS2D object is added via `RENDER.add`. linkage-parts' per-frame `[chassis, ...torsos]` array removed.
   - New `tests/e2e/07-01-perf.spec.ts`.

## Measured (SwiftShader, 1280×720, DPR 1, `renderer.info`, lap t=14)
| tier | car follow | car close-up | bike follow | bike close-up |
|---|---|---|---|---|
| high | 171 calls / 1.19 M tris | 145 / 0.59 M | 111 / 1.01 M | 96 / 0.52 M |
| medium | 149 / 0.86 M | 123 / 0.49 M | 88 / 0.67 M | 80 / 0.43 M |
| low | 77 / 0.64 M | 55 / 0.32 M | 44 / 0.54 M | 36 / 0.29 M |

GPU resources after warm-up 74 geometries / 73 textures; after 3 more rounds of all 6 suspensions × 2 vehicles:
74/73 ×3 (no leak). Bike visual: 7 draws / 90k tris; suspension 16–19 draws / 33–44k.

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (207 modules, 641 dependencies cruised)
 Test Files  58 passed | 1 skipped (59)
      Tests  658 passed | 11 skipped (669)
$ npx vite build --outDir <scratch>/b0701/after2 ; python3 -m http.server 5703 (private)
$ PLAYWRIGHT_BASE_URL=http://127.0.0.1:5703 npx playwright test 07-01-perf 04-01-camera 05-03-motorcycle 04-04-overlays --trace off
  5 passed (35.5m)
```
$ PLAYWRIGHT_BASE_URL=http://127.0.0.1:5703 npx playwright test smoke 03-02-env 03-03-car 03-04-parts --trace off
  6 passed, 5 failed: all 5 = 120 s screenshot timeouts at load 15 (high tier, concurrent harness + vitest)
$ (same build, quieter machine) npx playwright test 03-02-env 03-04-parts --trace off
  6 passed (5.7m)

Screenshots (inspected), session scratchpad `shots/`: `07-01-before-*.png`, `07-01-after1-*.png` (car, attract hero,
explore zoom), `07-01-after2-bike-*.png` (bike follow, fork and rear close-up per preset, explore).

## For other owners
- `controls` (07-03): X is still a no-op in every close-up; for a bike fork close-up the visitor cannot turn the
  bodywork ghost on. Suggest: block X in close-up only for cars.
- sim-core track surface (02-01): boxing churn 27–225 B per sim step (`roadHeight`, `track.sample`, `stateAt` double
  args/returns) is outside my files; unchanged.
- The first `npm run check` under load timed out `tests/sim-core/simulation.test.ts` full-lap test (8 s > 5 s); it
  passes on a quieter machine.

## What still looks off
- A single-sided arm (Telelever rear) is filmed from its fixed side: leaning toward the lens it still shows the
  underside a little.
- The leaned-away fork close-up looks down ~30°; dramatic, but the road plane tilts strongly.
- Rear close-up: the near-side silencer crosses the swingarm/linkage; the bodywork ghost is still the light-blue shell.
- No wheel motion blur (skipped: not cheap without a velocity pass). Arch-liner light edge not specifically checked.
- Every look judged in SwiftShader only.
