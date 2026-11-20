# 01-02 SUMMARY — Kernel, composition root, stub simulation

**Status:** complete · commits `5cdd420` (plan), `48d3d06` (kernel services), `2afa401` (math + stub sim),
`3e61a58` (feature manager, loop, sim host, hooks, main.ts)

## Built
- **Kernel services** (`src/kernel/`): `registry.ts` (duplicate/unknown errors as §5.9), `services.ts`, `store.ts`
  (boot step 2 overlay incl. `?t`/`?paused` → `clock: 'local'`, e2e → quality `low`), `bus.ts` (+ `listenerCount`),
  `flags.ts` (full §8 table, warn-and-ignore on bad values/unknown params; `+` in `?features` survives URL decoding),
  `clock.ts`, `assets.ts` (`fetchManifest()` from `/asset-manifest.json`, `EMPTY_MANIFEST`).
- **Feature manager** (`features.ts`): enable resolution (override › `?debug=1` for `debug` › `defaultEnabled`),
  cascade-disable for disabled/unknown requirements, Kahn topo sort (alphabetical ties, cycle throws with members),
  scoped `FeatureContext` (provide/on/watch/addDisposer auto-disposed, reverse order after `dispose()`),
  contribute/init failure isolation (error recorded, disposers run, dependents disabled), `update()` per phase with
  3-consecutive-throws disable, runtime `disable()` cascade.
- **Loop** (`loop.ts`): §6.3 accumulator at `SIM_DT`, dt clamp, 24-step guard, pause/timeScale, alpha sampling,
  `sim:event` forwarding, visibility pause/resume (+ live re-seek), `tick()` and `advance()`.
- **Sim host** (`sim-host.ts`): §6.4 store reactions (vehicle swap + suspension write-back + `sim:vehicle`;
  suspension validated against the registered vehicle, reverted on reject; pause/slow-mo → local; `clock: 'live'`
  → seek), `sim:seek-to` handling, §6.5 live clock (wrap to half lap, seek > 0.5 s, else ±2 % slew).
- **Test hooks** (`test-hooks.ts`): `globalThis.__app` per §6.6 with console.error capture; removed on `stop()`.
- **App** (`app.ts`): `createApp` per §6.1/§6.2; fatal map `{ renderer: 'This experience needs WebGL 2' }`;
  disposal check on `stop()` (bus listeners and RENDER scene children back to baseline, else `console.error`).
- **`src/app/main.ts`** replaces the placeholder: boots `Object.values(FEATURES)`, fatal overlay (`role=alert`),
  one-shot `vite:preloadError` reload guarded by sessionStorage.
- **sim-core math** (`src/sim-core/math/`), allocation-free, gl-matrix style (`out` first, aliasing-safe):
  - `vec3.ts` — `V3` tuple; create/set/copy/add/sub/scale/scaleAndAdd/negate/lerp/dot/cross/length(Sq)/
    distance(Sq)/normalize/equals, flat-array `read`/`write`, `fromXYZ`/`toXYZ`.
  - `quat.ts` — `Quat` (x,y,z,w); multiply (a*b = b first), axis-angle, `fromRotationVector`/`toRotationVector`
    (exp/log, series near 0), `rotate`/`rotateInverse`, `fromRollPitchYaw`/`toRollPitchYaw` (Rz·Ry·Rx, §4 signs),
    slerp, angleBetween, XYZW interop.
  - `mat.ts` — row-major `Mat3` 9-tuple; multiply/transpose/transformVec3/transformTransposeVec3/skew,
    `fromRotationVector` (Rodrigues, series below 1e-4 rad so central differences stay exact), `fromQuat`,
    `toQuat` (Shepperd), determinant, invert.
  - `linsolve.ts` — `solveInPlace(A, b, n)` Gaussian elimination with partial pivoting (false if singular),
    `normalEquations(J, r, m, n, λ, A, g)` for LM (`A = JᵀJ + λI`, `g = −Jᵀr`).
  - `interp.ts` — clamp/lerp/invLerp/smoothstep/cosineBlend, `wrap`/`wrapHalf`/`wrapAngle`/`lerpAngle`,
    `findInterval`, `interp1`, `bilinear`, `cumulativeTrapezoid`, `lowPassAlpha` (exact 1st-order discretisation).
  - `rng.ts` — `createRng(seed)` (mulberry32: next/uniform/int/normal), stateless `hash32`/`hashFloat(seed, i, j)`.
  - A test runs a full 6-DOF Gauss-Newton pose solve (translation + rotation vector, central-difference Jacobian,
    `normalEquations` + `solveInPlace`): converges in < 10 iterations to 1e-10 — the 02-02 solver's core loop.
