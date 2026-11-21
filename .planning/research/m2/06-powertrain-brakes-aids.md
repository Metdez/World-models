# M2 research 06 — Powertrain, brakes, driver aids (keyboard, auto gearbox)

Scope: the simplest believable drivetrain / brake / aid stack for Manual Drive of the DB11-class GT and the Thruxton-class
cafe racer. Research only. Tags: **[S]** sourced (link), **[E]** estimate / derived by me (shown how).
Licence rule: only MIT / Apache-2.0 / BSD / ISC / CC0 / CC-BY code may be copied. Everything else = ideas only.

---------------------------------------------------------------------------------------------------------------------

## 1. Sources and licences (what we may copy)

| Repo / asset | Licence (SPDX) | Activity / size | Use |
|---|---|---|---|
| Jolt Physics `Jolt/Physics/Vehicle/*` (jrouwe/JoltPhysics) | **MIT** (file headers: `SPDX-License-Identifier: MIT`, (c) 2021/2023 Jorrit Rouwe) [S] | very active, ~9-10k stars [E, unverified] | COPY: auto-transmission state machine, clutch ramp, LSD ratio formula, motorcycle lean/steer-limit maths |
| Godot Jolt (godot-jolt/godot-jolt) | **MIT** [S] https://github.com/godot-jolt/godot-jolt | 2.6k stars, updated Mar 2026 [S]. Only wraps Jolt; no vehicle code of its own (vehicle constraints are a Godot proposal #15037, not merged) | nothing extra; read Jolt itself |
| **Godot-Easy-Vehicle-Physics (GEVP)** `DAShoe1/Godot-Easy-Vehicle-Physics`, `addons/gevp/scripts/vehicle.gd`, `wheel.gd` | **MIT** (c) 2024 David Shoemaker, portions (c) 2021 Dechode [S] https://github.com/DAShoe1/Godot-Easy-Vehicle-Physics | 41 commits [S]; README: "designed to play well on a keyboard" [S] | **Best find.** COPY (port GDScript to TS): steering rate/decay, countersteer assist, slip-limited steering, throttle/brake ramps, TCS, ABS pulse, yaw stability torque, auto-shift rule, brake bias, drag |
| ArcadeCarPhysics (SergeyMakeev), `Assets/Scripts/ArcadeCar.cs` | **MIT** (c) 2018 Sergey Makeev [S] https://github.com/SergeyMakeev/ArcadeCarPhysics | demo-grade, "not a final product" [S] | COPY: speed-curve steering limit / steer rate / return rate tables |
| Rapier `DynamicRayCastVehicleController` (dimforge/rapier, `src/control/ray_cast_vehicle_controller.rs`) | **Apache-2.0** (LICENSE header read) [S] | active | COPY idea+code: friction-circle clamp, `roll_influence`, `friction_slip` |
| cannon-es `RaycastVehicle` (pmndrs/cannon-es) | **MIT** (c) 2015 cannon.js authors [S] | maintained fork | TS reference of the same Bullet raycast-vehicle algorithm (not needed; we have no physics engine) |
| JRS Vehicle Physics Controller (Jermesa-Studio) | MIT, 222 stars [S] | small | not used; keyboard arcade only |
| Marco Monster "Car Physics for Games" (https://rsms.me/etc/car-physics, a mirror) | **no licence stated** -> ideas/equations only | classic tutorial | equations for drag/rolling resistance (below) |
| Edy's Vehicle Physics / VPP docs (EdyJ/vehicle-physics-docs, blog) | docs repo has **no licence**; VPP is commercial -> **ideas only** | active | concept: steering aids + TCS slip limit (20 m/s quoted in blog [S] https://www.edy.es/dev/2017/03/the-big-development-update-on-vehicle-physics-pro) |
| Unity WheelCollider docs/tutorials | Unity docs, proprietary text | - | concept only (slip curves: extremum/asymptote) |
| VDrift (GPL), Speed Dreams (GPL) | **GPL -> ideas only, do not copy** | - | VDrift's aids = ABS/TCS thresholds on slip; same shape as GEVP below, so no need to open it |
| Aston Martin owner's manual KY53-19A321-HA | public spec data, facts not copyrightable | - | published numbers (section 2) |

Caveat: I could not use the GitHub API (blocked) so star counts for Jolt/Rapier/ArcadeCar are not verified; licences were read from the raw LICENSE / SPDX headers.

---------------------------------------------------------------------------------------------------------------------

## 2. DB11 V12 published data (use these as the spec sheet)

| Item | Value | Source |
|---|---|---|
| Engine | 5,204 cc twin-turbo V12, 89.0 x 69.7 mm, CR 9.2:1, rev limit 7000 rpm | [S] owner's manual https://www.astonmartin.com/guides/KY53-19A321-HA.pdf |
| Power | 447 kW / 600 bhp @ 6500 rpm | [S] manual |
| Torque | 700 Nm (516 lb ft) @ **1600 rpm** per manual; dealer sheet says 2500-5000 rpm plateau; Wikipedia says 1500-5000 | [S] manual, https://www.astonmartinbellevue.com/db11, https://en.wikipedia.org/wiki/Aston_Martin_DB11 |
| Gearbox | ZF 8HP75 8-speed auto, ratios 1st 4.714, 2nd 3.143, 3rd 2.106, 4th 1.667, 5th 1.285, 6th 1.000, 7th 0.839, 8th 0.667, **Reverse 3.317** | [S] manual (ratios), Wikipedia (8HP75) |
| Final drive | 2.703:1 | [S] manual + dealer sheet |
| Diff | mechanical limited-slip differential (rear) | [S] Car and Driver spec page https://www.caranddriver.com/aston-martin/db11/specs/2017/aston-martin_db11_aston-martin-db11_2017 |
| Kerb weight (V12 coupe) | 1,875 kg (GVW 2,290 kg) | [S] manual |
| Weight distribution | 51 % front / 49 % rear (V12) | [S] https://www.astonmartin.com/en/our-world/news/2018/5/11/db11-amr---new-performance-flagship-of-the-db11-range |
| Wheelbase / L / W / H | 2,805 mm / 4,739 / 1,940 / 1,279 | [S] dealer sheet |
| Tyres | F 255/40 ZR20 on 9J, R 295/35 ZR20 on 11J (Bridgestone S007 fitted) | [S] Car and Driver |
| Brakes | F ventilated 2-piece steel disc 400 x 36 mm, 6-piston; R 360 x 32 mm, 4-piston | [S] dealer sheet |
| Steering | 13:1 ratio, 2.4 turns lock-to-lock (EPAS, speed dependent) | [S] dealer sheet |
| Electronic aids it really has | DSC, ABS, EBD, EBA, TC, HBA, PTC, DTV (torque vectoring), launch control | [S] dealer sheet |
| 0-60 mph / top | 3.6 s (Wikipedia) or 3.9 s (Business Insider) / 200 mph (322 km/h) | [S] |
| Cd, frontal area | **Not published in anything I could find** | - |

Derived [E]:
- Tyre rolling radius: 295/35 R20 -> sidewall 0.35*295 = 103 mm; D = 508 + 2*103 = 714 mm; **r_dyn ~ 0.357 m** (use 0.35 loaded).
- Overall ratio 1st = 4.714*2.703 = 12.74; 8th = 0.667*2.703 = 1.803. 7000 rpm in 1st = ~74 km/h; 8th at 322 km/h needs ~4,300 rpm, 7th ~5,400 rpm.
  So top speed is drag-limited in 7th/8th, not rev-limited.
- Drag: with Cd 0.32 x 2.2 m^2 = CdA 0.70 the car could not reach 322 km/h. Back-solve: wheel power ~0.92*447 kW = 411 kW, rolling ~21 kW at 89 m/s ->
  CdA = 390 kW / (0.5*1.225*89.4^3) = **~0.9 m^2 [E]**. Use **CdA ~0.8-0.9** (e.g. Cd 0.36 x A 2.3), label it "calibrated to published top speed".
- 1st-gear launch is traction-limited: wheel force at 700 Nm = 700*12.74/0.357 = 25 kN, but rear grip ~ mu*0.49*1875*9.81*(+transfer) ~ 10-11 kN. => throttle ramp + TCS in 1st is
  *needed*, not decoration (this is also how the real car hits 3.6 s).

### 2.1 Torque curve (normalised, [E] shaped through [S] points)
Constraints from [S]: 700 Nm flat from ~1600 to ~5000, 447 kW at 6500 => 657 Nm at 6500; limit 7000.
```
rpm      1000  1250  1600  2500  5000  5500  6000  6500  7000
T (Nm)    330   520   700   700   700   695   685   657   600
T/Tmax   0.47  0.74  1.00  1.00  1.00  0.99  0.98  0.94  0.86
```
Check: 5000 rpm -> 366 kW; 6000 -> 430 kW; 6500 -> 447 kW. Good. (Turbo lag omitted; if wanted, low-pass the throttle -> torque request with tau ~0.25 s below 2500 rpm.)
Engine friction/braking [E]: T_fric = 40 + 0.012*rpm Nm (~100 Nm at 5000 rpm), applied when throttle closed -> ~0.25 g of engine braking in 3rd, which feels right. (GEVP uses `motor_drag = 0.005` Nm/rpm — a much weaker default tuned for a 300 Nm engine [S, GEVP vehicle.gd L114].)
Engine inertia [E]: ~0.35 kg m^2 (GEVP default 0.5, Jolt default 0.5 [S]).

---------------------------------------------------------------------------------------------------------------------

## 3. Simplest believable powertrain (what to build)

Do NOT simulate a clutch with slip torque for the car. The 8HP75 is a torque-converter auto; the user never manages gears. Use a **kinematic lock-up drivetrain with a converter-ish smoothing**:

1. State: wheel speeds (or just driven-axle speed), gear index, engine rpm *derived* from wheel speed * ratio (locked) with a floor at idle.
2. Engine rpm = max(idle, omega_wheel * ratio_total * 60/2pi). Below ~1,300 rpm in 1st (launch) let rpm follow a first-order lag toward `max(idle, 1800 + 3000*throttle)` — a cheap "torque converter stall" so the car creeps and launches without a stall/clutch model. Converter multiplication: skip (the V12 curve already starts high).
3. Wheel torque = T_engine(rpm)*throttle_eff * ratio_total * eta(0.92) - drivetrain shift gating. During a shift (150-250 ms for ZF 8HP in Sport, [E]) cut torque to 0 and ramp back over ~150 ms (Jolt does exactly this, below).
4. Reverse: 3.317 [S] x 2.703; clamp throttle-to-torque in reverse to 0.5 and cap ~25 km/h so it stays calm.

### 3.1 Auto-shift logic — Jolt's (MIT) state machine, verbatim essentials
`Jolt/Physics/Vehicle/VehicleTransmission.cpp` (MIT, (c) 2021 Jorrit Rouwe):
```cpp
if (mCurrentGear == 0 || inForwardInput * float(mCurrentGear) < 0.0f)      // neutral or direction change
    mCurrentGear = inForwardInput > 0.0f ? 1 : (inForwardInput < 0.0f ? -1 : 0);
else if (mGearSwitchLatencyTimeLeft == 0.0f) {
    if (inCanShiftUp && inCurrentRPM > mShiftUpRPM) { /* gear++ (bounded) */ }
    else if (inCurrentRPM < mShiftDownRPM)          { /* gear-- (not below 1 while input != 0) */ }
}
if (old_gear != mCurrentGear) {
    mGearSwitchTimeLeft = old_gear != 0 ? mSwitchTime : 0.0f;   // torque cut
    mClutchReleaseTimeLeft = mClutchReleaseTime;                // ramp back
    mGearSwitchLatencyTimeLeft = mSwitchLatency;                // hysteresis lockout
    mClutchFriction = 0.0f;
} else if (mGearSwitchTimeLeft > 0) { /* count down, friction 0 */ }
else if (mClutchReleaseTimeLeft > 0) { /* friction = 1 - left/releaseTime */ }
else { mClutchFriction = 1.0f; /* count down latency */ }
```
Jolt defaults [S]: `mSwitchTime 0.5, mClutchReleaseTime 0.3, mSwitchLatency 0.5, mShiftUpRPM 4000, mShiftDownRPM 2000`; engine `mMaxTorque 500, mMinRPM 1000, mMaxRPM 6000, mInertia 0.5, mAngularDamping 0.2`; reverse `-2.90`.
Key trick: `inCanShiftUp = !wheelsSlipping && rpm >= oldRpm` (no upshift while driven wheels slip >0.1 or when rpm is falling after a jump) [S, WheeledVehicleController.cpp].
In our port: effective engine torque multiplied by `clutchFriction` during shifts (Jolt: `forward_input *= GetClutchFriction()`).

**Proposed DB11 values [E]** (faster than Jolt's — it is an 8-speed with 0.2 s shifts): `switchTime 0.18 s, releaseTime 0.15 s, latency 0.6 s`.
Use **throttle-dependent shift rpm** (a 3-point table beats Jolt's constants): upshift at ~2,200 rpm at 10 % throttle -> ~4,500 at 50 % -> ~6,400 at 100 %; downshift at max(1,300, upshift_rpm_of_gear-1 * 0.55) with kick-down (throttle > 90 % and rpm after downshift < 6,500). Keep GEVP's rule too: downshift when `rpm_in_previous_gear < 0.75*max_rpm`, upshift on *ideal* (no-slip) gear rpm, so a spinning tyre does not trigger an upshift [S, GEVP vehicle.gd `process_transmission`].
Stop/reverse logic (GEVP, MIT): when |gear| <= 1 and brake > 0.75 and (speed < 1 m/s or already moving backward) -> select reverse; the keyboard "S/Down" therefore brakes first then reverses; no R button needed. Jolt does it via the sign of `inForwardInput`.

### 3.2 Clutch simplification
- **Car:** none. A lock-up with the throttle gating above. Optionally apply GEVP's `need_clutch` idea: below idle+100 rpm disconnect (free-spin engine) so the car does not stall at standstill.
- **Bike:** a manual clutch would need the user to operate it -> hide it. Simulate an auto-clutch: clutch engagement = smoothstep((rpm - 1,800)/(2,800 - 1,800)) below 2,800 rpm; slip torque capped at 1.6 x T_max (GEVP: `max_clutch_torque_ratio 1.6`, `clutch_out_rpm 3000` [S]). Gear changes use the same cut-and-ramp (~120 ms).

### 3.3 Differential models (rear axle)
Open: `T_L = T_R = T/2`. Mechanical LSD (DB11 has one [S]) — **Jolt's formula (MIT), `VehicleDifferential.cpp`**:
```cpp
outLeft = 1 - split; outRight = split;   // split 0.5
if (mLimitedSlipRatio < FLT_MAX) {       // default 1.4 [S]
  omega_l = max(1e-3, |wl|); omega_r = max(1e-3, |wr|);
  alpha = min((omega_max/omega_min - 1) / (mLimitedSlipRatio - 1), 1);
  if (omega_l < omega_r) { outLeft = outLeft*(1-alpha) + alpha; outRight = outRight*(1-alpha); }
  else                   { outLeft = outLeft*(1-alpha);        outRight = outRight*(1-alpha) + alpha; }
}
```
Defaults [S]: `mDifferentialRatio 3.42`, `mLimitedSlipRatio 1.4`. For the DB11: ratio **2.703** [S], LSD ratio **1.4** [E] (reads as "all torque to the slower wheel at 40 % speed difference"). This is a speed-sensitive, torque-diverting LSD: cheap and stable. Preload/lock % is not published -> label "approximate". If the sim has no per-wheel spin DOF (likely: wheel loads come from the existing 7-DOF model), use a **torque split from slip estimates**: `shiftToSlowerWheel = clamp(0.35*|dSlip|/0.15, 0, 0.35)`.
GEVP also exposes `differential_lock_torque` and `torque_vectoring * steering_input` (DTV analogue) [S] — DB11's DTV is real [S] but skip: it is an aid the user cannot see.

---------------------------------------------------------------------------------------------------------------------

## 4. Resistances and brakes

**Drag + rolling (Marco Monster, no licence -> equations only):** `F_drag = 0.5 rho Cd A v^2`; Monster's C_drag = 0.5*Cd*A*rho = 0.4257 (Cd 0.30, A 2.2, rho 1.29) and rolling `C_rr ~ 30 * C_drag` as a *linear-in-v* term [S https://rsms.me/etc/car-physics]. Prefer the modern constant+speed form: `F_rr = Crr*m*g*(1 + v/ 160 m/s...)`, Crr = 0.012 for a 295/35 performance tyre [E] (~220 N at 1875 kg; 0.011-0.015 typical). GEVP does `0.5*1.225*v^2*A*Cd` with Cd 0.3, A 2.0 defaults [S, vehicle.gd L320-330, L634]. **DB11: rho 1.225, CdA 0.85 [E calibrated], Crr 0.012 [E]. Bike: Cd*A ~ 0.35*0.55 ~ 0.19-0.30 m^2 with rider [E] (upright cafe racer, large Cd) — calibrate to 135 mph [S MCN] top speed at 77 kW.**
Engine braking: see 2.1. Bike: friction torque 12 + 0.004*rpm Nm [E] (large 270-deg twin = strong engine braking; ~0.2 g in 3rd).

**Brake sizing [E] from published rotors [S]:** peak decel 1.1 g on S007 -> F = 20.2 kN; at r 0.357 m = 7.2 kNm total. With h_cg ~0.5 m [E], L 2.805, ideal front share at 1 g = 0.51 + 1.0*0.5/2.805 = **0.69 (69 %)**. Use fixed front bias **0.66-0.70** (the real car runs EBD, [S] list). GEVP's default: front bias auto-derived from axle spring force ratio (= weight distribution, 51 %) and `braking_grip_multiplier 1.5` [S]; its static 51 % is too rearward for hard stops -> use ours. Brake torque per wheel at full pedal: front 2 x 2.5 kNm, rear 2 x 1.1 kNm (bounded by tyre; the surplus is what ABS eliminates).
Simplest honest brake model: **brake demand in g** (pedal 0..1 -> 0..1.15 g), distributed 68/32 by bias, each axle's force limited by tyre grip, with ABS slip limiting on top (below). Disc thermal/fade: skip.

**Bike brakes [S]:** front 2 x 310 mm Brembo floating, M50 4-piston radial monobloc; rear 220 mm single, Nissin 2-piston; ABS (Triumph media kit https://triumph-mediakits.com/en/news-articles/all-new-2020-thruxton-rs.html). Bike braking is wheelie/stoppie-limited, not grip-limited: front share ~85-100 % [E]; cap decel so the rear never unloads: `a_max = g * (L - x_cg_rear... )`: stoppie limit = g * b/h with b = rear-axle-to-CG ~0.70 m, h ~0.60 m -> ~1.15 g [E]; cap ~1.0 g. Combined brake: key S sends 70/30 front/rear [E].

---------------------------------------------------------------------------------------------------------------------

## 5. Driver aids, implemented simply and honestly

All aids should be **toggleable and on by default (Assisted)**, with an honest label: "Assist: simplified model, not the DB11's real DSC calibration". Thresholds below are quoted from permissively licensed code.

### 5.1 ABS — GEVP's pulse method (MIT, `wheel.gd`)
```gdscript
@export var front_abs_pulse_time := 0.03   # s of brake release
@export var front_abs_spin_difference_threshold := 12.0   # (spin_velocity_diff compared negative)
# wheel.gd process_torque():
if abs_enable_time > vehicle.delta_time: brake_torque = 0.0; allow_abs = false
if absf(spin) > 5.0 and spin_velocity_diff < abs_spin_difference_threshold:
    if allow_abs and brake_torque > 0.0:
        brake_torque = 0.0
        abs_enable_time = vehicle.delta_time + abs_pulse_time
```
i.e. if the wheel's surface speed lags ground speed by more than a threshold, release brake pressure for 30 ms, repeat. Our port: per-axle **slip-ratio ABS**: if `kappa < -0.14` (target peak ~ -0.10 to -0.15 for road tyres [E]) -> brake_torque *= 0.0 for 30 ms (or smooth: `p = clamp(1 - (|kappa|-0.12)/0.06, 0, 1)`). Disabled when handbrake. Needed because our long-slip is not a physical wheel DOF unless we add per-wheel spin; **with a quasi-static grip model ABS reduces to `Fx = min(Fx_demand, mu*Fz*0.95)`** — honest and cheap. The DB11 really has ABS+EBD+HBA [S].
Jolt has **no ABS** (locks wheels: `brake_torque_to_lock_wheels = |omega| I/dt`, then `SetAngularVelocity(0)`), so it is useful only as the lock-up condition [S].

### 5.2 Traction control — GEVP's slip cut (MIT, `vehicle.gd` process_clutch)
```gdscript
@export var traction_control_max_slip := 8.0   # m/s of tyre slip speed, "values below 0 disable"
if traction_control_max_slip > 0.0:
    slip_y = max over axles of get_max_wheel_slip_y()
    if slip_y > traction_control_max_slip: tcs_torque_reduction = torque_output; clutch_torque = 0.0; tcs_active = true
```
Brutal on/off torque cut when longitudinal slip speed > 8 m/s. Edy's blog quotes **20 m/s** for a drift setup [S]. Smoother for us [E]: `scale = clamp(1 - (slipSpeed - 1.5)/(4.0 - 1.5), 0.15, 1)` on engine torque, low-passed (tau 60 ms). Real DB11 has TC [S]; ours is a simplification.

### 5.3 Stability control (yaw based) — GEVP's yaw-correction (MIT)
```gdscript
yaw_angle := 1.0 - abs(plane_xz.dot(Vector2.UP))           # 0 straight .. 1 at 90deg
if yaw_angle > engage and sign(angular_velocity.y) == sign(plane_xz.x):
    stability_yaw_torque = (yaw_angle - engage) * stability_yaw_strength(6.0)
    stability_yaw_torque *= vehicle_inertia.y * clamp(abs(angular_velocity.y) - 0.5, 0, 1)
    stability_yaw_torque *= stability_yaw_ground_multiplier(2.0)
apply_torque(up * stability_yaw_torque * sign(-local_velocity.x))
```
It applies a *corrective yaw torque directly to the body* (not selective braking). Honest, simple, and deterministic. Our version [E] — the standard ESC logic: `r_target = v_x * delta / (L + K_us*v_x^2)` (bicycle model, clamped to `mu*g/v_x`); `e = r_measured - r_target`; if `|e| > 0.12 rad/s` or |beta| > 4-5 deg -> yaw moment `M = Iz * Kp * e`, `Kp ~ 4-6 1/s` clamped to a max, delivered as (a) throttle cut and (b) brake torque on the outer front wheel (understeer->inner rear), converted to equivalent yaw moment `M = F_brake * track/2`. Do not call it ESP/DSC; call it "Stability assist". Real = DSC [S].

### 5.4 Keyboard helpers (the part that actually makes a keyboard playable)

**a) Speed-sensitive steering limit + rate — ArcadeCarPhysics (MIT) curves:**
```csharp
steerAngleLimit    = Linear(0 km/h -> 35 deg,  100 km/h -> 5 deg)       // max wheel angle
steeringSpeed      = Linear(0 km/h -> 2.0, 100 km/h -> 0.5)            // deg per physics tick
steeringResetSpeed = EaseInOut(0 -> 30 deg/s, 100 km/h -> 10 deg/s)    // return to centre when no key
// ramp: angle += h*steeringSpeed(speed); angle = min(|angle|, steerAngleLimit(speed))*sign
```
(Note the unit is per FixedUpdate tick; 50 Hz Unity default => 100 deg/s at standstill.)
**b) Rate + speed decay + exponent — GEVP (MIT):**
```gdscript
steering_speed = 4.25        # input units/s (input in -1..1)
countersteer_speed = 11.0    # when input opposes current steer (returning/reversing)
steering_speed_decay = 0.20  # steer rate /= (speed * 0.20)  -> slower at speed
steering_exponent = 1.5      # |s|^1.5 -> soft near centre, fine control
max_steering_angle = 40 deg
steer_speed_correction = steering_speed / (speed * steering_speed_decay) / max_steering_angle   # (as written; no floor at low speed -> clamp speed to >= 3 m/s in our port)
```
**c) Steer toward slip-angle-limited maximum — GEVP `steering_slip_assist = 0.15`:** if the front axle's lateral slip `slip_vector.x` exceeds 0.15, further steering in that direction is *rejected* and the wheel is backed off toward zero (`steer_assist_engaged`). Our equivalent [E]: `delta_max(v) = alpha_peak + (L*r... )` simply `delta_max = atan(a_y_max*L/v^2) + alpha_peak` (kinematic angle for the grip-limited lateral accel + the front peak slip angle ~6-8 deg for a road tyre [E]); this is the right "limit" for a 1.4-1.6 s keyboard ramp: at 100 km/h, a_y 1.0 g => delta_kin = atan(9.81*2.805/27.8^2) = 2.0 deg, +7 deg => ~9 deg; at 200 km/h ~5 deg. Compare ArcadeCar's 5 deg @100 km/h [S]: same order.
**d) Countersteer assist — GEVP:**
```gdscript
steer_correction = (1 - |steering_adjust|) * clamp(asin(local_velocity.normalized().x), -max_steer, max_steer) * countersteer_assist(0.9)
# local_velocity.z > -0.5 (slow/reversing) -> correction = 0 ; blended in/out at steering_speed
wheel.steer(steering_adjust + steer_correction)
```
=> steers the wheels toward the direction of travel (velocity-vector angle = sideslip beta) with weight (1-|input|): the driver's authority shrinks the assist to zero at full lock. Cheap and effective at stopping spins. Our version: `delta_cs = -k * beta_at_front`, k 0.6-0.9, fade out below 5 m/s [E].
**e) Throttle/brake ramping — GEVP:** `throttle_speed = 20/s` (nearly instant), `braking_speed = 10/s`, `throttle_steering_adjust = 0.1` (ramp slows with steering), plus clamp throttle to 0 on redline/shift [S]. For a 1.9-t GT use **throttle 4-6 /s**, brake **3-5 /s up, 10 /s down** [E] (keyboard = on/off; ramp makes it analog). Hold-W "progressive" mapping: 0.35 -> 1.0 over 0.7 s [E] is gentler for launch.
**f) Auto-reverse and creep:** see 3.1.

