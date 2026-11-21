# M2 research 12: integration, stability and performance of a real-time vehicle model in TypeScript

Scope: fixed-step loop, integrator choice, stiff tyre/wheel systems, standstill, NaN safety, determinism, JS hot-loop hygiene, thread model, WASM.
Evidence tags: [S] = fetched and read this session (link given). [E] = engineering estimate or recollection, not verified here.
Honesty note: I read Gaffer's two articles, Cloudflare `_headers` docs, web.dev/MDN on COOP/COEP and the Chrono LICENSE. I did NOT read BeamNG/rFactor/Assetto blogs, the Chrono tyre sources, or run JS benchmarks. All timings below are [E] and a micro-benchmark is specified at the end to replace them.

## 1. Fixed-timestep loop with render interpolation

Source: Gaffer on Games, "Fix Your Timestep" https://gafferongames.com/post/fix_your_timestep/ [S].
Licence: none stated on the page, only "Copyright (c) Glenn Fiedler, 2004-2026". Treat as IDEAS ONLY; do not paste. The pattern (accumulator, fixed `dt`, blend factor `alpha = accumulator / dt`) is a standard idea, and the TS below is original to this project.

Confirmed from the article [S]:
- Loop adds real frame time to an accumulator, runs `integrate(current, t, dt)` while `accumulator >= dt`, then blends previous and current state with `alpha = accumulator/dt`.
- "Spiral of death": being behind makes you simulate more steps, which makes you slower. Remedies named: ensure the step costs "significantly less" than `dt` of real time, or clamp the max steps per frame.

Pattern for Suspension Lab (original code, project-owned):

```ts
const DT = 1 / 240;            // physics step (see recommendation)
const MAX_FRAME = 0.1;         // seconds; clamp after tab-switch / debugger
const MAX_STEPS = 16;          // hard cap per rAF, slow-motion beats spiral
let acc = 0, last = performance.now();
function frame(now: number) {
  let ft = Math.min((now - last) / 1000, MAX_FRAME); last = now;
  acc += ft;
  let n = 0;
  while (acc >= DT && n < MAX_STEPS) { prev.copyFrom(cur); step(cur, input, DT); acc -= DT; n++; }
  if (n === MAX_STEPS) acc = 0;           // drop backlog rather than spiral
  render(prev, cur, acc / DT);            // lerp pos, slerp quat, lerp wheel angle
  requestAnimationFrame(frame);
}
```

Notes specific to this app:
- Interpolate only what is drawn: chassis pose (lerp position, slerp quaternion), per-wheel travel and steer, and wheel spin angle. Wheel spin must be interpolated as an unwrapped angle, never wrapped to [0, 2pi) before the lerp, otherwise a visible reversal appears at the wrap.
- Do not interpolate inputs or camera targets in physics space; smooth the camera in render space with a frame-rate-independent damper (`k = 1 - exp(-dt*rate)`).
- Interpolation adds up to one physics step of latency (4 ms at 240 Hz). Imperceptible; not worth extrapolation, which overshoots at impacts and bump stops.
- Auto to Manual switch: both modes produce the same `State` struct and the loop keeps stepping `step()`. In Auto, `stateAt(t)` becomes the initial condition (position, yaw, speed, ride DOF velocities, wheel omegas initialised to `v / r_eff`). Wheel omegas and tyre deflection states are the usual forgotten items that cause a lurch at handover; seed them to rolling-without-slip and zero deflection.
- Rendering `alpha` must reset to 1 on a hard state snap (mode switch, respawn) so it does not blend across a teleport.

## 2. Integrator choice

Source: Gaffer, "Integration Basics" https://gafferongames.com/post/integration_basics/ [S]. Same licence situation, ideas only.
Confirmed [S]: explicit Euler gains energy on a damped spring at dt=1/100 and goes unstable above a stiffness threshold; semi-implicit (symplectic) Euler, same order, stays stable and tracks the damped solution; RK4 is indistinguishable at normal zoom for that damped case; author recommends semi-implicit Euler for most games. For an undamped oscillator RK4 loses energy while symplectic Euler conserves it on average but has phase error [S].

