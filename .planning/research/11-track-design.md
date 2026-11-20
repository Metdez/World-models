# 11 - Test-track design for Suspension Lab (procedural Three.js track + proving-ground content)

Status key: [V] verified this session against a page; [M] from engineering memory, unverified; [H] heuristic/our proposal.
Today 2026-11-20. Research only; the code below is illustrative snippets for the implementer, not committed app code.

---------------------------------------------------------------------------------------------------
## A. CODE: what exists, what is liftable

### A.1 Repos / sources (licence verdicts)

| Source | URL | Licence | Verdict / what is liftable |
|---|---|---|---|
| three.js core (`CatmullRomCurve3`, `Curve.getPointAt/getUtoTmapping`, `Curve.computeFrenetFrames`, `TubeGeometry`, `ExtrudeGeometry` w/ `extrudePath`, example `webgl_geometry_extrude_splines`) | https://github.com/mrdoob/three.js | MIT [V] | USABLE. `CatmullRomCurve3(points, closed, 'centripetal'|'chordal'|'catmullrom', tension)`; default type is `centripetal` [V, docs]. `getSpacedPoints/getPointAt` give arc-length-uniform sampling; `computeFrenetFrames(segments, closed)` returns tangents/normals/binormals via parallel transport (rotation-minimising, with closed-loop twist correction) - good enough for a loop that is nearly planar. |
| makio-meshline | https://github.com/makio64/makio-meshline | MIT [V via search metadata] | USABLE (r186+; it targets `three/webgpu` + TSL). README [V]: "Road and ribbon surfaces - camera-independent geometry with transport frames, banking, normals, tangents and distance UVs"; API `new MeshLine().lines(pts).lineWidth(4).surface({frame:'transport', up:[0,1,0], uvMode:'distance', uvScale:5}).build()`. I did NOT read its source; check whether it supports per-vertex bank array and whether it exposes a plain `BufferGeometry` (needed for our CPU height function + custom shader). Treat as optional; the ribbon builder is ~60 lines to write ourselves (below). |
| pmndrs/racing-game | https://github.com/pmndrs/racing-game | MIT [V], 2.2k stars, 515 commits [V] | USABLE but it is a Rapier-physics arcade game with hand-modelled glTF tracks; I did not find a procedural generator in it (not verified in source). Low value for this task. |
| MankyDanky/web-racing | https://github.com/MankyDanky/web-racing | MIT [V], 34 stars | Small; track layouts as data. Low value. |
| CagriCatik/RaceTrack | https://github.com/CagriCatik/RaceTrack | not checked (unclear) | Has pure-pursuit driver on a `trackPath`, kerbs, guardrails, track-limit detection. Licence unknown -> NOT usable until checked; idea source only. |
| three.js `SidewalkGenerator` (examples/jsm/generators/city) | https://github.com/mrdoob/three.js | MIT [V] | Pattern only: instanced curb meshes with TSL procedural material (granite kerb). |
| @scenoco-three/splines (SplineMesh, SplineInstantiate, `getNearestPoint`) | https://github.com/romarogov/scenoco-three | not checked | R3F/editor-centric; knots with `roll` (banking) per point [V README]. Idea only unless licence verified. |
| lassehenrich/racetrack-generation (repulsive curves, Unity) | https://github.com/lassehenrich/racetrack-generation | not checked | Research prototype for Unity; concept: generate closed curves that do not self-intersect. Not liftable to JS. |
| Slow Roads (Anslo) | https://xoriushourz.github.io/slow-roads (mirror), web.dev case study https://web.dev/case-studies/slow-roads | **CC BY-NC-ND 4.0 [V] -> NOT USABLE** (code is closed anyway) | Technique only (from web.dev [V]): road midline generated far ahead of the player so scenery chunks can be pre-scheduled; single non-branching path; mostly simple procedural geometry + shader texture blending. |
| gamedev.SE "How do I generate a 3D race track from a spline?" | https://gamedev.stackexchange.com/questions/23151 | CC BY-SA (content, not code) | Concept only. |

