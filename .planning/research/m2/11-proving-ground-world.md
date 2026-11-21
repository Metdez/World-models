# M2-11 — From one test loop to a small explorable proving ground

Scope: research only. Tags: [S] sourced (link), [E] estimate / derived by me, [M] from memory, unverified.
Context: the existing 1.65 km clothoid loop (`src/sim-core/content/proving-loop.ts`, research 11 §C, ARCHITECTURE §7.5) runs
roughly x in [-190, +190] m, y in [-400, +10] m, start line at the origin heading +x, left = +y [E from research 11 §C
end-coordinates; confirm against the real bbox before placing the annex]. The loop already contains washboard, brake zone, hairpin,
bump/pothole/kerb strip, sweeper, pavé + humps, chicane, crest/dip, carousel, ISO 3888-1 DLC, off-camber. So the new world adds
only what a *looped autopilot path cannot give*: open area (free steering), low-mu / split-mu, a 2-D slalom and ISO 3888-2, and harsher rough-road modules.

---------------------------------------------------------------------------------------------------
## (a) What real proving grounds contain (with dimensions)

### Open dynamics area / skid pad / steering pad
| Facility | Dimension | Source |
|---|---|---|
| Millbrook steering pad | 137 m diameter | [S] https://newsroom.toyota.eu/toyota-gt86-breaks-the-final-frontier-with-donuts-from-space-1 |
| Holden (Lang Lang) skid pan | 98 m diameter | [S] https://en.wikipedia.org/wiki/General_Motors_proving_grounds |
| GM Milford Vehicle Dynamics Area | 300 m x 300 m (1000 x 1000 ft) | [S] same Wikipedia page |
| GM Milford "Black Lake" | 67-acre test pad (~520 m square equiv.) | [S] https://news.gm.com/home.detail.html/Pages/news/us/en/2024/sep/0925-mpg100-20-facts.html |
| GM Milford active-safety dynamics pad | 160 m x 400 m, constant slope | [S] https://peagroup.com/what-we-do/our-work/gm-milford-proving-ground-active-safety-test-area |
| Nardò Dynamic Platform A | 280 x 280 m, two 700 m x 20 m straights, circle radii 10/30/35/40/100 m, 16 curves | [S] https://www.porscheengineering.com/en/nardo/services/the-proving-ground/test-tracks-facilities/dynamic-platform-a |
| Mahindra MSPT dynamic platform | 250 m diameter circle | [S] https://dewesoft.com/blog/list-of-automotive-proving-grounds |
| Michelin Laurens skidpads | B1 asphalt 60 m radius (390 ft dia), B2 polished concrete 120 m radius (790 ft dia); standard water depth 0.5-1.0 mm | [S] https://michelinpg.com/track-1-skidpads-hydroplaning |
| Michelin Laurens Track 8 asphalt pad | 400 ft x 1400 ft (~122 x 427 m), used for lane changes, handling, autocross | [S] https://michelinpg.com/track-8-large-asphalt-pad-multiple-uses/ |

Take-away: real pads are 100-300 m. For a keyboard-driven car at <= 80 km/h, **R = 35-45 m circle** is plenty (v at 0.8 g on R40 = sqrt(0.8*9.81*40) = 17.7 m/s = 64 km/h [E]).

### ISO 3888 lane-change tracks (cone layouts) [S unless noted]
Sources: ISO 3888-2:2011 sample https://cdn.standards.iteh.ai/samples/57253/5e8cdcc7c2fe4c0c8fe6f1de8beb5dba/ISO-3888-2-2011.pdf ; ISO 3888-1:2018 sample https://cdn.standards.iteh.ai/samples/67973/daa839ed4aca420788d9b4a51cd6cc95/ISO-3888-1-2018.pdf
W = vehicle overall width without mirrors (ISO 612). Cones >= 500 mm tall; the track limit is **tangent to the cone base circles** (the cone base-circle diameter is in Fig. 2 which the extracts did not carry; I use 0.30 m [E]).

