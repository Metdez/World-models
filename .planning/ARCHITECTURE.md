# Suspension Lab — Architecture Contract

**Status:** BINDING for every planner and executor. Written 2026-11-20 by the roadmapper from
`.planning/research/SUMMARY.md` (decisions) and research files 01–23.
**Authority:** SUMMARY.md > this file > individual research files. Where this file is silent, research files apply.
**Change control:** the contract files in §5 are created verbatim in plan 01-01 and are then FROZEN. Any change
to `src/contracts/**`, `src/app/features.ts`, `wrangler.jsonc`, `worker/index.ts` or the layering rules is an
architectural change (GSD deviation rule R4): the executor stops, the orchestrator approves, and the change runs
as its own plan in its own wave so no parallel plan is affected.

Contents: §1 stack · §2 layering · §3 directory tree · §4 frames, units, signs · §5 contract source ·
§6 kernel behaviour · §7 sim-core API and algorithms · §8 URL flags · §9 features, registration, file ownership ·
§10 quality tiers · §11 asset pipeline · §12 Worker, bindings, protocols · §13 testing · §14 honesty rules ·
§15 credits · §16 naming · §17 deploy · §18 performance budgets · §19 Ponytail rules for executors

---

## 1. Stack (pinned)

Node >= 22.12 (container has 22.23). Exact versions are pinned in `package-lock.json` by plan 01-01; ranges below
are the allowed majors. An executor that needs a package not listed here must stop (R4) unless the plan names it.

| Package | Version | Licence | Used by |
|---|---|---|---|
| typescript | ~5.9 | Apache-2.0 | all (not 7.x: no JS API for tooling) |
| vite | ^8.3 | MIT | client build/dev |
| @cloudflare/vite-plugin | ^1.70 | MIT | Worker in workerd during dev/preview, build |
| wrangler | ^4.165 | MIT/Apache | deploy, types |
| three / @types/three | 0.187.x (exact) | MIT | rendering (WebGLRenderer + GLSL only) |
| camera-controls | ^3.1 | MIT | explore view |
| postprocessing | ^6.39 | Zlib | post stack |
| n8ao | ^2.1 | ISC | ambient occlusion |
| nanostores | ^1.5 | MIT | AppStore |
| mitt | ^3.0 | MIT | AppBus |
| @fontsource/geist-sans, @fontsource/geist-mono | ^5 | OFL-1.1 | fonts (self-hosted via bundle) |
| hono | ^4.13 | MIT | Worker routing |
| zod | ^4 | MIT | Worker input validation only |
| partysocket | ^1.3 | MIT | reconnecting WebSocket (live-lab, remote) |
| uqr | ^0.1 | MIT (verify at install) | QR code SVG (presenter) |
| @gltf-transform/core, functions, extensions | ^4.5 | MIT | asset pipeline |
| meshoptimizer | ^1.3 | MIT | asset pipeline (encoder) |
| vitest | ^5.1 | MIT | unit tests |
| @playwright/test | ^1.65 | Apache-2.0 | e2e (Chromium, SwiftShader WebGL) |
| dependency-cruiser | latest stable | MIT | layering rules |
| stats-gl | ^4.2 | MIT | `debug` feature only |

Not used (decided): React/Preact/Lit, zustand, nanoevents, any physics engine, WebGPU/TSL, Draco, KTX2/Basis (v1),
detect-gpu, AI SDK / `agents`, Turnstile, R2, D1, KV.

## 2. Layering and dependency rules

```
src/contracts      types + tiny constants/helpers; imports only other contracts, and TYPES from three/nanostores/mitt
   ^
src/sim-core       pure TS; imports only src/contracts/{units,suspension,vehicle,track,telemetry,sim}.ts and itself
   ^
src/kernel         loop, store, bus, registries, services, flags, clock, assets, sim host; imports contracts + sim-core
   ^
src/ui             design tokens + tiny DOM/format helpers; imports contracts only
src/kit3d          shared three.js part helpers (tubes, rigid frames, spring, damper, hull, disc/caliper); imports three + contracts only
   ^
src/features/<id>  imports contracts, sim-core (pure functions/content), src/ui, src/kit3d, npm libs, ITS OWN folder. Never another feature. Never kernel.
   ^
src/app            composition root: main.ts (imports kernel) + features.ts (imports features)

src/remote         phone remote page: imports contracts (net, store types), sim-core/content, src/ui, partysocket
worker/            imports contracts (units, net, engineer, store, suspension, track, vehicle) and sim-core/content only
scripts/, tests/   may import anything they test
```
Rules (enforced by `.dependency-cruiser.cjs`, run by `npm run lint:deps`, part of `npm run check`):
1. `sim-core` has no npm imports and none of: `contracts/{app,services,events,store,net,engineer}.ts`, kernel, features, ui, DOM.
2. `features/X` must not import `features/Y` (`to.path: ^src/features/([^/]+)/`, `pathNot: ^src/features/$1/`) or `src/kernel`.
3. `kernel` must not import `features`, `ui`, `kit3d`, `app`, `remote`; `ui` and `kit3d` must not import `features`/`kernel`.
4. `worker` must not import `src/{kernel,features,ui,app,remote}` nor `contracts/{app,services,events}.ts`.
5. No circular dependencies (type-only cycles inside `src/contracts` are allowed).
6. A vitest architecture test (`tests/arch/purity.test.ts`) fails if any file under `src/sim-core` contains
   `Math.random`, `Date`, `performance`, `window`, `document`, `requestAnimationFrame` or `from 'three'`.
7. Cross-feature communication only via: store (`ctx.store`), bus (`ctx.bus`), services (`ctx.services`, keys in
   `contracts/services.ts`), registries (`ctx.registries`), and the telemetry frame. No globals (except the
   test-only `window.__app`), no singletons.
8. Content ids never appear in conditionals outside content files (`tests/arch/no-id-branching.test.ts` greps
   `src/kernel` and `src/features` for `=== '<id>'` against every registered id).

## 3. Directory tree (exact)

Owner = plan id that creates the file. Later owners are listed with `→`. A plan may only create/edit files it owns
(see §9.3). `[gen]` = generated, gitignored.

```
/
├─ index.html                      01-01 → 07-02         app entry (canvas stage + overlay root; preload hints)
├─ remote.html                     01-01 (stub) → 06-04  phone remote entry
├─ package.json, package-lock.json 01-01                 deps added later only by the plan named in §1/§9.4
├─ tsconfig.json                   01-01                 solution file (references)
├─ tsconfig.app.json               01-01                 src/** (DOM, vite/client); noEmit
├─ tsconfig.worker.json            01-01                 worker/**, src/contracts, src/sim-core (workers types)
├─ tsconfig.node.json              01-01                 scripts/**, tests/**, *.config.ts
├─ vite.config.ts                  01-01                 cloudflare() plugin; inputs index.html + remote.html
├─ vitest.config.ts                01-01                 node environment; tests/**/*.test.ts
├─ playwright.config.ts            01-01                 chromium + SwiftShader flags; webServer = vite preview
├─ wrangler.jsonc                  01-01                 ALL bindings (§12.1); frozen
├─ worker-configuration.d.ts       01-01                 `npm run typegen` output, committed
├─ .dependency-cruiser.cjs         01-01
├─ .gitignore                      01-01                 node_modules, dist, .wrangler, public/assets, public/asset-manifest.json, test-results
├─ CREDITS.md                      01-01 → 04-02 → 07-04
├─ assets-src/                     (exists)              source assets, committed
│  └─ ATTRIBUTION.json             01-03                 one entry per source file (§11, §15)
├─ public/
│  ├─ _headers                     01-01 → 07-02
│  ├─ favicon.svg                  01-01
│  ├─ assets/**                    [gen] build-assets    content-hashed files
│  └─ asset-manifest.json          [gen] build-assets    AssetManifest (not hashed, revalidated)
├─ scripts/
│  ├─ build-assets.mjs             01-01 (stub: empty manifest) → 01-03 → 07-02
│  ├─ smoke-live.mjs               01-03                 `node scripts/smoke-live.mjs [baseUrl]`
│  └─ smoke-room.mjs               06-01                 WebSocket room smoke + N-socket load test
├─ src/
│  ├─ app/
│  │  ├─ main.ts                   01-02                 boot: createApp(FEATURES).start()
│  │  └─ features.ts               01-01                 THE registration file (one line per feature, §9.1)
│  ├─ contracts/                   01-01                 verbatim from §5, frozen
│  │  └─ units.ts suspension.ts vehicle.ts track.ts telemetry.ts sim.ts events.ts store.ts app.ts services.ts net.ts engineer.ts
│  ├─ kernel/                      01-02
│  │  └─ app.ts features.ts loop.ts store.ts bus.ts registry.ts services.ts flags.ts clock.ts assets.ts sim-host.ts test-hooks.ts
│  ├─ sim-core/
│  │  ├─ index.ts                  01-02 (stub) → 02-04  public API (§7.1)
│  │  ├─ math/                     01-02                 vec3.ts quat.ts mat.ts rng.ts interp.ts linsolve.ts
│  │  ├─ stub/circle.ts            01-02                 placeholder sim; DELETED by 02-04
│  │  ├─ track/                    02-01                 build.ts closure.ts surface.ts features.ts iso8608.ts
│  │  ├─ path/                     02-01                 speed-profile.ts path.ts
│  │  ├─ kinematics/               02-02                 lm.ts spatial.ts metrics.ts table.ts
│  │  ├─ ride/                     02-03                 ride7dof.ts tyre.ts
│  │  ├─ car/                      02-04                 car-model.ts
│  │  ├─ moto/                     02-04 (model.ts stub) → 05-01   model.ts planar.ts ride4dof.ts lean.ts
│  │  ├─ vehicle-models.ts         02-04                 { car: createCarModel, motorcycle: createMotoModel }
│  │  ├─ simulation.ts             02-04                 Simulation implementation
│  │  └─ content/
│  │     ├─ proving-loop.ts        02-01
│  │     ├─ susp-macpherson.ts susp-double-wishbone.ts susp-multilink.ts   02-02
│  │     ├─ gt-coupe.ts            02-04
│  │     └─ cafe-racer.ts moto-classic.ts moto-modern.ts moto-telelever.ts 05-01
│  ├─ features/<id>/               see §9.2 (index.ts default-exports the FeatureModule; stub created by 01-01)
│  ├─ ui/                          01-01                 tokens.css base.css dom.ts format.ts
│  ├─ kit3d/                       03-04                 tube.ts rigid.ts spring.ts damper.ts hull.ts brake.ts materials.ts (shared by linkage-parts + motorcycle)
│  └─ remote/                      01-01 (main.ts stub) → 06-04   main.ts host-panel.ts vote-panel.ts remote.css
├─ docs/
│  └─ EVENT-RUNBOOK.md             07-04                 kiosk, presenter, offline fallback, Paid-plan decision, rollback
├─ worker/
│  ├─ index.ts                     01-01                 Hono app: mounts every route module, exports Room; frozen
│  ├─ room.ts                      01-01 (stub) → 06-01  Durable Object class Room
│  ├─ room-logic.ts                06-01                 pure reducers (presence, ctl, poll, rate bucket)
│  ├─ routes/
│  │  ├─ health.ts time.ts         01-01 (stub) → 01-03
│  │  ├─ rooms.ts                  01-01 (stub) → 06-01  POST /api/rooms, GET /ws/:code, GET /r/:code
│  │  ├─ engineer.ts               01-01 (stub) → 06-02
│  │  └─ event.ts                  01-01 (stub) → 06-03
│  ├─ schemas/                     room.ts 06-01 · engineer.ts 06-02 · event.ts 06-03   (zod)
│  └─ engineer/                    06-02                 facts.ts prompt.ts model.ts numbers.ts fallback.ts
└─ tests/
   ├─ arch/                        01-01 purity.test.ts contracts-verbatim.test.ts · 02-04 no-id-branching.test.ts content-copy.test.ts
   ├─ kernel/                      01-02
   ├─ sim-core/                    02-01 track*, path* · 02-02 kinematics* · 02-03 ride* · 02-04 simulation*, golden*, db11-fit*, no-alloc* · 05-01 moto*
   ├─ worker/                      01-03 health-time · 06-01 room* · 06-02 engineer* · 06-03 event*
   ├─ features/                    <feature-id>[-topic].test.ts, owned by the plan that owns the feature folder
   ├─ scripts/                     01-03 build-assets.test.ts
   ├─ fixtures/                    owner = the plan that creates the fixture (named <plan>-<name>.ts)
   └─ e2e/                         01-04 smoke.spec.ts helpers.ts · then one spec per plan: <plan-id>-<topic>.spec.ts
```

## 4. Frames, units and sign conventions (binding)

The authoritative text is the header of `src/contracts/units.ts` (§5.1). Summary and consequences:

- **SI inside sim-core and the TelemetryFrame**: m, s, kg, N, rad, m/s, m/s². UI converts with `src/ui/format.ts`
  (`deg()`, `mm()`, `kmh()`, `kN()`, `gUnits()`). Wire formats (AI) use explicit suffixes (`camber_deg`).
- **Sim world frame**: right-handed, X east, Y north, **Z up**. Heading ψ from +X, CCW positive.
- **Vehicle frame** (ISO 8855): X forward, Y left, Z up; origin on the ground below the static sprung CG.
  Front axle x = +cgToFront, rear axle x = −(wheelbase − cgToFront).
- **Axle frame** (car hardpoints): vehicle axes, origin on the centreline at ground level under that axle's wheel
  centres at design ride height; LEFT side only; right = mirror y → −y. Identical to Project Chrono's convention
  (Chrono test fixtures keep their own origin; the solver takes ground = wheelCentre.z − tyre radius).
- **Motorcycle points**: vehicle frame at static ride height (planar x/z; y only for visuals).
- **Signs**: roll + = left side up · pitch + = nose down · yaw + = left · curvature + = left turn · ay + = left ·
  camber − = top inboard (both sides) · toe + = toe-in (both sides) · steer + = left · travel + = bump ·
  lateral offset l + = left · bank + = left edge up · spring/damper force + = compression.
  Check: in a left turn (κ>0, ay>0) the body rolls right, i.e. right side down, left side up (roll > 0), right wheels go into bump (travel > 0) and load up.
- **three.js**: scene stays Y-up. The ONLY conversion is `simToThree()` / `simQuatToThree()` in `contracts/units.ts`
  (three.x = x, three.y = z, three.z = −y). glTF assets are Y-up with their own forward axis; each visual builder
  applies its fixed root rotation (DB11: forward is glTF +Z → rotate the model root by +π/2 about three Y so
  forward becomes three +X = sim +X; verify with wheel positions at load).
- **Time**: `SIM_DT = 1/240` s. Shared lap clock: `lapTime = ((serverNow − EPOCH_MS)/1000) mod lapDuration`,
  `EPOCH_MS = 2026‑01‑01T00:00:00Z`.

## 5. Contract source (create VERBATIM in plan 01-01)

Verified to compile with `tsc --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax`
(three/nanostores/mitt stubbed). Plan 01-01 copies each block into the named file without edits; if the real
package typings reject something, that is an R4 stop (report the compiler message; do not improvise).

