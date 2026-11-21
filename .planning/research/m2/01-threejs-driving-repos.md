# M2 research 01: three.js browser-driving repos (what to steal for a physically grounded manual-drive mode)

Researched 2026-11-21. Method: repo pages and raw source read directly (raw.githubusercontent.com). The GitHub REST API was blocked in this session, so star counts come from page scrapes and are marked `~`. Where a star count could not be read it says "n/r". Every number is [S] sourced (URL in the row) or [E] estimate.

## 0. Key framing

Suspension Lab's existing core is a fixed-step 240 Hz semi-implicit body integrator with kinematics lookup tables. That is exactly the architecture of the one repo that matters most (#1 below). The famous repos (Bruno Simon, pmndrs) are arcade raycast-vehicle toys built on a physics engine; they are good for camera, input and reset ideas, not for handling physics. Do not import a physics engine. Add a tyre-force layer to the 7-DOF model and lift the surrounding feel code.

## 1. Survey table

| # | Project | URL | Stars | Licence (SPDX) | Last activity | Physics approach |
|---|---|---|---|---|---|---|
| A | esc5221/drive-game ("Nurburgring Drive") | https://github.com/esc5221/drive-game | ~14 (n/r exact; page shows 14) | MIT [S: LICENSE] | 2026 (96 commits) | Custom 240 Hz, no engine. Raycast suspension, Pacejka-style combined slip, engine, gearbox, diff, aero. Three.js render only. |
| B | brunosimon/folio-2025 | https://github.com/brunosimon/folio-2025 | n/r (large) | MIT per `license.md` (2025); `package.json` says ISC. Both permissive. Assets are not covered by this, check before reuse. | 2026 (three ^0.187, rapier3d ^0.19.3) | Rapier `DynamicRayCastVehicleController`. Arcade. |
| C | brunosimon/folio-2019 | https://github.com/brunosimon/folio-2019 | ~4.7k, 1k forks [S] | MIT [S] | stale (258 commits) | cannon.js `RaycastVehicle`. Arcade. |
| D | pmndrs/racing-game | https://github.com/pmndrs/racing-game | ~2.2k, 211 forks [S] | MIT [S: package.json and badge] | stale (515 commits, R3F 8) | `@react-three/cannon` `useRaycastVehicle`. Arcade. |
| E | swift502/Sketchbook | https://github.com/swift502/Sketchbook | ~1.8k, 517 forks [S] | MIT [S] | stale | cannon.js `RaycastVehicle`, TypeScript, character plus vehicles. |
| F | mrdoob/three.js `examples/physics_rapier_vehicle_controller.html` | https://github.com/mrdoob/three.js/blob/dev/examples/physics_rapier_vehicle_controller.html | three.js is very large | MIT [S] | live | Rapier vehicle controller, 381-line example. |
| G | icurtis1/raycast-vehicle | https://github.com/icurtis1/raycast-vehicle | small (n/r) | MIT [S] | 2026 (5 commits) | three + cannon-es `RaycastVehicle`. Has a tunable parameter panel and tyre marks. |
| H | KhazP/librecorsa | https://github.com/KhazP/librecorsa | n/r | **AGPL-3.0: ideas only, do not copy** [S] | 2026 | Custom 500 Hz 6-DOF (4 x 2 kHz substeps), full double-wishbone from hardpoints, thermal tyres. Three.js, Next.js. |
| I | isaac-mason/crashcat (+ sketches) | https://github.com/isaac-mason/crashcat | n/r | MIT [S: LICENSE]. `isaac-mason/sketches` is also MIT (c) 2023. | 2026 | A JS physics engine with a "Raycast Vehicle" example. The sketches repo has no vehicle sketch in its index (checked `sketches.ts`). |
| J | amitreny/cozy-drive | https://github.com/amitreny/cozy-drive | 0 | **No licence (all rights reserved)** [S] | 2026 | three + Rapier, custom raycast vehicle at 120 Hz, pure tested spec builders. Ideas only. |
| K | KenneyNL/Starter-Kit-Racing | https://github.com/KenneyNL/Starter-Kit-Racing | n/r | MIT [S] (assets CC0) | 2026 | **Godot 4.6, not three.js.** Arcade. Skip. I found no maintained three.js port. |
| L | Slow Roads (Anslo) | https://anslo.medium.com/slow-roads-tl-dr-a664ac6bce40 , https://web.dev/case-studies/slow-roads | n/a | Closed source | n/a | Custom per-wheel kinematics, walls as a signed distance from the road midline. Write-ups only. |

