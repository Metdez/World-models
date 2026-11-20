/** Credits (CRED-01): attribution text and the CREDITS.md mirror of the in-app panel. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Attribution } from '../../src/contracts/app';
import { CODE_CREDITS, LICENSE_TEXTS } from '../../src/features/credits/code-credits';
import { attributionText } from '../../src/features/credits/text';

const attributions = JSON.parse(readFileSync('assets-src/ATTRIBUTION.json', 'utf8')) as Attribution[];
const md = readFileSync('CREDITS.md', 'utf8');
const DB11 =
  '"Aston Martin db11" by Black Snow (https://sketchfab.com/BlackSnow02) is licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7. Modified: optimised/compressed (meshopt), decimated, re-materialed, badges hidden.';

describe('attributionText', () => {
  it('produces the exact DB11 CC BY text (ARCHITECTURE §15)', () => {
    const db11 = attributions.find((a) => a.license === 'CC-BY-4.0');
    expect(db11 && attributionText(db11)).toBe(DB11);
  });

  it('names title, author, licence and source for every CC0 entry', () => {
    for (const a of attributions.filter((x) => x.license === 'CC0-1.0')) {
      const t = attributionText(a);
      expect(t).toContain(`"${a.title}" by ${a.author}`);
      expect(t).toContain('CC0 1.0');
      expect(t).toContain(a.sourceUrl);
    }
  });
});

describe('CREDITS.md mirrors the panel', () => {
  it('contains the exact DB11 text', () => expect(md).toContain(DB11));

  it.each(attributions.map((a) => [a.title, a] as const))('lists asset "%s"', (_t, a) => {
    expect(md).toContain(`"${a.title}"`);
    expect(md).toContain(a.author);
    expect(md).toContain(a.sourceUrl);
  });

  it.each(CODE_CREDITS.map((k) => [k.name, k] as const))('lists code credit %s with licence and copyright', (_n, k) => {
    expect(md).toContain(`| [${k.name}](${k.url}) | ${k.use} | ${k.license} | ${k.copyright} |`);
  });

  it('reproduces the full BSD-3 notice and the MIT permission text', () => {
    expect(md).toContain(LICENSE_TEXTS['BSD-3-Clause']);
    expect(md).toContain(LICENSE_TEXTS.MIT);
  });
});
