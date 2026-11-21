import { describe, expect, it } from 'vitest';
import { createAssets, EMPTY_MANIFEST } from '../../src/kernel/assets';
import { createBus, listenerCount } from '../../src/kernel/bus';
import { createClock } from '../../src/kernel/clock';
import { createRegistries, createRegistry } from '../../src/kernel/registry';
import { createServices } from '../../src/kernel/services';
import { serviceKey } from '../../src/contracts/app';

describe('registry', () => {
  it('registers, lists in order, requires and unregisters', () => {
    const r = createRegistry<{ id: string; n: number }>('thing');
    const off = r.register({ id: 'a', n: 1 });
    r.register({ id: 'b', n: 2 });
    expect(r.list().map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.get('a')?.n).toBe(1);
    expect(r.require('b').n).toBe(2);
    expect(() => r.register({ id: 'a', n: 3 })).toThrow('Duplicate thing "a"');
    expect(() => r.require('zz')).toThrow('Unknown thing "zz". Known: a, b');
    off();
    expect(r.get('a')).toBeUndefined();
    expect(r.list()).toHaveLength(1);
  });

  it('creates all six registries empty', () => {
    const regs = createRegistries();
    expect(Object.keys(regs).sort()).toEqual(['suspensionVisuals', 'suspensions', 'tracks', 'vehicleVisuals', 'vehicles', 'worlds']);
    for (const r of Object.values(regs)) expect(r.list()).toEqual([]);
  });
});

describe('services', () => {
  const KEY = serviceKey<{ hello(): string }>('greeter');
  it('provide / get / tryGet / un-provide', () => {
    const s = createServices();
    expect(s.tryGet(KEY)).toBeUndefined();
    expect(() => s.get(KEY)).toThrow('Service "greeter" is not provided');
    const off = s.provide(KEY, { hello: () => 'hi' });
    expect(s.get(KEY).hello()).toBe('hi');
    expect(() => s.provide(KEY, { hello: () => 'again' })).toThrow('already provided');
    off();
    expect(s.tryGet(KEY)).toBeUndefined();
  });
});

describe('clock, assets, bus', () => {
  it('clock applies the server offset and marks synced', () => {
    let now = 1000;
    const c = createClock(() => now);
    expect(c.serverNow()).toBe(1000);
    expect(c.synced).toBe(false);
    c.setOffset(250);
    now = 2000;
    expect(c.serverNow()).toBe(2250);
    expect(c.synced).toBe(true);
  });

  it('assets resolve ids and throw for unknown ones', () => {
    const a = createAssets({ ...EMPTY_MANIFEST, assets: { 'car/x': { id: 'car/x', url: '/assets/car/x.abc.glb', bytes: 3 } } });
    expect(a.url('car/x')).toBe('/assets/car/x.abc.glb');
    expect(() => a.url('nope')).toThrow('Unknown asset "nope"');
  });

  it('bus counts listeners', () => {
    const bus = createBus();
    const h = () => {};
    bus.on('app:ready', h);
    bus.on('user:activity', h);
    expect(listenerCount(bus)).toBe(2);
    bus.off('app:ready', h);
    expect(listenerCount(bus)).toBe(1);
  });
});
