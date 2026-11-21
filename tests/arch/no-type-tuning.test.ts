/**
 * No per-suspension-type handling constant (ARCHITECTURE-M2 §0.2, §2): suspension ids never appear, and nothing
 * compares a suspension id, in src/sim-core/drive/**, src/sim-core/world/** or the handling content files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SCOPE = [
  'src/sim-core/drive',
  'src/sim-core/world',
  'src/sim-core/content/gt-coupe-handling.ts',
  'src/sim-core/content/gt-coupe-tyres.ts',
  'src/sim-core/content/gt-coupe-powertrain.ts',
];
const SUSPENSION_ID = /macpherson|double-wishbone|multilink|moto-[a-z]+/i;
const ID_COMPARE = /suspension\.id|\.id\s*[!=]==?|[!=]==?\s*\w+\.id\b/;

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((e) => files(join(path, e)));
  return /\.ts$/.test(path) ? [path] : [];
}
function violations(sources: readonly { path: string; text: string }[]): string[] {
  return sources.flatMap(({ path, text }) =>
    text.split('\n').flatMap((line, i) => (SUSPENSION_ID.test(line) || ID_COMPARE.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
  );
}

describe('no suspension-type tuning in the plant', () => {
  it('detects ids and id comparisons (self-check)', () => {
    expect(violations([{ path: 'a.ts', text: "const k = s === 'multilink' ? 2 : 1;\nif (suspension.id) x();\nif (a.id === b) y();" }])).toHaveLength(3);
    expect(violations([{ path: 'b.ts', text: 'const rate = compliance.bushingRates.strut; // per role, shared' }])).toEqual([]);
  });

  it('drive/, world/ and the handling content name no suspension type', () => {
    const sources = SCOPE.flatMap((p) => files(join(root, p))).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));
    expect(sources.length).toBeGreaterThan(5);
    expect(violations(sources)).toEqual([]);
  });
});
