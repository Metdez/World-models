# M2-09: Seamless Auto <-> Manual handoff in one simulation

Scope: (a) path-tracking controllers that can take over from an arbitrary state; (b) projecting (x,y) onto the clothoid
centreline; (c) architecture (autopilot as a driver vs kinematic on-rails + blend) and determinism; (d) state handoff
without a visible jump. Marks: [S] sourced (link), [E] estimate / own reasoning, [T] tested by me in a scratch script.

Context read from the repo (`.planning/ARCHITECTURE.md` §7): today `stateAt(lapTime)` is pure and gives a `PathState`
{s, l, v, ax, ay, curvature, heading, x, y, z, bank, grade}. `ride.step(dt, RideInput{ax, ay, road, roadRate, rcHeight,
antiPitch})` is the only consumer of body acceleration, and the existing `seek(t)` already does "init at
`stateAt(t - SEEK_SETTLE_S)`, reset ride at equilibrium, step to t". Both facts are what make the recommendation below cheap.

---------------------------------------------------------------------------------------------------------------------

## 1. Repos and licences

| Repo | URL | Stars | Activity | Licence (SPDX) | Use |
|---|---|---|---|---|---|
| PythonRobotics | https://github.com/AtsushiSakai/PythonRobotics | ~27k [E] | active (master edited recently) [E] | MIT [S: LICENSE page, "The MIT License (MIT) Copyright (c) 2016 - now Atsushi Sakai"] | pure pursuit, Stanley, LQR code: copyable (keep notice) |
| CARLA | https://github.com/carla-simulator/carla | ~13k [E] | active [E] | MIT [S: https://github.com/carla-simulator/carla/blob/master/LICENSE, "Copyright (c) 2017 CVC at UAB"]. Note: assets/content under separate licences; the `agents/` Python is MIT per file header ("licensed under the terms of the MIT license") | PID lat/long controller + rate limiter: copyable |
| F1TENTH gym | https://github.com/f1tenth/f1tenth_gym | ~0.9k [E] | active [E] | MIT [S: raw LICENSE, "Copyright (c) 2020 Joseph Auckley, Matthew O'Kelly, Aman Sinha, Hongrui Zheng"] | simulator; pure-pursuit labs are course material, not fetched. Ideas only from lecture notes |
| TUMFTM mod_vehicle_dynamics_control | https://github.com/TUMFTM/mod_vehicle_dynamics_control | small [E] | 2022-25 [E] | NOT VERIFIED by me (page extract did not show it). Treat as ideas only until checked | Roborace/IAC stack: "feedforward/feedback design based on simple kinematic relations and an LQR", later Tube-MPC [S: repo README] |
| TUMFTM GraphBasedLocalTrajectoryPlanner (same group) | https://github.com/TUMFTM/GraphBasedLocalTrajectoryPlanner | ~270 [S] | n/a | LGPL-3.0 [S] | ideas only |
| MAP controller (Becker et al., ICRA 2023, ETH) | https://arxiv.org/html/2209.04346v4 | n/a | n/a | paper (c) IEEE; repo licence not verified -> ideas only | pursuit + tyre model + acceleration feedforward; lateral error ~half of pure pursuit at 82.5% speed [S: arXiv] |
| AirSim | not researched in this pass | | | I believe MIT and archived by Microsoft [E, unverified] | no value over the above for a 2D ground vehicle |

Not copyable: anything GPL/LGPL/unverified above; TUM/OpenLAP material is algorithms only (consistent with the existing
speed-profile decision in ARCHITECTURE §7.2.1).

---------------------------------------------------------------------------------------------------------------------

## 2. Controllers worth stealing (quoted)

