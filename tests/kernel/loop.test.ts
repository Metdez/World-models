import { describe, expect, it } from 'vitest';
import type { Clock, FrameInfo } from '../../src/contracts/app';
import type { SimEvent } from '../../src/contracts/sim';
import { EPOCH_MS, SIM_DT } from '../../src/contracts/units';
import { createBus } from '../../src/kernel/bus';
import { createFeatureManager } from '../../src/kernel/features';
import { parseFlags } from '../../src/kernel/flags';
import { createLoop } from '../../src/kernel/loop';
import { createRegistries } from '../../src/kernel/registry';
import { createSimHost } from '../../src/kernel/sim-host';
import { createStore } from '../../src/kernel/store';
import { createRng } from '../../src/sim-core/math/rng';
import { fakeSim } from './helpers';

const LAP = 100;

function rig(search: string, opts: { startLap?: number; serverMs?: number } = {}) {
  let now = opts.serverMs ?? EPOCH_MS;
  const clock: Clock = { serverNow: () => now, setOffset: () => {}, synced: false };
  const store = createStore(parseFlags(search, () => {}), false);
  const bus = createBus();
  const sim = fakeSim({ catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined }, trackId: 't', vehicleId: 'v', suspensionId: 's', lapTime: opts.startLap ?? 0 }, LAP);
  const host = createSimHost({ sim, store, bus, clock, registries: createRegistries(), warn: () => {} });
  const frames: FrameInfo[] = [];
  const features = createFeatureManager([{ id: 'probe', update: (f) => void frames.push({ ...f }) }], {}, false, () => {}, () => {});
  let firstFrames = 0;
  const loop = createLoop({ store, bus, host, features, raf: () => 0, onFirstFrame: () => firstFrames++ });
  const seeks: number[] = [];
  bus.on('sim:seek', ({ lapTime }) => seeks.push(lapTime));
  /** Advance real (server) time and render one frame. */
  let ms = 0;
  const frame = (dt: number) => {
    ms += dt * 1000;
    now += dt * 1000;
    loop.frame(ms);
  };
  loop.frame(0);
  return { store, bus, sim, host, loop, frames, frame, seeks, firstFrames: () => firstFrames, clock: { set: (t: number) => (now = t) } };
}

describe('fixed-step loop (§6.3)', () => {
  it('random render dts give the same step count per sim-second', () => {
    const counts = [1, 2, 3].map((seed) => {
      const r = rig('?clock=local');
      const rng = createRng(seed);
      let total = 0;
      while (total < 10) {
        const dt = Math.min(rng.uniform(0.001, 0.1), 10 - total);
        r.frame(dt);
        total += dt;
      }
      return r.sim.steps;
    });
    for (const c of counts) expect(Math.abs(c - 10 / SIM_DT)).toBeLessThanOrEqual(1);
  });

  it('clamps dt, honours pause and timeScale, and samples with alpha = acc / SIM_DT', () => {
    const r = rig('?clock=local');
    r.frame(5); // clamped to MAX_FRAME_DT = 0.1 s
    expect(r.sim.steps).toBe(24);
    expect(r.frames.at(-1)!.dt).toBeCloseTo(0.1, 12);
    r.store.setKey('paused', true);
    r.frame(0.05);
    expect(r.sim.steps).toBe(24);
    expect(r.frames).toHaveLength(3); // still renders while paused
    r.store.setKey('paused', false);
    r.store.setKey('timeScale', 0.5);
    for (let i = 0; i < 100; i++) r.frame(0.01);
    expect(Math.abs(r.sim.steps - 24 - 120)).toBeLessThanOrEqual(1);
    const last = r.frames.at(-1)!;
    expect(last.alpha).toBeGreaterThanOrEqual(0);
    expect(last.alpha).toBeLessThan(1);
    expect(last.alpha).toBeCloseTo(r.host.acc / SIM_DT, 12);
    expect(last.t).toBe(r.host.frame);
    expect(r.firstFrames()).toBe(1);
  });

  it('forwards simulation events to the bus once per frame', () => {
    const r = rig('?clock=local');
    const got: SimEvent[] = [];
    r.bus.on('sim:event', (e) => got.push(e));
    r.sim.events.push({ kind: 'lap', lap: 1, duration: 100 }, { kind: 'liftoff', corner: 2 });
    r.frame(0.01);
    r.frame(0.01);
    expect(got).toEqual([{ kind: 'lap', lap: 1, duration: 100 }, { kind: 'liftoff', corner: 2 }]);
  });

  it('advance() steps whole SIM_DTs and renders while paused', () => {
    const r = rig('?paused=1');
    r.loop.advance(0.5);
    expect(r.sim.steps).toBe(120);
    expect(r.frames.at(-1)!.dt).toBe(0);
  });

  it('tick() runs n frames of dt synchronously', () => {
    const r = rig('?clock=local');
    r.loop.tick(10, 0.1);
    expect(r.sim.steps).toBe(240);
  });
});

describe('live clock (§6.5)', () => {
  it('first live frame seeks to the shared-clock target', () => {
    const r = rig('', { serverMs: EPOCH_MS + 1000 * (3 * LAP + 42) }); // rig renders the first frame (dt 0)
    expect(r.seeks).toHaveLength(1);
    expect(r.seeks[0]).toBeCloseTo(42, 9);
    r.frame(0.016);
    expect(r.seeks).toHaveLength(1);
  });

  it('small errors are slewed at most 2 % of dt, without seeking, and converge', () => {
    const r = rig('', { startLap: 10, serverMs: EPOCH_MS + 10_300 }); // sim 0.3 s behind
    const before = r.sim.steps;
    r.frame(0.05);
    // one frame: real 0.05 s + slew of at most 2 % of it
    expect(r.sim.lapTime + r.host.acc).toBeCloseTo(10.051, 9);
    expect(r.sim.steps - before).toBe(12);
    for (let i = 0; i < 1200; i++) r.frame(1 / 60); // 20 s
    expect(r.seeks).toEqual([]);
    const err = r.host.liveTarget() - (r.sim.lapTime + r.host.acc);
    expect(Math.abs(err)).toBeLessThan(1e-6);
  });

  it('errors are wrapped to half a lap (sim just before the lap end, target just after it)', () => {
    const r = rig('', { startLap: LAP - 0.2, serverMs: EPOCH_MS + 0.1 * 1000 });
    r.frame(0.016);
    expect(r.seeks).toEqual([]); // 0.3 s ahead across the wrap, not 99.7 s behind
  });

  it('only runs with clock=live and timeScale 1; switching back to live seeks', () => {
    const r = rig('?clock=local', { serverMs: EPOCH_MS + 50_000 });
    r.frame(0.016);
    expect(r.seeks).toEqual([]);
    r.store.setKey('clock', 'live');
    expect(r.seeks).toHaveLength(1);
    expect(r.seeks[0]).toBeCloseTo(50.016, 6);
    r.store.setKey('timeScale', 0.25); // slow motion leaves the live clock
    expect(r.store.get().clock).toBe('local');
    r.clock.set(EPOCH_MS + 90_000);
    r.frame(0.016);
    expect(r.seeks).toHaveLength(1);
  });
});
