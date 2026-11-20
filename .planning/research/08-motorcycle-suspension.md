# 08 - Motorcycle suspension & dynamics (on-rails educational sim)

Scope: research only. Conventions: x forward, z up, pitch theta positive nose-DOWN, eps = rake (steering-axis angle from vertical), L = wheelbase, h = CG height (rider on), a/b = CG-to-front/rear axle horizontal distance (a+b=L).
Verification legend: [V] seen on a page this session; [D] derived by me from formulas (checked arithmetic); [U] unverified rule of thumb / my estimate - validate before presenting as fact.

---------------------------------------------------------------------------
## 1. Which 3 configurations to ship (and why)

Design principle: each preset must differ in a way the viewer can SEE on the track (dive on braking, squat on throttle, rear rate progressivity, trail change), not just in a label. Real Triumph relevance is kept for presets 1 and 2; preset 3 is the "geometry teaches" one.

| # | Preset name | Front | Rear | Real example | What it teaches |
|---|---|---|---|---|---|
| 1 | Classic | Conventional right-side-up (RSU) telescopic, 41 mm, 120 mm | Twin shock, near-linear (motion ratio ~0.6-0.8 [U]) | Bonneville T120 [V] | The baseline: heavy dive (fork axis resists nothing), stiction, soft/compliant, little progression |
| 2 | Modern sport | Upside-down (USD) 43 mm telescopic, adjustable | Monoshock with rising-rate linkage (Pro-Link / Uni-Trak style 4-bar) | Thruxton RS / Speed Twin RS use USD + twin Ohlins [V]; the monoshock+linkage half is the Street/Speed Triple/sportbike layout [U for exact Triumph model] | Stiffer front (less flex, lower unsprung mass at top), progressive wheel rate from linkage, bigger usable travel from smaller stroke |
| 3 | Telelever + single-sided | BMW Telelever (wishbone + telescopic tube that only steers) | Single-sided swingarm (Paralever) w/ shock direct on arm | BMW R-series [V mechanism; numbers U] | Anti-dive by geometry; trail GROWS on braking (opposite to telescopic); chassis not tied to fork stiction |

Why not the others: Hossack/Duolever = a Telelever cousin (parallelogram, constant-ish anti-dive, same lesson, harder to draw); girder/leading link = beautiful and trivially modelled (can be a bonus "heritage" preset; Foale: pivoting systems give no stiction and allow softer springs but wheel moves up-and-FORWARD = harsher on square-edge bumps); cantilever monoshock = a 3-point variant of preset 2 (same maths, reuse the 4-bar solver with a rocker-less link). Twin-shock vs single-sided is the only *rear* axis where kinematics barely differ (same swingarm pivot maths), so rear variety is delivered by "twin vs monoshock-linkage".
If an all-Triumph trio is preferred: (1) T120 RSU+twin, (2) Thruxton RS USD+Ohlins twin [differs only in front stiffness/damping/mass], (3) a Triumph monoshock-linkage sport model (Speed Triple / Street Triple; model specs not researched here). The BMW preset is more instructive; Telelever is a well-known "recognised" configuration.

---------------------------------------------------------------------------
## 2. Reference specs (Triumph) - for default parameter sets

| Item | Bonneville T120 | Thruxton RS (2020) | Speed Twin 1200 (2019-25) |
|---|---|---|---|
| Wheelbase | 1450 mm (1445 mm older sheets) [V triumphmotorcycles.com / motorcyclespecs] | 55.7 in = 1415 mm [V CycleWorld, 1000ps] | 1413-1414 mm (55.6/55.7 in) [V Triumph spec] |
| Rake / trail | 25.5 deg / 105.2 mm [V] | 22.8 deg / 3.6 in (~91.4 mm) [V CycleWorld] | 22.4-22.6 deg / 90.6-92 mm [V Triumph spec] |
| Weight | 224 kg dry / 236 kg wet [V] | 434 lb (197 kg) claimed dry [V CycleWorld] | 476 lb (216 kg) wet [V] |
| Wheels | F 18x2.75, R 17x4.25 spoke [V] | F 17, R 17 cast (tyres 120/70 R17 & 160/60 R17: stated for Speed Twin [V]; RS assumed same [U]) | F 17x3.5, R 17x5.0 cast [V] |
| Tyres | 100/90-18, 150/70 R17 [V] | as left | 120/70 R17, 160/60 R17 [V] |
| Front susp. | KYB 41 mm cartridge RSU, 120 mm [V] | Showa 43 mm USD BPF, fully adj., 120 mm [V motorcyclespecs.co.za; Rider says Speed Twin RS uses Marzocchi 43 USD - make the brand a label only] | Marzocchi 43 mm USD, 120 mm [V] |
| Rear susp. | KYB twin RSU, preload adj., 120 mm [V] | Ohlins twin shocks, piggyback reservoir, 120 mm [V] | KYB/Marzocchi twin preload-adj. (RS: Ohlins) [V Rider] |
| Brakes | 2x310 front, 255 rear [V] | Brembo M50 radial 2x320 [U] | 2x305 Brembo (U) |