### 5.1 `src/contracts/units.ts`
```ts
/**
 * Units, frames and sign conventions. BINDING for every module (see ARCHITECTURE.md §4).
 *
 * - SI everywhere in sim-core and TelemetryFrame: m, s, kg, N, rad, m/s, m/s^2, N/m, N*s/m.
 * - Display units (deg, mm, km/h, kN, g) exist only in UI code and in wire formats whose field
 *   names carry an explicit suffix (e.g. `camber_deg`).
 *
 * SIM WORLD frame: right-handed, X east, Y north, Z up. The track lies (mostly) in the XY plane.
 *   Heading psi is measured from +X, counter-clockwise positive (seen from above).
 * VEHICLE frame (ISO 8855 style): right-handed, X forward, Y left, Z up. Origin on the ground plane
 *   directly below the static sprung centre of gravity. Front axle at x = +cgToFront,
 *   rear axle at x = -(wheelbase - cgToFront).
 * AXLE frame (car suspension hardpoints): vehicle axes, origin on the centreline at ground level
 *   directly below that axle's wheel centres at static design ride height. LEFT side only;
 *   the right side is the mirror y -> -y. (Same convention as Project Chrono data.)
 *
 * Angles (all right-hand rule about the named axis):
 *   roll  = rotation about +X (forward): positive lifts the LEFT side.
 *   pitch = rotation about +Y (left):    positive is NOSE DOWN.
 *   yaw   = rotation about +Z (up):      positive turns LEFT.
 *   curvature kappa > 0 for a LEFT turn; lateral acceleration ay > 0 toward the LEFT.
 *   camber: negative = top of the wheel leans INBOARD (toward the car centreline), on both sides.
 *   toe:    positive = TOE-IN (front of the wheel points toward the centreline), on both sides.
 *   steer:  road-wheel angle about vehicle +Z, positive = steering LEFT.
 *   wheel travel: positive = BUMP (wheel moves up relative to the body, spring compresses).
 *   lateral road offset l: positive = LEFT of the centreline.
 *   bank: right-hand roll of the road cross-section about the forward tangent:
 *         positive = LEFT edge higher.
 *
 * THREE.JS render frame is Y-up and right-handed. The ONLY mapping is:
 *   three.x = sim.x,  three.y = sim.z,  three.z = -sim.y
 *   quaternion: three(x, y, z, w) = sim(qx, qz, -qy, qw)
 */

export type Vec3 = readonly [x: number, y: number, z: number];

/** Mutable output vector; structurally compatible with THREE.Vector3 fields (but frames differ!). */
export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** Mutable output quaternion (x, y, z, w). */
export interface XYZW {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type AxleId = 'front' | 'rear';
/** Car corners: fl, fr, rl, rr (this order). Motorcycle: f, r (this order). */
export type CornerId = 'fl' | 'fr' | 'rl' | 'rr' | 'f' | 'r';
export const CAR_CORNERS = ['fl', 'fr', 'rl', 'rr'] as const satisfies readonly CornerId[];
export const MOTO_CORNERS = ['f', 'r'] as const satisfies readonly CornerId[];

/** Standard gravity, m/s^2. */
export const G = 9.80665;
/** Fixed simulation rate. */
export const SIM_HZ = 240;
export const SIM_DT = 1 / SIM_HZ;
/** Render frame dt is clamped to this before feeding the accumulator (s). */
export const MAX_FRAME_DT = 0.1;
/** Shared lap clock epoch: 2026-01-01T00:00:00Z. lapTime = ((serverNow - EPOCH_MS) / 1000) mod lapDuration. */
export const EPOCH_MS = 1767225600000;

/** Writes sim-frame (x, y, z) into a three.js-frame vector (e.g. a THREE.Vector3). */
export function simToThree(x: number, y: number, z: number, out: XYZ): XYZ {
  out.x = x;
  out.y = z;
  out.z = -y;
  return out;
}

/** Writes a sim-frame quaternion into a three.js-frame quaternion (e.g. a THREE.Quaternion). */
export function simQuatToThree(q: XYZW, out: XYZW): XYZW {
  const { x, y, z, w } = q;
  out.x = x;
  out.y = z;
  out.z = -y;
  out.w = w;
  return out;
}

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
```

### 5.2 `src/contracts/suspension.ts`
```ts
import type { AxleId, Vec3 } from './units';

export type VehicleClass = 'car' | 'motorcycle';

/** Semantic part roles. Used for colour coding, highlighting, labels and the AI highlight tool. */
export type ComponentRole =
  | 'upper-arm'
  | 'lower-arm'
  | 'lateral-link'
  | 'trailing-link'
  | 'tie-rod'
  | 'strut'
  | 'spring'
  | 'damper'
  | 'upright'
  | 'anti-roll-bar'
  | 'fork'
  | 'swingarm'
  | 'linkage'
  | 'tyre';

/**
 * One colour per role, identical across every suspension type and both vehicle classes.
 * Linear-sRGB hex for THREE.Color. Rubber/bushings use RUBBER_COLOR; brake parts BRAKE_COLORS.
 */
export const COMPONENT_COLORS: Readonly<Record<ComponentRole, number>> = {
  'upper-arm': 0xb8a1ff,
  'lower-arm': 0xc5c9d0,
  'lateral-link': 0x8e9aaf,
  'trailing-link': 0x8e9aaf,
  'tie-rod': 0xd4782a,
  strut: 0x2f62b0,
  spring: 0xe2c114,
  damper: 0x2f62b0,
  upright: 0x3ec8d8,
  'anti-roll-bar': 0xc43333,
  fork: 0xd9b45a,
  swingarm: 0x3a3e46,
  linkage: 0x8e9aaf,
  tyre: 0x14161a,
};
export const RUBBER_COLOR = 0x2c2f34;
export const BRAKE_COLORS = { disc: 0x5a5e66, caliper: 0xb3262a } as const;

/** Qualitative tendency used for non-computable tradeoffs (cost, packaging). Never shown as a number. */
export type Tendency = 'lower' | 'medium' | 'higher';

/** User-facing copy. RULE: no digits/measurements in any string (enforced by test); numbers come from the sim. */
export interface SuspensionCopy {
  /** Segmented-control label, e.g. "Double wishbone". */
  readonly label: string;
  /** Mobile label, e.g. "Wishbone". */
  readonly short: string;
  /** One line under the selection, <= 60 chars. */
  readonly descriptor: string;
  /** Tendencies, worded as "typically ...". */
  readonly strengths: readonly string[];
  readonly costs: readonly string[];
  readonly qualitative: { readonly cost: Tendency; readonly packaging: Tendency; readonly complexity: Tendency };
}

export type PointName = string;

/**
 * Car linkage constraint on the upright (one rigid body, 6 DOF). A layout must supply exactly
 * 5 independent equations: each 'distance' is 1 equation, each 'strut' is 2.
 */
export type LinkConstraint =
  | {
      readonly kind: 'distance';
      readonly upright: PointName;
      readonly chassis: PointName;
      readonly role: ComponentRole;
      /** Constraints sharing a member name form one rigid arm (e.g. an A-arm = 2 distances to 1 ball joint). */
      readonly member: string;
    }
  | {
      /** MacPherson: chassis top mount must lie on the upright-fixed strut axis through `upright`. */
      readonly kind: 'strut';
      readonly upright: PointName;
      readonly chassis: PointName;
    };

export type SpringLowerMount =
  | { readonly on: 'upright'; readonly point: PointName }
  /** Point rigidly attached to an arm member; rotates about that member's chassis pivot axis. */
  | { readonly on: 'arm'; readonly member: string; readonly point: PointName }
  /** Point at `fraction` (0 = chassis end, 1 = upright end) along a single-rod member. */
  | { readonly on: 'link'; readonly member: string; readonly fraction: number };

export interface SpringMount {
  /** Chassis point (top mount). */
  readonly upper: PointName;
  readonly lower: SpringLowerMount;
}

/** One car axle's linkage. AXLE frame, LEFT side, metres (see units.ts). */
export interface AxleLinkage {
  /** All named points. MUST include 'wheelCentre'. */
  readonly points: Readonly<Record<PointName, Vec3>>;
  /** Names of points rigidly attached to the upright (MUST include 'wheelCentre'); all others are chassis or arm points. */
  readonly uprightPoints: readonly PointName[];
  readonly constraints: readonly LinkConstraint[];
  /** Chassis point displaced along +Y by rack travel (steered axle only). */
  readonly steer?: PointName;
  readonly spring: SpringMount;
  /** Drop-link pickup for the anti-roll bar visual (optional; physics uses vehicle ARB stiffness). */
  readonly antiRollBarMount?: { readonly member: string; readonly point: PointName };
  /** Static alignment at design ride height, rad (camber < 0 = top inboard; toe > 0 = toe-in). */
  readonly alignment: { readonly camber: number; readonly toe: number };
  /** Usable wheel travel magnitudes from design ride height, m (both > 0). Bump stops beyond. */
  readonly travel: { readonly bump: number; readonly droop: number };
}

interface SuspensionBase {
  readonly id: string;
  readonly copy: SuspensionCopy;
  /** Key into Registries.suspensionVisuals. */
  readonly visualKey: string;
}

export interface CarSuspensionDefinition extends SuspensionBase {
  readonly vehicleClass: 'car';
  readonly axles: { readonly front: AxleLinkage; readonly rear: AxleLinkage };
  /** Honest per-type extras. Springs/dampers/ARB targets come from the VEHICLE and are identical across types. */
  readonly extras: {
    /** Coulomb friction in the damper/strut, referred to the wheel, N (strut side-load stiction). */
    readonly damperFriction: number;
    /** Unsprung mass delta per corner vs the vehicle baseline, kg. */
    readonly unsprungMassDelta: number;
  };
}

export interface SpringSpec {
  /** N/m along the spring/shock axis. */
  readonly rate: number;
  /** N at full extension. */
  readonly preload: number;
  /** Optional second rate after `crossover` m of spring compression (dual-rate twin-shock springs). */
  readonly dualRate?: { readonly rate: number; readonly crossover: number };
  /** Progressive term p in F = k*x*(1 + p*(x/xmax)^2) (fork air spring). 0 = linear. */
  readonly progression: number;
}

export interface DamperSpec {
  /** N*s/m along the damper axis. */
  readonly bump: number;
  readonly rebound: number;
}

/** Motorcycle points are in the VEHICLE frame (x fwd, z up) at static ride height; y used only for visuals. */
export interface TelescopicFront {
  readonly kind: 'telescopic';
  /** true = USD (upside-down) fork. */
  readonly inverted: boolean;
  /** Steering-axis angle from vertical, rad. */
  readonly rake: number;
  /** Triple-clamp offset, m. */
  readonly offset: number;
  /** Steering-head (top) point on the steering axis. */
  readonly steeringHead: Vec3;
  readonly travel: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  /** Breakaway friction of the slider bushes, N along the fork axis. */
  readonly stiction: number;
  readonly unsprungMass: number;
  readonly stanchionDiameter: number;
}

export interface TeleleverFront {
  readonly kind: 'telelever';
  readonly rake: number;
  readonly offset: number;
  readonly steeringHead: Vec3;
  /** A-arm chassis pivot and its ball joint on the fork lower bridge. */
  readonly armPivot: Vec3;
  readonly armJoint: Vec3;
  /** Shock between chassis point and a point on the A-arm. */
  readonly shockTop: Vec3;
  readonly shockArm: Vec3;
  readonly travel: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  readonly unsprungMass: number;
}

export interface SwingarmRear {
  readonly kind: 'swingarm';
  readonly pivot: Vec3;
  readonly axle: Vec3;
  /** 2 = twin shock (one per side, y = +/-), 1 = single shock on the arm. */
  readonly shocks: 1 | 2;
  readonly singleSided: boolean;
  readonly shockTop: Vec3;
  readonly shockLower: Vec3;
  readonly travel: number;
  /** Per shock. */
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  readonly unsprungMass: number;
}

export interface LinkageRear {
  readonly kind: 'swingarm-linkage';
  readonly pivot: Vec3;
  readonly axle: Vec3;
  readonly rockerPivot: Vec3;
  /** Dog-bone link from swingarm point to rocker point. */
  readonly swingarmLink: Vec3;
  readonly rockerLink: Vec3;
  /** Shock from chassis top to rocker point. */
  readonly rockerShock: Vec3;
  readonly shockTop: Vec3;
  readonly travel: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  readonly unsprungMass: number;
}

export interface MotorcycleSuspensionDefinition extends SuspensionBase {
  readonly vehicleClass: 'motorcycle';
  readonly front: TelescopicFront | TeleleverFront;
  readonly rear: SwingarmRear | LinkageRear;
}

export type SuspensionDefinition = CarSuspensionDefinition | MotorcycleSuspensionDefinition;

/**
 * Precomputed kinematic curves over wheel travel (computed by sim-core from the definition).
 * All arrays share `travel` as x-axis (ascending, m). Values body-relative, SI.
 */
export interface KinematicsCurves {
  readonly travel: Float64Array;
  /** rad. Motorcycle: zeros. */
  readonly camber: Float64Array;
  /** rad, + toe-in (bump steer). Motorcycle: zeros. */
  readonly toe: Float64Array;
  /** Kinematic roll-centre height above ground for symmetric travel, m. Motorcycle: NaN. */
  readonly rollCentreHeight: Float64Array;
  /** d(spring length)/d(wheel travel), > 0. Motorcycle rear: 1/leverage ratio. */
  readonly motionRatio: Float64Array;
  /** Contact-patch lateral change (car track change, m, + outward) / motorcycle: 0. */
  readonly lateral: Float64Array;
  /** Wheel-centre longitudinal change (m, + forward): car wheelbase change, motorcycle wheelbase change. */
  readonly longitudinal: Float64Array;
}

/** Design-point summary metrics per axle (SI). Used for tradeoff bars; all computed, never hand-typed. */
export interface AxleKinematicsSummary {
  /** d camber / d travel at design, rad/m (car). */
  readonly camberGain: number;
  /** Camber change per unit body roll (rad/rad), to ROAD (car). */
  readonly rollCamber: number;
  /** d toe / d travel at design, rad/m. */
  readonly bumpSteer: number;
  readonly rollCentreHeight: number;
  /** Roll-centre lateral migration for 2 deg body roll, m (car). */
  readonly rollCentreMigration: number;
  readonly kingpinInclination: number;
  readonly caster: number;
  readonly scrubRadius: number;
  readonly trail: number;
  /** Anti-dive (front) / anti-squat (rear) as a fraction (1 = 100 %). Negative = pro-dive. */
  readonly antiPitch: number;
  readonly motionRatio: number;
}

export interface AxleKinematics {
  readonly axle: AxleId;
  readonly curves: KinematicsCurves;
  readonly summary: AxleKinematicsSummary;
}

export type VehicleKinematics = Readonly<Record<AxleId, AxleKinematics>>;
```

### 5.3 `src/contracts/vehicle.ts`
```ts
import type { VehicleClass } from './suspension';

export interface TyreParams {
  /** Unloaded radius, m. */
  readonly radius: number;
  readonly width: number;
  /** N/m. */
  readonly verticalStiffness: number;
  /** N*s/m. */
  readonly verticalDamping: number;
  /** Peak friction coefficient at nominalLoad. */
  readonly mu: number;
  /** d(mu)/d(Fz), 1/N (negative). */
  readonly loadSensitivity: number;
  /** N. */
  readonly nominalLoad: number;
  /** Motorcycle only: tyre crown radius, m (lean correction). */
  readonly crownRadius?: number;
}

/** Inputs to the friction-limited speed profile (identical for every suspension type of a vehicle). */
export interface DrivingLimits {
  /** Max lateral acceleration used by the autopilot, m/s^2 (already includes driver margin). */
  readonly lateral: number;
  /** Max longitudinal acceleration, m/s^2. */
  readonly accel: number;
  /** Max braking deceleration (positive number), m/s^2. */
  readonly brake: number;
  /** Speed cap, m/s. */
  readonly vMax: number;
}

interface VehicleBase {
  readonly id: string;
  readonly class: VehicleClass;
  /** e.g. "GT coupe". Never a manufacturer claim. */
  readonly name: string;
  /** e.g. "Representative parameters". */
  readonly subtitle: string;
  /** Key into Registries.vehicleVisuals. */
  readonly visualKey: string;
  /** Total mass incl. driver/rider, kg. */
  readonly mass: number;
  readonly sprungMass: number;
  /** Static sprung CG height above ground, m. */
  readonly cgHeight: number;
  /** Sprung-body inertias about the CG, kg*m^2. */
  readonly inertia: { readonly roll: number; readonly pitch: number; readonly yaw: number };
  /** m. */
  readonly wheelbase: number;
  /** Horizontal distance CG -> front axle, m (rear = wheelbase - cgToFront). */
  readonly cgToFront: number;
  readonly limits: DrivingLimits;
  /** Drag area Cd*A, m^2. */
  readonly dragArea: number;
  /** Suspension definition ids allowed for this vehicle, in UI order. */
  readonly suspensions: readonly string[];
  readonly defaultSuspension: string;
}

export interface CarAxleSpec {
  /** Wheel-centre to wheel-centre, m. Must match the visual model. */
  readonly track: number;
  /** Baseline unsprung mass per corner, kg (suspension extras add a delta). */
  readonly unsprungMass: number;
  /** Target body ride frequency at this axle, Hz (wheel rate derived from it; identical across suspension types). */
  readonly rideFrequency: number;
  /** Damping ratios at the wheel. */
  readonly damping: { readonly bump: number; readonly rebound: number };
  /** Anti-roll-bar roll stiffness for the axle, N*m/rad. */
  readonly antiRollStiffness: number;
  readonly tyre: TyreParams;
  readonly steered: boolean;
  readonly driven: boolean;
  /** Fraction of total braking force on this axle (front + rear = 1). */
  readonly brakeShare: number;
}

export interface CarDefinition extends VehicleBase {
  readonly class: 'car';
  readonly front: CarAxleSpec;
  readonly rear: CarAxleSpec;
  /** Max road-wheel steer angle, rad (Ackermann applied by sim-core). */
  readonly maxSteer: number;
}

export interface MotoEndSpec {
  readonly tyre: TyreParams;
  readonly brakeShare: number;
  readonly driven: boolean;
}

export interface MotorcycleDefinition extends VehicleBase {
  readonly class: 'motorcycle';
  readonly front: MotoEndSpec;
  readonly rear: MotoEndSpec;
  /** Chain geometry for anti-squat: gearbox sprocket centre (vehicle frame) and radii, m. */
  readonly chain: {
    readonly sprocketCentre: readonly [x: number, z: number];
    readonly frontRadius: number;
    readonly rearRadius: number;
  };
}

export type VehicleDefinition = CarDefinition | MotorcycleDefinition;
```