What that means for a vehicle:
- Ride/suspension DOFs (heave, pitch, roll, 4 unsprung masses): semi-implicit Euler `v += a*dt; x += v*dt` is correct. Spring frequencies are low (sprung ~1.2 Hz, unsprung ~12 Hz [E]); even the unsprung mode at 12 Hz needs omega*dt < 2, i.e. dt < 26 ms. At 240 Hz, omega*dt = 0.31, very comfortable. Tyre vertical stiffness (~200-300 kN/m on ~20 kg unsprung [E]) gives ~15-18 Hz, still fine.
- Do NOT use RK4 for the whole vehicle: forces are non-smooth (bump stops, friction clamps, saturating tyre curves), which destroys RK4's order advantage while costing 4 force evaluations including the tyre function. Discontinuities are the dominant error source, not truncation error.
- Damping is the real stiffness risk with explicit/symplectic Euler: a damper `c*v` with `c*dt/m > 2` is unstable. Unsprung damper: c ~ 1500-3000 N s/m, m ~ 20 kg: c/m ~ 75-150 /s, times dt=1/240 = 0.3-0.6. Safe, but bump/rebound asymmetry (rebound 2-3x) and bump-stop damping can push it toward 1. Use an implicit damper update for any element where `c*dt/m > ~0.5` (see 3.3).
- Energy gain checklist (what actually injects energy in symplectic Euler vehicle code): (a) explicit damping with large c/m; (b) forces computed from positions before the velocity update and applied after (keep ordering consistent: force from state at t, update v, then x with new v); (c) stiff contacts that overshoot (bump stop, tyre vertical rate on a pavé step); (d) clamping that is applied to force but not to the resulting velocity (friction should never reverse velocity within a step; see 3.4); (e) tyre lateral force acting on velocity computed from stale yaw rate. Add a debug-only `energyAudit()` (KE + spring PE + gravity PE minus cumulative damper/tyre dissipation) in unit tests: monotone non-increase on a passive drop test is a strong regression check.

## 3. Stiff tyre and wheel subsystems

### 3.1 Wheel-spin ODE stiffness
Wheel: `J * dw/dt = T_drive - T_brake - r * Fx(kappa)`, with longitudinal slip `kappa = (w*r - vx) / max(|vx|, vmin)`.
Linearise: `dFx/dw = Cx * r / max(|vx|, vmin)` where Cx = longitudinal slip stiffness per unit slip.
Stiffness rate: `lambda = Cx * r^2 / (J * max(|vx|, vmin))`.
Worked example [E]: Cx = 60 kN (per unit slip, loaded), r = 0.33 m, J = 1.5 kg m^2 (wheel + half-shaft share), vx = 1 m/s: lambda = 60000*0.109/1.5 ~ 4350 /s. Explicit Euler needs dt < 2/lambda = 0.46 ms, i.e. >2.2 kHz. At vx = 0.1 m/s it is 10x stiffer. So explicit wheel updates at 240 Hz are unstable at low speed; this is the classic cause of wheel-speed chatter and "ABS-like buzzing" at launch.

Three standard cures, in order of preference for us:
1. Implicit (linearised backward Euler) wheel update, unconditionally stable, one extra multiply and divide per wheel. Original code:

```ts
// per wheel, per step. Fx0 evaluated at current w; dFdw = analytic or finite diff of the slip curve.
const vx_eff = Math.max(Math.abs(vx), VMIN);
const dFdw = Cx_local * r / vx_eff;            // Cx_local = d(Fx)/d(kappa) at current kappa (>= small floor)
const rhs  = Tnet - r * Fx0;                   // Tnet = drive - brake - rolling resistance
const dw   = dt * rhs / (J + dt * r * dFdw);   // = backward Euler on the linearised system
w += dw;
// Brake lock: if brake torque would cross zero omega this step, clamp: if (w0*w < 0 && brake) w = 0;
```
   Using the tangent slope (not the initial slope) keeps it stable beyond the force peak where the slope is negative; floor `Cx_local` at a small positive value (the slope is negative past peak and would make the denominator shrink; floor makes the update behave like a damper).
