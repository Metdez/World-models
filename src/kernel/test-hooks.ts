import type { AppContext } from '../contracts/app';
import { RENDER, type RenderStats } from '../contracts/services';
import type { AppState } from '../contracts/store';
import type { AxleKinematicsSummary } from '../contracts/suspension';
import type { AxleId } from '../contracts/units';
import type { FeatureManager } from './features';

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
}

declare global {
  var __app: TestHooks | undefined;
}

/** Installs the hooks and a console.error capture; returns the uninstaller. */
export function installTestHooks(ctx: () => AppContext, features: FeatureManager, advance: (seconds: number) => void): () => void {
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
    advance,
  };
  return () => {
    console.error = consoleError;
    globalThis.__app = undefined;
  };
}