### 5.4 `src/contracts/track.ts`
```ts
import type { XYZ } from './units';

/** Plan-view primitives, integrated in order. Curvature/angle sign: + = LEFT (CCW). */
export type TrackPrimitive =
  | { readonly kind: 'line'; readonly length: number }
  | { readonly kind: 'arc'; readonly radius: number; readonly angle: number }
  | { readonly kind: 'clothoid'; readonly length: number; readonly k0: number; readonly k1: number };

/** ISO 8608 roughness class of a segment (A smooth .. D poor). Generated deterministically from TrackDefinition.seed. */
export type RoughnessClass = 'A' | 'B' | 'C' | 'D';

/**
 * Closed-form road features. `s` is measured from the START of the owning segment (m);
 * lateral offsets l are + LEFT of centreline (m). Heights in m (+ up).
 */
export type RoadFeature =
  | { readonly kind: 'cosine-bump'; readonly s: number; readonly length: number; readonly height: number; readonly lateral: readonly [l0: number, l1: number] }
  | { readonly kind: 'pothole'; readonly s: number; readonly l: number; readonly radius: number; readonly depth: number }
  | { readonly kind: 'kerb-strike'; readonly s: number; readonly length: number; readonly height: number; readonly side: 'left' | 'right' }
  | { readonly kind: 'washboard'; readonly s: number; readonly length: number; readonly amplitude: number; readonly wavelength: readonly [start: number, end: number] }
  | { readonly kind: 'pave'; readonly s: number; readonly length: number; readonly stone: number; readonly amplitude: number; readonly jointDepth: number }
  | { readonly kind: 'humps'; readonly s: number; readonly count: number; readonly spacing: number; readonly length: number; readonly height: number }
  /** + height = crest, - height = dip (raised-cosine vertical profile). */
  | { readonly kind: 'vertical-curve'; readonly s: number; readonly length: number; readonly height: number };

/** The single suspension phenomenon a section showcases (drives insights, director shots, AI context). */
export type Phenomenon =
  | 'ride-resonance'
  | 'brake-dive'
  | 'steering-lock'
  | 'single-wheel-bump'
  | 'sustained-roll'
  | 'harshness'
  | 'roll-reversal'
  | 'heave'
  | 'steady-state-roll'
  | 'lane-change'
  | 'off-camber'
  | 'settle';

export type TrackProp = { readonly kind: 'cone'; readonly s: number; readonly l: number } | { readonly kind: 'start-line'; readonly s: number };

export interface TrackSegmentDefinition {
  /** Stable id, kebab-case; used in URLs, AI tool enums and analytics. */
  readonly id: string;
  /** Display name, e.g. "Chicane". */
  readonly name: string;
  readonly primitives: readonly TrackPrimitive[];
  readonly phenomenon: Phenomenon;
  /** One-line caption, no numbers. */
  readonly caption: string;
  /** Section bank (rad, + left edge up). Ramps linearly over a leading/trailing clothoid if present. */
  readonly bank?: number;
  readonly roughness: RoughnessClass;
  readonly features?: readonly RoadFeature[];
  /** Optional speed cap for the autopilot in this section, m/s. */
  readonly targetSpeed?: number;
  /**
   * Driving-line lateral offset knots [s from segment start, l (m, + left)], cosine-interpolated between knots;
   * 0 before the first and after the last knot. Used for the lane change and the kerb clip.
   */
  readonly line?: readonly (readonly [s: number, l: number])[];
  /** Props; `s` relative to segment start. */
  readonly props?: readonly TrackProp[];
}

export interface TrackDefinition {
  readonly id: string;
  readonly name: string;
  /** Asphalt width, kerb width each side, runoff width each side (m). */
  readonly width: number;
  readonly kerbWidth: number;
  readonly runoff: number;
  readonly segments: readonly TrackSegmentDefinition[];
  /** Ids of two segments whose single 'line' primitive length is solved so the loop closes in position. */
  readonly closure: readonly [string, string];
  /** Gentle macro elevation: z += amplitude * sin(2*pi*cycles*s/length). */
  readonly swell: { readonly amplitude: number; readonly cycles: number };
  /** Seed for ISO 8608 roughness and pave stones (deterministic: renderer == physics == every device). */
  readonly seed: number;
  readonly visualKey: string;
}

export interface TrackSample {
  s: number;
  /** Centreline world position (z = road height at l = 0). */
  x: number;
  y: number;
  z: number;
  heading: number;
  curvature: number;
  bank: number;
  /** dz/ds of the centreline. */
  grade: number;
}

export interface BuiltSection {
  readonly index: number;
  readonly id: string;
  readonly s0: number;
  readonly s1: number;
  readonly def: TrackSegmentDefinition;
}

/** Runtime track produced by sim-core `buildTrack(def)`. Pure, deterministic; shared by physics and mesh generation. */
export interface BuiltTrack {
  readonly def: TrackDefinition;
  /** Closed loop length, m. All `s` inputs are wrapped modulo length. */
  readonly length: number;
  readonly sections: readonly BuiltSection[];
  /** Props resolved to absolute s. */
  readonly props: readonly TrackProp[];
  sectionIndexAt(s: number): number;
  sample(s: number, out: TrackSample): TrackSample;
  /** Driving-line lateral offset at s (m, + left). */
  lineOffset(s: number): number;
  /** World z of the road surface at (s, l): elevation + bank + roughness + features + kerbs. Single source of truth. */
  roadHeight(s: number, l: number): number;
  /** World position of the road surface point at (s, l). */
  toWorld(s: number, l: number, out: XYZ): XYZ;
}
```

### 5.5 `src/contracts/telemetry.ts`
```ts
import type { VehicleClass } from './suspension';
import type { AxleId, CornerId, XYZ, XYZW } from './units';

/**
 * Preallocated per-corner telemetry. Written by sim-core `sample()`, read by everything else.
 * TRUE fields are physical values and are NEVER amplified.
 * POSE fields (marked) are for rendering and include the display amplification factor.
 */
export interface CornerFrame {
  readonly id: CornerId;
  readonly axle: AxleId;
  /** +1 left, -1 right, 0 centreline (motorcycle). */
  readonly side: 1 | -1 | 0;
  /** Point names for `points`, defined by the active suspension (car: AxleLinkage.points keys incl. arm points; motorcycle: fixed per model kind). */
  pointOrder: readonly string[];

  // ---- TRUE values (SI) ----
  /** m, + bump, from static ride height. */
  travel: number;
  /** m/s, + compressing. */
  travelRate: number;
  /** rad, wheel camber relative to the ROAD plane (- = top inboard). */
  camber: number;
  /** rad, camber relative to the body. */
  camberBody: number;
  /** rad, + toe-in: static + bump steer (excludes steering input). */
  toe: number;
  /** rad, road-wheel steer about vehicle +Z, + left (car: Ackermann per wheel; motorcycle front: steer about steering axis). */
  steer: number;
  /** N, tyre vertical load, >= 0 (0 = wheel off the ground). */
  load: number;
  /** N along the spring axis, + compression. */
  springForce: number;
  /** N along the damper axis, + while resisting compression. */
  damperForce: number;
  /** d(spring length)/d(travel) at the current travel. */
  motionRatio: number;
  /** Model estimate of tyre force used / available, 0..~1.2. Label as "model" in UI. */
  gripUse: number;
  /** 0..1 bump-stop (or rebound-stop) engagement. */
  stop: number;

  // ---- POSE (world, sim frame, amplified) ----
  readonly wheelPosition: XYZ;
  /** Wheel orientation incl. steer/camber/toe, excluding spin. */
  readonly wheelRotation: XYZW;
  /** rad, accumulated rolling angle about the axle (wrapped to [0, 2pi)). */
  spin: number;
  readonly contactPatch: XYZ;
  /** Front-view instant centre (car) / swingarm instant centre (motorcycle rear). */
  readonly instantCentre: XYZ;
  /** World xyz triples for `pointOrder` (length = 3 * pointOrder.length; capacity MAX_POINTS * 3). */
  readonly points: Float64Array;
  /** Current spring length, m (pose). */
  springLength: number;
}

export interface AxleFrame {
  readonly id: AxleId;
  /** TRUE kinematic roll-centre height above the road, m (car; NaN for motorcycle). */
  rollCentreHeight: number;
  /** TRUE anti-dive/anti-squat fraction at the current state. */
  antiPitch: number;
  /** POSE: roll centre in world (car). */
  readonly rollCentre: XYZ;
}

export interface TelemetryFrame {
  vehicleClass: VehicleClass;
  vehicleId: string;
  suspensionId: string;

  // ---- time & path (TRUE) ----
  /** s since simulation start (monotonic, includes seeks' pre-roll). */
  simTime: number;
  /** s within the current lap, [0, lapDuration). */
  lapTime: number;
  lap: number;
  /** m along the centreline. */
  s: number;
  sectionIndex: number;
  sectionId: string;
  /** m/s. */
  speed: number;
  /** Vehicle-frame accelerations, m/s^2 (ax + forward, ay + left). */
  ax: number;
  ay: number;
  yawRate: number;

  // ---- body (TRUE, relative to the local road plane) ----
  /** rad, + left side up (car body roll; motorcycle lean angle). */
  roll: number;
  /** rad, + nose down. */
  pitch: number;
  /** m, + up, from static ride height. */
  heave: number;
  /** rad: mean front road-wheel steer (car) / handlebar steer angle (motorcycle). */
  steer: number;
  /** m, live wheelbase. */
  wheelbase: number;
  /** m, live mechanical trail of the steered axle. */
  trail: number;

  // ---- body POSE (world, sim frame, amplified) ----
  readonly bodyPosition: XYZ;
  readonly bodyRotation: XYZW;
  /** Factor applied to POSE fields this frame (1 = true scale). */
  amplification: number;

  readonly corners: CornerFrame[];
  readonly axles: AxleFrame[];
}

/** Maximum named points per corner (capacity of CornerFrame.points). */
export const MAX_POINTS = 32;

export interface CornerLayout {
  readonly id: CornerId;
  readonly axle: AxleId;
  readonly side: 1 | -1 | 0;
}

const xyz = (): XYZ => ({ x: 0, y: 0, z: 0 });

/** Allocates a zeroed frame. Called by sim-core only when the vehicle (layout) changes. */
export function createTelemetryFrame(vehicleClass: VehicleClass, corners: readonly CornerLayout[]): TelemetryFrame {
  return {
    vehicleClass,
    vehicleId: '',
    suspensionId: '',
    simTime: 0,
    lapTime: 0,
    lap: 0,
    s: 0,
    sectionIndex: 0,
    sectionId: '',
    speed: 0,
    ax: 0,
    ay: 0,
    yawRate: 0,
    roll: 0,
    pitch: 0,
    heave: 0,
    steer: 0,
    wheelbase: 0,
    trail: 0,
    bodyPosition: xyz(),
    bodyRotation: { x: 0, y: 0, z: 0, w: 1 },
    amplification: 1,
    corners: corners.map((c) => ({
      ...c,
      pointOrder: [],
      travel: 0,
      travelRate: 0,
      camber: 0,
      camberBody: 0,
      toe: 0,
      steer: 0,
      load: 0,
      springForce: 0,
      damperForce: 0,
      motionRatio: 1,
      gripUse: 0,
      stop: 0,
      wheelPosition: xyz(),
      wheelRotation: { x: 0, y: 0, z: 0, w: 1 },
      spin: 0,
      contactPatch: xyz(),
      instantCentre: xyz(),
      points: new Float64Array(MAX_POINTS * 3),
      springLength: 0,
    })),
    axles: (['front', 'rear'] as const).map((id) => ({ id, rollCentreHeight: Number.NaN, antiPitch: 0, rollCentre: xyz() })),
  };
}
```

### 5.6 `src/contracts/sim.ts`
```ts
import type { SuspensionDefinition, VehicleKinematics } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { BuiltTrack, TrackDefinition } from './track';
import type { VehicleDefinition } from './vehicle';

/** Lookup the simulation uses to resolve ids (the kernel passes registry getters). */
export interface SimCatalog {
  track(id: string): TrackDefinition | undefined;
  vehicle(id: string): VehicleDefinition | undefined;
  suspension(id: string): SuspensionDefinition | undefined;
}

export interface SimulationOptions {
  readonly catalog: SimCatalog;
  readonly trackId: string;
  readonly vehicleId: string;
  readonly suspensionId: string;
  /** Initial lap time, s (default 0). */
  readonly lapTime?: number;
}

/** Kinematic path state: a PURE function of lap time for a given (track, vehicle). Suspension-independent. */
export interface PathState {
  lapTime: number;
  /** m along centreline. */
  s: number;
  /** Driving-line lateral offset, m (+ left). */
  l: number;
  /** m/s. */
  v: number;
  /** m/s^2 (path tangent / normal, + forward / + left). */
  ax: number;
  ay: number;
  /** Curvature of the driving line (centreline curvature + offset correction), 1/m. */
  curvature: number;
  /** Heading of the driving line, rad. */
  heading: number;
  /** World position of the driving line on the road surface at (s, l) (sim frame). */
  x: number;
  y: number;
  z: number;
  bank: number;
  grade: number;
  sectionIndex: number;
}

export type SimEvent =
  | { readonly kind: 'lap'; readonly lap: number; readonly duration: number }
  | { readonly kind: 'section'; readonly index: number; readonly id: string }
  | { readonly kind: 'bump-stop'; readonly corner: number }
  | { readonly kind: 'liftoff'; readonly corner: number }
  | { readonly kind: 'grip-limit'; readonly corner: number };

export interface Simulation {
  readonly track: BuiltTrack;
  readonly vehicle: VehicleDefinition;
  readonly suspension: SuspensionDefinition;
  /** Duration of one lap for the current vehicle, s (speed profile; identical for all suspension types). */
  readonly lapDuration: number;
  /** Lap time of the CURRENT fixed step, s. */
  readonly lapTime: number;
  readonly simTime: number;

  /** Advance exactly one fixed step. The kernel always passes SIM_DT; determinism is guaranteed only for SIM_DT. */
  step(dt: number): void;
  /**
   * Interpolate between the previous and current fixed step (alpha in [0,1]) and evaluate kinematics.
   * Returns the simulation-owned preallocated frame (valid until the next sample()/setVehicle()).
   * `amplification` (>= 1) scales roll, pitch, heave and wheel travel in POSE fields only.
   */
  sample(alpha: number, amplification?: number): TelemetryFrame;
  /** Swap suspension (same vehicle class). Path position is kept; ride state continues. Throws on class mismatch. */
  setSuspension(id: string): void;
  /** Swap vehicle (+ optional suspension, default vehicle.defaultSuspension). Allocates a new frame; keeps lap phase fraction. */
  setVehicle(id: string, suspensionId?: string): void;
  /** Jump to lap time: path set from stateAt(), ride model initialised at equilibrium and pre-rolled for SEEK_SETTLE_S. */
  seek(lapTime: number): void;
  /** PURE: path state at a lap time (no side effects). Same answer on every device for the same vehicle. */
  stateAt(lapTime: number, out: PathState): PathState;
  /** PURE inverse: lap time at which the driving line passes arc length s (e.g. a section start). */
  lapTimeAt(s: number): number;
  /** Precomputed curves + design summaries for the current suspension on the current vehicle. */
  kinematics(): VehicleKinematics;
  /** World points (pointOrder of that corner) at ZERO travel with the current body pose and steer: the "ghost" rest pose. */
  restPose(cornerIndex: number, out: Float64Array): Float64Array;
  /** Delivers and clears events queued since the last call (kernel calls once per render frame). */
  drainEvents(handler: (event: SimEvent) => void): void;
}

export type CreateSimulation = (options: SimulationOptions) => Simulation;

/** Ride-model pre-roll after seek(), s. */
export const SEEK_SETTLE_S = 1.5;
```

