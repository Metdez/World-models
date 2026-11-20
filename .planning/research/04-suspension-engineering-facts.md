# 04 - Suspension engineering facts (strut vs double wishbone vs multi-link)

Purpose: numbers and plain-English copy for a truthful kinematic simulation. Research only.
Confidence tags: [V] verified on a fetched/searched source this session; [T] textbook/standard (Milliken RCVD, Gillespie, Dixon) from knowledge, widely consistent, not re-opened today; [E] engineering estimate / typical range, treat as a default not a citation. Per-car specifics marked [U] unverified.

## 0. Sources used
- OptimumG Tech Tip "Springs & Dampers Part 2" (roll gradient and ride-frequency bands, roll-gradient formula): https://optimumg.com/wp-content/uploads/2020/01/SpringsDampers_Tech_Tip_2.pdf [V]
- Suspension Secrets, "Calculating ideal spring and roll bar rates": https://suspensionsecrets.co.uk/calculating-ideal-spring-and-roll-bar-rates [V]
- Ate Up With Motor, MacPherson strut history (camber gain and scrub radius explanation): https://ateupwithmotor.com/terms-technology-definitions/macpherson-strut-history/2 [V]
- PapaCAD kinematics calculator page (example RC height/KPI, MPS vs DWB): https://www.papacad.com/suspension-kinematics-calculator [V as a published example, illustrative]
- Wikipedia "Camber thrust": https://en.wikipedia.org/wiki/Camber_thrust [V]
- ULiege MECA0525 vehicle dynamics slides (camber thrust vs slip, Gillespie fig 6.14): http://www.ingveh.ulg.ac.be/uploads/education/MECA0525/12_MECA0525_VEHDYN2_ROLL_2021-2022.pdf [V]
- RACE Software on strut camber/scrub: https://race.software/suspension-modifications-performance-impact-of-lowered-ride-height-and-wheel-spacers [V]
- Books (not opened): Milliken & Milliken RCVD (1995); Gillespie, Fundamentals of Vehicle Dynamics (1992); Dixon, Suspension Geometry and Computation (2009); Reimpell/Stoll/Betzler, The Automotive Chassis.

## 1. Core principle (the honest framing)
All three are just ways to constrain a knuckle (upright) to move relative to the body. Differences come from WHERE the constraints sit:
- Double wishbone (DWB/SLA): two arms, two ball joints. Camber curve is set by arm lengths/angles; kingpin axis (ball joint to ball joint) is independent of the spring/damper.
- MacPherson strut: lower arm + a sliding strut. The upper "link" is a line perpendicular to the strut axis at its top mount, so it is effectively infinitely long in the strut direction. The damper body is a structural member (takes side loads). Steering axis = lower ball joint to top mount.
- Multi-link: 3-5 links per wheel (typ. 4-5 at rear), each a ball-jointed rod. Gives control over camber, toe, caster and anti-geometry separately; can be made compliant in chosen directions (toe-in under lateral load).

No type is universally best; see tradeoff matrix section 9.

## 2. Camber, roll, and why the outer wheel matters
Definitions. Camber: wheel tilt from vertical, negative = top inboard. Camber relative to body changes with bump: camber gain (deg per mm or deg per deg of body roll).
Key identity (outside wheel in a corner): camber_to_road = camber_to_body(bump) + body_roll_angle (rolling the body outward pushes the outer wheel top outward = positive, unless suspension geometry counters it). Inner wheel: opposite sign. [T]
Camber-in-roll ratio (camber change at the wheel per degree body roll, front):
| Type | Typical camber gain in bump | Camber change per deg roll (negative good) | Notes |
|---|---|---|---|
| MacPherson strut | -0.3 to -0.8 deg per 25 mm bump (roughly -0.012 to -0.03 deg/mm) [E]; can be nearly flat or even go positive past mid-travel; ~ -0.4 to -0.6 deg/deg roll effective [E] | outer wheel typically recovers only 30-60% of body roll => outer tyre ends up with net positive-ish camber to road unless static negative camber is added [T] | Ate Up With Motor: "camber change in compression is very small because the effective swing-arm length is very long" [V] |
| Double wishbone (unequal length, SLA) | -0.5 to -1.5 deg per 25 mm (-0.02 to -0.06 deg/mm) [E]; tunable to ~ -0.8 deg/deg roll or more | 60-100% recovery; racing designs near or above 100% (wheel stays flat to road) [T] | Upper arm shorter and angled so top of wheel moves inboard in bump. Over-aggressive gain = bad braking/bump feel, tyre wear. |
| Multi-link (front, e.g. double-wishbone-like "high-mount upper arm") | similar to DWB, -0.5 to -1.2 deg/25 mm [E] | 60-90% [E] | Front multi-link on e.g. Audi/Mercedes/BMW upper-link designs. Rear multi-link: typ. -0.4 to -1.0 deg/25 mm [E] |
Simple physics check for copy: a roll gradient of ~1.2 deg/g at 1.0 g gives ~1.2 deg body roll; a strut recovering ~50% leaves ~0.6 deg positive camber on the outer tyre vs ground (before static camber). Typical static camber set: -1.0 to -2.5 deg sports car front [E] to compensate.
Visual: under heavy cornering a strut front's loaded outside wheel visibly leans with the body (top outwards), while an SLA keeps it nearly flat.
Camber under steer: caster and KPI cause the steered outer wheel to lean in further negative with steering lock (positive caster + KPI); at lock the inner wheel goes positive. [T]

