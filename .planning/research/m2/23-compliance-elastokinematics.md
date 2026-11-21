# M2 research 23: suspension compliance (elastokinematics), modelled simply and honestly

Tags: [S] sourced (link), [S-sim] sourced but from a multibody simulation report, not a rig test, [S-weak] forum/student/OCR source,
[D] derived by me from a sourced equation, [E] estimate. Firecrawl was not used (503 risk per brief); Tavily search/extract only.
Primary books (Gillespie, Milliken, Reimpell, Heißing/Ersoy, Dixon) were NOT available as clean text; Gillespie was read through a
mirror and the Liege course slides, Reimpell through an OCR'd PDF mirror. Cite the books, not the mirrors. No code edited.

## 0. Answer in six lines

1. Real K&C numbers are small. Lateral-force compliance steer is ~0.01 to 0.05 deg/kN per wheel on production cars, camber compliance
   0.06 to 0.3 deg/kN, lateral wheel compliance 0.3 to 3 mm/kN, longitudinal compliance 0.7 to 4 mm/kN [S/S-sim/S-weak, §2].
2. CORRECTION to research 05 §1.3: it estimated rear toe-in "0.01-0.04 deg per 100 N" (0.1-0.4 deg/kN). That is about 10x too high.
   Sourced values are 0.01-0.05 deg/kN, so rear toe at 0.5 g is ~0.04-0.12 deg, not 0.2-0.7 deg [D, §3].
3. Steady-state understeer budget: lateral-force compliance steer (front + rear) is ~0.05-0.4 deg/g out of a 2-4 deg/g total
   (about 3-10%); lateral-force camber compliance ~0.05 deg/g. Neither separates strut/wishbone/multi-link by more than ~0.2 deg/g [D].
4. The compliance quantity that differs most by DESIGN INTENT (not by type name) is toe under longitudinal force on the rear axle:
   a Mercedes S-class multi-link is documented at about +0.09 deg/kN toe-in under braking [S, Reimpell], a double-wishbone demo
   simulation shows ~0.00 [S-sim]. That is a trail-braking / lift-off stability effect (0.1-0.3 deg of rear toe), the one place a
   driver could plausibly feel "multi-link rear" in manual driving.
5. Coefficients can be derived from OUR hardpoints plus an assumed bushing-rate recipe (§5), so differences come from geometry, not
   hand-picked numbers. Result scales as 1/stiffness, sign depends on rate ratios, so show a +/-2x band and label "assumed bushing rates".
6. Recommendation: add a small, linear, per-axle compliance matrix (4 to 6 coefficients, §4) fed by tyre Fy/Fx/Mz; derive it once at load
   time; keep it OFF the headline "type A beats type B" narrative; treat the roll-steer/bump-steer tables already in the app as the
   bigger lever.

## 1. K&C test definitions (what the numbers mean)

