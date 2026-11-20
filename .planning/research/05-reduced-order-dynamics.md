# 05 - Reduced-order vehicle dynamics for a spline-following car (Suspension Lab)

Verification key: [V] = page opened this session; [U] = unverified / from engineering knowledge, check before relying.
GitHub API was blocked in this sandbox, so repo stats come from fetched GitHub HTML pages (commit dates did not render: "last activity" = unknown).

## 0. TL;DR
- No ready-made JS 7-DOF ride/handling model exists under a usable licence. The whole thing is ~300 lines; write it ourselves from the equations below (all textbook). Reuse libraries only for (a) Pacejka (tread, BSD-3, JS), (b) lap-sim *algorithm* (OpenLAP is GPL, TUMFTM is LGPL: reimplement from the algorithm description, do not copy code).
- Architecture: path layer (kinematic, deterministic) -> speed profile (precomputed, forward-backward) -> ay, ax per arclength -> 7-DOF ride solver (dynamic, 4 substeps/frame) -> tyre loads + grip indicator -> render. The ride model does NOT feed back to the path (kinematic car), so it is unconditionally believable and cannot diverge off-track.
- Handle roll/pitch with a *hybrid*: geometric (roll-centre/anti-dive) load transfer acts as force inputs at the unsprung masses, elastic transfer arises from springs/ARB in the sprung-body DOFs. This gives the right per-suspension-type differences (roll-centre height, anti-dive) and correct total load transfer.

## 1. Existing code (licence-checked)
| Repo | What | Stars / licence | Usable? |
|---|---|---|---|
| https://github.com/aunyks/tread (jsr: @hivoltagexyz/tread) [V] | JS Pacejka 2002 (MF 5.2) lateral/longitudinal/aligning, loads `.tir` files, `Pacejka2002.computeLateralForce(alpha, Fz, out)` | 3 stars, 13 commits, BSD-3-Clause (has THIRD_PARTY_NOTICES + vendor/ dir: check vendored licences) | YES (heavy-ish; for us a 10-line simplified MF is enough, see 6.3) |
| https://github.com/TUMFTM/laptime-simulation [V] | Python quasi-steady-state lap sim, point mass, friction ellipse, `laptimesim/` | 169 stars, LGPL-3.0 | Algorithm reference only; do not port (LGPL; copy-left on derived code). |
| https://github.com/mc12027/OpenLAP-Lap-Time-Simulator [V] | MATLAB point-mass lap sim (OpenLAP.m, OpenVEHICLE/TRACK/DRAG) | ~120 stars, GPL-3.0 | NOT usable as code. Algorithm in OpenLAP.m was read and summarised in 5. |
| https://github.com/pzimbrod/apexsim [V] | Python modular lap sim: point mass, 3-DOF single track, Pacejka lateral w/ load sensitivity; has `vehicle` (load transfer), `tire`, `simulation` packages | 1 star, 100 commits, Apache-2.0 | Usable; read `src/apexsim/vehicle` for load-transfer cross-check. Tiny community; treat as reference. |
| https://github.com/oseiskar/js-car [V] | JS 2D car (axle friction points, PID AI, `physics/`) | 19 stars, MIT | Marginal: no suspension/roll/load transfer. Only useful as a JS bicycle-model skeleton. |
| https://github.com/pmndrs/cannon-es [V] | RaycastVehicle w/ spring-damper wheels | ~2.1k stars, MIT | Not needed (we are kinematic); its RaycastVehicle suspension (stiffness/damping/restLength/maxSuspensionTravel) is a model for the spring-damper API. |
| https://github.com/dimforge/rapier.js [V] | archived, merged into rapier main repo; Rapier has DynamicRayCastVehicleController | 700 stars, Apache-2.0 | Not needed; heavy WASM. Mentioned for completeness. |
| https://pymycar.readthedocs.io/en/latest/theory/vertical_models/full_car_model.html [V] | Full 7-DOF equations (Lagrange), docs for Python lib pymycar | licence of lib not checked [U] | Equations only (they contain typos, flagged below). |
| Papers: arXiv 2101.12629 (quarter & full car passive/active, 7-DOF) [V-via-search]; SAE 2004-01-1555 (7-DOF, SUV); Bennett 2012 Brookes thesis (4-post fit) | | | Theory/validation only. |
No usable JS "half-car/quarter-car demo" with a permissive licence was found in 6 searches [V: searched]; the Three.js-physics repos found (Jaagrav raycast-vehicle-engine, TNTGame MIT, Racing JS, Physijs) are game raycast vehicles, not ride-dynamics models.