Notes: Speed Twin 1200 spring has dual-rate springs in the shocks [V Rider: "Dual-rate springs are retained, but crossover engages earlier"], so dual-rate/progressive rear is genuine for the Triumph twin-shocks - model the twin shock with a 2-stage spring (cheap progression) vs the linkage (geometric progression).
Derived fork offset (triple-clamp offset o): trail t = (R sin eps - o)/cos eps => o = R sin eps - t cos eps.
 - Thruxton RS: R ~ 300 mm (120/70-17: 431.8+2*84 = 600 mm dia.), eps=22.8, t=91.4 -> o ~ 32 mm [D]
 - T120: R ~ 319 mm (100/90-18), eps=25.5, t=105 -> o ~ 42 mm [D]
Rider+bike CG for presets (estimates [U]): h ~ 0.60-0.65 m rider on; static front weight 47-50 %.

Typical suspension numbers (ranges [U] unless noted):
 - Travel: classics 100-120 mm both ends [V]; sport 120-130 mm; adventure 200+.
 - Fork spring: ~8-10 N/mm per leg (0.8-1.0 kg/mm) for 120 mm road bikes; USD/sport up to 10-11.
 - Rear spring (monoshock+linkage): ~85-110 N/mm with average motion ratio 0.40-0.50 (leverage 2:1-3:1 [V Vorsprung: "most modern full-suspension bikes 2:1 to 3:1"; V promecha: "spring needs to be r x r as stiff"]) -> wheel rate ~15-25 N/mm. Twin shock: ~25-35 N/mm per shock spring with MR 0.7-0.85 -> wheel rate ~ 25-40 N/mm combined.
 - Sag: ~30-35 % travel (front: 30-40 mm, rear 30-40 mm rider-on). Use sag to derive spring: f_n = (1/2pi) sqrt(g/sag) -> 35 mm sag = 2.65 Hz; 45 mm = 2.35 Hz (ride-height sag measured with preload set so k need not equal mg/sag).
 - Damping ratio zeta: compression 0.25-0.4, rebound 0.5-0.7 (rebound ~ 1.5-2x compression). c_wheel = 2 zeta sqrt(k_wheel m_corner); shock damper c_shock = c_wheel / MR^2 (MR = d_shock/d_wheel).
 - Unsprung mass: front (wheel+brakes+lower fork+tyre) 14-18 kg RSU/USD; rear (wheel+swingarm share+disc/sprocket) 17-22 kg. USD saves ~1-2 kg of *effective* unsprung (heavier slider is down, lighter tube is up) but gains most in bending stiffness. [U]
 - Tyre vertical stiffness ~ 150-200 N/mm front, 200-250 rear, tyre damping small (~0.05 zeta) [U].
 - Chain: gearbox sprocket ~15-17 T, rear 40-45 T (final ratio ~ 2.7-2.9) [U].

---------------------------------------------------------------------------
## 3. Mechanism geometry & what is OBSERVABLY different