Not found: a three.js official "ammo vehicle" example. The official vehicle example is Rapier (F). Babylon and R3F were not pursued, since no exceptional candidate emerged.

## 2. Findings per project (what is worth lifting)

### A. esc5221/drive-game (MIT): the closest match, rank 1

Files (raw base `https://raw.githubusercontent.com/esc5221/drive-game/main/`):
- `js/physics.js` (600 lines): the whole vehicle. Header comment: "combined-slip Pacejka tires + engine/gearbox/diff + aero. Fixed substep integration at 240 Hz." Same step rate and integrator style as Suspension Lab.
- `js/input.js` (67 lines): keyboard smoothing.
- `js/main.js` `updateCamera()` (around lines 565-625): chase camera plus cockpit camera with g-force head motion.
- `js/car.js` (1296 lines): visuals only (cockpit, wheel spin). Not worth lifting.

**Tyre force, the core to lift** (`physics.js` ~lines 20-40 and 345-400). A single friction-ellipse curve applied to the normalised slip vector:

```js
function tireCurve(rho) { return Math.sin(1.5 * Math.atan(1.73 * rho)); } // peaks at 1.0 when rho == 1
// per wheel, contact-point velocity vc = angVel x r + vel, projected on wheel heading `fwd`/`right`
slipRatio = (w.omega * w.radius - vLong) / Math.max(Math.abs(vLong), 2.0);
slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.8));
mu = MU[surf] * w.muScale * WEATHER_GRIP * (1 - 2.2e-5 * Math.max(0, load - 3400)); // load sensitivity
kp = 0.10, ap = 0.14;                       // slip-ratio and slip-angle at peak
sx = slipRatio / kp; sy = slipAngle / ap;
rho = Math.max(1e-4, Math.hypot(sx, sy));
f = tireCurve(Math.min(rho, 3));
fx =  mu * load * f * (sx / rho);
fy = -mu * load * f * (sy / rho);
fRoll = -Math.sign(vLong) * Math.min(1, Math.abs(vLong) / 0.6) * 0.013 * load;  // rolling resistance, body-only
```

This is a Pacejka-flavoured shape, not full Magic Formula. Peak slip values are 0.10 ratio and 0.14 rad (about 8 degrees) angle. Rolling resistance 0.013 is a sensible road value. It is genuinely combined slip, so braking while cornering costs lateral grip automatically. [S: file above] Load transfer is implicit: each wheel's `load` is its spring+damper force, so it follows the 7-DOF heave/roll/pitch we already have.

**Low-speed fix, essential and easy to miss** (same file): below `vTot < 1.2 m/s` blend to a viscous model, `fy = fy*b - vLat*load*0.9*(1-b)` with `b = vTot/1.2`, and when no pedal is pressed snap `w.omega` toward ground speed (`dt*30` rate) so the car comes to rest instead of crawling forever. Any slip-based tyre model is numerically singular at zero speed. Without this you will have a car that creeps or shivers when stopped. The author documents the failure modes in comments (self-pushing car, "ice" glide).

**Wheel spin dynamics**: `w.omega += (tDrive - fx*w.radius) * dt / w.inertiaW`. Wheel speed is its own state, which is what gives slip ratio meaning.

**Speed-sensitive steering lock** (`maxSteerAngle()`): `clamp(0.62 / (1 + (v/13)^1.7), 0.05, 0.62)` rad. That is about 35 degrees when crawling and about 3 degrees at 180 km/h. Author's rationale: lock is sized so full key deflection sits near the grip limit. [S] Lift as-is, then retune for the DB11 (about 14.5:1 rack [E]).

**Keyboard input smoothing** (`input.js`): rate-limited approach, attack `3.4 / (1 + v*0.022)` per second (slower as speed rises), release `5.5`/s; throttle attack 3.5/s, release 8/s; brake attack 5.5/s, release 10/s; steer target reduced by `1 - min(0.45, slipRear*0.55)` when the rear slides. Simple `step(cur, target, rate, dt)` helper. [S] Good, small, framework-free. (The opt-in counter-steer assist in `physics.js` lines 176-190 is a "stability assist"; make it an off-by-default toggle, since it conflicts with "physically grounded".)