ISO 3888-2 (obstacle avoidance, "moose test"), total 61 m:
| Section | Length (m) | Lane offset | Gate width b |
|---|---|---|---|
| 1 entry | 12 | - | 1.1 W + 0.25 |
| 2 lane change | 13.5 | - | - |
| 3 offset lane | 11 | **1.0 m** | W + 1.0 |
| 4 return (1 m shorter than 2 "to ensure high lateral accelerations") | 12.5 | - | - |
| 5 exit | 12 | - | 1.3 W + 0.25 but >= 3 m |
Derived for W = 1.94 m [E: DB11 spec, ~1.94 m excl. mirrors; read W from the GLB as `db11-fit.test.ts` already does]: entry 2.39 m, offset-lane 2.94 m, exit 3.00 m.
ISO 3888-1 (double lane change), total 125 m: lengths 15/30/25/25/15/15, offset **3.5 m**, widths 1.1W+0.25 (sec 1), 1.2W+0.25 (sec 3), 1.3W+0.25 (sec 5 and 6). Already in the loop as S10.
Cone count: each gate is 2 cones per pair; ISO 3888-2 Figure 3 letters a-k,a'-k' => ~ 22-24 cones [E, from the letter keys in the extract].

### Slalom
- 12 cones, 18 m apart on dry asphalt (tyre subjective test): https://www.tirestesting.com/tires-testing/subjective-evaluation/subjective-dry-condition/dry-slalom [S]
- Literature range 17 / 18 / 23 / 30 m: https://www.researchgate.net/figure/The-computed-ISO-slalom-tests-with-a-standard-sports-utility-car-on-the-left-hand-side_fig2_2662407 [S]
- UK motorcycle Mod-1 slalom, 5 cones 4.5 m apart at 15-20 km/h: https://passrates.uk/guide/motorcycle-mod-1-slalom [S] (useful for the cafe racer)
- Sine-path physics [E]: peak a_y = A (2 pi v / lambda)^2 with lambda = 2 x spacing. 18 m, A = 1.5 m, 60 km/h gives 1.3 g (too violent for a keyboard). **25 m spacing, A = 1 m, 50 km/h gives 0.31 g**; 30 km/h at 12 m for the motorcycle.

### Rough-road / durability modules
| Module | Real dimensions | Source |
|---|---|---|
| Nardò "Special Pavements" (4 m + 4 m wide, 1,150 m) | cobbled 250 m, heavy cobblestones 375 m, holes 295 m, long waves 100 m, sleepers 110 m, metal sleepers 43.2 m, twist 40 m | [S] https://www.porscheengineering.com/en/nardo/services/the-proving-ground/test-tracks-facilities/special-surfaces |
| Nardò curbstone area | 100 m long, step 0.15 m | [S] same page |
| Nardò reverse-gear track | 150 m x 6 m | [S] same page |
| NATC (Nevada) 2-inch washboard | 411 ft, amplitude 2 in, 2 ft peak-to-peak spacing, sinusoidal, MIL-STD-810 | [S] https://natc-ht.com/about-us/test-courses |
| NATC 6-inch washboard | 798 ft, amplitude 6 in, wavelength 6 ft | [S] same |
| NATC radial washboard | 243 ft, amplitude 2-4 in, wavelength 2-5 ft | [S] same |
| NATC 3-inch spaced bumps | 764 ft, angled timbers, irregular spacing "to let the suspension settle between impacts" | [S] same |
| NATC Belgian block | 1,970 ft (half the APG course); random pitch + roll plus HF low-amplitude vibration | [S] same |
| Millbrook Belgian block circuit | 1.4 km, 3,500 t hand-laid granite setts | [S, weak: AI-written aggregator] https://grokipedia.com/page/Millbrook_Proving_Ground |
| Millbrook Hill Route | 6.5 km, gradients 6.5 % - 26 %, "yump" | [S] https://dewesoft.com/blog/list-of-automotive-proving-grounds ; https://en.wikipedia.org/wiki/Millbrook_Proving_Ground |
| MIRA lengths (VI-grade listing) | ride & handling 2,250 m, city 3,700, wet handling 1,700, ride surfaces 4,200 | [S] https://www.vi-grade.com/en/solutions/digital-models/proving-grounds/mira-proving-ground-2649 |
| Millbrook High Speed Bowl | 3.2 km (2 mi), 5 lanes, banking up to 24 deg on outer lane | [S weak] Grokipedia page above; skip in our world (does not fit 600 x 400 m) |

