# M2 research 03 — Real-time vehicle dynamics formulations for Manual Drive

Scope: what to add to the existing 240 Hz semi-implicit-Euler 7-DOF ride model (heave/roll/pitch + 4 unsprung)
to get planar x, y, yaw + 4 wheel spins (=> 14-DOF), with ISO 8855 signs, load-transfer split by roll-centre height /
roll-stiffness distribution, and anti-dive/squat. Tags: **[S]** sourced (link), **[D]** derived by me from first
principles in this file (verify with the unit tests in section 7), **[E]** estimate.
Tool note: GitHub API was not enabled for this session, so repo source files were NOT read; the CommonRoad
equations come from the primary PDF (TUM, 2020a), repo facts come from GitHub pages via search/extract.

## 1. Sources, licences, what is stealable

| Asset | URL | Stars / activity | Licence | Use |
|---|---|---|---|---|
| CommonRoad Vehicle Models doc (Althoff & Wuersching, v2020a): point-mass, KS, ST, STD and 29-state multi-body (MB) with parameter Tables 4-8 | https://gitlab.lrz.de/tum-cps/commonroad-vehicle-models/-/raw/master/vehicleModels_commonRoad.pdf (code: github.com/CommonRoad/commonroad-vehicle-models) | repo stars not retrieved; org active (other repos updated Nov 2026) | Other CommonRoad repos are BSD-3-Clause [S: github.com/CommonRoad]. I could NOT open this repo's LICENSE (API blocked). **Verify the LICENSE file before copying code**; equations/parameters in a paper are facts and are re-derived below anyway | Equations (copy-safe as maths), parameter set vehicle 2 |
| Project Chrono (Chrono::Vehicle) | https://github.com/projectchrono/chrono | ~3.1k stars [S] | BSD-3-Clause [S] | ISO 8855 axes [S: api.projectchrono.org/vehicle_overview.html]; handling tyres Pac89, Pac02, TMeasy, TMsimple, Fiala [S: api.projectchrono.org/wheeled_tire.html]; BMW E90 330i TMsimple tyre data exists [S: class hierarchy]. **No reduced-order bicycle/7-DOF template found** in Chrono::Vehicle; it is a full multibody tool. Use for tyre templates + sedan parameters only |
| TUMFTM Open-Car-Dynamics (C++ multibody, ODE state space, Dormand-Prince fixed step, drivetrain + steering-actuator submodels, MF5.2 tyres) | https://github.com/TUMFTM/Open-Car-Dynamics | 148 stars [S] | Apache-2.0 [S] (copyable with NOTICE) | Architecture reference: stateless tyre/aero submodels, stateful drivetrain/steering. Vehicle params are generic single-seater (real ones confidential) [S] |
| LibreCorsa (TypeScript, 500 Hz 6-DOF, roll-centre jacking, anti-dive/squat/lift, carcass relaxation, load-dependent rolling radius) | https://github.com/KhazP/librecorsa | ~new; active Nov 2026 | **AGPL-3.0-or-later since 15 Nov 2026** (earlier code "stays MIT") [S]. Treat as **ideas only**; models/audio are NC | Confirms feature list is feasible in browser TS; do not copy |
| racingcardynamics.com "Steady-state lateral weight transfer" (R. de Oliveira Santos; adapts Milliken) | https://racingcardynamics.com/weight-transfer | blog | No licence stated: ideas/equations only | Three-component lateral load transfer, structure verified below |
| Marco Monster "Car Physics for Games" (mirror) | https://rsms.me/etc/car-physics | - | Unstated: ideas only | Wf=(c/L)W, Fmax=mu*W, drive-torque/wheel-spin loop |
| Beckman "The Physics of Racing" (PhORS) | https://www.team-bhp.com/forum/attachments/technical-stuff/814811d1317211860-brian-beckmans-physics-racing-beckman_-_the_physics_of_racing.pdf | - | Unstated (author copyright): ideas only | Combined slip via vector sum of slip ratio/angle; the equations below are standard and independently derived |
| Edy's Vehicle Physics docs | https://github.com/EdyJ/vehicle-physics-docs | - | Licence not confirmed: ideas only | Stabilizer-bar and anti-roll discussion; Unity-specific |
| MathWorks Vehicle Dynamics Blockset docs | https://www.mathworks.com/help/vdynblks/ug/vehicle-dynamics-blockset-project-templates.html | - | Proprietary docs: equations/DOF counts only | 3-DOF / 7-DOF / 14-DOF taxonomy [S]. 7-DOF there = x,y,yaw + 4 spins; 14-DOF = 6 body + 4 unsprung heave + 4 spins [S]. **Their "7-DOF" is NOT our "7-DOF ride"**; our target is their 14-DOF |
| OptimumG "The anti-antis" | https://optimumg.com/the-anti-antis | - | Ideas only | Anti-dive = atan(A)/atan(B) definition [S] |
| Hobby: jaykumarpatil9099/vehicle-dynamics-models-matlab-simulink (14-DoF, ARBs, Pacejka) | github.com/jaykumarpatil9099/vehicle-dynamics-models-matlab-simulink | tiny | not checked | Cross-check only |