### 5.5 Bike rider assist (Jolt motorcycle controller, MIT, `MotorcycleController.cpp`)
Quote [S]:
```cpp
// LeanAngle = Atan(v^2 / (g * TurnRadius));  TurnRadius = WheelBase / (Sin(SteerAngle) * Cos(CasterAngle))
// => SteerAngle = ASin(WheelBase * Tan(LeanAngle) * g / (v^2 * Cos(CasterAngle)))
max_steer_angle_factor = wheel_base * Tan(mMaxLeanAngle) * g;
mMaxLeanAngle = 45 deg; mLeanSpringConstant = 5000; mLeanSpringDamping = 1000;
mLeanSpringIntegrationCoefficient = 0; ...Decay = 4; mLeanSmoothingFactor = 0.8;
```
i.e. steering limited by the max lean angle at the current speed; lean is a PD spring toward the target "up" vector formed from lateral accel + gravity. This is exactly the right abstraction: **the bike has no steer-angle input; it has a lean-angle target** = `atan(v*r/g)`; keyboard A/D -> desired lateral accel/curvature, with the same speed-sensitive limit. Cafe-racer max lean ~ 48-50 deg road tyre [E]; cap 45 deg like Jolt.

---------------------------------------------------------------------------------------------------------------------

## 6. Thruxton (bike) published data

