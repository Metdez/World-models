# M2 research 10 — Is user-ridable motorcycle dynamics feasible in Suspension Lab?

Scope: manual-ride a motorcycle (cafe-racer) in the browser sim, alongside the car. Research only. Tags: [S] sourced (link), [E] estimate / derived by me.
Tool note: Firecrawl was returning 503 during this run; all evidence below came from Tavily + WebFetch. GitHub API was blocked (403), so stars/last-push are approximate or unknown where stated. Licences were read from LICENSE files / READMEs.

## 1. Short answer

- Feasible, but it is a different problem from the car. A car is statically stable; a single-track vehicle is an unstable inverted pendulum that needs a controller (the rider) at nearly all speeds. [S Cossalter excerpt, below]
- The only robust approach used by games and educational sims is: the user commands a LEAN / TURN target, and an internal rider controller produces the steer/torque (and visual countersteer) needed to realise it. Direct user steer-torque control is essentially unplayable on keyboard and is only used by research simulators with a human-in-the-loop haptic setup. [E, supported by Kooijman 2013 review of rider-control models]
- A faithful "Whipple/Sharp" multibody motorcycle with tyre-relaxation and suspension is a research project (weeks, high tuning risk). A reduced model (roll DOF + kinematic steer + camber-thrust tyre + pitch/heave from the existing 7-DOF) is 1-2 weeks and gives all the educational phenomena we care about (fork dive, anti-squat, lean, trail braking, wheelie/stoppie limit).
- Recommendation: ship car-only manual in v1; build bike manual as a v1.5 "lean-target + auto-balance" module behind the same `VehicleController` interface; do not attempt direct steer-torque.

## 2. How games/sims control lean (three patterns)

| Pattern | What the player commands | Who balances | Used by | Verdict for us |
|---|---|---|---|---|
| A. Lean/roll target + inner controller | desired lean angle (or turn rate -> lean via v^2/gR) | internal PD on roll via steer torque/angle | Kright Unity demo, ssebs Godot, MotoGP-style arcade, avnath13 "lean slider" | Adopt |
| B. Direct steer angle, auto-balance bolted on | front steer angle | hidden stabiliser (gyro/artificial roll torque) | many arcade Godot/Unity bikes | Fallback only; feels wrong (no countersteer) |
| C. Direct handlebar torque | steer torque | human | research simulators, TU Delft rider-control studies | Skip |

