# 02 - Vehicle physics repos (Three.js / web) and the "on rails + procedural suspension" question

Researched 2026-11-20. Verified = I opened the page/raw file this session. Stars are as shown on GitHub page at fetch time.
Note: GitHub API was blocked in this sandbox; raw.githubusercontent.com and github.com HTML worked, so commit dates are mostly unverified.

## TL;DR
- Every popular web "car" repo (folio-2019, folio-2025, pmndrs/racing-game, Sketchbook, three.js rapier example) uses the SAME model: one rigid-body chassis + per-wheel raycast spring/damper (Bullet `btRaycastVehicle` lineage). The suspension is a 1-D spring-damper along a fixed ray; there is NO linkage kinematics (no camber gain, roll centre, bump steer). It is a game-feel model, not a mechanical one.
- For a car on a predetermined spline, a full physics engine is NOT needed and is actively harmful (non-determinism, jitter, tuning to hold the line, WASM weight). Recommended: custom reduced-order model = spline follower (kinematic) + analytic per-wheel road sampling + sprung-mass (heave/pitch/roll, 3-DOF or 7-DOF ride model) integrated with a small fixed-step ODE + your own linkage kinematics for each suspension type. Lift the *spring/damper formulas* and *wheel transform conventions* from the repos below, not the engines.
- No ready-made open-source JS repo does exactly "kinematic path + procedural suspension" for visualisation. Closest finds: OpenSAGE `Drawable.cs` (spring/damper pitch/roll on kinematic units; licence not usable as-is), racing-game's fake chassis lean, half-car/quarter-car ODE write-ups (nrsyed/half-car is GPL-3, only the equations are reusable). We will write it ourselves; it is ~150 lines.

## Licence / usability summary
| Repo | Stars | Licence (verified) | Usable? |
|---|---|---|---|
| brunosimon/folio-2025 | 2.0k | MIT (license.md, (c) 2025 Bruno Simon; package.json says ISC - inconsistent but both permissive) | Yes (code; check assets separately) |
| brunosimon/folio-2019 | 4.7k | MIT (readme/license.md) | Yes (code) |
| pmndrs/racing-game | 2.2k | MIT; README says assets CC0 | Yes |
| swift502/Sketchbook | 1.8k (archived Oct 2024) | MIT (LICENSE file) | Yes |
| pmndrs/cannon-es | 2.1k | MIT | Yes |
| dimforge/rapier.js | n/a (unverified) | Apache-2.0 (LICENSE file head) | Yes |
| mrdoob/three.js examples | - | MIT | Yes |
| kripken/ammo.js | unverified | zlib (permissive, not in brief list but OSI-permissive; attribute) | Yes w/ notice |
| isaac-mason/crashcat | 474 | MIT, v0.0.5 (very new) | Yes, immature |
| spacejack/carphysics2d | 218 | MIT | Yes (2-D) |
| lo-th/Ammo.lab | 273 | MIT | Yes (old; author points to newer "PHY") |
| icurtis1/raycast-vehicle | 32 | MIT | Yes (small) |
| Slow Roads (anslo) | - | CC BY-NC-ND 4.0, closed source | NO |
| Trigger Rally | - | GPL (C++/OpenGL, not web; unverified here) | NO |
| nrsyed/half-car | - | GPL-3.0 | NO (equations only) |
| nickmccleery/open-kinematics | - | AGPL-3.0 | NO to copy; useful as a metric checklist |
| OpenSAGE Drawable.cs | - | NOASSERTION (OpenSAGE is LGPL in my recollection; unverified) | NO to copy; pattern only |

## 1. Raycast-vehicle implementations (engine level)

