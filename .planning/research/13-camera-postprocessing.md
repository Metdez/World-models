# 13 - Camera systems and post-processing (vanilla Three.js)

Research date 2026-11-20. Verified = read from npm registry / README this session. "Unverified" = from memory or inference; treat as a TODO to confirm.
Note: GitHub API/raw access was blocked in this session (`gh` 403, raw 404 on some paths), so versions/licences come from the npm registry (verified) and README extracts via Tavily. GitHub star counts for yomotsu/camera-controls and N8python/n8ao are UNVERIFIED.

## 0. Version / licence table (npm registry, verified 2026-11-20)

| Package | Latest | Licence | Last npm publish | Peer deps | Usable? |
|---|---|---|---|---|---|
| three | 0.187.0 | MIT | 2026-10-30 | - | yes |
| camera-controls (yomotsu) | 3.1.2 | MIT | 2025-11-17 | three >=0.126.1 | yes |
| postprocessing (pmndrs) | 6.39.6 | Zlib (permissive, BSD-like; fine to ship) | 2026-11-01 | three >=0.168.0 <0.188.0 | yes (pin three < 0.188) |
| n8ao (N8python) | 2.1.0 | ISC | 2026-11-15 | three >=0.137, postprocessing >=6.30.0 | yes |
| realism-effects (0beqz) | 1.1.2 | MIT | 2023-05-12 (stale; README says v2 "in the works" on a `v2` branch) | three >=0.148, postprocessing >=6.30.1 | yes licence-wise; risky (stale, peer-dep drift) |
| detect-gpu (pmndrs) | 5.0.70 | MIT | 2025-02-26 | - | yes |
| maath (pmndrs) | 0.10.8 | MIT | 2026-08-17 | three | yes (has `damp`, `dampE`, `dampQ`, `dampC` helpers) |

GitHub stats seen in README extracts: pmndrs/postprocessing ~3.0k stars, Zlib; 0beqz/realism-effects ~1.7k stars, MIT, 580 commits.

---
## PART A - CAMERAS

### A1. yomotsu/camera-controls (https://github.com/yomotsu/camera-controls, MIT, v3.1.2)
Drop-in OrbitControls alternative with smoothed transitions. Install: `npm i camera-controls three`.

```js
import * as THREE from 'three';
import CameraControls from 'camera-controls';
CameraControls.install({ THREE });            // v2/v3: pass the THREE subset it needs (or the namespace)
const cc = new CameraControls(camera, renderer.domElement);
// per frame:
const updated = cc.update(clock.getDelta());   // returns true while moving; render only if needed
```
Verified API (README/source extract):
- `await cc.setLookAt(px,py,pz, tx,ty,tz, enableTransition)`, `setPosition`, `setTarget(x,y,z,enableTransition)`, `moveTo(x,y,z,enableTransition)` (moves the orbit target; camera keeps its spherical offset), `rotateTo(az, polar, true)`, `dollyTo(d, true)`, `fitToBox(meshOrBox3, true, {paddingTop...})`, `fitToSphere(obj, true)`, `setBoundary(box3)`, `setViewport(vec4)`. Transition methods return Promises (chainable with await).
- Tuning: `smoothTime = 0.25` (approx seconds to reach target; critically-damped smoothDamp internally - source tracks `_thetaVelocity`, `_phiVelocity`), `draggingSmoothTime = 0.125`, `maxSpeed = Infinity`, `restThreshold`, `dollyToCursor = false` (set true for zoom-to-cursor), `infinityDolly`, `azimuthRotateSpeed`, `polarRotateSpeed`, `dollySpeed`, `truckSpeed`, `minDistance/maxDistance`, `minPolarAngle/maxPolarAngle`, `interactiveArea`.
- Has V3 migration guide in README (read before copying v2 snippets).