- K&C = quasi-static rig test: kinematics (toe/camber/track/RC vs wheel travel, roll, steer) and compliance (deflection under
  contact-patch forces/moments with the body fixed). [S: https://www.morsemeasurements.com/what-is-kc-testing]
- Morse description: lateral compliance test gives axle steer, lateral toe stiffness, lateral camber stiffness; longitudinal
  compliance test gives longitudinal toe stiffness, camber stiffness, anti-dive/squat angles. [S, same URL]
- MTS PC K&C rig envelope (shows the load range the figures are measured over): +/-15 kN lateral, +/-15 kN longitudinal,
  +/-1000 N*m Mz, up to 30 kN vertical per wheel. [S: https://www.mts.com/en/products/automotive/full-vehicle-test-systems/kinematic-compliance-systems]
  So "deg/kN" is linearised around 0 to ~3 kN, which is exactly our driving range at <= 1 g.
- Standard compliance KPI list (RACE Software report, mirrors a rig report): brake steer deg/kN; braking castor compliance deg/kN;
  contact-patch longitudinal compliance mm/kN; traction steer deg/kN; wheel-centre longitudinal compliance mm/kN; camber compliance
  in-phase deg/kN; contact-patch lateral compliance mm/kN; lateral compliance steer in-phase deg/kN (at 0 and 30 mm pneumatic trail);
  aligning-torque toe compliance deg/kNm. [S-sim: https://race.software/wp-content/uploads/2024/05/RACE_Software_Demo_Simulation_Double_Wishbone_Suspension_STANDARD.pdf]
- Sign convention to adopt (RACE's): lateral compliance steer positive = toe-IN under INBOARD lateral force on that wheel; brake/traction
  steer positive = toe-in; camber compliance positive = top of wheel outboard under inboard force. Aligning torque compliance positive =
  toe change in the direction of the moment (wheel steered with the moment). [S-sim, same URL]
- MATLAB Vehicle Dynamics Blockset "Independent Suspension - K and C" exposes the same set as tables per wheel: steer vs Fx (deg/kN), steer
  vs Fy opposed (deg/kN), camber vs Fy (deg/kN), lateral wheel-centre displacement vs Fx, castor vs steer; Fx/Fy/Mz are the compliance
  inputs. [S: https://www.mathworks.com/help/vdynblks/ref/independentsuspensionkandc.html] Same architecture as VI-CarRealTime curve
  models (research 05 §2). Proprietary: ideas only.

## 2. Published compliance data (collected)

### 2.1 Per-wheel / per-axle K&C values

| Source | Car / axle / type | Lateral steer deg/kN | Camber compl. deg/kN | Lateral compl. mm/kN | Long. / braking | Tag |
|---|---|---|---|---|---|---|
| RACE Software demo (DW, front) | generic double wishbone | -0.036 (0 mm trail), -0.045 (30 mm trail) = toe-OUT under load | +0.061 | 0.393 (patch) | brake steer -0.010 deg/kN; traction steer +0.016 deg/kN; patch long. 3.6 mm/kN; wheel-centre long. 0.74 mm/kN; braking castor -0.464 deg/kN; Mz toe compliance 0.32 deg/kNm | [S-sim] (same URL as §1) |
| RACE Software "ADVANCED" report (same DW) | generic DW | -0.026 / -0.035 | +0.054 | 0.336 | Mz toe compliance 0.288 deg/kNm | [S-sim] https://race.software/wp-content/uploads/2024/05/RACE_Software_Demo_Simulation_Double_Wishbone_Suspension_ADVANCED.pdf |
| Eng-Tips post, measured on own race car (steering rack blocked) | front MacPherson | -0.16 (toe-out) | +0.26 | not given | not given | [S-weak] https://www.eng-tips.com/threads/suspension-lateral-compliance.432856 (poster: "car feels very understeer and stable", main deflection in bearings, knuckle, steering-arm twist) |
| same post | rear semi-trailing arm | -0.03 | +0.35 | n/a | n/a | [S-weak] same |
| Olschewski & Fang, World Electr. Veh. J. 2024, 15, 310 (measured prototype in a B-class) | rear multi-link torsion axle (MLTA), two variants | -0.05 and -0.01 (variant C "clearly closer to neutral"); text says the toe-in tendency of the torsion-beam element is partly cancelled by a toe-out tendency of the bushing setup | 0.18 and 0.30 (+67%, attributed to one bushing deviating from design target) | 2.94 and 3.27 (includes a 30 mm pneumatic-trail moment) | n/a | [S] https://pdfs.semanticscholar.org/b437/072be8e8dcdabd1b8c69511e41d36b7636c8.pdf |
| Pelican Parts forum thread (search snippet only; page returned 403) | Porsche 911 rear (generation unspecified) | toe compliance "<0.02" | n/a | tyre-patch 1.4 mm/kN (without tyre); wheel-centre 0.2 mm/kN | n/a | [S-weak] http://forums.pelicanparts.com/porsche-911-technical-forum/656449-rear-suspension-compliance.html (could not read the thread; treat as an order-of-magnitude hint) |
| Reimpell et al., The Automotive Chassis (OCR mirror https://dl.icdst.org/pdfs/files/f6384a85204032eeeb1140e37fbfc49b.pdf), Fig 3.64 | Mercedes-Benz S-class multi-link rear, one wheel | n/a | n/a | n/a | OCR text: drive-off force 3 kN at wheel centre adds +3' toe-in; braking force 1.89 kN at contact patch adds +10' further toe-in "for elastokinematic reasons". [D]: 10'/1.89 kN = 0.088 deg/kN braking toe-in; 3'/3 kN = 0.017 deg/kN under drive. OCR-reading risk: check against the printed figure before showing. | [S, OCR] |
| Chalmers thesis (Volvo S60 on an SPMM K&C rig) | front and rear | absolute values removed for confidentiality; only shows rear lateral stiffness > front, and that a body-stiffening change moves wheel-centre lateral compliance by 7-10% | | | | [S] https://publications.lib.chalmers.se/records/fulltext/219391/219391.pdf |
| IJFMR 2025 benchmarking of 6 production cars (mix of twist-beam and multi-link rears; sign convention unclear, suspension type per car not extracted) | front: lateral axle stiffness 703-1554 N/mm, compliance steer -0.60 to -2.98 mrad/kN (= -0.034 to -0.17 deg/kN); rear: axle stiffness 386-765 N/mm, compliance steer -0.95 to +0.40 mrad/kN (= -0.054 to +0.023 deg/kN) | | | axle lateral stiffness 386-1554 N/mm = 0.64-2.6 mm/kN per kN of axle force | roll-steer coefficients front -10% to -4%, rear +1.3% to +16.6% | [S-weak] https://www.ijfmr.com/papers/2025/2/39846.pdf |

Reading the table honestly:
- Lateral steer compliance is almost always |c| <= 0.05 deg/kN on well-controlled axles. The 0.16 value is a race car with a
  flexible steering arm, not a design target. Camber compliance is typically 0.05-0.3 deg/kN.
- The RACE reports are simulations with assumed bushing/joint stiffness, not measured cars. Use them for structure and order of
  magnitude only. [S-sim]
- I found no public K&C datasheet with matched front-and-rear numbers for a strut car, a DW car and a multi-link car. Morse and MTS
  publish methods and capabilities, not customer results. The cross-architecture claim "type X has coefficient Y" is therefore not
  something we can source; only ranges per axle role are. Say this in the UI.

### 2.2 Design target ranges used by an understeer-budget exercise [S-weak]

A student project following the Gillespie/Bundorf method (Skill-Lync) lists constraint ranges, i.e. what a designer would accept:
https://skill-lync.com/student-projects/vehicle-dynamics-final-project-design-of-arb-to-meet-target-roll-gradient-and-selection-of-k-c-parameter-to-meet-the-target-understeer-budget

| Parameter | Front range | Rear range |
|---|---|---|
| Lateral force compliance steer (deg/kN) | 0.008 to 0.05 | 0.015 to 0.04 |
| Lateral force compliance camber (deg/kN) | 0.1 to 0.3 | 0.15 to 0.4 |
| Aligning torque compliance steer (deg/100 N*m) | 0.2 to 0.4 | 0.06 to 0.1 |
| Roll steer (% of roll angle) | +3 to +6.5 | -8 to -4 |
| Roll camber (% of roll angle) | 80 to 90 | 50 to 65 |

Their resulting budget (total 2.017 deg/g): weight distribution 0.443 (21.9%); roll steer 0.558 (27.7%); roll camber 0.115 (5.7%);
aligning torque 0.169 (8.4%); lateral-force compliance steer 0.152 (7.5%); lateral-force compliance camber 0.052 (2.6%);
aligning-torque compliance steer 0.529 (26.2%). [S-weak]
My check: front lateral-force compliance steer 0.188 deg/g = 0.05 deg/kN x (W_f/2 = 3.76 kN), consistent with W_f ~7.5 kN and the
formula in §3 (steer per g = c x W_axle / 2). The rear entry does not reproduce from the stated rear range, so treat the table as an
illustration of magnitudes, not as data.

### 2.3 Context numbers [S]
- Passenger cars lightly loaded: understeer 3-5 deg/g; sports cars 1-2 deg/g. [S: Gillespie declaration, https://rohva.org/wp-content/uploads/2019/02/ROHVA_-_Exhibit_2_-_Dr_Thomas_Gillespie.pdf]
- Aligning-torque contribution to K is always understeer, typically < 0.5 deg/g. [S: Liege slides http://www.ingveh.ulg.ac.be/uploads/education/MECA0525/12_MECA0525_VEHDYN2_ROLL_2021-2022.pdf]
- Gillespie eq. 6-58: lateral-force compliance coefficient = d(steer)/d(Fy) (deg per unit lateral force); a rearward yaw centre on a
  front axle is oversteer, forward is understeer; on a rear axle a forward yaw centre gives oversteer and rearward gives understeer.
  [S: Gillespie via mirror https://dokumen.pub/fundamentals-of-vehicle-dynamics-9781560911999-1560911999.html and the Liege slides]
- Camber thrust: 10-15 deg of camber equals 1 deg of slip on a radial tyre. [S: Gillespie, same mirror]

## 3. Understeer-gradient bookkeeping with these coefficients [D]

Setup for the worked numbers: 1700 kg, 51/49 weight distribution, W_f = 8.51 kN, W_r = 8.17 kN, pneumatic trail 20-30 mm, tyre
C_alpha ~ 1480 N/deg per wheel (the Chrono value used in research 04) [E for the car, S for C_alpha via 04].

Definitions (RACE sign: c = toe-in per kN of INBOARD force on that wheel). In a turn the outer wheel sees inboard force and the
inner wheel sees outboard force, so outer toe-in plus inner toe-out steer the axle in the same direction (into the turn).
Axle steer into turn at 1 g = c x W_axle / 2 (deg, W in kN). Contribution to K (deg/g):
- front axle: K_f,lfcs = -(c_f x W_f / 2)  (toe-in under load = steer into turn = oversteer; toe-out = understeer)
- rear axle:  K_r,lfcs = +(c_r x W_r / 2)  (toe-in under load = understeer)

| Case | c (deg/kN) | K contribution (deg/g) |
|---|---|---|
| Front, DW demo [S-sim] | -0.036 | +0.15 |
| Front, design-target band upper | -0.05 | +0.21 |
| Front, flexible race car [S-weak] | -0.16 | +0.68 (not a road-car design) |
| Front, tight | -0.01 | +0.04 |
| Rear, neutral | 0.00 | 0.00 |
| Rear, mild toe-in 0.015 | +0.015 | +0.06 |
| Rear, designed toe-in 0.03 | +0.03 | +0.12 |
| Rear, strong toe-in 0.05 | +0.05 | +0.20 |
| Rear, mild toe-out (semi-trailing hint) | -0.03 | -0.12 (oversteer) |

- Aligning torque, per wheel at 1 g, Mz = (W_f/2) x trail = 85-128 N*m. Knuckle-only suspension compliance 0.32 deg/kNm [S-sim]
  gives only 0.03-0.04 deg/g. The 0.2-0.4 deg/100 N*m in the student budget (2-4 deg/kNm) gives 0.2-0.5 deg/g. The ~10x gap is the
  steering system (rack, tie rods, column torsion), not the suspension type. For a keyboard/gamepad driver with no wheel torque this
  matters only as an effective steering ratio loss. Treat it as a steering-system parameter, not a suspension-type parameter.
- Camber compliance: c_gamma 0.06-0.3 deg/kN x ~4.2 kN outer-wheel force at 1 g = 0.26-1.3 deg extra positive camber on the outer
  wheel; with C_gamma = C_alpha/(10..15) that is 25-190 N, i.e. ~0.5-4.5% of that wheel's force; as slip-equivalent about 0.02-0.13 deg
  per wheel. The student budget has 0.052 deg/g for the sum. Order 0.05 deg/g.
- Roll steer (for comparison): K_rs = (e_f - e_r) x roll gradient (Gillespie 6-57 [S]). With the student's front +6.5% / rear -8% and
  ~3.5 deg/g roll: 0.5 deg/g [S-weak]. Twist-beam roll-steer factor 0.025-0.1 depending on load [S, Reimpell OCR]. Roll steer is the
  bigger and already-implemented knob.

Summary of what differs between types in the understeer budget (steady state, <= 1 g) [D]:
| Contributor | Typical size | Type-dependent? |
|---|---|---|
| Weight distribution/cornering stiffness | 0.4-1+ deg/g | no (tyres, mass) |
| Roll steer | 0.2-0.6 deg/g | yes, from kinematic tables (already modelled) |
| Roll camber | ~0.1 deg/g | yes (tables) |
| Lateral-force compliance steer, front + rear | 0.05-0.4 deg/g | weakly, by design intent |
| Lateral-force compliance camber | ~0.05 deg/g | weakly |
| Aligning-torque (tyre) | 0.04-0.2 deg/g | no (tyre pneumatic trail, caster) |
| Steering-system compliance | 0.2-0.5 deg/g | no (steering system) |

Transient and brake-in-turn effects (the part drivers can feel), [D]:
- Rear toe-in under braking: 0.088 deg/kN (S-class) x 2.9 kN per rear wheel at 1 g (65/35 brake split) = 0.26 deg per rear wheel; at
  0.5 g braking, 0.13 deg. With C_alpha 1480 N/deg that is ~190 N per rear wheel at 0.5 g braking, versus ~4 kN rear axle lateral force at
  0.5 g cornering: ~9% extra rear lateral force. This is the Weissach/multi-link lift-off stabiliser, it is real, and it is the
  largest compliance effect I can source. A DW car with ~0 brake steer [S-sim] lacks it unless designed in. Not type-inherent.
- Braking-force longitudinal compliance: RACE DW 3.6 mm/kN at the contact patch (includes brake-torque windup) x 5.4 kN per front wheel
  at 1 g = ~19 mm of rearward patch motion [D, S-sim]. Wheel-centre longitudinal compliance 0.74 mm/kN [S-sim]; 911 rear 0.2 mm/kN
  [S-weak]. Longitudinal softness is about impact harshness (NVH), not handling; it changes the response to a pothole or kerb impact
  as a short fore-aft transient. Multi-link/strut with soft longitudinal bushings can be softer longitudinally while keeping lateral
  toe stiff because the link layout separates the directions [S: https://en.wikipedia.org/wiki/Multi-link_suspension].

## 4. How multi-link rears get toe-in; strut and wishbone comparison

- Principle (Gillespie fig 6.18, via Liege slides [S]): lateral force at the contact patch acts through the axle's yaw centre (the
  intersection of the lines of the links that resist the force). If the rubber at the links lets the axle rotate about that centre, the
  wheel steers; geometry sets the sign, bushing rates set the size.
- Five-link compliance steer, mechanism (Extrica paper) [S: https://www.extrica.com/article/17580]: lower drag links parallel to the car
  axis; the intersection of the upper drag links is the axle yaw centre; a transverse push rod lies BEHIND the axle with bushings
  "almost five times as stiff" as those in the drag links; under cornering the lateral force is mostly taken in the push rod
  bushings so the whole rear axle turns in the same direction as the front wheels (rear steer in phase = understeer/stability).
- Mercedes and BMW multi-link (Reimpell [S, OCR]): "open link design makes it possible to have an inwardly inclined elastokinematic axis of
  rotation, so that a stabilising toe-in position of the rear wheels is produced during braking. The axle can also be designed to
  understeer when subject to lateral forces." Kinematic toe change over jounce on the S-class rear is nearly zero (Fig 3.64), so
  stability is delivered by compliance (design-in), not by kinematic toe curves.
- Weissach axle (Porsche 928) [S]: a semi-trailing arm with rubber bushings toes OUT under braking/lift-off (the car's momentum pulls it
  from the axle) and oversteers; splitting the trailing link into two pieces with a pivot turned that into toe-in
  [S: https://www.autozine.org/technical_school/suspension/tech_suspension21.htm]. Porsche engineers: it "didn't make the car any faster in
  curves, but it did make it much easier to handle"; the axle later handled lateral forces as well in the 993. [S:
  https://newsroom.porsche.com/en/innovation/engineering/porsche-928-weissach-axle-transaxle-chassis-technology-front-engine-15493.html]
- Vehicle-dynamics reason (Mitschke-style lecture notes) [S: https://www.euromotor.org/pluginfile.php/1497/mod_resource/content/0/pdf_script/lecture2_lateral_dynamics.pdf]:
  lateral force on the front rising while the rear loses force on lift-off gives a turn-in yaw moment; rear toe-in at the outer wheel
  from compliance adds lateral force at once ("passive rear-axle steering"); traction force toe-out plus brake force toe-in on the
  outer rear counters load-alteration oversteer.
- Contrast: twist-beam rears tend to compliance-oversteer unless a Panhard rod is placed behind the axle; strut/DW fronts are normally
  designed toe-out-under-lateral-force (understeer) and tied to steering-system stiffness [S-weak: IJFMR, Reimpell OCR].
- What is NOT sourced: a general rule "multi-link has more toe-in than DW". The better statement, supported by the sources above, is
  "multi-link gives the designer independent control of toe/lateral/longitudinal compliance, so designers use it to get toe-in".
  Honest labelling: "design freedom", not "better".

## 5. Modelling approaches (simple to derived)

### 5.1 Linear compliance coefficients on top of kinematics (recommended runtime form)
Per wheel, per step (all inputs already exist in the sim: tyre Fx, Fy, Mz at the patch):

    toe_eff   = toe_kin(z, rack) + c_fy_toe * Fy_in + c_fx_toe * Fx + c_mz_toe * Mz
    camber_eff = camber_kin(z, rack) + c_fy_camber * Fy_in
    lateral_patch_shift_y = c_fy_y * Fy_in            (optional, tyre-relaxation-like softening)
    longitudinal_shift_x  = c_fx_x * Fx               (optional, impact-harshness fore/aft)

with Fy_in the lateral force on that wheel signed positive toward the car centre (so outer wheel positive) and units kN, c in deg/kN
(RACE signs, §1). This is exactly the compliance-matrix pattern of K&C-curve models (VI-CarRealTime, CarSim, CarMaker; MathWorks block
parameters as listed in §1). [S for the architecture, E for the coefficient values.] It is linear in force, so deterministic and
cheap; 4 multiply-adds per wheel.

Rules to keep it well behaved at 240 Hz:
- Low-pass (first order, ~20-40 ms) the compliance toe before it reaches the tyre; real bushing/rubber hysteresis plus tyre relaxation
  makes instant feedback of Fy into slip angle a numerical loop (toe -> slip -> Fy -> toe). With |c| ~0.03 deg/kN and
  C_alpha ~1.5 kN/deg per wheel the loop gain is 0.03 x 1.5 = 0.045 per kN, well below 1, so it is stable even without filtering;
  a small filter only avoids visible jitter. [D]
- Clamp the compliance toe at +/-0.5 deg (physically it saturates at bump stops/bushing rate hardening).
- Use per-axle sign flips for the inner wheel by feeding SIGNED Fy_in (inner wheel inboard-sign negative); no special code.

### 5.2 Deriving the coefficients from hardpoints + assumed bushing rates (recommended for build time)
Idea: treat the wheel carrier as a rigid body held by 5 two-force links (all three of our types reduce to 5 constraint links plus a
locked spring): double wishbone = 2 links per arm x 2 arms + tie rod = 5; multi-link = 5 links; MacPherson = 2 LCA links + tie rod +
2 constraints at the strut top (fore-aft and lateral at the top mount/rod bearing; the strut slide itself is the travel DoF).
[D, structural count; the 5-link/1-DoF statement is standard kinematics.]

1. For link i with unit direction u_i (from chassis point to carrier point, evaluated at static ride height) and carrier attachment
   point p_i, build the Plucker wrench w_i = [u_i ; (p_i - o) x u_i] about a reference point o (wheel centre or contact patch).
2. Link axial stiffness k_i = series of its two end bushings along the link axis (k_i = k_b1 k_b2 / (k_b1 + k_b2); rods and
   ball joints are far stiffer, ignore them in the first cut). For a strut top constraint use the top-mount radial rate.
3. Add the locked spring/vertical DoF: add a 6th term k_w x w_s w_s^T with w_s the travel-motion screw and k_w the wheel rate (the
   existing motion-ratio table gives k_w). Without it K is singular (1 free DoF).
4. K = sum_i k_i w_i w_i^T (6x6). Compliance C = K^-1 (6x6). Apply a wheel load vector f = [Fx, Fy, Fz; Mx, My, Mz] at the contact patch
   (translate to o). Carrier deflection d = C f; read toe from the rotation about z and camber from the rotation about x; lateral
   and longitudinal patch deflection from the translation (+ rotation x lever).
5. Coefficients: c_fy_toe = d_theta_z / Fy, c_fy_camber = d_theta_x / Fy, c_fx_toe = d_theta_z / Fx, c_mz_toe = d_theta_z / Mz,
   plus patch translations. Compute these once at the static ride-height pose (or at 3 travel stations and interpolate, if
   we want travel dependence).
6. Sign/size sanity: a rigid-bushing limit gives c -> 0; halving every k doubles every c exactly (all outputs scale with 1/k, the
   scaling property stated by opensus too [S: https://opensus.app/docs/compliance]); the SIGN depends on the ratios between the
   rates of the links, which is where designers tune (e.g. the "5x stiffer push rod behind the axle" in §4).

Cheaper alternative if time-boxed: use only the in-plane (top-view) 3-DoF reduction (x, y, yaw) for toe and lateral/longitudinal patch
compliance: K3 = sum_i k_i [u_ix, u_iy, (r_i x u_i)_z] [..]^T over the links that act in the horizontal plane. That gives toe-vs-Fy,
toe-vs-Fx and toe-vs-Mz in a dozen lines and reproduces the yaw-centre logic of Gillespie fig 6.18. Camber compliance then needs
the front-view analogue (3-DoF y, z, roll) the same way.

Prior art for the exact idea: opensus (web tool, proprietary, not copyable) gives every link and joint the same reference stiffness
(10 kN/mm by default), applies unit loads at the contact patch (1 kN lateral, 100 N*m aligning torque, 1 kN braking/drive), solves for
upright motion, and combines front/rear toe change into "compliance understeer in deg/g", with the explicit caveat "comparisons between
layouts, not predictions. Real bushings ... are usually softer". Its stated drivers: tie-rod load = 100000/steering arm mm per 100 N*m,
ball-joint spacing, pivot base, toe-link position relative to the ball-joint line. [S: https://opensus.app/docs/compliance] Ideas
only. Our version differs: we put in realistic differentiated rates, not one rate.

### 5.3 Bushing rate recipe (the [E] part, all must be labelled)
- Rubber bushing radial stiffness from geometry: K_r = 7.5 pi L G / [ln(r2/r1) S_i-correction] (Freakley form), worked example 59 550 lb/in
  (~10.4 kN/mm) for a 56 mm OD, 36 mm ID, 60 mm long, 60 Shore A bush, within ~10% of lab measurement and 8% of FEA [S:
  https://www.bushingdesign.com/wp-content/uploads/2022/04/Bushing-Design-Overview.pdf]. That is a stiff bush; production compliance
  bushes are far softer.
- Production inner-pivot radial rates are typically 1-10 kN/mm with "compliance" bushes (e.g. LCA rear, trailing-arm front) at the soft
  end 0.5-3 kN/mm [E, my knowledge; no clean primary source found]. Axle lateral stiffness measured on production cars is 386-1554 N/mm
  [S-weak, IJFMR] which equals 0.64-2.6 mm/kN; use it as a CALIBRATION TARGET: pick rates so the model's axle lateral stiffness
  falls in that range, front above rear (Chalmers Volvo S60: rear axle lateral stiffness higher than front [S]; IJFMR shows the
  opposite, front 703-1554 vs rear 386-765 N/mm, so the ordering is car-specific; do not hard-code it).
- Recipe: one shared rate table per link ROLE (lateral control link, toe link, trailing/longitudinal link, LCA front pivot, LCA rear
  "compliance" pivot, strut top mount) applied to ALL three types, so the architecture difference comes from where the lines of action
  run, not from which type got "better" bushings. Where a role does not exist in a type (e.g. no trailing link in a DW),
  the geometry decides. Publish the rate table in the UI as an assumption.

## 6. Does it make type matter under manual driving without inventing advantages?

What the physics supports:
- Steady-state cornering at <= 1 g: compliance differences between types are ~0.1-0.3 deg/g of understeer gradient on a 2-4 deg/g
  baseline [D]. That is detectable in an A/B skidpad plot, not as a handling revelation.
- Trail braking / lift-off in a corner: rear toe-in from longitudinal compliance up to ~0.1-0.3 deg per rear wheel (~9% extra rear lateral
  force at 0.5 g braking, §3) when the design intends it [D, S]. This is the one effect that makes a multi-link (or Weissach-type)
  rear feel "planted on lift-off" in a manual drive and a naive semi-trailing/DW rear feel loose. It is design-intent, so a type "default"
  must state it as the typical designer choice, not a law.
- Kerb/pothole hits: bump steer (kinematic, already modelled) and longitudinal compliance (impact harshness, fore-aft transient)
  differ; the latter is only felt through the camera/seat-of-pants channel, which the app has not got beyond camera pitch.

What it does not support:
- "Multi-link/DW grips more" via compliance: no. Compliance mostly shifts balance by tenths of deg/g and stability, not peak grip.
- Showing large K&C difference between type names as if sourced: we have no matched public data (§2.1).

Risk of inventing advantage: because 1/k scaling and sign set by rate ratios, a hand-picked rate set can make any type look
good. The derivation in §5.2 with ONE shared role-based rate table, plus a +/-2x sensitivity band, is the defence.

## Recommendation for Suspension Lab

1. Add a per-wheel linear compliance step: toe += c_fy_toe*Fy_in + c_fx_toe*Fx + c_mz_toe*Mz; camber += c_fy_camber*Fy_in; units deg/kN, RACE sign convention. Keep it separate from the existing travel tables so it can be switched off (module toggle) and A/B-tested.
2. Derive coefficients offline (build time or module init) from our hardpoints and a shared role-based bushing-rate table via the 5-link plus locked-spring stiffness-matrix method (§5.2), not hand-picked per type. Start with the 3-DoF top-view reduction for toe; add front-view camber later.
3. Calibrate the shared rates so the derived axle lateral stiffness lands in 0.6-2.6 mm/kN per axle and per-wheel lateral steer compliance in 0.01-0.05 deg/kN magnitude; clamp compliance toe to +/-0.5 deg. Anything outside is a bug or a flagged non-road-car setup.
4. Do NOT use research 05's rear compliance guess of 0.2-0.7 deg at 0.5 g; replace with 0.04-0.12 deg (0.015-0.05 deg/kN) per this note. The earlier figure was ~10x too high.
5. Expose compliance in the understeer-budget "tornado" as its own small slices: front lateral compliance steer 0.04-0.2 deg/g, rear 0.0-0.2 deg/g, camber compliance ~0.05 deg/g, aligning torque ~0.04 deg/g (knuckle only). Show them at true size, next to roll steer 0.2-0.6 and weight distribution 0.4+.
6. Treat steering-system compliance (0.2-0.5 deg/g) and aligning-torque effects as a steering-module parameter shared by all types, not as a suspension-type difference.
7. Give each type a default with explicit provenance: front strut/DW: lateral steer c ~ -0.01 to -0.05 deg/kN (toe-out under load); rear multi-link: +0.015 to +0.05 deg/kN toe-in lateral and ~+0.05 to +0.09 deg/kN toe-in under braking (design intent, Reimpell S-class [S, OCR]); DW rear: ~0 brake steer (RACE sim [S-sim]); label as "typical designer intent, not measured on a specific car".
8. Make braking/lift-off the demonstrable difference: run a scripted A/B (same input, same road) of trail-braking in a 0.4-0.6 g corner, show rear toe, rear Fy and yaw-rate delta; honest expected effect: 0.1-0.3 deg rear toe, ~5-10% rear lateral force.
9. Show uncertainty: render the coefficient as a band (rate x0.5 to x2 -> coefficient x2 to x0.5), and state "assumed bushing rates, derived from this geometry".
10. Keep the filter small (20-40 ms) and gain-check in a unit test: loop gain c*C_alpha*dt-lag < 0.2 for all types; zero compliance must reproduce the current kinematics-only outputs exactly (regression test).
11. Unit tests: (a) scaling: halving all rates doubles every coefficient; (b) mirror symmetry left/right with signed Fy_in; (c) rigid limit (rates x1000) gives coefficients ~0; (d) rear-in-plane toe sign flips when the push/toe link moves from ahead of to behind the ball-joint line (Gillespie fig 6.18 logic); (e) toe-in on outer rear equals understeer in a skidpad run.
12. Do not model torque steer, brake judder or kickback; they need the steering-torque channel and scrub/wheel-centre offset (RACE: 67 mm typical strut) which the keyboard/gamepad driver cannot feel.
13. Licensing: no repo code was found or copied here. RACE reports, opensus, MathWorks docs and the books are proprietary or copyrighted: numbers and ideas are cited, not copied. Re-implement the Plucker stiffness method from the maths (a standard statics method, not protected).
14. Risks: (i) no matched K&C data across the three architectures; (ii) sign convention errors are the classic bug here, enforce via unit tests; (iii) the Reimpell braking-toe numbers come from OCR and an S-class that was designed for it; verify against the printed book before quoting in the UI; (iv) bushing rates are [E]; (v) aligning-torque numbers must not be presented as a suspension difference.
15. Verification still to do if time allows: obtain Reimpell Fig 3.64 and Milliken RCVD compliance examples to replace the weak-source rows; request or find an SAE paper with front and rear K&C of one car; replace the Pelican/Eng-Tips rows with rig data.