2. Relaxation-length / contact-patch deflection state (section 3.2), which also provides the physical low-speed behaviour.
3. Sub-step only the wheel and tyre (e.g. 4 sub-steps of 1/960 s) with the chassis held fixed. Costs 4x tyre evaluations; simplest to reason about but stability at 0.1 m/s still not guaranteed (needs >2.2 kHz at 1 m/s, from the numbers above). Not recommended as primary.

### 3.2 Relaxation length and low-speed stability
Standard practice (Pacejka, "Tyre and Vehicle Dynamics", ch. 8 "Non-steady-state", and the SAE/Rill and Besselink stretched-string treatment) [E: from memory, not re-read this session]: slip builds up over a rolling distance sigma (relaxation length, ~0.2-0.5 m passenger tyre lateral [E]), not over time:
- `d(alpha')/dt = (|vx| / sigma) * (alpha - alpha')`, force from `alpha'`.
- Problem: as vx -> 0 the time constant `sigma/|vx|` -> infinity, so the tyre force freezes at standstill, and the equation is singular when you divide to compute slip angle `atan(vy/|vx|)`.
- Robust formulation that has no singularity: integrate the contact-patch DEFLECTION `u` (metres) instead of slip:
  `du/dt = v_sliding - (|vx| / sigma) * u`, force `F = -c_u * u - d_u * du/dt`, then saturate against `mu*Fz` (friction circle).
  At standstill `u` becomes a spring anchored to the road (a "stick" model) and behaves like static friction. This is the same structure as the LuGre/Dahl bristle friction family; it is what makes a car hold on a slope and stops creep jitter. Add a stiff-enough `c_u` and damping so that `omega_u*dt < 1`; use the implicit form `u_new = (u + dt*v_s) / (1 + dt*|vx|/sigma)` (backward Euler on a first-order lag, unconditionally stable and correct when vx = 0).
- Blend: below `vblend ~ 3-5 m/s` [E] use deflection (stick) model; above, the lag-on-slip model (or the same deflection model, both are fine since the implicit form is non-singular). Blend weights with smoothstep, never an `if`.
- Cheaper alternative if the existing code is slip-based: clamp the denominator `max(|vx|, vmin)` with `vmin ~ 1 m/s` [E] and add a low-speed linear damper on lateral and longitudinal velocity `F = -c_lowspeed * v * (1 - smoothstep(0.5, 3, |v|))`. This is what most arcade-sim hybrids do; it is stable but not physically a stick model.

### 3.3 Implicit damping for suspension
For spring-damper `m*x'' = -k*x - c*x'` use linearly implicit Euler (original code):
```ts
// solves (m + dt*c + dt^2*k) * dv = dt*(F0 - c*v - k*x)  - one divide, no stability limit
const dv = dt * (F - k * x - c * v) / (m + dt * c + dt * dt * k);
v += dv; x += v * dt;
```
This is the Baraff-Witkin style implicit step for a single DOF [E: general numerical analysis, no single source fetched]. It adds numerical damping, so use it only on the stiff members (tyre vertical, bump-stop) and leave ride springs on plain semi-implicit Euler to avoid damping the 1-2 Hz modes artificially.

### 3.4 Friction clamping, no energy gain
- Friction circle/ellipse: compute `F = sqrt(Fx^2+Fy^2)`; if `F > mu*Fz` scale both by `mu*Fz/F`. Clamp must be in terms of the *force*, and when applying to velocity at low speed also ensure the force cannot reverse the sign of velocity in one step: `|F| <= m_eff*|v|/dt` (impulse limit). Without this limit, a stationary car on a slope with a stiff stick model oscillates sign every step (the "jitter").
- Load-dependent `mu` (mu decreases with Fz, ~ -5 to -10% per 1 kN [E]) is fine but clamp `Fz >= 0` and lag it (first-order, ~10 ms) so a bump-stop impact does not produce a force spike.
- Bump stop: progressive polynomial spring + damping that is active only on compression of the stop (force 0 at contact, smooth onset `k * x^2`) avoids the impulse discontinuity of a hard stop. Clamp bump-stop damper so it cannot generate tension (`F = max(0, ...)`), otherwise it pulls the wheel back and adds energy on release.
- Tyre vertical: `Fz = max(0, k_t*delta + c_t*delta_dot)`; a damper that outputs negative load on separation is the usual source of fake energy after hops.

