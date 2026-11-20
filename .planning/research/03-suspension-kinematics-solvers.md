# 03 - Suspension kinematics solvers, maths and hardpoint data

Scope: open-source solvers/visualisers that go hardpoints -> upright/wheel pose, the exact maths for the three layouts, a robust numeric method, and real hardpoint sets. Research done 2026-11-20. Everything numeric in section 5 was **reproduced by me with a Python prototype of the method in section 3** (script reproduced in section 7), so the method and the data are verified together.

## 1. Sources found (licence-gated)

| Repo | URL | Stars / activity | Licence | Usable? |
|---|---|---|---|---|
| **Project Chrono** (C++ templates + JSON hardpoints) | https://github.com/projectchrono/chrono | ~3.1k stars; HEAD commit 2026-11-17 (cloned) | **BSD-3-Clause** (LICENSE verified: "Copyright (c) 2016, Project Chrono Development Team", 3-clause) | **YES** - for data and for reading joint topology. It is a dynamics engine, not a kinematic solver, so there is no solver to port; the value is the topology and the real hardpoints. |
| open-kinematics / suspension-explorer-core (Nick McCleery) | https://github.com/nickmccleery/open-kinematics (org: github.com/suspension-explorer) | ~37 stars (from search listing, unverified); last commit 2026-10-04 | **AGPL-3.0** (LICENSE file verified) | **NOT usable** (copyleft; network-service clause). Read for ideas only, do not copy. Supports double wishbone, MacPherson, 5-rod multi-link, semi-trailing arm; solves with SciPy `least_squares(method="lm")` + analytic Jacobians; metrics incl. camber/toe/caster/KPI/scrub/trail/IC/RC/anti-dive/motion ratio (`src/kinematics/core/solver.py`, `constraints.py`, `jacobians.py`, `metrics/`, `suspensions/corner/{double_wishbone,macpherson,multi_link}.py`). Blog explaining the DW method: https://www.nickmccleery.com/posts/11-suspension-kinematic-simulation |
| opensus (web app/docs) | https://opensus.app/docs/double-wishbone/ | unknown | **Unverified** - page names no licence or repo | Not usable until licence is found. Useful only as a **sanity check**: its published DW example (mm): ucaFront(100,280,330) ucaRear(-100,280,330) ucaOuter(-15,530,340) lcaFront(100,200,150) lcaRear(-100,200,150) lcaOuter(5,550,120) tieInner(-70,200,150) tieOuter(-70,550,120) wheelCentre(0,600,228) -> camber gain -0.317 deg/10 mm bump, RC height 89.9 mm, KPI=caster=5.19 deg, scrub 39.1 mm. Good regression test for our solver (facts/numbers, not code). |
| papacad calculator | https://www.papacad.com/suspension-kinematics-calculator | closed web tool | n/a | reference for expected behaviour only |
| Altair MotionView docs | help.altair.com (virtual kingpin/scrub definitions) | commercial docs | n/a | definitions of virtual kingpin for 5-link (steering free, travel locked) - same idea as my instantaneous steer-axis method below |

No permissively licensed JS/TS/Julia/MATLAB kinematics solver turned up in several searches (Tavily + Firecrawl developer index). **Conclusion: write our own TS solver (about 300 lines); the maths below is textbook and licence-free.** Use Chrono for data, open-kinematics only as a behavioural cross-check (run it locally as a test oracle, do not ship it).

