# M2 research 05: how suspension geometry changes handling, and how sims couple it

Tags: [S] sourced (link), [E] estimate or derived by me (treat as unverified), [D] derived from a sourced equation.
Source quality is flagged where weak (forum, Q&A, video transcript). No code was edited.

## 0. One-paragraph answer

At 0 to 1 g in a road car, suspension TYPE (strut / wishbone / multi-link) is a second-order handling variable. The first-order
variables are tyre cornering stiffness, spring/ARB roll stiffness, CG height, weight distribution and damping. Type matters
through a handful of kinematic outputs (camber vs travel, toe vs travel, roll-centre height/migration, side-view instant-centre
angle, scrub/trail, compliance). Most of these are already tabulated in Suspension Lab. The honest coupling is therefore: feed
the existing lookup-table outputs into the tyre inputs (slip angle, inclination, Fz), the ride model (jacking, anti-pitch) and
the steering torque, and show the resulting deltas with their true (small) size, not amplified.

## 1. Mechanisms and magnitudes

### 1.1 Roll-centre height: geometric vs elastic load transfer, jacking
- Definitions [S]: the roll moment on the sprung mass is proportional to the vertical distance from sprung CG to the kinematic
  roll centre; "the higher the roll centre, the less roll moment and elastic load transfer, but the more geometric load transfer"
  (OptimumG, "The no way transfer part 2", https://optimumg.com/wp-content/uploads/2021/10/OptimumG-Septepmber-2021.pdf).
  RC on the ground means all sprung-mass transfer is elastic; RC at CG height means zero roll moment (same source).
- Key honesty point [D]: TOTAL lateral load transfer of a rigid-ish car (m*ay*h_cg/t) does not depend on RC height. RC height
  only (a) changes the roll angle (moment arm), (b) shifts the split between front and rear axle (changes balance), and
  (c) adds jacking. So "high RC = more grip" is false; it changes roll and balance.
- Jacking [S]: the inside/outside tyre side forces act through lines from contact patch to the instant centre; the vertical
  components are unequal when side forces are unequal, giving a net jacking force. The angles theta_Ici, theta_Ico between ground
  and the contact-patch-to-IC line matter more than the RC point itself. Ride-height change from jacking "in the order of 1 mm
  with stiff suspension or as much as 10 mm with soft suspension" (https://optimumg.com/rolling-about).
- Formulas to lift (standard statics, [D] from the OptimumG description; facts, not copyrightable):
  - per tyre geometric vertical force: Fz_geo,i = Fy_i * tan(theta_i), tan(theta_i) = h_IC,i / y_IC,i (IC height over lateral
    distance from contact patch). Jacking = Fz_geo,o - Fz_geo,i with signs per IC side.
  - roll gradient without tyre compliance [S] (OptimumG springs/dampers tip 2,
    https://optimumg.com/wp-content/uploads/2020/01/SpringsDampers_Tech_Tip_2.pdf): phi/ay = W*H / (K_phiF + K_phiR), H = CG to roll
    axis distance; wheel rate = spring rate / MR^2 (same source). Better, include the gravity term: phi/ay = W*H / (K_phiF+K_phiR - W*H*g) [D].
  - OptimumG quotes target roll gradients 0.2-0.7 deg/g (downforce cars), 1.0-1.8 deg/g (low-downforce sedans) [S]. Road cars with
    soft springs are typically 3-6 deg/g [E] (my recollection; not verified in a fetched source).
- Magnitude for a road car [E, worked from the above]: sprung CG 0.55 m, front RC 0.08 m, rear RC 0.15 m. Moving front RC +50 mm
  changes the roll arm by ~ +/- 5-10% of 0.45 m, i.e. roll angle changes ~0.2-0.4 deg/g out of ~4 deg/g, and moves lateral load
  transfer toward the front axle by a few % of the total. At 0.5 g that is ~0.1-0.2 deg of body roll. Visible only side by side.
- RC migration under roll (DW: lower in bump, higher in droop; short arms migrate more) is real [S: designjudges.com/articles/
  simple-kinematic-philosophies, low-authority blog]. Strut RC moves less laterally but its IC position depends on the rack
  [S: https://optimumg.com/vehicle-setup-and-kinematics-qa-series].

### 1.2 Camber gain and outer-tyre camber in roll
- Roll adds inclination equal to the roll angle to the outer wheel (positive camber vs ground) unless kinematics cancel it
  [S: https://racingcardynamics.com/understeer-and-oversteer]. Net camber to ground = static + (roll - camber_gain*roll-travel).
- Typical race-car camber gain 0.5-1.0 deg per inch of travel, less for road cars [S, weak: hbjssuspension blog on OptimumG].
  In per-mm: ~0.02-0.04 deg/mm race, ~0.01-0.02 deg/mm road [D]. MacPherson camber gain goes negative early in jounce then reverses
  to positive at large jounce; DW can keep gaining negative camber to full jounce [weak: Automation game forum quoting Wikipedia-style text]. Multi-link can be designed either way (more design freedom).
- Tyre response, this is the number that settles it [S, Gillespie, Fundamentals of Vehicle Dynamics ch.6]: "4 to 6 degrees of camber
  are required to produce the same lateral force as 1 degree of slip angle on a bias-ply tire... as much as 10 to 15 degrees on a
  radial" and "on solid axles camber at best changes the lateral forces by 10% or less". Cornering stiffness order 50 000 N/rad
  ~ 875 N/deg [S: http://www.ingveh.ulg.ac.be/uploads/education/MECA0525/10_MECA0525_TYRE2_2021-2022.pdf].
  So camber thrust ~ 875/(10..15) = 60-90 N per degree per wheel on a radial [D]. OptimumG tyre tip defines the same quantity
  (dFy/dgamma, e.g. "100 N/deg") [S: https://optimumg.com/wp-content/uploads/2019/08/TireComparison.pdf].
- Grip loss per degree of positive camber near the limit: peak mu loss is typically ~1.5-3% per degree away from optimum camber
  (optimum about -1 to -3 deg on road radials) [E]. I did not find a clean primary source; treat as a tunable model parameter.
- Magnitude for a road car [E/D]: 0.5 g, roll 2 deg, strut vs DW difference in outer-wheel camber ~0.3-0.6 deg. Force effect
  ~ 0.5 deg * 75 N/deg = ~40 N per wheel vs ~3.5 kN axle lateral force => ~1%. At 0.9 g, roll 3.5 deg, difference ~0.5-1 deg =>
  ~2-3% peak-grip-equivalent, i.e. 0.02 g. Borderline perceptible, only at the limit.
- Caster camber gain matters only with big steering angles (low-speed corners), not high-speed [S: optimumg Q&A above].

### 1.3 Roll steer, bump steer, compliance steer: understeer gradient contributions
- Roll steer [S, Gillespie eq. 6-57]: K_rollsteer = (e_f - e_r) * (dphi/day) in deg/g, e = deg steer per deg roll, positive
  front roll steer = steer out of turn = understeer; positive rear roll steer = oversteer. Also in
  http://www.ingveh.ulg.ac.be/uploads/education/MECA0525/12_MECA0525_VEHDYN2_ROLL_2021-2022.pdf (Liege course, derived from Gillespie).
- Lateral force compliance steer [S, Gillespie eq. 6-58]: coefficient = d(steer)/d(Fy) in deg per unit lateral force; a rearward
  yaw centre on a front axle is oversteer, forward is understeer; the reverse on a rear axle (same Liege slides).
- Full bookkeeping (Bundorf analysis) [S: Wikipedia summary + Clemson paper, https://cecas.clemson.edu/ayalew/Papers/Vehicle%20Systems%20Dynamics%20and%20Control/Papers/An%20Iterative%20Approach%20for%20Steady%20State%20Handling%20Analysis%20of%20Vehicles/641_1.pdf]:
  K = tyre cornering-stiffness term (Wf/Caf - Wr/Car) + lateral load transfer + camber thrust + roll steer + lateral-force compliance
  steer + aligning-torque steer + steering compliance. Understeer gradient measured in deg/g, only meaningful with the test
  type and lateral acceleration stated [S: Wikipedia Understeer and oversteer].
- Numbers [D/E]: with roll gradient 4 deg/g, e = +0.05 deg/deg gives 0.2 deg/g; e = 0.1-0.2 deg/deg (aggressive, designed-in
  rear toe-in) gives 0.4-0.8 deg/g. A road car's total K is ~1-3 deg/g [E]. So roll steer is a 5-25% knob on K. An FSAE forum
  rule of thumb in the same spirit: "10% roll steer in a 1.5 deg/g roller is 0.15 deg steer at max lat" [weak: reddit r/FSAE].
- Compliance steer [E]: modern multi-link rear toe-in under lateral force is on the order of 0.01-0.04 deg per 100 N per wheel;
  at 0.5 g on a 1500 kg car (~1.8 kN per rear wheel) that is 0.2-0.7 deg of toe, adding stability (understeer). Magnitude
  stated as range because I found no fetched K&C datasheet; verify if used in UI.
- Bump steer on a single wheel hitting a bump is the one place the effect is clearly felt, because it is transient and
  asymmetric. [D]: 0.02 deg/mm over a 30 mm bump = 0.6 deg toe on one wheel => 0.6*875 = ~525 N lateral on that wheel => ~0.04 g
  on a 1500 kg car for a few ms. Ties to the Suspension Lab road (washboard, pave, kerbs). Design target is typically
  below +/-0.5 deg over the working range [E].

### 1.4 Scrub radius, caster trail, KPI: steering feel and self-aligning torque
- Scrub radius [S]: lever arm for braking forces into the steering axis. Positive scrub gives toe-out under braking (understeer
  tendency in brake-in-bend, desirable for stability); negative scrub is more stable on split-mu braking and reduces torque steer.
  Most production cars keep it small, ideal below 10-15 mm either sign [S: https://race.software?ulp_lesson=kingpin-angle-scrub-radius-wheel-centre-offset].
  Large positive scrub of ~100 mm (4 in) was common historically; adds road feel and steering effort [S: https://en.wikipedia.org/wiki/Scrub_radius].
  Wheel-centre offset (longitudinal/tractive force lever) drives torque steer and kickback on FWD/AWD [S: race.software].
- Self-aligning torque (SAT) at the tyre = Fy * (pneumatic trail + caster trail) [D, standard]. Typical pneumatic trail 20-40 mm
  at low slip falling toward zero near the limit; caster trail 20-40 mm [E]. Magnitude: Fy 1.8 kN per front wheel at 0.5 g, total trail
  ~60 mm => ~110 N*m about the kingpin per wheel; through ~15:1 ratio ~7 Nm at the steering wheel pre-assist [E]. The fade of
  pneumatic trail near the limit is the main "going light" cue, and it is tyre-model dominated, not suspension-type dominated.
- Does suspension type change it? Strut vs DW differ mainly in KPI/scrub packaging and in how scrub/caster change with travel and steer
  (strut axis is the strut itself, so scrub moves little with bump but caster/ KPI change through the arm). A driver only feels this
  through a steering-torque channel (FFB wheel) or via kickback/brake pull. With keyboard/gamepad this is almost invisible.

### 1.5 Anti-dive / anti-squat: pitch under braking and throttle
- Definition [S]: anti-dive set by the angle of the line from contact patch to the side-view instant centre; it decides how much
  braking-induced load transfer goes through the links (geometric) vs springs (elastic) [S: https://optimumg.com/the-anti-antis].
  Standard formula [D]: %AD_front = 100 * tan(theta_f) * (L/h_cg) * beta_f (beta = front brake fraction, outboard brakes; inboard
  brakes use the wheel centre). Geometric vertical force = F_x,axle * tan(theta). Typical GT magnitude ~30% [S: https://waveydynamics.com/blog/anti-geometry];
  road car range commonly quoted 20-55% [weak: YouTube], good "feel" 20-25% front [weak: YouTube transcript].
- Magnitude [E]: road-car pitch gradient ~1.5-2.5 deg/g under braking (soft). Front 30% AD cuts front dive by ~30% of the front
  axle's share, i.e. ~0.3 deg at 1 g, ~0.1 deg at 0.3 g. Visually small; camera pitch is the only channel.
- Type dependence: anti-dive is a hardpoint design choice, available in all three types (strut has a fixed-ish IC from strut axis and
  LCA side-view angle). It is not an inherent advantage of one type. Multi-link rears add anti-squat tuning freedom and
  trailing-arm bushing compliance gives longitudinal softness (comfort) [weak: general].

### 1.6 Motion ratio and wheel rate
- wheel rate = spring rate / MR^2 [S: OptimumG tip 2 above]. MR is typically 0.6-0.9 for DW pushrod-less road cars, ~0.9-1.0 for
  struts (spring nearly along the wheel motion), 0.5-0.8 for multi-link rears with spring on the lower arm [E]. MR varies with travel
  (progressive/regressive), so wheel rate and ride frequency drift with load. This is a major, FELT difference (ride harshness,
  frequency, roll stiffness through the roll-rate formula above), larger than any camber effect. It is already in the lookup tables.

### 1.7 Compliance steer is multi-link's real advantage
- Multi-link: arms in the top view control toe/steer and lateral compliance, rear view controls camber, side view carries
  traction/braking loads and caster; this separation is why it can have soft longitudinal bushings (NVH) while keeping lateral
  toe stiff [weak: YouTube explainer, https://www.youtube.com/watch?v=azcqyTw-3Rg]. Net feel: refinement + a toe-in-under-load
  stability bias at the rear, not higher grip.

## 2. How production sims couple kinematics into handling

| Sim | Approach | Full geometry or tables | Licence / reuse |
|---|---|---|---|
| Assetto Corsa | `suspensions.ini` with TYPE=DWB or STRUT, hardpoint coordinates (WBCAR_TOP_FRONT, WBTYRE_TOP, STRUT_CAR...), kinematically solved; SDK tool ksSusEditor [S: https://assettocorsamods.net/threads/debugging-car-handling-and-suspension.1847 ; https://github.com/archibaldmilton/Girellu/wiki/Physics-Pipeline] | Full geometry (solved), no multilink in stock; CSP "cosmic suspension" uses an ODE solver and warns that stiff/complex linkages struggle at AC's default physics rate [S: https://cup.acstuff.club/docs/csp/cars/cosmic-suspension] | Proprietary. Ideas only. |
| rFactor 2 | Legacy PM files (BODY/BAR/JOINT/HINGE) replaced by UltraChassis INI; computes camber curves, bump steer, RC from geometry [S, third-party: https://motorlaps.com/car-physics-rfactor2.php] | Full geometry (constraint solved) | Proprietary. Ideas only. |
| BeamNG | Soft-body nodes and massless spring/damper beams; wheels and suspensions modelled as nodes and beams, ~714 nodes / 4479 beams per car [S: https://documentation.beamng.com/modding/vehicle/intro_jbeam ; Gambi et al. ICSE-SEIP PDF at beamng.tech]. Suspension kinematics are emergent. | Full geometry, emergent from structure; heavy | Proprietary; jbeam docs viewable, not a free licence. Ideas only. |
| Project Chrono::Vehicle | Template-based multibody (double wishbone, reduced DW, multi-link, MacPherson, solid axle, semi-trailing arm); JSON with hardpoints, masses, spring/damper, nonlinear spring-damper [S: https://api.projectchrono.org/vehicle_overview.html ; https://projectchrono.org/assets/white_papers/chronoVehicle_IJVP.pdf ; JSON example in https://www.projectchrono.org/assets/slides_3_0_0/7_HandsOn/ChronoVehicle_HandsOn.pdf] | Full geometry (real constraints), not real-time friendly in a browser | https://github.com/projectchrono/chrono, ~3.1k stars, BSD-3-Clause, active (10.0.0 release indexed) [S]. MAY copy with notice. Sample hardpoints e.g. DW upper arm `[0.349,0.462,0.228]`, lower `[0.223,0.307,0]`, spring k=167062 N/m free length 0.339, damper c=60068 (generic data in slides). |
| VI-grade VI-CarRealTime | Curve-based model: kinematics and compliance as lookup tables; template (hardpoint) suspensions are first converted to curves before dynamic simulation; K&C wizard builds a model from rig data [S: https://www.youtube.com/watch?v=MyM01zsMxE0 ; https://www.vi-grade.com/en/solutions/kandc_interface] | Tables (hardpoints optional design front end) | Proprietary. Ideas only. |

Takeaway: real-time commercial sims (VI-CarRealTime, and effectively every driving-simulator vehicle model) run on K&C curves
because multibody solvers are too costly or stiff. Suspension Lab's existing "kinematics lookup tables vs travel and rack" is
the same architecture as the industry real-time path. Full-geometry solving (AC, rF2, Chrono) only wins on fidelity of
unusual hardpoints and large-travel nonlinearity, which this product does not need.

## 3. Proposed coupling into Manual Drive (all pure TS, deterministic)

Per wheel i, per 240 Hz step, from the existing tables evaluated at (wheel travel z_i, rack r):
1. tyre inclination gamma_i = camber_i(z_i, r) + body-roll contribution via the same table (already differential travel), added
   to the tyre model's camber input (camber thrust ~ C_gamma*gamma with C_gamma = Calpha/10..15 on radials [S above], clamp
   beyond ~8-10 deg [S: Liege slides say camber thrust fades out above 5-10 deg for passenger tyres]).
2. toe_i = toe(z_i, r) + c_lfcs * Fy_i (compliance, per type constant [E], sign per axle) added to wheel slip-angle input.
   Roll steer and bump steer then emerge automatically from differential z_i. No separate roll-steer coefficient needed
   (but compute e = dtoe/droll offline for the UI readout and unit tests: K_rs = (e_f-e_r)*dphi/day).
3. Load transfer split per axle: geometric part Fy_axle*h_RC/t, elastic part via roll stiffness with arm (h_cg - h_RC),
   unsprung part ay*m_u*h_u/t. Jacking from IC angles (section 1.1). Use axle RC height from table at current travel.
4. Pitch: anti-dive/anti-squat as tan(theta_f,r) from a side-view IC height table (add one table per axle if absent), reduce pitch
   moment by the geometric share. Without a table, a constant percentage per type is acceptable but must be labelled approximate.
5. Steering torque readout (optional, for FFB/gauge): T = Fy*(t_pneumatic + t_caster) + scrub_radius * (Fx_brake) per wheel, via
   KPI. Tyre model must supply pneumatic trail fade near the limit, else it is a made-up number.
6. Unit tests worth adding: (a) zero-lateral/zero-roll symmetry, (b) total LLT invariant to RC height, (c) K_rs formula equals
   simulated steady-state delta within tolerance on a skidpad, (d) camber thrust sign convention.

## 4. Honest list: what a driver can feel at <= 1 g in a road car

Likely felt (large enough, sim can show):
- Wheel rate / motion ratio / spring + ARB roll stiffness => ride frequency, roll angle (this is spring tuning, not type).
- Bump steer and compliance on rough surfaces (transient twitch on pave/kerbs, ~0.03-0.05 g peak for a 0.5 deg toe bump) [D].
- Rear toe-in under lateral load (compliance/roll steer) as stability margin at speed and in lift-off: 0.2-0.7 deg of toe [E];
  felt as "planted", only in aggregate and only if the tyre model is faithful.
- Brake-pull / kickback from scrub radius and wheel-centre offset, and torque steer on FWD (via FFB torque or yaw twitch). Real, but needs the steering channel.
- Front/rear balance shift from roll-centre heights and ARB choice (changes K by a few tenths of deg/g) [E].

Borderline (only side by side or near the limit):
- Strut vs DW outer-tyre camber in roll: ~0.3-0.6 deg difference at 0.5 g, ~1-2% of axle lateral force; about 2-3% peak-grip equivalent
  at 0.9 g [E/D].
- Jacking: 1-10 mm ride-height change at full cornering [S optimumg]; invisible below ~0.5 g.
- Roll-centre height changing roll angle by ~0.1-0.2 deg at 0.5 g [E].
- Anti-dive 20-40%: 0.1-0.3 deg of pitch difference at 0.3-1 g braking [E].

Too small to feel in a road car at <= 1 g, do not claim as handling differences:
- Camber gain differences as a "grip" advantage in everyday driving; RC height as a "grip" lever (total LLT unchanged) [D];
- MacPherson vs wishbone as lap-time or limit-handling differences in a road-car model; scrub radius changes of a few mm;
- Caster camber gain at high speed [S optimumg Q&A].

## 5. Presenting small differences without exaggerating
- Show computed deltas with units and an explicit baseline: "outer-front camber at 0.5 g: 0.9 deg vs 0.4 deg (strut vs DW)",
  plus the consequence in the same units as the user feels: "~1% lateral force". Pair every metric with an effect size.
- Use shared, deterministic scenarios (same steering/throttle script, same road seed): replay A/B overlays of the SAME input; never
  tune a scenario until the type difference looks big. Show the sim's own seeded run-to-run noise floor as a band.
- Never visually exaggerate camber/roll/pitch unless the HUD says "x5 exaggeration" in the same frame; prefer overlaying numeric
  bars with honest axes starting at zero.
- Rank by magnitude, e.g. a tornado chart of understeer-gradient contributions (tyres, LLT distribution, roll steer, compliance,
  camber) in deg/g; roll steer and camber will look like 5-15% slices, which is the truth.
- Label provenance: "model output, generic parameters (not a specific car)", "approximate: compliance and grip-vs-camber are assumed, not measured". Use ranges not point values for [E] numbers.
- Tell the user explicitly when a difference is below perceptual threshold: "a driver would not notice this at <= 0.5 g". (I found
  no sourced just-noticeable-difference values for yaw/roll; do not quote any.)

## Recommendation for Suspension Lab
1. Keep the lookup-table architecture; it matches industry real-time practice (VI-CarRealTime converts templates to curves before running). Do not adopt full multibody solving.
2. Drive tyre inclination and toe directly from per-wheel table outputs so roll steer, bump steer and camber-in-roll emerge without separate coefficients.
3. Add a per-axle linear compliance-steer term (deg per N lateral force) as the multi-link differentiator; mark constants [E] in UI and code comments.
4. Implement load transfer as geometric + elastic + unsprung with the RC-height arm; add a unit test that total LLT is RC-invariant.
5. Add jacking from IC angles (needs IC height and lateral offset per wheel); expect 1-10 mm; clamp and low-pass it.
6. Add side-view IC table per axle for anti-dive/anti-squat; if not available, constant percent per type labelled approximate (strut and DW can share 30%).
7. Camber thrust: Cgamma = Calpha/10..15 for radials, fade beyond ~8-10 deg; keep peak-mu camber sensitivity as a tunable (~2%/deg [E]).
8. Make steering-torque (SAT + scrub) an optional readout only if the tyre model has pneumatic-trail fade; otherwise omit rather than fake it.
9. Present type differences as small, quantified deltas (deg, N, mm, deg/g); include a tornado of understeer contributions and an A/B replay; never exaggerate visuals without a label.
10. Expect strut vs wishbone vs multi-link to differ most visibly on rough-road response (bump steer, compliance, MR/wheel rate), not on smooth-road grip.
11. Reuse allowance: Chrono (BSD-3-Clause) JSON hardpoints/spring values can seed generic DW and multi-link tables with attribution; AC, rF2, BeamNG, VI-grade are ideas only.
12. Risks: many numbers here are [E]; the biggest unverified ones are compliance-steer coefficients, grip-per-degree camber, and road-car roll/pitch gradients. Validate against a published K&C sheet before showing as data.
13. Risk: aggregate stability feel depends on tyre-model fidelity (relaxation length, pneumatic trail); get that right before tuning geometry details.
14. Risk: cross-checking against Gillespie requires the book (only a mirror, dokumen.pub, was fetched); cite the book not the mirror.