### 3.5 Sub-stepping
Rather than raising the whole model to 1 kHz, sub-step only the four wheels' ODE (spin + deflection) with the chassis state frozen, `K = 2-4` sub-steps. With the implicit formulations above you can usually stay at the base step and skip sub-stepping entirely. Keep sub-stepping as a fallback switch (`TYRE_SUBSTEPS`) rather than a requirement.

## 4. Standstill and reversing

- Never use `Math.sign(v)` for friction direction; use a smooth sign `v / sqrt(v*v + eps^2)` (eps ~ 0.05-0.1 m/s [E]) for rolling resistance, drag, brake, engine-brake. Hard sign flips at v ~ 0 cause 1-step chatter (forward/back every frame).
- Brakes: brake torque `T_b = min(T_cmd, J*|w|/dt + r*|Fx_available|)` style clamp so brakes bring the wheel to exactly zero and hold it, instead of oscillating around zero.
- Reverse handling: decide direction on a hysteresis band (e.g. enter reverse only when throttle-back pressed and |v| < 0.5 m/s for > 150 ms [E]); treat "brake" and "reverse" as the same pedal mapped by gear state. Never flip state on the sign of v alone.
- Parking hold: when |v| < 0.05 m/s, no pedal input and slope < friction, snap `v, w, u` to zero with a 50 ms hysteretic timer. This is a standard "sleeping" step and also saves CPU; wake on any input or contact force change.
- Steering at zero speed: the tyre stick model gives realistic scrub; limit steer rate and fade rack input smoothly if the car is stationary to avoid unrealistic tyre twisting forces.
- Kinematic fallback below ~2 m/s [E]: many sims blend to a kinematic bicycle model (yaw rate = v*tan(delta)/L) to avoid singular slip angles. Our deflection model avoids needing the fallback; keep as plan B.

## 5. NaN containment and recovery

- Single choke-point: after each `step()`, `isFinite()` check on a packed state `Float64Array` (check a sum: `const s = sum(state); if (s !== s || !isFinite(s))`; one add per DOF, O(1) extra cost).
- Keep a ring buffer of the last good state (copy every ~0.1 s, 8 slots); on fault, restore the newest good state, zero velocities of the offending wheel/DOF, bump a `faultCount` and show an unobtrusive toast "Reset to track" after 3 faults in 2 s. Log the first fault's inputs (state, input, dt) to console for reproduction.
- Guard sources of NaN explicitly: `sqrt(max(0,x))`, `x / max(|d|, eps)`, `atan2` for slips (avoid `atan(a/b)`), `clamp(dt, 0, 0.05)`, `acos/asin` of clamped arguments, `pow(0, negative)`.
- Hard clamps on state: `|omega| <= 2000 rad/s`, `|v| <= 120 m/s`, suspension travel inside `[-limit, +limit]`, `|u| <= u_max`. Clamps prevent a single bad frame from exploding into infinity and recoverable instead of NaN.
- Fuzz test in `sim-core`: random inputs (steer square waves, full brake/throttle toggles at 1-1000 Hz), random `dt` from [1/1000, 1/30], assert finiteness for 10^6 steps. This is cheap in Vitest and catches most issues.

## 6. Determinism across browsers