## 3. Tyre camber sensitivity (how camber affects grip)
- Camber thrust is ~linear for small angles: Fy_camber = C_gamma * gamma. Camber stiffness is much lower than cornering stiffness: for radial tyres about 10-15 deg camber gives the same lateral force as 1 deg slip (bias ply: 4-6 deg) [V, ULiege/Gillespie]. Wikipedia: camber thrust nearly instantaneous (no relaxation length), bias tyres give more than radials [V].
- Practical: C_gamma ~ 0.07-0.10 of C_alpha per deg^-1 ... i.e. C_gamma ≈ 0.05-0.1 × C_alpha [E, consistent with the 10-15:1 quote].
- The real benefit is not thrust but keeping the contact patch flat: peak lateral friction coefficient is maximised near an optimum camber relative to the road (typ. -0.5 to -3 deg for road/track radials; depends on tyre construction, pressure, load) [T/E]. Positive camber to the road (outer wheel leaning outward) is bad: peak Fy drops and heating is uneven (outer shoulder overloaded).
- Rule of thumb for sim: mu_peak(γ) = mu0 * (1 - k*(γ - γ_opt)^2), γ_opt ≈ -1.5 deg (outer wheel, relative to road), k ≈ 0.01-0.02 per deg^2 [E]. At +2 deg positive, loss ≈ 5-15% of peak lateral grip on that tyre [E].
- Excess negative camber (> -4 deg road car tyre) loses braking/straight-line grip and wears the inner shoulder [T]. Milliken-type tests show diminishing returns/peak drop at extreme camber [V, camber-car paper excerpt].

## 4. Roll centre (RC), roll axis, migration
Definition: the point in the transverse plane about which the sprung mass can roll with no lateral force at the axle ends changing the roll (instant centre construction: IC of each wheel via link intersection; RC is where the line from the contact patch through the IC meets the car centreline). [T]
Heights (static, loaded, typical): 
| Type | Front RC height | Rear RC height | Migration in roll/heave |
|---|---|---|---|
| MacPherson strut | 60-130 mm (often 80-120) [E]; PapaCAD example 80 mm [V illustrative] | 100-150 mm (strut rear) [E] | Large lateral shift in roll (PapaCAD example ~300 mm at 2 deg roll vs ~28 mm for DWB sports example [V illustrative]) and ~2 mm RC rise per mm heave vs ~1 mm for DWB [V illustrative]. Because the IC lies far along a long near-horizontal strut-perpendicular line, small geometry changes swing it a lot. |
| Double wishbone | 20-100 mm road car (PapaCAD example 40 mm [V]); race cars 0-150 mm and tuned [T] | 50-150 mm [E] | Moderate; typically 1 mm vertical per mm heave, lateral shift tens of mm; can be designed fairly constant |
| Multi-link | Front: similar to DWB. Rear: 80-150 mm [E] | design-dependent | Controllable; "virtual" ICs mean the effective arm lengths can be made longer than packaging allows |
Effects: higher RC = smaller roll moment arm (CG height - RC axis height) => less body roll per g; but more geometric (jacking) load transfer, track-width scrub, and migration-induced feel changes. Below-ground (negative) RC rare except some beam/swing arms.
Sim recipe: compute IC from link geometry each frame; RC = intersection of (contact patch to IC) with centreline. [T] Sample code idea: line_intersect(P_contact, IC_left, mirror) etc.

