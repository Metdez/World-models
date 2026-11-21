# M2 research 04: Tyre force models for Manual Drive

Legend: [S] sourced (link given), [E] estimate or textbook knowledge not re-verified here, [C] computed by me from a sourced coefficient set (script reproducible from the quoted numbers).

Scope caveat: I could not find any published Magic Formula set for 255/40R20 or 295/35R20. The only permissively licensed full set I could read is a 235/60R16 PAC2002 file in Project Chrono. Sports-tyre numbers below are scaled estimates [E] and must be labelled as such in the UI.

## 1. Sources and licences

| Item | URL | Stars / activity | Licence | Use |
|---|---|---|---|---|
| Project Chrono (chrono_vehicle tyres: ChPac02Tire, ChTMeasyTire, data/vehicle/hmmwv/tire/*.tir) | https://github.com/projectchrono/chrono | ~2.5k stars [E], active | BSD-3-Clause (LICENSE text begins "Copyright (c) 2016, Project Chrono Development Team ... Redistribution and use in source and binary forms" [S]); source headers say "BSD-style license" [S] | Copyable with notice. Code and the .tir numbers. |
| `HMMWV_pacejka.tir` (PAC2002, tyre labelled 235/60R16, Fznom 4850 N, R0 0.461 m, 200 kPa, tested at 16.6 m/s) | https://raw.githubusercontent.com/projectchrono/chrono/main/data/vehicle/hmmwv/tire/HMMWV_pacejka.tir | as above | as above (data dir inherits repo licence; I did not separately verify the data-dir licence) | Real coefficient set, quoted in section 5. |
| TreadJS / `@hivoltagexyz/tread` (JS Pacejka 2002 + Harsh and Shyrokau 2019, runs in browsers and Cloudflare Workers) | https://github.com/aunyks/tread | 3 stars, 13 commits [S] | BSD-3-Clause [S] (page and JSR listing) | Copyable reference for MF2002 in JS. README does not mention camber or relaxation. Too young and heavy (.tir parser) to depend on; read it, port the formulas. |
| BrianN92/Pacejka-tire-model | https://github.com/BrianN92/Pacejka-tire-model | small | Apache-2.0 per search listing [unverified] | Not inspected. Skip. |
| mfeval (MATLAB, MF 5.2/6.1/6.2 evaluator) and teasit magic-formula-tyre-library (MATLAB) | https://uk.mathworks.com/matlabcentral/fileexchange/63618-mfeval , https://github.com/teasit/magic-formula-tyre-library | n/a | Not confirmed. Treat as ideas only. | Ideas only. |
| Pacejka, "Tyre and Vehicle Dynamics" (book), Gillespie, Milliken, Besselink et al. (MF-Tyre low speed) | books/papers | n/a | Copyright. Equations are facts, text is not. | Equations written below from textbook knowledge [E]. |

Chrono's TMeasy tyre uses a different parameter set (load index, bearing capacity, mu) and, per the source I fetched, has NO camber force term, only an overturning moment `Mx = -cg*gamma` [S: ChTMeasyTire.cpp]. So TMeasy cannot honestly express camber thrust. Reject it for this product.

## 2. Model survey (what each can and cannot do for us)

1. Linear + saturation: `Fy = clamp(-Ca*alpha + Cg*gamma, +-mu*Fz)`. Camber and toe work trivially. No smooth peak, no falling branch, no combined slip. Good as a fallback only.
2. Brush model (Fiala style, cubic). Physical, 3 numbers, camber extends cleanly. Equations [E, Pacejka ch.3]:
   - `theta = Ca / (3*mu*Fz)`, `t = tan(alpha_eq)`, `t_sl = 1/theta`
   - `|t| < t_sl`: `Fy = mu*Fz*(3*theta*t - 3*(theta*t)^2*sign(t)*... )`; written out: `Fy = -mu*Fz*(3*theta*t*(1 - |theta*t| + (theta*t)^2/3))` with sign convention chosen by us
   - `|t| >= t_sl`: `Fy = -mu*Fz*sign(t)`
   - Fiala adds camber: `alpha_eq = alpha + (Cg/Ca)*gamma` (equivalent shift). No falling branch beyond saturation unless a sliding mu is added.
3. Dugoff: `Fx, Fy = Cs*s*f(lambda), Ca*tan(alpha)*f(lambda)` with `lambda = mu*Fz*(1-eps_r*vx*sqrt(s^2+tan^2 alpha)) / (2*sqrt((Cs*s)^2+(Ca*tan a)^2))`, `f = lambda<1 ? lambda*(2-lambda) : 1`. Cheap and combined by construction but no camber, no peak/falling shape, long-since superseded. Skip.
4. TMeasy: see above, no camber force. Skip.
5. Pacejka MF (4-coefficient): `F = D*sin(C*atan(B*x - E*(B*x - atan(B*x))))`. Smooth peak, falling branch, E controls curvature. Camber enters through a horizontal shift (alpha) and vertical shift. Best shape per parameter.
6. MF 5.2 / 6.1 / PAC2002 subsets: add load sensitivity (dfz terms), camber in B, D, E, Sh, Sv, combined-slip weighting (Gxa, Gyk), relaxation lengths, Mz. Worth taking only the Fy/Fx pure-slip subset plus camber terms; everything else is data we do not have.

## 3. Real PAC2002 equations and coefficients (lateral, from Chrono source)

Quoted from ChPac02Tire.cpp (BSD-style, Copyright 2023 projectchrono.org, author Rainer Gericke) [S]:

```cpp
double gamma_y = gamma * m_par.LGAY;
double Ky = Ky0 * (1.0 - m_par.PKY3 * fabs(gamma_y));
double Shy = (m_par.PHY1 + m_par.PHY2 * m_states.dfz0) * m_par.LHY + m_par.PHY3 * gamma_y * m_par.LKYG;
double Svy = Fz * ((m_par.PVY1 + m_par.PVY2 * m_states.dfz0) * m_par.LVY +
                   (m_par.PVY3 + m_par.PVY4 * m_states.dfz0) * gamma_y * m_par.LKYG) * m_par.LMUY;
```

Low-speed and relaxation helpers from the same file [S]:

```cpp
// prevent singularity for kappa, when vx == 0
const double epsilon = 0.1;
m_states.kappa = -m_states.vsx / (m_states.vx + epsilon);
m_states.alpha = std::atan2(m_states.vsy, m_states.vx + epsilon);

double ChPac02Tire::CalcSigmaA(double Fz) {   // lateral relaxation length
    return m_par.PTY1 * std::sin(2.0 * std::atan(Fz / (m_par.PTY2 * m_par.FNOMIN * m_par.LFZO))) *
           (1.0 - m_par.PKY3 * std::fabs(m_states.gamma)) * (R0 * m_par.LFZO) * m_par.LSGAL;
}
```

Chrono defines these helpers but, per my read of the file, does not call them. It uses a Dahl bristle model blended by `frblend` (sine step on |vx|) for low speed.

Coefficients, `HMMWV_pacejka.tir` (235/60R16, FNOMIN 4850 N, R0 0.461 m) [S]. Note ISO sign: PKY1 is negative.

```
Lateral:  PCY1 1.3507  PDY1 1.0489  PDY2 -0.18033  PDY3 -2.8821
          PEY1 -0.0074722 PEY2 -0.0063208 PEY3 -9.9935 PEY4 -760.14
          PKY1 -21.92  PKY2 2.0012  PKY3 -0.024778
          PHY1 0.0026747 PHY2 8.9094e-5 PHY3 0.031415
          PVY1 0.037318 PVY2 -0.010049 PVY3 -0.32931 PVY4 -0.69553
          RBY1 7.1433 RBY2 9.1916 RBY3 -0.027856 RCY1 1.0719 REY1 -0.27572 REY2 0.32802
          PTY1 2.1439 PTY2 1.9829
Longitud: PCX1 1.6411 PDX1 1.1739 PDX2 -0.16395 PEX1 0.46403 PEX2 0.25022 PEX3 0.067842
          PKX1 22.303 PKX2 0.48896 PKX3 0.21253
          RBX1 13.276 RBX2 -13.778 RCX1 1.2568 REX1 0.65225 REX2 -0.24948
Vertical: stiffness 2.1e6 N/m (sic, as in file), damping 1000 N s/m
```

Derived behaviour [C] (I evaluated the PAC2002 lateral formula with these numbers; script at /tmp/claude-0/ch/mf.py, scratch):

| Fz | Cornering stiffness | peak mu (zero camber) |
|---|---|---|
| 2500 N | 51 kN/rad = 896 N/deg | 1.14 |
| 4850 N | 85 kN/rad = 1484 N/deg | 1.05 |
| 7000 N | 101 kN/rad = 1761 N/deg | 0.97 |

- Load sensitivity visible: doubling load from 2.5 to 4.85 kN raises Cα by 66% and drops mu by 8%. Cα per unit load falls from 20.5 to 17.5 per rad over that span [C].
- Camber thrust at nominal load: 74.5 N per degree of camber [C], i.e. camber stiffness / cornering stiffness = 0.050 (deg per deg). Both Shy (PHY3*Ky) and Svy (PVY3*Fz) contribute, in the same direction.
- Effect of 3 deg adverse camber on the Fy at a fixed slip angle (-3 deg): 3612 N down to 3398 N (-6%); at -8 deg slip: 5181 N to 5036 N (-3%) [C]. At zero slip, 3 deg camber alone gives 270 N at 4850 N [C].
- Caveats on this set: PDY3 = -2.88 and PEY4 = -760 are extreme camber terms; the set was probably fitted for small camber only. Do not extrapolate beyond ~4 deg. This is a truck-class tyre fit labelled 235/60R16 in a file named HMMWV; it is a template, not a measurement of a sports tyre.
- Lateral relaxation length at nominal load [C]: `PTY1*sin(2*atan(1/PTY2))*R0 = 2.1439*0.805*0.461 = 0.80 m`.

## 4. Simple 4-coefficient MF and typical values

`Fy = D*sin(C*atan(B*a - E*(B*a - atan(B*a))))`, `a` in rad, `D = mu*Fz`, `B = Ca/(C*D)`.
Textbook dry-asphalt shape values [E]: C = 1.3 (lateral) / 1.65 (longitudinal), E = -1.0 to 0 (lateral -0.5, longitudinal 0.3 to 0.5 with Chrono's 0.46 [S]), mu 1.0 to 1.2 for road tyres, up to 1.3 for sticky summer tyres. Chrono's C values 1.35 (Fy) and 1.64 (Fx) [S] fit this.

Load sensitivity, simplest form [E]: `mu(Fz) = mu0*(1 - kmu*(Fz-Fz0)/Fz0)` with kmu about 0.1 to 0.2 (Chrono: PDY2/PDY1 = -0.17 [S]); `Ca(Fz) = Ca_max*sin(2*atan(Fz/(PKY2*Fz0)))`, PKY2 about 2 [S]. This single pair is what makes lateral load transfer reduce an axle's total grip (understeer/oversteer balance) and is the highest-value feature after camber.

## 5. Camber and toe: how to make them honest

Physics [E, Pacejka ch.2-4]:
- Camber thrust: a cambered rolling tyre makes lateral force with zero slip. Linearised `Fy = Ca*alpha + Cg*gamma` (signs per convention). For car tyres Cg/Ca per deg/deg is about 0.05 to 0.15 [E; the Chrono set gives 0.05 [C]]. Motorcycle tyres are much higher, about 0.8 to 1.0 on narrow round profiles [E, Cossalter; unverified], which is why a motorcycle corners on camber.
- Camber also moves the peak: negative camber (on the loaded outer wheel, relative to road) typically increases peak Fy until an optimum around 2 to 4 deg then decreases; excessive camber lowers contact patch uniformity. Chrono shows only mild loss (3 to 6% at 3 deg) [C]; use `mu_eff = mu*(1 - kg*gamma^2)` kg about 0.003 to 0.01 per deg^2 [E].
- Toe is a direct slip-angle offset: `alpha_wheel = atan2(vy, |vx|) + toe`. 0.1 deg of toe is 148 N at nominal load with Chrono's Cα [C], which equals about 2 deg of camber thrust (74.5 N/deg [C]). Honest message: toe and compliance steer dominate steady-state forces; camber matters mainly through peak grip and through the roll-driven camber loss on the outer wheel.
- Camber seen by the tyre = suspension camber(travel, rack) + body roll angle (both already in our kinematic tables) + road camber. Use camber relative to the road surface, not the body.

Recommended implementation (one equivalent-slip formulation):

```ts
// per wheel, per substep; all angles rad, forces N, ISO-style, +Fy toward +left
const alphaEq = alphaKin + toe + (Cg / Ca) * gamma;     // camber enters as slip offset
const muEff   = mu0 * (1 - kmuLoad * dfz) * (1 - kGamma * gamma * gamma) * surfaceScale;
const Ca_Fz   = CaMax * Math.sin(2 * Math.atan(Fz / (PKY2 * Fz0)));
const D = muEff * Fz, C = 1.35, B = Ca_Fz / (C * D);
const FyPure = -D * Math.sin(C * Math.atan(B*alphaEq - E*(B*alphaEq - Math.atan(B*alphaEq))));
```

This keeps one extra parameter (Cg/Ca) and one peak-loss parameter per tyre, both visible in the existing camber curves.

## 6. Combined slip

Options, simplest first [E]:
1. Similarity / normalised-slip method (recommended): compute `sx = kappa / kappaPeak`, `sy = tan(alphaEq) / alphaPeak`, `s = hypot(sx, sy)`, one scalar curve `f(s)` (the MF above with unit slopes), then `Fx = muX*Fz*f(s)*sx/s`, `Fy = muY*Fz*f(s)*sy/s`. This gives a friction ellipse automatically (muX and muY set the ellipse axes), a falling branch, and no discontinuities. kappaPeak about 0.10 to 0.15, alphaPeak about 6 to 9 deg for road tyres [E].
2. Friction ellipse clamp on pure-slip outputs: `(Fx/Fx_max)^2 + (Fy/Fy_max)^2 <= 1`, rescale if exceeded. Cheapest; no sliding-friction drop, abrupt feel at limit.
3. MF weighting: `Fx = Gxa(alpha,kappa)*Fx0`, `Gxa = cos(Cxa*atan(Bxa*alpha...)) / cos(Cxa*atan(Bxa*Shxa))`; Chrono quotes RBX1 13.276, RBX2 -13.778, RCX1 1.2568, RBY1 7.1433, RBY2 9.1916, RCY1 1.0719 [S]. Accurate but heavier and requires the combined set; use only if we adopt full PAC2002.
Also needed: brake torque into ABS-free lock-up must reduce Fy, which methods 1 and 3 provide; method 2 handles it by the clamp.

## 7. Transient slip and relaxation length

Use the deflection formulation, which is both transient and singularity-free [E, Pacejka ch.7]:

```ts
// lateral contact-patch deflection yc (m); one state per wheel
const vxAbs = Math.abs(vx);
yc += dt * (vsy - (vxAbs / sigmaA) * yc);       // 'vsy' = lateral slip velocity incl. toe/camber offset
const alphaDyn = Math.atan2(yc, sigmaA);        // or yc / sigmaA for small angles
```

and the same for longitudinal with sigma_k. Steady state `yc = vsy*sigmaA/|vx|` gives `alpha = vsy/|vx|`, as required. Typical lengths [E]: sigma_alpha about 0.3 to 0.9 m for road tyres (Chrono at nominal: 0.80 m [C]); sigma_kappa about 0.1 to 0.3 m. Time constant `sigma/|v|`: at 10 m/s, 80 ms, which is the lag the driver feels in turn-in. For low speed, the deflection ODE gets stiff when `vx/sigma*dt > 1`; at 240 Hz, v < 200*0.8*... = 190 m/s so OK, and a 1-pole implicit update (`yc = (yc + dt*vsy)/(1 + dt*vx/sigma)`) is unconditionally stable and costs nothing.

## 8. Low speed and standstill

Failure: `kappa = (wR - vx)/|vx|` and `alpha = atan(vy/|vx|)` diverge at vx -> 0. Published practice:
- Chrono PAC02 [S]: `kappa = -vsx/(vx + 0.1)`, `alpha = atan2(vsy, vx + 0.1)` (epsilon 0.1 m/s), plus a Dahl bristle model blended in via `frblend` (sine-step on |vx|). TMeasy [S]: `vta = R_eff*|omega| + vnum` with `vnum = 0.01`; blend `Fx = (1-frblend)*Fx0 + frblend*Fx`; friction circle on a bristle state; aligning torque only above the blend start speed.
- Wikipedia notes the "add epsilon to the denominator" fix and that implemented MF fails at low speed [S via search listing].
- Bernard-Clover, Besselink low-speed blend, LuGre: I found no primary sources in this run; the principle (damping term below a threshold speed, or bristle state) is covered by the deflection formulation above plus a stick model [E].

Recommended: (a) deflection states (section 7) give the dynamic slip with no division by vx; (b) below `vBlend = 1.5 m/s`, add a regularised Coulomb term `F_stick = -muX*Fz*clamp(v_contact/vReg, -1, 1)` (vReg 0.05 to 0.2 m/s) with weight `(1 - smoothstep(0.5, 1.5, |vx|))` and cap the combined force with the friction circle; (c) brake hold at standstill: if |v| < 0.05 and brake or no throttle, freeze position with a per-wheel anchor spring (bristle `z' = v - sigma0*|v|*z/Fc`, trapezoidal update as quoted from Chrono [S]) to avoid creep on slopes and chatter. This is where the sim's Euler 240 Hz is most likely to misbehave; unit-test it (car at rest on a 5 percent slope must stay at rest; car coasting to stop must monotonically decelerate).

## 9. Surface friction scaling

Scale the peak, not the stiffness, with small stiffness changes [E]:

| Surface | mu scale vs dry asphalt | Cα scale | Notes |
|---|---|---|---|
| Dry asphalt | 1.00 | 1.00 | baseline |
| Wet asphalt | 0.65 to 0.80 (speed dependent, lower at speed) | 0.85 to 0.95 | [E] |
| Gravel / loose | 0.50 to 0.60, lower sliding mu | 0.5 to 0.6 | [E] |
| Pavé / cobbles dry | 0.70 to 0.90 | 0.8 | plus vertical load variation from the existing roadHeight pavé; the load-variation effect on mu(Fz) will appear automatically [E] |
| Snow / ice | 0.25 / 0.10 | | out of scope |
Implement as one `surfaceScale` multiplier on `mu` (and kappa/alpha peaks shift slightly later on loose surfaces). Do not present as measured.

## 10. Sports-tyre parameter estimates for the DB11-class car [E]

Load: ~1.8 t, ~51/49: about 4.5 kN per front tyre static, ~4.3 kN rear; transfer in a 1 g turn moves roughly +-2 kN across an axle [E]. 255/40R20 front and 295/35R20 rear are about 20 to 25 percent and 40 percent wider than the 235 reference tyre. Scaling:
- Cornering stiffness per load at nominal: 18 to 24 per rad (Chrono 235/60R16 gives 17.5 [C]); low-profile wide tyres are stiffer. Use front Cα ~ 95 kN/rad per tyre at 4.5 kN, rear ~ 110 kN/rad at 4.3 kN [E].
- mu peak 1.05 to 1.2 [E]. Tyre contact patch grows, so rear mu higher, e.g. 1.15, front 1.10 [E].
- Cg/Ca: 0.06 to 0.10 for a low-profile sports tyre [E]; use 0.07.
- sigma_alpha: 0.6 to 0.9 m front; 0.7 to 1.0 m rear [E].
- Magnitude of visible effects with these numbers [E]: 1 deg of camber = 0.07 deg equivalent slip = about 115 N (about 2.5% of load); 0.1 deg of toe = 166 N. The visible handling signal therefore comes from (i) roll-induced camber relative to the road changing peak grip by a few percent per axle, (ii) toe/compliance steer from the suspension tables, (iii) load transfer through mu(Fz) and Ca(Fz). Camber alone will be subtle on a car; say so in the UI.

## Recommendation for Suspension Lab

1. Adopt a per-wheel Pacejka 4-coefficient MF (D, C, E, B from Ca and mu) with one scalar curve and normalised-slip combined slip (section 6.1). It is the simplest model that shows a peak, a falling branch, and a friction ellipse.
2. Make camber honest with the equivalent-slip shift `alphaEq = alpha + toe + (Cg/Ca)*gamma` and a quadratic peak-loss `(1 - kGamma*gamma^2)`; feed gamma = suspension camber + roll relative to road. Two parameters per tyre, tied to your existing camber curves.
3. Add toe as a direct slip-angle offset; it will matter more than camber for steady force (0.1 deg of toe is about 2 deg of camber on the reference set [C]). Explain that on-screen.
4. Include load sensitivity (mu falls about 8 percent and Ca/Fz drops 15 percent as load doubles on the Chrono set [C]); it is what makes load transfer visibly affect balance.
5. Use the deflection-state transient (section 7) for lateral and longitudinal slip, with an unconditionally stable implicit update at 240 Hz. It removes the vx singularity and provides the turn-in lag.
6. For low speed: Chrono's epsilon (0.1 m/s) is acceptable inside the deflection form; add a regularised Coulomb/bristle hold below ~1.5 m/s with a friction circle cap, and unit-test rest-on-slope.
7. Copy from: Chrono (BSD-3-Clause) for MF2002 formulas, the 235/60R16 .tir numbers as shape defaults, the bristle update, the epsilon idea. Read TreadJS (BSD-3-Clause) for JS structure. Keep the copyright notices.
8. Do not copy from MATLAB mfeval/teasit (licences unconfirmed). Do not use TMeasy (no camber force [S]) or Dugoff (no camber, no shape).
9. Present sports-tyre values as "representative", not "Pirelli P-Zero data"; the only real coefficient set I verified is a 235/60R16 truck-class fit. No published 255/40R20 or 295/35R20 MF set was found.
10. Motorcycle needs a separate parameterisation: large Cg/Ca (~0.8 to 1.0 [E, unverified]) and a camber-dominated cornering force; do not reuse car numbers.
11. Treat PDY3/PEY4 from the Chrono file as untrusted beyond ~4 deg camber; use quadratic loss with your own k instead of copying them.
12. Surface scaling: single `surfaceScale` on mu (wet 0.65-0.8, gravel 0.5-0.6, pavé 0.7-0.9 [E]); flag as approximate.
13. Risks: parameter fitting is guesswork without data; combined-slip peak shape matters for the "approachable" feel; 240 Hz Euler plus stiff tyre force at low speed can chatter. Mitigate with implicit tyre update and a mass-normalised slip-force clamp.
14. Tests to add in sim-core: constant-radius circle (understeer gradient sign), step-steer lag equals sigma/v, camber/toe sweeps monotone, load-transfer axle-grip drop, rest-on-slope.