Facts [E unless stated]:
- IEEE-754 `+ - * / sqrt` and `Math.fround` are exactly specified; JS engines do not fuse multiply-add (spec mandates double rounding semantics), so arithmetic on doubles is bit-identical across V8, SpiderMonkey, JavaScriptCore on all architectures. Float64Array storage is deterministic.
- `Math.sin/cos/tan/atan/atan2/exp/log/pow/tanh/...` are "implementation-approximated" per ECMAScript (I did not get a clean quote from tc39.es in this session; the claim is widely documented). V8 and SpiderMonkey use fdlibm-derived ports [E]; JavaScriptCore historically defers to the platform libm [E]. So cross-engine last-bit differences are possible. These grow through a chaotic system, so replays diverge over minutes, but within one browser/device the sim is deterministic.
- Requirement check: we need determinism for (a) unit tests (Node/V8: ok), (b) Auto to Manual continuity (same session, ok), (c) a shared ghost or replay across devices (the only case needing cross-browser bit exactness). If (c) is out of scope for M2, do nothing more than keep sim-core free of `Date.now`/`Math.random` and iteration-order dependence.
- If (c) is wanted: implement `sin`, `cos`, `atan`, `atan2`, `exp`, `tanh` in sim-core with polynomial/minimax approximations (4-8 flops, error < 1e-7 is plenty for a tyre curve), or restrict transcendentals to sqrt and table lookups with linear interpolation. The Magic Formula `D*sin(C*atan(B*x - E*(B*x - atan(B*x))))` needs `sin` and `atan`; a polynomial atan and Chebyshev sin cost less than the engine calls anyway.
- Use a seeded PRNG (mulberry32 / sfc32, public domain / MIT-style small snippets) if any noise is added to road or tyre; do not call `Math.random()`.

## 7. Zero-allocation hot loops in JS [E, standard V8 practice]

- State in a single preallocated `Float64Array` with named integer offsets (`const X=0, Y=1, YAW=2, ...`) or a struct-of-typed-arrays per wheel; no objects created in `step()`. Avoid `{x,y}` returns; write results into preallocated scratch slots.
- No closures, spreads, `.map/.forEach/.reduce`, destructuring-from-arrays, or string keys inside `step()`; keep functions monomorphic (same shape every call) so TurboFan inlines.
- Check with `node --trace-gc` / Chrome Performance "GC" lanes: target zero minor GCs attributable to sim in a 60 s run. Vehicle step produces nothing to collect if the above is followed.
- Tyre function call count: 4 wheels x 1 call per step (+4 for a numeric Jacobian if using finite difference; prefer analytic slope or a secant from the previous step).
- Prefer `Math.hypot` avoidance (slow) and use `Math.sqrt(x*x+y*y)`; avoid `Math.pow(x, 2)`.
- `Float32Array` offers no speed benefit for scalar math in JS (computation is in double), only memory/bandwidth; keep `Float64Array`.

## 8. Thread model: main thread vs Worker vs SharedArrayBuffer

Cost estimate [E, to be benchmarked]: a ~14-DOF vehicle step in warmed-up TurboFan TS is ~2-6 microseconds (4 tyre evaluations with an atan+sin each dominate; ~1-2 k flops). At 240 Hz that is 0.5-1.5 ms per second of simulated time, i.e. <0.2% of one core; at 1 kHz it is 2-6 ms/s, <1% of a core. The 16.6 ms frame budget is dominated by three.js, not physics. Conclusion: physics on the main thread is adequate; a Worker would not buy frame time, only isolation from render jank.

Worker options:
1. Main thread (recommended for M2). Zero latency, zero sync complexity, easiest debugging, trivial Auto/Manual state handover, no header requirements.
2. Worker + `postMessage` with transferable `Float64Array` double buffer: no COOP/COEP needed. Input flows main->worker (small struct, once per frame or on change), state flows worker->main once per rAF (copy ~100 doubles). Latency +1 frame; interpolation needs timestamps. Worth it only if render jank (e.g. shadow map rebuilds, texture upload, GC) starts to stutter physics.
3. Worker + `SharedArrayBuffer` + `Atomics`: lowest overhead, tearing-free with a seqlock/double-buffer, but requires cross-origin isolation (`crossOriginIsolated === true`). Cost: see below.

### COOP/COEP on Cloudflare Workers Static Assets
- Static Assets supports a `_headers` file in the assets directory, up to 100 rules, 2,000 chars per line, rules applied in file order [S] https://developers.cloudflare.com/workers/static-assets/headers/. It applies ONLY to static asset responses, not to responses generated by Worker code, including `assets.run_worker_first` paths; for those set headers on the `Response` in the Worker [S]. The page does not mention COOP/COEP, but arbitrary headers are supported, so:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```
  Note both the main HTML document and the Worker script/WASM must satisfy COEP; if the app has Worker-routed HTML (e.g. a dynamic API or SSR) those responses need headers set in code [S, inference from the "only static asset responses" limitation].
