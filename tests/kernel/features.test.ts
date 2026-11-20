import { describe, expect, it, vi } from 'vitest';
import type { AppContext, FeatureModule, FrameInfo } from '../../src/contracts/app';
import { serviceKey } from '../../src/contracts/app';
import { createBus, listenerCount } from '../../src/kernel/bus';
import { createFeatureManager, topoSort } from '../../src/kernel/features';
import { createServices } from '../../src/kernel/services';
import { createStore } from '../../src/kernel/store';
import { parseFlags } from '../../src/kernel/flags';

const mod = (id: string, extra: Partial<FeatureModule> = {}): FeatureModule => ({ id, ...extra });
const manager = (modules: FeatureModule[], overrides: Record<string, boolean> = {}, debug = false) => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const m = createFeatureManager(modules, overrides, debug, (w) => warnings.push(w), (e) => errors.push(e));
  return { m, warnings, errors, enabled: () => m.records.filter((r) => r.enabled).map((r) => r.id) };
};
const baseCtx = (): AppContext => ({
  store: createStore(parseFlags('', () => {}), false),
  bus: createBus(),
  services: createServices(),
  registries: {} as AppContext['registries'],
  flags: parseFlags('', () => {}),
  clock: {} as AppContext['clock'],
  assets: {} as AppContext['assets'],
  sim: {} as AppContext['sim'],
  dom: {} as AppContext['dom'],
});

describe('topoSort', () => {
  it('puts requirements first, ties alphabetical', () => {
    const req: Record<string, string[]> = { renderer: [], camera: ['renderer'], attract: ['camera'], controls: [], debug: ['renderer'], zeta: [] };
    expect(topoSort(Object.keys(req).sort(), (id) => req[id]!)).toEqual(['controls', 'renderer', 'camera', 'attract', 'debug', 'zeta']);
  });

  it('throws on a cycle, naming its members', () => {
    const req: Record<string, string[]> = { a: ['c'], b: ['a'], c: ['b'], d: [] };
    expect(() => topoSort(['a', 'b', 'c', 'd'], (id) => req[id]!)).toThrow('Feature dependency cycle among: a, b, c');
  });

  it('manager boot throws on a cycle among enabled features', () => {
    expect(() => manager([mod('a', { requires: ['b'] }), mod('b', { requires: ['a'] })])).toThrow(/cycle/);
  });
});

describe('enable resolution', () => {
  it('defaults, overrides, ?debug and duplicates', () => {
    const mods = [mod('a'), mod('b', { defaultEnabled: false }), mod('debug', { defaultEnabled: false })];
    expect(manager(mods).enabled()).toEqual(['a']);
    expect(manager(mods, { a: false, b: true }).enabled()).toEqual(['b']);
    expect(manager(mods, {}, true).enabled()).toEqual(['a', 'debug']);
    expect(manager(mods, { debug: false }, true).enabled()).toEqual(['a']);
    const { warnings } = manager(mods, { nope: true });
    expect(warnings).toEqual(['?features: unknown feature "nope"']);
    expect(() => manager([mod('a'), mod('a')])).toThrow('Duplicate feature id "a"');
  });

  it('cascade-disables dependents of disabled or unknown features', () => {
    const mods = [mod('renderer'), mod('camera', { requires: ['renderer'] }), mod('attract', { requires: ['camera'] }), mod('poll', { requires: ['live-lab'] }), mod('controls')];
    const { enabled, warnings, m } = manager(mods, { renderer: false });
    expect(enabled()).toEqual(['controls']);
    expect(warnings).toHaveLength(3);
    expect(warnings).toContain('Feature "poll" disabled: requires unknown feature "live-lab"');
    expect(m.records.map((r) => r.id)).toEqual(['controls', 'attract', 'camera', 'poll', 'renderer']);
  });
});