## 5. Steering geometry: KPI, scrub radius, caster, offset
- Kingpin inclination (KPI/SAI): road cars 5-12 deg; strut fronts tend higher (PapaCAD example 9.3 deg strut vs 4.5 deg DWB [V illustrative]) because the strut top mount and lower ball joint are far apart in height but the axis is tilted by the need to pack a wide tyre; DWB can set ball-joint spacing freely [T]. Typical strut 8-13 deg [E]; DWB 4-9 deg [E].
- Scrub radius (at ground, between patch centre and steering axis intercept): small positive +0 to +25 mm common; large positive (>50 mm) tugs the wheel under uneven braking/bumps; negative (-5 to -20 mm) used for FWD diagonal-split brake stability (corrective toe under asymmetric braking) [T]. Strut fronts historically hard to get low scrub with wide wheels/high offset (wheel hub packaging fixed by the strut, which must clear the tyre inboard) [V YouTube transcript source, treat as informal]; DWB independent of shock tower so "wide tyre but perfect scrub radius" is feasible [V informal].
- Caster: 3-8 deg sports cars [E]; produces mechanical trail (typ. 10-30 mm) + self-aligning torque; adds dynamic camber gain with steering (outer wheel goes negative) [T]. Strut fronts: caster set at strut top mount / lower arm fore-aft; adjustable via camber/caster plates. Caster trail variation with brake dive.
- Visible: steered wheels camber more negative on the outside wheel as caster builds; whole front end "tipping" into turn.

## 6. Bump steer, toe, track change
- Bump steer = toe change with wheel travel from tie-rod/steering-arm geometry mismatch with the suspension arc. Targets: ≤ 0.02-0.05 deg/mm? Tuned racers aim for <0.01 deg/mm... common road-car spec: ±0.5 deg toe change over ±25 mm (about 0.02 deg/mm) [E]. Slight toe-in under compression at rear for stability (roll understeer / understeer steer). Bump steer arises from the tie rod's inner pivot not lying on the suspension's instant-centre line (rack height too high/low). Lowering a car without fixing rack height gives bump steer for any type [T].
- Rear toe control: multi-link rear lets toe be compliance-steered: lateral force toe-in at the outside rear (≈0.1-0.3 deg per 1000 N lateral, or 0.5 deg at 1 g) for stability (Mercedes "5-link", BMW "Integral" links, Porsche Weissach axle) [T for principle; numbers E].
- Track-width change (scrub): DWB with a short upper arm moves the contact patch laterally 3-10 mm per 25 mm bump typical when unequal arm lengths (more scrub with more camber gain) [E]; strut: smaller track change (1-5 mm/25 mm) because the lower arm is long-ish and the strut slides along its axis [E]; multi-link: tunable 1-8 mm. Tyre scuff and "jacking-like" lateral force.
- All tradeoffs are linked: more camber gain via shorter upper arm => more track change & more RC migration.

## 7. Anti-dive / anti-squat / jacking
- Side-view geometry: anti-dive % = (tan θ_front_IC-line)/(brake-force-split × CG height/wheelbase) ×100 for outboard brakes: anti-dive% = tan(φ) * (wheelbase / h_cg) * front_brake_proportion * 100 (φ = side-view angle of line from patch to side-view instant centre) [T, Milliken/Gillespie]. Typical road car 10-40% front anti-dive [E]; tuned sports 20-30%; 0% for ride quality (anti-dive stiffens in braking over bumps and puts force through the arm bushings).
- Anti-squat (rear, driven axle): similar formula with drive-force split; 10-30% [E]. Multi-link rear gives easiest control of anti-squat + toe independently; DWB can do via tilted pivot axes; strut front: arm pivot tilted, but the strut top is fixed so range is a bit limited.
- Jacking (geometric lateral load transfer): F_geom = F_y,axle * h_RC / track. In roll terms: load transfer per axle = ΔW_geom + ΔW_elastic.
 - Geometric: ΔW_geo,axle = (W_s,axle_share × a_y × h_RC,axle)/t where terms mass at that axle. Equivalent: ΔW_geom = F_lat × RC_height / track (force in suspension links, instant, no roll).
 - Elastic: ΔW_el,axle = (a_y W_s × h × K_φ,axle/ΣK_φ)/t where h = CG to roll axis distance, K_φ axle roll rate (spring + ARB).
 - Unsprung: ΔW_u = a_y × m_u × (h_wheel_centre)/t.
 - Total per axle = sum; roll-stiffness distribution (front/ΣK) drives understeer/oversteer balance (OptimumG "magic number" baseline: front share ≈ static front weight % +5% [V]).