### Chrono files worth reading (all BSD-3)
- Topology (joint types per link): `src/chrono_vehicle/wheeled_vehicle/suspension/ChDoubleWishbone.cpp` (`InitializeSide`), `ChMacPhersonStrut.cpp`, `ChMultiLink.cpp`.
- Hardpoint JSON (raw paths under https://raw.githubusercontent.com/projectchrono/chrono/main/):
  - `data/vehicle/sedan/suspension/Sedan_DoubleWishbone.json`
  - `data/vehicle/sedan/suspension/Sedan_MultiLink.json` (identical geometry in `data/vehicle/audi/json/audi_MultiLink.json`)
  - `data/vehicle/generic/suspension/MacPhersonStrut.json`
  - `data/vehicle/hmmwv/suspension/HMMWV_DoubleWishboneFront.json` (truck, big numbers)
  - Vehicle-level: `data/vehicle/sedan/vehicle/Sedan_Vehicle.json` (wheelbase 2.776 m; front suspension origin (1.388,0,0.25), rear (-1.388,0,0.125) in chassis frame), `data/vehicle/sedan/tire/Sedan_RigidTire.json` (tyre radius 0.3266 m, width 0.245 m).
- Frame convention (from Chrono header comments): X forward, Y left, Z up; origin on the car midplane at the axle; **all points given for the LEFT side**; right side = mirror y -> -y. Spindle location = the `Spindle.COM` entry.
- Chrono topology facts (verified in the .cpp):
  - **Double wishbone**: spindle-upright revolute; UCA and LCA each = revolute to chassis (axis through Chassis-Front/Back points) + spherical to upright; tie rod = distance constraint (or spherical + universal links) chassis->upright. Spring/damper chassis->LCA (`SHOCK_C`,`SHOCK_A`).
  - **MacPherson**: LCA = revolute to chassis (front/back points) + spherical to upright; **strut is a separate body**, universal joint chassis<->strut at `SPRING_C`, **cylindrical joint strut<->upright at `SPRING_U`** (slides + spins along the strut axis); tie rod distance constraint. Spring/damper are along strut (chassis point SPRING_C to upright point SPRING_U).
  - **MultiLink (5-link as Chrono defines it)**: upper arm (revolute to chassis through UA_F/UA_B, spherical UA_U to upright) = 2 constraints; lateral link (universal at chassis LAT_C, spherical at upright LAT_U) = 1; trailing link (universal TL_C, spherical TL_U) = 1; tie rod = 1. Total 5 link constraints. Spring/damper on the trailing link.

## 2. Degrees-of-freedom bookkeeping (why 6 equations)

The upright is one rigid body: 6 DOF. A suspension must leave exactly 1 (wheel travel) with steering locked. So we need 5 constraint equations + 1 travel-prescription equation = 6 equations in 6 unknowns, so Newton is square.

| Layout | 5 constraints |
|---|---|
| Double wishbone + tie rod | LBJ on LCA circle (2 sphere eqns: distance to LCA_F, to LCA_B), UBJ on UCA circle (2), tie rod (1) |
| MacPherson | LBJ on LCA circle (2), tie rod (1), strut-line (2: top mount T must lie on the line through upright clamp point S in upright strut direction d) |
| 5-link (Chrono) | upper arm outer point UA_U (2), lateral (1), trailing (1), tie rod (1) |
| Generic 5 rods | five distance constraints |

Steering: move the tie rod chassis end by rack displacement r along Y (`TIE_C.y += r`). No new equation needed. Toe/ steer then comes out of the solve.

## 3. The maths

Notation: upright body points `p_i` given at design position (body frame = design world frame at pose identity). State `x=(t, w)` where `t` in R^3 translation, `w` in R^3 rotation vector, R = Rodrigues(w). Current upright point: `P_i(x) = R(w) p_i + t`. Chassis points `C_j` fixed (hardpoint, optionally moved by body motion; see section 4). Link lengths are measured **once at design pose**: `L = |p_i - C_j|`.

### 3.1 Residuals (use squared distance: smooth, no sqrt singularity)
- Distance (rod, tie rod, one half of a revolute-arm): `r = |P_i - C_j|^2 - L^2`
- (a) **Double wishbone**:
  ```
  r1 = |P_lbj - LCA_F|^2 - L_lf^2     r2 = |P_lbj - LCA_B|^2 - L_lb^2
  r3 = |P_ubj - UCA_F|^2 - L_uf^2     r4 = |P_ubj - UCA_B|^2 - L_ub^2
  r5 = |P_tro - (TIE_C + [0,r_rack,0])|^2 - L_tie^2
  r6 = wc_z(x) - (wc_z0 + dz)         wc(x) = R*wc0 + t
  ```
  (Two distances to the two inboard pivots confine the ball joint to the circle swept by a wishbone about its pivot axis. The kingpin length LBJ-UBJ is implicitly preserved because both are points on the same rigid upright.)
- (b) **MacPherson**: r1,r2 as LCA above; r5 tie rod; strut: `S = R s0 + t`, `d = R d0` with `d0 = unit(T0 - s0)` fixed in upright at design; require `cross(T - S, d) = 0` (3 equations, rank 2; with Levenberg damping this is fine, or build 2 equations by projecting onto two vectors perpendicular to d: `e1 = d x z_hat` normalised, `e2 = d x e1`, `r = [e1.(T-S), e2.(T-S)]`). Strut length (shock stroke) = `|T - S|`, free output. Plus travel equation r6.
  - Strut top mount T is a fixed chassis point (it is the universal joint centre). Strut spinning about its own axis is geometrically irrelevant, which is why only 2 equations are needed.
- (c) **5-link**: five distance residuals: `|P_ua - UA_F|^2-L^2`, `|P_ua - UA_B|^2-L^2`, `|P_lat - LAT_C|^2-L^2`, `|P_tl - TL_C|^2-L^2`, `|P_to - TIE_C|^2-L^2` + r6.

### 3.2 Newton / Levenberg-Marquardt with numerical Jacobian (pseudocode, port directly)

```
function solvePose(x0, dz, rack, tol=1e-12, maxIter=40):
  x = x0
  for it in 0..maxIter:
    r = residuals(x, dz, rack)                    // length m>=6
    if max(|r|) < tol: return x, ok
    J = zeros(m,6)
    for j in 0..5:                                // central difference, h=1e-7 (metres/radians)
      e = unit(j)*1e-7
      J[:,j] = (residuals(x+e) - residuals(x-e)) / 2e-7
    A = J^T J + lambda*I       // lambda = 1e-9 .. 1e-6, handles rank-deficient MacPherson 3-eqn form
    dx = solve6x6(A, -J^T r)                      // 6x6 Cholesky / Gaussian elimination
    x = x + dx                                    // rotation vector additive is fine because |w| stays < ~0.1 rad
  return x, notConverged
```
Robustness rules (all exercised in my prototype):
1. **Continuation**: sweep travel from 0 outward in steps (5-10 mm); warm start each solve with the previous pose. Never solve a far-travel point from the identity pose. In the prototype every solve converged to <1e-12 residual in <10 iterations from a step of 25 mm.
2. **Real-time**: the car loop needs solutions per frame, not sweeps. **Precompute** a lookup table over (travel dz in [-0.1,0.1] m, rack r in [-0.08,0.08] m) -> upright pose + derived metrics, e.g. 41 x 17 grid, bilinear/cubic interpolation at runtime (cost per frame ~ nothing). Or warm-start Newton each frame (1-3 iterations since pose changes little per frame).
3. **Branch selection**: sphere-intersection has two roots; warm start from the previous frame picks the correct branch automatically. Reject solutions if residual > 1e-9 and fall back to clamp at last good pose (bump-stop).
4. Use squared-distance residuals. Optionally scale residuals by 1/(2L) to get metres.
5. Use rotation increments: `x_rot_new = Rodrigues(dw) * R_old` (cleaner for large rolls); additive rot-vec worked fine up to the +-50 mm tests and should for +-100 mm.
6. Cheaper alternative, **analytic**, no iteration, for double wishbone (the form most people use; fine to implement as the fast path):
   ```
   given lower arm angle th: LBJ = rotate about axis(LCA_F->LCA_B) by th        // exact
   UBJ = intersection of circle(UCA axis, radius) and sphere(centre LBJ, radius |LBJ0-UBJ0|)   // circle-sphere: 2 roots, pick nearest previous
   TRO (tie rod outer) = intersection of circle about kingpin axis (LBJ-UBJ) through TRO0 and sphere(centre TIE_C+rack, radius L_tie)
   upright frame = rigid transform mapping (LBJ0,UBJ0,TRO0) -> (LBJ,UBJ,TRO)   // build orthonormal bases from 3 points; Kabsch not needed
   wc = T * wc0 ; find th s.t. wc_z = target by 1-D secant/bisection
   ```
   Circle-sphere intersection = intersect sphere with the circle's plane (gives a circle), then circle-circle (2D). 

### 3.3 Derived outputs
Let `a = R*[0,1,0]` = wheel axle direction (left wheel, pointing outward), `wc` wheel centre, `Rt` tyre radius.
- **Camber** (left wheel, negative = top inboard): `camber = -asin(a_z)` (deg). Right wheel mirrored (sign of y flips; or just solve the left side and mirror).
- **Toe** (toe-in positive, left): `toe = atan2(a_x, a_y)`.
- **Contact patch**: lowest point of tyre circle: `u = unit(down - (down.a)a)`, `cp = wc + Rt*u` with `down=[0,0,-1]` (so cp moves laterally with camber; track change = change in `cp_y`).
- **Track / half-track change**: `cp_y(dz) - cp_y(0)` (sign: positive = widening on the left side).
- **Wheel base / longitudinal travel**: `wc_x(dz)`.
- **Camber gain** = `d camber / d dz` (central diff); **bump steer** = `d toe / d dz`.
- **Motion ratio** (spring/damper): `MR = d(springLen)/d(wheel dz)`. DW: spring between chassis point and arm point `SP_A`; arm point moves by rotating `SP_A0` about the arm axis by angle th (see 4.1). MacPherson: `springLen = |T - S|` directly. 5-link: spring on trailing link -> rotate spring point with link (see 4.3) or approximate with 3-point rigid fit.
- **Instant centre and roll centre (any layout, from the solved motion - recommended)**: from two neighbouring solved poses (dz +- h, h=0.2 mm) get the upright's relative rotation `dR = Rb Ra^T` -> axis `k` and angle `th`, `omega = k*th/(2h)`; velocity of contact patch material point `v_cp = (P_b - P_a)/(2h) + omega x (cp - wc)` where `P` = wheel-centre positions. In the front (y,z) plane with `w = omega_x`:
  `IC_y = cp_y - v_z/w`, `IC_z = cp_z + v_y/w` (IC = r - d with d = (v_z/w, -v_y/w)). **Roll centre**: line from cp through IC intersected with y=0: `t = (0-cp_y)/(IC_y-cp_y); RC_z = cp_z + t*(IC_z-cp_z)`; height = RC_z - ground_z. This replaces any wishbone-line-intersection special casing and works for MacPherson and 5-link. (Classical DW check: IC = intersection of UCA and LCA projected lines in the front view; for MacPherson, IC = intersection of LCA line and the perpendicular to the strut axis through the top mount - my numeric method reproduced both.)
  Note: this gives the *kinematic* roll centre height; migration = RC_z(dz).
  Side-view analog (y,x swap) gives anti-dive/anti-squat/caster-change with the same code.
- **Steering axis / kingpin / caster / scrub / trail** (works for 5-link, where no physical kingpin exists = "virtual" kingpin): solve at rack = +d and -d (d=1 mm) at same dz; `dR = R+ R-^T` -> axis direction `k` (flip so k_z>0); point on axis `p` from `(I - dR) p = t+ - dR t-` (least squares). Then
  `KPI = atan2(-k_y, k_z)` (top leaning inboard positive, left side), `caster = atan2(-k_x, k_z)` (top leaning rearward positive), ground point `g = p + ((cp_z - p_z)/k_z) k`, `scrub = cp_y - g_y` (positive when axis meets ground inboard of patch), `mech trail = g_x - cp_x` (positive when ground point of axis is ahead of the contact centre). For DW/MacPherson with ball joints this equals the line LBJ->UBJ (DW) or LBJ->top mount (strut) - I verified: DW sedan hand calc atan(0.075/0.425)=10.0 deg vs solver 10.01.
- Optional: **Ackermann / steer ratio** = d(toe)/d(rack) at dz=0 (needs a dedicated rack solve; trivially from the same solver).

## 4. Moving chassis (roll/pitch/heave) - how to use the solver in the car
The solver above works in the **chassis frame** with fixed chassis hardpoints. For the vehicle sim you do not need to re-solve per body attitude: compute the wheel's travel `dz_chassis` = (wheel-centre height relative to chassis along the chassis z axis) from the vehicle dynamics (ray/spring model), solve (or look up) the pose in the chassis frame, then transform with the body transform. Roll/pitch are handled because each corner's `dz` and `rack` are different. For visuals: every link endpoint is `C_j` (chassis frame, rigid with body) to `P_i(x)` (upright points transformed), and the arm/link bodies are drawn between the end points (links are rods; wishbones need the intermediate arm angle, 4.1).

### 4.1 Arm points that are not outer ball joints (spring, pushrod, drawing the wishbone)
Arm rotation angle about axis `n = unit(F-B)` through `F`: LBJ0 relative to the pivot line `q0 = (LBJ0-F) - ((LBJ0-F).n) n`, now `q = (LBJ-F) - ((LBJ-F).n)n`; `th = atan2(n.(q0 x q), q0.q)`; any arm point `A = F + Rot(n,th) (A0 - F)`.
### 4.2 MacPherson
Strut sliding length `s = |T - S|` (free var), strut orientation `unit(S - T)`. Visual: damper body hangs from T; rod/clamp at S; coil spring between T and S.
### 4.3 5-link
Trailing link / lateral link are rods: draw `C_j -> P_i`. Spring on a link: place at fixed fraction along the rod (Chrono mounts the spring/shock on a link via `Location Link`) - approximate: arm-attached point `A = C + (A0-C)` rotated; simplest is to store the spring attach point as a fraction `f` along the link (`A = C + f (P - C)`) and accept a few mm error; or add the link's roll angle about its own axis via a 3rd reference point.

## 5. Real hardpoint sets (metres, SUSPENSION frame: X fwd, Y left, Z up, origin on midplane at axle line, LEFT side; mirror y for right) with reproduced results

Frame placement in the car (Chrono Sedan_Vehicle.json): front subsystem origin at chassis (1.388, 0, 0.25), rear (-1.388, 0, 0.125); wheelbase 2.776 m; tyre radius 0.3266 m, so **ground is at z = wheel-centre z - 0.3266** (with spindle z as given: DW sedan ground z=-0.4465). These numbers are from a stock-ish sedan model - realistic scale but not sports-car tuned (the sports car should use a larger track and lower roll centre: see recommendations).

### 5a. Double wishbone - `Sedan_DoubleWishbone.json` (BSD-3, Project Chrono)
```
wheel centre (spindle)   ( 0.000, 0.7979, -0.1199)   tyre R=0.3266
UCA chassis front        (-0.100, 0.4700,  0.1050)
UCA chassis back         (-0.250, 0.5100,  0.1100)
UCA upright (UBJ)        (-0.040, 0.6950,  0.1050)
LCA chassis front        ( 0.200, 0.4200, -0.2700)
LCA chassis back         (-0.200, 0.4700, -0.2650)
LCA upright (LBJ)        ( 0.000, 0.7700, -0.3200)
Tie rod chassis          (-0.200, 0.4200, -0.1200)
Tie rod upright          (-0.150, 0.7700, -0.1200)
Spring/shock chassis     (-0.040, 0.5200,  0.2300)
Spring/shock arm (LCA)   ( 0.000, 0.6200, -0.2700)   free length 0.51
```
Solver results (my prototype, left wheel, bump = wheel up, residual <1e-15):

| travel mm | camber deg | toe deg (in+) | half-track (wc y) mm | contact patch y mm |
|---|---|---|---|---|
| -50 (droop) | +0.80 | +2.28 | 788.6 | 784.1 |
| -25 | +0.44 | +1.01 | 794.4 | 791.9 |
| 0 | 0 | 0 | 797.9 | 797.9 |
| +25 | -0.52 | -0.79 | 799.1 | 802.1 |
| +50 | -1.13 | -1.37 | 798.1 | 804.5 |

At design: camber gain -0.19 deg/10 mm, bump steer -0.36 deg/10 mm (**large: this Chrono model is not toe-tuned; move TIE_C/TIE_U to fix, see recommendations**), IC (y=-2176, z=+156 mm in suspension frame), **roll centre 162 mm above ground**, KPI 10.0 deg, caster 5.3 deg, scrub +6.2 mm, mech trail +10 mm. KPI check by hand = atan((0.77-0.695)/(0.105+0.32)) = 10.0 deg.

### 5b. MacPherson strut - `data/vehicle/generic/suspension/MacPhersonStrut.json` (BSD-3, Project Chrono "generic" vehicle - a wide-track SUV/truck-scale set; use R=0.4 m)
```
wheel centre (spindle)      (-0.0400, 1.1000, -0.0260)
Control arm chassis front   ( 0.2200, 0.5200, -0.1560)
Control arm chassis back    (-0.3000, 0.5070, -0.1370)
Control arm upright (LBJ)   (-0.0217, 0.9406, -0.1740)
Tie rod chassis             (-0.3000, 0.5200, -0.0590)
Tie rod upright             (-0.2374, 0.8950, -0.0161)
Strut top (chassis, SPRING_C)(-0.1150, 0.7850,  0.5790)
Strut lower (upright, SPRING_U)(-0.0740, 0.8533,  0.2485)   spring free length 0.306
```
Results (R=0.4): +50 mm: camber -0.55, toe -1.78, half track 1098.1 (wc), cp_y +1.9 mm; -50 mm: camber +0.89, toe +1.54, cp_y -9.3 mm. Camber gain -0.15 deg/10 mm, bump steer -0.33 deg/10 mm, **roll centre 126 mm above ground**, KPI 11.9 deg, caster 6.6 deg (line LBJ->top mount: atan(0.155/0.753)=11.6 deg OK), scrub 96 mm (wide track, big truck offset - too much for a sports car; see recommendations), IC (y=-2814, z=+23 mm). The sports-car track would be scaled/edited (below).

### 5c. 5-link (multi-link) - `Sedan_MultiLink.json` (== `audi_MultiLink.json`) (BSD-3, Project Chrono)
```
wheel centre (spindle)        ( 0.000, 0.800,  0.000)
Upper arm chassis front/back  ( 0.060, 0.397, 0.082) / (-0.157, 0.358, 0.062)
Upper arm upright (UA_U)      ( 0.056, 0.714, 0.151)
Lateral link chassis (LAT_C)  ( 0.036, 0.188,-0.133)     // 1 rod
Lateral link upright (LAT_U)  ( 0.029, 0.692,-0.093)
Trailing link chassis (TL_C)  ( 0.723, 0.449,-0.072)     // 1 long rod, 0.72 m ahead
Trailing link upright (TL_U)  ( 0.000, 0.714,-0.156)
Tie rod chassis / upright     (-0.257, 0.170,-0.116) / (-0.144, 0.712,-0.056)
Spring: chassis (0.181,0.491,0.110) -> link (0.181,0.419,-0.164), k=167062 N/m, free 0.339
Shock:  chassis (0.171,0.478,0.315) -> link (0.181,0.519,-0.162)
```
(Which axle Chrono's Sedan vehicle JSON assigns this to was not checked; treat as a rear-style multi-link. Same geometry in both files.) Results (R=0.3266): camber -0.84 at +25 mm, -1.85 at +50 mm, +1.20 at -50 mm (gain -0.30 deg/10 mm); **bump steer only +0.02 deg/10 mm** (toe -0.12 .. +0.13 deg over +-50 mm - the multi-link's advantage); track change small (cp_y 796.6..801.6 mm over +-50); roll centre 39 mm above ground; virtual KPI -1.4 deg, virtual caster -6.1 deg (screw axis: no physical kingpin; rear use so ignore).

### 5d. Sanity-check set (opensus, units converted to mm in source; licence unverified so use only as expected-value test)
See table in section 1. Expected: camber gain -0.317 deg/10 mm, RC 89.9 mm, KPI=caster=5.19 deg, scrub 39.1 mm, bump steer 0.000.

## 6. Efficiency / quality notes
- 6x6 solve + 12 residual evals per Jacobian = maybe 40 flops x 100; per-corner per-frame warm-start Newton is microseconds in JS. No need for a worker. Still precompute LUTs for metrics (RC height, camber, toe vs dz/rack) to drive HUD/overlays, since they need extra solves.
- Numerical Jacobian vs analytic: for six rod-type residuals the analytic Jacobian is trivial (`dr/dt = 2(P-C)`, `dr/dw = 2 (P-C)^T [-(R p) x]`) if you want to skip finite differences; I used numeric to keep the code unified across layouts.
- Check feasibility: if rank(J)<6 (toggle point) or residual does not converge -> clamp travel (bump/droop stop). Real cars have bump stops anyway.
- Direction sign conventions are the common bug: left wheel only, mirror the right. Test with opensus sample + Chrono values above.

## 7. Prototype source (verifies sections 3 and 5; port to TS as `suspensionSolver.ts`)
Reference implementation I ran (Python/NumPy; about 120 lines). Key functions: `Susp.res` (residuals, section 3.1), `Susp.solve` (3.2), `metrics`, `roll_centre`, `steer_axis`/`axis_metrics` (3.3). It is stored at `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/kin.py` with the driver `run.py`; both are my own code (no third-party code copied). Condensed core:
```python
def rodrigues(w): th=|w|; k=w/th; return I + sin(th)K + (1-cos th)K@K          # K=skew(k)
def residuals(x, dz, rack):            # x=(t[3], w[3])
    R=rodrigues(x[3:]); t=x[:3]
    for each distance link (upright pt p, chassis pt C, rest length L):   # tie rod: C.y += rack
        P=R@p+t; r.append(|P-C|^2 - L^2)
    if macpherson: S=R@s0+t; d=R@d0; r += cross(T-S, d)                  # 3 eqns, rank 2
    r.append((R@wc0+t)[2] - (wc0[2]+dz))                                 # travel
def solve(x0,dz,rack):  # LM, central-diff J, lambda=1e-9, <=60 iters, warm start
```
TS data model suggestion: `type Hardpoints = Record<string,[number,number,number]>`; `interface Suspension { kind:'dw'|'mp'|'ml'; residuals(x,dz,rack):number[]; outputs(x):Outputs }`; the three layouts differ only in the residual list and in which upright points exist - so one Newton solver + three small residual builders.

## 8. Recommendations for Suspension Lab
1. **Write one generic TS rigid-body Newton/LM solver** (section 3.2) with three residual builders (DW, MacPherson, 5-link). It is ~300 lines, licence-clean, and gives all metrics (camber, toe, caster, KPI, scrub, trail, track change, RC/IC, MR, bump steer) from the same pose. Do not port open-kinematics (AGPL). Use it only as a local oracle in tests.
2. **Use Chrono (BSD-3) JSON hardpoints as seeds** and keep the Chrono licence header + attribution in `third_party/NOTICE`. Seeds: DW = Sedan_DoubleWishbone (front, sporty enough; fix its bump steer -0.36 deg/10 mm by moving the tie-rod outer point up/down until `d toe/dz ~ 0`: bump steer ~ 0 needs tie rod roughly parallel/at same height line as the LCA instant-centre geometry - iterate with the solver, 1-D search on `TIE_U.z`), MacPherson = generic MacPhersonStrut scaled to sports-car track (multiply all y by 0.8/1.1 about the axle, R=0.34, and pull the LBJ outboard to cut scrub to <=20 mm), 5-link = Sedan_MultiLink (already low bump steer: good "honest tradeoff": more link complexity, better toe stability, lower RC).
3. **Pose tuning is part of the product**: sports car = lower RC (DW 60-100 mm; strut 100-130 mm; 5-link 40-70 mm), camber gain DW ~ -0.5..-0.7 deg/10 mm *at the car's real travel*, strut ~ -0.2; these differences should emerge from the hardpoints, not be faked. Run the solver in a build-time script that prints these metrics for each set and gate edits on a table like section 5.
4. **Runtime**: warm-started Newton per wheel per frame, or precomputed LUT over (dz, rack) with bilinear interpolation; both under 0.05 ms. Keep the solver in a plain TS module (no three.js dependency) and unit test it with the opensus and Chrono values above.
5. **Visual layer** reads only `{upright pose, link endpoints, strut length, arm angles}`; link meshes are cylinders between `C_j` and `P_i`; wishbone triangle = (pivot F, pivot B, ball joint P). Use section 4.1 for arm angle.
6. **Motorcycles**: same machinery works (telescopic fork = prismatic constraint along steering axis; monoshock linkage = planar 4-bar, 2-D version of the same Newton solver with one DOF) - not researched here.
7. Unverified items: stars/licence for opensus, exact star count for open-kinematics. Searches in Julia/MATLAB/JS found no permissively-licensed kinematics solver (not exhaustive).