- Isolation requires `COOP: same-origin` and `COEP: require-corp` (or `credentialless`) on the document; `self.crossOriginIsolated` is `true` only if the whole chain is isolated; desktop Chrome requires this for `SharedArrayBuffer` from v92 [S] https://web.dev/articles/coop-coep.
- Implications for third-party embeds [S web.dev, MDN]:
  - `require-corp`: every cross-origin subresource must carry `Cross-Origin-Resource-Policy` or be loaded via CORS; otherwise it is blocked (images show as missing; scripts/styles block silently, visible in DevTools as `NotSameOriginAfterDefaultedToSameOriginByCoep`). Cross-origin iframes (YouTube, social embeds, analytics beacons that use `no-cors`) are blocked unless the embedded document sends a matching CORP and is itself isolation-compatible. Embedding the app inside another site's iframe also requires every ancestor to be isolated.
  - `credentialless`: loads no-CORP cross-origin resources without cookies; supported in Chrome 96+ and Edge per web.dev; MDN fetch summary indicates Firefox support later and Safari generally unsupported (MDN compat table was not in the fetched text; verify before relying on it).
  - Consequences for this app: Google Fonts, three.js/CDN scripts without CORS, HDRI/texture hosts without CORS+`crossorigin` attribute, analytics, and any live-event livestream embed would break or need `crossorigin="anonymous"` and CORS-enabled hosts. Self-hosting all assets removes most of the problem; third-party iframes remain the blocker.
  - The app must also be able to degrade: guard with `if (crossOriginIsolated)` and fall back to `postMessage` or main-thread, otherwise Safari (no credentialless) or an embedder breaks the app.
- Verdict: SAB brings no measurable gain for a model that costs <1% of a core, and it ties the product to a header regime that conflicts with third-party embeds at a live event. Skip SAB. If isolation is later wanted for other reasons (WASM threads, high-res `performance.now`), add it behind a feature flag with `credentialless` and test every embed.

## 9. WASM (AssemblyScript / Rust) vs plain TS

[E] Findings from general practice, not benchmarked here:
- For scalar double math over ~100 state variables, V8 TurboFan output for monomorphic typed-array code is typically within 1.0-1.5x of WASM; WASM gains appear for SIMD, large loops, and predictable no-GC code. A 14-DOF step is too small and too branchy (clamps, curves) for WASM to win; JS to WASM call boundary cost (~tens of ns per call, more with marshalling) is non-negligible against a 2-6 microsecond step.
- WASM costs: a build toolchain (Rust + wasm-bindgen / AssemblyScript), debugging friction, sim-core purity (the "pure TS, unit-tested" contract becomes two codebases), and determinism upside is small because `sin/atan` in Rust `libm` vs `f64::sin` differences are mine to implement either way. Upside: bit-exact `libm` crate (MIT/Apache-2.0, port of musl) gives cross-browser identical transcendentals; the same is achievable in TS with a small polynomial module.
- Where WASM could pay off later: batch tyre evaluation for many AI cars, or road-height sampling of dense meshes. Not needed for one car.
- Recommendation: stay in TS; write sim-core in a WASM-friendly style (typed arrays, no objects) so porting stays cheap.

## 10. Reference implementations worth reading (ideas and licences)

