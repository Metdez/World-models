import type { FrameInfo, FramePhase } from '../contracts/app';
import type { AppBus } from '../contracts/events';
import type { SimEvent } from '../contracts/sim';
import type { AppStore } from '../contracts/store';
import { MAX_FRAME_DT, SIM_DT } from '../contracts/units';
import type { FeatureManager } from './features';
import type { KernelSimHost } from './sim-host';

export interface Loop {
  start(): void;
  stop(): void;
  /** One render frame at `nowMs` (rAF timestamp). */
  frame(nowMs: number): void;
  /** Test-only: n frames of `dt` seconds, synchronously. */
  tick(n: number, dt: number): void;
  /** Steps the sim by `seconds` (rounded to whole steps) and renders one frame with dt = 0. */
  advance(seconds: number): void;
}

const PHASES: readonly FramePhase[] = ['scene', 'camera', 'render', 'overlay'];
/** Spiral-of-death guard: at most this many fixed steps per render frame. */
const MAX_STEPS = 24;

export function createLoop(deps: {
  readonly store: AppStore;
  readonly bus: AppBus;
  readonly host: KernelSimHost;
  readonly features: FeatureManager;
  readonly raf: (cb: (nowMs: number) => void) => number;
  readonly onFirstFrame: () => void;
}): Loop {
  const { store, bus, host, features, raf, onFirstFrame } = deps;
  let running = false;
  let scheduled = false;
  let first = true;
  let lastMs: number | undefined;
  const info = { dt: 0, time: 0, alpha: 0, t: host.frame };
  const emitSimEvent = (e: SimEvent) => bus.emit('sim:event', e);

  function render(dt: number, nowMs: number): void {
    const st = store.get();
    info.dt = dt;
    info.time = nowMs / 1000;
    info.alpha = host.acc / SIM_DT;
    info.t = host.frame = host.current.sample(info.alpha, st.amplification);
    host.current.drainEvents(emitSimEvent);
    for (const phase of PHASES) features.update(phase, info as FrameInfo);
    if (first) {
      first = false;
      onFirstFrame();
    }
  }

  function frame(nowMs: number): void {
    const dt = lastMs === undefined ? 0 : Math.min(Math.max((nowMs - lastMs) / 1000, 0), MAX_FRAME_DT);
    lastMs = nowMs;
    const st = store.get();
    if (!st.paused) {
      host.acc += dt * st.timeScale;
      if (st.clock === 'live' && st.timeScale === 1) host.liveCorrection(dt);
      let steps = 0;
      while (host.acc >= SIM_DT && steps < MAX_STEPS) {
        host.current.step(SIM_DT);
        host.acc -= SIM_DT;
        steps++;
      }
      if (host.acc >= SIM_DT) host.acc = 0; // fell behind: drop the backlog instead of spiralling
    }
    render(dt, nowMs);
  }

  function onRaf(nowMs: number): void {
    scheduled = false;
    if (!running) return;
    frame(nowMs);
    schedule();
  }
  function schedule(): void {
    if (running && !scheduled && !hidden()) {
      scheduled = true;
      raf(onRaf);
    }
  }
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  function onVisibility(): void {
    if (hidden()) return; // onRaf stops rescheduling by itself
    lastMs = undefined;
    if (store.get().clock === 'live') host.seek(host.liveTarget());
    schedule();
  }

  return {
    start() {
      running = true;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      schedule();
    },
    stop() {
      running = false;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
    frame,
    tick(n, dt) {
      let now = lastMs ?? (lastMs = 0);
      for (let i = 0; i < n; i++) frame((now += dt * 1000));
    },
    advance(seconds) {
      for (let i = Math.round(seconds / SIM_DT); i > 0; i--) host.current.step(SIM_DT);
      render(0, lastMs ?? 0);
    },
  };
}