**Orbiting a MOVING target (the car):** orbit target is `_targetEnd`; camera position = target + spherical offset. So per frame:
```js
// car world position (smoothed by you, or raw)
cc.moveTo(car.position.x, car.position.y + 0.5, car.position.z, false); // false => rigidly follows, user orbit offset is preserved
cc.update(dt);
```
Pass `true` instead of `false` for a soft lag (uses smoothTime; good "weighty" feel). Caveat: `moveTo` with `enableTransition=true` each frame restarts the damp each call - works, but tune `smoothTime` ~0.15-0.3. Orbit stays in WORLD frame (the camera will not rotate with the car's yaw). To orbit in car-local frame (so the "front 3/4 view" stays front 3/4 through corners) either (a) each frame add the car's yaw delta to azimuth: `cc.rotate(deltaYaw, 0, false)` (verify sign; `azimuthAngle += dYaw`), or (b) own the camera and blend (A4) and only use cc during free-orbit.
Equivalent for stock OrbitControls (MIT, in three/examples/jsm): `const d = carPos.clone().sub(prevCarPos); camera.position.add(d); controls.target.copy(carPos); controls.update();`

**Limits of three OrbitControls** (verified from three source knowledge, unverified this session): no built-in transitions/animated setLookAt, damping is a fixed-factor `dampingFactor` applied per frame (frame-rate dependent in older revisions; newer revisions added `autoRotate` dt handling), no fitToBox, no dolly-to-cursor (only `zoomToCursor` flag added ~r151), single pose; you cannot cleanly tween it without fighting its internal spherical state. camera-controls fixes all of these; it is the right tool for the free-orbit and suspension close-up states.

### A2. Frame-rate-independent smoothing (lift-ready)
Naive `x = lerp(x, target, 0.1)` is frame-rate dependent. Use exponential decay (Freya Holmer, "Lerp smoothing is broken"; also in maath):
```js
// lambda = decay rate (1/s). halfLife h => lambda = Math.LN2 / h
const damp = (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt));
const dampV3 = (v, t, lambda, dt) => v.lerp(t, 1 - Math.exp(-lambda * dt));
const dampQ  = (q, t, lambda, dt) => q.slerp(t, 1 - Math.exp(-lambda * dt));
```
maath equivalents: `import { damp, dampE, dampQ } from 'maath/easing'` (MIT; vanilla-usable, no React).

Critically damped spring (Unity-style SmoothDamp; no overshoot, has velocity so retargeting is smooth; use for position/FOV where target moves discontinuously, e.g. after a shot cut):
```js
function smoothDamp(cur, tgt, vel /*{v}*/, smoothTime, dt, maxSpeed = Infinity) {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48*x*x + 0.235*x*x*x);
  let change = cur - tgt;
  const maxChange = maxSpeed * smoothTime;
  change = Math.max(-maxChange, Math.min(maxChange, change));
  const t0 = cur - change;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let out = t0 + (change + temp) * exp;
  if ((tgt - cur > 0) === (out > tgt)) { out = tgt; vel.v = (out - tgt) / dt; }
  return out;
}
```
Source: Game Programming Gems 4 ch 1.10 (Critically damped ease-in/ease-out smoothing), as popularised by Unity's SmoothDamp. camera-controls uses the same maths internally (so you can copy from its `src/CameraControls.ts`, `smoothDamp` helper, MIT).
Full damped spring with frequency/damping ratio (allows slight overshoot = "camera weight"): semi-implicit Euler `a = -k*(x-t) - c*v; v += a*dt; x += v*dt` with `k = (2*pi*f)^2`, `c = 2*zeta*2*pi*f`; clamp dt (<= 1/30) and substep for stability.

### A3. Chase camera recipe (spring-damped, look-ahead, speed sense)
Separate channels, each with its own damping:
```js
// state: heading (smoothed yaw), camPos, lookTarget, fov
const yawCar = car.yaw;                        // from vehicle sim
heading = dampAngle(heading, yawCar, 3.0, dt); // slow heading lag so corners reveal side of car (wrap angles!)
const speed01 = Math.min(speed / vMax, 1);
const dist = lerp(5.5, 7.5, speed01);          // pull back with speed
const height = lerp(1.6, 1.9, speed01);
const desired = carPos.clone().add(new Vector3(Math.sin(heading)*-dist, height, Math.cos(heading)*-dist)); // behind heading
camPos.lerp(desired, 1 - Math.exp(-6*dt));     // position lambda ~5-8; lower on Z than X/Y for "stretch"
// look-ahead: aim at point ahead of car along velocity or along the track spline
const ahead = lookAheadPoint(trackSpline, carS + speed*0.35);   // 0.3-0.6 s ahead; or carPos + vel*0.3
lookTarget.lerp(carPos.clone().lerp(ahead, 0.6), 1 - Math.exp(-8*dt));
camera.position.copy(camPos); camera.lookAt(lookTarget);
camera.fov = damp(camera.fov, 50 + 14*smoothstep(speed01), 4, dt); camera.updateProjectionMatrix();
```
Because the car follows a KNOWN path (self-driving), do look-ahead along the track spline (sample the curve parameter ahead) rather than velocity; this lets the camera pre-turn into corners (anticipation reads as cinematic). Clamp camera height above ground via raycast/heightmap, keep camera.up = (0,1,0), avoid roll except deliberate bank.
Speed sense: raise FOV 8-15 deg with speed, push camera slightly back, add subtle radial-blur/motion blur and a trace of vignette. Narrow FOV (35-45 deg) + long distance (telephoto trackside) gives the "TV/cinematic" look; wide FOV (70+) near ground exaggerates speed.
Dolly-zoom (vertigo) for dramatic moments: keep subject width w constant: `dist = w / (2*tan(fov/2))`; animate fov 30 -> 70 while moving camera to keep `dist` satisfying the equation. Use sparingly (the suspension-switch moment is a good place).

### A4. Seamless transitions: follow / free orbit / suspension close-up
Treat each mode as a pure function `getPose(dt) -> {pos, quat, fov, (target)}` that is evaluated every frame (they stay live), and a `CameraRig` that outputs a blended pose:
```js
class CameraRig {
  constructor(camera){ this.cam=camera; this.cur=null; this.from=null; this.t=1; this.dur=1.2; this.mode=null; }
  switchTo(mode, dur=1.2){ this.from={pos:this.cam.position.clone(), quat:this.cam.quaternion.clone(), fov:this.cam.fov}; this.mode=mode; this.t=0; this.dur=dur; }
  update(dt){
    const p = this.mode.getPose(dt);                    // live target pose
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt/this.dur);
      const e = this.t*this.t*this.t*(this.t*(this.t*6-15)+10);   // smootherstep
      this.cam.position.lerpVectors(this.from.pos, p.pos, e);
      this.cam.quaternion.slerpQuaternions(this.from.quat, p.quat, e);
      this.cam.fov = this.from.fov + (p.fov - this.from.fov)*e;
      // optional arc: add perpendicular offset sin(pi*e)*k to avoid cutting through the car
    } else { this.cam.position.copy(p.pos); this.cam.quaternion.copy(p.quat); this.cam.fov = p.fov; }
    this.cam.updateProjectionMatrix();
  }
}
```
Rules: blend position by lerp, orientation by `Quaternion.slerpQuaternions` (never lerp Euler), FOV by lerp (or lerp of `1/tan(fov/2)` for perceptually even zoom). Make the blend alpha time-based (above), not per-frame constant. Prevent clipping through the car by arcing the path or blending along the orbit sphere (lerp spherical coords around the car, then convert) instead of a straight line.
Handing over to camera-controls on entering free orbit: when the blend finishes, call `cc.setLookAt(camera.position..., target..., false)` with target = car anchor, so cc's internal spherical state matches the current pose; on leaving, read `camera.position/quaternion/fov` into `from`. Disable `cc.enabled` during automated blends and while the user is not interacting. While free-orbit is active and idle for N seconds, optionally ease back to chase (auto-return).
Suspension close-up: camera anchored to a vehicle-local frame (`car.localToWorld`) at the wheel arch, aimed at the knuckle/strut; use `cc` with `setBoundary` and min/max distance for a small orbit sphere around the strut anchor; `cc.moveTo(anchorWorld, false)` each frame as in A1. Transition in with `fitToBox(strutAssemblyBox, true)` (built in) or the rig above; add DOF (see B) with focus distance = distance to the anchor.

### A5. Camera shake from road input
Trauma model (Squirrel Eiserloh, GDC 2016 "Math for Game Programmers: Juicing Your Cameras With Maths"):
```js
trauma = Math.max(0, trauma - decay*dt);               // decay ~0.8-1.5 /s
const s = trauma*trauma;                               // shake = trauma^2 (or ^3)
const n = (seed) => noise1D(time*freq + seed);         // smooth noise (simplex), not Math.random
camera.rotation offsets: yaw += maxYaw*s*n(0); pitch += maxPitch*s*n(1); roll += maxRoll*s*n(2);
position offsets: x += maxOff*s*n(3); y += maxOff*s*n(4);
```
Drive trauma from the vehicle sim: `trauma += k * highpass(|dWheelTravel/dt|)` or body vertical acceleration spikes, clamp [0,1]; keep amplitudes tiny (max 0.5-1.0 deg roll, 1-2 cm) for a luxury sports car; use it more on the wheel-arch/hood cams than on the chase cam. Apply shake AFTER blending as an additive layer on the final pose (so it does not fight damping). Add a constant micro high-freq layer scaled by speed for "road texture". Reduce/disable on `prefers-reduced-motion`.

### A6. Cinematic auto-director
Facts verified this session: iRacing's replay "Camera Tool" uses groups of fixed trackside cameras with a "Shot Range" (each camera is only valid when subject is within range) and a per-camera "shot quality" score ('Q') to automatically pick among valid cameras (https://support.iracing.com/support/solutions/articles/31000157467-iracing-camera-tool); its auto-director has modes "focus on crashes / leader / most exciting". Racing-game replays (GRID, Forza Motorsport, Assetto Corsa mods) combine pre-authored trackside cameras per track with car-attached cams (bumper, hood, wheel, chase) and cycling "camera animations" around the car (a Steam guide reports ~35 orbit animations in one title). Gran Turismo-specific selection logic is NOT publicly documented (unverified); the following is a synthesised design consistent with the above and film grammar.

Design for Suspension Lab (self-driving car on a known track, so we can author shots offline):
1. Author a **shot library** per track segment: `{id, type, anchor, shotRange(sRange along track), minDur, maxDur, build(dt)->pose, tags}`. Types: `trackside-static` (fixed tripod, look-at car with lag, FOV tightens as car approaches = telephoto pan), `helicopter` (high orbit/pan, slow drift, FOV 25-35), `low-tracking` (spline-following camera 0.3-0.5 m high, offset 3-4 m, parallel to car), `wheel-arch` (car-local mount near front-left arch looking at wheel/spring, shows suspension articulation), `hood/bumper` (car-local, wide, shake on), `drone-chase` (the A3 chase), `rear-3/4-orbit`, `front-3/4`.
2. **Scoring** per candidate each time a cut is allowed: `score = w_event*tagMatch(event) + w_vis*visibility(raycast LOS, car screen-size in [10%,45%]) + w_var*noveltyPenalty(last N shot types, same angle) + w_dist*(inRange)`; events from the sim: `cornerEntry/apex`, `bump` (suspension travel spike), `chicane`, `straight`, `landing`. Corner apex -> low trackside near apex or wheel-arch; straights -> helicopter / long-lens trackside; bump/pothole -> wheel-arch close-up; chicane -> hood/low tracking.
3. **Cut rules** (film grammar): minimum shot length ~3 s, maximum ~8-10 s; cut on events or when the car exits the shotRange; respect the 180-degree rule (don't cross the line of action between consecutive cuts) and the 30-degree rule (new angle >=30 deg or a different shot size); avoid cutting during the apex frame itself; alternate wide/medium/tight; hard cuts are the norm for trackside, use quick blend (0.25-0.5 s) only when the user triggers a mode change. For trackside cams place them on the inside of corners, 8-15 m from the apex, outside the run-off, and pre-validate with raycasts against the track mesh.
4. Keep the director a state machine: `current shot -> evaluate every 0.25 s -> if (shot.expired || betterBy>margin && minDur passed) cut`. Expose `director.override(mode)` so a user click on "free orbit" or "suspension close-up" pauses the director and resumes after idle N s.
5. A "no-cut" cinematic option (continuous drone/crane path with spring-damped lookAt) is cheaper to author and never nauseates; offer as default for the hero/landing screen.

### A7. Camera module interface (suggested)
`CameraModule { id, enter(ctx), exit(), getPose(dt, ctx) -> {pos, quat, fov, target?}, onUserInput? }`; modules: ChaseCam, OrbitCam (camera-controls wrapper in car-follow mode), SuspensionCam, TracksideCam[], HeliCam, DirectorCam (composes others). A single `CameraRig` (A4) owns the THREE.PerspectiveCamera and the shake layer.

---
## PART B - POST-PROCESSING

### B1. pmndrs/postprocessing (https://github.com/pmndrs/postprocessing, Zlib, v6.39.6, ~3.0k stars)
Verified from README: use renderer attributes `{powerPreference:'high-performance', antialias:false, stencil:false, depth:false}`; the EffectComposer manages passes; `EffectPass` merges effects into a single fullscreen shader (fewer render ops, single screen-filling triangle); use `frameBufferType: HalfFloatType` for HDR-like linear buffers (avoids banding); with `ToneMappingEffect` set `renderer.toneMapping = NoToneMapping` and put tone mapping at the end; `renderer.outputColorSpace = SRGBColorSpace` and the library follows. Effects list (verified): SMAA (antialiasing), Bloom, Blur, Colour depth, Pixelation, Outline, SSAO, God rays, tone mapping, colour grading (hue/sat, brightness/contrast, sepia, LUT), Depth of Field, Vignette, Chromatic Aberration, Noise (film grain), Scanline/Grid/DotScreen, Glitch. Peer dep three >=0.168 <0.188: PIN three@0.187.x until a postprocessing release lifts the cap.
```js
import { WebGLRenderer, HalfFloatType, SRGBColorSpace, NoToneMapping } from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset, BloomEffect, VignetteEffect,
         ChromaticAberrationEffect, NoiseEffect, ToneMappingEffect, ToneMappingMode, DepthOfFieldEffect,
         BlendFunction, LUT3DEffect } from 'postprocessing';

const renderer = new WebGLRenderer({ powerPreference:'high-performance', antialias:false, stencil:false, depth:false });
renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = NoToneMapping;
const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 }); // MSAA 4 optional (costly w/ AO)
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ mipmapBlur:true, luminanceThreshold:0.85, luminanceSmoothing:0.2, intensity:0.35, radius:0.7 });
const dof   = new DepthOfFieldEffect(camera, { focusDistance:0.02, focalLength:0.05, bokehScale:2.0, height:480 }); // enable only in close-up
composer.addPass(new EffectPass(camera, dof));                 // DOF ideally in its own pass (needs depth)
composer.addPass(new EffectPass(camera, bloom,
   new ChromaticAberrationEffect({ offset:new Vector2(0.0006,0.0006), radialModulation:true, modulationOffset:0.4 }),
   new VignetteEffect({ darkness:0.45, offset:0.3 }),
   new NoiseEffect({ premultiply:true, blendFunction: BlendFunction.OVERLAY }) /* opacity ~0.15 */,
   new ToneMappingEffect({ mode: ToneMappingMode.AGX })));     // or ACES_FILMIC / NEUTRAL (check enum in your version)
composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
// resize: composer.setSize(w,h); render: composer.render(dt)
```
(Enum names and `ToneMappingMode.*` members: README extract did not list them; confirm in docs https://pmndrs.github.io/postprocessing/public/docs/ - unverified.) LUT: `LUT3DEffect` with a loaded .cube/.3dl LUT via `LookupTexture` + `LUTCubeLoader` from postprocessing (unverified exact names).
Alternative AA: for cheapest, use `renderer` with native MSAA only when no composer; with composer prefer SMAA (post, ~0.3-0.6 ms at 1440p desktop, unverified) or `multisampling: 4` on the composer's render target (hardware MSAA resolve; more memory).

### B2. N8AO (https://github.com/N8python/n8ao, ISC, v2.1.0 published 2026-11-15, actively maintained)
Verified from README: `N8AOPass` replaces RenderPass; `N8AOPostPass` is for pmndrs/postprocessing (needs a RenderPass before it); works with logarithmic depth, ortho, vertex-displaced and alpha-clipped materials automatically; WebGL2 only; three r161+ recommended. Config: `aoRadius`, `distanceFalloff` (1.0 safe), `intensity` (default 5, "2 = soft"), `color`, `screenSpaceRadius`, `colorMultiply`, `aoTones`, `gammaCorrection` (auto; flip it if colours look washed out/dark), quality modes (Performance/Low/Medium/High/Ultra via `setQualityMode`, unverified names), half-res option (`halfRes`), `denoiseSamples/denoiseRadius`.
```js
import { N8AOPostPass } from 'n8ao';
const n8ao = new N8AOPostPass(scene, camera, w, h);   // after RenderPass, before tone-mapping/AA EffectPass
n8ao.configuration.aoRadius = 1.2;          // metres: contact shadows under car/arches
n8ao.configuration.distanceFalloff = 1.0;
n8ao.configuration.intensity = 2.5;
n8ao.configuration.halfRes = true;          // big saving at 1440p
n8ao.setQualityMode('Medium');
composer.addPass(new RenderPass(scene, camera)); composer.addPass(n8ao);
```
Cost (estimates, UNVERIFIED, from general experience): ~1-2 ms at 1440p half-res Medium on a mid desktop GPU; 3-6 ms+ on integrated (Intel Xe/Apple M1 class) at full res; the single most valuable effect for grounding the car, wheels in arches and suspension parts. Re-uses the scene depth via its own depth/normal render, so it re-renders the scene geometry (doubles draw calls for those objects) - keep triangle count and draw calls low.

### B3. realism-effects / SSGI (https://github.com/0beqz/realism-effects, MIT, v1.1.2, last npm publish 2023-05-12)
Verified: contains SSGI, SSR, HBAO/SSAO, TRAA (temporal AA), MotionBlurEffect, VelocityDepthNormalPass; built on pmndrs/postprocessing; README says SSGI v2 and the library are "in the works" (`v2` branch). Status: STALE (no npm release in 3.5 years, peer postprocessing >=6.30.1 / three >=0.148). Usage shape:
```js
const vdn = new VelocityDepthNormalPass(scene, camera); composer.addPass(vdn);
const motionBlur = new MotionBlurEffect(vdn, { intensity: 1, jitter: 1, samples: 16 }); // option names unverified
composer.addPass(new EffectPass(camera, motionBlur));
```
Recommendation: do NOT depend on SSGI/SSR from it (heavy 8-20 ms at 1440p on integrated, ghosting, stale). Its per-pixel velocity-buffer MotionBlurEffect is the only existing drop-in camera + object motion blur for WebGL three; it requires `VelocityDepthNormalPass` (an extra scene render with per-object previous-frame matrices, cost ~ one more geometry pass + a blur pass of N samples). If the vendored/forked copy builds against three 0.187 + postprocessing 6.39 it is liftable (MIT; copy `src/motionblur/*` and `src/velocity/*`); test it, treat as optional "ultra" tier.
Cheaper alternatives for speed sense: (a) camera-only radial/directional blur shader using last-frame view-projection reprojection from depth (no velocity pass; ~0.4 ms), (b) FOV kick + vignette + subtle chromatic aberration scaled by speed, (c) wheel-spoke blur done in the wheel material shader (per-object, free): lerp spoke texture toward a disc by angular velocity.

### B4. Three's built-in passes (three/examples/jsm/postprocessing, MIT; present in r171+ listing: GTAOPass, BokehPass, SSRPass, SAOPass, SSAOPass, SMAAPass, OutputPass, LUTPass, UnrealBloomPass, FilmPass, RenderPass...)
- `OutputPass`: tone mapping + sRGB conversion at the end of a built-in EffectComposer chain (required when renderer.toneMapping is used with composer). Cheap (~0.1-0.2 ms).
- `GTAOPass`: good quality ground-truth AO, but heavier than N8AO and re-renders depth/normals; recommended only if you want zero extra deps (gkjohnson, its author, notes it "can be performance intensive").
- `BokehPass`: simple depth-based bokeh DOF; cost scales with `maxblur`; lower quality than postprocessing's DepthOfFieldEffect.
- `SSRPass`: expensive and not chainable with SSAOPass (both re-render beauty/depth/normals inside; forum report https://discourse.threejs.org/t/ssr-pass-is-not-compatible-with-ssao-pass/30404). Skip; use env-map/cube probe reflections for paint.
- Each built-in pass is a separate fullscreen draw (no merging); that is why pmndrs is preferred.
- Direction of travel: 2026 guides (https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026) show WebGPU/TSL `RenderPipeline` replacing EffectComposer (OutputPass/RenderPass removed, automatic resize). For a WebGL2 production site in 2026 pmndrs/postprocessing remains the practical choice; keep the post-FX module behind an interface so a TSL version can replace it later.

### B5. Performance budget at 1440p (ESTIMATES - unverified; measure with GPU timer queries `EXT_disjoint_timer_query_webgl2` or Spector/Chrome tracing)
Approximate added GPU ms per frame (mid desktop dGPU / modern iGPU like Apple M-series or Intel Xe):
- RenderPass into HalfFloat buffer: ~+0.3 / +0.8
- SMAA: 0.3 / 0.8; FXAA-style cheaper
- Bloom (mipmapBlur): 0.4 / 1.2
- N8AO half-res Medium: 1.0-1.5 / 3-4 (full-res High 2.5-4 / 8+)
- DOF (postprocessing, height 480): 0.5 / 1.5 (enable only in close-up shots)
- Vignette + CA + noise + tone-map + LUT (merged in one EffectPass): 0.2-0.4 / 0.6-1.0
- Velocity-buffer motion blur (realism-effects): 1.5 / 4+
- GTAOPass: 2-3 / 6+; SSRPass: 4+ / 10+; SSGI: 8+ / not viable.
Target frame budget: 16.6 ms at 60 fps; leave scene + physics ~8-9 ms, post <= 4 ms on desktop, <= 3 ms on iGPU via tiering. Fill-rate scales with pixels, so DPR is the master knob: 1440p at DPR 1 = 3.7 MP; DPR 1.5 on a 1080p-CSS window = 4.7 MP.

### B6. Recommended tasteful stack (order matters)
1. `RenderPass` (HalfFloat target; scene uses PBR + environment map, ACES/AgX happens at the end)
2. `N8AOPostPass` (subtle: intensity ~2-3, radius ~1 m, halfRes)
3. `DepthOfFieldEffect` (own pass, only for suspension close-up and hero stills; focus tracks anchor)
4. `EffectPass`: Bloom (threshold high, intensity 0.25-0.4; headlights/brake lights/specular glints) + speed-scaled ChromaticAberration (tiny) + Vignette (0.35-0.5) + Noise/grain (opacity 0.08-0.15, also hides banding) + LUT (subtle warm/teal grade) + ToneMapping (AgX or ACES filmic; AgX handles saturated reds/brake lights without hue skew)
5. `SMAAEffect` (own pass after grade, since SMAA wants the non-HDR final colours)
Optional ultra tier: velocity motion blur or cheap camera-blur shader; contact-shadow decals for tyres; screen-space reflections: no.

### B7. Adaptive quality (DPR scaling + tiering)
drei's PerformanceMonitor logic (verified from source extract, https://github.com/pmndrs/drei/blob/master/src/core/PerformanceMonitor.tsx; drei is MIT, the logic is plain JS so copy the algorithm): defaults `iterations=10`, `ms=250`, `threshold=0.75`, `step=0.1`, `factor=0.5`, `flipflops=Infinity`, `bounds = refreshrate => refreshrate>100 ? [60,100] : [40,60]`; it samples frame times, averages per window, and if the share of windows under the lower bound >= threshold -> `onDecline` (factor -= step), if above upper bound -> `onIncline` (factor += step); too many flip-flops -> `onFallback` (lock a conservative baseline). Port (vanilla):
```js
class PerfGovernor {
  constructor({ms=250, iterations=10, threshold=0.75, step=0.1, factor=0.5, bounds=[40,60], onChange}) { Object.assign(this,{ms,iterations,threshold,step,factor,bounds,onChange}); this.frames=[]; this.avgs=[]; this.t0=performance.now(); this.last=this.t0; }
  tick(now=performance.now()){
    this.frames.push(1000/(now-this.last)); this.last=now;
    if (now-this.t0 >= this.ms){
      this.avgs.push(this.frames.reduce((a,b)=>a+b)/this.frames.length); this.frames=[]; this.t0=now;
      if (this.avgs.length >= this.iterations){
        const lo=this.avgs.filter(f=>f<this.bounds[0]).length/this.avgs.length;
        const hi=this.avgs.filter(f=>f>this.bounds[1]).length/this.avgs.length;
        const prev=this.factor;
        if (lo>=this.threshold) this.factor=Math.max(0,this.factor-this.step);
        else if (hi>=this.threshold) this.factor=Math.min(1,this.factor+this.step);
        if (prev!==this.factor) this.onChange(this.factor);
        this.avgs=[];
      }
    }
  }
}
// onChange(f): dpr = lerp(0.6, Math.min(devicePixelRatio, 2), f); renderer.setPixelRatio(dpr); composer.setSize(w,h)
// quality tiers by factor: f<0.25 -> no AO/DOF, SMAA low; 0.25-0.6 -> AO halfRes + bloom; >0.6 -> + DOF, high SMAA, grain; (>0.9 -> motion blur)
```
Order of degradation: (1) drop DPR toward 0.75, (2) disable DOF/motion blur, (3) AO quality down / off, (4) bloom half-res, (5) DPR toward 0.6. Debounce resize + avoid changing DPR more than once per ~2 s; hysteresis via the flip-flop fallback. Alternative is three's `AdaptiveDPR` idea in drei (regress on interaction). Make sure `EffectComposer.setSize` and `setPixelRatio` are both updated, and that N8AO receives the new size.
Initial tier: `detect-gpu` (pmndrs, MIT, v5.0.70): `import { getGPUTier } from 'detect-gpu'; const { tier, isMobile, fps, gpu } = await getGPUTier();` returns tier 0-3 from a benchmark DB fetched at runtime (self-host the benchmark JSON on Cloudflare R2/Pages via `benchmarksURL` option to avoid third-party fetch; the package defaults to unpkg). Map: tier 0/mobile -> DPR<=1, no post except SMAA/vignette; tier 1 -> DPR 1, bloom+SMAA; tier 2 -> + N8AO half; tier 3 -> full stack. Persist the measured factor in `localStorage` (try/catch) for next visit. Apple GPUs are bucketed coarsely by detect-gpu (privacy), so rely on the runtime governor.

---
## Recommendations for Suspension Lab
1. Dependencies (all permissive): `three@0.187.x` (pin <0.188), `camera-controls@3.1.2` (MIT), `postprocessing@6.39.6` (Zlib), `n8ao@2.1.0` (ISC), `detect-gpu@5.0.70` (MIT), optional `maath` (MIT) for `damp/dampQ`. Avoid realism-effects SSGI/SSR (stale since 2023); evaluate only its MotionBlurEffect as an optional tier.
2. Camera = one `CameraRig` that owns the camera and outputs a pose = blend(modes) + shake; modes are modules (Chase, Orbit via camera-controls following the car through `moveTo(car, false)` each frame, SuspensionCam on a car-local anchor, Trackside/Helicopter shots, Director). Use pose slerp + smootherstep + eased FOV (A4); hand over to camera-controls via `setLookAt(..., false)`.
3. Because the car runs a known spline, precompute shot libraries and look-ahead from the track curve; the director scores shots from sim events (corner apex, bump spike, chicane) with min/max durations and 30/180-degree rules (A6).
4. Use frame-rate-independent `1-exp(-lambda*dt)` damping everywhere and `smoothDamp` for retargeted values; never per-frame constant lerp.
5. Post stack (B6): RenderPass -> N8AO (half-res) -> DOF (close-ups only) -> merged Bloom/CA/Vignette/Grain/LUT/AgX tone map -> SMAA, HalfFloat buffers, `antialias:false` renderer. Keep it restrained: bloom <= 0.4, grain <= 0.15, CA < 1 px, vignette <= 0.5.
6. Adaptive quality: detect-gpu for the starting tier (self-host benchmark data), PerfGovernor (ported drei logic) adjusting DPR in 0.1 steps plus effect tiers; wheel-spoke blur in the shader and FOV/vignette for speed instead of a full velocity pass.
7. Make post-FX and camera separate swappable modules with narrow interfaces (`PostFX.setQuality(f)`, `PostFX.setFocus(distance)`, `PostFX.setSpeed(v)`; `CameraModule.getPose`) so a future WebGPU/TSL pipeline can replace the composer.
8. Open items to verify before coding: exact `ToneMappingMode` names and LUT loader names in postprocessing 6.39; N8AO quality API names; stars/last-commit for camera-controls and n8ao (GitHub blocked here); real frame costs on target hardware (all ms figures above are estimates).

## Sources
- camera-controls: https://github.com/yomotsu/camera-controls , source https://raw.githubusercontent.com/yomotsu/camera-controls/dev/src/CameraControls.ts , npm https://www.npmjs.com/package/camera-controls
- postprocessing: https://github.com/pmndrs/postprocessing , docs https://pmndrs.github.io/postprocessing/public/docs/
- N8AO: https://github.com/N8python/n8ao
- realism-effects: https://github.com/0beqz/realism-effects
- drei PerformanceMonitor: https://github.com/pmndrs/drei/blob/master/src/core/PerformanceMonitor.tsx ; detect-gpu https://github.com/pmndrs/detect-gpu
- iRacing camera tool: https://support.iracing.com/support/solutions/articles/31000157467-iracing-camera-tool
- SSR/SSAO chaining issue: https://discourse.threejs.org/t/ssr-pass-is-not-compatible-with-ssao-pass/30404
- Three.js post-processing 2026 guide: https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026
- Smoothing/shake references (from memory, unverified links): Freya Holmer "Lerp smoothing is broken"; Squirrel Eiserloh GDC 2016 camera shake; Game Programming Gems 4 critically damped smoothing; Unity SmoothDamp.