- Jacking effect: with RC above ground the lateral force at the tyre pushes up on the body (jack-up); with RC below ground, pulls down. Visible as the body rising slightly on the outside in hard cornering for high-RC swing-axle type designs, mostly subtle on car modern layouts. For a sim: show RC dot moving; apply F_jack = F_y × tan(angle of RC-patch line).

## 8. Packaging, mass, cost, friction, tunability, who uses what
| Attribute | MacPherson strut | Double wishbone | Multi-link |
|---|---|---|---|
| Parts / cost | fewest (lower arm + strut + one arm bushing set) - cheapest [T] | more arms, ball joints, mounting hardpoints; mid-high | most links and bushings; highest cost, tuning/NVH effort, mid-high; PapaCAD/MarketsandMarkets: strut ≈ 70-75% penetration for front in Asia/Europe passenger cars [V market-report snippet, flag secondary] |
| Packaging | tall (needs strut tower height; raises bonnet line) but narrow in plan; enables transverse engine, wide engine bay [T] | low bonnet line possible (upper arm short, low) - why used on low sports cars and race cars; wide plan [T] | rear: compact fits wide boot floor; front: complex packaging |
| Weight/unsprung | lighter assembly; shock body part of the upright, some of damper mass counts partly sprung. Unsprung for front corner approx 28-45 kg (incl. wheel/tyre/brake) car-dependent [E] | slightly more unsprung (arms), but alloy forged arms keep it competitive [E] | rear: many small links; total can be light if aluminium [E] |
| Friction/stiction | strut piston rod sees bending side load from spring offset and tyre forces => rod/bearing friction; mitigated by offset/angled coil spring ("Kreuz" / side-load spring) and low-friction rod coatings. Real: 20-80 N additional friction at the damper at small amplitudes [E]; shows as harsher small-bump ride [T] | damper/spring are in line with the motion, almost no side load; very low friction [T] | in-line damper at rear usually, low friction |
| Motion ratio (spring/damper movement ÷ wheel movement) | high, 0.85-1.0 (spring near-aligned with wheel; strut leaning at ~10° => MR ≈ cos(lean) × ~0.95) [E] | 0.5-0.85, set by where the spring/damper attaches on the lower arm (typ. coil-over on lower arm ~0.6-0.75) or pushrod/rocker (race) any value [T] | 0.5-0.9 (spring/damper on the lower arm or knuckle; wheel rate = k × MR²) [E] |
| Tunability | camber via top mount slots / camber bolt; limited range of camber curve; changing ride height changes RC/camber/bump steer strongly; limited anti geometry | very wide: arm lengths, angles, ball-joint heights, shims; independent control of camber curve, KPI, RC, caster [T] | widest: each link can be positioned; 4-5 DOF constraints; compliance steer designed in; hardest to tune by hand |
| Compliance / NVH | good: single big bushing-and-isolator at strut top tower | good with bushings; many load paths | best isolation potential via subframes; highest design effort |
| Camber range under ride height change | camber moves with ride height, but track width stays | camber curve moves with ride height; bump steer sensitivity | tunable but links sensitive to geometry |