**Chase camera** (`main.js`): target `behind = (0, 1.6, 6.2)` rotated by the car quaternion plus car position; `chasePos.lerp(behind, min(1, dt*4.5))`; clamp above ground `+0.7`; look target `(0, 0.7, -2)` in car frame; fov 68. Teleport guard: snap if the distance exceeds 40 m. [S] Three lines of logic, easy to port. Cockpit mode adds g-force head lean (`gB.x*0.0035` clamped to 0.05 etc., slerp rate 14/s) and vibration scaled from suspension activity. Nice, and it is physically motivated by our existing 7-DOF accelerations.

**Reset**: `recoverToTrack()` calls `vehicle.reset(vehicle.trackS)` (re-seats at the nearest path arclength), triggered by `R`, a pad button, or auto-flip detection (`upY < 0.3` accumulating `_flipTime`). Since our road is analytic in `(s, lateral)`, reset-to-path is trivial for us.

Caveats: 14 stars, one author, AI-assisted build log (the repo links its build session). Physics constants are tuned by feel, not from a measured car, so every number is [E] for us. Surface list uses `MU[surf]`. Licence: code MIT. Bundled track data is ODbL and car models are CC-BY-SA / CC-BY-NC, so do not lift assets.

### H. LibreCorsa (AGPL-3.0): read for ideas, copy nothing

