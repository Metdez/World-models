import { describe, expect, it } from 'vitest';
import { parseFlags } from '../../src/kernel/flags';
import { createStore } from '../../src/kernel/store';

function parse(search: string) {
  const warnings: string[] = [];
  return { flags: parseFlags(search, (m) => warnings.push(m)), warnings };
}

describe('parseFlags (§8)', () => {
  it('defaults', () => {
    const { flags, warnings } = parse('');
    expect(flags).toEqual({ features: {}, paused: false, screen: false, debug: false, e2e: false });
    expect(warnings).toEqual([]);
  });

  it.each([
    ['?features=-audio,+debug', { features: { audio: false, debug: true } }],
    ['?features=-audio,%2Bdebug,camera', { features: { audio: false, debug: true, camera: true } }],
    ['?vehicle=cafe-racer', { vehicle: 'cafe-racer' }],
    ['?suspension=double-wishbone', { suspension: 'double-wishbone' }],
    ['?view=closeup', { view: 'closeup' }],
    ['?quality=medium', { quality: 'medium' }],
    ['?t=12.5', { lapTime: 12.5 }],
    ['?paused=1', { paused: true }],
    ['?amp=2.5', { amplification: 2.5 }],
    ['?clock=local', { clock: 'local' }],
    ['?attract=0', { attract: false }],
    ['?attract=1', { attract: true }],
    ['?room=ab2cd', { room: 'AB2CD' }],
    ['?screen=1', { screen: true }],
    ['?debug=1', { debug: true }],
    ['?e2e=1', { e2e: true }],
  ])('%s', (search, expected) => {
    const { flags, warnings } = parse(search);
    expect(flags).toMatchObject(expected);
    expect(warnings).toEqual([]);
  });

  it.each(['?view=top', '?quality=ultra', '?t=-1', '?t=abc', '?amp=0.5', '?clock=gps', '?room=LIVE', '?room=ABCDE1', '?paused=yes', '?vehicle=Bad_Id', '?bogus=1', '?features=-Bad!'])(
    'warns and ignores %s',
    (search) => {
      const { flags, warnings } = parse(search);
      expect(warnings).toHaveLength(1);
      expect(flags).toEqual({ features: {}, paused: false, screen: false, debug: false, e2e: false });
    },
  );
});

describe('createStore (§6.2 step 2)', () => {
  const store = (search: string, reduced = false) => createStore(parseFlags(search, () => {}), reduced).get();

  it('initial state without flags', () => {
    const s = store('');
    expect(s).toMatchObject({ vehicleId: 'gt-coupe', suspensionId: 'double-wishbone', clock: 'live', quality: 'high', paused: false, reducedMotion: false });
  });

  it('overlays flags; ?t and ?paused force the local clock; e2e defaults quality to low', () => {
    expect(store('?vehicle=cafe-racer&suspension=moto-modern&view=explore&amp=2.5&attract=1', true)).toMatchObject({
      vehicleId: 'cafe-racer',
      suspensionId: 'moto-modern',
      view: 'explore',
      amplification: 2.5,
      attract: true,
      reducedMotion: true,
    });
    expect(store('?t=10').clock).toBe('local');
    expect(store('?paused=1')).toMatchObject({ paused: true, clock: 'local' });
    expect(store('?clock=local').clock).toBe('local');
    expect(store('?e2e=1').quality).toBe('low');
    expect(store('?e2e=1&quality=high').quality).toBe('high');
  });
});
