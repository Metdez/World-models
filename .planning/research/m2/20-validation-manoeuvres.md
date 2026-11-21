# M2-20 — Validating a custom handling model honestly (manoeuvres, expected outcomes, test matrix)

Scope: ~1,800 kg, ~51/49 F/R, RWD GT car on road sports tyres (DB11-sized). Method note: Firecrawl was not used (503 reported); everything below came from Tavily search/extract. Tags: [S] sourced (link), [E] estimate/derived (derivation shown), [C] computed by me with a throwaway script from the stated parameters. Pages I only saw as search snippets (not full reads) are flagged "snippet".

## 0. Honesty caveats (read first)

1. **No published K&C, understeer-gradient, roll-gradient, or yaw frequency/damping data for the Aston Martin DB11 was found.** Manufacturers and the press do not publish them. Do NOT label any such number "DB11 data". Use class bands (section 3) and label the car "DB11-class, parameters estimated".
2. Published DB11 numbers (section 2) are *magazine-instrumented results on specific cars/tyres/surfaces* — usable as plausibility envelopes, not as targets to be hit exactly. Our model has no ABS/ESP/aero/engine-map fidelity, so +/-10% is the honest tolerance.
3. Understeer gradient depends on test method and lateral-acceleration range ("simply giving a deg/g value is not sufficient; it is also necessary to indicate the type of procedure"; K varies over the range) [S: https://en.wikipedia.org/wiki/Understeer_and_oversteer, snippet]. Every test below states speed/radius/a_y window.
4. Tests of a *tyre-only linear bicycle* and tests of the *full 7-DOF + load transfer* model give different K; the suite must assert them separately (section 5).

## 1. Standard manoeuvres: what the standard fixes

| Standard | What it prescribes (verified) | Source |
|---|---|---|
| ISO 4138:2021 steady-state circular | Open-loop; three variants: constant radius (discrete speeds, or slow continuous speed ramp), constant steering-wheel angle, constant speed. Steady state must hold >= 3 s for a measurement. Outputs: steering-wheel-angle gradient, understeer gradient (deg per m/s^2), roll-angle gradient, sideslip gradient, path-curvature gradient, stability factor. In constant-radius test the dynamic reference steer angle gradient is zero; K = steering-wheel gradient / steering ratio. | [S] https://cdn.standards.iteh.ai/samples/81710/e68b32975ef242b99ffbe8f6189c7d37/ISO-4138-2021.pdf ; ISO 4138 text via http://www.conforward.cn/ueditor/php/upload/file/20150829/1440814567491032.pdf (snippets) |
| ISO 4138 procedure detail | Lateral-acceleration increments <= 0.5 m/s^2, >= 3 s steady between increments, alternate left/right (tyre wear). | [S] Dewetron note https://ccc.dewetron.com/dl/52af1137-9110-4d92-b056-7770d9c49862 (snippet) |
| ISO 7401:2011 lateral transient | Open-loop. Step input, one-period sine, pulse, random. Standard speed 100 km/h, standard a_y level 4 m/s^2 (~0.4 g) so tyres stay near-linear. Reports: steady-state yaw-rate gain, lateral-acceleration response time T_ay, yaw-rate response time T_psi-dot, peak response times, overshoot U_ay and U_psi-dot. Response time = time from 50% of steering input to 90% of steady-state value (VI-grade/MOVEdot training definition). Pulse width 0.3–0.5 s. | [S] ISO 7401 table B.1 http://www.conforward.cn/ueditor/php/upload/file/20150901/1441081386459881.pdf ; atlantis-press test report https://www.atlantis-press.com/article/23449.pdf ; response-time definition https://www.youtube.com/watch?v=-zVibiIVf8E (transcript snippet) |
| ISO 3888-1:2018 double lane change | 6 sections, lengths 15/30/25/25/15/15 m; lane offset 3.5 m; widths 1.1w+0.25 (sec 1), 1.2w+0.25 (sec 3), 1.3w+0.25 (secs 5,6), w = vehicle width; cones >= 500 mm; entry speed (80 +/- 3) km/h typical, others allowed and reported; throttle held steady; exit speed reported. | [S] https://licensedcertifiersassociation.com.au/wp-content/uploads/2023/11/Standards-for-Passengers-Cars-1.pdf (snippet) |
| ISO 3888-2:2011 obstacle avoidance ("moose") | Section lengths 12 / 13.5 / 11 / 12.5 / 12 m; lane offset 1 m (sec 3); widths 1.1w+0.25, —, w+1, —, 1.3w+0.25 (>= 3 m). Section 4 is 1 m shorter than 2 to force high lateral accel at the end. Entry (target) speeds are run in steps (commonly 60–80+ km/h; max passing speed is the metric). | [S] https://cdn.standards.iteh.ai/samples/57253/5e8cdcc7c2fe4c0c8fe6f1de8beb5dba/ISO-3888-2-2011.pdf ; 80 +/- 3 km/h entry in https://indecs.eu/2024/indecs2024-pp246-265.pdf (snippet) |
| ISO 7975 braking in a turn | Steady circular run, then brakes applied; reports yaw-stability change, path deviation, a_y change relative to steady state. Required channels: moment of brake application, a_x, v_x, a_y, steering angle, yaw rate. (Exact test radius/decel levels not read — behind paywall; the standard reportedly uses ~100 m radius and a_y ~0.5 g [E, unverified].) | [S] https://publications.lib.chalmers.se/records/fulltext/211557/211557.pdf ; OptimumG channel list https://optimumg.com/wp-content/uploads/2020/01/Testing-Expo-Chennai-2020-ISO-TESTS-OptimumG-.pdf (snippets) |
| ISO 9816 power-off in a turn (lift-off) | Steady circular run, throttle released instantly; reports yaw-rate / path-radius / a_y change. Required channels: instant of power-off, v_x, a_y, steering angle, yaw rate, sideslip. | same two sources |
| Chrono-style SSC (ramp-speed steady-state cornering) | Start at "Ackermann speed" ~3 m/s (kinematic), then speed ramped slowly/stepped until max a_y or power exhausted; left and right turns to expose asymmetry. | [S] https://api.projectchrono.org/wheeled_tire.html |

Implementation note for our sim: ISO 3888 cone coordinates derive from vehicle width w (DB11 w = 1.94 m body, 76.4 in [S] MotorTrend https://www.motortrend.com/features/aston-martin-db11-12th-place-2017-best-drivers-car). So 3888-1 widths = 1.1w+0.25 = 2.38 m, 1.2w+0.25 = 2.58 m, 1.3w+0.25 = 2.77 m [E, computed].

## 2. Published DB11 performance figures (plausibility envelope)

Mostly the V12 coupe (630/600 hp cars, 4,194 lb curb, 51/49, Bridgestone Potenza S007, 255/40R20 F, 295/35R20 R, wheelbase 110.4 in = 2.804 m, track 65.5/64.7 in) — [S] https://www.motortrend.com/features/aston-martin-db11-12th-place-2017-best-drivers-car.

| Quantity | Value | Car/test | Source |
|---|---|---|---|
| 0–60 mph | 3.6 s (also 0–100 mph 7.8 s, 1/4 mi 11.7 s @ 125 mph, 5–60 rolling 4.4 s) | V12, Car and Driver | [S] https://www.caranddriver.com/reviews/a15088424/2017-aston-martin-db11-test-review |
| 0–60 mph | 3.8 s (0–30 1.8, 0–100 8.0, 0–100–0 12.1 s, 1/4 mi 11.9 s @ 124.7) | V12, Motor Trend | [S] MotorTrend link above |
| 0–60 mph | 3.95 s own GPS run; mfr claim 3.9 s (V12), ~4.0 s (V8 503 hp), 3.9 s (V8 535 PS 2021) | V12/V8 | [S] https://www.youtube.com/watch?v=SXFOZT0pMeY ; https://en.wikipedia.org/wiki/Aston_Martin_DB11 (snippets) |
| 60–100 km/h rolling | 3.1 s | DB11 (fastestlaps) | [S] https://fastestlaps.com/models/aston-martin-db11-n-a (snippet) |
| 60-0 mph braking | 105 ft (32.0 m) | V12, MT | [S] MotorTrend link |
| 70-0 mph braking | 158 ft (48.2 m) | V12, C/D | [S] C/D link |
| 130-0 km/h braking | 58 m | DB11 (fastestlaps) | [S] fastestlaps link (snippet) |
| 100-0 km/h braking | **no direct published figure found.** Derived: 60-0 in 32.0 m => mean decel 11.2 m/s^2 (1.14 g) => 100-0 ~ 34.5 m; 130-0 58 m => 11.2 m/s^2 gives the same, so ~34–35 m | derived | [E] from the two sourced points; hot-brake/ABS cars; our no-ABS model should land 36–42 m |
| Skidpad (300 ft dia) | 0.94 g (C/D) / 0.98 g avg (MT) | V12 | [S] C/D and MT links |
| Figure-eight | 23.9 s @ 0.84 g avg | V12 MT | [S] MT link |
| Slalom | 0.73 "max acceleration" / 67.9 km/h (as listed) | V8 page | [S] https://fastestlaps.com/models/aston-martin-db11-v8 (snippet; metric definition unclear — do not assert) |

Consequences for the model: road sports tyre peak mu_eff ~0.95–1.0 (skidpad 0.94–0.98 g includes small aero/body effect at 25–30 m/s skidpad speeds) [E]. Launch: 0–60 in 3.6–3.9 s implies mean a_x 0.7–0.75 g, traction-limited at the start for RWD (video notes wheelspin on launch without launch control) [S snippet above].

## 3. Class-typical handling metrics (bands, not DB11 data)

| Metric | Band | Source / status |
|---|---|---|
| Understeer gradient, modern passenger cars (linear range, <= ~0.4 g) | 2–3 deg/g; sportier cars bimodal lower | [S] practitioner statement, many hundreds of cars: https://www.eng-tips.com/threads/understeer-gradient-of-modern-passenger-cars.190555 (snippet; anecdotal) |
| Understeer gradient, FSAE-class car ISO 4138 benchmark | 2.67–2.88 deg/g at <=6 m/s^2, rising to ~9.3–9.4 deg/g at 85% of max Fy; max a_y 0.90–0.91 g; yaw-rate gain ~20.5 (deg/s)/g | [S] OptimumG ISO benchmark https://optimumg.com/wp-content/uploads/2020/01/Testing-Expo-Chennai-2020-ISO-TESTS-OptimumG-.pdf (snippet). Shows K must RISE toward the limit. |
| Roll gradient, typical passenger car | 3–7 deg/g (Gillespie) | [S] ULiege MECA0525 https://www.ingveh.ulg.ac.be/uploads/education/MECA0525/12_MECA0525_VEHDYN2_ROLL_2021-2022.pdf (snippet) |
| Roll gradient, low-downforce sedan / stiff downforce car / race car | 1.0–1.8 / 0.2–0.7 / <=1.5 deg/g | [S] OptimumG tech tip https://optimumg.com/wp-content/uploads/2020/01/SpringsDampers_Tech_Tip_2.pdf ; Milliken via https://publications.aston.ac.uk/id/eprint/21810/1/MPhil_EJ_Goodman_2009_reduced.pdf (snippets) |
| Roll gradient for an adaptive-damper GT (DB11 class) | 2.5–4.0 deg/g (GT mode ~4, Sport+ ~2.5–3) | [E] interpolation between the sourced bands; no source for DB11 |
| ISO 7401 step-steer response of a real car (steering-robot test report, passenger car) | steady yaw gain 0.213 s^-1 per deg steering-wheel, T_ay 0.26 s, T_yaw 0.16 s, T_ay,max 0.45 s, T_yaw,max 0.29 s, overshoot U_ay 0.20, U_yaw 0.44 | [S] https://www.atlantis-press.com/article/23449.pdf (single car, ~40 deg SW step; use as order-of-magnitude only) |
| Sports-car yaw response time | ~0.10–0.20 s; lateral-acceleration response ~0.15–0.30 s; yaw overshoot 0–40% | [E] bracketed by the one sourced car above and bicycle-model results in section 5 |
| Ride frequency (for the 7-DOF body modes, not yaw) | 0.5–1.0 Hz OEM, 1.1–1.8 Hz stiff road cars | [S] https://www.ijera.com/papers/vol9no3/Series-3/K0903036064%20.pdf ; https://optimumg.com/wp-content/uploads/2021/10/racecar-2020_11.pdf (snippets) |

Yaw natural frequency/damping: published vs-speed measurements for specific production cars were not located. Use bicycle-model values in section 5 as the analytic reference; typical road-car yaw natural frequency 0.5–1.5 Hz falling with speed, damping ratio 0.5–1.0 falling with speed (qualitative, standard bicycle-model behaviour) [E].

## 4. Closed-form checks that a test suite can assert

Parameters used for the worked numbers (all [E] except where sourced): m = 1800 kg (DB11 curb 4,194 lb = 1,902 kg + driver would be higher; 1,800 is the brief's number), L = 2.805 m [S MT], front weight 51% so a (CG to front) = 1.374 m, b = 1.431 m [C], Iz = 3,300 kg m^2 [E], tyre cornering-stiffness coefficient C_alpha/Fz ~ 12–15 per rad for road sports tyres [E]. Wf = 9,006 N, Wr = 8,652 N.

Linear bicycle model identities (Gillespie / Milliken, derived; standard):

1. Understeer gradient: K = Wf/Calpha_f − Wr/Calpha_r (rad per g when W in N and Calpha in N/rad per AXLE). Convert: K[deg/g] = K[rad/g]*57.2958. Equivalent: K = (m/L)*(b/Caf... ) form: K' = m (b Car − a Caf)/(L Caf Car) [rad per m/s^2], K[rad/g] = K'*g.
2. Steady-state steer: delta = L/R + K*a_y (rad, a_y in g with K in rad/g). Path curvature gain: 1/R per delta = 1/(L + K'V^2).
3. Yaw-rate gain: r/delta = V / (L + K' V^2). Neutral (K'=0): V/L. Understeer: max at V_char = sqrt(L/K') (characteristic speed); gain = V_char/(2L). Oversteer (K'<0): critical speed V_crit = sqrt(−L/K'); yaw gain diverges there; assert "no stable steady state above V_crit".
4. Lateral-acceleration gain: a_y/delta = V^2/(L + K' V^2).
5. Yaw natural frequency (undamped): omega_n^2 = Caf Car L^2 /(m Iz V^2) * (1 + K' V^2/L). Eigenvalues of the 2x2 [beta, r] system: A = [[-(Caf+Car)/(mV), -1-(a Caf - b Car)/(mV^2)], [-(a Caf - b Car)/Iz, -(a^2 Caf + b^2 Car)/(Iz V)]].
6. Static weight transfer: dFz = m a_y h / t (lateral); dFz_x = m a_x h / L (longitudinal). Axle lateral transfer split by roll-stiffness distribution (Milliken "magic number"). Sum of Fz = m g always (assert to 1e-9).
7. Braking: d = v^2/(2 mu g) ideal; with load transfer and a fixed brake bias, the max decel is mu g only if bias matches the dynamic axle-load ratio; assert d >= v^2/(2 mu g).
8. Kinematic steer at low speed: delta = L/R (Ackermann), yaw rate = V*delta/L.
9. Friction circle: sqrt(Fx^2 + Fy^2) <= mu Fz per tyre (assert, 1e-6 slack).
10. Energy: constant-speed straight-line coast should decelerate only by drag + rolling resistance; no unexplained energy gain.

Worked numbers [C] (throwaway script, same parameters; tyre-only linear, no load transfer, no compliance):

| Case (Calpha/Fz front, rear) | Caf, Car (kN/rad) | K (deg/g) | V_char | yaw gain at 20 / 27.8 / 40 m/s (1/s per rad) | wn at 20 / 27.8 / 40 m/s (Hz) | zeta at 20 / 27.8 / 40 |
|---|---|---|---|---|---|---|
| 13, 13*Wr/Wf (near neutral) | 117, 108 | −0.18 | none (slightly oversteer; V_crit large) | 7.47 / 10.87 / 17.45 | 0.81 / 0.52 / 0.29 | 1.0 (real roots) |
| 13, 14 | 117, 121 | +0.32 | 70.8 m/s | 6.60 / 8.59 / 10.81 | 1.13 / 0.84 / 0.63 | 0.96 / 0.93 / 0.87 |
| 12.5, 15 | 113, 130 | +0.76 | 45.4 m/s | 5.97 / 7.21 / 8.03 | 1.21 / 0.93 / 0.74 | 0.92 / 0.86 / 0.75 |

Take-away for the suite: with equal tyre cornering-stiffness coefficients and 51/49 weight, the tyre-only K is only ~0 to +0.8 deg/g. Published 2–3 deg/g for production cars comes from load-transfer tyre saturation, roll steer, compliance steer and aligning torque (Bundorf analysis contributors listed at https://en.wikipedia.org/wiki/Understeer_and_oversteer, snippet). So a full-model K in 1.5–3.5 deg/g at 0.3 g requires those contributors to be modelled, and the suite must assert the *breakdown*, not only the total. For a RWD GT, expect K at 0.3 g approx 1.5–3 deg/g [E] and rising (the OptimumG benchmark shows ~3x increase near the limit [S snippet]).

## 5. How open-source projects test their models (for method steal; only licence-clean code may be copied)

- **Project Chrono::Vehicle** — repo https://github.com/projectchrono/chrono, ~2.5k stars [E], active; licence BSD-3-Clause [S, per SBEL slides: "open source, BSD3" https://sbel.wisc.edu/wp-content/uploads/sites/569/2023/04/TR-2023-02.pdf]. Copyable under BSD-3 with notice. Validation pattern: (a) tire models validated individually on tyre test rigs (Pacejka implementation checked against MSC ADAMS/Car) [S https://projectchrono.org/assets/white_papers/chronoVehicle_IJVP.pdf]; (b) full-vehicle Steady-State Cornering (SSC) simulation vs experimental KRC data for the FED-alpha vehicle, left and right turns, quasi-steady ramp, simulated as continuous lines over measured dots [S https://api.projectchrono.org/wheeled_tire.html]; (c) driver test inputs from an ASCII file (time, steering [-1,1], throttle [0,1], braking [0,1]), plus PID speed controllers and a path follower with an ISO double-lane-change path [S https://api.projectchrono.org/vehicle_driver.html, https://www.projectchrono.org/assets/slides_3_0_0/7_HandsOn/ChronoVehicle_HandsOn.pdf]; (d) suspension test rigs (platform and pushrod) with output plots [S https://api.projectchrono.org/10.0.0/wheeled_rig.html]. Steal: the driver-input file format as our scripted-manoeuvre format, the quasi-steady ramp SSC protocol, and per-subsystem (tyre, suspension kinematics) rig tests before full-vehicle tests. I did NOT find published numeric pass/fail tolerances in Chrono docs; they are plots against data.
- **CommonRoad** — https://github.com/CommonRoad/commonroad-io (~100+ stars [E]; licence not read here — verify; treat as ideas-only until SPDX confirmed). Provides kinematic single-track (KS) and dynamic single-track (ST) vehicle models with real-vehicle parameter sets (e.g. Ford Escort) used for competition feasibility; states KS is valid only when not near physical limits (no tyre slip) [S https://mediatum.ub.tum.de/doc/1379638/776321.pdf ; https://arxiv.org/html/2411.06425v1]. Steal the idea: declare each model's validity domain (a_y limit) and assert the sim flags/blends outside it. Also a "drivability checker" pattern: trajectories checked against steering-rate, jerk and a_y limits.
- **MathWorks Vehicle Dynamics Blockset** (proprietary, ideas only) implements ISO 3888-1/-2 and notes cone-count/spacing differences between parts [S https://www.mathworks.com/help/vdynblks/ug/double-lane-change-maneuver.html].
- **CarSim/VI-grade practice** (proprietary): ISO 4138 at constant speed with a steer ramp; ISO 7401 at 100 km/h and 0.4 g flat acceleration to stay in the linear range [S snippets above].

## 6. Test matrix (concrete)

Conventions: car = 1,800 kg, L 2.805 m, 51/49, mu_peak ~1.0 road sports tyre, RWD; "full model" = 7-DOF + tyre + load transfer; speeds in m/s; tolerances are for an honest approximate model.

| # | Manoeuvre | Inputs | Measured quantity | Expected range | Source / tag |
|---|---|---|---|---|---|
| T1 | Bicycle-identity unit test (tyre-only linear mode, load transfer off) | Caf, Car set; V = 20, 27.8, 40 m/s; small steer step 0.5 deg road-wheel | steady r/delta, a_y/delta, K from sweep | equals V/(L+K'V^2), V^2/(L+K'V^2); K = Wf/Caf − Wr/Car within 1% | derived [C]; Gillespie standard |
| T2 | Neutral / oversteer / understeer sign check | vary Caf/Car so K = −0.5, 0, +1, +3 deg/g | sign of K from ISO 4138 constant-radius run; V_char / V_crit | steer angle increases / constant / decreases per sign; V_char = sqrt(L/K') within 3% | derived |
| T3 | ISO 4138 constant-radius, speed ramp (Chrono-SSC style) | R = 50 m (or 100 m), speed from 3 m/s up at slow ramp (a_x < 0.05 m/s^2^... i.e. quasi-steady) to limit; both directions | steer angle vs a_y, K(a_y), roll angle vs a_y, sideslip | K(0.1–0.4 g) = 1.5–3.5 deg/g [E] (class 2–3 deg/g [S eng-tips]); K rises monotonically, >= 2x by 85% of peak a_y [S OptimumG FSAE shape]; left/right symmetric within 3% | [S]/[E] |
| T4 | Roll gradient from T3 | same | d(roll)/d(a_y) in 0.1–0.5 g | 2.5–4.0 deg/g (GT damper mode); must be inside 1.0–7.0 hard envelope; Sport mode smaller than GT mode; = W h/(KphiF+KphiR) − W h... [Gillespie/OptimumG formula within 10% when tyre/geometry terms off] | [S bands] / [E] |
| T5 | Skidpad / max lateral | 30 m radius (300 ft dia = R 45.7 m for C/D), slow ramp to limit, aero small | max steady a_y | 0.90–1.00 g (road sports tyre; published DB11 0.94–0.98 g) ; > 1.05 g = fail (too grippy) | [S] C/D, MT |
| T6 | ISO 7401 step steer | V = 27.8 m/s (100 km/h), step to produce 4 m/s^2 steady a_y, step rise < 0.15 s | yaw-rate response time (50% steer -> 90% ss), T_ay, overshoot, steady yaw gain | T_yaw 0.10–0.25 s; T_ay 0.15–0.35 s; yaw overshoot 0–50%; yaw gain within 10% of bicycle formula with the model's K; reference order of magnitude from sourced car (0.16 / 0.26 s / 0.44) | [S] atlantis report; [E] range |
| T7 | ISO 7401 sine sweep / one-period sine | V = 27.8 m/s, 0.2–3 Hz, small amplitude (0.2 g) | yaw & a_y gain/phase vs freq; yaw resonance fn and peak | resonance (if present) 0.5–1.5 Hz at 27.8 m/s; bicycle reference omega_n 0.84–0.93 Hz [C] for K=0.3–0.8 deg/g; fn falls with speed (assert monotonic: fn(40) < fn(20)); phase lag at 1 Hz between 20 and 90 deg | [C]/[E] |
| T8 | Yaw damping vs speed (modal) | linearize model at V = 10, 20, 30, 40 m/s | eigenvalues | stable at all V when K>0; zeta decreases with V; zeta >= 0.5 at 40 m/s for K>=0.3 deg/g; if K<0 divergence for V > V_crit | [C] table section 4 |
| T9 | ISO 3888-1 double lane change | cone layout 15/30/25/25/15/15 m, offset 3.5 m, widths from w = 1.94 m: 2.38 / 2.58 / 2.77 m; entry 80 +/- 3 km/h, throttle fixed, simple path-follower driver | pass/fail cones, peak a_y, peak yaw rate, peak steer, exit speed | at 80 km/h: peak a_y 0.4–0.7 g [E from path geometry], must complete without cone hits for a well-balanced car; at +20 km/h failure is acceptable | [S] ISO 3888-1 (snippet); a_y [E] |
| T10 | ISO 3888-2 obstacle avoidance | lengths 12/13.5/11/12.5/12 m, offset 1 m, widths 2.38 / w+1 = 2.94 / 2.77 m... (1.1w+0.25, w+1, 1.3w+0.25); speed steps 60–90 km/h | max entry speed with no cone hit; peak yaw rate, sideslip, a_y; spin y/n | passes 70–80 km/h with a sports tyre/suspension [E]; no spin below the grip limit; rear stability (sideslip < ~10 deg) on the return | [S] ISO 3888-2; [E] |
| T11 | ISO 7975 braking in a turn | steady R = 100 m at 0.4–0.5 g, then brake to 0.3–0.6 g decel (fixed bias) | change in yaw rate, path radius, sideslip vs steady state | yaw rate and sideslip step toward oversteer (rotation inward) with increasing decel; radius tightens; model with proper load transfer must show monotonic effect; no spin at 0.3 g decel; a_x/a_y combined stays inside friction circle | [S] ISO 7975 existence; direction [E] standard physics |
| T12 | ISO 9816 lift-off (power-off) in a turn | steady R = 100 m at 0.5 g (RWD, ~15–30% throttle), release throttle in < 0.2 s | yaw-rate change, path radius change | RWD: tightens modestly (rotates inward); the magnitude is small and bounded (yaw-rate change < 15% of steady, no spin) for a GT with mild understeer; zero for a no-driveline-drag model => must include engine braking / drag and rear-load shift | [S] ISO 9816 existence; magnitude [E] |
| T13 | Constant-radius throttle-on (power-on) | R = 100 m, steady 0.4 g, then 50–100% throttle | path radius, yaw rate, rear slip angle | RWD understeer-to-oversteer progressive; at full throttle in a low gear, rear slip rises; no sudden spin unless a_y near limit; time-to-saturation ~0.3–1.0 s | [E] |
| T14 | Straight-line braking | 100 km/h -> 0, flat mu 1.0 road tyres, bias 60–65% front, no ABS (or simple ABS) | distance, peak decel, pitch angle, load transfer | 100-0 ~ 34–35 m real (derived from 105 ft, 58 m@130); model band 34–42 m; peak decel 1.0–1.15 g; fail if < 30 m (>1.3 g) or > 50 m; 60-0 band 30–38 m; fronts lock first at bias > dynamic ratio | [S] MT 105 ft, fastestlaps 130-0 58 m; [E] derivation |
| T15 | Standing launch 0–100 km/h | full throttle, RWD, mu 1.0, engine-torque map + 8-speed shift model or acceleration curve | time to 60 mph / 100 km/h; peak a_x; wheel-spin fraction | 60 mph 3.6–4.0 s; 100 km/h 3.8–4.3 s [E from 3.6–3.95 s to 60 mph]; peak a_x <= mu*(1 + dyn rear load share) ~ 0.8–1.0 g at launch; model with no launch control may show initial wheelspin (consistent with real ~3.95 s run) | [S] C/D, MT, YouTube; [E] |
| T16 | Weight-transfer sanity | static, constant a_y = 0.5 g, a_x = ±0.5 g | Fz at 4 wheels | sum Fz = m g to 1e-6; lateral transfer = m a_y h/t (+/-1%); front lateral transfer share = roll-stiffness front share (with geometric RC terms) | derived [C] |
| T17 | Symmetry / invariants | mirror steering inputs; 10 s idle | all outputs mirrored; idle drift | sign-flipped states equal within 1e-9; no drift at rest | derived |
| T18 | Determinism / stepping | same inputs at 120 / 240 / 480 Hz | key metrics (r_peak, a_y ss) | within 1–2% between 240 and 480 Hz; bitwise identical across repeated runs | project rule |
| T19 | Regression envelope on auto-drive lap | existing 1.65 km loop ghost | lap time, peak a_y, max |slip| | no change > 1% to existing stateAt(t) results (if manual and auto share the same model) | project |
| T20 | Validity-domain guard | drive beyond 0.8 g repeatedly | flag raised; UI badge flips to "approximate" | flag fires when |a_y| > ~0.85 mu g or slip > 8–10 deg (CommonRoad-style domain declaration) | [S] CommonRoad concept; [E] threshold |

## 7. Recommendation for Suspension Lab

- Declare the model "DB11-class, estimated parameters" in UI and tests; never call outputs DB11 engineering data. No published DB11 K&C/handling-gradient exists in anything I could access.
- Anchor straight-line and skidpad assertions to sourced figures: 0–60 mph 3.6–3.95 s, 60-0 mph 105 ft, 70-0 158 ft, skidpad 0.94–0.98 g (links in section 2). Treat 100-0 km/h ~34–35 m as [E] derived from two sourced points.
- Implement tests in two tiers: (1) analytic bicycle identities (section 4) with tight tolerances (1%) in a linear tyre mode; (2) full-model ISO manoeuvres with band tolerances (10–25%) because tyre saturation, load transfer and compliance change K.
- Expect tyre-only K ~0–0.8 deg/g for 51/49 equal-coefficient tyres; reaching the 2–3 deg/g production-car band requires load-transfer tyre saturation, roll/compliance steer, aligning torque. Assert the contributor breakdown (Bundorf-style), not only the total.
- Assert shape, not just values: K rising toward the limit (>= 2x by 85% peak a_y), yaw frequency falling with speed, damping falling with speed, left/right symmetry.
- Use ISO 7401 definitions exactly (response time 50% -> 90% of steady value; standard 100 km/h, 4 m/s^2) so reported numbers are comparable to literature.
- Adopt Chrono's input format (time, steer [-1,1], throttle, brake) as the scripted-manoeuvre format and run all ISO manoeuvres headless in vitest against sim-core; Chrono is BSD-3 so format/idea and small code excerpts can be copied with notice.
- Adopt Chrono's quasi-steady SSC ramp for the skidpad/K sweep; run both left and right to expose asymmetry bugs.
- ISO 3888-1/-2 cone layouts are computed from vehicle width; encode them as a data-driven track generator (w = 1.94 m) and use a path-follower driver for repeatability; accept "no-cone-hit" speed as the metric.
- Add a validity-domain flag (CommonRoad idea) and a visible "approximate" state beyond ~0.85 mu g; ties directly to the honesty rule.
- Skip claiming ESP/ABS fidelity; if a simple ABS is used, test it separately (T14 band widened).
- Risks: my ISO 7975 radius/decel details and ISO 9816 magnitudes are [E] (standards paywalled); Iz and tyre stiffness coefficients are [E]; the fastestlaps DB11 V8 page could not be fully read (slalom metric ambiguous); the sourced step-steer result is one car; CommonRoad licence not verified in this pass (ideas only until checked).
- Next verification step (cheap): buy/read ISO 7975 and 9816 summaries or use a licensed reference; run T1–T8 first since they need no external data.