Closest to what Suspension Lab already models (double wishbone from hardpoints, camber, Ackermann, bump steer, anti-dive/squat, roll-centre jacking). Useful design ideas, stated in its README [S: https://github.com/KhazP/librecorsa]:
- 500 Hz fixed step (4 x 2 kHz substeps); verified frame-rate independence: the same 3 s launch ends within 0.3 km/h and 0.2 m at 30/60/144/240 fps. Suggests an accumulator test for our own loop.
- Tyre: Pacejka-style slip curve, combined slip on a friction ellipse, load sensitivity, carcass relaxation (first-order lag on slip), load-dependent rolling radius, pneumatic trail. We should add at least **relaxation length** (a lag on slip angle) to avoid snap-oversteer at 240 Hz keyboard input. [E: relaxation length about 0.3-0.7 m, to be tuned]
- Keyboard assist described as "slip-angle-limited steering assist (S-curve key ramp, self-aligning, slide catch)", individually switchable, plus ABS and TC. Same idea as drive-game's input, with the choice exposed to the user.
- "Honest gaps" section: they publish where the sim disagrees with reference data (14% below a cornering limit table at 86 km/h). Matches our honesty rule; copy the pattern, not the code.
- Telemetry out at 60 Hz JSON and an optional Cloudflare Worker for online features. Relevant to the Cloudflare brief.
Licence is AGPL-3.0, so using any code would force AGPL on Suspension Lab. Ideas only.

### B. folio-2025 (MIT/ISC): best camera and game-loop discipline, arcade physics

Files (raw base `.../brunosimon/folio-2025/main/sources/Game/`):
- `Physics/PhysicsVehicle.js` (590 lines): wraps Rapier `world.createVehicleController(chassisBody)`. Per frame: `setWheelSteering` on wheels 0,1; `setWheelBrake`, `setWheelEngineForce` on all four; `controller.updateVehicle(1/60)`. Settings [S]: wheel radius 0.4, `frictionSlip 0.9`, `sideFrictionStiffness 3`, `suspensionStiffness 25`, `suspensionCompression 10`, `suspensionRelaxation 2.7`, `maxSuspensionTravel 2`, `steeringAmplitude 0.5`, `engineForceAmplitude 300`, `brakeAmplitude 35`, `idleBrake 0.06`, `reverseBrake 0.4`. Units are toy scale (top speed 5 m/s), so numbers are not transferable.
- Ideas that do transfer: (1) "going the other way" logic: if speed > 0.5 and throttle sign opposes velocity, apply brake and zero engine force. Gives a clean forward/brake/reverse state machine for keyboard W/S. (2) Explicit phase order documented in the README: Inputs -> pre-physics -> physics -> post-physics -> View -> visuals. (3) `moveTo(position, rotation)` zeroes linear and angular velocity (reset). (4) `setUnstuck()`: after a timeout (3 s) offer a respawn button instead of forcing one. (5) Per-wheel suspension height/stiffness presets switched live (`low/mid/high`), a pattern relevant to demoing suspension types.
- `Player.js`: input is accumulated from named actions with `Keyboard`/`Gamepad` sources and a `respawn` action bound to `KeyR` and gamepad select. `View.js`: spherical follow rig, zoom driven by speed (`speedAmplitude -0.4`), roll damping 4, focus-point smoothing, plus a free-look mode. Good for layout ideas; it uses TSL/WebGPU and `camera-controls`, so porting code to our WebGL app is not a straight copy.

### C. folio-2019 (MIT): historical reference, cannon.js

`src/javascript/World/Physics.js` [S]: chassis mass 40, wheel radius 0.25, `suspensionStiffness 50`, `frictionSlip 10`, `dampingRelaxation 1.8`, `dampingCompression 1.5`, `rollInfluence 0.01`, `maxSteer = PI*0.17`, `wheelCustomSlidingRotationalSpeed -30`. Useful only as the canonical example of "turn the arcade dials". `rollInfluence 0.01` is a hack that suppresses body roll, which is the opposite of what Suspension Lab wants to show.

### D. pmndrs/racing-game (MIT): camera and input-lerp idioms

`src/models/vehicle/Vehicle.tsx` (138 lines) [S]:
- Steering `steeringValue = lerp(steeringValue, steer * dir, delta*20)`: crude exponential approach.
- Engine force lerped, drive on rear wheels (2,3), brake on rear wheels only (`maxBrake/1.5` when throttling).
- Chase camera: target offset `(sin(steer)*speed/2.5, 1.25 + engine*-0.5/1000, -5 - speed/15 + brake?1:0)`, then `camera.position.lerp(v, delta)`; camera roll `-steer*speed/40`; a small procedural sway. Speed-dependent trailing distance and braking pull-in are good, cheap feel cues.
- Skid effect lives in `src/effects` (`Skid`, `Dust`). Not inspected line by line.
Everything runs through `@react-three/cannon`, so only the camera maths is portable.

### F. three.js official example (MIT)

`examples/physics_rapier_vehicle_controller.html` [S]: keys WASD/arrows, Space brake, R reset. `setWheelSuspensionRestLength 0.8`, stiffness 24, `setWheelFrictionSlip(1000)` (i.e. effectively unlimited grip: demonstrates it is an arcade controller). Brake ramps up by +0.05 per frame to a max. Camera is plain `OrbitControls`. Only worth reading for the minimal key map and wheel-mesh sync (`wheel.position.y = connection - suspension`).

### G. icurtis1/raycast-vehicle (MIT): skid marks

`src/Vehicle.js`: tyre-mark system (`_createTireMarks`, per-wheel active streak, `maxMarks: 700`, alpha-mapped quads, end caps, a miss timer that closes a streak when the wheel leaves the ground), driven by `_updateTireMarks`. The README states its arcade assists (`uprightAssist`, `wallSlideAssist`, `antiWheelie`, `airborneGravityScale`): a list of things we must NOT do. Use for skid-mark structure only: stamp when `|slipRatio|` or `|slipAngle|` exceeds the peak slip thresholds from our own tyre model, rather than the arcade hacks used here.

### I/J/K/L short notes

- Crashcat (MIT): a modern JS engine with a "Raycast Vehicle" example and a three.js debug renderer you may copy (`examples/src/debug/debug-renderer.ts`). Useful only if we ever adopt a physics engine, which the brief rules out. File paths for the vehicle code were not confirmed in this session.
- cozy-drive: no licence. Its architecture (pure `spec -> physics` builder, vitest acceptance tests, headless sim helper) mirrors our `sim-core` discipline. Idea only.
- Slow Roads [S, web.dev and Medium]: custom minimal physics with per-wheel independent dynamics from gravity, surface friction and ground normal; chassis resolved from the wheels; walls stored as a distance from the road midline so collision is a distance check. Directly relevant: our path is already a midline, so lateral offset from path is free and gives cheap barrier or kerb detection. Source is closed, so ideas only.
- Kenney Starter Kit Racing: Godot only; its "arcade-like controls" are not applicable.

## 3. Ranking: top 5 to steal from (physically grounded manual drive added to an existing custom sim)

1. **esc5221/drive-game** (MIT): physics.js tyre and wheel model, low-speed blend, `maxSteerAngle`, input.js smoothing, main.js chase camera, flip-reset. Same 240 Hz semi-implicit design, so it drops into the 7-DOF model with the least impedance. Risk: small repo, constants tuned by feel.
2. **LibreCorsa** (AGPL, ideas only): validation of the approach (500 Hz, friction ellipse, relaxation, load sensitivity, assists exposed as toggles) and the "honest gaps" disclosure pattern. Read, do not copy.
3. **folio-2025** (MIT/ISC): control-state machine (throttle vs travel direction -> brake or reverse), per-frame phase order, respawn with delayed "unstuck" prompt, speed-driven zoom, free-look toggle. Use ideas and small snippets; not the physics.
4. **pmndrs/racing-game** (MIT): speed-dependent chase camera offset, brake pull-in, steer-linked camera roll. Port the 20 lines of camera maths only.
5. **icurtis1/raycast-vehicle** (MIT) for skid-mark ring buffer structure, tied to our own slip thresholds. (Runner-up: Slow Roads write-up for the midline-distance barrier trick.)

Dropped on purpose: three.js official example (grip 1000, orbit camera), folio-2019 and Sketchbook (cannon rigid-body arcade), Kenney kit (Godot).

## 4. Recommendation for Suspension Lab

- Do not add a physics engine. Keep `sim-core` pure TS and deterministic; add a `driveStep(dt, inputs)` that advances the existing 7-DOF state at 240 Hz and is the single place where tyre forces enter.
- Adopt drive-game's tyre force structure: wheel angular speed as its own state, slip ratio and slip angle from contact-point velocity, one friction-ellipse curve on the normalised slip vector, `mu * load` with mild load sensitivity, rolling resistance about 0.013 (road tyres) [S: drive-game]. Fit `mu` (about 1.0-1.1 road tyre) and peak slips (about 0.10 ratio, about 8 degrees) from the DB11 spec and label them [E] in the UI.
- Add a short slip-angle relaxation lag (carcass relaxation length) per LibreCorsa's description. Without it, 240 Hz keyboard steering feels twitchy. [E]
- Copy the low-speed viscous blend and the pedal-off wheel-speed snap (below about 1.2 m/s); otherwise you get a creeping or jittering car at rest.
- Feed tyre load from our existing per-corner spring/damper forces so load transfer and suspension type changes (camber/toe lookup tables) reach the grip limit automatically. This keeps "suspension types mechanically meaningful" without extra physics.
- Input: keyboard rate limiter with speed-dependent steering attack and speed-dependent steering lock (drive-game numbers as the starting point). Make any counter-steer or traction assist an off-by-default toggle, labelled as an assist, and disclose it in the UI. Add gamepad (analogue) and respect `blur` to clear keys.
- Forward/brake/reverse state machine from folio-2025: if the pedal opposes direction of travel above about 0.5 m/s, treat it as braking; engage reverse only near standstill.
- Camera: port the drive-game chase rig (spring `lerp(dt*4.5)`, ground clamp, snap on teleport), make it frame-rate independent (`1 - exp(-k*dt)`), add pmndrs-style speed-dependent trail distance and a slight pull-in on braking. Optional g-force head lean for cockpit view, driven by our existing acceleration state.
- Auto -> Manual hand-off: initialise manual state from `stateAt(t)` (pose, velocity, per-wheel omega = v / radius, suspension state) so there is no discontinuity; make Manual -> Auto reset to the nearest path arclength (analytic `roadHeight(s, lateral)` makes this trivial). Reset (`R`) uses the same function, zeroing linear and angular velocity.
- Skid marks: ring buffer of ribbon quads per wheel, stamped when slip exceeds the peak thresholds, close the streak when the wheel loses contact (icurtis1 pattern). Cheap and keeps the visuals tied to the physics.
- Honesty: publish a "what this is not" panel in the style of LibreCorsa's honest gaps. State that the tyre model is a simplified friction ellipse with estimated parameters, not measured DB11 data.
- Test discipline: add a frame-rate independence test (same scripted input at 30/60/144 fps render rates gives same end state within tolerance) and headless acceptance tests (standing start, 0-100, skidpad, brake-in-turn), as LibreCorsa and cozy-drive do.
- Skip: arcade assists (upright, anti-wheelie, wall-slide, roll-influence suppression), `frictionSlip 1000`-style infinite grip, Rapier/cannon vehicle controllers, copying any AGPL code (LibreCorsa) or any asset from drive-game (CC-BY-SA, CC-BY-NC, ODbL).
- Risks: (1) all tyre numbers are tuned by feel in the sources, so none can be presented as DB11 data; (2) keyboard-only control of a grip-limited car is hard, so assists will be needed and must be disclosed; (3) slip-ratio models need the low-speed fixes above or the car will never settle; (4) the motorcycle has lean angle and a different tyre contact model, so manual drive should ship car-first.
