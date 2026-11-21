/**
 * Deterministic maths in the Manual Drive sim-core (ARCHITECTURE-M2 §2, §7.12): no transcendental Math.* and no
 * non-integer `**` in src/sim-core/{drive,world}/** and math/det.ts (09-03 widens the scope to all of sim-core).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../src/sim-core/', import.meta.url));
const SCOPE = ['drive', 'world', 'math/det.ts'];
const BANNED = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/;
// The §2 pattern with the whitespace moved into the lookahead (otherwise `\s*` backtracks and flags `x ** 2`).
const NON_INT_POW = /\*\*(?!\s*[-+]?\d+\b(?!\.))/;

function files(path: string): string[] {
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((e) => files(join(path, e)));
  return /\.ts$/.test(path) ? [path] : [];
}
/** Code only: comments are stripped (they quote formulas). */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
function violations(sources: readonly { path: string; text: string }[]): string[] {
  return sources.flatMap(({ path, text }) =>
    code(text)
      .split('\n')
      .flatMap((line, i) => (BANNED.test(line) || NON_INT_POW.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  );
}

describe('deterministic maths (drive, world, det kernels)', () => {
  it('detects banned calls and non-integer powers (self-check)', () => {
    expect(violations([{ path: 'a.ts', text: 'const a = Math.sin(x) + Math.hypot(1, 2);\nconst b = x ** 0.5;\nconst c = x ** y;' }])).toHaveLength(3);
    expect(violations([{ path: 'b.ts', text: 'const a = Math.sqrt(x) * x ** 2 + Math.abs(y); // Math.sin in a comment\n/* Math.exp */' }])).toEqual([]);
  });

  it('src/sim-core/{drive,world}/** and math/det.ts use only exact operations and det kernels', () => {
    const sources = SCOPE.flatMap((p) => files(join(root, p))).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    expect(sources.length).toBeGreaterThan(3);
    expect(violations(sources)).toEqual([]);
  });
});
