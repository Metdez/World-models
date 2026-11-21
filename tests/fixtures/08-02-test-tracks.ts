/**
 * Test-only tracks for the 08-02 plant tests (not content): a near-circle skidpad (R 59 m for 90 deg, R 60 m for
 * 270 deg, two 1 m closure lines) and a rounded rectangle with 700 m straights for launch / braking runs. Flat (no
 * swell), roughness class A, a 30 m wide asphalt pad so the corridor bands stay asphalt within |l| <= 15 m.
 */
import type { TrackDefinition, TrackSegmentDefinition } from '../../src/contracts/track';
import type { SimCatalog } from '../../src/contracts/sim';

const seg = (id: string, primitives: TrackSegmentDefinition['primitives']): TrackSegmentDefinition => ({
  id,
  name: 'Test',
  primitives,
  phenomenon: 'steady-state-roll',
  caption: 'Test section',
  roughness: 'A',
});
const base = { name: 'Test pad', width: 30, kerbWidth: 0.5, runoff: 2.5, swell: { amplitude: 0, cycles: 1 }, seed: 7, visualKey: 'proving-loop' } as const;

export const skidpad: TrackDefinition = {
  ...base,
  id: 'test-skidpad',
  closure: ['a', 'b'],
  segments: [
    seg('a', [{ kind: 'line', length: 1 }]),
    seg('quarter', [{ kind: 'arc', radius: 59, angle: Math.PI / 2 }]),
    seg('b', [{ kind: 'line', length: 1 }]),
    seg('circle', [{ kind: 'arc', radius: 60, angle: (3 * Math.PI) / 2 }]),
  ],
};

export const strip: TrackDefinition = {
  ...base,
  id: 'test-strip',
  closure: ['a', 'b'],
  segments: [
    seg('a', [{ kind: 'line', length: 700 }]),
    seg('c1', [{ kind: 'arc', radius: 60, angle: Math.PI / 2 }]),
    seg('b', [{ kind: 'line', length: 300 }]),
    seg('c2', [{ kind: 'arc', radius: 60, angle: Math.PI / 2 }]),
    seg('back', [{ kind: 'line', length: 700 }]),
    seg('c3', [{ kind: 'arc', radius: 60, angle: Math.PI / 2 }]),
    seg('side', [{ kind: 'line', length: 300 }]),
    seg('c4', [{ kind: 'arc', radius: 60, angle: Math.PI / 2 }]),
  ],
};

/** A catalog that knows the test tracks (vehicles and suspensions fall back to the built-in content). */
export const testCatalog: SimCatalog = {
  track: (id) => (id === skidpad.id ? skidpad : id === strip.id ? strip : undefined),
  vehicle: () => undefined,
  suspension: () => undefined,
};
