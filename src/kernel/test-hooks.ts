import type { AppContext } from '../contracts/app';
import { neutralIntent, type DriveIntent, type DriveMode } from '../contracts/drive';
import { RENDER, type RenderStats } from '../contracts/services';
import type { AppState } from '../contracts/store';
import type { AxleKinematicsSummary } from '../contracts/suspension';
import type { AxleId } from '../contracts/units';
import type { FeatureManager } from './features';
import type { KernelSimHost } from './sim-host';

/** `window.__app` (§6.6): only installed with ?e2e=1 or ?debug=1. */
export interface TestHooks {
  ready: boolean;
  readonly errors: string[];
  features(): { id: string; enabled: boolean; error?: string }[];
  state(): AppState;
  set<K extends keyof AppState>(key: K, value: AppState[K]): void;
  frame(): {
    lapTime: number;
    s: number;
    sectionId: string;
    speed: number;
    roll: number;
    pitch: number;
    ax: number;
    ay: number;
    corners: { id: string; travel: number; camber: number; toe: number; load: number }[];
  };
  kinematics(): Record<AxleId, AxleKinematicsSummary>;
  stats(): RenderStats | null;
  seek(lapTime: number): void;
  advance(seconds: number): void;
  /** Manual Drive state of the last rendered frame (ARCHITECTURE-M2 §6.5). */
  drive(): {
    mode: DriveMode;
    available: boolean;
    x: number;
    y: number;
    yaw: number;
    u: number;
    v: number;
    speed: number;
    steer: number;
    gear: number;
    engineRpm: number;
    zone: string;
    approximate: boolean;
    detached: boolean;
    faults: number;
    corners: { id: string; fx: number; fy: number; capacity: number; slipAngle: number; slipRatio: number; omega: number; surface: string }[];
  };
  /** Test-only intent override, merged onto neutralIntent() with digital=false; wins over device sources; null clears. */
  driveIntent(intent: Partial<DriveIntent> | null): void;
  /** runDriveScript on a FRESH simulation (same catalog and ids). */
  driveHash(seed: number, seconds: number): string;
}

/** Kernel internals the hooks need beyond the AppContext. */
export interface HookDeps {
  readonly host: () => KernelSimHost;
  readonly advance: (seconds: number) => void;
  readonly driveHash: (seed: number, seconds: number) => string;
}

declare global {
  var __app: TestHooks | undefined;
}

/** Installs the hooks and a console.error capture; returns the uninstaller. */
export function installTestHooks(ctx: () => AppContext, features: FeatureManager, deps: HookDeps): () => void {
  const errors: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' '));
    consoleError.apply(console, args);
  };
  globalThis.__app = {
    ready: false,
    errors,
    features: () => features.records.map((r) => ({ id: r.id, enabled: r.enabled, ...(r.error === undefined ? {} : { error: r.error }) })),
    state: () => structuredClone(ctx().store.get()),
    set(key, value) {
      // nanostores' conditional setKey type cannot be satisfied by a generic K
      (ctx().store.setKey as (k: keyof AppState, v: unknown) => void)(key, value);
    },
    frame() {
      const t = ctx().sim.frame;
      return {
        lapTime: t.lapTime,
        s: t.s,
        sectionId: t.sectionId,
        speed: t.speed,
        roll: t.roll,
        pitch: t.pitch,
        ax: t.ax,
        ay: t.ay,
        corners: t.corners.map((c) => ({ id: c.id, travel: c.travel, camber: c.camber, toe: c.toe, load: c.load })),
      };
    },
    kinematics() {
      const k = ctx().sim.current.kinematics();
      return { front: k.front.summary, rear: k.rear.summary };
    },
    stats: () => ctx().services.tryGet(RENDER)?.stats() ?? null,
    seek: (lapTime) => ctx().bus.emit('sim:seek-to', { lapTime }),
    advance: deps.advance,
    drive() {
      const t = ctx().sim.frame;
      const d = t.drive;
      return {
        mode: d.mode,
        available: d.available,
        x: d.x,
        y: d.y,
        yaw: d.yaw,
        u: d.u,
        v: d.v,
        speed: Math.hypot(d.u, d.v),
        steer: d.steerDemand,
        gear: d.gear,
        engineRpm: d.engineRpm,
        zone: d.zone,
        approximate: d.approximate,
        detached: d.detached,
        faults: d.faults,
        corners: t.corners.map((c) => ({
          id: c.id,
          fx: c.fx,
          fy: c.fy,
          capacity: c.capacity,
          slipAngle: c.slipAngle,
          slipRatio: c.slipRatio,
          omega: c.omega,
          surface: c.surface,
        })),
      };
    },
    driveIntent(intent) {
      deps.host().testIntent = intent === null ? null : { ...neutralIntent(), digital: false, ...intent };
    },
    driveHash: deps.driveHash,
  };
  return () => {
    console.error = consoleError;
    globalThis.__app = undefined;
  };
}