- **Stub simulation** (`src/sim-core/stub/circle.ts`, exported as `createSimulation` from `index.ts`): full
  `Simulation` contract — circle R 60 m CCW, 15 m/s (lap 25.13 s), pure `stateAt`/`lapTimeAt`, lap events,
  interpolated `sample()` into a preallocated frame, synthetic sinusoidal heave/roll/pitch with travel derived from
  the pose, POSE amplification only, seek/setSuspension/setVehicle/restPose/kinematics. Uses registered
  definitions when present, placeholders otherwise. Not physics; deleted by 02-04.

## Deviations
1. **Spiral guard** is `if (acc >= SIM_DT) acc = 0` after the 24-step loop instead of `if steps === 24`: with
   `MAX_FRAME_DT = 0.1 s` = exactly 24 steps, the literal rule would drop the remainder (and the live-clock slew) on
   every max-length frame. Same intent, only fires when truly behind.
2. **`App.ctx` throws before `start()`** (the manifest is async and the sim is created in `start()`).
3. Fatal renderer failure: `start()` disposes everything and rejects with "This experience needs WebGL 2";
   `main.ts` renders the overlay (kernel may not import `src/ui`).
4. `?amp` accepts any finite value in [1, 10]; `?room` is upper-cased and must match the code alphabet (so `LIVE`
   is rejected — it is the default anyway). Bare ids in `?features=a` mean "on".
5. Rendering shows the previous fixed step when `acc = 0` (alpha 0): after `__app.advance(s)` while paused,
   `frame().lapTime` is `t + s − SIM_DT`. Standard interpolation lag; 02-04/e2e should compare with ±SIM_DT.
6. `tests/kernel/helpers.ts` (fake sim + fake dom) and `tests/kernel/stub-sim.test.ts` are extra files inside my
   owned `tests/kernel/**` glob.

## For the orchestrator — contract text issue (not edited)
ARCHITECTURE.md §4 line 186: "in a left turn (κ>0, ay>0) the body rolls right (**roll < 0**), right wheels go into
bump". With the binding definition "roll = rotation about +X, positive lifts the LEFT side" (units.ts, verified by
`math.test.ts` sign tests), a body whose right side goes down in a left turn has **roll > 0**. The sentence is
self-contradictory (roll < 0 would put the LEFT wheels into bump). Recommend fixing the check to `roll > 0` before
02-03/02-04 write sign tests. The stub sim is sign-neutral (purely sinusoidal roll) so it is unaffected.

## Known gaps
- No DOM test of `main.ts` (fatal overlay / preload reload) — covered by 01-04 e2e only.
- `trackId` store changes are not applied by the sim host (one track; §6.4 does not list it).

## Verification (real output)
```
$ npm run check
> tsc -p tsconfig.app.json && tsc -p tsconfig.worker.json && tsc -p tsconfig.node.json
✔ no dependency violations found (72 modules, 167 dependencies cruised)
 Test Files  11 passed (11)
      Tests  121 passed (121)
$ npx vitest run tests/kernel tests/sim-core
 Test Files  7 passed (7)
      Tests  91 passed (91)
$ npm run build
dist/client/assets/main-E1FmpG5q.js   23.05 kB │ gzip: 9.60 kB
✓ built in 131ms
$ vite preview + headless Chromium (scratch script, not committed)
/?e2e=1 {"errors":[],"enabled":19,"frame":{"lapTime":20.627,"speed":15,"corners":4},"state":1}
/?e2e=1&features=-debug&debug=1 {"errors":[],"enabled":19,...,"state":1}
(no console messages)
```
