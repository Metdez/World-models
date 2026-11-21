# M2 research 02 — Physics-engine raycast vehicles vs extending our own model

Date: 2026-11-21. Scope: Rapier, cannon-es, ammo.js/Bullet, Jolt (JoltPhysics.js), Havok. Question: use an engine for Manual Drive, or extend the custom 7-DOF ride model + kinematics tables?
Tags: [S] sourced (link), [E] estimate/inference.

## 1. Comparison table

| | Rapier JS | cannon-es | ammo.js (Bullet 2.82) | Jolt (jolt-physics npm) | Havok (@babylonjs/havok) |
|---|---|---|---|---|---|
| Licence | Apache-2.0 [S: [npm](https://registry.npmjs.org/@dimforge/rapier3d-compat/latest)] | MIT [S: [npm](https://registry.npmjs.org/cannon-es/latest)] | zlib (as Bullet) [S: [README](https://github.com/kripken/ammo.js), [LICENSE](https://raw.githubusercontent.com/kripken/ammo.js/main/LICENSE)]; npm metadata has no licence field | MIT [S: [npm](https://registry.npmjs.org/jolt-physics/latest), [source headers](https://raw.githubusercontent.com/jrouwe/JoltPhysics/master/Jolt/Physics/Vehicle/WheeledVehicleController.h)] | Package LICENSE is MIT, (c) Babylon.js [S: [jsDelivr LICENSE](https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.14/LICENSE)]; binary is closed-source Havok, redistribution terms not independently confirmed [E] |
| Version / last publish | 0.21.0, 2026-09-25 [S: [npm time](https://registry.npmjs.org/@dimforge/rapier3d)] | 0.20.0, 2022-08-12, effectively dormant [S: [npm time](https://registry.npmjs.org/cannon-es)] | 0.0.10, 2016 on npm [S: [npm](https://registry.npmjs.org/ammo.js)]; repo ~4.6k stars [S: [GitHub](https://github.com/kripken/ammo.js)] | 1.1.1, 2026-10-23 [S: [npm time](https://registry.npmjs.org/jolt-physics)]; JoltPhysics.js ~590 stars [S: [GitHub](https://github.com/jrouwe/JoltPhysics.js)] | 1.3.14 [S: [npm](https://registry.npmjs.org/@babylonjs/havok/latest)] |
| Runtime payload (raw / gzip) | wasm 3.08 MB / 1.17 MB, plus JS glue 338 KB (`rapier3d`) or compat JS 343 KB / 35 KB gz that embeds wasm [S: [jsDelivr](https://data.jsdelivr.com/v1/packages/npm/@dimforge/rapier3d@0.21.0?structure=flat), gz measured by me] | JS only 346 KB / 75 KB gz [S: jsDelivr, gz measured] | single asm/wasm JS 1.56 MB / 317 KB gz [S: jsDelivr, gz measured] | `wasm` flavour: wasm 2.02 MB / 746 KB gz + JS 970 KB / 136 KB gz (`wasm-compat` single file 3.23 MB) [S: [jsDelivr](https://data.jsdelivr.com/v1/packages/npm/jolt-physics@1.1.1?structure=flat), gz measured]. Custom builds can halve it [S: [JoltPhysics.js discussion #164](https://github.com/jrouwe/JoltPhysics.js/discussions/164)] | wasm 2.09 MB / 658 KB gz + JS 67 KB [S: jsDelivr, gz measured] |
| Vehicle API in JS | `DynamicRayCastVehicleController` (ported from Bullet's btRaycastVehicle) [S: [source](https://raw.githubusercontent.com/dimforge/rapier/master/src/control/ray_cast_vehicle_controller.rs)]; JS bindings merged Mar 2023 [S: [rapier.js issues](https://github.com/dimforge/rapier.js/issues?q=vehicle)] | `RaycastVehicle`, `WheelInfo` [S: [source](https://raw.githubusercontent.com/pmndrs/cannon-es/master/src/objects/RaycastVehicle.ts)] | `btRaycastVehicle` (Bullet) | `VehicleConstraint` + `WheeledVehicleController`, `MotorcycleController`, `VehicleAntiRollBar`, `VehicleDifferentialSettings` all in the JS typings [S: types.d.ts in jolt-physics 1.1.1] | None. Babylon forum thread: no vehicle API, only "character controller to come" [S: [forum](https://forum.babylonjs.com/t/havok-physics-raycast-vehicle-support/40180)] |
| Determinism | Documented "fully cross-platform deterministic" for JS/wasm, same version + same insertion order; warns `Math.sin/cos` are not [S: [rapier.rs](https://rapier.rs/docs/user_guides/javascript/determinism)] | JS, deterministic given same inputs and JS engine [E] | wasm, deterministic in practice [E] | Deterministic if same binary and same call order; `CROSS_PLATFORM_DETERMINISTIC` build costs ~8% [S: [Jolt docs](https://jrouwe.github.io/JoltPhysics/index.html)]; whether npm JS builds set it is not stated [S: [JS README](https://github.com/jrouwe/JoltPhysics.js)] | Not documented [E] |

## 2. How suspension is modelled in each (the part that matters)

All four vehicle implementations are the same family: a ray or shape cast along a FIXED chassis-local direction, a scalar suspension length, a spring-damper along that line, and friction impulses at the contact. None model a linkage.

### Rapier (Bullet port) [S: ray_cast_vehicle_controller.rs]
- Wheel fields: `chassis_connection_point_cs`, `direction_cs`, `axle_cs`, `suspension_rest_length`, `radius`, `max_suspension_travel`, `max_suspension_force`, `friction_slip`, `side_friction_stiffness`, `steering`, `engine_force`, `brake`.
- Defaults: stiffness 5.88, compression damping 0.83, relaxation damping 0.88, max travel 5.0 (m), side_friction_stiffness 1.0, friction_slip 10.5, max_suspension_force 6000.
- Spring: `force = stiffness * (rest - current) * clippedInvContactDotSuspension`, damper `force -= damping * rel_vel`, `wheel_suspension_force = (force * chassis_mass).max(0)`. Note the force is scaled by chassis mass (stiffness is per-unit-mass), a Bullet quirk.
- Friction: `max_imp = suspension_force * dt * friction_slip`; forward impulse weighted 0.5, side 1.0; if combined magnitude exceeds max_imp both are scaled by `skid_info`. This is a friction-circle clamp, not a slip curve: no slip-angle dependence, so no peak-then-falloff, no self-aligning torque, no transient (relaxation length) response.
- `roll_influence` is hard-coded 0.1 and private (not in `WheelTuning`) [S: source]. This scales the vertical component of the side impulse, i.e. it is the engine's only roll-centre-like hack. Not documented as such.
- Camber and toe: not supported. Only `steering` (rotation of axle about suspension direction).
- Docs: the vehicle controller was historically undocumented on rapier.rs (issue #90) [S: search result]; examples exist but are third-party (e.g. an A-Frame demo) [E].

### cannon-es [S: RaycastVehicle.ts]
- Same Bullet algorithm in TS: spring `suspensionStiffness * length_diff * clippedInvContactDotSuspension`, damper with compression/relaxation, `suspensionForce = force * chassisMass`, capped by `maxSuspensionForce`, side impulse via `resolveSingleBilateral` with fixed 0.2 damping, `maxImpulse = suspensionForce * dt * frictionSlip`, `skidInfo` scaling, `rollInfluence` on side impulse vertical component, wheel spin damped 0.99 per step.
- No camber/toe. Unmaintained since 2022; the three.js ecosystem still uses it via react-three-cannon [E].

### ammo.js / btRaycastVehicle
- The original of the above (Bullet 2.82 with the 2.83 raycast fix) [S: README]. Same model. Heaviest JS payload of the three Bullet-derived options, stale npm, and the API surface is hand-exposed via an IDL (awkward). Offers nothing the others do not.

### Jolt [S: Wheel.h, VehicleConstraint.cpp, WheeledVehicleController.cpp/.h, VehicleAntiRollBar.h, VehicleDifferential.h, VehicleEngine.h]
- Most capable of the set. Per wheel (`WheelSettings`): `mSuspensionForcePoint`, `mSuspensionDirection`, `mSteeringAxis`, `mWheelUp`, `mWheelForward`, `mSuspensionMinLength`, `mSuspensionMaxLength`, `mSuspensionPreloadLength`, `mSuspensionSpring` (frequency/damping or stiffness/damping), `mRadius`, `mWidth`, `mEnableSuspensionForcePoint`.
- Wheel chassis-relative position is strictly `settings->mPosition + mSuspensionDirection * suspensionLength`: ONE scalar DOF along a straight line. Steering rotates about an arbitrary `mSteeringAxis` (so kingpin/caster can be baked in statically), but position and orientation do not change with travel. No lateral/camber/toe DOF.
- Spring: soft constraint, `stiffness = m_eff * omega^2`, `damping = 2 * m_eff * zeta * omega`, divided by contact-normal cosine (min 0.1); pushes only. Spring is mass-normalised via effective mass, so it is better behaved than the Bullet family.
- Anti-roll bar: first-class. Loop in `OnStep`: `difference = rw.suspLen - lw.suspLen; impulse = difference * mStiffness * dt; lw = -impulse; rw = +impulse`, zeroed if either wheel is airborne. `mStiffness` default 1000 N/m. This is a real ARB as a vertical spring-on-difference; a good match to our model's ARB concept.
- Tyre model: slip-ratio curve (`mLongitudinalFriction`, X = slip ratio) and slip-angle curve (`mLateralFriction`, X = slip angle in degrees), both piecewise-linear `LinearCurve`. Constructor defaults: longitudinal `(0.06, 1.2)`, `(0.2, 1.0)`; lateral `(3.0, 1.2)`, `(20.0, 1.0)` [S: WheeledVehicleController.cpp]. Combined via a user callback; max impulse = friction x suspension load through `mTireMaxImpulseCallback`. Wheel inertia 0.9 kg m2, angular damping 0.2, max brake torque 1500 Nm, handbrake 4000 Nm, max steer 70 deg.
- Drivetrain: engine (max torque 500 Nm, 1000-6000 rpm, torque curve, inertia 0.5), gearbox/clutch, differentials with `mDifferentialRatio` 3.42, `mLeftRightSplit` 0.5, `mLimitedSlipRatio` 1.4 (FLT_MAX = open), `mEngineTorqueRatio`. Plus a `MotorcycleController` (lean spring 5000 / damping 1000, max lean 45 deg) which its own header calls in-development and "may need a lot of tweaks/hacks" [S: MotorcycleController.h].
- Pitch/roll limiter (`SetMaxPitchRollAngle`) to prevent toppling, an engine-side crutch we would not want.
- Compatibility with our dials: the friction curves are the same concept as a simplified Pacejka (peak then fall-off), but there is no relaxation length/transient lag, no camber thrust, no pneumatic trail.

### Havok [S: forum, npm]
- Babylon.js Havok plugin exposes rigid bodies and constraints, no raycast-vehicle controller (forum asked, unanswered). A vehicle would have to be hand-built on constraints/raycasts, i.e. our own model anyway. Closed-source binary; 658 KB gz. Skip.

## 3. Can OUR kinematics tables (camber/toe/roll-centre/motion-ratio vs travel and rack) be injected?

Our model (per ARCHITECTURE §7 and the `KinematicsCurves` interface: camber, toe, rollCentreHeight, motion ratio, all as functions of travel and rack) needs, per wheel and per step: camber(travel, rack), toe(travel, rack), roll-centre height and lateral position, motion ratio to scale spring/damper/ARB force at the wheel, plus camber relative to the ROAD (body roll + travel).

| Needed | Rapier/cannon/ammo | Jolt |
|---|---|---|
| Motion ratio (spring force at wheel = k * MR^2 * dx) | Only by hand-scaling `suspension_stiffness` each step (it is a per-wheel public field in Rapier) [E] | Mutating `mSuspensionSpring` frequency per step is possible but changes the solver constants each step; ok in principle [E] |
| Camber as function of travel/roll | Not representable; no camber concept in friction | `mWheelUp` is a settings field (static neutral orientation) so STATIC camber is expressible; dynamic per-step mutation of `mWheelUp` on the wheel's settings object looks possible from JS (setters exist in typings) but is an unsupported hack and it feeds only contact direction, not camber thrust [E] |
| Toe vs travel (bump steer) / compliance steer | Add to `steering` each step; works [E] | `mWheelForward` static, or add to steer angle each step [E] |
| Camber thrust (lateral force from inclination angle) | Not in friction model; would need own force injected as external force on chassis | Not in the curves; same |
| Roll-centre height / geometric (non-spring) load transfer | Not representable; `roll_influence` 0.1 hack only | `mSuspensionForcePoint` (where forces are applied) is a fixed chassis-local point; per-step update could mimic RC height [E] but it is a hack |
| Anti-dive / anti-squat geometry | No | No |

Bottom line: the engines accept our tables only as a thin layer of per-step overrides on scalar fields (stiffness, steer angle, force point), and in every case we would still compute camber, toe, RC and MR ourselves; the engine would only see their effects through friction direction/magnitude and force application point. The ONE thing the engines would add that we lack is a full rigid body (6-DOF chassis integration, collision with scenery, wheel-ground contact normal on arbitrary geometry). Our world is an analytic heightfield road, so we do not need general collision.

## 4. Fit against project constraints [S: 00-BRIEF.md, ARCHITECTURE]

- `stateAt(t)` purity and Auto <-> Manual continuity: the engines own mutable state (WASM heap); a pure function of time is impossible and snapshot/restore is the only way back to Auto (Rapier `takeSnapshot`, fine but heavy). Our own model already has explicit state (7-DOF ride model, 240 Hz semi-implicit Euler) so state handoff from `stateAt(t)` into a Manual integrator is a copy of a struct. [E]
- Pure-TS `sim-core` with no imports, deterministic, unit-tested: adding a WASM dependency breaks "no external deps" in sim-core and adds an async init path; Rapier's determinism doc itself says `Math.sin/cos` break cross-platform bit-equality, so we would have to keep trig out of any input path either way [S: rapier.rs determinism].
- "Suspension types still mechanically meaningful": engines give a vertical spring per wheel regardless of type. MacPherson vs double-wishbone vs multi-link would differ only by values we inject, and the educational point (camber gain, RC migration, bump steer) is exactly what the engines cannot represent. This is the deciding factor.
- Honesty rule: an engine tyre model (Rapier friction-circle clamp with `friction_slip` 10.5, which is an arbitrary Bullet constant) is not physically grounded, so every number shown in a UI would be an engine-tuning artefact; our own model can label exactly what is a physical parameter versus an approximation.
- Payload / 60 fps: engine overhead is not an issue (our ride model is a handful of DOF), but engine adds 0.75-1.2 MB gz of wasm for features we would use ~5% of. [E]
- Reversing, momentum, load transfer, transient response: all achievable in our own model (see section 5); engines give them mostly for free only through the chassis rigid body.

## 5. Verdict

EXTEND OUR OWN MODEL. Do not adopt an engine for Manual Drive.

Evidence:
1. Every JS-available engine vehicle (Rapier, cannon-es, ammo, Jolt) is a scalar-vertical-spring-per-wheel along a FIXED direction with a friction clamp at the contact; none supports camber, toe, roll-centre or motion-ratio as functions of travel/steer. Jolt is the best of them (slip-ratio/slip-angle curves, real anti-roll bar, differential, spring in frequency/damping form) but its wheel position is still `mPosition + dir * length` [S: VehicleConstraint.cpp].
2. The only injection route is per-step mutation of settings fields (stiffness, steer angle, `mWheelUp`, force point). That is a hack on top of a black box, and the physics we care about (camber thrust, RC jacking, bump steer) would still be computed by us.
3. Our architecture needs a pure, deterministic, snapshot-able TS core with `stateAt(t)` continuity; an engine adds WASM state, async init and 0.75-1.2 MB gz, for collision features we do not need on an analytic heightfield.
4. Rapier's `roll_influence` is hard-coded to 0.1 and its tyre model has no slip-angle curve [S: source], so a car "built on Rapier" would have handling set by Bullet constants, not by our suspension tables, violating the honesty rule.

What to steal instead (ideas and, where licence allows, code):
- Jolt (MIT, can copy): the slip-ratio/slip-angle `LinearCurve` tyre idea and default points (long. 0.06->1.2, 0.2->1.0; lat. 3 deg->1.2, 20 deg->1.0), the anti-roll-bar form `impulse = (suspR - suspL) * k * dt`, the limited-slip differential blend (`mLimitedSlipRatio` 1.4, `mDifferentialRatio` 3.42, engine 500 Nm 1000-6000 rpm), the spring mass-normalisation `k = m_eff*omega^2`, `c = 2*m_eff*zeta*omega`, and the cosine clamp 0.1 for tilted contact normals.
- Bullet-family (zlib / MIT / Apache, can copy with notice): the friction-ellipse clamp `maxImpulse = Fz * dt * mu` with `skidInfo` scaling, as a baseline if we choose a simple combined-slip model.
- MotorcycleController: lean-spring idea only (its own header warns it is hack-prone).

## Recommendation for Suspension Lab

1. Do NOT add a physics engine for Manual Drive; extend `sim-core` with a driver-input-driven integrator that reuses the existing 7-DOF ride model and kinematics tables.
2. Promote the ride model to a planar+vertical vehicle model: add longitudinal speed u, lateral velocity v, yaw rate r (3 DOF "bicycle/2-track") on top of heave/pitch/roll, so `stateAt(t)` in Auto becomes the same integrator driven by a path-following controller (a clean Auto<->Manual switch is then just a swap of input source).
3. Use per-axle or per-wheel tyre force with load dependence from the existing suspension loads: Fy as a function of slip angle (Pacejka-lite or Jolt-style piecewise-linear curve), Fx as a function of slip ratio, combined via a friction ellipse; mu scaled by Fz with load sensitivity so load transfer visibly matters.
4. Feed OUR tables into the tyre model: slip angle uses wheel toe(travel, rack), inclination angle uses camber relative to the road (we already compute `camber` to ROAD and `camberBody`), and add camber thrust. This is the part no engine could provide.
5. Use rollCentreHeight and its lateral migration for geometric load transfer: lateral force acts at the RC, elastic transfer at the springs/ARBs (we already own the ARB concept; copy Jolt's `(dRight - dLeft) * k` form).
6. Add a first-order tyre lag (relaxation length, [E] about 0.2-0.5 m) for transient response; this is what Jolt/Bullet clamps lack and what makes steering feel physical.
7. Reuse Jolt's spring constants form (mass-normalised frequency/damping) rather than Bullet's `* chassisMass` convention.
8. Drivetrain: start with a simple torque-at-the-wheels model plus brake bias; if a differential is wanted, adapt Jolt's limited-slip blend (MIT) rather than building from scratch.
9. Keep sim-core pure: no WASM, no `Math.sin/cos` in anything that must be bit-reproducible across machines (Rapier's own guidance applies to us too).
10. If a future milestone needs real collisions (traffic, props), isolate Rapier (Apache-2.0, 1.17 MB gz wasm, documented cross-platform determinism) or Jolt (MIT) behind a swappable module for obstacles only, never for the wheel/suspension model.
11. Skip Havok entirely: no vehicle API, closed binary, redistribution terms unconfirmed.
12. Skip cannon-es and ammo.js: unmaintained (2022 and 2016 on npm), same Bullet model, no advantage.
13. UI honesty: label tyre parameters as model approximations; never present an engine-style constant (e.g. `friction_slip`) as engineering data.
14. Risks: (a) own tyre model tuning time and stability at 240 Hz at low speed (slip ratio is singular near zero speed; use a low-speed blend like Jolt's `relative_velocity_len < 1e-3` guard); (b) reverse/standstill handling; (c) no rigid-body contact, so kerb/pavé interaction must stay as heightfield inputs; (d) validate against the existing DB11 fit before and after.
15. Cheap hedge: before committing, a 1-day spike running Jolt's `WheeledVehicleController` in a throwaway page to compare body response against our model on the same road is optional, not required.
