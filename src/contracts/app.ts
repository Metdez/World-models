import type { AppBus, AppEvents } from './events';
import type { SuspensionVisualDefinition, VehicleVisualDefinition } from './services';
import type { Simulation } from './sim';
import type { AppState, AppStore, ViewMode } from './store';
import type { SuspensionDefinition } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { TrackDefinition } from './track';
import type { VehicleDefinition } from './vehicle';
import type { WorldDefinition } from './world';

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
  /** Worlds around tracks (M2); the kernel passes the one whose trackId matches to the simulation. */
  readonly worlds: Registry<WorldDefinition>;
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
  /** ?drive=manual: request Manual Drive after the first frame (M2). */
  readonly drive?: 'manual';
  /** ?spawn=<station id>: with Manual Drive, place the car at that station (M2). */
  readonly spawn?: string;
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