| Source | URL | Licence | Use |
|---|---|---|---|
| Gaffer on Games, Fix Your Timestep / Integration Basics | https://gafferongames.com/post/fix_your_timestep/ , https://gafferongames.com/post/integration_basics/ | No licence on pages (copyright Glenn Fiedler) [S] | IDEAS ONLY; own-written code above |
| Project Chrono (vehicle module, tyre models TMeasy, Pac89, Pac02, rigid/FEA tyres) | https://github.com/projectchrono/chrono | BSD-3-Clause [S: LICENSE read] | Copyable with notice; I did not read the tyre source files (`src/chrono_vehicle/wheeled_vehicle/tire/`), so the parameter sets and slip handling are unverified here. Chrono TMeasy includes a low-speed "dynamic" handling worth checking [E] |
| Box2D / Rapier solver notes (soft step, sub-stepping, sleeping) | https://box2d.org , https://github.com/dimforge/rapier | MIT (Box2D 3.x) / Apache-2.0 (Rapier) [E, not re-verified] | Sleep thresholds, soft constraints (implicit damping pattern) |
| BeamNG / rFactor / Assetto dev posts | not read | n/a | Not sourced this session; do not cite |

## Recommendation for Suspension Lab

1. Keep the fixed-step accumulator with max-frame clamp (0.1 s) and max-steps cap (16); drop backlog on overflow; interpolate pose, wheel travel, steer and unwrapped wheel angle with `alpha`.
2. Step rate: 240 Hz base (4.17 ms) for the whole 14-DOF model; it is stable for ride DOFs (omega*dt ~0.3 at 12 Hz) and costs <1% of a core [E]. Make `DT` a constant in sim-core so 480 Hz is a one-line change if benchmark/tests demand it.
3. Integrator: semi-implicit Euler for ride and chassis DOFs. Skip RK4 (discontinuities dominate error, 4x tyre evaluations).
4. Make the wheel-spin update implicit (linearised backward Euler with `J + dt*r*dFx/dw`); explicit would need >2 kHz at 1 m/s [E calc above]. This is the single most important stability fix.
5. Add a contact-patch deflection / relaxation state for tyres using the non-singular implicit update `u = (u + dt*vs)/(1 + dt*|vx|/sigma)`; it supplies relaxation length, stiction at standstill and removes `atan(vy/vx)` singularities. Fall back to `max(|vx|, 1 m/s)` plus low-speed damping if scope is tight.
6. Use implicit damper update only for tyre-vertical and bump-stop; use progressive polynomial bump stops with no tension; clamp `Fz >= 0`.
7. Friction clamp on the circle and an impulse limit `|F| <= m_eff*|v|/dt`; smooth-sign everywhere instead of `Math.sign`; hysteretic reverse selection; stationary sleep snap below 0.05 m/s.
8. NaN safety: one finite-check on state per step, ring buffer of last good states, hard clamps, "Reset to track" toast after repeated faults, Vitest fuzz test (10^6 steps, random dt and inputs) and a passive-drop energy-monotonicity test.
9. Handover Auto to Manual: seed wheel omegas to `v/r_eff`, zero tyre deflection, copy ride velocities from `stateAt`; reset interpolation alpha on snap.
10. Determinism: do not chase cross-engine bit-exactness unless ghosts/replays are shared; if needed, replace `sin/atan/exp/tanh` in sim-core with own polynomial versions. Never use `Math.random`/`Date.now` in sim-core.
11. Zero-allocation `step()`: one `Float64Array` state, integer offsets, no closures or array methods; verify with `--trace-gc`/Chrome GC lane.
12. Thread model: physics on the main thread for M2. If jank appears, move to a Worker with `postMessage` + transferred buffers (no headers). Do NOT adopt SharedArrayBuffer: it needs COOP/COEP via `_headers` and breaks cross-origin embeds (fonts, CDN scripts, iframes) unless `credentialless`, which has weaker Safari support.
13. WASM: skip; JS/WASM call boundary and toolchain cost exceed the gain for a ~2-6 microsecond step [E]. Keep code WASM-portable.
14. Before finalising: run the micro-benchmark (Vitest bench / Node `performance.now`, 10^6 steps, warm-up 10^5; Chrome and Firefox via a test page) to replace all [E] timings; set the decision rule "if step > 20 microseconds, go to Worker".
15. Risks: (a) unverified Chrono tyre internals and BeamNG/rFactor/Assetto notes; (b) tyre-parameter numbers (Cx, J, sigma) here are plausibility estimates, tune against the existing DB11 data; (c) Cloudflare `_headers` is static-asset-only, so any Worker-generated HTML would need headers in code if isolation is ever turned on.