Conclusion: there is no ready, well-maintained, permissively licensed "three.js race-track generator with banking + kerbs + height function". Reuse three.js core curves + (optionally) makio-meshline for the ribbon; write the ~300-line `Track` module ourselves. That is small and gives the analytic height function we need (raycasting is not needed or wanted).

### A.2 Layout method: clothoid/arc/line primitives, not Catmull-Rom control points

Why: lateral acceleration a_y = v^2 * kappa. A Catmull-Rom spline through arbitrary points has continuous tangent but its curvature kappa(s) jumps/oscillates, so lateral-g and steering-rate onset are jerky and the car "kinks" - exactly the thing we want to avoid because roll rate/onset is what the suspension demo shows. Real roads/circuits are lines + clothoids (Euler spirals, kappa linear in s) + arcs, with banking ramped linearly along the same clothoids.

Recommended pipeline (all O(N) at load, then read-only):
1. Author the track as a list of primitives: `{type:'line', L}`, `{type:'arc', R, angleDeg}` (sign = right/left), `{type:'clo', L, k0, k1}` (curvature ramp). Auto-insert a clothoid of length `Lc = v_design * jerk_limit` between line->arc: e.g. kappa ramps 0 -> 1/R over `Lc = max(15 m, (v/3.6)*0.8 s)`; 0.8 s onset ~ 0.6-1 g/s lateral jerk is natural.
2. Integrate to a dense polyline at ds = 0.25-0.5 m (midpoint rule on heading is accurate enough; the Fresnel integral is not needed):
```js
// state: x,z,heading(psi); per step: kappa(s) from primitive
for (let i=0;i<N;i++){ const k = kappaAt(s); psi += k*ds; x += Math.cos(psi)*ds; z += Math.sin(psi)*ds; s+=ds; store(s,x,z,psi,k); }
```
3. Closure: a hand layout never closes. Use a 2-unknown solve on two straight lengths (or 1 length + 1 radius): compute end pose with unknown lengths = 0, 1 (finite difference, the end position is linear in a straight's length), solve the 2x2 for (dx,dz)=0, require net turning = +/-360 deg. This is exactly how the layout in section C was closed (I verified closure to <1e-10 m in Python, min non-adjacent clearance 40 m). Add a final tiny heading fix by distributing the residual heading error over the last clothoid.
4. Heights and banking are separate 1D functions of s (see A.4) - not part of the plan curve. Keeps the plan 2D and makes the height function trivial.

Catmull-Rom fallback (if hand-placed control points are wanted): use `centripetal` (no cusps/self-intersections inside a segment [standard result; three.js default]), then resample uniform with `curve.getSpacedPoints(N)`, then **smooth curvature** (3-5 passes of Laplacian smoothing on heading, or fit a clothoid spline) before using it for physics. Do not use `tension`/`catmullrom` default type for tracks (can loop/overshoot).

Convex-hull + spline random generators (the classic: random points -> convex hull -> push apart -> displace midpoints -> Catmull-Rom) give plausible circuits but with uncontrolled curvature and no designed features - wrong for a purpose-built test track. Use only for a "random circuit" bonus mode.

### A.3 Frames, arc length, banking

Arc-length: store arrays `S[i]` (monotone) and `Pos/Psi/Kappa/Bank/Elev`; query by `i = binarySearch(S, s)` + lerp. Wrap `s mod L` for closed track. For a three.js `Curve` route use `curve.getUtoTmapping`/`getPointAt` (already arc-length uniform via `arcLengthDivisions`; raise to 20000 for a 1.5 km track).

Frames without twisting: with a plan-heading + analytic slope + bank, the frame is explicit - no Frenet/parallel-transport drift:
```
T  = normalize(cos psi * cos(theta), sin(theta), sin psi * cos(theta))   // theta = atan(dElev/ds), small
Rt = horizontal right vector = (-sin psi, 0, cos psi) (sign per handedness)
Lat(l)  = Rt * cos(bank) + Up * sin(bank)      // banking rotates the cross-section about T
Up_road = normalize(cross(Lat... , T))
```
Position of a point at lateral offset `l` (m, +right) : `P(s,l) = C(s) + Rt*l*cos(bank(s)) ; y = elev(s) + l*sin(bank(s)) + micro(s,l)`.
If free-form 3D splines ARE used, use `computeFrenetFrames` (parallel transport) or makio-meshline `frame:'transport'`, then add roll = bank(s) about the tangent. Only Frenet (non-transported) frames twist at inflections - avoid them.

Banking convention: positive = inside lower... define `bank(s)` = roll toward the corner centre (inside edge down). Ramp it linearly across the clothoids (same s range as kappa ramp). Typical: handling circuits 0-4 deg; dedicated bowls 15-30+; Karussell-type 'banking' [V: Nordschleife Karussell famous for banking; exact angle unverified].

### A.4 The analytic height function (replaces raycasting)

Single source of truth used by BOTH the renderer (vertex displacement of the ribbon) and the physics (wheel contact):
```js
// h(s, l): world height of road surface at arc-length s, lateral offset l (m, +right of centreline)
function roadHeight(s, l) {
  const base = elev(s) + l * Math.tan(bank(s));          // macro profile (gradient, crests, dips) + banking/crossfall
  let h = base;
  h += ISO8608(s, l);                                    // random roughness, per-section class (A.6)
  for (const f of features) if (s>f.s0 && s<f.s1) h += f.fn(s - f.s0, l); // deterministic obstacles
  return h;
}
// Deterministic features: all closed-form
bump(x,L,H)     = 0.5*H*(1-cos(2*pi*x/L)) for 0<x<L          // 'sinusoidal hump' (TRL 3.7 m x 100 mm is the real standard [V])
cosineBump(x,L,H, laterals l0..l1)  -> one-sided bump: multiply by smoothstep window in l (soft 0.15 m edges)
pothole(x,l,R,D) = -D * max(0, 1 - ((x^2+l^2)/R^2))^1.5       // bowl, or flat bottom with smooth rim
washboard(x,A,lambda(x)) = A*sin(phase(x)), phase' = 2*pi/lambda(x), lambda linear in x // CHIRP (frequency sweep)
pave(x,l)       = cellular/voronoi or 100x100 mm grid: per-stone random height N(0, 4 mm) + bevelled joint -3..-6 mm (use hash noise, no texture lookup)
kerb(l)         = step of 40-120 mm height with 45 deg ramp over 0.1 m (for kerb strike)
```
Tyre enveloping: a point-sample under the contact point is far too spiky for pavé/pothole - a real tyre bridges gaps. Use either (a) average of 3x3 samples across a 0.12 m x 0.18 m patch, or (b) sample at 3 longitudinal points (front/mid/rear of patch) and use mean + plane-fit for contact normal; this is the standard 'tandem cell / enveloping' idea (unverified name, ubiquitous in ride sims). Sample normal numerically: `n = normalize(-dh/dx, 1, -dh/dl)` with 0.05 m finite differences.
Performance: 4 wheels x 3-9 samples x physics substeps = trivial. Ribbon mesh uses the same function offline (CPU) at 0.25 m longitudinal x 0.15-0.5 m lateral grid, plus a normal map/shader detail for sub-5 mm texture (do not mesh pavé stones; render them with parallax/normal-map and feed the true height function to physics).

### A.5 Ribbon mesh + UVs + kerbs + runoff

```js
// cross-section stations (lateral offsets): [-W/2-runoff..., -W/2-kerbW, -W/2, ..., +W/2, +W/2+kerbW, ...]
const lat = [-14,-9.5,-4.5, ... , 4.5, 9.5, 14];     // runoff (asphalt/grass) | kerb | lane
// build positions[i*M+j] = P(S[i], lat[j]) using roadHeight(); indices: 2 triangles per quad
// UV: u = (l + W/2)/W  (across), v = s / texLen   (along, metres; texLen = 4 m for asphalt markings, 1 m for kerb stripes)
```
- Use separate meshes/material slots per cross-section band (asphalt, kerb red-white stripes via `v` modulo in shader, runoff, grass), sharing the same sampling loop. Kerb height profile via `kerb(l)` in height function, so wheels really strike it.
- Barriers/tyre walls: InstancedMesh placed at `P(s, +-(W/2+runoff))` every 2-3 m oriented by `psi`; lateral guard rails = another ribbon extruded with a small rectangle profile (use `ExtrudeGeometry` along the polyline, or loft).
- Markings (centre dashes, edge lines, start/finish) in shader from `uv`; cones for slalom/DLC as InstancedMesh.
- Terrain: a very low-res heightfield plane under the track, dipping away from the ribbon with smoothstep of distance-to-track (use a precomputed distance field on a 2 m grid) to avoid z-fighting and hide cut/fill.
- Memory: 1.5 km x 28 m x (4 x 7 samples) ~ 6000 x 8 verts = 48 k verts. Trivial.

### A.6 ISO 8608 random roughness (verified formula; use for 'tarmac condition' per section)

[V] Gd(n) = Gd(n0) * (n/n0)^(-w), w = 2 (waviness), displacement PSD in m^3, n in cycles/m, n0 = 0.1 cycles/m (reference). [V: Warwick benchmark paper eq. Gq(n)=Gq(n0)(n/n0)^-w; ISO 8608:2016 relation Ga(n)=(2 pi n)^4 Gd(n)].
Class bounds on Gd(n0), units 1e-6 m^3 (class limit upper/geometric-mean) [V in part: MATLAB thread uses upper bounds 32,128,512,2048; means 16,64,256,1024 follow the standard]:

| Class | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|
| Gd(n0) geo-mean (1e-6 m^3) | 16 | 64 | 256 | 1024 | 4096 | 16384 | 65536 | 262144 [M for E-H] |
| Meaning | new motorway | good | average | poor/old | very poor | | | |
| RMS (n>0.05 c/m) | ~1.8 mm | ~3.6 | ~7 | ~14 | ~28 | | | (my calc: sigma^2 = Gd0*n0^2*(1/n1 - 1/n2)) |

Warning [V, Mucka 2018 cited in search]: ISO classes A-C correspond to real roads fairly well but D and above are mostly unpaved/artificial; for our asphalt use A-C, use D-E only as a 'rough track' showcase (it is a synthetic proxy for pavé, not real pavé).

Generator (sum of cosines, random phases; deterministic seed so renderer = physics = replay):
```js
function makeISO8608({Gd0=64e-6, n0=0.1, w=2, nMin=0.05, nMax=10, N=200, seed=1}) {
  const rnd = mulberry32(seed), dn = (nMax - nMin)/N, comp = [];
  for (let i=0;i<N;i++){ const n = nMin + (i+0.5)*dn;
    const A = Math.sqrt(2*Gd0*Math.pow(n/n0,-w)*dn);       // amplitude of each cosine (A^2/2 = Gd*dn variance)
    comp.push([A, 2*Math.PI*n, rnd()*2*Math.PI]); }
  return s => comp.reduce((z,[A,k,ph]) => z + A*Math.cos(k*s+ph), 0);   // 200 cos/eval; precompute a 5 mm LUT along s instead
}
// Left/right tracks: z_R = rho*z_L + sqrt(1-rho^2)*z_R' with rho(n)=exp(-pi*n*b) (b ~ 1.6 m track width) -- heuristic [H]: long waves correlated (body heave), short waves independent (body roll/warp), which is the physical reason roll/warp excitation exists.
```
Bake to a Float32Array at 2 cm spacing per wheel path (1.5 km -> 75 k floats x 2 paths) rather than evaluating cosines at runtime; lateral dependence: interpolate between a 'left' and 'right' table by l (or evaluate on 2-3 lateral rails).
Precompute frequency check: the car at speed v hits temporal frequency f = n*v: body mode ~1-1.5 Hz, wheel hop 10-14 Hz. At 80 km/h (22 m/s): 1.2 Hz -> lambda 18 m; 12 Hz -> lambda 1.85 m. Keep nMin <= 0.05 c/m (20 m).

---------------------------------------------------------------------------------------------------
## B. Proving-ground content (what real tracks include) with numbers

Sources: Dewesoft list of proving grounds [V: Millbrook has Hill Route 6.5 km with 6.5-26 % gradients, High Speed Bowl, urban course, outdoor handling circuit, steering plate; accelerated durability tracks with 'potholes, undulations, Belgian pavement, cobblestone, rumblers' in the same listing for a Asian ground; Nardo Technical Center (Porsche Engineering) lists High-speed Ring, Low-speed Ring, Handling Track, Dynamic Platforms A/B, Noise Track, Special Surfaces [V]; Toyota Arizona ride & handling course 1.5 mi [V]; Nordschleife 20.83 km, >300 m elevation change [V, Wikipedia], Brunnchen jumps smoothed in the 1970 rebuild [V], Pflanzgarten big jump [V]]. Numbers marked [M] are industry-typical values from memory; confirm before presenting as 'real'.

| Element | Purpose / suspension phenomenon revealed | Realistic dimensions / amplitudes |
|---|---|---|
| Skid pad / constant-radius circle (ISO 4138) | Steady-state roll, understeer gradient, camber gain under sustained roll, load transfer | Dynamic platforms 100-250 m dia.; FSAE skidpad centreline dia. 18.25 m (inner circle dia. 15.25 m, 3 m lane) [M]; for a 1.5 km loop use R = 40-50 m, 180-270 deg, 0.8 g -> v = sqrt(0.8*9.81*45) = 18.8 m/s = 68 km/h |
| Slalom (ISO 7401 / pylon) | Transient roll rate, roll-centre migration, body-roll damping, steering response | 18 m cone spacing (road car) / 12-30 m [M]; 8-10 cones; speeds 60-80 km/h; excites ~0.5-1 Hz roll |
| Double lane change ISO 3888-1 [V full table] | Evasive-manoeuvre stability, roll/yaw damping, understeer->oversteer snap | Total 125 m; sections lengths 15/30/25/25/15/15 m; lane offset 3.5 m; widths 1.1W+0.25 (entry), 1.2W+0.25 (middle), 1.3W+0.25 (exit and last); cones >= 0.5 m high. Test speed ~80 km/h (ISO 3888-1 annex: severe DLC, entry 80 km/h, throttle off) [M for speed]. ISO 3888-2 'moose/obstacle avoidance': lengths 12/13.5/11/12.5/12 m, offset 1.0 m [M], used at 60-80+ km/h |
| Chicane (left-right-left) | Roll-reversal, transient body roll/pitch, spring/damper/anti-roll tuning, bump-stop engagement | Radius 25-50 m, each flick 30-60 deg, 8-12 m of straight between |
| Hairpin | Full steering lock; steering geometry, bump steer at big angles, anti-dive/squat on exit | R 15-25 m, 180 deg, 30-40 km/h |
| Long sweeper | Sustained mid-g, high-speed stability, aero/ride-height | R 100-200 m, 0.6-0.8 g, 90-110 km/h |
| Off-camber corner | Negative banking reduces available lateral grip; reveals camber + roll limits | -3 to -6 deg crossfall; Nordschleife has multiple; real banked/bowl tracks use positive 8-30 deg |
| Crest / compression (dip) | Vertical load changes, damper bump/rebound, bump-stop, aero lift, 'light' / 'heavy' feel (Fuchsrohre compression, Pflanzgarten jump [V names]) | Vertical radius 100-200 m: extra a_z = v^2/Rv, e.g. v=25 m/s, Rv=120 m -> 5.2 m/s^2 = 0.53 g. Jump-free: keep crest g < 0.7 so wheels don't unload fully |
| Speed bumps | Single-axle bump response, dampers, pitch; front-then-rear timing at wheelbase | Standard UK hump 3.7 m long x up to 100 mm high (circular/sinusoidal) [V: TRL377; SIRIM 75-100 mm, 3.7-4.25 m; FHWA 12 ft x 3 in = 3.66 m x 76 mm]; spaced 15-20 m for pitch resonance demo; cross at 20-30 km/h |
| Single-wheel bump (one-sided) | Roll/warp excitation, **bump steer**, toe change & lateral force from one wheel, anti-roll bar transmission, side-to-side kinematic differences between MacPherson/wishbone/multi-link | 30-60 mm high cosine bump, 0.5-1.0 m long, covering only one wheel path (hit by left wheels only); also a 'ride-over kerb ramp' |
| Potholes | Sharp rebound/wheel drop, damper rebound stops, wheel-hop | 0.5-0.8 m dia., 40-80 mm deep, sharp rim [M] |
| Belgian pave / cobbles | High-frequency harshness, wheel-hop, NVH, tyre enveloping; shows unsprung mass and bushing compliance | Stone ~100-150 mm, random height +/-5-15 mm, joints 5-10 mm deep, 50-200 m long strip; rendered as per-stone noise (A.4) [M] |
| Washboard / corrugations (frequency sweep) | Wheel-hop, body-resonance and damper tuning; the visible 'resonance' wow moment | Amplitude 10-25 mm (p-p 20-50 mm), wavelength sweep chirp 3.0 -> 0.8 m (at 80 km/h = 7 -> 28 Hz) [H]; real dirt corrugations 0.3-1 m wavelength, 20-50 mm deep |
| Kerb strike | Sudden one-wheel impact, bump-stop, camber/toe kicks, steering feedback | Standard kerb 100-150 mm; circuit rumble kerb ~10-30 mm ridges 200 mm period [M]; use flat 50-80 mm 'sausage' for impact |
| Split-mu / split surfaces | ABS/ESP, yaw moment; mostly tyre/brake not suspension - optional visual (wet strip) | 3.5 m lane half low-mu strip, 50 m [M] |
| Braking zone (straight, smooth) | **Brake dive**, anti-dive geometry (wishbone) vs MacPherson, pitch | 1.0 g stop from 100 km/h = 39 m; show 0.8-1 g for 60-80 m; level, smooth, sealed asphalt |
| Twist / warp ditch, ripple strips | Axle articulation, roll stiffness; durability ground staple | Diagonal ramps 100-200 mm; usually off-road; skip |

---------------------------------------------------------------------------------------------------
## C. Proposed loop (closed, 1508 m, ~1.5 km) - clockwise, start/finish at origin heading +x

Track: 9 m wide asphalt (2 lanes), 1.5 m kerb each side, 8-15 m runoff. Plan below was integrated and CLOSED numerically (end pose (0,0), heading 0, error <1e-10 m; min separation between non-adjacent parts 40 m at hairpin/DLC parallel lane; adjacent parallel legs elsewhere >= 90 m). Coordinates in metres (x east, y 'south' negative) are the end of each segment, from the closure script, so the generator can be cross-checked.

Convention: R = right turn, L = left. Line speeds are targets for the autopilot; lateral g = v^2/R.

| # | Segment | Geometry (L = length) | Cum. s end (m) | End (x,y) | Target speed | Surface / vertical features | Suspension phenomenon showcased |
|---|---|---|---|---|---|---|---|
| S12/S1 | **Washboard run-in + launch straight** (before/after the line) | line 110 m (end of lap) + 100 m | 1508 / 100 | (0,0) / (100,0) | 60 -> 108 km/h (accelerating) | Chirp washboard, A=12 mm, lambda 3.0 -> 0.9 m over 90 m, then 20 m smooth. Section class ISO C | Ride over corrugations: body bounce vs wheel hop (damper + unsprung mass + bushing compliance), frequency-sweep resonance |
| S2 | **Brake zone** | line 80 | 180 | (180,0) | 108 -> 35 km/h, ~0.6 g (0.9-1.0 g if speed raised) | Smooth ISO A, slight 1 % downhill | Brake dive / pitch, anti-dive geometry |
| S3 | **Hairpin** | arc R20, 180 deg R (+ 15 m clothoids) | 243 | (180,-40) | 35 km/h (0.47 g) | flat, 0 bank, ISO B | Max steering lock: steering geometry / bump steer at angle, inside-wheel unload, squat on exit |
| S4 | **Kerb/bump acceleration straight** | line 150 | 393 | (30,-40) | 35 -> 80 km/h | In order: 20 m smooth; **one-sided cosine bump** 50 mm x 0.8 m on LEFT wheel path (s=40); **pothole** 0.6 m dia. 60 mm on RIGHT path (s=70); **kerb-strike ramp** 60 mm on right edge (s=100, driver line clips it); 20 m smooth | One-wheel bump -> bump steer / toe + camber kick, roll/warp; pothole -> rebound/bump-stop; kerb strike -> impact harshness |
| S5 | **Long sweeper** | arc R120, 90 deg L (clothoids 30 m each) | 581 | (-90,-160) | 96 km/h (0.6 g) | Bank +3 deg (into corner), ISO B | Sustained roll, **camber gain in roll** (outer wheel), roll-centre height, aero ride-height |
| S6 | **Pave + speed-bump strip** | line 100 | 681 | (-90,-260) | 45 km/h | s0-45: Belgian pave 45 m (ISO D-equivalent + per-stone noise); then 3 sinusoidal humps 3.7 m x 80 mm at 16 m spacing | HF harshness, wheel hop, enveloping; humps: pitch + front/rear delay = wheelbase / v ~ 0.22 s at 45 km/h |
| S7 | **Chicane** | clothoid-linked arcs R38: R 30 deg, L 60 deg, R 30 deg | 761 | (-90,-336) | 55 km/h (0.62 g) | Flat; 2 deg opposite bank on middle arc; ISO B | Roll reversal, transient roll rate, anti-roll bar, roll-centre migration (differs MacPherson/wishbone/multi-link), body roll vs damper |
| S8 | **Crest + compression pair** | line 60 | 821 | (-90,-396) | 70 km/h | Crest Rv=150 m (+2.5 m, 40 m long) immediately followed by dip Rv=120 m (-2.0 m) | Wheel unload on crest (rebound limit, droop travel), compression on dip (bump-stop, damper), heave |
| S9 | **Carousel (constant radius)** | arc R45, 180 deg R | 962 | (-180,-396) | 70 km/h (0.84 g) | **Bank +8 deg** (adverse-to-negative for contrast against S11), ISO B | Steady-state roll angle, understeer gradient, **camber gain** (static), load transfer, geometry-dependent outer-tyre camber |
| S10 | **Evasive straight (ISO DLC)** | line 326 | 1288 | (-180,-70) | 80 km/h | 100 m smooth run-up -> **ISO 3888-1 DLC 125 m** (cones) -> 100 m smooth with crest 40 mm | Roll/yaw damping, lane-change transient, roll-centre/lateral-g feel; honest comparison of compliance steer |
| S11 | **Off-camber corner** | arc R70, 90 deg R, 25 m clothoids | 1398 | (-110,0) | 65 km/h (0.48 g target) | **Bank -5 deg** (crossfall away from corner), ISO C | Outer-wheel loading, camber vs reduced grip: rolls more, camber gain vs tyre contact |
| S12 | **Run-in** (see above) | line 110 | 1508 | (0,0) | -> 60 km/h | washboard begins 20 m before line | closes loop |

Lap time at targets ~ 1508 m / ~ (avg 22 m/s = 80 km/h) ~ 70-75 s, i.e. the person sees a feature every 4-8 s. Elevation: gentle +-1.5 m macro swell (gradient < 3 %) plus the S8 crest/dip; no jumps. Total flat-ish for DLC repeatability.

Closure script note: S10 (326 m) and S12 (110 m) were the two free straight lengths solved for closure; S1/S2 were fixed at 100/80 m for the brake demo. If S1/S2/S4 are changed re-solve those two. If the generator adds clothoid transitions at corners, lengthen corners are 'rounded' by that amount; re-solve.

Variants: a `showcase mode` can lock the camera/schedule to feature segments (S4, S6, S8, S10, S11 are 'one-phenomenon' sections); the autopilot should slow to the target speeds above so the cinematic readout is meaningful; a speed multiplier slider changes how violent the washboard/crest are.

---------------------------------------------------------------------------------------------------
## D. Recommendations for Suspension Lab

1. Build a self-written `Track` module (primitives -> dense polyline -> arrays S/pos/psi/kappa/bank/elev), MIT three.js core only; optionally evaluate makio-meshline for the ribbon but do not depend on it for physics. No GPL/NC code needed.
2. Layout with line/clothoid/arc primitives (not Catmull-Rom control points). Use the section-C layout as the default track definition (JSON), solve closure with the 2-unknown linear solve.
3. One analytic `roadHeight(s, l)` shared by mesh generation and wheel contact (macro elevation + bank + ISO-8608 class per section + closed-form features); sample 3-9 points per tyre patch for enveloping; baked ISO-8608 LUTs at 2 cm per wheel path.
4. Use ISO 3888-1 (125 m, 3.5 m offset, widths 1.1W/1.2W/1.3W+0.25) for the DLC; ISO C/D roughness; 3.7 m x 80-100 mm humps; one-sided 50 mm bump; chirp washboard - all give a one-to-one mapping between a track element and a suspension phenomenon (table in C).
5. Keep corner speeds near the table (lateral 0.5-0.85 g) so that camber gain/roll centre differences are visible but tyres stay in their linear range - essential for the 'honest tradeoff' story.
6. Verify before claims: [M]-marked numbers (ISO 3888-2 geometry, FSAE skidpad, pave amplitudes, kerb profiles, bank angle of Karussell) should be checked or presented as 'typical' not 'standard'.
7. Do not reuse Slow Roads assets/code (CC BY-NC-ND); do not rely on pmndrs racing-game for the track - it is only a physics/game reference.
8. Gaps/unverified: I did not read source files of makio-meshline, scenoco splines, CagriCatik/RaceTrack; Nordschleife numbers other than length/elevation/Brunnchen/Pflanzgarten are from memory.

Sources (opened or surfaced this session): ISO 3888-1:2018 sample PDF https://cdn.standards.iteh.ai/samples/67973/daa839ed4aca420788d9b4a51cd6cc95/ISO-3888-1-2018.pdf ; ISO 8608:2016 sample https://cdn.standards.iteh.ai/samples/71202/05b2151f255b44928f80acb897fc0c2c/ISO-8608-2016.pdf ; Warwick ISO 8608 benchmark https://wrap.warwick.ac.uk/id/eprint/195757/2/1-s2.0-S0967066125005167-main.pdf ; TRL377 https://www.trl.co.uk/uploads/trl/documents/TRL377.pdf ; FHWA https://highways.dot.gov/safety/speed-management/traffic-calming-eprimer/module-3-part-2 ; MDPI speed-hump review https://www.mdpi.com/2412-3811/10/7/190 ; Dewesoft proving grounds https://dewesoft.com/blog/list-of-automotive-proving-grounds ; Porsche Nardo https://www.porscheengineering.com/en/nardo/services/the-proving-ground/test-tracks-facilities ; Nurburgring https://en.wikipedia.org/wiki/N%C3%BCrburgring ; three.js CatmullRomCurve3 https://threejs.org/docs/pages/CatmullRomCurve3.html ; web.dev Slow Roads https://web.dev/case-studies/slow-roads ; makio-meshline https://github.com/makio64/makio-meshline ; pmndrs/racing-game https://github.com/pmndrs/racing-game