Production examples (verify before putting a car name in UI copy; [T] from long-standing public record unless marked [U]):
- Strut front: Porsche 911 (all generations, 911 front is strut with lower wishbone/transverse arm) [T]; Mini; VW Golf/most hatchbacks; BMW 3-series (front "double-pivot" strut variant: lower arm split into two links, moves the steering axis to cut scrub radius and kingpin offset) [T]; Honda Civic front strut [T]; Mazda MX-5 is double wishbone both ends [T] (counter-example: cheap sporty car with DWB).
- Double wishbone: Honda (S2000, NSX, Civic Type R older gens were wishbone; current Civic Type R front is strut with dual-axis, rear multi-link) [T/U on specific generations]; Aston Martin DB9/Vantage/DBS: DWB front [T]; Chevrolet Corvette (transverse composite leaf + DWB); Mazda MX-5; Ferrari/Lamborghini/McLaren supercars DWB or pushrod DWB [T]; Formula/racecars pushrod DWB.
- Multi-link rear: Aston Martin DB/Vantage rear multi-link (generally described as 'multi-link' in AM press; some earlier references say "double wishbone" at rear for DB9/Vantage - mixed; [U] check before labelling) [U]; BMW 3/5 series "Integral" five-link rear (E39+), Mercedes five-link, Audi A4 trapezoidal-link front/ multi-link rear [T]; modern FWD hatch rears often torsion beam; Mercedes front multi-link (AMG) [T].
- Honda Accord (previous gens) double wishbone front [T/U].
Caveat for copy: say "typical of" rather than asserting a specific model unless verified.

## 9. Tradeoff matrix (no universal winner)
| Goal | Strut | DWB | Multi-link |
|---|---|---|---|
| Cheapest / fewest parts | Best | Worst-mid | Worst |
| Low bonnet / low CG | Worst (needs tower height) | Best | n/a (rear fine) |
| Camber recovery in roll | Weakest | Strongest, tunable | Strong, tunable |
| Cabin / engine bay room (transverse engine) | Best | Mid | Mid-poor (front) |
| Small-bump friction | Worse (side-load stiction) | Best | Good |
| Wide tyre + low scrub | Hard | Easy | Moderate |
| Anti-dive/anti-squat tuning | Limited | Good | Best |
| Compliance steer / NVH isolation | OK | OK | Best (with effort) |
| Rear toe control under load | OK | OK | Best |
| Tuning by hand (setup knobs) | Limited | Wide | Widest but complex |
| Roll centre stability | Largest migration | Moderate | Controllable |
Honest take: strut wins cost, space, simplicity, ride NVH for mass market; DWB wins ultimate wheel-attitude control and low-bonnet packaging; multi-link wins the number of independent tuning DOF and compliance management but costs complexity. A well-engineered strut (BMW double-pivot, Porsche) can outperform a poorly-sorted DWB. Do not claim a winner.

## 10. Ride frequency, damping, roll gradient, springs, ARBs
- Ride (sprung) frequency f = (1/2π)·√(k_wheel/m_sprung_corner), k_wheel = k_spring × MR² (+ARB contribution in heave: none for pure heave). [T]
 - Typical: soft family sedan 1.0-1.3 Hz; sports road car 1.4-2.0 Hz (front often 1.3-1.7, rear 1.5-2.0, i.e. rear slightly higher to settle pitch "flat ride" [T]); track/GT 2.0-3.0 Hz; race car with aero 3-5+ Hz [E/T; OptimumG gives bands in the Tech Tip, V partially].
- Damping ratio ζ = c/(2√(k m)): comfort 0.25-0.35, sports 0.3-0.5 (bump) with rebound 0.5-0.7 [E]; race 0.5-0.7 critical; rebound ≈ 1.5-2× bump for comfort-sporty [T]. For a sim: heave ζ 0.35 (strut road), 0.45 (sports).
- Roll gradient: OptimumG: 1.0-1.8 deg/g for low downforce sedans, 0.2-0.7 deg/g for stiff high-downforce cars [V]. Typical sports car 0.8-1.3 deg/g [E] (Aston-like GT ~1.0). Formula (V, OptimumG/Suspension Secrets): φ/ay = −W·H /(K_φF + K_φR − W·H) per g? (OptimumG quoted simplified: roll gradient = −W×H / (K_φF+K_φR) (deg/g) ignoring tyre compliance and the correction term); H = CG to roll axis distance. Use the corrected form with the (-W·H) denominator term for accuracy.
- Roll rate from springs: K_φ = π/180 × (t²/2) × k_L k_R/(k_L+k_R) per axle for wheel rates (Nm/deg) [V OptimumG formula, with t track]; e.g. wheel rate 30 N/mm each side, t = 1.6 m => K_φ ≈ 0.0175 × 0.5×... compute in code.
- Typical spring rates (wheel rate): GT/sports front 25-45 N/mm, rear 25-50 N/mm [E]; spring rate = wheel rate / MR².
- ARB: adds roll stiffness without heave stiffness; K_φ,arb adds to axle roll rate; stiffer front ARB => more understeer (more front load transfer share) and less front-inner-wheel grip; typical sports car front ARB 15-30 N·mm/deg... rather 300-1000 Nm/deg?? Use: front total roll stiffness 800-1500 Nm/deg? Keep as target: choose K_φ to hit the roll gradient (≈ 1 deg/g) rather than quoting ARB numbers. Roll-stiffness front share = static front weight % + 3-8% for balanced/mild understeer [V OptimumG "Magic Number"].
- Unsprung mass: 40-70 kg corner-pair per axle typical sedan; sports car with big brakes/alloy 20-30 kg per corner [E]. Sprung:unsprung ratio ideal ≥ 8:1; strut slightly lower unsprung than DWB because damper partly sprung? Roughly equal [E]. Wheel-hop frequency 10-15 Hz [T]; lower wheel rate / lower unsprung mass = better grip over bumps.
- Pitch/ride flat-ride: rear freq ≈ 10-20% above front.

