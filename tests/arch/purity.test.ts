/** sim-core must stay pure and deterministic (ARCHITECTURE §2 rule 6). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const simCore = fileURLToPath(new URL('../../src/sim-core/', import.meta.url));
const FORBIDDEN: readonly [string, RegExp][] = [
  ['Math.random', /\bMath\.random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
  ["from 'three'", /from\s+['"]three['"]/],
];

function sourceFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // sim-core does not exist before plan 01-02
  }
  return entries.flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.[cm]?[jt]s$/.test(e.name) ? [join(dir, e.name)] : []));
}

function violations(files: readonly { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) => FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => `${path}: ${name}`));
}

describe('sim-core purity', () => {
  it('detects forbidden tokens (self-check)', () => {
    expect(violations([{ path: 'x.ts', text: "import { Scene } from 'three'; const t = Date.now();" }])).toEqual([
      'x.ts: Date',
      "x.ts: from 'three'",
    ]);
    expect(violations([{ path: 'y.ts', text: 'const updated = 1; // performanceBudget' }])).toEqual([]);
  });

  it('no sim-core file uses non-deterministic or DOM/three APIs', () => {
    const files = sourceFiles(simCore).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    expect(violations(files)).toEqual([]);
  });
});