Textbook (not fetched, cite from knowledge, **[E]** for page-level facts): Milliken & Milliken *Race Car Vehicle
Dynamics* (load transfer, roll centres, anti-geometry), Gillespie *Fundamentals of Vehicle Dynamics*, Rajamani
*Vehicle Dynamics and Control* (bicycle model), Schramm/Hiller/Bardini *Vehicle Dynamics* (Springer; its App. A is the
source of the CommonRoad MB model), Pacejka *Tyre and Vehicle Dynamics* (brush model).

Key fact from CommonRoad [S]: the MB model reuses Schramm's equations whose body block uses **z down**
(`x13_dot = g - sum(Z_s)/m_s`; left-wheel speed `u + 0.5*T*r`), i.e. SAE-like axes, while the document's position
kinematics are planar x/y/psi. If we copy their formulas for sprung/unsprung blocks we must flip signs for ISO. It also
omits bump stops and squat/lift (anti-geometry) forces [S], so we add those ourselves (section 4).

## 2. Model ladder (what each level is for)

| Level | DOF | Use in Suspension Lab |
|---|---|---|
| Kinematic bicycle `beta = atan(tan(delta)*lr/L)` | 3 | Low-speed blend (< ~1.5 m/s), initial condition seeding |
| Dynamic single-track (CommonRoad ST, eq. 11) | 3 (+wheel) | Reference/oracle for unit tests of the full model, understeer gradient |
| Planar 3-DOF + 4 spins + load transfer by closed form | 7 | Cheapest "manual drive" option; loses real pitch/roll feedback |
| **Planar 3 + our 7-DOF ride + 4 spins** | **14** | **Target.** Wheel loads come from real suspension states; RC and anti-pitch inputs already exist in `RideInput` |
| 14-DOF + compliance (Schramm A61-A68 "compliant joint": roll-axis lateral spring `K_RAS`, damper `K_RAD`) | 14 + 2 | Skip; only needed for rollover-grade fidelity |

CommonRoad ST (eq. 11, ISO-consistent in position, state `(sx, sy, delta, v, psi, psidot, beta)`) [S], with
axle load transfer `Fz,f = m(g lr - a_long hcg)/(lr+lf)`, `Fz,r = m(g lf + a_long hcg)/(lr+lf)`, `C_i = mu*C_S,i*Fz,i`:

    beta_dot = mu/(v(lr+lf)) * [ C_Sf (g lr - a h) delta - (C_Sr (g lf + a h) + C_Sf (g lr - a h)) beta
                 + (C_Sr (g lf + a h) lr - C_Sf (g lr - a h) lf) psidot/v ] - psidot
    psi_ddot = mu m/(Iz (lr+lf)) * [ lf C_Sf (g lr - a h) delta + (lr C_Sr (g lf + a h) - lf C_Sf (g lr - a h)) beta
                 - (lf^2 C_Sf (g lr - a h) + lr^2 C_Sr (g lf + a h)) psidot/v ]
    switch to kinematic model below |v| < 0.1 m/s (their choice; hard switch)

Parameters [S, Table 4/5, vehicles 1,2,3 = columns]: `C_S,f = C_S,r = 20.89 1/rad`, `mu = 1.048` (so
C_alpha = mu*C_S*Fz ~ 22 N per N per rad, ~1530 N/deg at 4 kN) [D from S].

## 3. Conventions (ISO 8855) — use these everywhere

Right-handed, vehicle-fixed frame at the sprung-mass CG: **x forward, y LEFT, z UP**. World frame same handedness
(Chrono uses exactly this [S]).