### 5.7 `src/contracts/events.ts`
```ts
import type { Emitter } from 'mitt';
import type { PresenterCue } from './net';
import type { SimEvent } from './sim';
import type { ComponentRole } from './suspension';
import type { CornerId } from './units';

/**
 * Discrete, one-off events (mitt). RULES: past tense or `noun:verb`; plain payloads; never per frame;
 * state lives in the store (subscribe to it), events announce transitions the store cannot express.
 */
export type AppEvents = {
  /** Boot finished: first frame rendered, loading overlay can go. */
  'app:ready': undefined;
  'assets:progress': { loaded: number; total: number };
  /** Emitted by the kernel AFTER the simulation was rebuilt for a new vehicle: TelemetryFrame layout may have changed. */
  'sim:vehicle': { vehicleId: string; suspensionId: string };
  /** Emitted by the kernel AFTER the simulation swapped suspension. */
  'sim:suspension': { suspensionId: string; previous: string };
  /** REQUEST from a feature (section jump, replay, AI tool): the kernel seeks and sets clock = 'local'. */
  'sim:seek-to': { lapTime: number };
  /** Emitted by the kernel AFTER any seek (live-clock resync or a request). */
  'sim:seek': { lapTime: number };
  /** Forwarded from Simulation.drainEvents(). */
  'sim:event': SimEvent;
  /** Request the camera to frame a corner (null = whole car). */
  'camera:focus': { corner: CornerId | null };
  /** Glow a component role (AI tool, part labels, insights). */
  'highlight': { role: ComponentRole; corner: CornerId | 'all'; durationMs: number };
  /** An insight caption was shown (attract mode and analytics listen). */
  'insight:shown': { id: string; text: string };
  /** One-off presenter cue received from the room. */
  'room:cue': { cue: PresenterCue };
  /** Any pointer/keyboard/touch input on the app (attract mode exits on it). */
  'user:activity': undefined;
};

export type AppBus = Emitter<AppEvents>;
```

### 5.8 `src/contracts/store.ts`
```ts
import type { MapStore } from 'nanostores';
import type { QualityTier } from './app';
import type { RoomRole } from './net';
import type { CornerId } from './units';

/** follow = chase camera; explore = free orbit around the moving car; closeup = suspension close-up (x-ray on). */
export type ViewMode = 'follow' | 'explore' | 'closeup';
/** clean = car + minimal HUD; engineer = construction lines, ghost pose, load arrows, curves. */
export type OverlayLevel = 'clean' | 'engineer';

export interface RoomStatus {
  readonly code: string | null;
  readonly role: RoomRole | null;
  readonly connected: boolean;
  /** Connected viewers in the room (excluding host). */
  readonly viewers: number;
  /** Live distribution: key `${vehicleId}:${suspensionId}` -> count. */
  readonly dist: Readonly<Record<string, number>>;
}

/**
 * Discrete app state (nanostores map). Single source of truth for configuration and UI state.
 * NEVER put per-frame data here. Features write with store.setKey(); the kernel applies
 * vehicleId/suspensionId/paused/timeScale/clock to the simulation.
 */
export interface AppState {
  vehicleId: string;
  suspensionId: string;
  trackId: string;
  view: ViewMode;
  focusCorner: CornerId | null;
  xray: boolean;
  overlay: OverlayLevel;
  /** Display amplification of body/wheel motion (1 = true scale). Readouts always show true values. */
  amplification: number;
  paused: boolean;
  /** 1 = real time; slow motion < 1. */
  timeScale: number;
  /** live = lap phase follows the shared server clock; local = free-running (pause/slow-mo/seek). */
  clock: 'live' | 'local';
  attract: boolean;
  hudVisible: boolean;
  creditsOpen: boolean;
  engineerOpen: boolean;
  quality: QualityTier;
  reducedMotion: boolean;
  /** 0..1 loading progress; 1 = ready. */
  loading: number;
  room: RoomStatus;
}

export type AppStore = MapStore<AppState>;

export const DEFAULT_IDS = {
  track: 'proving-loop',
  car: 'gt-coupe',
  carSuspension: 'double-wishbone',
  motorcycle: 'cafe-racer',
} as const;

export const AMPLIFICATION_ON = 2.5;

export function initialState(): AppState {
  return {
    vehicleId: DEFAULT_IDS.car,
    suspensionId: DEFAULT_IDS.carSuspension,
    trackId: DEFAULT_IDS.track,
    view: 'follow',
    focusCorner: null,
    xray: false,
    overlay: 'clean',
    amplification: 1,
    paused: false,
    timeScale: 1,
    clock: 'live',
    attract: false,
    hudVisible: true,
    creditsOpen: false,
    engineerOpen: false,
    quality: 'high',
    reducedMotion: false,
    loading: 0,
    room: { code: null, role: null, connected: false, viewers: 0, dist: {} },
  };
}
```

### 5.9 `src/contracts/app.ts`
```ts
import type { AppBus, AppEvents } from './events';
import type { SuspensionVisualDefinition, VehicleVisualDefinition } from './services';
import type { Simulation } from './sim';
import type { AppState, AppStore, ViewMode } from './store';
import type { SuspensionDefinition } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { TrackDefinition } from './track';
import type { VehicleDefinition } from './vehicle';

// ---------------------------------------------------------------- registries

export interface Registry<T extends { readonly id: string }> {
  /** Throws on duplicate id. Returns an unregister function. */
  register(item: T): () => void;
  get(id: string): T | undefined;
  /** Throws `Unknown <kind> "<id>". Known: a, b, c`. */
  require(id: string): T;
  list(): readonly T[];
}

export interface Registries {
  readonly suspensions: Registry<SuspensionDefinition>;
  readonly vehicles: Registry<VehicleDefinition>;
  readonly tracks: Registry<TrackDefinition>;
  readonly vehicleVisuals: Registry<VehicleVisualDefinition>;
  readonly suspensionVisuals: Registry<SuspensionVisualDefinition>;
}

// ---------------------------------------------------------------- services (typed DI-light)

export interface ServiceKey<T> {
  readonly id: string;
  /** Phantom type carrier; never set. */
  readonly __type?: T;
}

export function serviceKey<T>(id: string): ServiceKey<T> {
  return { id };
}

export interface Services {
  /** Throws if already provided. In a FeatureContext the un-provide is registered as a disposer automatically. */
  provide<T>(key: ServiceKey<T>, impl: T): () => void;
  /** Throws if missing: use only for services of features listed in `requires`. */
  get<T>(key: ServiceKey<T>): T;
  /** Optional services: consumers must degrade gracefully when undefined. */
  tryGet<T>(key: ServiceKey<T>): T | undefined;
}

// ---------------------------------------------------------------- quality

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  /** Upper bound for renderer pixel ratio (the governor may go lower, never higher). */
  readonly maxPixelRatio: number;
  /** Lower bound the adaptive governor may reach. */
  readonly minPixelRatio: number;
  /** Directional shadow map size; 0 = no realtime shadow (baked contact blob only). */
  readonly shadowMapSize: number;
  readonly ambientOcclusion: 'off' | 'half';
  readonly bloom: boolean;
  readonly smaa: boolean;
  readonly anisotropy: number;
  /** Track ribbon longitudinal sample spacing, m. */
  readonly trackResolution: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualitySettings>> = {
  low: { maxPixelRatio: 1, minPixelRatio: 0.6, shadowMapSize: 0, ambientOcclusion: 'off', bloom: false, smaa: false, anisotropy: 2, trackResolution: 1 },
  medium: { maxPixelRatio: 1.25, minPixelRatio: 0.75, shadowMapSize: 1024, ambientOcclusion: 'off', bloom: true, smaa: true, anisotropy: 4, trackResolution: 0.5 },
  high: { maxPixelRatio: 1.75, minPixelRatio: 0.85, shadowMapSize: 2048, ambientOcclusion: 'half', bloom: true, smaa: true, anisotropy: 8, trackResolution: 0.25 },
};

// ---------------------------------------------------------------- flags (URL)

/** Resolved once at boot by kernel/flags.ts from location.search. See ARCHITECTURE.md §8. */
export interface ResolvedFlags {
  /** Explicit feature overrides from ?features=-a,+b (true = force on, false = force off). */
  readonly features: Readonly<Record<string, boolean>>;
  readonly vehicle?: string;
  readonly suspension?: string;
  readonly view?: ViewMode;
  readonly quality?: QualityTier;
  /** ?t=<seconds>: start at this lap time (forces clock=local). */
  readonly lapTime?: number;
  readonly paused: boolean;
  readonly amplification?: number;
  readonly clock?: 'live' | 'local';
  /** ?attract=0|1 overrides idle-driven attract mode. */
  readonly attract?: boolean;
  /** ?room=CODE joins a private room instead of the public one. */
  readonly room?: string;
  /** ?screen=1: this device is the presenter's big screen (creates a room, follows host commands). */
  readonly screen: boolean;
  /** ?debug=1: dev panels/stats. */
  readonly debug: boolean;
  /** ?e2e=1: deterministic test mode (no idle attract, no network room, fixed DPR 1, window.__app hooks). */
  readonly e2e: boolean;
}

// ---------------------------------------------------------------- clock, assets

export interface Clock {
  /** Server-synchronised unix ms (local Date.now() + offset until synced). */
  serverNow(): number;
  /** Set by the live-lab feature after time sync. */
  setOffset(ms: number): void;
  readonly synced: boolean;
}

export interface Attribution {
  readonly title: string;
  readonly author: string;
  readonly authorUrl?: string;
  /** SPDX-ish id, e.g. "CC-BY-4.0", "CC0-1.0". */
  readonly license: string;
  readonly licenseUrl: string;
  readonly sourceUrl: string;
  /** "Changes indicated" text required by CC BY. */
  readonly modified?: string;
  /** assets-src relative paths covered by this entry. */
  readonly files: readonly string[];
}

export interface AssetEntry {
  readonly id: string;
  /** Content-hashed public URL, e.g. /assets/car/db11.3f9a1c2e.glb */
  readonly url: string;
  readonly bytes: number;
}

/** Written by scripts/build-assets.mjs to public/assets/manifest.json. */
export interface AssetManifest {
  readonly version: 1;
  readonly assets: Readonly<Record<string, AssetEntry>>;
  readonly attributions: readonly Attribution[];
}

export interface Assets {
  readonly manifest: AssetManifest;
  /** Throws for unknown ids. Ids are logical, e.g. 'car/db11', 'hdri/track', 'tex/asphalt/diff'. */
  url(id: string): string;
}

// ---------------------------------------------------------------- context and modules

export interface SimHost {
  /** The current simulation. REPLACED on vehicle change: never cache it across 'sim:vehicle'. */
  readonly current: Simulation;
  /** Frame sampled for the current render frame (same object as FrameInfo.t). */
  readonly frame: TelemetryFrame;
}

export interface AppContext {
  readonly store: AppStore;
  readonly bus: AppBus;
  readonly registries: Registries;
  readonly services: Services;
  readonly flags: ResolvedFlags;
  readonly clock: Clock;
  readonly assets: Assets;
  readonly sim: SimHost;
  readonly dom: {
    /** Element that hosts the WebGL canvas (full-viewport). */
    readonly stage: HTMLElement;
    /** Full-viewport overlay for DOM UI (pointer-events: none; children opt in). */
    readonly overlay: HTMLElement;
  };
}

export interface FeatureContext extends AppContext {
  readonly featureId: string;
  /** Teardown run (in reverse order) when the feature is disabled/disposed. */
  addDisposer(fn: () => void): void;
  /** bus.on that auto-unsubscribes on dispose. */
  on<K extends keyof AppEvents>(type: K, handler: (payload: AppEvents[K]) => void): void;
  /** store.subscribe (fires immediately) that auto-unsubscribes on dispose. */
  watch(handler: (state: Readonly<AppState>) => void): void;
}

/**
 * Per-render-frame phases, run in this order. Inside a phase: dependency order (`requires`),
 * then alphabetical id. 'render' is owned by the renderer feature only.
 */
export type FramePhase = 'scene' | 'camera' | 'render' | 'overlay';

export interface FrameInfo {
  /** Render dt, s (clamped to MAX_FRAME_DT). */
  readonly dt: number;
  /** performance.now() / 1000. */
  readonly time: number;
  /** Interpolation factor used for this frame's sample. */
  readonly alpha: number;
  /** The sampled telemetry for this frame (sim-owned; do not mutate). */
  readonly t: TelemetryFrame;
}

export interface FeatureModule {
  /** kebab-case, equals the folder name under src/features/. */
  readonly id: string;
  /** Hard dependencies: initialised first; this feature is disabled if any is disabled. */
  readonly requires?: readonly string[];
  /** Default true. */
  readonly defaultEnabled?: boolean;
  /** Default 'scene'. */
  readonly phase?: FramePhase;
  /** Register content (definitions/visual builders). Called for ALL enabled features BEFORE the simulation is created. */
  contribute?(registries: Registries): void;
  /** Acquire resources. Everything acquired must be released via ctx.addDisposer or dispose(). */
  init?(ctx: FeatureContext): void | Promise<void>;
  /** Called every rendered frame in `phase`. Must not allocate. */
  update?(frame: FrameInfo): void;
  /** Optional explicit teardown (runs before registered disposers). Must be idempotent. */
  dispose?(): void;
}
```

### 5.10 `src/contracts/services.ts`
```ts
/**
 * Client-only service contracts (import three.js TYPES). sim-core and worker/ must NOT import this file.
 */
import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { serviceKey, type Assets, type QualitySettings } from './app';
import type { ClientMessage, RoomRole, ServerMessage } from './net';
import type { ComponentRole, SuspensionDefinition } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { CornerId } from './units';
import type { VehicleDefinition } from './vehicle';

export interface RenderStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly pixelRatio: number;
}

/** Provided by the `renderer` feature. Scene is Y-up (see units.ts for the sim->three mapping). */
export interface RenderService {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /** Owned by renderer, posed exclusively by the `camera` feature. */
  readonly camera: PerspectiveCamera;
  /** Adds to the scene; returns the remover (register it with ctx.addDisposer). */
  add(object: Object3D): () => void;
  /** Effective settings: tier preset; pixel ratio adjusted by the adaptive governor. */
  readonly quality: QualitySettings;
  /** Compile all programs for what is currently in the scene (call behind the loading overlay). */
  compile(): Promise<void>;
  stats(): RenderStats;
}

export type ShotKind = 'chase' | 'orbit' | 'closeup' | 'trackside' | 'overhead' | 'front-view';

export interface DirectorShot {
  readonly kind: ShotKind;
  readonly corner?: CornerId;
  readonly durationS: number;
  /** Vertical FOV, deg (default per kind). */
  readonly fov?: number;
}

/** Provided by the `camera` feature. View mode itself is store state (AppState.view). */
export interface CameraService {
  /** Scripted shot (attract mode, presenter cues). Cleared by clearShot(), a view change or user input. */
  playShot(shot: DirectorShot): void;
  clearShot(): void;
  readonly transitioning: boolean;
}

/** Provided by the `live-lab` feature (one WebSocket per app). */
export interface RoomService {
  readonly code: string | null;
  readonly role: RoomRole | null;
  /** Only set on the big screen that created the room (shown as QR fragment #k=). */
  readonly hostKey: string | null;
  readonly connected: boolean;
  send(message: ClientMessage): void;
  on<T extends ServerMessage['t']>(type: T, handler: (message: Extract<ServerMessage, { t: T }>) => void): () => void;
}

export const RENDER = serviceKey<RenderService>('render');
export const CAMERA = serviceKey<CameraService>('camera');
export const ROOM = serviceKey<RoomService>('room');

// ---------------------------------------------------------------- visual builders (contributed via registries)

export interface VisualContext {
  readonly assets: Assets;
  readonly render: RenderService;
}

export interface VehicleVisual {
  /** Added to the scene by `vehicle-view`. */
  readonly root: Object3D;
  /** Pose body and wheels from POSE fields (sim frame -> three via simToThree). Must not allocate. */
  update(t: TelemetryFrame): void;
  /** 0 = opaque body, 1 = fully ghosted (x-ray). */
  setXray(amount: number): void;
  dispose(): void;
}

export interface VehicleVisualDefinition {
  /** Equals VehicleDefinition.visualKey. */
  readonly id: string;
  load(vehicle: VehicleDefinition, ctx: VisualContext): Promise<VehicleVisual>;
}

export interface SuspensionVisual {
  readonly root: Object3D;
  /** Drive parts from CornerFrame.points / springLength (POSE fields). Must not allocate. */
  update(t: TelemetryFrame): void;
  setHighlight(role: ComponentRole, corner: CornerId | 'all', on: boolean): void;
  dispose(): void;
}

export interface SuspensionVisualDefinition {
  /** Equals SuspensionDefinition.visualKey. */
  readonly id: string;
  build(suspension: SuspensionDefinition, vehicle: VehicleDefinition, ctx: VisualContext): SuspensionVisual;
}
```

