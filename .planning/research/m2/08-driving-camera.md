# M2-08 — Driving camera for Manual Drive (chase, bonnet, wheel-well, PiP, comfort)

Marks: [S] sourced (link), [E] estimate / my engineering judgement, [E-mem] recalled from engine source, unverified this session.
Sourcing note: GDC Vault pages are paywalled and the Firecrawl developer index was down; GitHub API blocked for the session, but `raw.githubusercontent.com` worked, so repo code below was read first-hand.

## 1. What the industry actually does

### 1.1 Basic follow-camera recipes (all lerp/spring on a chassis-relative offset)
- Unity SmoothFollow (Unity docs/Standard Assets lineage, Unity licence = ideas only). [S](https://discourse.threejs.org/t/solved-smooth-chase-camera-for-an-object/3216)
  ```
  distance=3, height=3, damping=5, rotationDamping=10
  wanted = target.TransformPoint(0,height,-distance)
  pos    = Lerp(pos, wanted, dt*damping)               // NOT frame-rate independent
  rot    = Slerp(rot, LookRotation(target.pos-pos, target.up), dt*rotationDamping)
  ```
- Godot "kinematic car chase camera" recipe: `global_transform = global_transform.interpolate_with(target.global_transform, lerp_speed*delta)`, `lerp_speed=10` (low = lag, high = locked). [S](https://kidscancode.org/godot_recipes/3.x/3d/kinematic_car/car_camera) Site licence not stated -> ideas only.
- Problem with all three: `lerp(a,b,k*dt)` is frame-rate dependent. Correct form: `1 - exp(-decay*dt)` (Holmér "Lerp smoothing is broken", Lembcke "Improved lerp smoothing"; Godot docs recommend it). [S](https://howlingmoonsoftware.com/improved-lerp-smoothing/) [S](https://docs.godotengine.org/en/4.4/tutorials/math/interpolation.html)
- Direct inheritance of chassis quaternion (Godot recipe, Unity "Lock To Target") copies pitch/roll into the view -> disorienting. Cinemachine's answer is the binding mode "Lock To Target With World Up" = target frame with tilt and roll zeroed, only yaw followed. Also "Lazy Follow" (offset and damping in camera-local space, camera moves as little as possible). [S](https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineOrbitalFollow.html) A modder reached the same conclusion: full roll inheritance made orientation hard and caused mild sickness; keep the camera upright by default. [S](https://www.moddb.com/news/to-roll-or-not-to-roll-the-camera)
- Unreal SpringArm: separate `bEnableCameraLag` / `bEnableCameraRotationLag`, `CameraLagSpeed`, `CameraRotationLagSpeed` (higher = tighter, 0 = instant), `bUseCameraLagSubstepping` + `CameraLagMaxTimeStep` (0.005-0.5, ~1/60) to stabilise against frame-rate jitter, plus probe-sphere collision (`ProbeSize`, `bDoCollisionTest`). [S](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USpringArmComponent) Defaults ~ArmLength 300 cm, ProbeSize 12, lag speeds 10 [E-mem]. Known vehicle-template jitter when lag is on [S](https://forums.unrealengine.com/t/spring-arm-with-camera-lag-still-stiff/290727); three.js analogue: chase-camera flicker when camera is updated before the physics/state step [S](https://discourse.threejs.org/t/chase-camera-flickering-in-a-cannon-es-js-three-js-scene/45600). Ours: update the camera AFTER the interpolated `stateAt` for the frame, never inside the 240 Hz loop.

### 1.2 Racing-game specifics
- Gran Turismo 4 chase cam is literally a spring with two hardcoded numbers: "max angle" (how far camera can lean in a corner) 15.0 final vs 10.0 preview, and "damper" (return-to-centre stiffness) 120.0 final vs 30.0 preview; author sets 360 to approximate GT5/GT6 (stiffer = stays more centred). [S](https://silentsblog.com/2022/03/15/gran-turismo-4-loose-chase-camera) Takeaway: racing cams give the camera a LIMITED lean (heading offset) relative to the car and recentre hard; units unknown, so only the ratios (4x damper, cap on lean) are portable.
- Forum consensus (not developer-confirmed): racing chase cams point toward momentum, not heading, at speed; Forza's cam is "dynamic", GT7's is stiff/static; some find GT7 shake excessive. [S](https://forums.forza.net/t/forzas-chase-cam-is-vastly-under-rated/541156) [S](https://gtplanet.net/forum/threads/chase-cam-is-ruining-gt7-for-me.405045) Treat as folklore: validate by feel.
- Speed-linked FOV + light high-speed vibration cited from Forza 4 [S](https://beamng.com/posts/339746); Assetto Corsa chase mods expose dynamic FOV and g-force-driven offsets as user-adjustable, and one lowered its high-speed shake in a later version [S](https://overtake.gg/downloads/j-spec-chase-cam.69347) [S](https://overtake.gg/downloads/shakycam-kirbycam-edit.58091). iRacing offers a "fixed" chase cam (fixed offset so the track stays still and bounce is readable) and a neck-smoothing reduction for sickness-prone users [S](https://support.iracing.com/support/solutions/articles/31000157467).
- GDC "50 Game Camera Mistakes" (Nesky, 2014) [S](https://gdcvault.com/play/1020460/50-Camera): could not read the vault. Secondary summary: dynamic third-person cameras are the hardest; Nesky's Journey write-up says a camera locked to the player's heading was a mistake — "people want freedom, they don't want you shoving their camera around" [S](https://gamedeveloper.com/design/the-poor-man-s-3d-camera). A survey article adds: camera speed too fast or too slow can cause nausea; sphere-collider cameras bounce in tight spaces; "whiskers" steer the camera around obstacles; a delayed camera should ignore small movements (dead zone) [S](https://www.gamedeveloper.com/design/third-person-camera-view-in-games-a-record-of-the-most-common-problems-in-modern-games-solutions-taken-from-new-and-retro-games). Eiserloh GDC 2016 "Juicing your cameras with math" covers smoothing types and shake (not read) [S](https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing).

## 2. Open-source JS code we can actually look at

| Repo | Stars | Last | Licence | Use |
|---|---|---|---|---|
| icurtis1/raycast-vehicle (three r185 + cannon-es) https://github.com/icurtis1/raycast-vehicle | small [E <100] | 2026 | **MIT** (LICENSE read: "Copyright (c) 2026 Ian Curtis") | Copyable chase cam below |
| swift502/Sketchbook https://github.com/swift502/Sketchbook | ~2k [E] | old | **MIT** (read) | Orbit-only camera (radius lerp 0.1, phi clamp +-85 deg); nothing car specific. Skip |
| brunosimon/folio-2019 | large | 2019 | **no LICENSE file** (404) -> ideas only; top-down camera anyway | Skip |
| mrdoob/three.js `webgl_multiple_views` | huge | active | MIT | Scissor/viewport pattern for PiP |

### 2.1 Core update code (icurtis1/raycast-vehicle `src/main.js` lines ~474-620, MIT — copy with attribution)
```js
const cameraOffset      = new THREE.Vector3(0, 5.2, -7.4)  // car ~ RC scale
const cameraLookOffset  = new THREE.Vector3(0, 1.2, 3.2)   // look slightly ahead
const airborneCameraOffset     = new THREE.Vector3(0, 8.2, -12.5)
const airborneCameraLookOffset = new THREE.Vector3(0, 0.6, 9.5)
// per frame
airborneCameraBlend = lerp(airborneCameraBlend, airborneTarget, 1 - Math.exp(-(grounded ? 5 : 3) * delta))
const boostPullBack = 1 + 0.08 * cameraBoostBlend            // dolly-out with FOV
desiredPosition.copy(orbitOffset).applyQuaternion(chassis.quaternion).add(cameraPivot)
desiredPosition.y = Math.max(desiredPosition.y, chassis.position.y + 1.5, 1.2)  // ground clamp
const positionLerp = 1 - Math.exp(-6  * delta)   // position decay 6 /s
const targetLerp   = 1 - Math.exp(-10 * delta)   // look-target decay 10 /s
camera.position.lerp(desiredPosition, positionLerp)
currentTarget.lerp(desiredTarget, targetLerp)
camera.lookAt(currentTarget)
// orbit return: resetLerp = 1 - exp(-8*dt) when throttle pressed; orbitLerp = 1 - exp(-14*dt)
// FOV (line ~1385): fov = lerp(60, 72, cameraBoostBlend)   // +12 deg at full boost
```
Observations [S]: frame-rate-independent decay (good); position decay 6 and look-target decay 10 (look target faster than position = camera "leads" its gaze, a standard trick); FOV 60->72; it inherits full chassis quaternion (we will NOT do that); no velocity-direction blend (so we must design one).

## 3. Design for Suspension Lab manual drive

### 3.1 Principle: one camera rig, two "intent providers"
Our auto camera = spring-damped chase with look-ahead from known path. Keep ONE rig state (smoothed yaw, distance, height, FOV, look-ahead) and make auto/manual differ only in how the *target values* are produced. This makes Auto<->Manual switching continuous by construction.

### 3.2 Manual-mode target yaw (replaces known-future look-ahead)
Quantities each frame from the interpolated vehicle state: heading psi, yaw rate r, body-frame forward speed vx, lateral speed vy, speed v, steer angle delta (road wheel), wheelbase L.

```ts
// Predicted heading "tau seconds from now" instead of path tangent at s+Ld
const rSteady = (vx * Math.tan(delta)) / L;           // kinematic steady-state yaw rate from COMMANDED steer: leads real r
const rPred   = lerp(r, rSteady, 0.5);                // blend measured and commanded (E)
const lead    = clamp(rPred * TAU, -LEAD_MAX, LEAD_MAX);   // TAU=0.35 s, LEAD_MAX=18 deg  (E)

// Velocity-vs-heading blend: follow where the car is GOING at speed, where it POINTS when slow
const slip   = clamp(wrapPi(atan2(vy, vx)), -SLIP_MAX, SLIP_MAX); // SLIP_MAX=30 deg: camera never swings past the cut-off in a spin (cf GT4 "max angle") (E)
const wVel   = smoothstep(3, 10, v) * (vx > 0 ? 1 : 0);            // m/s thresholds, E; 0 when reversing/stopped (velocity direction is noise)
const psiTarget = psi + wVel * slip + lead;                         // slip sign: velocity is rotated by +slip from heading
```
Reasons: heading-locked (GT-style stiff) is stable and legible; velocity-locked shows drift/oversteer direction but jitters at low speed and flips in reverse [S: forum guidance, Roblox/Godot threads only suggest speed-scaled blend; no source gives thresholds -> thresholds are [E]]. The `lead` term is what the known path gave us: yaw rate x tau is the first-order prediction, `rSteady` uses the steering input so the camera starts turning with the wheel instead of after the body responds (transient response in our 7-DOF model is lagged).

Yaw filter: critically damped spring, omega_yaw = 3.5 rad/s (settle ~1.3 s to 95 %, half-lives ~0.3 s) [E]. Use exact step (no per-frame lerp):
```ts
function springStep(s: {x:number;v:number}, target:number, omega:number, dt:number){
  const e = Math.exp(-omega*dt), dx = s.x - target, t = (s.v + omega*dx)*dt;
  s.x = target + (dx + t)*e;  s.v = (s.v - omega*t)*e;           // exact critically damped solution
}
```
Angle wrapping: spring on `dx = wrapPi(s.x - target)`. Add a 1.5-2 deg dead zone on `psiTarget` changes (survey article advice) so bumps/steering micro-corrections do not wobble the view [E].

Position (distance/height) follows the car with exponential decay 6/s (icurtis [S]) horizontally; vertical decay 12/s (follow crest/dip but not bump chatter) [E]. Because the road is analytic: `camY = max(desiredY, roadHeight(camS, camLat) + 0.7)` — this is the entire terrain-collision solution (no raycast/whisker needed); also clamp so camera never enters the car's footprint kerbs [E].

Rig dimensions [E]: arm = 2.8 x wheelbase behind the CoG-projected point (DB11 L=2.81 m -> ~7.9 m; cafe-racer L=1.4 m -> ~4.0 m, floor at 3.5 m), height 1.0 x wheelbase above road (-> ~2.8 m), look target 1.1 m above road, 5 m x (L/2.8) ahead; pitch ~10-12 deg down. Camera pitch follows chassis pitch at 0.2 gain, roll at 0 (or 0.1 on motorbike lean if desired).
Dynamic: arm +6 % and FOV +6-8 deg across 0->v_max, low-passed 0.6 s (icurtis uses +8 % arm and 60->72 deg [S]). FOV widening itself is unproven for comfort: Shi et al. 2021 found no significant sickness difference between FOV reduction, DoF blur and rest-frame reticle in a VR racing game (N=32) and noted dynamic FOV and blur lose information [S](https://arxiv.org/abs/2103.05200) -> keep FOV change small, slow, optional.

Reverse [E]: when `vx < -0.5 m/s` keep the camera BEHIND the car (heading-based, wVel=0); do not flip 180 deg (flip = a snap/swing-through that disorients). Optionally +10 % arm, +0.3 m height, and a "R" glyph in the HUD. Offer a hold-key "look back" that retargets psi by pi through the same spring (shows the 0.9 s swing; that is acceptable because player initiated).

Camera shake policy [E, consistent with [S] accessibility sources]: no rotational shake; no shake from road bumps (the ride model already moves the body, and the view is world-up); optional small vertical chassis-heave coupling (gain 0.15, low-pass 8 Hz) behind a "Road feel" toggle; shake only for impacts if ever, off in reduced-motion. Game-settings guidance lists camera shake/head bob as main triggers and recommends "lock to horizon" [S](https://gameaccessibilityguidelines.com/?p=3278). Respect `prefers-reduced-motion`.

### 3.3 Auto <-> Manual without a jump
1. The rig state (yaw spring x,v; distance; height; FOV; look target) is never reset on a mode change — only the *targets* change. Position is continuous because the car state is continuous.
2. Cross-fade targets: `psiTarget = wrapLerp(psiAuto, psiManual, b)` with `b` eased 0->1 over 0.8 s (smoothstep) on entering manual, 1->0 on leaving. Same for arm/height/FOV/look-ahead distance. Because psiAuto and psiManual are both near the heading at switch time, the spring absorbs the residual with continuous velocity (no derivative step).
3. Compute BOTH providers every frame while blending (cheap); stop computing the unused one when b settles.
4. Hard cut (instant set of rig state = targets) only on discontinuities: respawn/reset, lap restart, teleport > ~15 m, or vehicle swap. Optionally a 120 ms fade-through-black; otherwise it reads as a bug. Everything else swings.
5. Never blend in pose space (position lerp + quaternion slerp of two independent cameras) for chase<->chase — it crosses through the car. Pose cross-fade is only for chase<->bonnet/wheel (below), and there use a short (0.35 s) dissolve or a cut, since interpolating through the bodywork is worse.
6. Input handoff: while `b < 1` do not let throttle/steer-driven look-ahead exceed `b` weight, so a first steering twitch doesn't whip the camera.

### 3.4 Bonnet / cockpit / wheel-well
- Bonnet/driver cam: rigidly attached to chassis frame at an eye point (DB11 ~ driver eye 0.55 m inboard of centre, ~1.15 m above ground, 0.4 m behind front axle [E]); FOV 70-80 vertical [E]. Inherit chassis pitch/roll at 0.4-0.6 gain via low-pass, because a fully rigid view shakes and a fully world-locked one removes the sense of suspension — that gain IS the lesson the app teaches. Cockpit views are claimed more stable for sickness-prone players but that source is low quality [S weak](https://evezone.evetech.co.za/game-desk/prevent-sim-racing-motion-sickness); offer as option, don't promise.
- iRacing-style fixed offset ("chassis-fixed" third-person) is a cheap extra mode: camera rigid in the chassis frame at the chase offset, so body motion is perfectly legible; good for demonstrating suspension, bad for comfort [S](https://support.iracing.com/support/solutions/articles/31000157467).
- Wheel-well "suspension cam": a normal PerspectiveCamera parented to the BODY near the arch (inboard of tyre, ~0.25 m outboard-up), aimed at the hub, FOV 60-70 [E]. Because body is the parent, wheel travel, camber change, toe and the damper show up as motion of the wheel in frame — the exact kinematic story. Keep a second slot for unsprung-attached view (fixed to the upright, looking up at the body) for contrast.

### 3.5 Picture-in-picture in three.js — cost and recipe
- Mechanism: second `renderer.render(scene, wheelCam)` with `setViewport` + `setScissor` + `setScissorTest(true)` into the default framebuffer, exactly as `webgl_multiple_views` [S](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_multiple_views.html) (MIT); need `renderer.autoClear=false`, `renderer.clearDepth()` before the inset, and aspect/projection updated for the inset rectangle.
- Cost [E]: 2nd traversal + draw calls for what the small frustum sees (the wheel cam sees a small slice -> frustum culling drops most; also set `wheelCam.layers` to car + near road only). Fragment cost is ~ inset pixels (e.g. 400x250 = 100k vs 2.1M at 1080p, ~5 %). The real hazards: (a) shadow maps — three re-renders the shadow map on EVERY `render()` call while `shadowMap.autoUpdate` is true [E-mem], so set `shadowMap.autoUpdate=false` and set `needsUpdate=true` only before the main pass; (b) post-processing — render the inset directly to screen after the composer, no SSAO/bloom; (c) MSAA: scissor path stays in the (MSAA) default framebuffer, free; RTT needs `samples` and a resolve.
- Scissor vs render-to-texture: scissor = simplest, zero extra memory, but must be redrawn every frame and can't round corners. RTT (`WebGLRenderTarget`, 512x320, draw as a screen-space quad / CSS-free HUD) lets you throttle the inset to 30 Hz, add a border/rounded mask, and use low-res + no AA; costs one texture and a blit. Recommend: scissor for v1 behind a feature flag; move to RTT@30 Hz if the budget-check shows >1.0 ms.
- Budget gate [E]: inset must cost <= 1.5 ms GPU on the target laptop iGPU; auto-disable below 55 fps with toast "inset paused".

### 3.6 Comfort checklist (adopt)
1. World-up camera (zero roll, small pitch gain) [S Cinemachine WithWorldUp; moddb].
2. Camera yaw angular acceleration limited by the critically damped spring; no snap except reset.
3. Stable 60 fps, camera updated after state interpolation; fixed-timestep jitter is a major discomfort source [S forum, Unreal substepping].
4. Shake off by default, "Road feel" opt-in, honour `prefers-reduced-motion`.
5. FOV: user slider 50-80 vertical (default 60) [E] + speed widening toggle (default on, max +8 deg).
6. Do NOT ship vignette/FOV-restriction as a "sickness fix": study found no significant benefit [S arXiv 2103.05200] (note VR context).
7. Offer fixed-offset/bonnet view as the low-motion option.

## 4. Open questions / gaps
- No developer-primary source for racing-game camera blend thresholds; all thresholds above are [E] and need a 20-minute tuning session with logging (slip, yaw rate, camera lead).
- GDC talks not watched; summaries only.
- UE defaults [E-mem]; Cinemachine docs list no defaults.
- Pose-blend between very different views untested.

## Recommendation for Suspension Lab
1. Keep one rig + two target providers (auto path-tangent, manual predicted); switch by cross-fading targets over ~0.8 s, never resetting spring state. Hard-cut only on reset/teleport/vehicle swap.
2. Manual look-ahead = `psi + wVel*clamp(slip,+-30deg) + clamp(rPred*0.35 s, +-18deg)` with rPred mixing measured yaw rate and `v*tan(delta)/L`; `wVel = smoothstep(3,10 m/s)`, zero in reverse. All numbers [E]; expose in a dev panel.
3. Filter yaw with an exact critically damped spring (omega ~3.5/s) and position with `1-exp(-k dt)` (k=6 horizontal, 12 vertical); never `lerp(..., k*dt)`.
4. World-up camera, pitch gain 0.2, roll 0; ground clearance from analytic `roadHeight` (no raycasts).
5. Reverse keeps the camera behind the car; offer an explicit look-back key instead of auto-flip.
6. FOV 60 + up to 8 deg speed widening (low-passed 0.6 s), user-adjustable and disable-able; arm +6 % with speed.
7. No camera shake by default; optional low-gain vertical "road feel"; honour `prefers-reduced-motion`; no vignette gimmicks.
8. Copy-eligible code: icurtis1/raycast-vehicle chase update (MIT, attribute in file header); Unity/Godot snippets and GT4 numbers are ideas only; folio-2019 has no licence -> do not copy.
9. Bonnet view: chassis-attached eye point, 0.4-0.6 pitch/roll gain; this is the view that makes suspension visible, so make gain a labelled slider.
10. Wheel-well cam: PerspectiveCamera parented to the sprung body aiming at the hub; this shows travel/camber/toe truthfully, no faking.
11. PiP via scissor viewport v1; set `shadowMap.autoUpdate=false` and manual `needsUpdate` to avoid double shadow cost; layers-limit the inset; RTT@30 Hz as fallback; auto-disable under 55 fps.
12. Risks: velocity-blend thresholds untested; camera judder if updated before state interpolation; PiP shadow double-render; hard-cut vs swing choice may feel arbitrary — test on reset and mode switch.
