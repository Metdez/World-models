# 23 - Modular architecture for Suspension Lab (swappable feature modules)

Date: 2026-11-20. Method: GitHub API is blocked here; used Firecrawl scrapes of github.com pages (stars, licence, tree), jsdelivr `cdn.jsdelivr.net/gh/...` for source (works for folio-2019; folio-2025 exceeds jsdelivr's 50MB limit so only its README + tree + Game.js head were read), npm registry for licences/versions. Items marked (unverified) come from memory/docs not opened this session.

## 0. TL;DR

- Do NOT adopt a full ECS or a framework. Use a small **kernel + FeatureModule + registries** design (VS Code "contribution point" idea + Rollup/tapable "hook" idea, ~200 lines you own).
- Split into three layers with a one-way dependency: `sim-core` (pure TS, no three, no DOM) -> `kernel` (loop, bus, store, registries) -> `features/*` (render + UI modules). Features never import each other.
- Variants (suspension types, vehicles, tracks) are **data + strategy registries**: each registers a definition object (`SuspensionDefinition`, ...). Adding motorcycle forks later = new folder + one `register()` line.
- Fixed-timestep (e.g. 240 Hz physics, accumulator) with snapshot interpolation for render; sim publishes immutable `SimSnapshot`; UI subscribes to a throttled telemetry bus.
- Runtime enable/disable of features via URL params (`?features=-xray,+telemetry`) resolved by the kernel before init; hot swap = `dispose()` then `init()`; Vite HMR re-registers modules.

## 1. What the best open-source Three.js apps actually do (verified from source)

### Bruno Simon folio-2019 (4.7k stars, MIT, last push 2024-05) - https://github.com/brunosimon/folio-2019
Verified files: `src/javascript/Application.js`, `World/index.js`, `Utils/EventEmitter.js`, `Utils/Time.js`.
- `Application` constructor news up `Time`, `Sizes`, `Resources`, then calls `setConfig/setDebug/setRenderer/setCamera/setPasses/setWorld/...` in a hard-coded order.
- `World` takes an options bag (`config, debug, resources, time, sizes, camera, scene, renderer, passes`) and its `start()` hard-codes `setMaterials, setShadows, setPhysics, setZones, setObjects, setCar, ... setSections`. Dependencies between parts are by hand (`this.areas.car = this.car`). Sections are imported statically at the top (`IntroSection`, `ProjectsSection` ...; commented-out lines are how he "disables" one).
- `EventEmitter` is a custom namespaced emitter (`on('tick.myns')`, `off`). `Time extends EventEmitter` runs the rAF loop, clamps delta to 60 ms, triggers `'tick'`; everything subscribes to `time.on('tick')`.
- Debug flag via `window.location.hash === '#debug'` (a primitive feature flag).
- Takeaway: dependency-injection by options bag works and is easy to read, but ordering is implicit and "remove feature" means editing the composition root. Not swappable by design.

### Bruno Simon folio-2025 (2.0k stars, MIT per GitHub; repo pushed 2026-11-04) - https://github.com/brunosimon/folio-2025
Verified: tree + README + head of `sources/Game/Game.js`.
- `sources/Game/` is flat with ~55 feature files: `Player, View, Physics/, World/, Weather, Wind, Water, Tracks, Trails, Zones, Audio, Rendering, Monitoring, Ticker, Time, Inputs/, Quality, Debug, Menu, Modals, Notifications ...`.
- Singleton `Game.getInstance()` (`static getInstance(){return Game.instance}`; constructor returns existing instance). Each class does `this.game = Game.getInstance()` and reaches siblings (`this.game.view`, `this.game.physics`).
- README documents an explicit **dependency-ordered tick** ("Game loop" numbered stages): e.g. `Physics`(3) -> `PhysicalVehicle:post-physics`(5) -> `Player:post-physics (Physics, PhysicalVehicle:post-physics)`(6) -> `View (Inputs, Player:post-physics)`(7) -> `VisualVehicle (PhysicalVehicle:post-physics, Inputs, Player:post-physics, View)`(8) ... `Rendering`(998), `Monitoring`(999). So each system registers a tick callback with an **order + declared dependencies** (`Ticker.js`; implementation not read). This is the idea worth stealing: modules declare `phase`/`after`, kernel sorts.
- Takeaway: very effective for a solo showpiece; coupling via global singleton makes isolated tests/swapping hard. Steal the ticker-with-depends and the quality/monitoring modules, not the singleton.
- Licence caution: MIT repo but `license.md` was updated for music/asset licences; do not reuse its models/audio (treat assets as NOT usable).

### Three.js Journey structure (course; its starter is Bruno's "Experience / World / Utils" pattern) 
Same lineage: `Experience` singleton (scene, camera, renderer, resources, time, sizes, debug) + `World` + `Utils/EventEmitter|Sizes|Time|Resources` + `Experience.update()`/`destroy()` that traverses and disposes geometries/materials. Course code is paid/closed; only patterns reusable (unverified, not opened).

### pmndrs / ECS
- **koota** (pmndrs, 772 stars, ISC, last release 0.6.6 on npm) https://github.com/pmndrs/koota - trait-based ECS with React bindings. API from memory (unverified): `const Position = trait({x:0,y:0})`, `world.spawn(Position(...))`, `world.query(Position, Velocity).updateEach(...)`.
- **miniplex** (hmans, 1.1k stars, MIT, v2.0.0; last commit Apr 2026) https://github.com/hmans/miniplex - entity bag + archetype queries, "entities are plain objects".
- **bitECS** (NateTheGreatt, 1.5k stars, **MPL-2.0**, v0.4.0, Dec 2025) https://github.com/NateTheGreatt/bitECS - SoA typed arrays; MPL is file-level copyleft; usable but flag.
- When ECS is overkill: ECS pays off with thousands of homogeneous entities (crowds, particles, bullets). Suspension Lab has 1-2 vehicles, 4 corners (or 2 for bikes), one track, ~10 UI/visual features. Heterogeneity is in *behaviour variants* (kinematics solvers), which is the strategy pattern, not entity-component. Verdict: skip ECS. Plain TS arrays of corner structs (`WheelState[]`) in the sim give the data-oriented benefit with zero dependency. Revisit only for instanced particle/dust/skidmark systems (still can be local typed arrays).

### Needle Engine (needle-tools/needle-engine-support, 611 stars, last commit 2026-11-19) https://github.com/needle-tools/needle-engine-support
Component model on top of Three.js: classes extending `Behaviour` with lifecycle `awake / onEnable / start / update / lateUpdate / onDisable / onDestroy` (from docs, unverified), `@serializable` fields, `this.context` injected (scene, time, input). npm package `@needle-tools/engine` shows no licence field (6.0.0-alpha.7) - licence unclear/commercial-ish; **do not lift code**; lifecycle naming is a fine reference only.

### threlte (3.4k stars, MIT, last push 2026-11-02) https://github.com/threlte/threlte ; r3f (MIT, npm 9.8.2)
Declarative component trees: a feature = a component; `useTask(fn, {stage, after})` registers loop callbacks into named stages with ordering (threlte). Context via `setContext/getContext` (DI-light). Ideas to borrow: **named loop stages with `after:` ordering**, **context-injected services**, mount/unmount = enable/disable. Not adopting the frameworks (Svelte/React coupling would put render modules inside UI framework; fine for UI only).

### Plugin / kernel architectures
- **tapable** (webpack, 3.9k stars, MIT, active 2026-11-20) https://github.com/webpack/tapable - `SyncHook, SyncBailHook, SyncWaterfallHook, AsyncSeriesHook, ...`. Rollup/Vite plugin hooks are the same idea: named hook points with typed args, plugins implement subset, ordering via `enforce: 'pre'|'post'`. Applied to a render loop: hooks `preStep, postStep, preRender, postRender` + waterfall hooks (e.g. `modifyCameraTarget`, `modifyShaderUniforms`). For us a 40-line typed hook helper is enough; tapable itself is a fine dependency if you want bail/waterfall semantics.
- **VS Code contribution points**: manifest declares *what it contributes* (commands, views) and the host owns the registries. Analogue: a feature module's `contributes: { suspensions: [...], hudWidgets: [...], cameraModes: [...] }`, kernel merges into registries. This is the right mental model for "suspension types register themselves".
- **DI-light service registry**: `ctx.services.get(ServiceKey<T>)` with typed keys (like VS Code `createDecorator`). Features *provide* and *consume* services declared in `kernel/services.ts`, never import each other.

### Event buses / state
- **mitt** (11.9k stars, MIT, v3.0.1, 200 B, last commit 2023) - typed via `mitt<Events>()`; no `once`; stable but dormant.
- **nanoevents** (ai, 1.6k stars, MIT, v10.0.0, 107 B) - `createNanoEvents<Events>()` with `interface Events { set: (name:string,count:number)=>void }`; `on()` returns an unbind fn (great for `dispose()` bookkeeping). Verified README example. **Pick nanoevents** (typed handler signatures, unsubscribe return, active).
- **nanostores** (7.7k, MIT, v1.5.5): atoms/maps/computed, framework-agnostic; good for UI-facing state.
- **@preact/signals-core** (preactjs/signals, 4.5k, MIT, v1.14.5): signals/computed/effect/batch; best fit if HUD uses fine-grained reactivity.
- **zustand vanilla** (pmndrs/zustand, 58.9k, MIT, v5.1.0): `createStore` + `subscribe(selector)`; ubiquitous, easy to persist/devtools; slightly coarse (whole-state subscribe).
- Rule: **events for things that happen** (`vehicle:changed`, `suspension:selected`), **store for current config/UI state** (selected suspension, camera mode, quality), **telemetry bus (not store) for 60 Hz data**. Never put per-frame data in a reactive store.

### Starters
Vite + TS Three starters were surveyed only by name; none exceeds the Bruno/Journey pattern in module isolation, so none is worth lifting beyond `vite.config`/tsconfig boilerplate. (Not verified in depth; do not cite specific repos.) Physics lib candidates (rapier.js, MIT) are covered in 02-vehicle-physics-repos.md.

## 2. Comparison table

| Pattern | Swappable? | Testable w/o three | Ordering | Cost | Pros | Cons | Verdict |
|---|---|---|---|---|---|---|---|
| Singleton `Experience/Game` + `getInstance()` (folio-2019/2025, Journey) | Low | Poor | Hand-written / ticker depends | Lowest | Fast to write, readable | Global coupling, features reach into siblings, remove = edit root | Reject as architecture, keep ticker-depends |
| Options-bag DI (folio-2019 World) | Low-Med | OK | Hand | Low | Explicit deps | Root grows, still hard-coded list | Partial |
| ECS (koota/miniplex/bitECS) | High for behaviours | Good | System order | Med-High | Data-oriented, queries | Overkill for 1-2 vehicles; strategy variants don't map to components; learning curve; bitECS MPL | Skip (maybe particles only) |
| Component/Behaviour lifecycle (Needle) | Med | Poor (needs engine) | Script order | High (engine) | Familiar lifecycle | Engine lock-in, unclear licence | Borrow naming only |
| Declarative framework (threlte/r3f) | Med (mount/unmount) | Poor | `useTask` stages | Med | Great for UI/scene composition | Framework coupling in render path | UI layer only, optional |
| Plugin kernel + hooks (tapable/Rollup/Vite) | High | Good | Hook order/enforce | Low-Med | Open extension points, ordering | Hook sprawl, typing effort | **Adopt (light)** |
| Contribution registries (VS Code) | Highest for variants | Excellent | n/a | Low | Add a variant = add a file | Needs discipline on definition shape | **Adopt** |
| Service registry (typed keys) | High | Excellent (fake services) | n/a | Low | Decoupled communication | Service locator misuse | **Adopt, keep tiny** |
| Typed event bus (nanoevents) | High | Excellent | Sync order of subscribe | Tiny | Decoupling | Spaghetti if overused; hard to trace | **Adopt for discrete events** |
| Reactive store (zustand vanilla / signals / nanostores) | High | Excellent | n/a | Tiny | Single source for UI state | Per-frame misuse kills perf | **Adopt for config/UI state** |
| Pure sim core + fixed step + snapshots | n/a | Best | deterministic | Med | Unit-testable, Worker-able, replayable server-side | Needs interpolation + snapshot copying | **Adopt (core requirement)** |

## 3. Recommended architecture for Suspension Lab

### 3.1 Layering and dependency rule

```
sim-core  (pure TS; imports: nothing but std + math utils)
   ^
kernel    (imports sim-core types only; loop, bus, store, registries, flags, module manager)
   ^
features/*  (import kernel public API + sim-core public API; NEVER other features)
   ^
app/main.ts (composition root: lists modules, registers definitions)
```
Enforce with `eslint-plugin-boundaries` or `dependency-cruiser` (CI fail on violations).

### 3.2 Directory tree

```
src/
  sim-core/                      # no three, no DOM, no Date.now/Math.random (seeded RNG injected)
    math/ (vec3.ts, mat3.ts, quat.ts, rng.ts)
    kinematics/
      solver.ts                  # KinematicsSolver interface + helpers (camber gain, roll centre, bump steer)
      macpherson.ts  doublewishbone.ts  multilink.ts
      moto/ telescopic-fork.ts  usd-fork.ts  swingarm-monoshock.ts  twin-shock.ts   # later
    tire/ pacejka.ts  | brush.ts
    vehicle/
      vehicle-model.ts           # assembles chassis + corners, calls solver per corner
      car.ts  motorcycle.ts
    track/ spline.ts  surface.ts  # height(s,lat), bump profile, friction
    driver/ pure-pursuit.ts  speed-profile.ts   # autopilot
    world.ts                     # SimWorld: step(dt, input) -> mutates state ; snapshot()
    snapshot.ts                  # SimSnapshot (plain, structured-cloneable)
    registry-types.ts            # SuspensionDefinition, VehicleDefinition, TrackDefinition (data+solver only)
  kernel/
    app.ts                       # createApp(): wires everything
    context.ts                   # AppContext type + builder
    module.ts                    # FeatureModule, ModuleManager (topo sort, init/dispose, hot swap)
    loop.ts                      # fixed-step accumulator + render stages (phases with `after`)
    events.ts                    # AppEvents map + nanoevents bus
    telemetry.ts                 # TelemetryBus (typed channels, rate-limited)
    store.ts                     # zustand vanilla store (AppState) + selectors
    registry.ts                  # Registry<T>(kind) generic: register/get/list/onChange
    services.ts                  # ServiceKey<T>, ServiceContainer
    flags.ts                     # URL-param feature flags
    disposables.ts               # DisposableBag (unsub, dispose three objects)
    worker/ sim.worker.ts  sim-client.ts   # optional: same SimWorld behind postMessage
  features/
    renderer/        (renderer.ts, tonemap, post-fx pipeline host)   # provides service 'render.scene'
    camera/          (orbit, chase, xray-closeup modes; contributes cameraModes)
    vehicle-view/    (builds three meshes from VehicleDefinition.visual; syncs from snapshot)
    suspension-view/ (draws linkage via SuspensionDefinition.buildVisual; x-ray shader)
    track-view/      (track mesh, instanced props)
    suspension-switcher-ui/  (the one-click selector; reads registry, writes store)
    hud-telemetry/   (subscribes to telemetry bus; charts for camber, roll, travel)
    autopilot/       (optional: replaces input source; swappable with 'manual-drive')
    quality/         (adaptive pixel ratio, flags shadows etc.)
    audio/  debug-panel/ (dev only)
  content/
    suspensions/ index.ts macpherson.def.ts doublewishbone.def.ts multilink.def.ts
    vehicles/    index.ts gt-coupe.def.ts  (later cafe-racer.def.ts)
    tracks/      index.ts test-track.def.ts
  app/main.ts                    # imports kernel + features + content, registers, boots
test/ (vitest)  sim-core/*.test.ts  kernel/*.test.ts  features/*.test.ts (jsdom/mocks)
```

### 3.3 TypeScript interfaces

```ts
// ---------- kernel/module.ts ----------
export type ModuleId = string;
export type Phase =
  | 'input'        // gather user/autopilot input
  | 'pre-render'   // after sim snapshot interpolated, before draw: update meshes, camera
  | 'render'       // exactly one module (renderer) owns this
  | 'post-render'  // hud, monitoring
  ;

export interface FeatureModule {
  readonly id: ModuleId;                     // 'camera', 'hud-telemetry'
  readonly deps?: readonly ModuleId[];       // hard deps: init order only (must be enabled)
  readonly optionalDeps?: readonly ModuleId[];
  readonly provides?: readonly ServiceKey<any>[];   // for validation / graph display
  readonly phase?: Phase;                    // default 'pre-render'
  readonly after?: readonly ModuleId[];      // ordering inside the phase (folio-2025 style)
  readonly defaultEnabled?: boolean;         // default true; flags can override
  init(ctx: AppContext): void | Promise<void>;
  /** Called every rendered frame. alpha = interpolation factor between prev/curr sim snapshot. */
  update?(frame: FrameInfo): void;
  dispose(): void;                           // MUST fully undo init (listeners, GPU objects, DOM)
}
export interface FrameInfo {
  dt: number;                  // render dt (s), clamped
  time: number;                // wall time
  alpha: number;               // [0,1] interpolation factor
  prev: SimSnapshot; curr: SimSnapshot;
  ctx: AppContext;             // convenience
}
export interface ModuleManager {
  register(m: FeatureModule): void;
  enable(id: ModuleId): Promise<void>;       // init deps first
  disable(id: ModuleId): void;               // refuses if an enabled module depends on it unless cascade
  replace(id: ModuleId, next: FeatureModule): Promise<void>; // dispose old, init new (HMR / A-B)
  list(): { id: ModuleId; enabled: boolean; deps: ModuleId[] }[];
}

// ---------- kernel/context.ts ----------
export interface AppContext {
  readonly bus: Bus<AppEvents>;              // discrete events
  readonly store: StoreApi<AppState>;        // zustand vanilla
  readonly telemetry: TelemetryBus;          // high-rate data for UI
  readonly services: ServiceContainer;       // typed DI-light
  readonly registries: {
    suspensions: Registry<SuspensionDefinition>;
    vehicles:    Registry<VehicleDefinition>;
    tracks:      Registry<TrackDefinition>;
    cameraModes: Registry<CameraModeDefinition>;
    hudWidgets:  Registry<HudWidgetDefinition>;
  };
  readonly sim: SimHandle;                   // commands in, snapshots out (local or Worker)
  readonly flags: Flags;                     // read-only resolved flags
  readonly disposables: DisposableBag;       // per-module child bag via ctx.scope(id)
  scope(moduleId: ModuleId): AppContext;     // module-scoped ctx: auto-unsub bus/store on dispose
  readonly env: { dev: boolean; quality: 'low'|'med'|'high' };
}
export interface SimHandle {
  command(cmd: SimCommand): void;            // 'setSuspension', 'setVehicle', 'setTrack', 'reset', 'setInput'
  latest(): SimSnapshot; previous(): SimSnapshot;
}

// ---------- kernel/services.ts ----------
export interface ServiceKey<T> { readonly id: string; readonly __t?: T }
export const key = <T>(id: string): ServiceKey<T> => ({ id });
export interface ServiceContainer {
  provide<T>(k: ServiceKey<T>, impl: T, owner: ModuleId): () => void;   // returns unprovide
  get<T>(k: ServiceKey<T>): T;               // throws if missing
  tryGet<T>(k: ServiceKey<T>): T | undefined;
}
// e.g. in kernel/services.ts (the ONLY shared place features agree on):
export const SceneService = key<{ scene: unknown /* THREE.Scene in feature code via cast type */; add(o: unknown): () => void }>('render.scene');
export const CameraRig    = key<CameraRigApi>('camera.rig');

// ---------- sim-core/registry-types.ts ----------
export interface SuspensionMeta {
  id: string;                                // 'macpherson'
  name: string; family: 'car' | 'motorcycle-front' | 'motorcycle-rear';
  appliesTo: readonly VehicleClass[];        // ['car'] or ['motorcycle']
  summary: string;
  pros: readonly string[]; cons: readonly string[];
  typicalUse: readonly string[];             // 'economy cars', 'GT front'
  tradeoffScores: { cost:number; packaging:number; camberControl:number; nvh:number; weight:number }; // 0..1
}
export interface KinematicsSolver {
  /** Pure: given hardpoints + wheel travel/steer, return wheel pose & derived metrics. */
  solve(input: CornerInput, out: CornerKinematics): void;   // out is reused (no alloc in loop)
  /** Spring/damper motion ratio and force transmission for current pose. */
  motionRatio(travel: number): number;
  /** Offline curves for UI (camber vs travel, bump steer, roll centre height). */
  sweep(range: { travel: [number, number]; steps: number }): KinematicsCurves;
}
export interface SuspensionDefinition<P = unknown> {
  meta: SuspensionMeta;
  defaultParams: P;                          // hardpoints, arm lengths, spring/damper/ARB
  paramSchema?: ParamSchema<P>;              // for debug/tuning UI
  createSolver(params: P, geometry: VehicleGeometry, corner: CornerId): KinematicsSolver;
  /** Render-side builder lives behind a *separate* optional export so sim-core stays three-free: */
  visualKey: string;                         // looked up in the suspension-view feature's VisualBuilder registry
}

// features/suspension-view/visual-registry.ts  (render side, keyed by visualKey)
export interface SuspensionVisualBuilder {
  build(params: unknown, vehicle: VehicleVisualRefs): SuspensionVisual;  // creates three objects
}
export interface SuspensionVisual {
  object3d: unknown;                         // THREE.Object3D
  update(corner: CornerKinematics, alpha: number): void;   // pose links from solver output
  setXray(amount: number): void;
  dispose(): void;
}

export type VehicleClass = 'car' | 'motorcycle';
export interface VehicleDefinition {
  id: string; class: VehicleClass; name: string;
  geometry: VehicleGeometry;                 // wheelbase, track, CoG, mass, inertia, wheel radius...
  corners: readonly CornerSpec[];            // 4 for car, 2 for bike (front/rear)
  allowedSuspensions: Record<CornerGroup, readonly string[]>;  // {front:[...], rear:[...]} ids
  defaultSuspension: Record<CornerGroup, string>;
  tire: TireParams; aero?: AeroParams; powertrain: PowertrainParams;
  createModel(def: VehicleDefinition, solvers: Record<CornerId, KinematicsSolver>): VehicleModel; // car.ts / motorcycle.ts
  visualKey: string;                         // GLB + material mapping owned by vehicle-view
}
export interface TrackDefinition {
  id: string; name: string; lengthM: number;
  centerline: readonly Vec3[]; widths: readonly number[];
  surface(s: number, lateral: number): SurfaceSample;   // height, normal, grip, bump profile
  speedLimitHint?(s: number): number;
  visualKey: string;
}

// ---------- kernel/registry.ts ----------
export interface Registry<T extends { meta?: { id: string } } | { id: string }> {
  register(def: T): () => void;             // returns unregister; throws on duplicate id
  get(id: string): T | undefined;
  list(): readonly T[];
  onChange(cb: (list: readonly T[]) => void): () => void;
}
```

### 3.4 Event names (typed `AppEvents`, nanoevents)

```ts
export interface AppEvents {
  // lifecycle
  'app:ready': () => void;
  'module:enabled': (id: ModuleId) => void;
  'module:disabled': (id: ModuleId) => void;
  // selection / config (store is source of truth; events notify transitions)
  'vehicle:changed': (id: string, prev: string) => void;
  'suspension:changed': (group: CornerGroup, id: string, prev: string) => void;
  'suspension:params': (group: CornerGroup, patch: unknown) => void;
  'track:changed': (id: string) => void;
  // camera / view
  'camera:mode': (id: string) => void;
  'xray:changed': (amount: number) => void;
  'focus:corner': (corner: CornerId | null) => void;
  // sim
  'sim:reset': () => void;
  'sim:lap': (n: number, timeS: number) => void;
  'sim:event': (e: { kind: 'bump'|'liftoff'|'bottomout'|'limit-slip'; corner?: CornerId; t: number }) => void;
  // quality / platform
  'quality:changed': (q: 'low'|'med'|'high') => void;
  'viewport:resize': (w: number, h: number, dpr: number) => void;
  'asset:progress': (loaded: number, total: number) => void;
}
```
Event rules: past-tense or `noun:changed`; payload primitives/plain; handlers must not throw (bus wraps try/catch); never use events per frame.

### 3.5 Telemetry bus (high-rate, one-way sim -> UI)

```ts
export interface TelemetryChannels {
  'vehicle':   { speed:number; lateralG:number; longG:number; roll:number; pitch:number; yawRate:number };
  'corner':    { id:CornerId; travel:number; camber:number; toe:number; rollCentre:number;
                 springForce:number; damperForce:number; tireLoad:number; slip:number }[];
  'kinematics-curves': KinematicsCurves;     // only on suspension change (not per frame)
}
export interface TelemetryBus {
  publish<K extends keyof TelemetryChannels>(k: K, v: TelemetryChannels[K]): void;  // called by kernel from snapshot at <=30 Hz
  subscribe<K extends keyof TelemetryChannels>(k: K, cb:(v:TelemetryChannels[K])=>void, opts?:{ hz?:number }): () => void;
  latest<K extends keyof TelemetryChannels>(k:K): TelemetryChannels[K] | undefined;
}
```
Kernel (not sim) derives telemetry from `SimSnapshot`, so the sim stays UI-agnostic and the bus stays optional (disable `hud-telemetry`, nothing breaks).

### 3.6 State store shape (zustand vanilla; persisted subset in `localStorage`, wrapped in try/catch)

```ts
export interface AppState {
  vehicleId: string;
  suspension: Record<CornerGroup, string>;     // {front:'macpherson', rear:'multilink'} or {front:'double-wishbone',...}
  suspensionParams: Record<string, unknown>;   // per-id overrides
  trackId: string;
  camera: { mode: string; focusCorner: CornerId | null; xray: number /*0..1*/ };
  ui: { panelOpen: boolean; showCurves: boolean; locale: string; reducedMotion: boolean };
  sim: { paused: boolean; timeScale: number; autopilot: boolean; seed: number };
  quality: { level: 'low'|'med'|'high'; pixelRatio: number; shadows: boolean };
  flags: Record<string, boolean>;              // resolved feature flags (read-only after boot)
  loading: { phase: 'boot'|'assets'|'ready'; progress: number };
}
```
Changing `suspension` is a **command**: `ctx.sim.command({type:'setSuspension',...})` then store update then `suspension:changed` event; sim applies it at the next fixed step and crossfades params over ~0.3 s so the user sees continuity.

### 3.7 Loop (fixed step + interpolation) - the one piece of code worth writing carefully

```ts
// kernel/loop.ts  (Fiedler "Fix Your Timestep": https://gafferongames.com/post/fix_your_timestep/)
const STEP = 1/240, MAX_FRAME = 0.1;
let acc = 0, last = performance.now()/1000;
function frame(now:number){
  const t = now/1000; let dt = Math.min(t-last, MAX_FRAME); last = t;
  if (!store.getState().sim.paused) {
    acc += dt * store.getState().sim.timeScale;
    while (acc >= STEP) { sim.step(STEP); acc -= STEP; }     // sim keeps prev & curr snapshots
  }
  const alpha = acc / STEP;
  modules.runPhase('input', ...); modules.runPhase('pre-render', {dt, alpha, prev, curr});
  modules.runPhase('render', ...); modules.runPhase('post-render', ...);
  telemetry.tick(t);
  requestAnimationFrame(frame);
}
```
Snapshot = plain object / Float32Array (`pos, quat, wheel poses, per-corner kinematics, controls`). Interpolate position lerp / quaternion slerp in `vehicle-view`; kinematic scalars lerp. In Worker mode `snapshot` is `postMessage`d (transfer the Float32Array); same `SimHandle` interface, so features don't know.
Determinism: sim uses only fixed STEP, seeded RNG (`rng.ts`), no `Math.random`/`Date.now`; allows golden-file replay tests and server-side replay (e.g. Cloudflare Worker/DO running the same `sim-core` for shared "ghost" or verification).

### 3.8 Registration / composition root (what "swap in/out" looks like)

```ts
// app/main.ts
const app = createApp({ flags: parseFlags(location.search) });
// content (strategy registries)
app.registries.suspensions.register(macpherson);
app.registries.suspensions.register(doubleWishbone);
app.registries.suspensions.register(multiLink);
app.registries.vehicles.register(gtCoupe);
app.registries.tracks.register(testTrack);
// motorcycle later: one import + three lines, no other file changes
// features
for (const m of [renderer, camera, vehicleView, suspensionView, trackView, switcherUi, hudTelemetry, autopilot, quality])
  app.modules.register(m);
await app.start();
```
Auto-discovery alternative: `import.meta.glob('./features/*/index.ts', {eager:true})` and `import.meta.glob('./content/**/*.def.ts', {eager:true})` so adding a folder is the only step (Vite feature; ok but explicit lists are greppable - choose explicit for features, glob for content).

### 3.9 Feature flags (URL)
`?features=-hud,-audio,+debug` (minus disables, plus enables dev modules), `?vehicle=gt-coupe&susp=double-wishbone&track=test-track&quality=low&seed=42&paused=1`. `flags.ts` resolves URL > `localStorage` > module `defaultEnabled`; unknown ids warn. ModuleManager refuses to enable a module whose hard `deps` are disabled (logs why). Dev panel can `enable/disable` live (dispose/init). A/B of two implementations of one capability: both `provide` the same `ServiceKey` and are mutually exclusive via `replace()` (e.g. `orbit-camera` vs `chase-camera` both provide `CameraRig`; or `autopilot` vs `manual-drive` both provide `InputSource`).

### 3.10 Hot swapping and HMR
- Contract: `dispose()` must release everything `init()` acquired. Enforce by giving each module a `ctx.scope(id)` whose bus/store/telemetry subscriptions, DOM nodes and three objects registered via `ctx.disposables.add(...)` are auto-released after `dispose()`; kernel can assert listener count returns to baseline in dev.
- Vite HMR in each feature entry (unverified in this project, standard Vite API):
```ts
// features/hud-telemetry/index.ts
export default hudTelemetry;
if (import.meta.hot) {
  import.meta.hot.accept((mod) => { if (mod) window.__app.modules.replace(hudTelemetry.id, mod.default); });
  import.meta.hot.dispose(() => { /* nothing: manager.replace calls old.dispose() */ });
}
```
- Content defs HMR: `registries.suspensions.register()` with same id in dev replaces the def and emits `onChange`; `sim` rebuilds solvers, `suspension-view` rebuilds visuals; live tuning of hardpoints without reload.
- Sim-core HMR: re-create `SimWorld` and restore from last snapshot (`SimWorld.fromSnapshot`).

## 4. Rules that keep modules decoupled

1. `features/X` may import: `kernel/*` public API, `sim-core` public types/functions, third-party libs, its own folder. It may NOT import `features/Y` (lint: `boundaries/element-types`).
2. Cross-feature communication only via (a) `ctx.bus` events, (b) `ctx.store` state, (c) `ctx.services` typed keys declared in `kernel/services.ts`, (d) registries. No `window.*` globals, no singletons (`getInstance`).
3. A service key is the *interface*; implementers live in a feature; consumers `tryGet` and degrade gracefully when absent (module is optional).
4. `sim-core` imports nothing from `kernel`, `features`, `three`, DOM, `performance.now`, `Math.random`. Lint with `no-restricted-imports` + a vitest "no globals" test (`globalThis` frozen proxy).
5. Variants are data: new suspension/vehicle/track = new file under `content/` exporting a Definition + one `register()`. Core code never switches on ids (`if (id==='macpherson')` is a lint error / grep check).
6. Sim definitions contain no three.js; render builders are looked up by `visualKey` in the render features, so the same definition runs headless.
7. Per-frame data only through `FrameInfo`/snapshot/telemetry; never through the store or bus.
8. A module owns its resources: everything created in `init` is registered for teardown; `dispose()` idempotent; no module may assume it is initialised only once.
9. Each module has `index.ts` default-exporting the `FeatureModule` and a `README` line stating provides/consumes/events emitted.
10. Event and service names are namespaced (`area:action`), centralised in kernel types so TS finds all users.
11. Adding a module must not require editing another module (only `app/main.ts` list); removing one must pass the "boot with `?features=-X`" smoke test.

## 5. Testing strategy (vitest)

- **sim-core unit tests (bulk of value)**: kinematic invariants per solver (e.g. camber at ride height = design value; MacPherson camber gain sign vs double wishbone in bump; roll centre height within analytic tolerance; bump steer curve zero at design toe link length; symmetry left/right), energy sanity (undamped spring-mass period `2*pi*sqrt(m/k)`), tire force saturation, track `surface()` continuity. Property tests with `fast-check` (solver never returns NaN across travel range, monotone motion ratio).
- **Determinism/golden tests**: run 10 s of the autopilot lap with seed 42, hash quantised snapshots; commit golden; any physics change must update golden knowingly. Same test runs in Node and in the Worker (parity).
- **Fixed-step test**: feed random frame dts to loop accumulator; assert sim step count conserves time and state is independent of frame dts (determinism vs render rate).
- **Registry/contract tests**: iterate `registries.suspensions.list()` and run one shared conformance suite (`describe.each`) so every new definition (including future motorcycle forks) is validated automatically: has meta, solver yields finite output over full travel, `visualKey` resolves, tradeoff scores in [0,1].
- **Kernel tests**: module topo sort, cycle detection, enable/disable/replace, dispose leak check (bus/store listener counts return to baseline), flag parsing, telemetry rate limiting. Pure TS, no three.
- **Feature tests**: render features with a stub `AppContext` (`createTestContext()` with fake services); for three-dependent ones use `three` in Node (no GL: Object3D/geometry only) or mock `renderer`; UI features with jsdom/Testing Library.
- **Smoke/e2e (Playwright)**: boot with `?features=-hud`, `?features=-suspension-view`, `?quality=low&seed=1&paused=1`; screenshot comparison on a paused deterministic frame per suspension type; console must have zero errors; FPS budget check via `ctx.telemetry`.
- **Architecture tests**: dependency-cruiser rule set run in CI (features cannot import features; sim-core cannot import three).
- Coverage targets: sim-core >90%, kernel >80%, features pragmatic.

## 6. Repos worth lifting (links, licence, stars, what to take)

| Repo | Stars | Licence | Last activity | Lift |
|---|---|---|---|---|
| https://github.com/brunosimon/folio-2019 | 4.7k | MIT (license.md) | 2024-05 | `Utils/EventEmitter.js` namespaced emitter idea; `Utils/Time.js` delta clamp pattern; options-bag DI example. Code is old JS; use as reference. |
| https://github.com/brunosimon/folio-2025 | 2.0k | MIT per GitHub; assets/music separately licensed - do NOT reuse assets | 2026-11-04 | README "Game loop" ordered-dependency tick model; `Ticker.js`/`Time.js`/`Quality.js`/`Monitoring.js` structure (not read in detail, verify before copying). |
| https://github.com/ai/nanoevents | 1.6k | MIT | 2026-07 | Typed event bus (use as dependency, v10). |
| https://github.com/developit/mitt | 11.9k | MIT | 2023-07 | Alternative bus; dormant. |
| https://github.com/webpack/tapable | 3.9k | MIT | 2026-11-20 | Hook classes (SyncBail/Waterfall) if hook semantics wanted; or copy ideas into 40-line helper. |
| https://github.com/pmndrs/zustand | 58.9k | MIT | 2026-11-06 | `zustand/vanilla` store + `subscribeWithSelector`. |
| https://github.com/preactjs/signals | 4.5k | MIT | 2026-11-18 | `@preact/signals-core` if fine-grained HUD reactivity preferred. |
| https://github.com/nanostores/nanostores | 7.7k | MIT | 2026-10-15 | Alternative store. |
| https://github.com/threlte/threlte | 3.4k | MIT | 2026-11-02 | Ideas: `useTask` stages with `after`, context DI. |
| https://github.com/pmndrs/react-three-fiber | n/v | MIT (npm) | active | Ideas only (stars not verified). |
| https://github.com/pmndrs/koota | 772 | ISC | 2025-2026 | Only if ECS needed later. |
| https://github.com/hmans/miniplex | 1.1k | MIT | 2026-04 | Only if ECS needed later. |
| https://github.com/NateTheGreatt/bitECS | 1.5k | **MPL-2.0** (file-level copyleft; flag) | 2025-12 | Avoid unless needed. |
| https://github.com/needle-tools/needle-engine-support | 611 | licence unclear (npm package shows none) - **NOT usable for lifting** | 2026-11-19 | Lifecycle naming only. |
| https://gafferongames.com/post/fix_your_timestep/ | - | article | - | Fixed-step + interpolation algorithm (implement yourself). |

Dev tooling (MIT, not verified this session): `vitest`, `fast-check`, `eslint-plugin-boundaries`, `dependency-cruiser`, `playwright`.

## 7. Recommendations for Suspension Lab

1. Build `sim-core` first with the `KinematicsSolver` interface and one reference solver (double wishbone, via the formulas in 04-suspension-engineering-facts.md); add MacPherson/multi-link behind the same interface; conformance suite from day one.
2. Implement the kernel (~300 lines): `registry.ts`, `module.ts` (topo sort + phases + replace), `loop.ts`, `events.ts` (nanoevents), `store.ts` (zustand vanilla), `telemetry.ts`, `flags.ts`. Own it; no ECS, no framework in the core.
3. Use `visualKey` indirection so `sim-core` stays three-free and `suspension-view` owns all geometry/shaders (x-ray shader is a swappable visual).
4. Treat motorcycles as content: `VehicleDefinition.class='motorcycle'`, `corners` = front/rear groups, new solvers (`telescopic-fork`, `swingarm-monoshock`) registered like the car ones; make `VehicleModel` an interface (`car.ts`, `motorcycle.ts`) because single-track dynamics differ (lean angle), not by branching in shared code.
5. Make the Worker optional from the start (`SimHandle` abstraction) so Cloudflare can later run the identical `sim-core` for replays/ghost laps.
6. Enforce decoupling mechanically (dependency-cruiser + `?features=-X` Playwright smoke tests) - rules are only real if CI fails.
7. Keep UI framework a feature-level choice (vanilla/Preact/Svelte inside `hud-telemetry` and `suspension-switcher-ui`); the render path stays framework-free.
8. Steal folio-2025's idea of an explicit, documented, dependency-ordered loop and print it in dev (`app.modules.list()` -> phase/after graph) so ordering bugs are visible.