## 2. State and 7-DOF equations (implementable, nonlinear-small-angle)
Coordinates (SAE-ish, y left, z up, body frame at static CG): zs heave, phi roll (about x), theta pitch (about y, nose-down positive here), zu[i] wheel hub vertical, i = FL,FR,RL,RR. Road height zr[i], rate zr'[i].
Geometry: a = CG->front axle, b = CG->rear axle, L=a+b, tf, tr track widths. Corner positions in body frame: xi = (+a,+a,-b,-b), yi = (+tf/2,-tf/2,+tr/2,-tr/2) (left positive).

Convention: z up; phi = roll, positive = LEFT side up; theta = pitch, positive = nose DOWN. Corner body-side height and compression:
  zb[i]  = zs - xi*theta + yi*phi        (xi forward-positive, yi left-positive)
  ext[i] = zb[i] - zu[i]                 (extension of spring; compression = -ext, static preload handled via ext0[i])
  vext[i]= zs' - xi*theta' + yi*phi' - zu'[i]
(pymycar's page writes these with sin() terms and has typos: Ixx/Iyy swapped vs DOF labels, P1z used in d3; the form above is the corrected small-angle version.)

Suspension force on body at corner i (upwards on body = F_i):
  F_i = -ks_i*(ext_i - ext0_i) - cs_i(vext_i)*vext_i - (ARB term)
  ARB (per axle, torsion bar of stiffness Karb [N*m/rad] or equivalent wheel rate karb = Karb/t^2):  
       implement as  F_arb_i = -k_arb_axle * (ext_i - ext_other)  (equal & opposite on the other side), k_arb_axle in N/m at the wheel
  Bump stops: if compression > travel: add kbump*(excess)^1 (progressive) ; rebound stop likewise.
  Nonlinear damper (important for believable look): c = c_bump when v<0 (compression), c_reb when v>0, with c_reb ~ 1.5-2.5 * c_bump; optional knee-point blow-off.

Body equations (sum over corners i):
  ms*zs''     = sum F_i + (-ms*g handled by static preload so work in deviations)
  Ixx*phi''   = sum F_i*yi  + M_roll_geo (see 3)
  Iyy*theta'' = -sum F_i*xi + M_pitch_geo
Wheel (unsprung) equations:
  mu_i*zu_i'' = -F_i  + Ft_i      where Ft_i = kt_i*(zr_i - zu_i) + ct_i*(zr'_i - zu'_i), clamp Ft_i >= 0 (wheel liftoff; tyre cannot pull)
Where F_i is force on the body, -F_i acts on the hub. Linear matrix form M q'' + C q' + K q = F(road) is as in the pymycar page; nonlinear damper/bumpstops/clamp make direct matrix integration unnecessary: integrate the 7 scalar ODEs directly.

Mode sanity (use as unit test): body heave ~1.1-1.5 Hz front-biased flat ride (rear ~0.1-0.2 Hz higher), wheel hop 10-14 Hz, roll ~1.3-1.8 Hz, damping ratio body 0.5-0.7 (sports car), hop ~0.3.

## 3. Load transfer, roll centres, anti-dive/squat (the "suspension-type" part)
Inputs from the path: ay (m/s^2, +ve left turn -> loads right wheels), ax (+ve accelerating).

3.1 Lateral, per axle j (front/rear), standard three-path split (geometric + elastic + unsprung):
  m_s_j  = sprung mass share on axle j   ;  h_rc_j = roll-centre height of axle j (from suspension kinematics module: different for strut / wishbone / multilink)
  Roll axis height at CG longitudinal location: h_ra = h_rc_f + (h_rc_r - h_rc_f)*(b... ) -> h_ra = h_rcf*(b/L) + h_rcr*(a/L)
  Roll arm: hr = h_cg_sprung - h_ra
  Total roll moment on sprung mass about roll axis: Mroll = ms*ay*hr   (this is what rolls the body)
  Geometric (instant, through links) transfer on axle j:  dFz_geo_j = ms_j*ay*h_rc_j/t_j
  Unsprung transfer: dFz_uns_j = mu_j_axle*ay*h_u_j/t_j  (h_u ~ wheel centre height)
  Elastic transfer: arises automatically from the roll DOF: k_roll_j (spring+ARB) * phi / t_j
  Implementation (force-input form, preferred): apply the geometric part as *vertical forces applied to the unsprung masses and equal-opposite on the body at the roll-centre path* i.e.
     F_geo_i (on body at corner i) = +/- ms_j*ay*h_rc_j/t_j      (right/left sign by ay)
     F_geo on hub i = - F_geo_i
  and apply the lateral inertial moment on the body about the CG-to-roll-axis arm only: 
     M_roll_geo = ms*ay*hr   about the roll axis. In body DOF terms: Iyy... add torque tau_phi = ms*ay*h_ra_to_cg... 
  Simpler & robust: tau_phi = ms*ay*(h_cg_s - h_ra); jacking forces above supply the rest. Check: static steady-state sum of Fz on axle j should equal  static +/- [ms_j*ay*h_rc_j/t + (kroll_j/(kroll_f+kroll_r))*Mroll/t + mu*ay*hu/t]  (unit test; total across both axles = m*ay*h_cg/t_avg).
  Roll stiffness: kroll_j = 0.5*k_s_j*t_j^2 + K_arb_j   [N*m/rad]; roll angle ss: phi = Mroll / (kroll_f + kroll_r - ms*g*hr)  (last term: tilting-moment correction). Target roll gradient for a sports car 0.8-1.4 deg/g (use to tune ARB).
  Optional (cheap, big visual impact): camber change = camber_gain_j * (wheel travel_L - travel_R)/... + roll_camber_ratio*phi, supplied by the kinematics module.

3.2 Longitudinal:
  Total transfer dFz_long = m*ax*h_cg/L  (from rear to front under braking, ax<0).
  Anti-dive (front) fraction / anti-squat (rear):  anti = tan(alpha_geo)*L_wb_side/h_cg  (alpha_geo = instant-centre line angle; braking: AD = tan(alpha_f)*(L/h_cg)*brake_bias_front for outboard brakes). Geometric transfer through links:
     F_geo_front (body unloaded by) = m*ax*h_cg/L * AD_f   ; rest goes through springs -> pitch.
  Pitch moment on sprung body: tau_theta = ms*ax*h_cg_s*(1 - AD_eff)   (nose down under braking) ; AD_eff  = bias_f*AD_f + (1-bias_f)*AS_r for braking; AS_r for acceleration (RWD).
  Per-corner longitudinal normal-load shift: dFz_i = -/+ m*ax*h_cg/(2L) split equally between left/right.
  Static pitch gradient target: 0.5-1.2 deg/g.

3.3 Per-wheel normal load for tyres/grip UI (the tyre vertical force from the integrator is the physically consistent one):
  Fz_i = max(0, kt*(zr_i - zu_i) + ct*(zr'_i - zu'_i) )   [dynamic, includes road noise & weight, no extra transfer terms]
  plus aero: + 0.5*rho*CL*A*v^2 split by balance (sports car CL ~0.1-0.4 -> small; ignore or add 1-2% grip).
  Check: sum(Fz) ~ m*g + downforce on flat road at constant speed.

## 4. Integrator at 60 fps
- Fixed-step accumulator: dt_phys = 1/240 s (4 substeps per 60 fps frame), clamp frame dt to 1/20 s, render with interpolated state. Wheel hop is ~12 Hz (period 83 ms) and tyre-spring stiff: ke/mu -> omega_t = sqrt((ks+kt)/mu) ~ 2pi*13 Hz; explicit/semi-implicit stability limit dt < ~2/omega ~ 24 ms, damper limit dt < 2*mu/c ~ 2*45/2500 = 36 ms. 1/240 is >10x safety, and gives accuracy for kerbs/bump edges.
- Semi-implicit (symplectic) Euler: v += a(x,v)*dt ; x += v*dt. Damper depends on v: for high damping use implicit-damper: v_new = (v + dt*(F_nondamping)/m) / (1 + dt*c/m) (single-DOF unconditionally stable); for coupled body use ordinary v-evaluation with 240 Hz, and cap |c*dt/m_eff| < 1.
- Road input rate: zr' = (zr(s+ds) - zr(s))/dt using each wheel's own path position (wheel i path offset along arclength: s_i = s - xi, lateral offset yi in Frenet frame) => axle lag (wheelbase filter) emerges for free; sample road height as bilinear height-field or analytic bump functions (half-sine bumps, ISO-style).
- Alternative: exact exponential/analytical for linear parts + RK4 at 1/120 s. Not necessary.
- Smooth the inputs: ay, ax from analytic path => low-pass 8-10 Hz (1st order) before applying to body to avoid curvature-discontinuity jerks; spline curvature is C0 for cubic Hermite, C1+ for clothoid/quintic or B-spline degree >=4 - use Catmull-Rom centripetal then resample + smooth.

## 5. Speed profile from curvature (quasi-steady-state forward-backward)
Source algorithm (read from OpenLAP.m, GPL, so algorithm only) [V]: v_max per point from lateral grip; apexes = local minima; from each apex march forward (accel-limited) and backward (brake-limited) with the combined-grip ellipse; result = min over all candidates. Simpler variant sufficient for a closed test track:

  // pts i=0..N-1, spacing ds (resample arclength uniform), curvature k_i (signed), grade/bank ignored
  mu, g, ay_max = mu*g (+ aero: v^2 term) ; ax_acc_max (power/traction), ax_brk_max
  v_lim[i] = min(vmax, sqrt(ay_max / max(|k_i|,eps)))      // for aero: v^2 = mu*g/(|k| - mu*rho*CL*A/(2m))
  // backward pass (braking), loop twice around closed track to wrap
  for i = N-1 .. 0 (repeat 2x):  
      ay = v[i+1]^2*|k_{i+1}|;  ell = sqrt(max(0, 1-(ay/ay_max)^2));   // friction ellipse: (ax/axmax)^2+(ay/aymax)^2 <= 1
      ax_avail = ax_brk_max*ell + drag(v)/m
      v[i] = min(v_lim[i], sqrt(v[i+1]^2 + 2*ax_avail*ds))
  // forward pass
  for i = 0..N-1 (repeat 2x):
      ay = v[i]^2*|k_i|; ell = sqrt(max(0,1-(ay/ay_max)^2));
      ax_avail = min(ax_acc_max*ell, power/(m*v)) - drag(v)/m
      v[i+1] = min(v[i+1], sqrt(v[i]^2 + 2*ax_avail*ds))
  ax_i = (v[i+1]^2 - v[i]^2)/(2*ds)  (longitudinal accel), ay_i = v[i]^2 * k_i
  t_i = cumsum(ds / v_avg)   -> convert to time-parameterised playback: advance s with ds/dt = v(s) using RK2 on the table.
Parameters for a ~Vantage-like car: mu_y 1.1-1.3 (road tyres, 0.95-1.05 for "believable not-racing"), ax_acc_max 0.8-1.0 g limited by power (P ~ 375 kW, use a = min(mu*g*driven_share, P*eta/(m*v))), ax_brk_max 1.1-1.3 g. For a show-car use ay_max <= 0.9 g so roll looks dramatic but safe; add "driver margin" factor 0.9.
Load-sensitive grip (OpenLAP style): mu(Fz) = mu0 + dmu*(Fz - Fz0) with dmu<0 (about -0.1 to -0.2 per kN... use mu0=1.2 at Fz0=4 kN, dmu=-0.00005/N [U]).
Smooth the result (moving average over ~10 m) so ax doesn't step.
Reimplementation estimate: ~60 lines TS, run once at track build (or in a Worker/DO if track is user-editable).

## 6. Path following / kinematic car orientation
6.1 Path: arc-length-parameterised spline (CatmullRom centripetal or cubic B-spline); table P(s), T(s)=P', curvature k(s) = (x'y''-y'x'')/(x'^2+y'^2)^1.5 (signed); resample uniformly 0.25-0.5 m.
6.2 Frenet frame (3D track with elevation): T = normalised P'(s); up reference U0 = (0,1,0) blended with banking vector; N_lat = normalize(cross(U0, T)) (left), B_up = cross(T, N_lat). Use parallel-transport (rotation-minimising) frames if the track has tunnels/loops; for a mostly flat test track the cross-product frame is fine. Car yaw = atan2(T). Rear-axle reference point rides the spline (more realistic than CG: front swings out); place rear axle at s, front axle at s + L along spline (or by solving |P(s_f)-P(s_r)| = L) -> body yaw = direction rear->front; this yields correct tail-in/out and wheel positions.
6.3 Steering (Ackermann geometry from bicycle):  delta_bicycle = atan(L*k) (+ understeer gradient term K*ay*L... delta = L*k + Kus*ay with Kus ~ 0.003-0.006 rad/(m/s^2) for visual slight understeer)[U].
  Ackermann inner/outer: cot(delta_o) - cot(delta_i) = tf_king/L  ->  
     R = L/tan(delta) ; delta_L = atan(L/(R - t/2)), delta_R = atan(L/(R + t/2))   (left turn, R>0 centre on left; left wheel is inner and steers more)
  Add toe/bump-steer deltas from kinematics module afterwards. Steering rate-limit/low-pass for smoothness (1st order, tau ~ 0.05-0.08 s).
6.4 Wheel spin: omega_i = v_wheel_i / r_eff where v_wheel_i = v*(1 - yaw_rate*y_i/v...)  => omega_i = (v - yaw_rate*y_i)/r_eff (inside wheel slower). Accumulate spin angle += omega*dt; add braking/acceleration slip ratio (slip kappa from Fx/(Cx*Fz)) for visual wheel-slip, optional. r_eff = r_free - Fz/kt (loaded radius, shows visibly under load).
6.5 Body pose from sim: body position = Frenet pose; add zs, roll phi, pitch theta; hub positions = body corner - travel along suspension kinematic path; steering about kingpin axis.
6.6 Slip angle & lateral dynamics for grip UI (linear bicycle, steady-state, driven by path not integrated):
   beta (body slip) steady: beta = b/R - (m*a_y*a)/(C_r*L)  ;  or directly alpha_f = delta - beta - a*r/v ; alpha_r = -beta + b*r/v   (r = v*k yaw rate)
   For a kinematic path the car follows delta=L*k exactly (zero slip); to display slip: alpha_f,r from the steady-state force balance: Fy_f = m*ay*b/L, Fy_r = m*ay*a/L  =>  alpha_f = inv_tyre(Fy_f), alpha_r = inv_tyre(Fy_r)  (apply per axle with axle Fz incl. load transfer, so extra load transfer reduces grip => visible).
   Optionally visualise drift/body slip: car heading = path tangent + beta_vis with beta_vis = alpha_r - alpha_f(small). Keep |beta_vis| < 3 deg to stay near the path.

## 7. Tyre grip indicator
7.1 Simplified Magic Formula (lateral, pure slip), per tyre i:
   Fy = D*sin(C*atan(B*alpha - E*(B*alpha - atan(B*alpha))))
   D = mu(Fz)*Fz ;  mu(Fz) = mu0 + dmu*(Fz - Fz0)  [load sensitivity; sports road tyre mu0~1.1-1.25, Fz0 ~ 4000 N, dmu ~ -0.00005/N  (so mu falls ~0.1 per 2 kN) [U]]
   Cy ~ 1.3-1.5 ; peak slip ~ 6-9 deg  -> B = tan(pi/(2C))*... simple: B = Kalpha/(C*D) with cornering stiffness Kalpha = 14 to 18 * Fz (N/rad, i.e. 0.25-0.32 N/N/deg) up to saturation; use Kalpha = Cfa*Fz0*sin(2*atan(Fz/(Cfb*Fz0))) (Bakker) or simply  Kalpha = 15*Fz  [U]; E ~ -0.5..1.
   Camber effect: Fy += Kgamma*gamma, Kgamma ~ 0.1-0.2 * Fz/ rad... practical: effective slip alpha_eff = alpha + (Kgamma/Kalpha)*gamma (camber thrust ~ 0.1-0.15 * Kalpha*? ) -> use  alpha_eff = alpha + 0.2*gamma  (gamma positive = top leaning into the turn reduces needed slip). Also tyre mu peak drops if |gamma|_loaded > 3 deg: mu *= 1 - 0.02*(|gamma-gamma_opt|/deg) [U]. gamma = static + camber gain*(travel) + roll_camber*phi  (from the suspension module: this is where MacPherson/wishbone/multilink visibly differ).
   Longitudinal: Fx = Dx*sin(Cx*atan(B*kappa...)) same form, Cx~1.6, Bx from stiffness 20*Fz.
   Combined slip: friction ellipse scaling: Fy*=sqrt(1-(Fx/Fx_max)^2) or use circle for display.
7.2 Grip utilisation per wheel (what to display): util_i = sqrt((Fx_i/(mu*Fz_i))^2 + (Fy_i/(mu*Fz_i))^2); Fy_i requires force distribution: Fy_i = Fy_axle*Fz_i/(Fz_L+Fz_R) (proportional to load) -> util rises on the inside/unloaded wheel -> shows lifting inside wheel and why ARB matters. Overall axle utilisation >1 => "understeer" (front) or "oversteer" (rear) badge; balance = util_f - util_r. Tyre-contact patch colour = util; brake/accel adds Fx.
7.3 Wheel-loss/air: if Fz<=0 hide patch, show wheel droop on kerb hit.

## 8. Typical sports-car parameter set (Aston-Vantage-like, ~1.5 t GT; all [U] engineering typicals, NOT manufacturer data)
| Param | Value |
|---|---|
| Total mass m | 1530 kg (dry 1500 + driver); sprung ms ~ 1390; unsprung per corner mu_f ~ 40 kg (fronts), mu_r ~ 43 kg (rear incl. diff halves) |
| Weight dist | 50/50 (Vantage ~49/51); a=1.35, b=1.35 m (wheelbase L=2.70) |
| CG height | 0.46 m (total), sprung 0.50 m; track tf=1.65, tr=1.62 m |
| Inertia | Ixx (roll) 480 kg m^2, Iyy (pitch) 2100 kg m^2, Izz (yaw) 2350 kg m^2 |
| Wheel rates (ride) | front 38 N/mm (~27 w/ motion ratio^2 ... use wheel rate directly), rear 42 N/mm; range 30-55 |
| Ride frequency | front 1.45 Hz, rear 1.55 Hz  (omega = sqrt(kw/(ms_corner))): ms corner ~ 350 kg -> kw=2.9e4 N/m for 1.45 Hz => 29 N/mm. Use kw_f = 30e3, kw_r = 32e3 N/m (tune to Hz) |
| Damper (wheel level) | zeta body ~0.6: c = 2*zeta*sqrt(kw*mscorner) = 2*0.6*sqrt(30e3*350)=3900 N s/m total avg; asymmetric: c_bump 2600, c_rebound 5200 N s/m (front); 2800/5600 rear |
| ARB | front roll stiffness from ARB ~ 25-40% of total; kroll_f ~ 38000, kroll_r ~ 26000 N m/rad total (spring + ARB); body roll ~1.2 deg/g |
| Tyre vertical | kt = 260 kN/m (255/35R19 front), 280 kN/m rear; ct ~ 300-500 N s/m (tyre damping ~ 0.02-0.05 critical); unsprung hop f ~ 12-13 Hz |
| Tyre radius | 0.34 m loaded (R20 low profile ~0.33-0.35) |
| Roll-centre heights | strut 0.08-0.12 m (front), double wishbone 0.04-0.08, multilink rear 0.10-0.15; (come from the kinematics module) |
| Anti-dive | 0-40 % front, anti-squat 0-30 % rear; |
| Aero | CD*A ~0.65 m^2 (Cd 0.33, A 2.0), CL*A ~ +0.1..-0.3 |
| Powertrain | 375-500 kW, RWD, max ax accel ~0.8-1.0 g; brake 1.2 g |
Resulting numbers to sanity-check on load: static Fz corner ~ 3750 N; at 0.9 g with t~1.64, h_cg 0.46: total lateral transfer dFz = m*ay*h/t = 1530*8.8*0.46/1.64 = 3780 N total (~ 1890 N per axle if equal), i.e. inside wheels go from 3750 -> ~1860 N: visible but not lifting. Braking 1.2 g: dFz = 1530*11.8*0.46/2.7 = 3075 N front.
Sources for typical ranges: general vehicle-dynamics literature (Milliken, Gillespie, Jazar; arXiv 2101.12629 for model structure [V-search]); SAE 2004-01-1555 [V-search]. Param values above are my engineering defaults: mark as tunable, not factual specs.

## 9. Module API (swappable)
interface RideModel { step(dt, inputs: {ay, ax, roadH:[4], roadHdot:[4], suspSpec}): State }
State = { zs, phi, theta, zu[4], travel[4], Fz[4], Fx[4], Fy[4], gamma[4], util[4], carPoseOffset }
suspSpec (from kinematics module per axle) = { rcHeight(travel,roll), camberGain, antiDive, antiSquat, motionRatio, springRate, damper curve, arbRate, bumpSteer } -> the entire strut / wishbone / multilink difference is injected here, honestly: roll-centre migration (strut: moves laterally + height changes with roll; wishbone: lower rc, more camber gain; multilink: tunable anti-squat + toe compliance).
Pipeline per frame: s += v(s)*dt -> pose (rear axle on spline, front via L) -> ay,ax -> low-pass -> per-wheel road height at world position -> 4 x substeps (240 Hz) -> compute Fz/slip/util -> expose to renderer, shaders (patch colour), HUD.

## 10. Recommendations for Suspension Lab
1. Build own TS module `ride7dof.ts` (~250 lines) from sections 2-4; no dependency. Unit-test: static deflection, modal frequencies, steady-state roll gradient and load-transfer sums (3.1 check), step-bump response.
2. Make the car kinematic (rear axle on the spline, speed table from forward-backward pass in `speedProfile.ts`, reimplemented from the algorithm text, not OpenLAP/TUM code - GPL/LGPL).
3. Feed per-wheel suspension geometry (rc height, camber gain, anti-dive) from the linkage module each substep; this is the only coupling needed to make strut/wishbone/multilink behave visibly differently.
4. Grip HUD: simplified MF (7.1) + per-wheel utilisation; optionally adopt `tread` (BSD-3, Pacejka 2002) if full .tir files are ever required - otherwise too heavy.
5. Fixed 240 Hz substep accumulator, semi-implicit Euler, asymmetric dampers, bump stops, tyre force clamp >=0; low-pass path accelerations (8-10 Hz).
6. Do not integrate full vehicle yaw/slip dynamics: show slip angles via steady-state inverse-tyre from axle loads (6.6) - safe, deterministic, loopable.
7. Unverified items to double-check during implementation: all numeric parameters (flagged [U]), Ackermann sign conventions, ARB equivalent wheel-rate formulation, sprung CG height convention.