### 5.11 `src/contracts/net.ts`
```ts
/**
 * Worker HTTP API + room WebSocket protocol. Shared by src/ (client) and worker/ (server).
 * Types only + constants. Runtime validation lives in worker/schemas.ts (zod), type-tested against these.
 */
import type { ViewMode, OverlayLevel } from './store';

export const API = {
  health: '/api/health',
  time: '/api/time',
  rooms: '/api/rooms',
  engineer: '/api/engineer',
  event: '/api/event',
} as const;

/** WebSocket upgrade path: `/ws/<CODE>?id=&role=&k=&v=&s=&pv=` */
export const WS_PREFIX = '/ws/';
/** Short audience link: GET /r/<CODE> -> 302 /remote.html?room=<CODE> */
export const REMOTE_PREFIX = '/r/';
export const REMOTE_PAGE = '/remote.html';
/** Public room everyone joins by default (cannot have a host; not producible by the code alphabet). */
export const PUBLIC_ROOM = 'LIVE';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const PROTOCOL_VERSION = 1;

export const NET_LIMITS = {
  wsMessageBytes: 1024,
  wsMessagesPerSecond: 5,
  wsBurst: 10,
  presenceFlushMs: 1000,
  roomIdleTtlMs: 12 * 3600 * 1000,
  pollQuestionChars: 120,
  pollOptionChars: 40,
  pollOptionsMax: 4,
  engineerQuestionChars: 280,
  engineerHistoryMax: 6,
  engineerHistoryChars: 600,
} as const;

// ---------------------------------------------------------------- HTTP

export interface HealthResponse {
  readonly ok: true;
  /** Git short sha or package version baked at build. */
  readonly version: string;
  readonly time: number;
}

/** GET /api/time (Cache-Control: no-store). */
export interface TimeResponse {
  /** Server unix ms stamped immediately before responding. */
  readonly t: number;
}

/** POST /api/rooms (rate limited). The host key is shown only on the big screen (QR fragment #k=). */
export interface CreateRoomResponse {
  readonly code: string;
  readonly hostKey: string;
}

/** POST /api/event -> 204. Anonymous; written to Analytics Engine. No ids, no IP stored. */
export type AnalyticsEvent =
  | { readonly type: 'suspension-picked'; readonly vehicle: string; readonly suspension: string }
  | { readonly type: 'view-changed'; readonly view: ViewMode }
  | { readonly type: 'engineer-asked'; readonly suspension: string }
  | { readonly type: 'session'; readonly quality: string; readonly fps: number };

export interface ErrorResponse {
  readonly error: string;
}

// ---------------------------------------------------------------- WebSocket rooms

/**
 * viewer   = normal app (presence only; ignores presenter commands)
 * screen   = presenter's big screen (applies `ctl` state and cues)
 * host     = phone remote with the host key (may send `ctl`)
 * audience = phone on /remote.html without key (may vote)
 */
export type RoomRole = 'viewer' | 'screen' | 'host' | 'audience';

/** Controls the host can set; the screen applies them to its store. */
export interface PresenterControls {
  readonly vehicleId?: string;
  readonly suspensionId?: string;
  readonly view?: ViewMode;
  readonly xray?: boolean;
  readonly overlay?: OverlayLevel;
  readonly timeScale?: number;
  readonly amplification?: number;
  readonly attract?: boolean;
  /** Section id to jump to (screen seeks). */
  readonly section?: string;
}

export interface PresenterState extends PresenterControls {
  /** Monotonic per room; screens ignore stale state. */
  readonly seq: number;
}

export type PresenterCue = 'replay-section' | 'focus-front-left' | 'focus-car';

export interface PollState {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly counts: readonly number[];
  readonly open: boolean;
}

export type ClientMessage =
  /** NTP-style probe: c0 = client performance.now() at send. */
  | { readonly t: 'sync'; readonly c0: number }
  /** Presence: what this viewer is running now. */
  | { readonly t: 'pick'; readonly vehicleId: string; readonly suspensionId: string }
  /** Host only. */
  | { readonly t: 'ctl'; readonly set: PresenterControls }
  /** Host only. */
  | { readonly t: 'cue'; readonly cue: PresenterCue }
  /** Host only: open a poll (null closes the current one). */
  | { readonly t: 'poll'; readonly poll: { readonly question: string; readonly options: readonly string[] } | null }
  /** Audience/viewer: one vote per client id per poll (re-vote replaces). */
  | { readonly t: 'vote'; readonly pollId: string; readonly choice: number };
// Heartbeat: the literal text frame "ping" (answered "pong" by the runtime without waking the DO).

export interface PresenceSnapshot {
  readonly viewers: number;
  readonly dist: Readonly<Record<string, number>>;
}

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly id: string;
      readonly role: RoomRole;
      readonly serverNow: number;
      readonly presence: PresenceSnapshot;
      readonly ctl: PresenterState;
      readonly poll: PollState | null;
    }
  | { readonly t: 'sync'; readonly c0: number; readonly s1: number }
  /** Coalesced to <= 1 Hz. */
  | ({ readonly t: 'presence' } & PresenceSnapshot)
  | { readonly t: 'ctl'; readonly state: PresenterState }
  | { readonly t: 'cue'; readonly seq: number; readonly cue: PresenterCue }
  /** Coalesced to <= 2 Hz. */
  | { readonly t: 'poll'; readonly poll: PollState | null }
  | { readonly t: 'err'; readonly code: 'rate' | 'too-big' | 'bad-message' | 'forbidden' };
```

### 5.12 `src/contracts/engineer.ts`
```ts
/**
 * AI Race Engineer: POST /api/engineer. Wire format uses DISPLAY units with explicit suffixes.
 * The client computes every number; the model may only quote numbers present in `telemetry`
 * (the worker enforces this and falls back otherwise). Tools are executed in the browser.
 */
import type { ViewMode } from './store';
import type { ComponentRole, VehicleClass } from './suspension';
import type { CornerId } from './units';

export const ENGINEER_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const ENGINEER_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash';
export const ENGINEER_MAX_OUTPUT_TOKENS = 160;
export const ENGINEER_MAX_ACTIONS = 2;

export interface EngineerCorner {
  readonly camber_deg: number;
  readonly toe_deg: number;
  readonly travel_mm: number;
  readonly load_n: number;
  readonly grip_use: number;
}

export interface EngineerTelemetry {
  readonly vehicle_class: VehicleClass;
  readonly vehicle: string;
  readonly suspension: string;
  /** Track section id + display name. */
  readonly section: string;
  readonly section_name: string;
  /** Client-derived plain-language label, e.g. "mid-corner, left-hander, outside wheel loaded". */
  readonly event: string;
  readonly speed_kmh: number;
  readonly lat_g: number;
  readonly long_g: number;
  readonly roll_deg: number;
  readonly pitch_deg: number;
  readonly corners: Readonly<Partial<Record<CornerId, EngineerCorner>>>;
  /** Extra computed values, e.g. { roll_centre_front_mm: 62, camber_gain_front_deg_per_10mm: -0.4 }. */
  readonly derived: Readonly<Record<string, number>>;
}

export interface EngineerTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface EngineerRequest {
  /** 1..NET_LIMITS.engineerQuestionChars */
  readonly question: string;
  readonly telemetry: EngineerTelemetry;
  /** <= NET_LIMITS.engineerHistoryMax turns. */
  readonly history: readonly EngineerTurn[];
}

export type EngineerAction =
  | { readonly tool: 'switch_suspension'; readonly args: { readonly id: string } }
  | { readonly tool: 'set_view'; readonly args: { readonly view: ViewMode; readonly corner?: CornerId } }
  | { readonly tool: 'set_slow_motion'; readonly args: { readonly scale: number } }
  | { readonly tool: 'highlight_component'; readonly args: { readonly component: ComponentRole; readonly corner: CornerId | 'all' } }
  | { readonly tool: 'jump_to_section'; readonly args: { readonly section: string } };

export type EngineerToolName = EngineerAction['tool'];

export interface EngineerResponse {
  /** 1-3 sentences, plain text. */
  readonly text: string;
  /** Validated, at most ENGINEER_MAX_ACTIONS. */
  readonly actions: readonly EngineerAction[];
  /** 'fallback' = rule-based answer (quota, error, failed number check). */
  readonly source: 'model' | 'fallback';
}

/** OpenAI-style function tool schema (Workers AI `tools` parameter). */
export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: EngineerToolName;
    readonly description: string;
    readonly parameters: {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, unknown>>;
      readonly required: readonly string[];
    };
  };
}

const COMPONENTS: readonly ComponentRole[] = [
  'upper-arm', 'lower-arm', 'lateral-link', 'trailing-link', 'tie-rod', 'strut', 'spring', 'damper',
  'upright', 'anti-roll-bar', 'fork', 'swingarm', 'linkage', 'tyre',
];
const CORNERS: readonly CornerId[] = ['fl', 'fr', 'rl', 'rr', 'f', 'r'];

/** Tool schemas with enums filled from content (suspension ids of the active vehicle class, track section ids). */
export function buildEngineerTools(ids: { readonly suspensions: readonly string[]; readonly sections: readonly string[] }): ToolSchema[] {
  const fn = (name: EngineerToolName, description: string, properties: Record<string, unknown>, required: string[]): ToolSchema => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  return [
    fn('switch_suspension', 'Switch the vehicle to a different suspension type.', { id: { type: 'string', enum: ids.suspensions } }, ['id']),
    fn('set_view', 'Change the camera: follow the car, explore freely, or a suspension close-up of one corner.', {
      view: { type: 'string', enum: ['follow', 'explore', 'closeup'] },
      corner: { type: 'string', enum: CORNERS },
    }, ['view']),
    fn('set_slow_motion', 'Set simulation speed. 1 = normal, 0.1 = very slow.', { scale: { type: 'number', minimum: 0.1, maximum: 1 } }, ['scale']),
    fn('highlight_component', 'Make one suspension component glow.', {
      component: { type: 'string', enum: COMPONENTS },
      corner: { type: 'string', enum: [...CORNERS, 'all'] },
    }, ['component', 'corner']),
    fn('jump_to_section', 'Move the car to the start of a named track section.', { section: { type: 'string', enum: ids.sections } }, ['section']),
  ];
}
```

---

## 6. Kernel behaviour (plan 01-02)

### 6.1 API
```ts
// src/kernel/app.ts
export interface CreateAppOptions {
  readonly features: readonly FeatureModule[];
  readonly search?: string;                          // default location.search
  readonly dom?: AppContext['dom'];                  // default #stage / #overlay from index.html
  readonly createSimulation?: CreateSimulation;      // default: sim-core createSimulation (tests inject fakes)
  readonly loadManifest?: () => Promise<AssetManifest>; // default: fetch('/asset-manifest.json')
  readonly raf?: (cb: (nowMs: number) => void) => number; // tests drive frames manually
}
export interface App {
  readonly ctx: AppContext;
  start(): Promise<void>;          // boot sequence 6.2 then loop
  stop(): void;                    // disposes all features in reverse order, stops loop
  /** Test-only: run n render frames of dt seconds synchronously. */
  tick(n: number, dt: number): void;
}
export function createApp(options: CreateAppOptions): App;
```
`src/app/main.ts` is exactly: `import * as FEATURES from './features'; import { createApp } from '../kernel/app';`
`createApp({ features: Object.values(FEATURES) }).start();` plus a fatal-error overlay if `start()` rejects.

### 6.2 Boot sequence
1. `flags = parseFlags(search)` (§8). Unknown flags/values: `console.warn`, ignored.
2. `store = map(initialState())`, then overlay flags: vehicle, suspension, view, quality, paused, amplification,
   clock (`?t=` or `?paused=1` force `clock: 'local'`), attract. `reducedMotion` from `matchMedia('(prefers-reduced-motion: reduce)')`.
3. Create bus (mitt), registries (`kernel/registry.ts`), services, clock (offset 0), assets (load manifest; on
   failure in `e2e` mode use an empty manifest and warn; otherwise fatal).
4. Resolve enabled features: `flags.features[id] ?? module.defaultEnabled ?? true`; `?debug=1` forces `debug` on.
   Repeatedly disable any module whose `requires` names a disabled or unknown id (warn with the reason).
   Topologically sort by `requires` (ties: alphabetical id). A cycle throws at boot.
5. Call `contribute(registries)` on every enabled module in order.
6. Validate store ids: unknown `trackId`/`vehicleId` → first registered item; `suspensionId` not in
   `vehicle.suspensions` → `vehicle.defaultSuspension`. If a registry is empty (phase 1), ids pass through.
7. `sim = createSimulation({ catalog, trackId, vehicleId, suspensionId, lapTime })`.
8. `await init(ctx)` for each enabled module in order with a scoped `FeatureContext`. If an init throws/rejects:
   record the error, run that feature's disposers, mark it (and every enabled feature requiring it) disabled,
   continue. If `renderer` fails, show the fatal overlay "This experience needs WebGL 2" and stop.
9. Start the loop. After the first rendered frame AND all inits resolved: `store.loading = 1`, emit `app:ready`,
   `window.__app.ready = true` (when hooks enabled).

### 6.3 Frame loop (`kernel/loop.ts`)
```
onFrame(nowMs):
  dt = clamp((nowMs - lastMs)/1000, 0, MAX_FRAME_DT); lastMs = nowMs
  st = store.get()
  if !st.paused:
     acc += dt * st.timeScale
     if st.clock === 'live' && st.timeScale === 1: liveCorrection(dt)        // 6.5
     steps = 0
     while acc >= SIM_DT && steps < 24: sim.step(SIM_DT); acc -= SIM_DT; steps++
     if steps === 24: acc = 0                                                // spiral-of-death guard
  t = sim.sample(acc / SIM_DT, st.amplification)
  sim.drainEvents(e => bus.emit('sim:event', e))
  for phase of ['scene','camera','render','overlay']: for f of enabledInOrder(phase): f.update?.({dt, time: nowMs/1000, alpha, t})
  requestAnimationFrame(onFrame)
```
`update()` exceptions are caught per feature; after 3 consecutive throws the feature is disabled (disposed) and
the error recorded. `document.visibilitychange` → hidden: stop rAF; visible: reset `lastMs`, and if `clock==='live'`
seek to the live target.

### 6.4 Sim host (`kernel/sim-host.ts`)
Subscribes to the store and applies changes to the simulation in this order, once per store change:
- `vehicleId` changed → `sim.setVehicle(vehicleId, suspensionIdIfValid)`; write back the actual `suspensionId`;
  emit `sim:vehicle`. Features must re-read `ctx.sim.frame` / `frame.corners` after this event (layout may differ).