(Chatter bumps / "rumble" spacing is not published by the facilities; the washboard rows above are the sourced equivalent. The loop's chirp lambda 3.0 -> 0.9 m washboard is already inside the NATC range; pavé stone ~100-150 mm from research 11 [M].)

### Low-mu, wet, split-mu
| Facility | Detail | Source |
|---|---|---|
| Nardò Low Friction Area | 50 m x 4 m, **ceramic tiles, mu 0.1**, atomising nozzles, adjacent surface AC 12 | [S] special-surfaces page above |
| AVL ZalaZONE braking platform | 1,100 m total = 750 m acceleration + 200 m braking + 150 m safety; 8 lanes: chess-board, rough asphalt mu ~1, Japanese tiles **mu ~0.1**, blue basalt **mu ~0.3**, asphalt **mu ~0.8**, polished concrete **mu ~0.6**, asphalt, aquaplaning basin (<= 5 cm); lanes 4.5 m wide (basalt 8 m); each lane watered separately; 20 m asphalt run-off each side | [S] https://avlzalazone.com/testing-and-track/braking-platform |
| AARC low-mu basalt tiles | 120 m, mu 0.3, **hot-mix adjacent "to allow split use testing, both wet and dry"**; VCA-approved for ECE R13 Annex 13 App. 4 | [S] https://www.aarconline.com/research-and-development/tracks-and-facilities/low-mu-basalt-tiles ; AARC brochure: ceramic tiles mu 0.1 https://aarclive.sfo2.cdn.digitaloceanspaces.com/public/Uploads/AARC-Brochure-2016.pdf |
| SSOE design brochure | low-coefficient facility with ceramic + basalt tile paths, automated pre-wet and continual water-depth spray | [S] https://www.ssoe.com/wp-content/uploads/brochures/ssoe_test-track-brochure.pdf |
| Michelin Laurens plateau | water-depth-controlled wet braking, four lanes of different grip | [S] https://michelinpg.com/track-1-plateau-area-wet-braking |

Design consequence [E]: stopping distance d = v^2 / (2 mu g). From 50 km/h (13.9 m/s): mu 0.8 = 12 m, 0.3 = 33 m, 0.1 = **98 m**. From 80 km/h mu 0.1 would need 252 m. Real sites therefore use only low-speed entry on tiles (Nardò: "low-speed braking in skid conditions"). Our tile strip: **100 m long, entry <= 50 km/h**, plus 40 m safety.

### Other furniture seen on real grounds [S]
IDIADA: dry handling circuit with tyre walls and extended run-off, wet circle, wet-asphalt braking, safety barriers, line marks, watering system (https://www.applus.com/global/en/news/IDIADA-enhances-Proving-Ground-test-tracks ; https://www.applusidiada.com/global/en/what-we-do/service-sheet/test-facility-design). Nardò: parking-assist area 130 x 35 m, kerbs (above). Milford: 2.9 mi road course with 17 turns "emulating famous circuits", 3.1 mi ride road (Wikipedia GM page). I found no *published* dimensions for chatter bumps, kerb-strike profiles, or armco spacing; those numbers below are [E].

---------------------------------------------------------------------------------------------------
## (b) Which stations reveal suspension differences to a keyboard driver

Keyboard input is bang-bang and low-bandwidth; the player cannot hold a precise steering angle or pedal. Good stations are ones where **a held key + constant speed produces a repeatable, visible body/wheel response**, and where the Auto ghost can be sent through the same station for a direct A/B.

| Rank | Station | Why it works for a layperson | Suspension relevance (honest) |
|---|---|---|---|
| 1 | **Chirp washboard / 6-in washboard** (hold W at 3 speeds) | Resonance is visible *and* audible/felt: body bounce at the wavelength-speed match, wheels hop at a different speed; no steering skill needed | spring/damper, unsprung mass (all 3 types differ mainly through motion ratio, friction, mass) |
| 2 | **Belgian pavé + sleepers/timber bars** | Obvious harshness, wheel-hop, camera shake; trivial to drive | unsprung mass, bushing compliance, MacPherson strut friction |
| 3 | **Steering pad (R40, hold steer + throttle)** | Held-key steady state: roll angle, understeer, outer-tyre camber, load transfer; keyboard steering smoothed to a constant angle is enough | roll stiffness, camber gain, roll centre (type-dependent) |
| 4 | **Slalom (25 m)** | Roll reversal rhythm is visible as the body rolls side to side; cones give a score | roll rate/damping, ARB, roll-centre migration |
| 5 | **ISO 3888-2 gate** | Short, dramatic, binary pass/fail, spontaneously replayable | transient roll/yaw damping; geometry differences are small -> keep claim modest |
| 6 | **Kerb step (40/80 mm) + one-wheel bump** | Single-wheel impact -> toe/camber kick, body warp; visible in the wheel and the chassis | bump steer/kinematics (type-dependent) |
| 7 | **Brake zone / hill** | Pitch (dive/squat) visible; same for all types unless anti-dive modelled | mostly springs/geometry (anti-dive) |
| 8 | **Low-mu tiles / split-mu** | Spectacular, but it is a *tyre + brake* lesson, nearly suspension-agnostic. Include for fun/grip honesty, label "tyre grip demo, not suspension" | none (do not oversell) |

Recommendation: ship ranks 1-6 as the "suspension stations"; 7-8 as "driving fun". Add an in-world **"Ghost run"** button at each station that plays the Auto car through the station at the same speed for the other suspension type, so the viewer sees two cars side by side (state is a pure function of time, so a ghost is just a second `stateAt(t)`; [E] feasible).

---------------------------------------------------------------------------------------------------
## (c) Tech: collision, ground, surfaces, boundaries, props, wet shader

### c1. Ground query: analytic heightfield function wins; BVH is optional
- **Decisive constraint**: `sim-core` must be pure TS with no three imports and deterministic (BRIEF). three-mesh-bvh operates on `THREE.BufferGeometry`, so it cannot live in sim-core. Therefore the ground must be an analytic function that sim-core evaluates and the renderer *also* evaluates/bakes. This is exactly the "CPU == GPU, they never disagree" pattern described in https://discourse.threejs.org/t/eternal-ride-infinite-terrain-in-three-js-with-no-lod-no-seams/91868 (idea only; forum snippet, no licence stated).
- three-mesh-bvh: https://github.com/gkjohnson/three-mesh-bvh , **MIT** [S], ~3.5k stars [S], npm 0.9.x [S jsDelivr], README "casting 500 rays against an 80,000 polygon model at 60 fps" [S], examples "player movement" and "sphere physics collision" that do capsule-vs-triangle via `shapecast` + `closestPointToSegment` and push-out by `radius - distance` along the closest-point direction [S, read from `example/characterMovement.js`]. Build cost for ~100k triangles is of order 10-100 ms [E, not measured]. Use it only for render-side needs (camera-vs-scenery collision, picking cones/stations with the mouse), never for the car.
- Rapier (`@dimforge/rapier3d-compat`, **Apache-2.0** [S jsDelivr/npm]) has heightfield + vehicle controller examples ("rapier / terrain", "rapier / vehicle controller" on https://threejs.org/examples [S]) and a `-deterministic-compat` build [S], but the brief says no physics engine and our 7-DOF ride model is the point. Skip.

**Proposed `GroundWorld` (sim-core, pure)**, MIT-compatible pseudocode I wrote (no third-party code):
```ts
// Zones are tested in priority order; first hit wins. Everything analytic, O(zones) with a 20 m uniform grid cull.
interface Surface { mu: number; crr: number; rough: 0|1|2|3|4; wet: 0|1; id: number }  // id also indexes audio/shader
interface GroundHit { h: number; nx: number; ny: number; nz: number; surf: Surface }
type Zone =
  | { kind:'loop' }                                   // path projection -> existing roadHeight(s,l)
  | { kind:'rect'; cx; cz; hw; hh; rot; height:(u,v)=>number; surf: Surface }  // pad, ride street modules, tile lanes
  | { kind:'disc'; cx; cz; r; surf: Surface }          // steering pad
  | { kind:'ramp'; ... }                               // hill: smoothstep grade profile
function sample(x:number, z:number): GroundHit        // 1 call per contact point
```
- **Loop in world coordinates**: `roadHeight(s, lateral)` needs (x,z) -> (s,l). Precompute the polyline (already dense for the ribbon) into a 20 m spatial-hash of segments; each wheel keeps its last segment index as a hint (walk +-1) => O(1) per query; fall back to hash lookup after a teleport. Lateral beyond (width/2 + kerb + runoff) => zone falls through to grass.
- **Cost** [E]: 4 wheels x 3 envelope samples x 240 Hz = ~2,900 `sample()` per second; trivial even with 10 zones. Surface lookup per wheel (not per car) gives split-mu for free: left wheels on tile, right on asphalt => different longitudinal/lateral force limit per wheel => yaw moment, with no special code.
- **Zone edges**: blend mu / height over 0.3 m so a wheel crossing a tile edge ramps rather than steps (otherwise 240 Hz stepping makes force chatter) [E].
- **Macro terrain**: flat everywhere except an optional hill (smoothstep grade). Render as one 600 x 400 m PlaneGeometry (e.g. 300 x 200 segments, vertex heights from the same function); pads and strips as separate decal/ribbon meshes with polygonOffset. Avoid THREE.Terrain (https://github.com/IceCreamYou/THREE.Terrain, MIT, 913 stars [S], diamond-square/noise generator; last release date not checked) - procedural noise is not needed for a flat proving ground, but its heightmap-import option is a fallback.

### c2. Surface grip / roughness table (all [E] unless sourced)
| Surface | mu_peak scale vs dry asphalt | c_rr | Source of mu |
|---|---|---|---|
| Dry asphalt | 1.00 (mu ~0.8-1.0) | 0.012 | [S] AVL: asphalt ~0.8, rough ~1 |
| Wet asphalt | 0.65 | 0.014 | [E] (not sourced; lay label "wet") |
| Polished concrete | 0.75 (mu ~0.6) | 0.012 | [S] AVL |
| Blue basalt tiles, wet | 0.38 (mu ~0.3) | 0.015 | [S] AVL, AARC |
| Ceramic tiles, wet | 0.13 (mu ~0.1) | 0.015 | [S] AVL, Nardò, AARC |
| Kerb / paint | 0.9 | 0.015 | [E] |
| Grass | 0.45 | 0.06 | [E] |
| Gravel run-off | 0.55 | 0.05 | [E] |
Present in the UI as "approximate surface grip", never as engineering data (BRIEF honesty rule). The tile mu is the only place where a number is published by several facilities, so those are the most defensible.

### c3. Boundaries and "return to track"
- **Soft walls / barriers**: analytic 2-D segments in the 20 m hash (armco lines, tyre-wall blocks, annex perimeter). Vehicle footprint = oriented box, test 8 points (corners + side mids). Penalty contact: F_n = k * penetration + c * v_n (clamped, no energy gain), tangential Coulomb with mu 0.3-0.5; armco k high, tyre wall k low + high c (restitution ~0.1) so a tyre wall "eats" speed. Impact speed also feeds an event for audio/camera shake. [E design; ~50 lines]
- **Invisible fence**: inside the annex perimeter + 20-40 m grass margin; beyond the margin add progressive velocity-proportional drag and show a toast "Out of bounds - press R". Hard clamp only at 60 m so the car can never leave the finite ground mesh.
- **Return to track (R)**: snap to nearest loop point (s, l = 0) using the same hash, heading = path tangent, speed = min(current, profile speed), keep suspension state (ride state continuous, only the pose snaps over ~0.3 s with a camera blend). This also gives the **Auto <-> Manual hand-back**: Auto re-engages by projecting the pose to nearest s, mapping to lap time `t(s)`, and blending pose/velocity to `stateAt(t)` over ~1 s [E]; refuse hand-back while > 25 m from the path or on the annex (offer "Return to track" first).
- **Cones as simple dynamic props**: no engine. State per cone {x, z, vx, vz, spin, standing}. Test each standing cone in the vehicle frame against the footprint (rotated-rect vs circle, cone radius 0.15 m). On hit: v_cone = 1.1 v_car_at_contact + small random (seeded), launch vy 2-4 m/s, ballistic integrate with gravity 9.81, damped bounce (e 0.3), friction decay, settle after ~1.5 s; vehicle receives **no** impulse (cone ~1-2 kg vs 1,800 kg [E]). Count hits = score. 150 cones x trivial = negligible; render as one `InstancedMesh` with `instanceMatrix` updated only for moving cones. Deterministic (seeded RNG, fixed dt) so tests can assert "hit/miss".
- **Mesh budget**: procedural cone = `LatheGeometry` profile (8 radial segments, ~60 tris) + 0.3 m base box; white bands via vertex colours; ~1 draw call.

### c4. Wet-surface shader
- Standard recipe [S]: three.js `MeshStandardMaterial` roughness uses the **green channel** of `roughnessMap`; `MeshPhysicalMaterial` has `clearcoat` ("car paint ... wet surfaces", https://threejs.org/docs/pages/MeshPhysicalMaterial.html [S]); `onBeforeCompile` for custom chunks (https://medium.com/@pailhead011/extending-three-js-materials-with-glsl-78ea7bbb9270 [S], idea only).
- Plan [E]: one `MeshPhysicalMaterial` for asphalt/tile surfaces. A uniform `uWet` (0..1 per zone) is computed in the fragment shader from world position against up to 8 rectangle SDFs (no mask texture, resolution-free, zone list shared with sim-core via a generated uniform array). Wet effect: albedo *= mix(1, 0.65, wet); roughness = mix(rough, 0.18, wet * puddleNoise); clearcoat = wet; clearcoatRoughness 0.08; envMap intensity up. A 0.5-1 mm film is the real value (Michelin, [S]) so no visible depth/puddle geometry is needed; reflection + dark tint carries the read. Tile strips also get a faint grid normal (Japanese tile pattern). Cost: one extra noise sample, negligible.
- Sync with physics: shader's `wet` and sim's `Surface.wet` come from the **same zone table** (generated once) so the visual never disagrees with the grip.

---------------------------------------------------------------------------------------------------
## (d) Open-source terrain/track builders and CC0/CC-BY props

| Item | URL | Licence | Notes |
|---|---|---|---|
| three-mesh-bvh | https://github.com/gkjohnson/three-mesh-bvh | MIT [S] | ~3.5k stars; capsule/sphere collision examples; render-side only for us |
| THREE.Terrain | https://github.com/IceCreamYou/THREE.Terrain | MIT [S] | 913 stars; procedural + heightmap terrain; not needed for flat ground |
| three.js examples `geometry_terrain_raycast`, `rapier_terrain` | https://threejs.org/examples | MIT (three.js) [S] | reference for heightfield mesh + ray query |
| Kenney Racing Kit | https://kenney.nl/assets/racing-kit ; mirror https://opengameart.org/content/racing-kit | CC0 [S] (OGA: CC0, glTF/OBJ/FBX, 3.7 MB) | track pieces, barriers, tyres, flags; stylised low-poly. kenney.nl returned 403 from our sandbox previously (research 12) - use the OGA mirror or itch |
| Kenney City Kit (Roads) | https://kenney.nl/assets/city-kit-roads ; https://kenney-assets.itch.io/city-kit-roads | CC0 [S] | 65+ models: road pieces with separate barriers, construction fences, light posts, road signs, traffic lights; glTF |
| Kenney Car Kit | https://kenney.nl/assets/car-kit | CC0 [S] | debris pieces; vehicle parts |
| Kenney Starter-Kit-Racing | https://github.com/KenneyNL/Starter-Kit-Racing | repo MIT, assets CC0 [S per research 12] | already in assets-src notes |
| Quaternius | https://quaternius.com/ | CC0 [S] (site + cinevva guide) | broad packs (Cars, Public Transport); no dedicated cone/armco confirmed |
| Grab3D traffic cone | https://grab3d.com/models/city/traffic-cone | CC0 [S, page text]; 5,968 tris, 182 KB GLB | too heavy for 150 instances; prefer procedural (above) |
| Poly Haven `old_tyre`, `concrete_road_barrier(_02)` | https://polyhaven.com/a/old_tyre | CC0 [S, research 12] | tyre walls + Jersey barriers (instance) |
| Poly Haven / ambientCG asphalt, cobblestone, concrete | https://polyhaven.com ; https://ambientcg.com | CC0 [S, research 12] | surface textures; ambientCG `Asphalt033`, `Road012A/B`, Poly Haven `cobblestone_floor_01..09` already listed |
| Poly Pizza (Kenney "Modular Road Kit") | https://poly.pizza/m/YClppstaHV | CC0 [S] (many other Poly Pizza models are CC-BY: check per model) | blocked (403) from sandbox before |
| Sketchfab "Traffic Cones" (NotAnotherApocalypticCo.) | https://sketchfab.com/3d-models/traffic-cones-e03b1d2dfdc0416bb8324d15573ea60c | CC-BY but author states "may not be resold or redistributed"; NoAI | **avoid** (ambiguous redistribution) |
Not found as CC0/CC-BY: dedicated armco/W-beam, tyre-wall, proving-ground signage models. **Build procedurally** (consistent with research 12): W-beam armco = extruded 310 mm x ~85 mm profile polyline, posts every 2.0 m, top height 0.7 m [E, typical road-restraint figures, M]; tyre wall = instanced `old_tyre` (CC0) or stacked tori, 0.65 m dia, 2 stacks x 3 high [E]; signage = canvas-texture boards (station name + a one-line caption), no external licence needed.

---------------------------------------------------------------------------------------------------
## Recommended compact world layout (annex <= 600 m x 400 m)

Frame: annex SW corner at world (-300, +40); annex-local (u east 0..600, v north 0..400) so world = (u-300, v+40). The loop occupies y <= +10, so annex and loop never overlap (>= 30 m grass strip between). [E: verify loop bbox from `proving-loop.ts`; if the real bbox extends north of y = +10, shift the annex origin north by the difference.]

```
 v=400 +--------------------------------------------------------------+
       |  DYNAMICS PAD 330x190 asphalt (u15-345, v190-380)   | HILL   |  BRAKING
       |  [R40 steering pad]  slalom lane v=225 (9 cones/25m) | opt.   |  PLATFORM
       |  [ISO 3888-2 lane v=330: 60 m run-in, 61 m gate, 80 m out]   |  u505-565
       |                                                       |       |  4 lanes x 4.5 m
       |  RIDE STREET v=130, 8 m wide, u60-460 (one-way W->E)  |       |  dry | wet asph |
       |  chatter/6-in washboard | pave 60 m | sleepers | kerb  |       |  split | ceramic
       |  steps 40/80 mm | potholes | twist                      |       |  120 lead-in,
 v=20  +==== collector road (7 m) from entry (u445) to exit (u240) ====+  100 m tiles, 40 m safe
       |  grass margin 20 m all round, tyre walls at pad ends   |
 v=0   +--------------------------------------------------------------+ u=0..600
        loop spur out: (120,0)->R25 left arc->(145,40)=annex u445    spur back: annex u240 -> (-60,0) joins run-in
```
- **Links**: spur A leaves the launch straight at ~x = 120 m (after the washboard, before the brake zone), 8 m wide, R25 left arc then ~20 m straight north into the annex entry (world (145, 40)); spur B returns from annex u240 (world (-60, 40)) south and joins the run-in at (-60, 0). Both are plain tarmac ribbons; the whole plane is drivable, so the spurs are a convenience (a driver can also cross grass).
- **Pad**: steering pad radius 40 m at (u70, v285) (80 m dia, 0.8 g at 64 km/h [E]); ISO 3888-2 lane with cones from the c3 recipe, gate widths from W formula above; slalom 9 cones, 25 m spacing, alternating lateral offset +-1.0 m (50 km/h => 0.31 g [E]).
- **Ride Street**: 400 m, 8 m wide (two 4 m wheel tracks as at Nardò [S]) so left/right wheel-path features (single-wheel kerb, pothole, twist) differ; modules 30-60 m separated by 25 m smooth; avoid duplicating the loop's gentle washboard - add the harsher 6-in/6-ft NATC washboard [S] scaled to 25-50 mm amplitude [E] (the real 150 mm would pitch a road car over), heavy pavé, timber sleepers, kerb steps 40/80 mm (real step 150 mm at Nardò [S], too harsh for a toy), twist ditch.
- **Braking platform**: 4 lanes x 4.5 m [S AVL width] = 18 m, run-off 20 m [S AVL], lead-in 120 m (limit 50 km/h), tile 100 m, safety 40 m: lanes dry asphalt / wet asphalt / **split-mu** (left half ceramic, right half asphalt, per AARC "hot-mix adjacent to tiles for split use") / full ceramic. Uses the 'wet' shader and the c2 table.
- **Hill (tier 2)**: 100 m ramp, 12 % grade (12 m rise), crest radius >= 150 m; real hill routes reach 26 % [S]. Optional because the macro-height function and pitch calibration add scope.
- **Total new asphalt** ~ 3.4 ha pad + 0.3 ha ride + 0.5 ha braking + spurs: under the 16 MB asset budget (surfaces are procedural, no new textures required beyond existing ones).
- **Banked oval, steep 26 % hills, aquaplaning basin: out of scope** (do not fit / not suspension-relevant).

---------------------------------------------------------------------------------------------------
## Recommendation for Suspension Lab

1. Build the world as a **pure-TS `GroundWorld` in sim-core**: ordered analytic zones (loop-projection, rect, disc, ramp) -> `{h, normal, surface}`; one call per contact point; keep the 3-point tyre envelope from research 11. Do not put three-mesh-bvh or a physics engine in the car path.
2. Make the renderer consume the **same zone table** (ground mesh heights, surface decals, wet SDF uniforms) so visual, grip and roughness can never disagree.
3. Project world (x, z) to loop (s, l) with a 20 m spatial hash + last-segment hint; reuse `roadHeight(s, l)` unchanged on the loop.
4. Surface lookup **per wheel**, with a 0.3 m blend at zone edges; split-mu falls out of the per-wheel tyre limit with no special code.
5. Ship six suspension stations first: chirp/6-in washboard, pavé + sleepers, steering pad, slalom (25 m), ISO 3888-2 gate, kerb/one-wheel bump; brake/hill/low-mu as "driving fun", labelled as tyre-grip demos, not suspension.
6. Use sourced values where they exist (ISO 3888-2 table, Nardò/AVL/AARC tile mu 0.1/0.3, braking lane widths); label every invented number (washboard amplitudes, wet scale 0.65, grass 0.45) as "approximate" in-app and keep them out of any engineering readout.
7. Slalom spacing 25 m (not the real 18 m) and a 100 m tile at <= 50 km/h entry; both derived above so keyboard drivers stay in the tyre's controllable range.
8. Cones: seeded, deterministic 2-D dynamic props (no engine), `InstancedMesh`, procedural lathe geometry, hit counter; vehicle gets no impulse.
9. Barriers: analytic segment hash + penalty contact; tyre wall = soft/damped, armco = stiff; invisible fence = growing drag, hard clamp at 60 m; **R = Return to track** (nearest-s snap, preserve ride state).
10. Auto <-> Manual: hand-back only within ~25 m of the loop; project to nearest s, set lap time, blend 1 s. Flag as an integration risk with the Manual Drive physics agent.
11. Assets: instance Poly Haven `old_tyre` and `concrete_road_barrier` (CC0), Kenney City Kit Roads (CC0) for signs/fences only if a stylistic match is acceptable; build cones, armco, kerbs, signage procedurally (no suitable CC0 models found). Avoid the Sketchfab CC-BY cone pack (redistribution wording).
12. Wet shader = `MeshPhysicalMaterial` clearcoat + darkened albedo + lowered roughness driven by rectangle SDFs in `onBeforeCompile`; no film geometry (real film 0.5-1 mm).
13. Skip: banked oval, 26 % hills, aquaplaning basin, full Belgian-block field, THREE.Terrain, Rapier. Hill as optional tier 2.
14. Risks: (i) loop bbox assumption for annex placement is unverified; (ii) manual-drive vehicle model must accept per-wheel mu and pad-scale yaw (needs a planar body, not the path-following state); (iii) Grokipedia-sourced Millbrook figures are weak - do not quote them in the UI; (iv) kenney.nl was 403 from the sandbox earlier, so fetch Kenney packs via OpenGameArt/itch or the GitHub mirror.
15. Verify before claiming: ISO 3888-2 cone base-circle dimension (Fig. 2) and exact cone count from the licensed standard; W of the DB11 and cafe racer from the GLBs.