### 1a. cannon-es RaycastVehicle (pmndrs/cannon-es, MIT, 2.1k stars, v0.20.0)
- File: `src/objects/RaycastVehicle.ts` (+ `WheelInfo.ts`). Verified source of `updateSuspension`:
```ts
const length_diff = wheel.suspensionRestLength - wheel.suspensionLength
let force = wheel.suspensionStiffness * length_diff * wheel.clippedInvContactDotSuspension   // spring
const v = wheel.suspensionRelativeVelocity                                                    // <0 compressing
force -= (v < 0 ? wheel.dampingCompression : wheel.dampingRelaxation) * v                     // asymmetric damper
wheel.suspensionForce = Math.max(0, force * chassisMass)                                     // NOTE: scaled by chassis mass
```
  Then applied as impulse along hit normal, clamped by `maxSuspensionForce`. `rollInfluence` shifts the friction impulse application point toward the chassis centre in the up direction (anti-roll hack, `updateFriction` ~line 544). Wheel params: suspensionStiffness, suspensionRestLength, maxSuspensionTravel, dampingRelaxation/Compression, frictionSlip, rollInfluence, customSlidingRotationalSpeed.
- Worth lifting: the spring/damper formula above (stiffness is per-unit-chassis-mass, i.e. it is a frequency^2-like quantity, which is why numbers like 30 feel mass-independent). Asymmetric bump/rebound damping is the one thing worth keeping in our own model.
- Gotchas (from icurtis1/raycast-vehicle README, verified): cannon-es Trimesh only collides with spheres/planes; rays fail on rotated Planes; static body AABB must be refreshed.

### 1b. Rapier `DynamicRayCastVehicleController` (dimforge/rapier.js, Apache-2.0)
- Ported from Bullet `btRaycastVehicle` (Rapier docs, verified). API: `world.createVehicleController(chassisBody)`, `addWheel(pos, dir, axle, restLength, radius)`, `setWheelSuspensionStiffness/Compression/Relaxation/RestLength/MaxSuspensionTravel/MaxSuspensionForce`, `setWheelFrictionSlip`, `setWheelSideFrictionStiffness`, `setWheelSteering/EngineForce/Brake`, `updateVehicle(dt)`, readbacks `wheelSuspensionLength(i)`, `wheelSuspensionForce(i)`, `wheelContactPoint(i)`, `wheelIsInContact(i)`, `wheelRotation(i)`.
- Official demo `three.js/examples/physics_rapier_vehicle_controller.html` (MIT, three r187): chassis cuboid, 4 wheels, restLength 0.8, stiffness 24, frictionSlip 1000; visual wheel placed by `wheel.position.y = connection - suspension` (line ~259). Worth lifting for the wheel-mesh sync pattern (axle, steering, rotation from controller).
- Docs: https://rapier.rs/docs/user_guides/javascript/vehicle_controller