- `suspensionId` changed → reject (revert store, warn) if not in `vehicle.suspensions`; else `sim.setSuspension()`,
  emit `sim:suspension`.
- `paused` → true or `timeScale !== 1` → set `clock: 'local'`. Setting `clock: 'live'` → seek to the live target.
- Bus `sim:seek-to {lapTime}` (a REQUEST from any feature: section jump, presenter, AI tool, replay) →
  `sim.seek(lapTime)`, `acc = 0`, `clock: 'local'`, then emit `sim:seek`.
Features NEVER call `setVehicle`, `setSuspension` or `seek` on the simulation; they write the store or emit
`sim:seek-to`. To find a section's start time they call the pure `ctx.sim.current.lapTimeAt(section.s0)`.

### 6.5 Live clock
`target = (((clock.serverNow() - EPOCH_MS) / 1000) % D + D) % D` with `D = sim.lapDuration`.
`err = wrapToHalfLap(target - (sim.lapTime + acc))`. If `|err| > 0.5 s` → `sim.seek(target); acc = 0; emit sim:seek`.
Else slew: `acc += clamp(err, -0.02*dt, +0.02*dt)` (±2 % speed, invisible). Without a synced clock the offset is 0
(local wall clock), so solo visitors are still on the "global" lap. Honest limit: only the PATH is shared exactly;
the ride state after a seek is pre-rolled for SEEK_SETTLE_S, so two devices differ by imperceptible transients.

### 6.6 Test hooks (`kernel/test-hooks.ts`, only when `flags.e2e || flags.debug`)
```ts
window.__app = {
  ready: boolean,                                   // set at app:ready
  errors: string[],                                  // feature init/update failures + console.error capture
  features(): { id: string; enabled: boolean; error?: string }[],
  state(): AppState, set<K extends keyof AppState>(key: K, value: AppState[K]): void,
  frame(): { lapTime, s, sectionId, speed, roll, pitch, ax, ay,
             corners: { id, travel, camber, toe, load }[] },   // JSON-safe copy of TRUE fields
  kinematics(): Record<AxleId, AxleKinematicsSummary>,
  stats(): RenderStats | null,                       // via services.tryGet(RENDER)
  seek(lapTime: number): void,                       // emits 'sim:seek-to' (clock -> local)
  advance(seconds: number): void,                    // while paused: steps the sim and renders one frame (deterministic)
};
```
In `e2e` mode: attract idle timer disabled, room connection disabled (live-lab inits in offline mode), pixel ratio 1,
governor off, `quality` defaults to `low` unless `?quality=` given.

### 6.7 Disposal contract
`FeatureContext.addDisposer` callbacks run in reverse order after the feature's `dispose()`. `services.provide`,
`ctx.on`, `ctx.watch` and `RenderService.add` removers are registered automatically by the scoped context
(`RenderService.add` returns a remover the feature must pass to `addDisposer` — the renderer cannot know the
caller). A dev-mode check after `stop()` asserts bus listener count and scene child count return to baseline.

## 7. sim-core API and algorithms

### 7.1 Public API (`src/sim-core/index.ts`)
```ts
export { createSimulation } from './simulation';             // CreateSimulation (contracts/sim.ts)
export { buildTrack } from './track/build';                  // (def: TrackDefinition) => BuiltTrack
export { solveAxleKinematics } from './kinematics/table';    // see 7.2.2
```
Content is imported by path (`src/sim-core/content/gt-coupe.ts` exports `gtCoupe`), never through index.ts.
Content ids: track `proving-loop`; car `gt-coupe`; car suspensions `macpherson`, `double-wishbone`, `multilink`
(visualKey `spatial-linkage`); motorcycle `cafe-racer`; presets `moto-classic`, `moto-modern`, `moto-telelever`
(visualKey `moto-planar`); vehicle visual keys `db11`, `cafe-racer`; track visualKey `proving-loop`.

### 7.2 Internal interfaces between phase-2 plans (binding signatures)

7.2.1 Track & path (02-01):
```ts
// track/build.ts
export function buildTrack(def: TrackDefinition): BuiltTrack;
// path/speed-profile.ts
export interface SpeedProfile {
  readonly lapDuration: number;
  stateAt(lapTime: number, out: PathState): PathState;   // pure; ax/ay from the profile (low-passed 8 Hz equivalent, precomputed)
  timeAtS(s: number): number;
}
export function buildSpeedProfile(track: BuiltTrack, limits: DrivingLimits, dragArea: number, mass: number): SpeedProfile;
```
Algorithm: resample at ds = 0.5 m; driving-line curvature κ = κc(s) + l''(s) (small-offset approximation);
`v_lim = min(vMax, targetSpeed, sqrt(lateral/|κ|))`; backward pass (brake, friction ellipse) and forward pass
(accel, ellipse, drag) each run twice around the closed loop; 10 m moving-average smoothing of v; t(s) by
trapezoid; `stateAt` inverts t(s) by binary search + linear interpolation. Reimplemented from research 05 §5
(OpenLAP/TUMFTM are GPL/LGPL: algorithm only).

7.2.2 Kinematics (02-02):
```ts
// kinematics/table.ts
export interface CornerSolution {
  travel: number; rack: number;
  camber: number; toe: number;                       // body-relative, sign conventions §4
  readonly wheelCentre: XYZ; readonly contactPatch: XYZ; readonly instantCentre: XYZ;  // AXLE frame, left side
  readonly rotation: XYZW;                            // upright rotation from design pose
  springLength: number; motionRatio: number;
  readonly points: Float64Array;                      // AXLE frame, table.pointOrder
}
export interface KinematicsTable {
  readonly pointOrder: readonly string[];             // all AxleLinkage.points keys + derived arm/spring points
  readonly travelRange: readonly [number, number];    // [-droop - 0.02, bump + 0.02]
  readonly rackRange: readonly [number, number];
  sample(travel: number, rack: number, out: CornerSolution): CornerSolution;   // bilinear, no allocation
  rackForSteer(steer: number): number;                // inverse of mean road-wheel angle at travel 0
  rollCentreHeight(travelLeft: number, travelRight: number): number;
  readonly antiPitch: number;                         // side-view anti-dive (front) / anti-squat (rear) fraction
}
export function solveAxleKinematics(axle: AxleLinkage, opts: { tyreRadius: number; maxSteer?: number; axle: AxleId; cgHeight: number; wheelbase: number; brakeShare: number }):
  { table: KinematicsTable; kinematics: AxleKinematics };
```
Solver: research 03 §3 verbatim maths. State x = (t, w) (translation, rotation vector), residuals from the
declarative constraints (`distance`: |P−C|² − L²; `strut`: projections of (T−S) on two vectors ⟂ to the
upright-fixed strut axis) + travel equation (wheel-centre z = z0 + travel); steering moves the `steer` chassis point
by +rack in Y. Levenberg–Marquardt, central-difference Jacobian h = 1e-7, λ = 1e-9, tol 1e-12, ≤ 40 iterations,
continuation from design in 5 mm steps with warm start. Grid: travel step 2.5 mm, rack step 2 mm. Metrics per
research 03 §3.3 (camber −asin(a_z), toe atan2(a_x, a_y), contact patch, IC/RC from the solved motion, steer axis
from ±1 mm rack). Arm points (spring seat on an arm, wishbone drawing) per 03 §4.1; link fraction points per 03 §4.3.

7.2.3 Ride model (02-03):
```ts
// ride/ride7dof.ts — corner order fl, fr, rl, rr; vehicle frame; SI
export interface RideCornerParams {
  readonly x: number; readonly y: number;             // contact-point position in vehicle frame
  readonly unsprungMass: number;
  readonly wheelRate: number;                         // N/m at the wheel
  readonly damping: { readonly bump: number; readonly rebound: number };   // N*s/m at the wheel
  readonly friction: number;                          // N Coulomb at the wheel (tanh-regularised, v0 = 0.02 m/s)
  readonly tyreRate: number; readonly tyreDamping: number;
  readonly bump: number; readonly droop: number;      // stop positions (m) ; stop rate 10 x wheelRate, progressive
}
export interface RideParams {
  readonly sprungMass: number; readonly cgHeight: number;
  readonly inertiaRoll: number; readonly inertiaPitch: number;
  readonly corners: readonly [RideCornerParams, RideCornerParams, RideCornerParams, RideCornerParams];
  readonly arbRate: { readonly front: number; readonly rear: number };   // N/m equivalent at the wheel per side difference
}
export interface RideInput {
  ax: number; ay: number;                             // low-passed path accelerations
  readonly road: Float64Array; readonly roadRate: Float64Array;          // per corner, m and m/s
  rcHeight: { front: number; rear: number };           // from kinematics tables at current travel
  antiPitch: { front: number; rear: number };
}
export interface RideState {
  heave: number; roll: number; pitch: number; heaveRate: number; rollRate: number; pitchRate: number;
  readonly travel: Float64Array; readonly travelRate: Float64Array; readonly load: Float64Array;
  readonly springForce: Float64Array; readonly damperForce: Float64Array; readonly stop: Float64Array;
}
export interface RideModel { readonly state: RideState; reset(input: RideInput): void; step(dt: number, input: RideInput): void; }
export function createRideModel(params: RideParams): RideModel;
// ride/tyre.ts
export function gripUse(load: number, fy: number, fx: number, camberToRoad: number, tyre: TyreParams): number;
```
Equations: research 05 §2–§4 (corrected small-angle form), geometric load transfer as force inputs per 05 §3.1
(force-input form) with the active `rcHeight`, longitudinal per 05 §3.2 with `antiPitch`; semi-implicit Euler;
tyre force clamped ≥ 0. Grip: simplified Magic Formula 05 §7.1, axle lateral force `m·ay·b/L` (front) and
`m·ay·a/L` (rear) split by load, camber effect `alpha_eff = alpha + 0.2·gamma`, peak μ reduced by
`0.02/deg` beyond 3° of |camber to road| (model; label "model" in UI).

7.2.4 Vehicle model seam (02-04 defines it; 05-01 implements the motorcycle side):
```ts
// sim-core/vehicle-models.ts
export interface VehicleModel {
  readonly corners: readonly CornerLayout[];          // from contracts/telemetry.ts
  readonly kinematics: VehicleKinematics;
  /** Static equilibrium at a path state. */
  reset(path: PathState): void;
  /** One fixed step; `path` is the state at the END of the step. Push events into `events`. */
  step(dt: number, path: PathState, events: SimEvent[]): void;
  /** Interpolated write of TRUE + POSE fields into `out` (no allocation). */
  sample(alpha: number, amplification: number, path: PathState, out: TelemetryFrame): void;
  restPose(corner: number, path: PathState, out: Float64Array): Float64Array;
  /** Swap geometry tables + extras; ride state (heave, roll, pitch, hops) is kept. Throws on class mismatch. */
  setSuspension(suspension: SuspensionDefinition): void;
}
export type CreateVehicleModel = (vehicle: VehicleDefinition, suspension: SuspensionDefinition, track: BuiltTrack) => VehicleModel;
export const VEHICLE_MODELS: Record<VehicleClass, CreateVehicleModel>;   // { car: createCarModel, motorcycle: createMotoModel }
```
`simulation.ts` owns time, the speed profile, path interpolation, the frame object and event queue; models own
dynamics and kinematics. Suspension geometry tables are solved once per (vehicle, suspension) and cached for the session.

### 7.3 Kinematic regression references (KIN-01) — from research 03 §5 (Chrono BSD-3 data, our prototype)
Fixtures `tests/fixtures/02-02-chrono-*.ts` hold the raw Chrono point sets (left side, Chrono origin, constraint
lists as in 03 §1/§2). Tolerances: angles ±0.03°, lengths ±1 mm, RC ±2 mm.

| Set | Checks |
|---|---|
| Sedan double wishbone, R = 0.3266 | camber +0.80° @−50 mm, +0.44° @−25, −0.52° @+25, −1.13° @+50; toe +2.28° @−50, −1.37° @+50; RC 162 mm; KPI 10.0°; caster 5.3°; scrub +5.26 mm; trail +10.93 mm (solver screw axis; the ball-joint line gives +5.6 / +11.9) |
| Generic MacPherson, R = 0.40 | camber −0.55° @+50, +0.89° @−50; toe −1.78° @+50, +1.54° @−50; RC 126 mm; KPI 11.9°; caster 6.6°; scrub +103.0 mm; trail +41.9 mm |
| Sedan 5-link, R = 0.3266 | camber −0.84° @+25, −1.85° @+50, +1.20° @−50; bump steer +0.02°/10 mm (±0.01); RC 39 mm |
| opensus DW sample (expected values only) | camber gain −0.317°/10 mm; RC 89.9 mm; KPI = caster = 5.19°; scrub 39.1 mm; bump steer 0.000 |
Plus property tests: no NaN over the full travel × rack grid for every definition; left/right mirror symmetry;
residual < 1e-9 at every grid node; continuity (no jump > 2 mm between neighbouring nodes).
Scrub/trail note (02-02): research 03's prototype found the steer-axis point with an ill-conditioned solve, so its
scrub/trail digits were noise; the values above are the solver's analytic screw axis, as asserted in
`tests/sim-core/kinematics-reference.test.ts`. For the shipped GT definitions (not regression references) the current
values after 02-05 are front scrub MP 26.0 / DW 21.8 / ML 12.9 mm and trail 15.5 / 17.0 / 33.6 mm.

### 7.4 Tuning gates for the shipped car definitions (KIN-03; asserted in `tests/sim-core/kinematics-gates.test.ts`)
Seeds: DW = Chrono Sedan_DoubleWishbone, MacPherson = Chrono generic MacPhersonStrut, multi-link = Chrono
Sedan_MultiLink; y scaled about the centreline so the contact patch half-track equals the vehicle track/2 (±1 mm);
z shifted so wheel centre = tyre radius; static camber −1.5° front / −1.2° rear, toe 0 front / +0.1° rear; then
tie-rod (front) / toe-link (rear) points adjusted by 1-D search until bump steer meets the gate. Front axle gates
(design point, symmetric travel):

| Metric | MacPherson | Double wishbone | Multi-link |
|---|---|---|---|
| Roll-centre height | 90–130 mm | 50–100 mm | 30–75 mm |
| Camber gain in bump | −0.10 … −0.25 °/10 mm | −0.30 … −0.60 °/10 mm | −0.20 … −0.45 °/10 mm |
| |Bump steer| | ≤ 0.08 °/10 mm | ≤ 0.05 °/10 mm | ≤ 0.05 °/10 mm |
| Scrub radius | 0–30 mm | 0–30 mm | 0–30 mm |
| KPI | 8–14° | 4–10° | 4–12° |
| Caster | 3–8° | 3–8° | 3–8° |
Required orderings (the honest signature): RC height MP > DW > ML; |camber gain| DW > ML > MP; roll camber to road
(camber lost per degree of roll) MP > ML > DW. Rear axle: same topology, no steering, |bump steer| ≤ 0.05 °/10 mm,
RC 30–130 mm. Travel: bump 70 mm, droop 70 mm. The test prints the full metric table (this is the
"kinematics report"; copy it into the 02-02 SUMMARY).

### 7.5 Content values
**GT coupe (`gt-coupe.ts`, 02-04)** — representative parameters (research 05 §8 adapted; never presented as data):
mass 1700 kg, sprungMass 1540, cgHeight 0.50, inertia roll 550 / pitch 2500 / yaw 2800 kg·m², cgToFront = 0.49 ×
wheelbase, limits lateral 8.3 m/s², accel 5.0, brake 8.5, vMax 36 m/s, dragArea 0.65 m², maxSteer 0.35 rad.
Front: unsprung 40 kg, ride 1.45 Hz, damping bump 0.32 / rebound 0.58, tyre width 0.255, kt 260 kN/m, ct 400,
μ 1.10, loadSensitivity −5e-5 /N, nominal 4200 N, steered, brakeShare 0.62. Rear: unsprung 43 kg, ride 1.60 Hz,
same damping, width 0.295, kt 280 kN/m, driven, brakeShare 0.38. ARB stiffnesses tuned so the double-wishbone car
shows a steady-state roll gradient of 1.0–1.2 °/g (test). **Wheelbase, track (front/rear) and tyre radius are
measured from the GLB** by `tests/sim-core/db11-fit.test.ts` (reads `assets-src/car/aston-martin-db11.glb` with
@gltf-transform/core, wheel node world positions; research 06 reports ≈ 2.92 m wheelbase, wheel-centre height
≈ 0.376 m) and must match the definition within 5 mm.
Suspension extras (research 04 §12): MacPherson friction 60 N, unsprung delta −2 kg; DW 15 N, 0; multi-link 20 N, 0.

