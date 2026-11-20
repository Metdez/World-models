/** Content copy carries no digits: every number shown comes from the simulation (ARCHITECTURE §14 rule 1). */
import { describe, expect, it } from 'vitest';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';

const strings = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];

describe('content copy has no digits (§14)', () => {
  const copy: [string, string[]][] = [
    ...[macpherson, doubleWishbone, multilink].map((s): [string, string[]] => [s.id, strings(s.copy)]),
    [gtCoupe.id, [gtCoupe.name, gtCoupe.subtitle]],
    [provingLoop.id, [provingLoop.name, ...provingLoop.segments.flatMap((g) => [g.name, g.caption])]],
  ];
  it.each(copy)('%s', (_id, texts) => {
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => /\d/.test(t))).toEqual([]);
  });

  it('the vehicle is generic: representative parameters, no manufacturer name', () => {
    expect(gtCoupe.subtitle).toBe('Representative parameters');
    expect(`${gtCoupe.name} ${gtCoupe.subtitle}`).not.toMatch(/aston|martin|db11/i);
  });
});