| Quantity | Positive means | Note |
|---|---|---|
| yaw psi, rate r | counter-clockwise seen from above (left turn) | right-hand about +z |
| roll phi, rate p | rotation about +x: **left side up, body rolls to the RIGHT** | so in a LEFT turn (a_y > 0) body rolls to the outside = phi > 0 |
| pitch theta, rate q | rotation about +y: **nose DOWN** | braking dive => theta > 0; accel squat => theta < 0 |
| heave z | up | |
| a_y, F_y | to the left | left turn => a_y = u*r > 0 |
| wheel spin omega_i | about +y; **forward rolling => omega > 0** | contact patch moves backward relative to hub |
| slip ratio kappa | `(R_e*omega - v_wx)/max(\|v_wx\|, eps)`, > 0 driving | F_x > 0 forward on the wheel |
| slip angle alpha (my definition) | `atan2(v_wy, \|v_wx\|)` of the contact-point velocity in the wheel frame; > 0 when patch slides LEFT of heading | restoring force `F_y = -f(alpha)*...` (negative = to the right). Pacejka's alpha is `-alpha` here |
| steer delta | CCW (left) | |
| bump travel s_i | wheel moves up relative to body | existing ride model: "+ bump" |

The MathWorks page for ISO8855 is internally ambiguous about handedness wording (lists "clockwise" rotations) [S:
mathworks.com/help/vdynblks/ug/coordinate-systems-in-vehicle-dynamics-blockset.html]; the table above is the
right-hand-rule reading and agrees with Chrono. Corner order stays fl, fr, rl, rr with `y_fl=+Tf/2`, `y_fr=-Tf/2`.

Body point vertical displacement (small angles) [D]: `z_b,i = z + y_i*phi - x_i*theta` (check: phi>0 lifts the left side, theta>0
lowers the nose). Existing ride model keeps `travel_i = z_u,i - z_b,i - static`.

## 4. Equations of motion to add (14-DOF extension of the existing 7-DOF ride)

Notation: `u,v` body-frame velocity of CG (x fwd, y left), `r` yaw rate, `m = m_s + sum m_u,i`, `Iz` yaw inertia of the whole
car about CG height axis, `h_s` sprung-CG height above ground (static), `x_i,y_i` contact-patch positions in the
vehicle frame, `delta_i` steer angle (fl,fr; rear = 0 or small toe from kinematic table), `R_e` effective rolling
radius, `I_w` wheel inertia.

### 4.1 Corner kinematics and slip (per wheel) [D; CommonRoad eq. "individual tire velocities" uses the SAE-sign form]

    v_x,i = u - r*y_i                     (ISO: left wheels slower in a left turn)
    v_y,i = v + r*x_i
    v_wx,i =  v_x,i*cos(d_i) + v_y,i*sin(d_i)        (wheel frame)
    v_wy,i = -v_x,i*sin(d_i) + v_y,i*cos(d_i)
    kappa_i = (R_e*omega_i - v_wx,i)/max(|v_wx,i|, eps_v)        eps_v ~ 0.5-1 m/s
    alpha_i = atan2(v_wy,i, max(|v_wx,i|, eps_v))
    gamma_i = camber from kinematic table at (travel_i, rack) + body roll contribution (existing)