**Proving loop (`proving-loop.ts`, 02-01)** — research 11 §C layout, clockwise, start line at s = 0 heading +X,
width 9 m, kerb 1.5 m, runoff 12 m, swell 1.5 m × 1 cycle, seed 42. Right turns have negative angles.

| # | id | Geometry | Bank | ISO | Features / line | Phenomenon | targetSpeed |
|---|---|---|---|---|---|---|---|
| 1 | launch | line 100 | 0 | C | washboard s0 len 80, A 12 mm, λ 3.0→0.9 m | ride-resonance | — |
| 2 | brake-zone | line 80 | 0 | A | — | brake-dive | — |
| 3 | hairpin | clo 15 → arc R20 → clo 15, net −180° | 0 | B | — | steering-lock | 9.7 |
| 4 | bump-strip | line 150 | 0 | B | cosine-bump s40 len 0.8 h 50 mm on left wheel path; pothole s70 on right wheel path r 0.3 d 60 mm; kerb-strike s100 len 12 h 60 mm right, line clips it | single-wheel-bump | 22 |
| 5 | sweeper | clo 30 → arc R120 → clo 30, net +90° | −3° (into) | B | — | sustained-roll | 26.7 |
| 6 | pave | line 100 | 0 | D | pave s0 len 45 stone 0.12 A 8 mm joints 5 mm; humps s55 ×3 spacing 16 len 3.7 h 80 mm | harshness | 12.5 |
| 7 | chicane | R38 arcs with 8 m clothoids, net −30°, +60°, −30° | 0 | B | — | roll-reversal | 15.3 |
| 8 | crest | line 60 | 0 | B | crest then dip, vertical radius ≥ 120 m at target speed (test |a_z| ≤ 0.6 g) | heave | 19.4 |
| 9 | carousel | clo 20 → arc R45 → clo 20, net −180° | +8° (into) | B | — | steady-state-roll | — |
| 10 | dlc | line (closure-solved, ≈ 326) | 0 | A | line knots ISO 3888-1 (15/30/25/25/15/15 m, offset +3.5 m) after 100 m run-up; cones at gate edges | lane-change | 22.2 |
| 11 | off-camber | clo 25 → arc R70 → clo 25, net −90° | −5° (away) | C | — | off-camber | 18 |
| 12 | run-in | line (closure-solved, ≈ 110) | 0 | C | — | settle | — |
Gates (02-01 tests): closure < 1 mm and < 1e-6 rad; solved lengths > 50 m; total 1.3–1.7 km; min clearance
between non-adjacent sections ≥ 30 m; curvature continuous at clothoid joints; captions/names contain no digits.

### 7.6 Simulation pipeline (02-04)
`step(SIM_DT)`: (1) advance lap time; `profile.stateAt` → path state (pure); (2) low-pass ax/ay (1st order, 8 Hz)
for the body; (3) steering: car = Ackermann from driving-line curvature, rack = `table.rackForSteer`; (4) per
corner road height and rate at the contact point (3-point tyre envelope along x: −0.1/0/+0.1 m, mean) from
`track.roadHeight(s_i, l_i)` minus the local road plane (so ride sees only deviations); (5) RC heights from
`table.rollCentreHeight(travel_L, travel_R)`; (6) `ride.step`; (7) events: section change, lap, bump-stop entry
(`stop > 0.5`), lift-off (`load < 50 N`), grip limit (`gripUse > 1`), each with 0.5 s per-corner hysteresis.
`sample(alpha, amp)`: interpolate path + ride state between previous and current step (lerp, angles via wrap);
POSE: body roll/pitch/heave and wheel travel × amp (travel clamped to the table range); evaluate tables at the
posed travel/rack; compose body transform (path frame · bank · grade · heave/pitch/roll) and write world points,
wheel poses, contact patches, IC, RC; TRUE fields from the unamplified state. No allocation: the no-alloc test runs 10,000 steps + 1,000 samples,
asserts every frame/state object is identity-stable, and checks the heap delta (`node --expose-gc`, vitest
`poolOptions.forks.execArgv`) stays < 64 KB.
`seek(t)`: path from stateAt(t − SEEK_SETTLE_S), ride `reset` (static equilibrium), then step to t.
`setVehicle`: new model + new frame (`createTelemetryFrame`), keeps `lapTime / lapDuration` fraction.
`stateAt`: delegates to the profile; identical across suspension types (test).

### 7.7 Motorcycle (05-01)
Planar kit (`moto/planar.ts`): prismatic fork along the steering axis (`u = (−sin ε, cos ε)`), Telelever arm pivot,
swingarm pivot, 4-bar rocker (circle–circle, branch continuity) — research 08 §4.1–4.3; LUT over travel: wheel
centre, spring length, motion ratio, trail, wheelbase change, anti-dive/anti-squat (08 §4.4, generalised AD).
Ride (`moto/ride4dof.ts`): 08 §5.4 clean form (heave, pitch, front/rear hop) with `Fz = (Fs − Fx·vx)/vz` coupling,
fork stiction `tanh` model, dual-rate / progressive springs, `g_eff = sqrt(g² + (v²κ)²)`.
Lean (`moto/lean.ts`): `γ = atan(v²κ/g)`, frame lean `φ = γ + asin((ρ/H) sin γ)`, 2nd-order tracker (ζ 0.9,
ω 6 rad/s), steer from the inverse roll balance (08 §5.2), clamp ±20°, low-speed blend.
Required tests: braking 0.6 g → telescopic fork compresses MORE than pure load transfer predicts (pro-dive, AD < 0)
and Telelever LESS (AD > 0); linkage MR rises with travel (rising rate); static sag 25–40 % of travel; bounce
2.0–2.8 Hz; lean at 0.8 g within 1° of the closed form. Frame `roll` carries the lean; corners are `f`, `r`;
`pointOrder` names per kind: telescopic `['steeringHead','crownTop','forkBottom','axle','contactPatch']`,
telelever `[... ,'armPivot','armJoint','shockTop','shockArm']`, swingarm `['pivot','axle','shockTop','shockLower','contactPatch']`,
linkage `['pivot','axle','rockerPivot','swingarmLink','rockerLink','rockerShock','shockTop','contactPatch']`.

## 8. URL flags (`kernel/flags.ts`)

| Param | Values | Effect |
|---|---|---|
| `features` | `-id,+id,…` | force features off/on (unknown ids warn) |
| `vehicle` | vehicle id | initial vehicle |
| `suspension` | suspension id | initial suspension (validated against vehicle) |
| `view` | follow · explore · closeup | initial view |
| `quality` | low · medium · high | quality tier; disables auto tier downgrade |
| `t` | seconds | start at lap time; forces `clock=local` |
| `paused` | 1 | start paused; forces `clock=local` |
| `amp` | 1 · 2.5 | display amplification |
| `clock` | live · local | lap clock source |
| `attract` | 0 · 1 | force attract off / start in attract |
| `room` | 5-char code | join a private room (else `LIVE`) |
| `screen` | 1 | this device is the presenter's big screen |
| `debug` | 1 | `debug` feature on; `window.__app` hooks |
| `e2e` | 1 | deterministic test mode (§6.6) |
Remote page (`/remote.html`): `?room=CODE` + fragment `#k=HOSTKEY` (host) or no fragment (audience).

## 9. Features, registration and file ownership

### 9.1 The registration file (`src/app/features.ts`, created ONCE by 01-01, verbatim)
```ts
// THE feature registration file (ARCHITECTURE.md §9). One line per feature, alphabetical.
// Adding a feature = create src/features/<id>/index.ts + add one line here. Removing = delete the line.
export { default as analytics } from '../features/analytics/index';
export { default as attract } from '../features/attract/index';
export { default as audio } from '../features/audio/index';
export { default as camera } from '../features/camera/index';
export { default as car } from '../features/car/index';
export { default as controls } from '../features/controls/index';
export { default as credits } from '../features/credits/index';
export { default as debug } from '../features/debug/index';
export { default as engineer } from '../features/engineer/index';
export { default as environment } from '../features/environment/index';
export { default as insights } from '../features/insights/index';
export { default as linkageParts } from '../features/linkage-parts/index';
export { default as liveLab } from '../features/live-lab/index';
export { default as motorcycle } from '../features/motorcycle/index';
export { default as poll } from '../features/poll/index';
export { default as presenter } from '../features/presenter/index';
export { default as renderer } from '../features/renderer/index';
export { default as teachingOverlays } from '../features/teaching-overlays/index';
export { default as telemetryPanel } from '../features/telemetry-panel/index';
export { default as track } from '../features/track/index';
export { default as vehicleView } from '../features/vehicle-view/index';
```
Every line points at a stub created by 01-01 (template below), so the file never changes when features are built.
Who edits it later: nobody, unless a NEW feature outside this catalogue is added; then the plan creating it adds
its one line, and the phase planner guarantees no other plan in that wave lists `src/app/features.ts`.
```ts
// stub template: src/features/<id>/index.ts  (plan 01-01)
import type { FeatureModule } from '../../contracts/app';
/** STUB — owner: plan <NN-MM>. Keep id/requires/phase/defaultEnabled; replace the body. */
export default { id: '<id>', requires: [/* from §9.2 */], phase: '<phase>' } satisfies FeatureModule;
```

### 9.2 Feature catalogue
| id | phase | requires | provides / contributes | consumes | default | owner plans |
|---|---|---|---|---|---|---|
| renderer | render | — | service RENDER; WebGL, scene, camera object, post stack, CSS2D layer, quality governor | store.quality | on | 01-04, 03-02, 07-01 |
| environment | scene | renderer | — (HDRI IBL/background per view, sun + shadow following car, contact shadow, fog) | RENDER, store.view/quality | on | 03-02 |
| track | scene | renderer | contributes track `proving-loop`; ribbon/kerbs/markings/terrain/cones mesh | RENDER, sim.current.track | on | 02-04 (contribute), 03-01 |
| car | — | — | contributes vehicle `gt-coupe`, suspensions `macpherson`/`double-wishbone`/`multilink`, vehicle visual `db11` | assets | on | 02-04 (contribute), 03-03 (visual) |
| linkage-parts | — | — | contributes suspension visual `spatial-linkage` (procedural parts) | — | on | 03-04 |
| vehicle-view | scene | renderer | — (on load/sim:vehicle: loads the vehicle visual and PRE-BUILDS hidden suspension visuals for every suspension of that vehicle, compiles them; sim:suspension toggles visibility; updates the visible ones; x-ray fade; highlight routing) | RENDER, registries, store.xray/view, `highlight` | on | 03-03 |
| camera | camera | renderer | service CAMERA (follow/explore/closeup, director shots, blends, shake) | RENDER, store.view/focusCorner, `camera:focus` | on | 04-01 |
| attract | overlay | camera | — (idle timer, 60 s storyboard, captions) | CAMERA, store, `user:activity` | on | 04-01 |
| controls | overlay | — | — (loading overlay, vehicle tag, suspension + view segmented controls, vehicle toggle, fullscreen, keyboard, amplification chip, pause/slow-mo/Live chip, help) | store, registries, `sim:*` | on | 04-02 |
| credits | overlay | — | — (credits panel from manifest attributions + code credits) | assets.manifest | on | 04-02 |
| telemetry-panel | overlay | — | — (g-g, corner gauges, sparkline + ghost) | frame | on | 04-03 |
| insights | overlay | — | — (event captions, delta chip, tradeoff bars, aria-live) | frame, sim.kinematics(), `sim:event` | on | 04-03 |
| teaching-overlays | scene | renderer | — (RC/IC construction lines, ghost rest pose, load arrows + contact patches, camber trace, part labels) | RENDER, frame, sim.restPose/kinematics, store.overlay | on | 04-04 |
| motorcycle | — | — | contributes vehicle `cafe-racer`, 3 presets, vehicle visual `cafe-racer`, suspension visual `moto-planar` | assets | on | 05-02, 05-03 |
| live-lab | overlay | — | service ROOM (socket, time sync, presence chip, distribution bar) | clock, store | on | 06-01 |
| engineer | overlay | — | — (Race Engineer panel, request builder, action dispatcher) | frame, store, bus | on | 06-02 |
| analytics | — | — | — (anonymous events) | store | on | 06-03 |
| presenter | overlay | live-lab | — (screen: room code + QR, applies ctl/cues) | ROOM, CAMERA (optional) | on | 06-04 |
| poll | overlay | live-lab | — (screen poll bars; viewer vote chip) | ROOM | on | 06-04 |
| audio | scene | — | — (engine loop pitch by speed, impact on bump-stop) — STRETCH | assets, frame | off until 07-03 | 07-03 |
| debug | overlay | renderer | — (stats-gl, feature list) | RENDER | off (`?debug=1`) | 01-04, 07-01 |

### 9.3 File ownership rules
1. A plan may create/edit only files listed in its `files_modified`, which must be inside the globs ROADMAP.md
   assigns to it. Within a wave, `files_modified` sets are disjoint (orchestrator re-checks; overlap ⇒ sequential).
