/** Kernel Manual Drive plumbing (ARCHITECTURE-M2 §6) with a fake sim + a recording fake `drive`. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../src/contracts/app';
import { DEFAULT_AIDS, type DecodedReplay } from '../../src/contracts/drive';
import type { SimCatalog, SimulationOptions } from '../../src/contracts/sim';
import { EPOCH_MS, SIM_DT } from '../../src/contracts/units';
import { EMPTY_MANIFEST } from '../../src/kernel/assets';
import { createApp } from '../../src/kernel/app';
import { createBus, listenerCount } from '../../src/kernel/bus';
import { createFeatureManager } from '../../src/kernel/features';
import { parseFlags } from '../../src/kernel/flags';
import { createLoop } from '../../src/kernel/loop';
import { createRegistries } from '../../src/kernel/registry';
import { createSimHost } from '../../src/kernel/sim-host';
import { createStore } from '../../src/kernel/store';
import { createSimulation, runDriveScript } from '../../src/sim-core/index';
import { fakeDom, fakeSim, withFakeDrive } from './helpers';

const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const OPTIONS: SimulationOptions = { catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: 'multilink', lapTime: 0 };

function rig(search = '?clock=local', available = true) {
  const warnings: string[] = [];
  const clock: Clock = { serverNow: () => EPOCH_MS + 42_000, setOffset: () => {}, synced: false };
  const store = createStore(parseFlags(search, () => {}), false);
  const bus = createBus();
  const sim = withFakeDrive(fakeSim(OPTIONS), available);
  const host = createSimHost({ sim, store, bus, clock, registries: createRegistries(), warn: (m) => warnings.push(m) });
  const features = createFeatureManager([], {}, false, () => {}, () => {});
  const loop = createLoop({ store, bus, host, features, raf: () => 0, onFirstFrame: () => {} });
  let ms = 0;
  const frame = (dt = 1 / 60) => loop.frame((ms += dt * 1000));
  loop.frame(0);
  return { store, bus, sim, host, loop, frame, warnings };
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.__app = undefined;
});

describe('sim host drive requests (§6.2)', () => {
  it("drive:request manual sets the local clock, unpauses and calls request('manual')", () => {
    const r = rig('?clock=live&paused=1');
    r.store.setKey('clock', 'live');
    r.bus.emit('drive:request', { mode: 'manual' });
    expect(r.store.get().clock).toBe('local');
    expect(r.store.get().paused).toBe(false);
    expect(r.sim.drive.calls).toEqual(['request:manual']);
  });

  it('unavailable drive: a warning and no call', () => {
    const r = rig('?clock=local', false);
    r.bus.emit('drive:request', { mode: 'manual' });
    expect(r.sim.drive.calls).toEqual([]);
    expect(r.warnings).toEqual(['Manual Drive is not available for vehicle "gt-coupe"']);
  });

  it("drive:request auto = request('auto'); immediate = live clock, whose watcher seeks (the sim releases)", () => {
    const r = rig();
    r.bus.emit('drive:request', { mode: 'manual' });
    r.frame();
    r.bus.emit('drive:request', { mode: 'auto' });
    expect(r.sim.drive.calls).toEqual(['request:manual', 'request:auto']);
    const seeks = r.sim.seeks.length;
    r.bus.emit('drive:request', { mode: 'auto', immediate: true });
    expect(r.store.get().clock).toBe('live');
    expect(r.sim.seeks.length).toBe(seeks + 1);
    expect(r.sim.drive.mode).toBe('auto');
  });

  it('sim:seek-to is ignored outside auto, honoured in auto', () => {
    const r = rig();
    r.bus.emit('drive:request', { mode: 'manual' });
    r.frame();
    expect(r.sim.drive.mode).toBe('manual');
    r.bus.emit('sim:seek-to', { lapTime: 30 });
    expect(r.sim.seeks).toEqual([]);
    expect(r.warnings).toEqual(['Seek ignored while driving']);
    const auto = rig();
    auto.bus.emit('sim:seek-to', { lapTime: 30 });
    expect(auto.sim.seeks).toEqual([30]);
  });

  it('drive:reset and drive:play are forwarded; play starts locally and warns when it does not fit', () => {
    const r = rig('?paused=1');
    r.bus.emit('drive:reset', { spawn: 'skidpad' });
    r.bus.emit('drive:reset', {});
    r.bus.emit('drive:play', { replay: {} as DecodedReplay });
    expect(r.sim.drive.calls).toEqual(['reset:skidpad', 'reset:-', 'play']);
    expect(r.store.get().paused).toBe(false);
    expect(r.store.get().clock).toBe('local');
    expect(r.warnings).toEqual(['Replay does not fit this simulation']);
  });

  it('store.driveAids changes reach setAids; store.driveMode writes are never applied', () => {
    const r = rig();
    r.store.setKey('driveAids', { ...DEFAULT_AIDS, abs: false, stability: false });
    r.store.setKey('driveMode', 'manual');
    expect(r.sim.drive.calls).toEqual(['setAids:traction,steering']);
    expect(r.sim.drive.mode).toBe('auto');
  });

  it('handlers are no-ops without sim.drive, and dispose removes every listener', () => {
    const store = createStore(parseFlags('?clock=local', () => {}), false);
    const bus = createBus();
    const sim = fakeSim(OPTIONS);
    const host = createSimHost({ sim, store, bus, clock: { serverNow: () => EPOCH_MS, setOffset: () => {}, synced: false }, registries: createRegistries(), warn: () => {} });
    bus.emit('drive:request', { mode: 'manual' });
    bus.emit('drive:reset', {});
    bus.emit('sim:seek-to', { lapTime: 5 });
    expect(sim.seeks).toEqual([5]);
    host.dispose();
    expect(listenerCount(bus)).toBe(0);
  });
});

describe('loop drive events (§6.3)', () => {
  it('a mode event updates store.driveMode, emits drive:mode and drive:event, and a cut zeroes acc', () => {
    const r = rig();
    const modes: unknown[] = [];
    const events: string[] = [];
    r.bus.on('drive:mode', (m) => modes.push(m));
    r.bus.on('drive:event', (e) => events.push(e.kind));
    r.bus.emit('drive:request', { mode: 'manual' });
    r.frame(0.01);
    expect(r.store.get().driveMode).toBe('manual');
    expect(modes).toEqual([{ mode: 'manual', previous: 'auto', cut: false }]);
    expect(r.host.acc).toBeGreaterThan(0); // no cut: accumulator kept
    r.sim.drive.events.push({ kind: 'mode', mode: 'auto', previous: 'manual', cut: true, simTime: 1 }, { kind: 'reset', spawn: null, simTime: 1 });
    r.frame(0.01);
    expect(r.store.get().driveMode).toBe('auto');
    expect(modes.at(-1)).toEqual({ mode: 'auto', previous: 'manual', cut: true });
    expect(events).toEqual(['mode', 'mode', 'reset']);
    expect(r.host.acc).toBe(0);
  });

  it('a mode change syncs store.suspensionId to the simulation without re-applying it', () => {
    const r = rig();
    r.sim.setSuspension('double-wishbone');
    r.sim.calls.length = 0;
    r.sim.drive.events.push({ kind: 'mode', mode: 'manual', previous: 'auto', cut: false, simTime: 0 });
    r.frame();
    expect(r.store.get().suspensionId).toBe('double-wishbone');
    expect(r.sim.calls).toEqual([]);
  });

  it('the test intent override is re-applied before the fixed steps and before advance()', () => {
    const r = rig();
    r.bus.emit('drive:request', { mode: 'manual' });
    r.frame();
    r.host.testIntent = { steer: 0.5, throttle: 1, brake: 0, handbrake: 0, digital: false, source: 'keyboard' };
    r.sim.drive.setIntent({ steer: 0, throttle: 0, brake: 1, handbrake: 0, digital: true, source: 'gamepad' }); // a device
    r.frame();
    expect(r.sim.drive.intent.throttle).toBe(1);
    r.sim.drive.setIntent({ steer: 0, throttle: 0, brake: 1, handbrake: 0, digital: true, source: 'gamepad' });
    r.loop.advance(1);
    expect(r.sim.drive.intent.source).toBe('keyboard');
    expect(r.host.frame.drive.u).toBeGreaterThan(4);
  });
});

describe('flags (§6.4)', () => {
  it('parses drive=manual and spawn=<id>; bad values warn and are ignored', () => {
    const warn = vi.fn();
    expect(parseFlags('?drive=manual&spawn=skidpad', warn)).toMatchObject({ drive: 'manual', spawn: 'skidpad' });
    expect(warn).not.toHaveBeenCalled();
    const flags = parseFlags('?drive=auto&spawn=Bad_Id', warn);
    expect(flags.drive).toBeUndefined();
    expect(flags.spawn).toBeUndefined();
    expect(warn.mock.calls.map(([m]) => m)).toEqual(['Ignoring ?drive=auto: invalid value', 'Ignoring ?spawn=Bad_Id: invalid value']);
  });
});

describe('boot and test hooks (§6.1, §6.5)', () => {
  const bootApp = (search: string, available = true) => {
    const created: ReturnType<typeof withFakeDrive>[] = [];
    const app = createApp({
      features: [],
      search,
      dom: fakeDom(),
      raf: () => 0,
      loadManifest: async () => EMPTY_MANIFEST,
      createSimulation: (o) => {
        const s = withFakeDrive(fakeSim(o), available);
        created.push(s);
        return s;
      },
    });
    return { app, created };
  };

  it('passes the world lookup in the catalog, applies aids at boot and requests manual + spawn after the first frame', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let catalog: SimCatalog | undefined;
    const app = createApp({
      features: [{ id: 'w', contribute: (r) => void r.worlds.register({ id: 'pg', trackId: 'proving-loop' } as never) }],
      search: '?e2e=1&drive=manual&spawn=skidpad',
      dom: fakeDom(),
      raf: () => 0,
      loadManifest: async () => EMPTY_MANIFEST,
      createSimulation: (o) => {
        catalog = o.catalog;
        return withFakeDrive(fakeSim(o));
      },
    });
    await app.start();
    expect(catalog?.world?.('proving-loop')?.id).toBe('pg');
    expect(catalog?.world?.('elsewhere')).toBeUndefined();
    const drive = (app.ctx.sim.current as ReturnType<typeof withFakeDrive>).drive;
    expect(drive.calls).toEqual(['setAids:abs,traction,stability,steering']);
    app.tick(1, 1 / 60);
    expect(drive.calls.slice(1)).toEqual(['request:manual', 'reset:skidpad']);
    app.tick(1, 1 / 60);
    expect(app.ctx.store.get().driveMode).toBe('manual');
    app.stop();
  });

  it('drive(), driveIntent() and driveHash() are JSON-safe', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, created } = bootApp('?e2e=1&paused=1');
    await app.start();
    app.tick(1, 1 / 60);
    const hooks = globalThis.__app!;
    expect(hooks.drive().mode).toBe('auto');
    app.ctx.bus.emit('drive:request', { mode: 'manual' });
    hooks.driveIntent({ throttle: 1 });
    hooks.advance(2);
    const d = hooks.drive();
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(d).toMatchObject({ mode: 'manual', available: true, steer: 0 });
    expect(d.speed).toBeGreaterThan(9);
    expect(d.corners[0]).toEqual(expect.objectContaining({ id: 'fl', surface: 'asphalt' }));
    hooks.driveIntent(null);
    const device = { steer: -0.25, throttle: 0, brake: 0, handbrake: 0, digital: true, source: 'gamepad' } as const;
    app.ctx.sim.current.drive!.setIntent(device);
    hooks.advance(0.1);
    expect(hooks.drive().steer).toBe(-0.25); // the device wins again once the override is cleared
    const hash = hooks.driveHash(7, 3);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hooks.driveHash(7, 3)).toBe(hash);
    expect(created).toHaveLength(3); // the app's sim + one fresh sim per driveHash call
    app.stop();
  });
});

describe('runDriveScript (§6.6)', () => {
  it("returns 'no-drive' on the M1 simulation (no plant yet)", () => {
    expect(runDriveScript(createSimulation(OPTIONS), 1, 1)).toBe('no-drive');
    expect(runDriveScript(withFakeDrive(fakeSim(OPTIONS), false), 1, 1)).toBe('no-drive');
  });

  it('gives a stable hash with a fake drive, and a different one for another seed', () => {
    const run = (seed: number) => {
      const sim = withFakeDrive(fakeSim(OPTIONS));
      const hash = runDriveScript(sim, seed, 5);
      return { hash, sim };
    };
    const a = run(1);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(run(1).hash).toBe(a.hash);
    expect(run(2).hash).not.toBe(a.hash);
    expect(a.sim.seeks).toEqual([10]);
    expect(a.sim.drive.calls).toEqual(['request:manual']);
    expect(a.sim.steps).toBe(Math.round(5 / SIM_DT));
    expect(a.sim.drive.intent.digital).toBe(false);
  });
});
