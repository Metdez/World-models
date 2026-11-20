/** The frozen files must equal the code blocks in ARCHITECTURE.md byte for byte (§5, §9.1, §12.1, §12.2). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const md = read('.planning/ARCHITECTURE.md');

/** First fenced block of `lang` after the heading line that starts with `heading`. */
function blockAfter(heading: string, lang: string): string {
  const start = md.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const open = md.indexOf(`\n\`\`\`${lang}\n`, start);
  const close = md.indexOf('\n```\n', open + 1);
  return `${md.slice(open + lang.length + 5, close)}\n`;
}

const contracts = [...md.matchAll(/^### (5\.\d+) `([^`]+)`$/gm)].map((m) => ({ section: m[1]!, path: m[2]! }));

describe('contracts verbatim', () => {
  it('finds all twelve contract blocks', () => {
    expect(contracts.map((c) => c.path)).toEqual(
      ['units', 'suspension', 'vehicle', 'track', 'telemetry', 'sim', 'events', 'store', 'app', 'services', 'net', 'engineer'].map(
        (n) => `src/contracts/${n}.ts`,
      ),
    );
  });

  it.each(contracts)('$path equals §$section', ({ section, path }) => {
    expect(read(path)).toBe(blockAfter(`### ${section} `, 'ts'));
  });

  it.each([
    { path: 'src/app/features.ts', heading: '### 9.1 ', lang: 'ts' },
    { path: 'wrangler.jsonc', heading: '### 12.1 ', lang: 'jsonc' },
    { path: 'worker/index.ts', heading: '### 12.2 ', lang: 'ts' },
  ])('$path equals its ARCHITECTURE block', ({ path, heading, lang }) => {
    expect(read(path)).toBe(blockAfter(heading, lang));
  });

  it('registers 21 features, each pointing at an existing folder', () => {
    const lines = [...read('src/app/features.ts').matchAll(/^export \{ default as \w+ \} from '\.\.\/features\/([a-z-]+)\/index';$/gm)];
    expect(lines).toHaveLength(21);
    for (const [, id] of lines) expect(read(`src/features/${id}/index.ts`)).toContain(`id: '${id}'`);
  });
});
