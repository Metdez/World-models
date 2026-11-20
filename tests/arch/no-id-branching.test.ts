/** Content ids never appear in conditionals in kernel or features (ARCHITECTURE §2 rule 8). */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.[cm]?[jt]s$/.test(e.name) ? [join(dir, e.name)] : [],
  );

/** Every registered id: content ids and the visual keys they register under. */
const IDS = [...new Set([provingLoop, gtCoupe, macpherson, doubleWishbone, multilink].flatMap((d) => [d.id, d.visualKey]))];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function branches(text: string, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const q = `['"\`]${escape(id)}['"\`]`;
    return new RegExp(`[!=]==?\\s*${q}|${q}\\s*[!=]==?|\\bcase\\s+${q}`).test(text);
  });
}

describe('no content-id branching (§2 rule 8)', () => {
  it('the matcher catches comparisons and case labels', () => {
    expect(branches(`if (v.id === 'gt-coupe') x();`, IDS)).toEqual(['gt-coupe']);
    expect(branches(`if ("multilink" !== s) x();`, IDS)).toEqual(['multilink']);
    expect(branches(`switch (k) { case 'db11': }`, IDS)).toEqual(['db11']);
    expect(branches(`register(gtCoupe); const label = 'gt-coupe';`, IDS)).toEqual([]);
  });

  it('src/kernel and src/features never compare against a registered id', () => {
    const found = ['src/kernel', 'src/features'].flatMap((dir) =>
      sources(join(root, dir)).flatMap((file) => branches(readFileSync(file, 'utf8'), IDS).map((id) => `${relative(root, file)}: ${id}`)),
    );
    expect(found).toEqual([]);
  });
});
