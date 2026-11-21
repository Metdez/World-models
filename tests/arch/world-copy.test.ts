/**
 * World copy (ARCHITECTURE-M2 §13 rules 4 and 7): world, zone and station copy carries no digits (every number shown
 * comes from the simulation), never names or ranks a suspension type, surface grip is called approximate, and tyre-grip
 * stations say they are not suspension lessons.
 */
import { describe, expect, it } from 'vitest';
import { SURFACES } from '../../src/contracts/world';
import { provingGround } from '../../src/sim-core/content/proving-ground';

const WORLDS = [provingGround];
const RANKING = /\b(best|better|worse|worst|superior|inferior|wins?|winner|beats?|outperforms?|fastest|safest|ideal)\b/i;
const TYPE_NAMES = /mac\s*pherson|wishbone|multi-?\s*link|strut|telelever|double\s+a-?arm/i;

const copyOf = (w: (typeof WORLDS)[number]): string[] => [
  w.name,
  ...w.zones.map((z) => z.name),
  ...w.stations.flatMap((s) => [s.name, s.caption, s.experiment]),
];

describe('world copy (§13)', () => {
  it('the matchers catch digits, rankings and type names', () => {
    expect(/\d/.test('Brake from 50 km/h')).toBe(true);
    expect(RANKING.test('The multilink is better here')).toBe(true);
    expect(TYPE_NAMES.test('Swap to the double wishbone')).toBe(true);
    expect(RANKING.test('Watch the outside wheels')).toBe(false);
  });

  it.each(WORLDS.map((w) => [w.id, copyOf(w)] as const))('%s: no digits, no suspension names or rankings', (_id, texts) => {
    expect(texts.length).toBeGreaterThan(10);
    expect(texts.filter((t) => /\d/.test(t))).toEqual([]);
    expect(texts.filter((t) => RANKING.test(t))).toEqual([]);
    expect(texts.filter((t) => TYPE_NAMES.test(t))).toEqual([]);
    expect(texts.filter((t) => t.trim().length === 0)).toEqual([]);
  });

  it('tyre-grip stations say so; their grip is approximate', () => {
    for (const w of WORLDS)
      for (const s of w.stations.filter((st) => !st.suspension)) {
        expect(s.caption).toMatch(/tyre grip demonstration, not a suspension lesson/i);
        expect(s.caption).toMatch(/approximate surface grip/i);
      }
  });

  it('surface labels carry no digits', () => {
    expect(Object.values(SURFACES).filter((s) => /\d/.test(s.label))).toEqual([]);
  });
});