## 11. Observable phenomena (what a non-engineer can SEE) and how to visualise
For each: plain explanation (1-2 sentences) + visualisation.
1. Outside wheel leans over in a corner (strut, strong): As the body rolls, a strut barely tilts the wheel back, so the wheel leans with the body and rides on its outer edge. Visual: camber angle arc/protractor on the wheel, tyre contact patch as a coloured footprint that shrinks to a sliver on the outer shoulder (heat-map: green to red); ghost wheel showing "upright" reference.
2. Wheel stays flat on a double wishbone: The upper arm is shorter, so as the car leans the top of the wheel is pulled in, keeping the tread flat. Visual: same footprint in the same corner, mostly full; show arms swinging with ball joints, dashed lines extended to the instant centre.
3. Roll centre moves: The invisible pivot point the body leans around is higher or lower and wanders as the suspension moves. Visual: a glowing dot on the front/rear view with a trail; construction lines from tyre contact to instant centre; strut dot swings sideways noticeably more.
4. Body roll: car leans out of the turn; stiffer bars = flatter. Visual: roll angle readout in deg and a fixed horizon line / bonnet-mark.
5. Anti-dive: under braking the nose dips less if the side-view geometry fights it. Visual: side camera with pitch angle and dashed anti-dive line through the side-view instant centre.
6. Squat on acceleration for rear.
7. Bump steer: the wheel toes in/out by itself when hitting a bump, visible as a tiny steering twitch from top-down view. Visual: exaggerated toe line from above (×5 amplification, labelled "exaggerated").
8. Scrub / track change: the contact patch slides sideways a few millimetres over a bump (rubber being scrubbed). Visual: top-down patch footprint marker leaving a thin trail.
9. Strut side-load/stiction (small bumps feel harsher): not visible kinematically; visualise as an arrow showing the bending force on the strut rod and a tiny plot of damper force vs velocity with a friction offset.
10. Jacking: the car body lifts slightly on the outside under lateral force with high RC. Visual: tiny arrow at roll centre; subtle body heave.
11. Steering-induced camber (caster/KPI): steering lock tilts wheels. Visual: front view with wheels steered.
12. Brake pull/kickback from scrub radius: show scrub radius as a short horizontal line in front view.
Best practice for explainers: slow-motion + side-by-side ghost of the other type; exaggerate small angles by 2-5× but label it; show numbers only on hover/x-ray; colour footprints by load/camber; use one consistent coordinate triad (front view, side view, top view mini-panes); do not animate kinematics from keyframes, drive them from the same linkage solver.