describe('lifecycle', () => {
  it('contributes, inits in order, isolates init failures (sync and async) and runs their disposers', async () => {
    const log: string[] = [];
    const mods = [
      mod('a', { contribute: () => void log.push('contribute a'), init: () => void log.push('init a') }),
      mod('bad', {
        init(ctx) {
          ctx.addDisposer(() => log.push('dispose bad'));
          throw new Error('boom');
        },
      }),
      mod('needs-bad', { requires: ['bad'], init: () => void log.push('init needs-bad') }),
      mod('rejects', { init: async () => Promise.reject(new Error('later')) }),
      mod('z', { init: async () => void log.push('init z') }),
    ];
    const { m, errors, enabled } = manager(mods);
    m.contribute({} as AppContext['registries']);
    await m.init(baseCtx());
    expect(log).toEqual(['contribute a', 'init a', 'dispose bad', 'init z']);
    expect(enabled()).toEqual(['a', 'z']);
    expect(errors).toEqual(['Feature "bad" init failed: boom', 'Feature "rejects" init failed: later']);
    expect(m.records.find((r) => r.id === 'bad')?.error).toBe('Feature "bad" init failed: boom');
  });

  it('update: phases, per-feature isolation, disabled after 3 consecutive throws', async () => {
    let n = 0;
    const seen: string[] = [];
    const disposed = vi.fn();
    const mods = [
      mod('flaky', {
        update() {
          n++;
          if (n !== 3) throw new Error(`throw ${n}`); // throws 1, 2, ok, 4, 5, 6 -> disabled at 6
        },
        dispose: disposed,
      }),
      mod('ok', { phase: 'overlay', update: () => void seen.push('ok') }),
    ];
    const { m, errors } = manager(mods);
    await m.init(baseCtx());
    const info = {} as FrameInfo;
    for (let i = 0; i < 8; i++) for (const p of ['scene', 'camera', 'render', 'overlay'] as const) m.update(p, info);
    expect(n).toBe(6);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(m.records.find((r) => r.id === 'flaky')?.enabled).toBe(false);
    expect(errors.at(-1)).toBe('Feature "flaky" update failed: throw 6');
    expect(errors).toHaveLength(5);
    expect(seen).toHaveLength(8);
  });

  it('scoped context: provide/on/watch/addDisposer are undone on dispose, in reverse order', async () => {
    const ctx = baseCtx();
    const KEY = serviceKey<number>('answer');
    const order: string[] = [];
    let watched = 0;
    const mods = [
      mod('a', {
        init(c) {
          expect(c.featureId).toBe('a');
          c.services.provide(KEY, 42);
          c.on('app:ready', () => {});
          c.watch(() => watched++);
          c.addDisposer(() => order.push('a1'));
          c.addDisposer(() => order.push('a2'));
        },
        dispose: () => void order.push('a.dispose'),
      }),
      mod('b', { requires: ['a'], init: (c) => c.addDisposer(() => order.push('b')) }),
    ];
    const { m } = manager(mods);
    await m.init(ctx);
    expect(ctx.services.get(KEY)).toBe(42);
    expect(listenerCount(ctx.bus)).toBe(1);
    expect(watched).toBe(1); // subscribe fires immediately
    ctx.store.setKey('xray', true);
    expect(watched).toBe(2);
    m.disposeAll();
    expect(order).toEqual(['b', 'a.dispose', 'a2', 'a1']);
    expect(ctx.services.tryGet(KEY)).toBeUndefined();
    expect(listenerCount(ctx.bus)).toBe(0);
    ctx.store.setKey('xray', false);
    expect(watched).toBe(2);
  });

  it('disable() cascades to dependents at runtime', async () => {
    const { m, enabled } = manager([mod('renderer'), mod('debug', { requires: ['renderer'] }), mod('controls')]);
    await m.init(baseCtx());
    m.disable('renderer', 'lost context');
    expect(enabled()).toEqual(['controls']);
    expect(m.records.find((r) => r.id === 'renderer')?.error).toBe('lost context');
  });
});