2. A feature folder `src/features/<id>/**` is owned whole by one plan per wave. Internal file layout is free.
3. Frozen after 01-01 (R4 to change): `src/contracts/**`, `src/app/features.ts`, `package.json`/lockfile,
   `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `wrangler.jsonc`,
   `worker-configuration.d.ts`, `worker/index.ts`, `.dependency-cruiser.cjs`.
4. Tests: a plan owns the test files it creates (names in §3). Fixtures are prefixed with the plan id.
5. `CREDITS.md`, `public/_headers`, `index.html`, `scripts/build-assets.mjs`, `src/ui/**`, `src/kit3d/**` change only
   in the plans listed in §3/ROADMAP.md (`src/kit3d/**` after 03-04: additive files only, by the owning plan of a later wave).
6. A plan that needs a contract change, a new dependency or another plan's file stops (R4) and reports.

### 9.4 Dependencies
Plan 01-01 installs EVERY runtime and dev dependency in §1 up front (including those first used in later phases:
camera-controls, postprocessing, n8ao, partysocket, uqr, zod, stats-gl, gltf-transform, meshoptimizer), so no later
plan edits `package.json`. `npx playwright install chromium` runs in 01-01 (network needed; see risks).

## 10. Quality tiers and adaptive governor (renderer)
Presets are `QUALITY_PRESETS` in `contracts/app.ts`. Start tier: `?quality=` › `(pointer: coarse)` → `low` ›
`high`. Governor (off in e2e and when `?quality=` is given): frame-time EMA over 60 frames; if > 18.5 ms for 2 s
→ pixel ratio −0.1 (≥ min); if < 14 ms for 5 s → +0.05 (≤ max); if at min for 5 s → store.quality one tier down
(once per session, logged). Features react to `store.quality` (environment: shadow size; renderer: AO/bloom/SMAA;
track: anisotropy). The ribbon resolution is chosen at build time from the tier active at boot.

## 11. Asset pipeline (`scripts/build-assets.mjs`, run by `npm run build` and `npm run assets`)
1. Clean `public/assets/` and `public/asset-manifest.json`.
2. Walk `assets-src/**` (excluding `ATTRIBUTION.json`). Every file must be covered by an entry in
   `assets-src/ATTRIBUTION.json` (`Attribution[]`, `files` = paths relative to assets-src); otherwise FAIL.
   A file whose source/licence cannot be verified is deleted from assets-src by the plan, not shipped.
3. Logical id = path relative to `assets-src` without extension (e.g. `car/aston-martin-db11`,
   `hdri/derelict_airfield_01_1k`, `textures/asphalt_track/asphalt_track_diff_1k`, `audio/engine`).
4. `.glb`: glTF-Transform NodeIO (+ALL_EXTENSIONS, MeshoptDecoder/Encoder): `dedup()`, `prune({ keepLeaves: true })`,
   write with EXT_meshopt_compression. FORBIDDEN on vehicles: flatten, join, palette, simplify, instance, weld,
   `prune` with keepLeaves false (they merge/delete named wheel and pivot nodes; research 20 §A1). CLI equivalent
   for manual work: `gltf-transform optimize in.glb out.glb --flatten false --join false --palette false
   --simplify false --prune false --instance false --compress meshopt --texture-compress false`.
   After writing, re-read and assert 4 nodes each matching `/wheel/i`, `/caliper/i`, `/brakedisc/i` exist, and
   run `validate` (no errors).
5. Other files (`.hdr`, `.jpg`, `.ogg`) are copied unchanged (v1: no KTX2; `toktx` is not installed).
6. Output name `<dir>/<basename>.<sha256-8>.<ext>`; manifest entry `{ id, url: '/assets/…', bytes }`; manifest also
   embeds the attributions. FAIL if any file > 24 MiB; WARN if the initial set (car + track HDRI + asphalt maps)
   exceeds 12 MB.
7. Runtime: `ctx.assets.url(id)`. GLTFLoader with `setMeshoptDecoder(MeshoptDecoder)` from
   `three/addons/libs/meshopt_decoder.module.js` (bundled; no decoder files in /public).

## 12. Worker, bindings and protocols

### 12.1 `wrangler.jsonc` (verbatim, 01-01)
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "suspension-lab",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-11-20",
  "upload_source_maps": true,
  "workers_dev": true,
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws/*", "/r/*"]
  },
  "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }],
  "ai": { "binding": "AI" },
  "analytics_engine_datasets": [{ "binding": "STATS", "dataset": "suspension_lab_events" }],
  "ratelimits": [
    { "name": "RL_ENGINEER", "namespace_id": "4101", "simple": { "limit": 6, "period": 60 } },
    { "name": "RL_ROOMS", "namespace_id": "4102", "simple": { "limit": 10, "period": 60 } }
  ],
  "vars": { "APP_VERSION": "dev" },
  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```
If the first deploy rejects a binding (e.g. Rate Limiting on this plan), 01-04 removes ONLY that block, records it in
STATE.md, and the dependent plan uses its documented fallback (in-DO/in-memory token bucket).

### 12.2 `worker/index.ts` (verbatim, 01-01; route modules are stubs until their owner replaces them)
```ts
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import engineer from './routes/engineer';
import event from './routes/event';
import health from './routes/health';
import rooms from './routes/rooms';
import time from './routes/time';

export { Room } from './room';

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', secureHeaders());
app.route('/', health);
app.route('/', time);
app.route('/', rooms);
app.route('/', engineer);
app.route('/', event);
app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default app;
```
Route module shape: `const r = new Hono<{ Bindings: Env }>(); r.get(API.health, …); export default r;`
Stub body: `r.all('/api/rooms', (c) => c.json({ error: 'not_implemented' }, 501))` (paths per module below).
`worker/room.ts` stub: `export class Room extends DurableObject<Env> { override async fetch() { return new Response('not implemented', { status: 501 }); } }`.

### 12.3 Routes
| Method + path | Module | Behaviour |
|---|---|---|
| GET /api/health | health.ts | `HealthResponse` (`version` = `env.APP_VERSION`), no-store |
| GET /api/time | time.ts | `TimeResponse`, `Cache-Control: no-store`, stamped right before return |
| POST /api/rooms | rooms.ts | RL_ROOMS by IP; code from alphabet (retry ×3 if taken); `ROOM.getByName(code).init(hostKey)`; `CreateRoomResponse` |
| GET /ws/:code | rooms.ts | code must match `^[A-Z2-9]{5}$` or equal `LIVE`; requires `Upgrade: websocket` (426); forwards to the DO |
| GET /r/:code | rooms.ts | 302 → `/remote.html?room=CODE` |
| POST /api/engineer | engineer.ts | §12.5 |
| POST /api/event | event.ts | zod-validate `AnalyticsEvent` → `STATS.writeDataPoint({ blobs:[type, a, b], doubles:[n], indexes:[type] })` → 204; drop silently if the binding is missing |

### 12.4 Room Durable Object (06-01) — behaviour
Hibernation API (`ctx.acceptWebSocket`, `serializeAttachment` `{id, role, vehicleId, suspensionId}` < 2 KB),
`setWebSocketAutoResponse("ping"→"pong")`. Upgrade query: `id` (client uuid, ≤ 36 chars), `role`, `k` (host key),
`v`, `s`, `pv` (must equal PROTOCOL_VERSION else close 4400). `role=host` requires a timing-safe match with the
stored host key (room `LIVE` has none → 4401). On accept: send `welcome`. Messages: per-socket token bucket
(5/s, burst 10; over → drop, repeated → close 1008); > 1024 bytes → close 1009; unparsable → `err bad-message`.
`sync` → reply `{t:'sync', c0, s1: Date.now()}`; `pick` → update attachment, schedule presence flush;
`ctl`/`cue`/`poll` from non-host → `err forbidden`; `ctl` merges into persisted `PresenterState` (`seq+1`,
`storage.put('ctl')`), broadcast `ctl`; `cue` broadcast with seq; `poll` creates `PollState` (`id` random, open) or
closes it; `vote` → SQLite `votes(poll_id, voter_id, choice, PRIMARY KEY(poll_id, voter_id))` `INSERT OR REPLACE`.
Presence `{viewers, dist}` is recomputed from `ctx.getWebSockets()` attachments (excluding host) and broadcast
coalesced ≤ 1 Hz; poll tally ≤ 2 Hz; timers only while dirty. Alarm: 12 h after creation/last activity → `deleteAll`.
All reducers live in `room-logic.ts` (pure, unit-tested); `room.ts` is I/O glue.
Client (`live-lab`): partysocket reconnect (0.5–8 s, ×1.5), heartbeat `"ping"` every 25 s, time sync = 8 probes at
join then every 30 s and on visibility (min-RTT of the 3 best of the last 16, first fix jumps, later slew ≤ 5 ms per
sample → `clock.setOffset`). Before the socket opens, one `GET /api/time` burst of 5 gives a first fix.
Offline / `e2e`: ROOM service still provided with `connected: false`; nothing breaks.

### 12.5 AI Race Engineer (06-02)
1. Validate `EngineerRequest` (zod; limits in `NET_LIMITS`), else 400. Rate limit `RL_ENGINEER` keyed by
   `x-client-id` header (anonymous uuid) or IP → 429 `{error:'busy'}`.
2. Prompt (`engineer/prompt.ts`): rules (1–3 plain sentences; explain WHY; quote only numbers in TELEMETRY; use a
   tool to SHOW; at most 2 tools; never invent specs, brands, lap times; steer off-topic back), FACTS = `common` +
   the active suspension's card (`engineer/facts.ts`, curated from research 04 §1–§11, tendencies only, no numbers),
   TELEMETRY = the JSON payload.
3. `env.AI.run(ENGINEER_MODEL, { messages, tools: buildEngineerTools({ suspensions, sections }), max_tokens:
   ENGINEER_MAX_OUTPUT_TOKENS, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } })`,
   non-streaming, 8 s timeout; on error/timeout once with ENGINEER_FALLBACK_MODEL. Suspension/section enums come
   from sim-core content (`moto-*` ids when `vehicle_class` is motorcycle).
4. `engineer/model.ts` normalises the response shape (Workers AI `{response, tool_calls}` or OpenAI-style
   `choices[0].message`), recorded from a real call into `tests/fixtures/06-02-ai-response*.json` in task 1.
5. Validate each tool call against the `EngineerAction` union (zod), drop invalid, keep ≤ 2.
6. `engineer/numbers.ts`: every number in the text must equal some number in the telemetry payload after rounding
   to 0, 1 or 2 decimals (or be within 5 % of it); otherwise → fallback.
7. `engineer/fallback.ts`: rule-based sentence from `event` + section phenomenon + one telemetry value; `source: 'fallback'`.
8. Response `EngineerResponse` JSON, `Cache-Control: no-store`. Client executes actions by writing the store /
   emitting `highlight`, `camera:focus`, `sim:seek-to`.

## 13. Testing strategy

| Command | Runs | Gate |
|---|---|---|
| `npm run typecheck` | `tsc -p tsconfig.app.json && tsc -p tsconfig.worker.json && tsc -p tsconfig.node.json` (all noEmit, strict) | every plan |
| `npm run lint:deps` | dependency-cruiser rules §2 | every plan |
| `npm test` | vitest (node env): `tests/{arch,kernel,sim-core,worker,features}/**/*.test.ts` | every plan |
| `npm run check` | typecheck + lint:deps + test | before every commit of a plan's last task |
| `npm run build` | build-assets + `vite build` (client + worker) | every plan touching src/worker/scripts |
| `npm run e2e` | Playwright against `vite preview` (workerd runs the Worker) | plans with visible output |
| `npm run smoke:live` | `node scripts/smoke-live.mjs https://suspension-lab.zh-a16.workers.dev` | after every deploy |
| `PLAYWRIGHT_BASE_URL=<live> npx playwright test tests/e2e/smoke.spec.ts` | e2e smoke against production | end of every phase |

- **sim-core** (bulk of value): regression tables §7.3, gates §7.4, track gates §7.5, ride checks (static
  deflection, modal frequencies: body 1.2–1.8 Hz, hop 10–15 Hz; steady-state load-transfer sums ±2 %; roll gradient),
  determinism golden (seed 42, 10 s, hash of quantised frames), fixed-step independence, no-allocation, purity.
- **kernel**: topo sort/cycle, cascade disable, init failure isolation, flags parsing, registry, loop accumulator
  with random dts, live-clock slew/seek, disposal baseline. Pure TS with fake dom/raf/sim.
- **worker**: Hono `app.request()` with fake bindings for health/time/rooms/engineer/event; `room-logic.ts`
  reducers; `numbers.ts`; zod schemas type-tested (`expectTypeOf<z.infer<…>>().toEqualTypeOf<Contract>()`).
- **features**: pure helpers only (formatters, insight rules, shot scheduler, governor) with plain objects; every
  P4+ feature has a test feeding a 2-corner (motorcycle) frame.
- **e2e** (Chromium `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`): boot
  `/?e2e=1` → `__app.ready` within 20 s, zero `__app.errors`, zero console errors, canvas non-blank (pixel variance);
  per plan: deterministic frames via `?e2e=1&paused=1&t=<s>` + `__app.advance()`; `?features=-<id>` matrix (07-04).
  Screenshots are evidence attached to SUMMARY, compared loosely (`maxDiffPixelRatio: 0.03`) only where a plan says so.
- **Live**: `smoke-live.mjs` checks `/` 200 + HTML contains `#stage`, `/api/health` ok + version, `/api/time`
  within 5 s of local clock, `/asset-manifest.json` 200, first manifest asset 200 with `immutable`.

## 14. Honesty rules (binding)
1. Every number shown in the UI, captions, chips, labels or AI context is read from the `TelemetryFrame` or
   `sim.kinematics()` at runtime. Content copy (`SuspensionCopy`, track names/captions, insight templates) contains
   no digits (`tests/arch/content-copy.test.ts`), except the template placeholders filled from telemetry.
2. Amplification: one global factor (`store.amplification`, 1 or 2.5) applied only to POSE fields inside
   `sim.sample()`; while ≠ 1 a persistent chip reads "Motion ×2.5 · values true scale"; key A / tap returns to ×1.
   Never amplify link lengths (kinematic closure stays exact because posing re-solves from the table).
3. Model outputs that are estimates (grip use) are labelled "model" where shown.
4. Vehicles are generic ("GT coupe", "Cafe racer"), subtitle "Representative parameters"; badges hidden; credits
   state that the DB11 mesh is used for its shape only and no manufacturer data is implied.
5. Research numbers tagged [E]/[U] are parameters, never displayed as facts. Tradeoff bars use computed metrics
   (camber gain, roll camber, bump steer, RC migration) and qualitative tendencies (words, no scores).
6. AI: grounded fact cards, telemetry-only numbers, server-side number check, fallback labelled.
7. Insights state tendencies ("typically") for anything not computed.

## 15. Credits and attribution
Single source for assets: `assets-src/ATTRIBUTION.json` → manifest → `credits` panel. Code/data credits are a
constant in `src/features/credits/code-credits.ts` (Project Chrono hardpoint data BSD-3-Clause with full notice;
three.js MIT; camera-controls MIT; postprocessing Zlib; n8ao ISC; nanostores/mitt/hono/zod/partysocket MIT;
Geist OFL-1.1; AxleLab MIT if any helper is adapted — then its copyright line goes in the file header too).
DB11 text (exact): `"Aston Martin db11" by Black Snow (https://sketchfab.com/BlackSnow02) is licensed under
CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7.
Modified: optimised/compressed (meshopt), decimated, re-materialed, badges hidden.` Poly Haven HDRIs/textures
CC0 (credit anyway), Kenney audio CC0. `CREDITS.md` mirrors the panel; 07-04 audits both against the manifest.
The credits panel is reachable in ≤ 2 interactions from any state (credits button in the HUD corner, key `?`).

## 16. Naming
- Files/folders kebab-case; feature id = folder name; content ids kebab-case; exports camelCase (`gtCoupe`).
- Types/interfaces PascalCase; constants UPPER_SNAKE; functions camelCase; booleans `is/has` only when ambiguous.
- Event names `area:verb` (contracts/events.ts only). Service keys UPPER_SNAKE in contracts/services.ts.
- SI variables carry no suffix; any non-SI variable carries one (`camberDeg`, `travelMm`, `speedKmh`).
- CSS: classes `sl-<feature>-<element>`; tokens from `src/ui/tokens.css` only; no inline colours.
- Tests: `tests/<area>/<subject>.test.ts`; e2e `tests/e2e/<plan-id>-<topic>.spec.ts`.
- Commits (GSD): `{type}({phase}-{plan}): {task}`; one commit per task.

## 17. Deploy
- Credentials: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` from the environment (never written to files).
  `CI=1 WRANGLER_SEND_METRICS=false`.
- `npm run deploy` = `npm run build && wrangler deploy --var APP_VERSION:$(git rev-parse --short HEAD)`.
- Live: https://suspension-lab.zh-a16.workers.dev — every phase's last plan deploys and runs `npm run smoke:live`
  plus the production e2e smoke; results go in the plan SUMMARY.
- Never deploy from a red `npm run check`. Rollback: `npx wrangler rollback`.
- Version skew: `vite:preloadError` → reload once (index.html inline-free handler in `src/app/main.ts`).

## 18. Performance budgets
Draw calls ≤ 250 (car + suspension ≤ 90, track ≤ 30, props instanced); triangles ≤ 1.5 M; textures ≤ 64 MB VRAM;
one directional shadow (≤ 2048, follows the car, texel-snapped); N8AO half-res only at `high`; one combined
effect pass; no per-frame allocation in sim-core or feature `update()`; telemetry UI draws at ≤ 30 Hz; DOM writes
batched in the overlay phase; `renderer.compileAsync` behind the loading overlay for every vehicle/suspension
visual and x-ray material; initial payload ≤ 12 MB.

## 19. Ponytail rules for executors (verbatim core, research 01 §2.1) + project caveats
```
You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.
Before you write: read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. That is scope. Extra features are not.
The smallest complete change (take the first option that fully works): 1. Does it need to exist? 2. Already in this codebase? 3. Standard library or platform feature? 4. An installed dependency? 5. One line a reader gets at a glance? 6. Otherwise: the minimum code that works.
- Be lazy about the solution, never about the change itself: finish every part the task needs, including callers, tests and fixtures.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep the structure the codebase already has.
- Comment only the why the code cannot show, in one line.
- Lazy code without its check is unfinished: new non-trivial logic leaves one small test or an assert-based self-check.
- A shortcut with a known limit gets a code comment: `shortcut: <the limit>, <when to upgrade>`.
Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.
```
Project caveats: the module boundaries in §2/§9 are required structure, not speculative abstraction. In the
kinematics solver, ride model and track builder, correctness on edge cases and the tests in §7 win over line count.
Visual polish that the plan asks for (premium look) is "what the user asked for".