Real-rider fact that justifies A: "the primary control input on bikes is steering torque, not position" and countersteer produces the lean. [S https://en.wikipedia.org/wiki/Bicycle_and_motorcycle_dynamics] Berkeley's AJP paper shows required handlebar torques are tiny (<~1 N at 0.5 m grip spacing) and that you never torque in the direction of the turn until the end. [S https://physics.berkeley.edu/sites/default/files/bulk_3/SteerBikeAJP.PDF] So a player cannot feel this; a controller must do it.

Published rider-controller structures we can copy (physics, not code):
- Roll-tracking steer torque, PD form: `tau_s(t) = k0*phi_ddot + k1*phi_dot + k2*e_phi` with set-point roll = instantaneous steady-turn equilibrium roll. [S Ferretti et al., MATHMOD 2006, https://www.argesim.org/fileadmin/user_upload_argesim/ARGESIM_Publications_OA/MATHMOD_Publications_OA/MATHMOD_2006_AR30/Sessions/SP3/253_P_Gianni_Ferretti.pdf]
- Dual-PID: outer loop lean error -> target front-wheel steer angle, inner loop steer error -> handlebar torque; BikeSim phantom-sim gains `kp1=20, ki1=10, kd1=1; kp2=0.1, ki2=0.1, kd2=0`, 72 km/h, max roll <15 deg, lateral dev <0.6 m. [S https://www.mdpi.com/2571-5577/7/6/115]
- Roll target from path preview: `phi_target = K1 + K2 + K3` (offset, lateral velocity, heading error terms). [S https://pmc.ncbi.nlm.nih.gov/articles/PMC8512544]
- Same structure in TUM FTM's multibody code: "PD controller ... reach a specified roll angle ... applies a steer moment" plus a PID longitudinal controller. [S https://github.com/TUMFTM/motorcycle_model] (LGPL-3.0, ideas only)
- Review of rider-control models (LQR with preview, Weir/Roland/Sharp, double-pendulum rider, steer + body-lean coupling): [S http://bicycle.tudelft.nl/schwab/Publications/kooijman2013review.pdf]

Steady-state lean to command from a turn request (for the player's "steer" key mapping to a curvature):
`phi = atan(v^2 / (R g))` [S https://ridelink.com/en/blog/motorcycle-lean-angle-guide ; table: 50 km/h,50 m -> ~21 deg; 80 km/h,100 m -> ~27 deg; 100 km/h,100 m -> ~38 deg]. mu=1 gives 45 deg ceiling for a simple friction model. [S same page]

## 3. Open-source implementations found (licence-checked)

| Repo | What | Licence | Stars / activity | Use |
|---|---|---|---|---|
| avnath13/motorcycle-forces-simulator https://github.com/avnath13/motorcycle-forces-simulator | React19+TS+Vite educational moto sim: 6-speed box, clutch friction zone, lean+countersteer, weight transfer, traction circle, wheelie/stoppie/slide, UK Mod-1 pad, Assist mode. Custom rAF engine, no game lib. Single commit 13 Jun 2026 | NO licence file found (LICENSE 404; package.json private) -> all rights reserved | few/unknown; very new | Ideas only. Closest prior art to our product; copy NOTHING. Its README says "deliberately simplified... not engineering accuracy" -- same honesty stance we need. |
| Kright/MotorcyclePhysics https://github.com/Kright/MotorcyclePhysics | Unity WheelCollider bike; countersteers, self-balances from steering alone at 5-30 m/s; speeds up at low speed to avoid falling; wobble at high speed fixed with "hacks" raising critical speed 30 -> 40-50 m/s; physics step 0.005 s | No licence file in repo listing (README, Assets, ProjectSettings only) -> treat as all rights reserved | small; old | Ideas only (code reproduced below as a description) |
| ssebs/moto-player-controller-godot https://github.com/ssebs/moto-player-controller-godot | Godot 4 moto controller from "Dank Nooner": cumulative throttle/brake input, steer causes lean, wheelie balance point angle, stoppie when `pitch_angle < -5 deg`, tricks | AGPL-3.0 (LICENSE read) | small; active | AGPL: ideas only. Do not copy or link. |
| alvariusgames/bearcycle https://github.com/alvariusgames/bearcycle | Godot 3 C# "basic motorbike physics" from a Steam game | MIT (LICENSE.md, README states MIT) | small; stale | Copyable, but a 2D platformer bike; no lean/countersteer model -> little value. |
| JustInvoke/Randomation-Vehicle-Physics https://github.com/JustInvoke/Randomation-Vehicle-Physics | Unity car/vehicle system; author states motorbike physics are NOT implemented ("I've had trouble making them work") | MIT | ~938 stars | Evidence that even a mature vehicle-physics author gave up on bikes. |
| TUMFTM/motorcycle_model https://github.com/TUMFTM/motorcycle_model | MBSim multibody moto (Sharp/Evangelou/Limebeer 2004 params), PD roll controller, PID speed controller, DOF enable switches | LGPL-3.0 | ~20 stars | Ideas only. |
| xmoto/xmoto | 2D motocross, bike is rotated not leaned | GPL | - | Irrelevant. |
| Three.js/JS | No maintained "three.js motorcycle lean physics" repo found. JS physics options: cannon-es (MIT), Rapier (Apache-2.0). None has bike-specific constraints. [S threejsresources/threejs forum pages] | - | - | Confirms we would write the reduced model ourselves in `sim-core`. |

Not independently verified [E]: Jan Moore's `BicycleParameters` / `dtk` Python packages implement the Whipple benchmark (BSD-style licence, unverified); useful as a numerical cross-check for a unit test, not a runtime dependency.

### Code that was actually readable (Kright, no licence -> description, not for copy)
Quoted structure of `MotoController.motoControl` (from raw file, markdown mangled `*`): lean angle `angle = dot(moveForward, cross(up, worldUp))`, `omega = (angle - prevAngle)/dt`; below `lowSpeed = 8` the steer/omega terms are scaled by `t = speed/lowSpeed` squared, `angle *= (2 - t)` and throttle is added `|angle| * 3 * (1 - t)` (the "engine keeps it upright" low-speed trick); above `highSpeed = 25` the `omega` term is damped by `t` when `omega*angle < 0`; final `steer = 1/(speed^2 + 1) * (steer_in*steerSensivity + angle*controlAngle + omega*controlOmega)`, rate-limited to `10*dt` per step; gains `steerSensivity=30, controlAngle=25, controlOmega=30, maxSteerAngle=45 deg`. [S https://raw.githubusercontent.com/Kright/MotorcyclePhysics/master/Assets/MotoController.cs]
Lesson: a speed-scheduled PD on (roll, roll-rate) is the whole trick, plus a rate limiter; the 1/(v^2+1) gain schedule is what keeps it stable. Reimplement from first principles in our own code.

### What avnath13 shows (ideas)
Same product shape as ours but 2D SVG: lean slider, Assist mode toggle, traction circle, wheelie/stoppie/slide states. Helper formulas in `src/lib/physics.ts` are trivial and standard (we can write our own): `weightTransfer = m*a*h/L`; `leanAngle = atan(v^2/(g R))`; `maxCornerSpeed = sqrt(mu g R)`; `stoppingDistance = v^2/(2 decel)`. [S raw physics.ts via WebFetch] Note the engine proper is in `src/sim` (not read).

## 4. Physics reference models (what to take from each)

### 4.1 Whipple / Carvallo benchmark bicycle (Meijaard, Papadopoulos, Ruina, Schwab 2007, Proc. R. Soc. A 463:1955)
Linearised lateral dynamics, states roll phi and steer delta:
`M q'' + v C1 q' + (g K0 + v^2 K2) q = T`, q=[phi, delta]. [S http://ruina.tam.cornell.edu/research/topics/bicycle_mechanics/BicyclePaper1Andyv20.pdf]
Benchmark numbers [S same PDF, section 6]:
- M = [[80.81722, 2.31941332], [2.31941332, 0.29784188]]
- K0 (x g) = [[-80.95, -2.59951685], [-2.59951685, -0.80329488]]
- K2 (x v^2) = [[0, 76.5973459], [0, 2.65431524]]
- C1 (x v) = [[0, 33.8664139], [-0.85035641, 1.68540397]]
- Params: wheelbase 1.02 m, trail 0.08 m, head angle 72 deg (lambda=pi/10), rear wheel r=0.3 m m=2 kg, frame m=85 kg COM (0.3, -0.9) m, handlebar m=4 kg.
- Stability: weave speed vw = 4.2924 m/s, capsize speed vc = 6.0243 m/s, double-root vd = 0.6843 m/s; stable only for vw < v < vc. [S same PDF]
Use: this 2x2 system is directly implementable (~40 lines) and is a perfect unit-test oracle for any roll/steer model we build (eigenvalue crossings must land at 4.29 and 6.02 m/s). Equations are published science, free to implement; paper itself is not to be redistributed.
Limitation: bicycle, rigid tyres (no sideslip, no camber thrust); does not represent a motorcycle's wide tyres or wobble.

### 4.2 Sharp 1971 and the motorcycle modes
Sharp, "The stability and control of motorcycles", J. Mech. Eng. Sci. 13(5) 316-329. Findings: steering damper is tailored to damp wobble; with shallow head angle more trail is needed or capsize becomes too severe; moving the rear-frame COM forward needs more steer damping but improves weave damping; reducing front wheel gyro lowers needed steer damping; tyre relaxation length changes weave damping at high speed. [S https://commons.princeton.edu/63-3-tiger-cub/wp-content/uploads/sites/263/2021/03/stability-of-motorcycles.pdf]

### 4.3 Cossalter, "Motorcycle Dynamics" (2nd ed.) mode summary
- Example machine: unstable below 0.6 m/s (body capsize time constant 0.30 s at 0.1 m/s, steering capsize 0.17 s); the two coalesce into weave at 0.6 m/s; weave frequency rises 0 -> 0.4 Hz at 7 m/s -> ~3 Hz at 40 m/s; weave is stable but poorly damped >28 m/s; wobble 7-8 Hz, unstable above 22 m/s; capsize stable throughout. [S https://catalogimages.wiley.com/images/db/pdf/9781119950189.excerpt.pdf]
- Weave 0-3(4) Hz whole-bike; wobble 6-10 Hz front assembly; rear wobble/weave-2. [S same]
- Steering damper values: 7.0 vs 0.9 N m s/rad root loci in a wobble study; undamped wobble damping ratio -> 0 with speed. [S https://www.mdpi.com/2075-1702/8/2/24]

### 4.4 Inverted-pendulum-on-single-track (what a reduced model should be)
2-D inverted pendulum on a turntable predicts the steady turn is unstable; need steering to restore it. [S Wikipedia bicycle dynamics page above] Reduced model we would use [E]:
`I_roll * phi_dd = m g h sin(phi) - m h v^2 kappa cos(phi) + tau_rider + tau_gyro`
with kappa = curvature (from the rider's steer), rider torque = PD toward phi_target. This is exactly the Kright/Ferretti structure without simulating the steering head, and it suffices to reproduce: required lean = atan(v^2 kappa / g), initial countersteer (visual only), and tipping when too slow.

## 5. Capsize / weave / wobble and how sims suppress them

- Capsize: slow, real eigenvalue; the rider/controller handles it. For us, the controller's gains cover it.
- Weave: low-frequency 0-4 Hz oscillation; unstable at low speed (< ~6-7 m/s) and poorly damped at high speed. Games hide it by (a) not simulating steering head dynamics at all, or (b) heavy gain scheduling like Kright's `1/(v^2+1)`.
- Wobble: 6-10 Hz steer-axis oscillation; needs steering damper, tyre relaxation and a stiff-enough time step. Kright found wobble at high speed and "increased critical speed from 30 to 40-50 m/s with hacks" and ran physics at 0.005 s (200 Hz). [S README] Our 240 Hz ride loop is similar, but a 7-8 Hz mode with semi-implicit Euler at 240 Hz is marginal.
- For Suspension Lab: do NOT model the steering head as a DOF in v1. Steering angle is a derived visual quantity. That removes wobble and weave-2 entirely, and no one will miss them. If an educator wants to demo wobble, show it as a pre-computed stability map from the Meijaard/Cossalter eigenvalue table, not a live sim.
- Tyre relaxation length filter on side force (first-order, L_rel ~ 0.1-0.3 m, i.e. `tau = L_rel / v`) is the cheapest way to avoid numerical chatter at low speed. [E; Sharp 1971 notes relaxation length affects weave damping]

## 6. Low-speed stabilisation and stops (feet-down fudge)

What real sims do:
- Below ~8 m/s Kright's bike "uses engine to speed up and avoid falling" (throttle added proportional to lean error). [S README + code]
- Educational sim avnath13 ships an Assist mode (auto-clutch, no stall) and a "slow ride" Mod-1 test; fall/tip is a modelled state. [S README]
Proposal [E]:
- Below `v_foot ~ 1.5-2 m/s` blend the rider's roll controller to a "feet-down" virtual outrigger: add a restoring roll torque `-k_foot * phi` with k_foot ramping to full at v=0 and cap |phi| <= 8 deg. Show a small UI chip "Feet down" (honesty: it is a rider action, not physics of the bike).
- Between v_foot and ~5 m/s the roll controller gain is scheduled up (bike is body-capsize unstable, time constant 0.3 s [S Cossalter]) so a keyboard user can still ride.
- At v=0 with brake held: bike becomes static, free to be put in "stopped, upright" state; reverse is not offered for bikes (walk-back is a rider action).
- Tip-over if |phi| exceeds friction limit while sliding (avnath13 models "slide"); for educational use prefer a soft "recovered" reset to avoid frustration at a live event. [E]

## 7. Wheelie / stoppie limits (the fork-dive / anti-squat showcase)

Rigid-body limits (point mass COM height h, wheelbase L, COM distance b behind the front axle... define a = COM distance ahead of rear contact, b = L - a): [E, standard statics]
- Wheelie (front load -> 0): `a_x,wheelie = g * a / h`
- Stoppie (rear load -> 0): `a_x,stoppie = g * (L - a) / h` (negative accel)
- Tyre friction limit: `a_x,grip = mu * g` (front-only braking uses `mu*g*...` with dynamic load).
Example cafe-racer with rider h=0.62 m, L=1.40 m, a=0.70 m -> 1.13 g both ways, i.e. higher than a street tyre's mu~1.0, so stoppie is only reached with the front brake alone at mu >= ~1.1 and wheelies require power/low gear. [E numbers, check against real DB CAD]
Note the real tyre mu on dry asphalt for sporty street tyres ~1.0-1.2 [E]. Both bounds are exposed by avnath13's wheelie/stoppie/slide indicators and by ssebs's `pitch_angle < -5 deg` stoppie trigger (AGPL, ideas only). [S READMEs]
Why this matters for us: our existing 7-DOF ride model already has pitch and heave with suspension kinematics; fork dive and anti-squat/anti-dive geometry are the educational payload of the bike. Manual drive makes them visible in real time. Show "Front unloading X%" gauge; clamp pitch beyond the wheelie/stoppie condition (front/rear tyre loses contact) and display "Front wheel light". No need to simulate flips.

## 8. Cornering, camber thrust, trail braking

- Cornering force on a leaned motorcycle tyre is dominated by camber thrust (approx. `F_y ~ C_gamma * gamma + C_alpha * alpha`, with C_gamma ~ 0.9-1.1 C_alpha order for a car-width-ish carcass, more for the round motorcycle crown) [E; Cossalter ch. on tyres, not re-read]. Slip angle needed is small; a reduced model with `F_y = mu * F_z * sin(C * atan(B * gamma_eff))` where `gamma_eff = gamma + k_a * alpha` suffices.
- Lean is the quantity to control; roll angle = camber angle (minus tyre section offset). That ties directly to our existing camber lookup tables: for a motorcycle, front and rear camber = lean angle, so no kinematic camber table is needed on the bike; fork geometry modifies trail and anti-dive only. [E]
- Trail braking: combined slip. Use a friction-circle clip on F_x and F_y per tyre (`sqrt((F_x/mu_x)^2 + (F_y/mu_y)^2) <= F_z`) and let front load rise under braking (dynamic load transfer `dFz = m*a*h/L`, avnath13 uses the same formula). As the rider eases off the brake while leaning, front tyre F_y capacity increases -> bike turns in more. This is an emergent feature once combined slip + weight transfer exist. [E]
- Brake-induced standing-up (bike stands up under braking in a corner) is a real effect via trail; our reduced model can include `phi_target += k_stand * a_brake` as a small, honestly-labelled approximation. [E]

## 9. Fit with our architecture

- Today the bike is `stateAt(t)` on a fixed path. Manual bike requires a time-stepped integrator state (position, heading, speed, roll, roll-rate, pitch/heave, wheel loads) that is initialised from `stateAt(t)` on switch-in and that can hand back to Auto by rejoining the path (blend heading/lateral offset). The car faces the same architectural change; the bike only adds the roll DOF + rider controller. [E]
- Interface idea: `VehicleController { step(dt, inputs, road): State; fromAuto(state): void }` with `CarController` and `BikeController`; the bike's `inputs` are `{throttle, brakeFront, brakeRear, leanTarget|turnRate}`. Pure TS in `sim-core`, deterministic, unit-tested against the Meijaard eigenvalue crossing (4.29 / 6.02 m/s) for the linear core. [E]
- Cost: 3-4 extra scalars per step; fine at 240 Hz.

## Recommendation for Suspension Lab

1. Ship v1 manual drive for the CAR only; bike stays on auto (Auto <-> Manual remains car-only). Rationale: a car is statically stable and Cloudflare-demo friendly; bike controller tuning is the biggest schedule risk. [E]
2. Add the bike as v1.5 behind the same controller interface. Do NOT port any of the repos: avnath13 (no licence), Kright (no licence), ssebs (AGPL-3.0), TUMFTM (LGPL-3.0) are ideas only. Only bearcycle and RVP are MIT and neither contains a useful lean model.
3. Control scheme: user commands turn rate / lean target (keyboard A/D or gamepad stick); an internal speed-scheduled PD on roll and roll-rate produces the visual countersteer and balance. Never expose steer torque. [S Ferretti 2006; MDPI dual-PID gains; Kright structure]
4. Reduced model: roll DOF `I phi_dd = m g h sin(phi) - m h v^2 kappa cos(phi) + tau_rider`, no steering-head DOF, steer angle derived for visuals. This eliminates wobble/weave-2 and keeps 240 Hz stable. [E]
5. Use the Meijaard 2x2 benchmark (M, K0, K2, C1 values in section 4.1) as a unit-test oracle and as the content of an educational "stability map" (weave 4.29 m/s, capsize 6.02 m/s), clearly labelled "bicycle benchmark, not this motorcycle". [S]
6. Use speed-gain scheduling `gain ~ 1/(v^2+1)` plus a steer-rate limiter, as Kright found necessary, with tuning checked at 5, 15, 30, 60 m/s. [S]
7. Low speed: below ~2 m/s blend in a "feet down" outrigger roll torque and cap lean to ~8 deg; label it as a rider action. Soft-reset on tip-over for event demos. [E]
8. Tyres: camber-thrust dominated lateral force with first-order relaxation (`tau = L_rel/v`), friction-circle clip for combined braking+cornering; this yields trail braking for free. [E]
9. Wheelie/stoppie: compute `a_x = g*a/h` and `g*(L-a)/h` from the existing mass/CG data; show "front light / rear light" indicators and clamp pitch at tyre-contact loss rather than simulating flips. Fork dive and anti-squat are the headline demo. [E]
10. Honesty: put a persistent label "Reduced rider model; steer is derived; not engineering data" in the UI. avnath13's README disclaimer is a good tone reference. [S]
11. Risks: (a) controller tuning time (Kright needed hacks for wobble even in a physics engine); (b) keyboard input can't express smooth lean - use input smoothing and a lean-rate cap; (c) Auto<->Manual hand-back for a bike needs a roll/lateral blend or it will visibly snap; (d) suspension kinematic lookup tables are car-specific (camber vs travel) - a bike needs separate front-fork/rear-linkage maps; (e) numerical: 7-8 Hz wobble is marginal at 240 Hz semi-implicit Euler if ever modelled.
12. Cut-down fallback if time is tight: "lean-target with auto-balance only" - rider commands turn rate; roll = atan(v^2 kappa / g) with first-order lag (`tau ~ 0.15-0.3 s`) [E]; no controller, no tip-over, no low-speed handling, wheelie/stoppie limits shown only as gauges. Still shows lean, load transfer, fork dive and camber, and costs a few days.
13. Skip: direct steer torque, steering-head/wobble simulation, rider body-lean (knee-out) as a second input, tricks/wheelies as gameplay (racing-game systems are out of scope per the brief).