| Item | Value | Source |
|---|---|---|
| Engine | 1200 cc liquid-cooled SOHC 270-deg parallel twin, 97.6 x 80 mm | [S] https://triumph-mediakits.com/en/news-articles/all-new-2020-thruxton-rs.html |
| Power / torque (RS) | 105 PS / 77 kW @ 7,500 rpm; 112 Nm @ 4,250 rpm (R: 96 bhp, 83 lb ft, 700 rpm higher peak) | [S] media kit; MCN https://www.motorcyclenews.com/bike-reviews/triumph/thruxton-1200/2016 |
| Redline | RS "500 rpm higher than R" (value not stated; I use 8,000) | [S] Triumph engine page / [E] number |
| Gearbox / final | 6-speed, wet multi-plate assist clutch, O-ring chain | [S] media kit |
| Gear ratios | **not found**; use overall ratio calibrated so 6th @ 7,000 rpm ~ 200 km/h (-> overall ~4.4 using r_rear 0.312 m) and 1st ~ 2.7x higher | [E] |
| Dry weight | 197 kg; tank 14.5 L; wet+rider ~ 197 + 11 (fuel) + 4 (fluids) + 80 [E] | [S]/[E] |
| Geometry | wheelbase 1,415 mm, rake 22.8 deg, trail 92 mm, seat 810 mm | [S] |
| Tyres | F 120/70 ZR17 (3.5"), R 160/60 ZR17 (5") | [S] |
| Brakes | F 2 x 310 Brembo M50 4-piston radial, R 220 Nissin 2-piston, ABS | [S] |
| Suspension | Showa 43 mm USD 120 mm; Ohlins twin shocks 120 mm | [S] |
| Top speed | 135 mph (R) | [S] MCN |
Bike torque curve [E] (peak 112 Nm @ 4,250; 98 Nm at 7,500 from 77 kW; flat-ish 270-deg twin):
```
rpm   1500 2500 3500 4250 5500 6500 7500 8000
T Nm    78   96  108  112  108  102   98   88
```
Bike aids: ABS (rear lock prevention = cap rear brake torque; front: cap decel at stoppie limit); no stability control for the user; lean-target steering assist (5.5); traction control = throttle cut when rear slip > 0.15 [E] (it is a "torque assist" clutch bike, TC on RS is real [S] "torque assist" mention in video summary).