## 12. Simulation defaults (front axle, sports car ~1500 kg, 50/50-ish, t = 1.60 m, CG h = 0.50 m) [E unless noted]
| Parameter | Strut | Double wishbone | Multi-link (front/rear note) |
|---|---|---|---|
| Static camber (deg) | -1.5 | -1.5 | -1.5 (rear -1.2) |
| Camber gain bump (deg/25 mm) | -0.4 | -1.0 | -0.8 |
| Camber change per deg roll (deg/deg) | -0.45 | -0.85 | -0.70 |
| Static RC height (mm) | 100 | 50 | 70 |
| RC migration (lateral mm @ 2 deg roll) | ~100-300 | 20-40 | 30-80 |
| RC vertical rise (mm per mm heave) | 2.0 | 1.0 | 1.2 |
| KPI (deg) | 10 | 6 | 7.5 |
| Scrub radius (mm) | +20 | +10 | +10 |
| Caster (deg) | 5.5 | 6.5 | 6.0 |
| Mechanical trail (mm) | 20 | 25 | 22 |
| Bump steer (deg/25 mm toe) | ±0.15 | ±0.05 | ±0.08 (rear design toe-in under bump +0.10) |
| Track change (mm/25 mm bump) | 2 | 6 | 4 |
| Anti-dive % (front) | 15 | 25 | 25 |
| Anti-squat % (rear) | 15 | 20 | 30 |
| Motion ratio | 0.92 | 0.72 | 0.78 |
| Wheel rate (N/mm) | 32 | 30 | 30 |
| Ride freq front/rear (Hz) | 1.5 / 1.7 | 1.5 / 1.7 | 1.5 / 1.7 |
| Damping ratio bump/rebound | 0.30/0.55 | 0.35/0.60 | 0.35/0.60 |
| Damper friction (N) | 60 | 15 | 20 |
| Unsprung mass per front corner (kg) | 36 | 38 | 38 |
| Roll gradient target (deg/g) | 1.1 | 1.0 | 1.0 |
| Relative cost index | 1.0 | 1.5 | 1.8 |
Caveat: these are plausible defaults chosen so each type produces its characteristic signature; label the sim as "representative" not a specific car.

## 13. Formulas to lift
```
f_ride = 1/(2π) * sqrt( k_spring*MR^2 / m_sprung_corner )
zeta = c_wheel/(2*sqrt(k_wheel*m)); c_wheel = c_damper*MR^2
K_phi_axle(spring) [N·m/rad] = (t^2/2) * k_L*k_R/(k_L+k_R)   // wheel rates; + K_arb
roll_deg_per_g = (W*H) / (K_phi_F + K_phi_R - W*H) * (180/π) // N·m/rad, W in N (use g=1), H = CG - roll axis
ΔW_geom_axle = Fy_axle * h_RC / t
ΔW_elastic_axle = (W_s*ay*H) * (K_phi_axle/ΣK_phi) / t
ΔW_unsprung_axle = m_u*ay*h_u / t
camber_road_outer = camber_static + gain*bump_outer + roll_angle*(1) // sign conventions: positive outward
Fy_camber = C_gamma * gamma ; C_gamma ≈ 0.05-0.1 C_alpha  // [V: ~1 deg slip = 10-15 deg camber]
anti_dive % = tan(φ)*(L/h)*brake_front_fraction*100
```
Link-based kinematics: model each wheel as 2D planar (front view) four-bar (DWB), slider-crank (strut: lower arm + sliding line), and a 2D/3D constraint solve for multi-link; compute IC, camber, RC from the solved hardpoints. Tie rod as a 5th link for bump steer.

## 14. Honest limits of this doc
- Numeric ranges tagged [E] are engineering ranges, not direct quotations; cite as "typical". PapaCAD's two-car example is one illustrative case. Verify Aston Martin DB/Vantage rear layout [U] and the Honda model-by-model list before surfacing in UI.
- I did not open Milliken/Gillespie/Dixon directly this session.

## Recommendations for Suspension Lab
1. Build a single parametric kinematic solver (hardpoint-driven) with three presets rather than three hand-animated rigs; derive camber, RC, toe, track change from it. This guarantees visible differences are real.
2. Default to section 12 values; expose "representative, not a specific car" label. Show the strut's weak camber recovery (outer tyre footprint going to its edge) as the hero phenomenon, DWB flat footprint as the counterpoint, multi-link as the "tunable + compliant rear" story.
3. Always pair each strength with its cost in the UI (strut: space and cost vs camber; DWB: packaging/scrub vs camber control; multi-link: tunability vs complexity).
4. Use amplified, labelled angle overlays (2-5x) and live numeric readouts of camber, RC height, toe, roll deg and g.
5. Car examples: use hedged wording ("cars like the 911 use a strut front"); drop uncertain claims until verified.
6. Tyre model: simple mu(γ) quadratic + load sensitivity so camber differences change lap behaviour a little, not a lot (honest: gains are a few percent of grip).