### 1c. ammo.js btRaycastVehicle (kripken/ammo.js, zlib)
- Same algorithm (the original). ammo.js ships a "Vehicle" demo; three.js forum "Driving Demo using Ammo.js" (discourse.threejs.org/t/driving-demo-using-ammo-js/5217) has 6 AI vehicles driving point-to-point with dat.gui tuning. Heavy WASM, manual memory (`Ammo.destroy`), known chase-camera jitter (issue #310). Lo-th/Ammo.lab (MIT, 273 stars) is a worker-based wrapper; author says it is superseded. Not recommended.

### 1d. crashcat (isaac-mason/crashcat, MIT, 474 stars, v0.0.5, copyright 2026)
- New pure-TS physics engine with a "Raycast Vehicle" example (crashcat.dev/examples#example-raycast-vehicle). Pure JS (no WASM), three.js debug renderer in `examples/src/debug/debug-renderer.ts`. Too young to bet on; interesting only if we later want in-engine physics.

## 2. Game/portfolio repos using raycast vehicles

### 2a. brunosimon/folio-2025 (MIT, 2.0k stars, three ^0.187 `three/webgpu`, @dimforge/rapier3d ^0.19.3)
- Key file (verified, raw): `sources/Game/Physics/PhysicsVehicle.js`. Rapier vehicle controller on a `dynamic` chassis (3 cuboid colliders, mass 2.5 on main, centerOfMass lowered to y=-0.5). Wheel settings verified:
  `radius 0.4, frictionSlip 0.9, maxSuspensionForce 150, maxSuspensionTravel 2, sideFrictionStiffness 3, suspensionCompression 10, suspensionRelaxation 2.7, suspensionStiffness 25`; wheel offset x 0.90 z 0.75.
- Runtime suspension modes per wheel: heights low/mid/high = 0.88/1.23/1.63, stiffness 20/30/40 via `setWheelSuspensionRestLength` + `setWheelSuspensionStiffness` each frame. Directly relevant pattern: live-swapping suspension params per wheel.
- Post-physics reads `wheelSuspensionLength(i)`, `wheelContactPoint(i)`, `wheelIsInContact(i)` to drive visuals. A separate `VisualVehicle` exists (file path not confirmed; guessed paths 404). Tick-order pattern (pre-physics priority 2, post-physics 5) and fixed `updateVehicle(1/60)` are worth copying.
- Controller steps: `updateVehicle(Math.min(1/60, deltaAverage))`.

### 2b. brunosimon/folio-2019 (MIT, 4.7k stars, three ^0.164.1, cannon ^0.6.2 i.e. old cannon.js)
- Verified: `src/javascript/World/Physics.js` (car section ~lines 121-220) and `src/javascript/World/Car.js`. Tuned values: chassis 1.02x1.16x2.03 mass 40; wheelRadius 0.25; suspensionStiffness 50; restLength 0.1; maxSuspensionTravel 0.3; dampingRelaxation 1.8; dampingCompression 1.5; frictionSlip 10; rollInfluence 0.01; maxSuspensionForce 1e5; wheel mass 5. Z-up. Wheels are synced from `vehicle.wheelInfos[i].worldTransform` bodies each tick into `Car.js` wheel meshes (`setWheels`, line ~239). Good reference of "toy" tuning numbers.

### 2c. pmndrs/racing-game (MIT, 2.2k stars, three ^0.139, @react-three/cannon ^6.3 `useRaycastVehicle`)
- Verified `src/models/vehicle/Vehicle.tsx`, `src/store.ts`. Wheel defaults: `radius 0.38, suspensionStiffness 30, suspensionRestLength 0.35, frictionSlip 1.5, rollInfluence 0, sideAcceleration 3, customSlidingRotationalSpeed -0.01`.
- IMPORTANT for us: it does NOT trust physics for body attitude. After the physics step it adds PROCEDURAL chassis lean: `child.rotation.z = lerp(rotation.z, (-steeringValue * speed)/200, dt*4)` plus a speed-proportional sin/cos vibration, and camera sway. That is a tiny example of "procedural body motion layered on a kinematic/physical base". Old three/R3F versions; assets CC0.

### 2d. swift502/Sketchbook (MIT, 1.8k stars, archived Oct 2024, three + cannon.js, TS)
- `src/ts/vehicles/Car.ts` (verified numbers): suspensionStiffness 20, restLength 0.35, maxSuspensionTravel 1, frictionSlip 0.8, dampingRelaxation 2, dampingCompression 2, rollInfluence 0.8. Also `Vehicle.ts`, `Wheel.ts` (maps GLTF wheel node userData `steering`/`drive` to wheelInfo index - a nice data-driven rig convention: author wheels/seats/steering wheel as named nodes in the GLB). Cars, airplane, helicopter. Forum thread confirms cannon.js RaycastVehicle base. Old three/TS3/webpack4 build; lift ideas, not build.

### 2e. Others (small)
- icurtis1/raycast-vehicle (MIT, 32 stars): three + cannon-es RC car, GLB level -> Trimesh, `Vehicle._syncVisuals`, tuning panel. Modern-ish, readable reference.
- abhicominin/Car-Controller-Threejs (three + cannon; licence unverified).
- sbcode.net/threejs/physics-car: tutorial using `CANNON.HingeConstraint` axles (constraint-vehicle approach, wobblier than raycast).
- enable3d raycast-vehicle example (enable3d.io/examples/raycast-vehicle.html; Ammo based).
- lab.tresjs.org/experiments/rapier-car: TresJS port of the three.js rapier example.
- pmndrs/ecctrl (MIT): `EcctrlVehicle` for R3F + Rapier (vehicle/drone controller); R3F-only.
- three.js `webgl_materials_car` (MIT): just a car material/lighting demo (no physics); useful for PBR car paint, not suspension. No official three.js raycast-vehicle example besides rapier one; there is no `physics_rapier_vehicle` other than `physics_rapier_vehicle_controller` (confirmed in examples/files.json).

### 2f. 2-D / other
- spacejack/carphysics2d (MIT, 218 stars, 4 commits): port of Marco Monster's car physics; logic in `Car.js` `doPhysics`. Contains weight transfer (longitudinal and lateral load transfer between axles) and slip-angle tyre forces. 2-D but the weight-transfer maths is exactly what a sprung-mass roll/pitch model needs for lateral/longitudinal accel -> roll/pitch. Worth lifting the formulas. (Exact file layout under `marco/`, not fully inspected: unverified.)
- Slow Roads: closed source, CC BY-NC-ND; developer said open-sourcing "not ruled out" but nothing released; do not use. (Author's technical blog describes procedural road + simple physics.)
- Trigger Rally: C++/GPL desktop game, not web. Skip.
- tasora/Project Chrono "web": no browser/WASM Chrono demo found; Chrono::Vehicle is C++ (BSD-3) with rich suspension templates (double wishbone, MacPherson, multi-link, SolidAxle) - useful ONLY as a reference for hardpoint geometry/parameter names, not runnable in browser. (Chrono licence BSD-3 per my knowledge; unverified this session.)
- No dedicated "vehicle-physics" npm JS lib with per-wheel spring/damper beyond the raycast ones above was found.

## 3. Anything modelling suspension per wheel more faithfully
- All raycast vehicles: per-wheel spring + (asymmetric) damper along a fixed direction. No linkage geometry.
- nickmccleery/open-kinematics (AGPL-3.0, Python): solves double wishbone/MacPherson/multilink hardpoint geometry; outputs camber, toe, caster, KPI, scrub radius, roll centre, anti-dive/anti-squat, motion ratios, ride-height change. Not copyable (AGPL) and not a sprung-mass solver (its README explicitly says roll is a kinematic axle state, not solved attitude) - but is the right metric checklist for our "honest tradeoffs" panels.
- Half-car / quarter-car ODEs: sharetechnote.com/html/WebProgramming/Websim_CarSuspension.html (JS web sim; equations below), nrsyed/half-car (GPL). Equations are textbook and free to implement.

## 4. Is a physics engine worth it for an on-rails car? Analysis
Needs: car follows a fixed spline; believable heave/pitch/roll and per-wheel travel; swap suspension types (MacPherson / double wishbone / multi-link) with visibly different behaviour; deterministic, smooth, cheap; runs on mobile.

Why NOT a full engine (Rapier/cannon/ammo):
1. The raycast vehicle has one fixed-direction spring per wheel -> all three suspension types would behave identically; our differentiator (camber gain, roll centre height, bump steer, anti-dive) lives in linkage kinematics the engine cannot express. We would compute those ourselves anyway.
2. You must make the physics car stay on the spline: needs a path-following controller (steering PID, throttle) fighting tyre-slip model -> drift off line, differing lap-to-lap, no guarantee of hitting designed bumps/chicanes; or you glue it with constraints which defeats the point.
3. Determinism/art direction: a cinematic demo wants repeatable laps and camera shots; physics gives chaos and occasional flips (folio-2025 has flip/stuck recovery code for this reason).
4. Cost: Rapier WASM ~1-2 MB, ammo.js larger; sleep/jitter/fixed-timestep interpolation issues (ammo issue #310 chase camera jitter).
5. The raycast model is also physically wrong at the extremes we want to show (no anti-roll bar, no bump-stop curve, no tyre vertical stiffness/unsprung mass).

Why reduced-order IS better: the road input is known analytically (we author the track), so each wheel's ground height z_r(s) is a function of arc length. Then:
- Kinematic base: pose along spline with arc-length speed profile v(s) (curvature-limited: v <= sqrt(a_lat_max/kappa)), giving longitudinal accel a_x = dv/dt and lateral accel a_y = v^2 * kappa (sign by turn) analytically.
- Sprung mass (7-DOF "ride model"): states heave z, pitch phi, roll theta of body + 4 unsprung wheel hops z_u,i. Per corner i (quarter-car, using verified equations from sharetechnote):
  `Ms*zs'' = -ks(zs-zu) - cs(zs'-zu')`,  `Mu*zu'' = ks(zs-zu) + cs(zs'-zu') - kt(zu - zr)`.
  Body corner displacement from body DOFs: `zs_i = z + x_i*phi - y_i*theta` (small angle). Sum corner forces for heave; moments for pitch/roll: `Ip*phi'' = sum(F_i*x_i) + M_load_transfer_pitch`, `Ir*theta'' = sum(-F_i*y_i) + M_roll`.
- Load-transfer excitation (this is what gives the gorgeous "weight shifts in corners/braking" look, no tyre model needed): longitudinal `dFz = m*a_x*h_cg/L` (pitch moment `m*a_x*h_cg - ...`), lateral roll moment about roll axis `M_roll = m_s * a_y * (h_cg - h_rc)` where h_rc is the roll-centre height INTERPOLATED from the chosen suspension's kinematics; lateral load transfer `dFz_axle = m*a_y*h/track` (+ roll-stiffness distribution front/rear). Different roll-centre heights and spring/ARB rates per suspension type then give different roll angles for the same corner: honest, explainable.
- Integrate with semi-implicit Euler or RK2 at fixed 240-480 Hz substeps inside the frame (cheap: 7 DOF); fully deterministic and stable.
- Linkage kinematics layer: per wheel, compute wheel-centre pose as a function of wheel travel (and steer) from hardpoints (solve 4-bar / sphere-sphere intersection per frame or precompute lookup tables over travel -> camber, toe, track change, roll-centre migration, then sample). Drive the visible control arms/struts/knuckle from that. This table is the "physically grounded mechanical configuration".
- Bumps: sample track height per wheel at arc-length offsets (wheelbase/track spacing along the spline); add tyre as a spring kt with optional enveloping filter for sharp bumps. Visible per-wheel travel then equals `zs_i - zu_i` clamped by bump stops with a progressive curve.
- Pros: deterministic, 0 KB engine, easy slow-motion/scrub, per-suspension-type differences visible, can run in a worker or even an analytic GPU pass.

Pattern precedents found (none turnkey):
- OpenSAGE `Drawable.cs` (verified snippet): kinematic game units whose pitch/roll are spring-damped toward ground pitch/roll with an extra "acceleration pitch" spring excited by speed change: `rate += -k*(angle-target) - c*rate; angle += rate*dt` - exactly the 2nd-order procedural suspension idea (licence: do not copy; reimplement).
- racing-game procedural chassis lean (MIT, copyable): `rotation.z = lerp(rotation.z, -steer*speed/200, dt*4)`.
- Jason Foat, "Spline Based Kinematic Drifting in Motorsport" (jasonfoat.us/spline-based-kinematic-drifting-in-motorsport/): spline + t-parameter vehicle with yaw offset for drift; page content failed to load in my fetch (snippet only) - unverified details.
- @scenoco-three/splines `SplineAnimate` (car on spline with `roll` bank knobs) - snippet only, licence unverified.
- Babylon "Making a Simple Car" (Car_Path.md, Apache-2.0 doc): car animated along a path staying parallel to it. Trivial.

Hybrid option (only if wanted): use a physics engine solely as a *visual-only* chassis check? Not worth it. Optional: use Rapier/cannon only for the free-roam (non-rails) mode or collision props; not needed for MVP.

## 5. Files/snippets worth lifting (checklist)
1. cannon-es `RaycastVehicle.ts#updateSuspension` -> spring/asymmetric damper formula (above) for a per-corner baseline; our version should use real Newtons: `F = k*x + c(v)*v` with `c = c_bump` if compressing else `c_rebound`, plus bump stop `k_bs*max(0,x-x_max)^2`.
2. three.js `physics_rapier_vehicle_controller.html` -> wheel mesh sync (`position.y = connection - suspension`, steering about up, spin about axle).
3. folio-2025 `PhysicsVehicle.js` -> per-wheel runtime suspension swap (rest length + stiffness per state), tick ordering, tuning panel layout (tweakpane bindings) - good template for our suspension selector UI.
4. Sketchbook `Wheel.ts` / GLB userData convention (steering/drive flags on named nodes) and `Car.ts` default parameter set for plausible numbers.
5. racing-game `Vehicle.tsx` chassis lean/vibration lines for cheap secondary motion.
6. carphysics2d `Car.js` weight-transfer block (MIT) for a_x/a_y load transfer terms.
7. Sample sprung-mass starting numbers (real car, GT): Ms ~ 1500 kg sprung total, Mu ~ 40 kg/corner, ks ~ 30-45 kN/m wheel rate (ride freq ~1.3-1.6 Hz front, slightly higher rear), cs ~ 2-3.5 kN s/m (zeta ~0.25-0.4), kt ~ 250 kN/m, roll gradient ~ 2-3 deg/g, pitch ~ 1-2 deg/g. (From general vehicle-dynamics knowledge; not from a repo; unverified here - tune visually.)

## Recommendations for Suspension Lab
1. Do NOT adopt a physics engine for the on-rails car. Build `RideModel` module: spline kinematic follower + 7-DOF (or 4 quarter-cars + body 3-DOF) fixed-step integrator + load-transfer inputs from path curvature/speed profile. Pure TS, no deps, deterministic, <200 lines core.
2. Build `SuspensionKinematics` module per type (MacPherson, double wishbone, multi-link): hardpoint sets -> precomputed tables over wheel travel/steer for camber, toe, track change, roll-centre height, anti-dive; the RideModel reads roll-centre height and wheel rates from the active type. Use open-kinematics only as a metric checklist (AGPL: don't copy) and Chrono::Vehicle docs for plausible hardpoint layouts.
3. Wheel/linkage visual rig: copy Sketchbook's named-node GLB convention and Rapier-example wheel-sync maths; drive arms/struts from the kinematic solution.
4. Add cheap secondary motion layer (racing-game style lean/vibration, plus an OpenSAGE-style acceleration-pitch spring pattern reimplemented) for cinematic feel; keep amplitudes physical so honesty is preserved.
5. Keep Rapier (Apache-2.0) in reserve only for an optional free-drive mode; if used, base on `physics_rapier_vehicle_controller.html` + folio-2025 `PhysicsVehicle.js` (both MIT). Use three.js >= r187 (folio-2025 and three.js dev are at 0.187; racing-game is 0.139, folio-2019 0.164).
6. Motorcycles: same RideModel with 2 wheels (pitch + roll/lean as a separate inverted-pendulum lean angle from a_y: `tan(lean) = a_y/g`) and fork dive from longitudinal load transfer; no repo found doing web motorcycle suspension - write from scratch.
7. Avoid for licence reasons: Slow Roads (CC BY-NC-ND), Trigger Rally (GPL), half-car (GPL), open-kinematics (AGPL), OpenSAGE (non-permissive) - use equations/ideas only.