### 3.1 Telescopic fork (RSU and USD) = prismatic joint along the steering axis
Geometry: stanchion axis parallel to steering axis (rake eps), wheel moves along a straight line u = (-sin eps, cos eps) in (x,z) (up AND rearward). Compression Delta along axis -> wheel centre rises Delta cos eps, moves back Delta sin eps; wheelbase shrinks by Delta sin eps.
 - Trail through travel: with the frame fixed trail doesn't change from sliding alone (offset o constant perpendicular to axis; only R changes slightly) - the trail change on braking comes from frame PITCH (theta nose-down reduces rake): dt/d(eps) = (R - o sin eps)/cos^2 eps ~ 5.9 mm/deg for Thruxton RS numbers [D] => 2-3 deg of dive loses 12-18 mm of trail (14-20 % of 91 mm). Visible effect: steering lightens / turns in faster when dived.
 - Brake dive: axle force from road T=(Tx,Tz). Spring path only resists along u: Q = T.u = -Tx sin eps... with braking Tx = -F: Q = F sin eps + N cos eps. Telescopic is PRO-dive: the horizontal braking force itself compresses the fork (F sin eps, same order as the load-transfer term N cos eps since dN = F h/L). [D; sign and magnitude: validate against Foale's FFE manual, motochassis.com/DocumentFiles/FFEmanual.pdf, which plots telescopic dive vs 0 % anti-dive.]
 - Stiction/flex: sliding bushings (two bushes per leg, 60-100 mm apart) bind under bending from F (brake) and bump side loads -> breakaway friction, typically 20-60 N per leg for conventional forks [U]; this makes the fork dull to bumps not aligned with the axis [V Foale: "stiction in the sliders dulls the response"]. Model: Coulomb friction mu*|bending reaction| where reaction = |F_perp| * (offset/bush_span) -> friction rises with braking force (nice visible link to brake stiction).
 - RSU vs USD: USD has the large-diameter (43-48 mm) tube clamped in the triple clamps -> higher bending stiffness (EI), so less flex under braking and steering input; lowers sprung-side unsprung mass at the top but puts the heavier sliders+brake on the wheel side (net unsprung roughly equal, [U]). Visual: RSU gaiters/rubber bellows (T120); USD gold/black big tubes and radial calipers (Thruxton RS).
 - Rate: coil + air gap/hydraulic lock -> mildly progressive (~15-25 % rate increase over travel via air volume / oil level) [U]. Use quadratic: F = k x (1 + p (x/xmax)^2) with p~0.3.

### 3.2 Telelever (BMW) / Duolever
Geometry: fork tubes (no springs) are only steering/guidance. A wishbone (A-arm) pivots on the frame ahead of / below the steering head and attaches to the fork slider/lower yoke; the spring-damper acts between the A-arm and frame. Wheel path is an arc about the A-arm pivot, not along the steering axis: wheel moves up and slightly FORWARD relative to the frame (so braking force F produces a negative compression term: Q = N vz - F vx... see 3.2 maths) => anti-dive. Per Wikipedia / Foale: Telelever "nearly eliminates dive, could eliminate it completely"; under braking rake and trail INCREASE (opposite to telescopic) [V Wikipedia, V Foale "steering.htm"].
 - Bumps: wheel path leaning forward -> square-edge bump force line (up and back from patch) hits the wheel path at a worse angle: harshness [V Foale]. Mitigated by soft springs and no stiction (the tubes carry no sliding load except steering flex).
 - Observable: nose stays level under braking; trail slightly grows, steering feel heavier; chassis geometry numbers essentially constant (selling point).
 - Numbers: ~ 110-120 mm travel on R/RT models (U); anti-dive typically tuned ~ 40-60 % (U).

### 3.3 Twin shock rear
Geometry: swingarm pivot P (frame), axle A at radius Ls (Bonneville: ~ 560-600 mm [U]). Each shock top on frame (U), bottom on swingarm (S) at fraction s ~ 0.8-0.9 Ls [U], inclined ~ 20-35 deg from vertical to the rear-top. Wheel vertical travel z ~ Ls sin(Delta phi); shock length change along its own axis -> MR = d(l)/d(z) = (r_s cos(beta)) / (Ls cos(phi_a)) where beta is the angle between shock axis and the perpendicular to r_s. MR 0.65-0.85, nearly constant, slightly RISING with compression because the shock stands more upright... (rising or falling depends on layout; compute numerically). No linkage progression -> use dual-rate spring.
 - Observable: simple, high unsprung mass at shocks (shocks are partially unsprung), flex between arm legs for twin-sided fabricated steel (T120 "twin-sided fabricated steel" [V]), mostly linear feel -> pitch-bouncy, "flouncy" (Rider text on the Speed Twin shocks "tames the old bike's flouncy reactions" [V]).
 - Chain pull: because wheel moves on a circular arc about P and chain pull is parallel to the top run: anti-squat set by pivot height vs. engine sprocket (3.5).

### 3.4 Monoshock + rising-rate linkage (Pro-Link / Uni-Trak)
Geometry: swingarm pivot P; shock top on frame (U); shock bottom on a rocker (bell-crank) pivoted on frame at B (Pro-Link: rocker pivots on the swingarm/frame via two links; Uni-Trak: shock pivots on swingarm side with rocker on frame, [mechanism variants U]). Solved as a 4-bar: frame ground pivots P, B, U + moving swingarm point S, rocker with points Q (link end) and C (shock end). Choosing lengths gives a leverage curve whose slope sets progression:
 - Rising rate: wheel rate k_w(z) = k_s MR(z)^2 increases with compression if MR increases (leverage ratio LR = 1/MR falls from, e.g., 3.0:1 to 2.2:1 across travel, typical modern sport [V Vorsprung concept; actual numbers U]). Promecha example: three bikes (SV650 / GSX-R1000 / TZ250) plotted [V title]: GSX-R1000 and TZ250 with strongly falling LR curves = rising rate.
 - Observable: bottoming resistance at the end of travel without a harsh initial rate; shock stroke ~ 55-70 mm for 120-130 mm wheel travel; small shock/rotary mass; damper gets MR^2 effect on damping (c_wheel = c_shock MR^2) -> linkage ALSO makes damping progressive.
 - Anti-squat tunable via swingarm pivot height; shock and linkage mass is sprung (low), reducing unsprung mass and enabling the mass centralisation.

### 3.5 Single-sided swingarm (Paralever) / cantilever
 - Single-sided: wheel on a one-sided arm (flex/stiffness cost; asymmetric mass; looks: wheel change speed). Shaft Paralever adds a parallelogram torque-reaction link so shaft drive jacking is cancelled (anti-lift). For chain bikes, behaves as normal swingarm. Kinematically same as a swingarm. Cantilever (Yamaha 1980s) = shock on a triangulated arm above the swingarm with rocker; same 4-bar solver as 3.4 with a 2-link rocker.

### 3.6 Quick comparison for UI cards (trade-offs, honest)

| Axis | RSU fork | USD fork | Telelever | Twin shock | Monoshock + linkage | Single-sided |
|---|---|---|---|---|---|---|
| Brake dive | High (pro-dive component) | High (same geometry), but less flex | Low (anti-dive) | n/a | n/a | n/a |
| Stiction / flex | Highest stiction, least rigid | Stiffer, similar stiction | Least stiction; tubes steer only | n/a | n/a | n/a |
| Unsprung mass | baseline | ~ baseline | slightly higher? (wishbone is sprung) [U] | highest | lower | similar+asymmetric |
| Progressive rate | air/oil only | air/oil | spring on arm (can be shaped) | none / dual-rate spring | geometric (linkage) | whatever shock/linkage gives |
| Trail change on braking | decreases | decreases | increases | n/a | n/a | n/a |
| Cost/complexity | lowest | medium | high | lowest | high | high |

---------------------------------------------------------------------------
## 4. Kinematic maths (implementable)

### 4.1 Trail and caster
```
// R = loaded rolling radius (tyre dia/2 - sag effect ~ -3mm), eps = rake (rad), o = triple-clamp offset
trail  = (R*sin(eps) - o)/cos(eps)
// mechanical trail (normal trail) = trail*cos(eps)  (used in steering torque)
// trail sensitivity:  dTrail/dEps = (R - o*sin(eps))/cos(eps)^2   (~5.9 mm/deg Thruxton RS)
// effective rake under pitch theta (nose-down +) : eps_eff = eps - theta
```
Fork compressed by x along axis (telescopic): wheel_centre += x*(-sin eps, cos eps) relative to steering head; wheelbase -= x sin eps.
Telelever/leading-link: wheel centre = pivot + Rot(phi)*(arm vector); the instantaneous steering axis changes slightly - for the sim compute trail from the *instantaneous* steering axis through the head bearings (fixed to frame) and the wheel centre offset to find where the axis hits the ground.

### 4.2 Swingarm + direct shock (twin shock) motion ratio
```
// P=(Px,Pz) pivot, A0 axle at static angle, S0 shock lower mount on arm (polar: radius rs, angle psi from arm line)
// Arm angle phi measured from +x (rear) ... use dphi = arm rotation (positive = wheel up).
A(dphi)  = P + Rot(dphi)*(A0-P)
S(dphi)  = P + Rot(dphi)*(S0-P)
l(dphi)  = |U - S(dphi)|                      // shock length, U = frame top mount
z(dphi)  = A_z(dphi) - A_z(0)                 // wheel vertical travel (note: wheelbase also changes: x-dir)
MR(dphi) = (dl/d dphi)/(dz/d dphi)            // numeric central diff, dphi step 1e-4 rad
// wheel rate:      k_w = k_s*MR^2 + F_s*d(MR)/dz   (second term small unless MR changes fast)
// wheel force:     F_w(z) = F_s(l)*MR(z)           // F_s = spring force incl. preload; MR defined > 0 for compression
// wheel damping:   c_w   = c_s*MR^2
// anti-squat angle & wheelbase change from A(dphi): rear axle moves up and FORWARD ~ Ls sin dphi *... (dx = -Ls(1-cos dphi) ~ -0.5*Ls*dphi^2) => wheelbase shortens slightly
```

### 4.3 4-bar linkage (Pro-Link style) - solve and leverage curve
Unknowns: rocker angle beta given swingarm angle dphi. Points: P, B, U fixed on frame; S on swingarm; link length lL between S and Q (on rocker, at radius rq, angle q0 from rocker x-axis); C on rocker at (rc, c0).
```
S = P + Rot(dphi)*(S0-P)
// find Q on circle(B, rq) with |Q-S| = lL   (circle-circle intersection)
d = |S-B|; a = (rq*rq - lL*lL + d*d)/(2d); hh = sqrt(rq*rq - a*a)
M = B + a*(S-B)/d
Q = M + sign*hh*perp(S-B)/d            // sign picks assembly branch; keep continuity from previous step
beta = atan2(Q-B)                      // rocker orientation
C = B + rc*[cos(beta+c0 - q0'), sin(...)]   // rigid rocker
l = |U - C|
MR(z) = dl/dz  (numerically), LR = 1/MR
// travel sweep: dphi from -dphi_max..+dphi_max; sample 40-60 points -> LUT {z, l, MR, anti_squat}. Precompute at load, use LUT interpolation at runtime (no solving per frame).
```
Checks: compression stroke: ensure l_min >= shock bottom-out; rising rate if MR increases with z. Typical design target: MR 0.35 -> 0.50 ( LR 2.9:1 -> 2.0:1 ) [U].
Reusable code: mark-bak/bikinematics has a general solver for single-pivot and 4-bar (see section 7); the maths above is ~40 lines so write it clean-room.

### 4.4 Anti-squat (chain) and swingarm geometry
```
// A = rear axle, E = gearbox output sprocket centre, rr = rear sprocket radius, rf = front sprocket radius.
// Top-run tangent (both sprockets rotate the same way, chain top is tensioned under drive):
//   direction angle gamma of chain top run from horizontal:
//   gamma = atan2(E_z - A_z, E_x - A_x) + asin((rr - rf)/|E-A|)    (sign convention: verify with a drawing)
// Swingarm line: through P and A (angle alpha_s).
// IC = intersection( swingarm line,  chain top-run line )     (instant centre of 'chain + arm')
// Line from rear contact patch Gr=(Ar_x, 0) to IC: height at x = x_front_contact  => z_ic_at_L
anti_squat_pct = 100 * z_line_at_front_contact / h        // 100 % => no squat nor lift (line through CG-height point above front contact)
// Equivalent:  AS% = 100 * (L/h) * tan(angle of Gr->IC line)
```
At each travel position the chain line and arm angle change (sprocket distance changes) -> AS% is a curve; show it as chart. Pitch/squat reading: under acceleration, rear-load transfer dN = m a_x h/L; the spring compression force from drive = dN*MR_equiv - F_chain_vertical_component; AS 100 % cancels (squat 0).
Telescopic dive formula (generalised): anti-dive% = 100 * (L/h) * (vx/vz) where u=(vx,vz) is the wheel-centre velocity direction relative to the frame (x forward, z up). Telescopic: u=(-sin eps, cos eps) -> AD = -100 (L/h) tan eps (NEGATIVE: pro-dive; magnitude ~ -100 % for typical numbers) [D; verify w/ Foale FFE]. Telelever: u points up-and-forward (vx>0) -> AD positive. Zero AD means pure load-transfer dive; AD=100 % means no braking-induced fork compression.

### 4.5 Pitch under braking/acceleration (load transfer)
```
// quasi-static:
Nf = m*(g*b + ax_dec*h)/L ;  Nr = m*(g*a - ax_dec*h)/L      // ax_dec >0 braking
// limits: stoppie (rear lifts) ax_dec = g*a/h ;  wheelie ax = g*b/h  (a,b measured CG to front/rear axle)
// longitudinal force split: Fx_f = brake_bias*m*ax_dec ... (clip to mu*Nf)
// spring compression drive per end: Q_f = N_f*vz_f - Fx_f*vx_f ... see 4.4 (Tx = -F braking)
// pitch angle (small): theta ~ dz_f/L + dz_r/L,  dz_i = Q_i/(k_w,i)    // k_w includes MR^2
```
Wheelbase and CG-height change with pitch (Foale: "wheelbase varies with deceleration" - matters for the lift threshold).

---------------------------------------------------------------------------
## 5. Path-following motorcycle dynamics

### 5.1 Steady-state lean
Point-mass (thin-wheel) lean: gamma = atan(v^2 * kappa / g) (kappa = signed path curvature, 1/m; same formula as Jolt: `LeanAngle = Atan(Velocity^2 / (Gravity * TurnRadius))`, see 7).
Tyre-width (crown radius rho) correction: contact point is rho below the crown centre, CG is H=h-rho above the crown centre along the frame axis; force line passes through CG => tan(gamma) = H sin(phi)/(rho + H cos(phi)) => closed form
```
phi = gamma + asin( (rho/H) * sin(gamma) ),    H = h_cg - rho          // frame lean > CG-line lean
```
Example (h=0.60, rho=0.06 m [U], gamma=45 deg): phi = 49.5 deg [D]. Rider hang-off: move CG laterally d at height h_r: add d to the lateral offset: sin/cos terms with lateral offset (frame lean decreases for the same gamma). Max lean = atan(mu) ~ 55-60 deg limited by tyres & hardware (peg/exhaust scraping) [U].
Also longitudinal accel and braking while leaning ("trail braking") affect the required lean: gamma_xy = atan(a_lat/ g) where a_lat = v^2 kappa (use total |a| for friction circle: sqrt(a_lat^2 + a_x^2) <= mu g).
Steady steer angle (kinematic): delta ~ L*kappa*cos(eps)... Jolt: TurnRadius = L/(sin(delta)*cos(eps)) (small-angle: delta = L kappa / cos eps [D: invert]).

### 5.2 Countersteer transient
Linearised roll-balance of a single-track vehicle (Wikipedia "Bicycle and motorcycle dynamics", Meijaard/Cossalter; neglecting gyro & trail terms):
```
h*phi_dd = g*phi - (v^2/L)*delta' - (b*v/L)*delta_dot'         // phi to the RIGHT positive, delta' = delta*cos(eps), steering to the right positive
```
To roll RIGHT (phi_dd>0) you must momentarily steer LEFT (delta' <0): countersteering. Steady state phi_dd=0 -> delta' = (L/v^2) g phi = L kappa (consistent with 5.1).
Visual steering command from the path (no controller needed - inverse dynamics):
```
phi_des  = lean_from_curvature(v, kappa(s))          // 5.1 (smoothed: 2nd-order lowpass, zeta~0.8-1, omega 5-8 rad/s => 0.2-0.4 s turn-in)
phi_dd_des = omega^2*(phi_des - phi) - 2*zeta*omega*phi_dot
delta'   = (L/v^2) * (g*phi - h*phi_dd_des)      // neglect delta_dot term, or add -(b/v)*delta_dot' via simple lag
delta    = delta'/cos(eps)      // steering angle for the handlebar/fork animation (clamp +-20 deg; low speed: v_floor 3 m/s, blend to delta = L*kappa/cos eps)
```
Rolls: wheel contact line lateral offset = (R_crown)... skip. Gyroscopic: front wheel gyro torque ~ I_w (v/R) * phi_dot adds a modest steering-axis torque; omit visually (note in UI as educational aside).
Stability caveat: this open-loop inverse is stable because the *path* defines the lean; the rider model tracks it. For a closed-loop rider use delta' = Kp*(phi - phi_des) + Kd*phi_dot with Kp > gL/v^2 (otherwise unstable inverted pendulum) [D: from linearisation].

### 5.3 Pitch & heave (quasi-static + dynamic) - see 4-DOF below. Additionally mix in lean-induced effects: (a) trail/offset effect of lean; (b) on a leaned bike, suspension travel components are along the fork (so bumps felt as lateral), skip; (c) vertical component of tyre force reduces to N=mg/cos(phi) (centrifugal) -> effective "g" for the springs: g_eff = sqrt(g^2 + (v^2 kappa)^2) - visible extra sag in corners (nice to demonstrate).

### 5.4 4-DOF in-plane model (heave z, pitch theta, front unsprung zuf, rear unsprung zur)
Generalised coordinates: q = [z, theta, zuf, zur]. Body CG at height h; front/rear attachment points at x=+a, x=-b. Longitudinal speed/accel imposed by the path speed profile (a_x(t) = dv/dt), so no longitudinal DOF.
```
// parameters per preset
m   (sprung), Iy (pitch inertia ~ m*(0.45..0.55*L)^2 ... use ~ m*0.5^2... [U: Cossalter]), muf, mur (unsprung), ktf, ktr (tyre), ctf, ctr
// per-end suspension object (front: telescopic/telelever LUT; rear: swingarm/linkage LUT):
//    wheel travel (compression) w_i, wheel rate/force Fs_i(w_i,w_i_dot), direction u_i=(vx_i, vz_i)(w) from LUT
// kinematics (small angles):
zf_body = z - a*theta ;  zr_body = z + b*theta          // body vertical at attach points
wf = zuf - zf_body + wf0 ; wr = zur - zr_body + wr0     // compression (>0 = compressed), w0 = static sag
wf_dot = zuf_dot - z_dot + a*theta_dot ; wr_dot = zur_dot - z_dot - b*theta_dot
// suspension force transmitted to the body at each end, in wheel-vertical sense (spring+damper along wheel-vertical):
Fs_f = Spring_f(wf) + Cdamp_f(wf, wf_dot)*wf_dot          // includes MR^2 effect if LUT stores wheel rate; progressive & preload inside
Fs_r = Spring_r(wr) + Cdamp_r(wr, wr_dot)*wr_dot          // with stiction: Fs_f += -Ffr*tanh(wf_dot/vreg) (front only)
// longitudinal tyre forces from path acceleration (brake/drive split)
Fx_f = -brake_f(ax_dec) ;  Fx_r = +drive_r(ax) - brake_r(ax_dec)   // from F=m*ax distribution
// vertical force carried by the suspension path including the longitudinal coupling (the key line)
Fz_f = (Fs_f - Fx_f*vx_f)/vz_f                 // telescopic: vx=-sin eps  => braking Fx_f<0 ADDS compression (pro-dive)
Fz_r = (Fs_r - Fx_r*vx_r)/vz_r                 // + chain/anti-squat term: Fz_r += F_chain*sin(gamma_geo) ... see 4.4
// equations of motion (z up, theta nose-down +); see clean form below
```
Clean form:
```
m  * z_dd  = Fz_f + Fz_r - m*g_eff                      // suspension pushes body up
Iy * th_dd = -a*Fz_f + b*Fz_r + (Fx_f*(zaxle_f - z_cg) + Fx_r*(zaxle_r - z_cg)) - m*ax*h   // signs: verify with unit tests below
```
Ambiguity guard: implement the moment as moments about the CG of the *axle forces on the body* (vertical Fz at x=+a, -b; horizontal Fx at z_axle_i - z_cg) and include the inertial pitching from a_x: `M_inertia = -m*ax*h` (D'Alembert). Unit tests (required): (1) static: z=0 sag matches Wheel load / k_w; (2) steady braking at a_dec=0.6 g: theta and wf match section 4.5 formulae to <2 %; (3) telescopic vs Telelever at same braking: AD% from 4.4 matches measured compression ratio.
```
// unsprung
muf*zuf_dd = ktf*(zrf(t) - zuf) + ctf*(zrf_dot - zuf_dot) - Fz_f - muf*g          // road input zrf(t) = bump profile at front contact, zr(t) = delayed by L/v (rear sees same bump L/v later: wheelbase filtering)
mur*zur_dd = ktr*(zrr(t) - zur) + ctr*(zrr_dot - zur_dot) - Fz_r - mur*g
// integrate with semi-implicit (symplectic) Euler dt<=1 ms or RK4 dt 2 ms (tyre ~ 50-80 Hz; wheel hop ~10-15 Hz)
```
Notes: front and rear bump inputs: z_rr(t) = z_r(s - L)  [wheelbase filtering - visible pitch resonance when L/v matches bump spacing]. Wheelbase effect: contact patch moves with fork travel (wheelbase shortens by x sin eps).
Natural frequencies for sanity: bounce ~2.0-2.8 Hz; wheel-hop front ~ 12 Hz; pitch ~ 1.8-2.5 Hz; unsprung masses 14-20 kg.

### 5.5 Rigid-body / visualisation hooks for Three.js
Bike body pose from path: position on spline; yaw from tangent; roll = phi (about the longitudinal axis passing through the contact patch line - rotate about the tyre contact line, not the CG); pitch theta + road slope. Fork: translate wheel along u_f by w_f; fork-spring visual; steering head rotated by delta about the steering axis (axis tilted by eps from vertical, tilted by theta). Rear: swingarm rotated about P by dphi(w_r); shock drawn from U to S/C; linkage drawn from LUT of 4-bar points. Chain: top-run line + anti-squat line + IC marker (x-ray mode). Everything is LUT-driven from precomputed kinematic tables (section 4.2-4.4), so runtime cost is trivial.

---------------------------------------------------------------------------
## 6. Open-source references (verified this session)

| Repo / source | Licence (verified) | Usable? | What is reusable |
|---|---|---|---|
| Jolt Physics `Jolt/Physics/Vehicle/MotorcycleController.cpp` (github.com/jrouwe/JoltPhysics) | MIT (LICENSE text read; "Copyright 2021 Jorrit Rouwe") | YES (idea/algorithm; C++ not JS) | Lean-spring controller; max steer angle from lean: `SteerAngle = asin(L*tan(maxLean)*g/(v^2*cos(caster)))`; citation of Wikipedia bicycle dynamics. Copy the formula, not the code. |
| mark-bak/bikinematics (github.com/mark-bak/bikinematics, README read) | NO LICENSE FILE found (raw LICENSE 404 on HEAD/main/master) => all rights reserved / unclear => NOT usable as code | Reference only | Kivy/Numpy app for MTB linkages: single-pivot + 4-bar (Horst, DW, split pivot), leverage ratio, axle path, anti-squat. Algorithms are standard; reimplement clean-room. |
| TUMFTM/motorcycle_model (github.com/TUMFTM/motorcycle_model) | LGPL-3.0 (LICENSE read) | NOT for bundling (LGPL + MBSim dependency); fine as reading reference | MBSim multibody motorcycle with roll PD controller, longitudinal PID; paper doi MDPI Appl. Sci. 10(19):6826. Parameter sets useful for cross-checking (not copied). |
| nickmccleery/open-kinematics (now suspension-explorer-core) | AGPL-3.0-only | NOT usable | Car double-wishbone/etc. solver - irrelevant to bikes and copyleft; keep for car track research only. |
| oxiphysics-vehicle (cool-japan/oxiphysics, `motorcycle`, `suspension_analysis` modules) | UNVERIFIED (README truncated) | Unknown - treat as not usable | Rust; unknown quality. |
| Altair MotionView Two-Wheeler MDL library (help.altair.com/hwdesktop/.../two_wheeler_mdl_library_r.htm) | Documentation of commercial software; "open-source ASCII" library but within proprietary tool | NO (docs only) | Confirms topology list: telescopic RSU/inverted, trailing-arm mono/twin shock, scooter single-side; motion ratio defined as (S-S')/(C-C'). |
| Tony Foale / motochassis.com (FFE manual, "Telelever" & "Anti-dive" articles; also "Motorcycle Handling and Chassis Design") | Copyrighted; software proprietary freeware | Cite, don't copy | Authoritative on anti-dive %, anti-squat, trail change, stiction. FFE manual (https://motochassis.com/DocumentFiles/FFEmanual.pdf) shows dive-vs-deceleration formulas to unit-test against. |
| Cossalter, "Motorcycle Dynamics" (book, Lulu 2006) | Copyright | Cite for formulas | Lean-with-tyre-radius, steering torque, gyroscopic terms. |
| PyDy / bicycleparameters (Whipple benchmark) | LICENSE not fetched (URLs 404 at tried paths) -> UNVERIFIED (PyDy is generally BSD-3 but verify) | Maybe | Whipple (Meijaard) 4-DOF linear model if a closed-loop lateral study is desired; not needed for on-rails visual sim. |

No JS/three.js motorcycle-suspension library with a permissive licence was found; plan to implement the LUT-based kinematics ourselves (small).

---------------------------------------------------------------------------
## 7. Recommendations for Suspension Lab

1. Ship 3 bike presets: Classic (RSU + twin shock, T120 numbers), Modern sport (USD + Pro-Link mono, Thruxton RS front numbers), Telelever+single-sided (anti-dive demo). Optional 4th "heritage" leading-link if time.
2. Implement kinematics as precomputed LUTs (travel -> wheel position, MR, trail/rake, wheelbase, anti-squat%). Front axle: prismatic (telescopic), arm-pivot (Telelever/leading link). Rear: swingarm pivot + direct shock (twin) or 4-bar (linkage). A single `solve4bar()` + `pivotArm()` kit covers all (section 4.2-4.3); ~150 lines, no library needed.
3. Dynamics: 4-DOF (z, theta, zuf, zur) with the "Fz = (Fs - Fx vx)/vz" longitudinal coupling so brake dive/pro-dive/anti-dive and chain anti-squat emerge from geometry rather than being faked. Unit-test against section 4.5 and Foale's FFE examples. dt 1-2 ms fixed step, decoupled from render.
4. Path layer: lean phi from curvature (with tyre-crown correction) via 2nd-order tracker; steer angle from inverse roll-balance (countersteer free); pitch/heave bumps filtered by wheelbase L/v; g_eff increases sag in corners.
5. UI metrics (X-ray overlays): trail (mm) live, wheelbase live, rake, anti-dive %, anti-squat % + IC, leverage curve chart with moving dot, sag, unsprung mass, stiction indicator. Show tradeoffs card per preset (table 3.6).
6. Reuse: only MIT Jolt `MotorcycleController` formulas (mathematical, not code); do not copy bikinematics (no licence), TUMFTM (LGPL), open-kinematics (AGPL). 
7. Open items to verify before publishing numbers: fork stiction magnitude, T120 rear motion ratio, linkage geometry for a Triumph monoshock bike, damping ratios, h_cg and inertia, sign/magnitude of the telescopic pro-dive term (cross-check Foale FFE), Thruxton RS tyre sizes, spring rates (all [U] above).