---------------------------------------------------------------------------------------------------------------------

## 7. Rapier / cannon-es notes (why we do NOT adopt raycast vehicles)
Rapier (Apache-2.0) tuning defaults [S]: `suspension_stiffness 5.88, compression 0.83, damping 0.88, max_suspension_travel 5.0, friction_slip 10.5, max_suspension_force 6000, side_friction_stiffness 1.0`. Its tyre model is the Bullet friction-circle clamp: `max_imp = suspension_force*dt*friction_slip`; if `|(fwd, side)| > max_imp` scale both by `max_imp/|..|` (a combined-slip clamp — the cheapest correct way to couple braking, throttle and cornering), plus `roll_influence` moving the lateral-impulse application point toward the roll axis. Both are rigid-body engines, we have none; **steal only the friction-circle clamp and roll_influence idea** (and our per-suspension kinematics already provides a real roll axis).

---------------------------------------------------------------------------------------------------------------------

## Recommendation for Suspension Lab

1. **Port GEVP (MIT) steering, throttle and brake logic to TS in `sim-core/driver-input`**: steering rate 4.25/s with speed decay 0.20, countersteer rate 11/s, exponent 1.5; add ArcadeCar's speed->limit table for a sanity cap. Keep attribution comments (MIT (c) 2024 David Shoemaker / (c) 2021 Dechode; MIT (c) 2018 Sergey Makeev).
2. **Port Jolt's transmission state machine + LSD formula (MIT, (c) Jorrit Rouwe)** with DB11 ratios [S] 4.714...0.667, R 3.317, final 2.703, shift 0.18 s, throttle-dependent shift rpm, no upshift while wheels slip; keep the licence header in the ported file.
3. No clutch model for the car; no stall; "torque-converter" = rpm floor + lag in 1st. Bike: auto-clutch smoothstep 1,800-2,800 rpm.
4. Torque curves as tabulated (sections 2.1 and 6) — all tagged "approximate, shaped through the published peak power/torque points" in the UI.
5. Calibrate CdA to the **published top speed** (0.85 m^2 [E]) instead of guessing Cd (DB11 Cd is unpublished); Crr 0.012.
6. Brake model: pedal -> demand in g, fixed 68/32 front bias (ideal 69 % at 1 g, derived), per-axle grip clamp (friction-circle) + ABS pulse/slip limiter (GEVP: 30 ms release); bike: stoppie-limited, 70/30 split.
7. TCS = smooth throttle scale on slip speed (GEVP uses a hard cut at 8 m/s). Keep ON by default: 1st-gear force (25 kN) is 2.5x available traction, so launching a V12 on keys without TCS = burnouts.
8. Stability assist = yaw-rate error (bicycle-model target) -> yaw moment + brake on outer front; port GEVP's direct yaw torque as the first, simplest version.
9. Aids named "Assist: ABS / Traction / Stability / Steering" with a visible lamp when active (GEVP exposes `tcs_active`, `stability_active`); never branded as DSC. A tooltip: "simplified model, real DB11 has DSC/DTV/EBD".
10. Bike steering by lean target (Jolt formula: steer angle limited by `wheel_base*tan(maxLean)*g / v^2`), maxLean 45 deg, PD lean spring (k 5000, c 1000 scaled by inertia), keyboard => curvature request.
11. Reverse: auto from "brake when stopped", 3.317 ratio, cap 25 km/h, throttle 50 %.
12. Risk: Jolt/GEVP assume per-wheel spin DOFs. Our model is quasi-static per-wheel load from the 7-DOF layer; implement wheel spin only for the *driven axle + brake slip* (2 scalar states) or use the kappa-from-demand shortcut; this keeps determinism and the 240 Hz budget.
13. Risk: Edy's docs / VDrift / Speed Dreams are not copyable; I only used ideas that also appear in MIT code (aid shapes), so provenance stays clean.
14. Risk: unpublished data (Cd, CG height, bike gear ratios, DB11 DSC logic) are [E]; show them as "approximate" in the data panel, as per the brief's honesty rule.
15. Skip: turbo lag model, thermals/fade, DTV, launch control, clutch kicks, wheelies (unless the bike scene wants one), Pacejka (only needed if per-wheel combined slip is added later — use friction circle first).