### 2.1 Stanley (the right primary steering law for "arbitrary state")
`PathTracking/stanley_control/stanley_control.py`, MIT, PythonRobotics [S: raw file]:
```python
current_target_idx, error_front_axle = calc_target_index(state, cx, cy)
# theta_e corrects the heading error
theta_e = normalize_angle(cyaw[current_target_idx] - state.yaw)
# theta_d corrects the cross track error
theta_d = np.arctan2(k * error_front_axle, state.v)
# Steering control
delta = theta_e + theta_d
```
Hoffmann et al. 2007 form with softening + clamp [S: DLR thesis https://elib.dlr.de/225101/1/BA_VSP_final.pdf eq 3.4-3.5]:
`delta = psi_e + atan(K * e_lat / (K_soft + v))`, clamped to +-delta_max. The same source lists Hoffmann's extra terms
(yaw-rate damping, steering-actuator damping, slip-angle compensation). A lecture source states the law is globally
stable irrespective of initial conditions [S: https://www.youtube.com/watch?v=A-RdRUMhOEU, 18:05] - that property is exactly
what we need for "take over anywhere". Weakness [S: DLR thesis]: purely reactive, no curvature information, so add feedforward.

Why Stanley over pure pursuit for the recovery phase: Stanley's reference is the FRONT axle's projection onto the path, so
the steering command is bounded and well defined even at large cross-track error and arbitrary heading; pure pursuit's
look-ahead point search can pick the wrong branch of a closed loop or cut corners at high Ld.

### 2.2 Pure pursuit (fine for the on-line phase; cheap)
`PathTracking/pure_pursuit/pure_pursuit.py`, MIT [S]:
```python
Lf = k * state.v + Lfc          # k=0.1, Lfc=2.0 m
alpha = math.atan2(ty - state.rear_y, tx - state.rear_x) - state.yaw
delta = state.direction * math.atan2(2.0 * WB * math.sin(alpha) / Lf, 1.0)
delta = np.clip(delta, -MAX_STEER, MAX_STEER)
```
Notes: `direction = -1` handles reverse (steer sign flipped); nearest index is only searched globally the first call then
advanced incrementally (`old_nearest_point_index`) - the same warm-start idea as section 3. F1TENTH practitioners: look-ahead
proportional to speed; take the SPEED from the closest raceline point, not from the look-ahead point, or the car brakes too
early [S: https://stevengong.co/notes/Pure-Pursuit, a blog, so weak evidence]. A tuned, speed-dependent Ld beats a fixed one
(PPO-tuned Ld + gain paper, https://arxiv.org/html/2602.18386v1 [S]); for us a hand schedule is enough:
`Ld = clamp(Kd*v, 4 m, 25 m)` [E, starting point].

### 2.3 LQR steering (gain-scheduled, no runtime Riccati)
`PathTracking/lqr_steer_control/lqr_steer_control.py`, MIT [S]:
```python
A[0,0]=1.0; A[0,1]=dt; A[1,2]=v; A[2,2]=1.0; A[2,3]=dt          # state [e, e_dot, th_e, th_e_dot]
B[3,0]=v/L
K,_,_ = dlqr(A,B,Q,R)                                             # Q=eye(4), R=eye(1)
ff = math.atan2(L*k, 1)                                          # curvature feedforward
fb = pi_2_pi((-K @ x)[0,0])
delta = ff + fb
```
Pattern worth lifting: feedforward `atan(L*kappa)` + LQR feedback on [e, e', theta_e, theta_e']. In TS: solve the DARE
OFFLINE for ~12 speeds, store `K(v)` (4 numbers), interpolate at runtime: 4 multiplies/frame, no `scipy`. TUM used the same
structure (kinematic feedforward + LQR) to get within 2% of an amateur driver's lap time [S: TUMFTM README]. Choose this
over MPC: "MPC-lite" buys nothing visible at our speeds and a QP solver is a risk for the 60 fps budget [E].

### 2.4 Rate-limited PID outputs (CARLA, MIT) - quote the useful bits
`PythonAPI/carla/agents/navigation/controller.py` [S: raw file]:
```python
VehiclePIDController(..., max_throttle=0.75, max_brake=0.3, max_steering=0.8)
if acceleration >= 0.0:
    control.throttle = min(acceleration, self.max_throt); control.brake = 0.0
else:
    control.throttle = 0.0; control.brake = min(abs(acceleration), self.max_brake)
# Steering regulation: changes cannot happen abruptly, can't steer too much.
if current_steering > self.past_steering + 0.1: current_steering = self.past_steering + 0.1
elif current_steering < self.past_steering - 0.1: current_steering = self.past_steering - 0.1
```
Lateral PID error is the angle between the heading and the vector to the target waypoint; longitudinal PID output in [-1,1]
is split into throttle/brake. Two lessons: (1) the controller's output interface IS `{steer, throttle, brake}` (CARLA
`VehicleControl`), i.e. the autopilot is just another driver of the same physics - the architecture we recommend; (2) the
per-step steering slew limit is the simplest way to avoid a steering snap at handover (section 5).

### 2.5 Speed tracking: do NOT chase a cruise speed; track the profile
Our precomputed `v_lim(s)` already contains the backward (braking) pass, so anticipation is already baked in; the controller
only needs `v_ref(s_proj)` at the CURRENT projection plus acceleration feedforward:
```
a_ff   = v_ref * dv_ref/ds                      // from the profile (finite diff of the 0.5 m table)
a_cmd  = a_ff + Kp*(v_ref - v) + Ki*∫(v_ref - v)
throttle = a_cmd > 0 ? min(1, a_cmd/a_max(v))  : 0
brake    = a_cmd < 0 ? min(1, -a_cmd/a_brake)  : 0
```
Off-line recovery requires derating: `v_target = v_ref(s) * min(1, 1/(1 + c1*|e|/w_road + c2*|psi_e|))` and a hard cap from the
friction circle with the recovery curvature (`v <= sqrt(0.6*mu*g/|kappa_cmd|)`) [E, constants to tune]. PythonRobotics only
uses `Kp*(target-current)` (P-only) [S] - too weak for a 1.6 t car near the limit; CARLA's PID has a 10-sample error buffer [S].

### 2.6 Recovery from off-track / spun / reversed (nobody ships this as a library; design it)
None of the repos above implements it: they all assume a reasonable start pose. Own design, a 5-state machine [E]:
```
TRACK      |e| < 1.5 m and |psi_e| < 45 deg and v > 0           -> Stanley + FF + profile speed
RECOVER    |e| large or |psi_e| in [45,100] deg, moving forward  -> Stanley toward the nearest point, v_target <= 8-12 m/s,
                                                                    saturate steering; target heading blends from "toward line" to "along line"
BRAKE      |psi_e| > 100 deg (facing wrong way) or |beta| > 35 deg (sliding) or v < 0 unintended
                                                                 -> brake (ABS-like: cap brake so slip < peak), steer into the slide, wait v < 2 m/s
TURNAROUND stopped, |psi_e| > 100 deg                            -> reverse + full lock until |psi_e| < 90 then forward (3-point turn),
                                                                    or one U-turn if road width >= 2*Rmin (compare lateral room from roadWidth(s))
RESUME     |e| < 0.3 m and |psi_e| < 5 deg for 0.5 s              -> hand to TRACK with the speed target ramped from v up to v_ref over 1-2 s
```
Hysteresis on every transition (entry thresholds tighter than exit) so it does not chatter. Reverse uses the Stanley/pure
pursuit sign flip shown in 2.2 (`direction = -1`). Because the path projection is the single source of `(s, e, psi_e)` the
machine is ~80 lines.

---------------------------------------------------------------------------------------------------------------------

## 3. Projecting (x,y) onto the clothoid centreline, every frame

Facts about our track (ARCHITECTURE §7.5 gates): closed loop, ~1.65 km, sections are line / clothoid / arc, non-adjacent
sections keep >= 30 m clearance, curvature continuous at clothoid joints. Consequence: a car within ~15 m of the centreline
has an unambiguous nearest section; a window of +-40 m around the previous `s` is safe.

Frenet definitions [S: https://github.com/fjp/frenet, https://www.mathworks.com/help/nav/ref/referencepathfrenet.html]:
`s` = run length of the closest point, `d` = signed distance with `d > 0` to the left. Conversion back: `p = r(s) + d*n(s)`.

Algorithm (warm-started Newton, global fallback), derivation:
`f(s) = (p - r(s)) . t(s) = 0`; `f'(s) = -1 + kappa(s) * d(s)` with `d = (p - r).n`, hence
`s <- s + f / (1 - kappa*d)`. The denominator vanishes at the centre of curvature (point inside the radius): clamp it.
```ts
// sim-core/path/project.ts  (own code; algorithm textbook-standard; no licence issue)
export interface Frenet { s: number; d: number; psiE: number; curvature: number; converged: boolean }
const DS = 0.5;                                     // existing resample step
export function project(track: BuiltTrack, px: number, py: number, hint: number, out: Frenet): Frenet {
  let s = hint, it = 0, ok = false;
  for (; it < 6; it++) {
    track.sampleAt(s, tmp);                         // x,y,heading h, curvature k  (table lerp, 0.5 m)
    const dx = px - tmp.x, dy = py - tmp.y, c = Math.cos(tmp.h), sn = Math.sin(tmp.h);
    const f = dx * c + dy * sn;                     // along-track residual
    const d = -dx * sn + dy * c;                    // + left
    const den = Math.max(0.2, 1 - tmp.k * d);       // guard near the centre of curvature
    const step = Math.max(-5, Math.min(5, f / den));
    s = wrap(s + step, track.length);
    if (Math.abs(step) < 1e-3) { ok = true; break; }
  }
  if (!ok || Math.abs(d) > 25) s = coarseSearch(track, px, py, hint);   // see below
  ...fill out (s, d, psiE = wrapAngle(carYaw - h), curvature = k)
}
```
`coarseSearch`: scan the 0.5 m polyline over `hint +- 60 m` (240 points); if the best distance is still > 25 m or the
hint is invalid (first frame, teleport, seek), scan all 3300 points with stride 8 then refine locally (<= 3300/8 + 16
evaluations, ~0.02 ms [E]). Never do the full scan per frame; the warm start is O(1).

[T] I tested the Newton step in a scratch script (centreline from a clothoid/arc curvature profile resampled at 0.5 m,
|kappa| <= 0.02): 16,987 random points within +-20 m lateral of the line, warm start perturbed by +-3 m, compared with a brute-force
nearest-sample search: 0 mismatches > 0.6 m, max 4 Newton iterations. (3,013 further points were skipped because in my
throw-away test path the true nearest point lies on a different, self-crossing section; on the real track the >= 30 m
clearance gate removes that case. Script: scratchpad `proj.mjs`, not part of the repo.)
Failure modes to unit-test: point inside the radius of an arc (den clamp), points near the loop seam (wrap), a hint on
the wrong branch after a teleport (fallback), and `|d|` huge (car in the field).

For the speed reference also keep `sIndex = floor(s/DS)` and lerp `v_ref`, `kappa`, `heading` from the tables
(`stateAt` machinery already inverts t(s); here we need v_ref(s), which is the table before inversion).

---------------------------------------------------------------------------------------------------------------------

## 4. Architecture: autopilot as a driver vs on-rails + blend

### 4.1 Options
A. Keep kinematic on-rails for auto; add a dynamic mode for manual; blend poses on switch.
B. One dynamic planar plant ALWAYS; auto = a `Driver` outputting `{steer, throttle, brake}`; manual = another `Driver`.
C. (Recommended) B for the DRIVEN car, but keep `stateAt(t)` as the pure REFERENCE (what the autopilot tracks and what
   the idle/demo/spectator car replays). Default idle state stays on rails exactly as today.

### 4.2 Trade-offs
| Concern | A: rails + blend | B/C: driver into the same dynamic model |
|---|---|---|
| Visual jump on switch | A pose blend crossfades two different physical states: velocity/yaw/load are inconsistent for the blend period; suspension sees unphysical ax/ay. "Honesty" rule: approximate behaviour presented as physics | None by construction: one plant, one state; only the input source changes |
| Cost / complexity | two motion models forever + blend rules | one more planar model (bicycle with load transfer, ~150 lines) which manual needs anyway |
| Determinism of the shared lap | exact, bit-identical (pure function of t) | autopilot-in-plant is deterministic given initial state + fixed steps, but not bit-identical across engines (see 4.3) |
| Suspension-type meaning | auto laps keep the existing meaningful behaviour | ride model gets `ax, ay` from the plant in both modes; same code path, so manual and auto are comparable |
| Late joiners / seek | `stateAt(t)` | `seek` pattern already exists: init at `stateAt(t - SEEK_SETTLE_S)` then pre-roll the controller; a stable closed loop forgets its initial error [E] |

Decision: C. Default experience unchanged (rails, shared server time, zero risk to the live demo). The dynamic plant + driver
runs only for the car the user has touched. After Manual -> Auto the autopilot driver tracks the reference profile in the
plant until converged (all of |e| < 0.15 m, |psi_e| < 1.5 deg, |v - v_ref| < 0.3 m/s for 1 s); optionally then LATCH back to
rails (state matches, so no jump) with the lap clock set to `lapTimeAt(s)`.

### 4.3 Determinism: what really holds
- Pure fixed-step TS (240 Hz, semi-implicit Euler) is deterministic on one engine; Gaffer's cautions apply across engines:
  "Floating point determinism across platforms is hard" [S: https://gafferongames.com/post/snapshot_interpolation]. The
  ECMAScript spec lets `Math.sin/cos/atan2/exp/pow` be implementation-approximated [E: ECMA-262 text from memory,
  not re-fetched], so Chrome and Safari can differ in the last bit. `+ - * / sqrt` are exact IEEE-754. If bit-identity matters
  (replays, cross-device ghosts), write small own `sin/cos/atan2` (polynomial) in `sim-core`, ban `Math.*` transcendentals
  in the plant and controller via an ESLint rule; otherwise accept ULP-level differences.
- A stable tracking loop contracts perturbations (it is the same reason the pre-roll in `seek` works), so two clients simulating
  the autopilot on the line will look identical on screen even if not bit-identical [E]. Chaos only appears at the limit
  (slides); the autopilot never drives there if profile derate leaves margin.
- Rendering stays decoupled: fixed step + `alpha` interpolation between previous/current state [S:
  https://gafferongames.com/post/fix_your_timestep - "alpha ... linear interpolation between the two physics states",
  `state = currentState*alpha + previousState*(1-alpha)`]. At a mode switch set `previous = current` so a frame never lerps
  across the handover.
- Ghosts/replays in games: Trackmania replay files contain the exact inputs that drove the run and use them for validation by
  re-simulation [S: https://donadigo.com/tminterface/input-extraction] - possible because the engine is deterministic and
  fixed-step. Forza's AI is the same pattern as C: "the AI controller is how the game uses throttle, brake and steering
  inputs ... the driving line is the path the AI controller follows" [S: https://forza.net/news/forza-motorsport-drivatars-tire-physics].
  Forza also ships partial assists (steering "provides some guidance ... only when necessary") [S: Forza assists video
  https://www.youtube.com/watch?v=eC0IKCuYfVU] - precedent for a later "shared control" assist that blends driver and
  autopilot INPUTS (never poses).
- If we ever need ghosts of manual laps: store `{buildHash, initial state, input stream at 60 Hz}` (a few KB/lap) plus a state
  keyframe every ~2 s; replay by re-simulating from the nearest keyframe, snap-correct if drift > tolerance. Gaffer's
  alternative (snapshot interpolation) avoids determinism entirely at the cost of bandwidth [S: same article].

### 4.4 Interface sketch (own code)
```ts
export interface DriverInput { steer: number /* -1..1 */; throttle: number /* 0..1 */; brake: number /* 0..1 */; reverse?: boolean }
export interface Driver { id: 'auto' | 'manual'; step(dt: number, view: PlantView, ref: ReferenceLine, out: DriverInput): void; onEngage(view: PlantView): void }
export interface PlanarPlant {       // 3-DOF single track + load transfer; feeds the SAME RideInput
  state: { x; y; yaw; vx; vy; r; steerAct; wheelPhase: Float64Array; wheelOmega: Float64Array; axLP; ayLP };
  step(dt: number, u: DriverInput, road: RoadQuery, out: RideInput): void;
}
```
The plant integrates body-frame `vx, vy, r`, outputs `ax, ay` (the low-passed values `RideInput` already expects), and takes
road height/rate from `track.roadHeight` exactly as §7.6 steps 4-5. `ride.step` is untouched. Steering actuator is a
rate-limited first-order system (`steerAct`) so both drivers see the same physical delay.

---------------------------------------------------------------------------------------------------------------------

## 5. Handing state over without a visible jump

Auto-on-rails -> Manual (user grabs the wheel). Apply on a fixed-step boundary (step counter), not on the DOM event time:
1. Pose and velocity: `x, y, yaw` from `PathState` (x, y, heading); `vx = v`, `r = v*kappa`, `vy` = steady-state sideslip of the
   plant at that `(v, kappa)` (solve the plant's equilibrium, or just pre-roll: run the AUTOPILOT driver for 0.25-0.5 s starting
   from `stateAt(t - 0.5)` - identical to the existing `SEEK_SETTLE_S` mechanism, so slip, yaw rate and `steerAct` settle themselves).
2. Steering: `steerAct` = Ackermann/steady-state angle of the plant, NOT zero. The user's device targets 0 (centred stick) - so
   the input path is `steer_cmd = slewTo(user, from = handedOverValue, rate)`; the CARLA rule (+-0.1 per control step) is exactly this
   [S]. Rule of thumb: ~0.3-0.5 s to reach the user's value [E].
3. Pedals: hold the autopilot's last `throttle/brake` and decay toward the user's value over 0.3-0.5 s; or "capture" gating:
   throttle stays at the held value until the user's pedal crosses it. Pick decay (simpler, no stuck states) [E].
4. Wheel spin and rolling phase: keep `wheelPhase` as integrated state; only change `wheelOmega` target = `vx/Reff` (per side with
   `vx +- r*track/2`). Never recompute phase from `s` - that produces a one-frame spin flicker.
5. Suspension: nothing to hand over; `ride.state` (heave, roll, pitch + rates, per-corner travel and rate, bump-stop) is already
   persistent. The only continuity risk is the `ax/ay` input: carry the 8 Hz low-pass state (`axLP, ayLP`) across the switch and
   initialise it from the profile values at the switch instant. Test: the metric "|d(heave)/dt, d(roll)/dt| step at switch <
   1% of the 95th percentile of steady driving" [E].
6. Camera and previous-frame buffer: copy `current -> previous` for body, wheels, camera target.

Manual -> Auto (user lets go / presses A):
1. Plant state untouched. The autopilot starts in whichever state-machine node the projection dictates (TRACK/RECOVER/BRAKE...).
2. Its first outputs are slew-limited from the user's last `steer/throttle/brake` (CARLA-style limiter, [S]).
3. Speed target begins at `min(v_ref, current v + small)` and ramps (never demand a hard brake the user did not ask for
   unless the state machine is in BRAKE).
4. Latch to rails only when the convergence test in 4.2 passes; set lap clock `t = lapTimeAt(s)`. The shared server-time sync
   is therefore OFF for this car after any manual excursion - an honest "detached timeline". "Rejoin live lap" is an explicit
   button doing the existing `seek(serverTime)` with a camera cut/fade (it IS a discontinuity, so label it as one). Catching up
   to the shared timeline by driving faster is impossible when the reference already rides the friction limit [E].

What is NOT recommended: crossfading poses between the rails and the plant (A); mixing `ax/ay` from two models (double-counts
body acceleration); per-axle "assist" torque vectors for recovery (no demonstrable value, adds a hidden controller).

---------------------------------------------------------------------------------------------------------------------

## 6. Test plan (cheap, deterministic, belongs in `sim-core` vitest)
- Autopilot-in-plant lap from `stateAt(0)`: max |e| < 0.25 m, lap time within +-2% of the profile, no `gripUse > 1` events
  beyond the current rails behaviour. Same for the motorcycle (plant needs lean; see M2 motorcycle notes).
- Arbitrary-start suite: 500 seeded random states (|e| <= 12 m, |psi_e| up to 180 deg, v in [-5, 40] m/s, including spun with
  yaw rate): 100% rejoin within 20 s, never leaves a 30 m corridor, no NaN, no steering reversal rate above the limit.
- Handover continuity: switch at 20 random laps times; assert |dPose|, |dv|, |d(steerAct)|, |d(ride state)| across the switch
  are below one-step physical limits.
- Projection: the four failure modes listed in section 3 plus a property test against brute force.
- Determinism: same seed + inputs -> identical hash of plant+ride state after 10 laps (same engine); no-allocation test extended to
  `Driver.step`/`project` (existing 64 KB heap-delta gate).

---------------------------------------------------------------------------------------------------------------------

## Recommendation for Suspension Lab

- Adopt architecture C: the autopilot is a `Driver` emitting `{steer, throttle, brake}` into the same planar plant that manual
  uses; the plant outputs `ax/ay` into the unchanged `ride.step`. Keep `stateAt(t)` as the pure reference and as the default
  idle/demo mode, so the shared server-time lap stays exactly as today.
- Skip pose blending between on-rails and dynamic states; hand over STATE (planar state, steering actuator, wheel phase, ax/ay
  low-pass), not poses. Ride state is already continuous.
- Steering law: Stanley (MIT, PythonRobotics) with softening `K_soft` and clamp, plus `atan(L*kappa)` feedforward; add an
  understeer-gradient term once the plant exists. Use pure pursuit only as a sanity baseline in tests.
- Optional upgrade: gain-scheduled LQR on `[e, e', psi_e, psi_e']` with K(v) solved offline (PythonRobotics DARE code, MIT);
  no runtime solver, no MPC.
- Speed: track `v_ref(s_proj)` from the existing profile with acceleration feedforward and PI; derate by cross-track/heading error
  and cap by the friction circle. Do not chase a cruise speed.
- Implement the 5-state recovery machine (TRACK, RECOVER, BRAKE, TURNAROUND, RESUME) with hysteresis; this is original work, no
  library provides it. Budget ~1 day plus the 500-state random test.
- Projection: warm-started Newton on `f(s) = (p - r)·t` with denominator `1 - kappa*d` clamped, windowed +-60 m fallback, full
  strided scan only on teleports. [T] 0 mismatches in 16,987 points, <= 4 iterations. Put it in `sim-core/path/project.ts`.
- Handover rules: apply on a fixed-step boundary; start steering/pedals from the handed-over value and slew (CARLA's +-0.1/step
  rule is the reference); set `previous = current` for interpolation; carry `axLP/ayLP`; keep wheel phase integrated.
- Reuse the existing `seek` pre-roll to initialise the plant: init at `stateAt(t - SEEK_SETTLE_S)` with the autopilot driving.
- Determinism: promise "same engine = same result" and "visually identical across devices" for auto laps; do not promise
  bit-identical cross-browser results unless transcendentals are replaced by own deterministic functions (decide when a
  manual-lap ghost feature is on the roadmap; the input-stream + keyframe format in 4.3 is ready for it).
- After Manual -> Auto the car runs on a detached lap clock; offer an explicit "rejoin live lap" (seek) rather than pretending to
  catch up. Label the cut.
- Licences: copy only from PythonRobotics (MIT) and CARLA agents (MIT) with notices in `CREDITS.md`; TUM stack and MAP are
  ideas only until their licences are verified (I could not confirm them).
- Risks: (1) the planar plant's fidelity decides whether "auto" lap on the plant matches the profile; if the plant is weaker than
  the profile's friction assumptions the autopilot will run wide, so derate profile speed in plant-auto mode by ~3-5% [E];
  (2) recovery in tight spots (barriers/off-road colliders) is untested territory; (3) `Math.*` cross-engine differences if
  ghosts are added; (4) numbers marked [E] (lookaheads, derate constants, slew time) need tuning with the real plant.