Tyre force in wheel frame `(F_x,i, F_y,i)` = f(N_i, kappa_i, alpha_i', gamma_i) with `alpha'` the relaxed slip angle
(4.6). Rotate to the vehicle frame:

    Fx_v,i = F_x,i*cos(d_i) - F_y,i*sin(d_i)
    Fy_v,i = F_x,i*sin(d_i) + F_y,i*cos(d_i)

### 4.2 Planar rigid-body equations (all mass moves with the car in the plane) [D, standard; CR ẋ4/ẋ11 agree up to sign]

    m (u_dot - v*r) = sum Fx_v,i - F_drag(u) - F_roll
    m (v_dot + u*r) = sum Fy_v,i
    Iz r_dot        = sum ( x_i*Fy_v,i - y_i*Fx_v,i ) + sum Mz_i          (Mz = aligning moment, optional)
    X_dot = u*cos(psi) - v*sin(psi);  Y_dot = u*sin(psi) + v*cos(psi);  psi_dot = r
    a_x = u_dot - v*r,  a_y = v_dot + u*r      (use these as chassis accelerations for the ride model)

Note `x_i*Fy - y_i*Fx` is the z-component of r x F in the ISO frame (check: left-turn-inducing front lateral force
pushes left at +x => positive r).
Sign check of centripetal term: steady left turn, `v=0`, `u=const`, `r>0` => `m*u*r = sum Fy_v > 0` (force to the left) correct.
Ignore `I_xz` (CommonRoad also sets it to 0 for all three cars [S]).
Gravity/aero downforce: add `N_aero,i` to the vertical load per axle (existing ride model may already do it).

### 4.3 Wheel spin (one ODE per wheel) [S: CommonRoad x24..x27; D: sign adapted]

    I_w * omega_dot_i = T_drive,i - T_brake,i*sgn_brk(omega_i) - R_e*F_x,i - T_rr,i
    T_drive/T_brake from driver input via fixed split (CommonRoad: brake split T_s,b = 0.76/0.66/0.64 front,
        engine split T_s,e = 1/0/0, each axle shared equally L/R by an open diff) [S]
    omega_i >= 0 when braking to a stop: clamp omega at 0 (CommonRoad forbids negative spin) [S]; allow negative for reverse gear only
    I_w = 1.70 kg m^2 (CommonRoad, every vehicle) [S]; R_w = 0.344 m [S]  (that I_w looks high for a 0.34 m wheel: 1.0-1.3 is more typical [E])

**Numerical warning (important for 240 Hz) [D]:** explicit update of `omega` is unstable at low speed because the slip
loop gain is `R_e^2 * dFx/dkappa / (I_w * |v|)`. Stability bound `dt < 2*I_w*|v|/(R_e^2*C_kappa)`: with
I_w=1.7, R=0.344, C_kappa=1e5-2e5 N/unit slip: v=1 m/s => dt_max 0.14-0.29 ms; v=5 => 0.7-1.4 ms; v=22 => 3.2-6.3 ms.
Our dt = 4.17 ms => explicit is unstable below ~20 m/s. CommonRoad dodges it by switching to a kinematic model below 0.1
m/s [S], which is not enough for an Euler step. Use a **semi-implicit wheel update**:

    kap  = (R_e*omega - v_wx)/max(|v_wx|, eps_v)
    Fx0  = f_x(kap, ...),   k_eff = max(dFx/dkappa, C_min) * R_e/max(|v_wx|, eps_v)      (N per rad/s)
    omega_new = omega + dt*(T_net - R_e*Fx0) / (I_w + dt*R_e*k_eff)
    (T_net includes drive, brake, rolling resistance; brake torque handled as a clamp that cannot reverse the sign of omega)

For the lateral channel use the same trick via a **relaxation-length lag** (single-point contact, Rill/Pacejka):
`alpha'_dot = (|v_wx|/sigma_a)*(alpha - alpha')`, integrated implicitly `alpha'_new = (alpha' + k*alpha)/(1 + k)`,
`k = dt*|v_wx|/sigma_a`, `sigma_a ~ 0.3-0.6 m` [E]; same for kappa with `sigma_k`. This removes the need for CommonRoad's hard
0.1 m/s kinematic switch (the lag makes forces go to zero smoothly as v->0) and gives the correct transient yaw response.
Add a small Coulomb-style "parking brake" (hold omega=0 and u=0 when |u|<0.05 and throttle=0) to avoid creep.

### 4.4 Vertical loads (tyre) — unchanged from the ride model

    N_i = max(0, K_t,i*(z_road,i - z_u,i) + C_t,i*(zdot_road - zdot_u,i))     (tyreRate, tyreDamping already exist)

### 4.5 Sprung body and unsprung masses with anti-roll / anti-pitch forced through the links ("force-input form")

For axle a (front/rear) with roll-centre height `zrc_a`, track `t_a`, tyre lateral and longitudinal force sums in the
VEHICLE frame `Y_a = Fy_v,left + Fy_v,right`, `X_a = Fx_v,left + Fx_v,right`, and the side-view IC (pitch-centre)
at `(x_ic,a, z_ic,a)`:

    Roll jacking (front view, each wheel IC -> RC at zrc_a):  J_i = -sgn(y_i) * Y_a*zrc_a / t_a
    Pitch geometry (side view):                  V_a = X_a * z_ic,a / (x_ic,a - x_a)         [vertical link force ON THE BODY, N, per axle]
        -> per corner  P_i = V_a/2
    ("antiPitch" in the existing RideInput = z_ic,a/(x_ic,a - x_a) = tan(psi_a) slope; positive slope => anti-dive for front braking, anti-squat for rear drive)

Derivation [D]: massless carrier, links transmit force along contact-patch -> IC line (the line along which links do no work), so
`L_z/L_x = z_ic/(x_ic-x_a)` with `L_x = -X_a`, hence body receives `(X_a, V_a)` on the line through contact patch and IC. Front braking
`X_a<0`, IC behind (`x_ic-x_a<0`) and above (`z_ic>0`) => `V_a>0` (lifts the body: anti-dive) — matches the intuition and OptimumG's definition.
The same argument in the front view, with the two wheel ICs meeting at the RC, gives `J_i` (outer wheel pushes up on the carrier).

Apply to the model:

1. **Body** receives (i) spring/damper/ARB/stop forces `F_i` (+ up) at the corners, (ii) lateral `Y_a` and longitudinal `X_a` applied
   at the **ground plane** (lever arm `h_s` below the sprung CG), (iii) vertical link forces `P_i` (anti-pitch) at the corners.
   Net **roll jacking does NOT act on the body vertically** with this bookkeeping (equivalent to lateral force at the RC; shown in 4.7) but
   acts on the unsprung wheel instead (item 2).
2. **Unsprung wheel i** receives `N_i - F_i - m_u g`, plus `-J_i` (roll jacking), plus `-P_i` (equal and opposite to the body, net vertical = 0).

Sprung-body equations (ISO signs, small angles, `F_i` = suspension force on body, up positive; gravity cancelled by static preload):

    m_s * z_ddot  = sum F_i + sum P_i                                         (heave; P acts on the body, -P on the unsprung wheels, net vertical 0)
    Ix * phi_ddot = sum y_i*F_i + h_s * sum Y_a  + m_s*g*h_arm*phi            (roll, h_arm = h_s - roll-axis height at CG x)
    Iy * theta_ddot = -sum x_i*F_i - sum x_a*P_a  - h_s * sum X_a             (pitch)
    F_i = k_w,i*s_i + c(s_dot_i)*s_dot_i + F_arb,i + F_stop,i + F_coulomb,i    (existing)
    F_arb,f = K_arb,f*(s_fl - s_fr)*(+1 on left, -1 on right)    (rate per side difference, equal and opposite)

Checks: roll term `h_s*Y`: left turn `Y>0` => `+` roll moment => phi>0 (rolls to the outside/right) matches the ISO table.
Pitch term: a force `X` at ground level (height `-h_s` relative to the CG) gives `tau_y = z*Fx - x*Fz = -h_s*X`, so braking `X<0` => `tau_y > 0` => theta_ddot > 0 => nose down (correct ISO sign).
Roll term: `tau_x = y*Fz - z*Fy = +h_s*Y`, left turn `Y>0` => phi_ddot > 0 (rolls right). Unit tests T4/T5 in section 7 catch sign slips of this class.

Unsprung chassis-plane inertia: treat unsprung lateral/longitudinal accelerations as equal to the car's `(a_x, a_y)`; their
inertial load transfer enters via `m_u,a*a_y*z_u,a/t_a` (section 5) — in the force-input form add `Y_u,a = m_u,a a_y` at height `z_u,a` (wheel-centre ~ R_e) by letting
tyre forces `Y_a` include it, i.e. use `Y_a = Y_tyre,a` (not minus unsprung inertia) when computing `J_i`, and add
`+ m_u,a*a_y*(z_u,a - zrc_a)/t_a * (-sgn y_i)` to the corner unsprung force if you want the exact split; the error from ignoring it is
`~ 2*64*0.8g*0.30/1.38 ~ 220 N` per axle at 0.8 g [E], small but it is exactly the "unsprung" term in racingcardynamics' list.

### 4.6 Tyre model (keep it cheap and honest)

Existing plan: simplified Magic Formula with friction ellipse (architecture 7.2.3). For Manual Drive add:
combined slip via **brush / Fiala vector form** (works naturally through zero speed): with `theta = C_alpha/(3 mu N)`, composite slip
`sigma = sqrt(sigma_x^2 + (tan alpha')^2)`, direction cosines `sigma_x/sigma`, `tan(alpha')/sigma`:

    |F| = mu N * (3 theta sigma - 3 (theta sigma)^2 + (theta sigma)^3)   for theta sigma < 1,  else mu N
    F_x = +|F|*sigma_x/sigma,  F_y = -|F|*tan(alpha')/sigma        (ISO: restoring sign)

[E: Pacejka, *Tyre and Vehicle Dynamics*, Ch. 3 brush model; the same cubic is the core of Chrono's `ChFialaTire` (BSD-3), which we may read/copy: api.projectchrono.org/wheeled_tire.html.]
Load sensitivity `mu(N) = mu0*(1 - 0.06*(N/N0 - 1))` [E] and camber effect `alpha_eff = alpha + 0.2*gamma` (already in architecture) can be layered.
CommonRoad uses full PAC2002 (`PDx1..`) for all four wheels, parameters from the MF-Tyre PAC2002 example file [S]; not needed.

### 4.7 Why the bookkeeping in 4.5 reproduces textbook load transfer (so unit tests have closed forms) [D]

Steady cornering, front/rear axle a. Body roll equilibrium about the roll axis with `K_phi = K_phi,f + K_phi,r`:
`K_phi*phi = m_s*a_y*h_arm + m_s*g*h_arm*phi`. Wheel-load transfer per axle (outer minus static, one side):

    dN_a = (1/t_a) * [ K_phi,a*phi  +  Ws_a*zrc_a*(a_y/g)  +  m_u,a*a_y*z_u,a ]
                      elastic (roll)     direct / geometric          unsprung
    with Ws_a = m_s*a_y_per... i.e.  Y_s,a = m_s*a_y*(l_other/L)  (sprung weight share of the axle)  =>  direct term = Y_s,a*zrc_a
    phi = m_s*a_y*h_arm / (K_phi - m_s*g*h_arm)

This is exactly the three-component split in racingcardynamics.com (unsprung + direct-lateral-force/"kinematic" + roll-angle/"elastic") [S: structure];
the gravity shift is inside `phi` (their post shows it is ~3% for realistic cars) [S]. Total over axles: `sum dN_a*t_a = m_s a_y h_s + m_u a_y z_u + m_s g h_arm phi`.
Roll-stiffness-distribution effect: with `K_phi,a/K_phi = Ws_a/Ws` and equal RC heights the RC height drops out [S: racingcardynamics, "weight distribution = roll rate distribution => independent of RC heights"]; more front roll stiffness => more front transfer => more
understeer (front axle loses lateral capacity through load sensitivity) [S].

Longitudinal (symmetric, `a_x` braking <0): total transfer `dN_long = -m*a_x*h_cg/L` onto the front axle [S: CommonRoad ST uses this; suspensionsecrets.co.uk].
Geometric share carried through the links: `Bf*tan(psi_f)*L/h_cg` (front, outboard brakes) = anti-dive fraction (usual %-anti-dive formula `tan(theta)*L/h*Bf*100` [S: JS Suspension/OptimumG snippet, consistent with 4.5 derivation]).
Elastic remainder sets pitch: `theta_ss = (1 - AD)*m_s*|a_x|*h_pitch_arm / K_theta` with `K_theta = 2 k_f x_f^2 + 2 k_r x_r^2 (+ARB-free)` [D].

Worked numbers (CommonRoad vehicle 2 / BMW 320i set, Table 6 [S]; RC 0.08/0.12 m, unsprung CG 0.30 m [E]; springs only, no ARB) [D from S/E]:

| Quantity | Value |
|---|---|
| Wheel rates K_S,F/K_S,R (N/m) | 24 450 / 19 630 [S] |
| Roll stiffness `K_phi = 0.5 k t^2` | front 23.5 kNm/rad, rear 18.3 kNm/rad (distribution 56.3% front) [D] |
| Roll angle at 0.8 g | 6.06 deg (7.6 deg/g, springs only; ARBs would cut this) [D] |
| Outer-wheel load increase per axle @0.8 g | front 2142 N, rear 1825 N (front 54.4% of moment) [D] |
| Braking 0.8 g total longitudinal transfer | 1910 N (m=1093, h=0.574, L=2.578) [D] |
| Anti-dive with Bf=0.65, tan(psi) 0.05 / 0.10 | 14.6% / 29.2% [D] |
| Pitch stiffness `K_theta` | 144.7 kNm/rad [D] |

Note these CommonRoad vehicle dimensions give `L = 2.578 m`, shorter than a real E90 (2.76 m); fine for tests, label as "model data" not BMW data.

## 5. Parameter sets (take as test fixtures, not as DB11 data)

CommonRoad Table 6, multi-body vehicle parameters (SI) [S: vehicleModels_commonRoad.pdf, cols vehicle 1 / 2 / 3]:

| Param | V1 | V2 (BMW 320i) | V3 |
|---|---|---|---|
| m | 1225 | 1093 | 1478 |
| m_s | 1094 | 965 | 1316 |
| m_u,f = m_u,r | 65.67 | 63.79 | 81.14 |
| lf / lr | 0.883 / 1.508 | 1.156 / 1.422 | 1.150 / 1.321 |
| I_phi,s (roll) | 244.0 | 207.2 | 479.8 |
| I_y,s (pitch) | 1342 | 1565 | 2204 |
| Iz (whole) | 1538 | 1791 | 2473 |
| K_S,F / K_S,R (N/m) | 21 890 / 21 890 | 24 450 / 19 630 | 33 570 / 39 120 |
| K_SD,F / K_SD,R (Ns/m) | 1459 / 1459 | 1786 / 1649 | 2405 / 2769 |
| Tf / Tr | 1.389 / 1.423 | 1.386 / 1.364 | 1.574 / 1.543 |
| K_ZT tyre (N/m) | 189 700 | 158 200 | 212 600 |
| h_cg / h_s | 0.557 / 0.594 | 0.574 / 0.613 | 0.747 / 0.804 |
| I_u,f / I_u,r (roll, unsprung) | 32.53 / 32.53 | 30.67 / 29.67 | 50.27 / 48.34 |
| I_w, R_w | 1.70, 0.344 | 1.70, 0.344 | 1.70, 0.344 |

Caveats: CommonRoad sets `h_RA,F = h_RA,R = 0` (roll axis at ground) and gives "auxiliary torsional roll stiffness" `K_TS` with **negative** values (e.g. -0.69e4 Nm/rad front, V2) [S] —
these are Schramm-convention corrections, not physical ARB rates; do not import them as anti-roll bars.
Our DB11-sized car: take mass/CG/inertia from the existing definition. Yaw inertia: CommonRoad's `Iz` implies radius of gyration `k_z = sqrt(Iz/m)` = 1.12 / 1.28 / 1.29 m for V1/V2/V3, i.e. `k_z/L = 0.47-0.52` [D from S] — large (it includes mass at the ends). Typical road-car guidance is `k_z/L ~ 0.35-0.45` [E]; use `k_z ≈ 0.40 L` for the GT car and expose it as an honest "model" parameter.
Tyre baseline: `mu = 1.0-1.1`, cornering stiffness 1400-1700 N/deg per 4 kN [D from S: CR gives 20.89 1/rad * mu].
Chrono sedan/BMW E90 TMsimple tyre data (BSD-3) can supply a second, independent tyre parameter set [S: class hierarchy lists `BMW_E90_TMsimpleTireFront/Rear`].

## 6. Integration plan inside the existing loop (240 Hz, semi-implicit Euler)

State: `[u, v, r, psi, X, Y]` (6) + wheel `omega_i` (4) + relaxed slips `alpha'_i, kappa'_i` (8, optional) + existing ride `[z, phi, theta, + rates, 4 z_u, 4 zdot_u]`. No allocation: reuse typed arrays like `RideState`.
Per step order (important for stability, mirrors existing `RideInput`):

1. Chassis accelerations `a_x, a_y` from last step; kinematic tables give `zrc_a`, `antiPitch_a`, `gamma_i`, `toe_i` at current travel/rack.
2. Tyre vertical loads `N_i` (4.4) from the ride state; clamp >= 0 (airborne => zero force, already done).
3. Corner kinematics (4.1) -> slips -> relaxed slips (implicit lag) -> tyre forces (4.6).
4. Ride forces with `Y_a, X_a, J_i, P_i` (4.5) -> update `z, phi, theta`, unsprung `z_u` (symplectic: velocity first, then position).
5. Planar update (4.2) using the same tyre forces; wheel spin implicit update (4.3). Integrate `v` implicitly in the lateral damping direction at very low speed or rely on the lag + `eps_v` regularisation.
6. Optional steering actuator: first-order, rate-limited `delta`, `ddelta/dt = clamp((delta_cmd - delta)/tau_s, +-rate)` [E: tau_s 0.05-0.1 s, rate 0.5 rad/s]; Ackermann via kinematic geometry gives `delta_L/R`.

Auto <-> Manual continuity from `stateAt(t)`: `u = path speed`, `v = 0` (or `u*beta_kin`), `r = kappa_path*u`, `omega_i = v_wx,i/R_e`,
`delta` from kinematic bicycle `delta = atan(L*kappa)` (+ small understeer term), `alpha'=kappa'=0`, ride states already continuous. This follows CommonRoad's own
"precise initialisation" recipe: `omega0 = vx0/R`, `v_y,f0 = vy0 + lf*r0`, spring deflection from static loads [S: Table 8 recipe].
Switch Manual -> Auto: re-project onto the path (nearest s), blend `delta` and speed with a short authority crossfade; ride model state continues.

Budget [E]: 4 tyre evaluations + 14-DOF algebra << 50 us per step in V8; at 240 Hz that is < 1.2% of a 60 fps frame budget.

## 7. Unit tests with closed-form oracles (add to `sim-core` tests)

| ID | Test | Oracle |
|---|---|---|
| T1 | Steady circle, low speed, small delta | `r = u*tan(delta)/L` within 3% (kinematic limit) |
| T2 | Linear steady-state yaw gain at 20 m/s, 0.2 deg steer | CommonRoad ST eq. 11 steady state / `K_us = (m/L)*(lr/C_f - lf/C_r)` understeer gradient; error < 5% |
| T3 | Steady lateral load transfer at 0.5 g | 4.7 closed form within 3% per axle; sums to `m_s a_y h_s + ...` |
| T4 | Braking to rest at 0.8 g, straight | nose-down `theta>0` (ISO!), `dN_front = +m*|a_x|*h/L` within 2%, `u->0` monotone, no wheel lock-flip/NaN |
| T5 | Left turn | `phi > 0` (rolls right), outer = RIGHT wheels carry more, `a_y>0`, `r>0` |
| T6 | Equal roll-rate-distribution = weight-distribution, horizontal axis: change `zrc` | transfer split invariant [S: racingcardynamics] |
| T7 | Anti-dive 0% vs 30%: same decel | pitch angle reduces by 30% (steady), total front load transfer unchanged |
| T8 | 1 m/s, full throttle from rest, 240 Hz | no oscillation in `omega` (implicit update), kappa bounded |
| T9 | Left/right mirror symmetry | mirrored inputs give mirrored state (bit-exact up to sign) |
| T10 | Energy/momentum sanity in free coast with aero off | speed drop equals rolling-resistance integral |

## 8. Recommendation for Suspension Lab

- Build the Manual Drive model as the 14-DOF extension: planar `(u, v, r)` + 4 wheel spins on top of the existing 7-DOF ride; do not add a separate "handling" model that shadows ride — wheel loads must come from the ride states so suspension type stays mechanically meaningful.
- Use ISO 8855 exactly (section 3 table); note that positive roll = right-side down and positive pitch = nose-down, so a left turn gives phi>0 and braking gives theta>0. Add sign-convention unit tests T4/T5 first.
- Adopt the "force-input" load-transfer bookkeeping of 4.5: lateral/longitudinal tyre forces at ground level on the sprung body, plus link vertical forces `J_i` (roll jacking via `zrc`) on the unsprung wheel and `P_i` (anti-pitch via `z_ic/(x_ic-x_a)`) on body AND wheel. It reuses the existing `RideInput.rcHeight/antiPitch` and reproduces textbook three-component lateral transfer and anti-dive %.
- Treat the sign line in the pitch equation in 4.5 as authoritative only after the correction written there (`-h_s*sum X_a`); do not trust any copy-paste without T4.
- Make wheel-spin and slip-angle updates semi-implicit (4.3) with relaxation-length lag (`sigma ~ 0.3-0.6 m` [E]). Explicit spin at 240 Hz is unstable below ~20 m/s [D]; do not rely on CommonRoad's 0.1 m/s kinematic switch.
- Tyre: keep the simplified MF already planned, and add a brush/Fiala composite-slip variant as a robust fallback through zero speed; Chrono's Fiala/TMsimple (BSD-3) may be read and ported.
- Copy only equations and parameters from CommonRoad (verify the repo LICENSE first; org uses BSD-3-Clause [S]); remember its MB block uses z-down axes and omits anti-geometry and bump stops [S].
- Do NOT copy LibreCorsa (AGPL-3.0-or-later since 15 Nov 2026, NC assets) — useful only as proof that a TS 500 Hz roll-centre/anti-dive model is feasible in browser.
- Blog/book sources (racingcardynamics, Marco Monster, Beckman, Edy) are ideas-only; every equation we ship should be re-derived and unit-tested (section 7), which section 4.5-4.7 already does.
- Parameter honesty: CommonRoad vehicle-2 numbers are "model data" fixtures (roll stiffness ~7.6 deg/g, no ARB); label DB11 tyre/inertia values as estimates in the UI (yaw radius of gyration `~0.40 L` [E], mu 1.0-1.1 [S/E]).
- Risks: (1) roll-axis geometry assumption (fixed RC height per axle) fails at large travel, so recompute `zrc` and `antiPitch` from kinematic tables each step; (2) small-angle pitch/roll fine to ~8 deg, beyond that add `cos` terms; (3) inboard drive/brake torque reaction changes anti-squat geometry (use wheel-centre line instead of contact-patch line); (4) friction-limit transients at low speed depend on `sigma` choice, expose as "model" parameter; (5) steering-rack-dependent toe/camber from tables must be fed into `delta_i` and `gamma_i` each step.
- Skip: compliant-joint roll-axis springs (Schramm A61-A68), full PAC2002 parameter set, turn slip, 3-D rigid-body 6-DOF with gyroscopics; they add cost without changing what an educational demo shows.
