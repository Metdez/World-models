import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { canvasVariance, captureConsole, expectHealthyBoot, waitForReady } from './helpers';

// Evidence screenshots (DPR 1); point SHOTS_DIR elsewhere to keep them.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/03-02-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1 });
// High-tier frames take seconds under SwiftShader: these ran 52–60 s against the 60 s default (03-01 SUMMARY).
test.describe.configure({ timeout: 120_000 });

/** Console warnings, minus Chromium's own readback notice caused by taking screenshots. */
function captureWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && !m.text().includes('GPU stall due to ReadPixels')) warnings.push(m.text());
  });
  return warnings;
}

async function shoot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: join(SHOTS, `03-02-${name}.png`) });
}

test('low tier: HDRI-lit scene without shadow/AO/bloom, zero console errors and warnings', async ({ page }) => {
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  const hdrs: string[] = [];
  page.on('request', (r) => r.url().endsWith('.hdr') && hdrs.push(r.url()));
  await waitForReady(page, '/?e2e=1&paused=1&t=20');
  expect(await page.evaluate(() => globalThis.__app!.state().quality)).toBe('low');
  expect((await page.evaluate(() => globalThis.__app!.features())).find((f) => f.id === 'environment')).toEqual({ id: 'environment', enabled: true });
  expect(hdrs.some((u) => u.includes('derelict_airfield'))).toBe(true);
  await page.evaluate(() => globalThis.__app!.advance(0.05));
  expect(await canvasVariance(page)).toBeGreaterThan(20);
  await shoot(page, 'low');
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});

test('high tier: post-processing ON (N8AO, bloom, SMAA, AgX) + sun shadow, zero console errors and warnings', async ({ page }) => {
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  let aoChunk = false;
  page.on('response', (r) => {
    if (/\/N8AO-[^/]+\.js$/.test(r.url()) && r.ok()) aoChunk = true;
  });
  await waitForReady(page, '/?e2e=1&paused=1&t=20&quality=high');
  expect(aoChunk).toBe(true);
  await page.evaluate(() => globalThis.__app!.advance(0.05));
  const stats = await page.evaluate(() => globalThis.__app!.stats());
  expect(stats?.pixelRatio).toBe(1);
  // Shadow pass + AO depth/normal pass + bloom mip chain on top of the scene draws.
  expect(stats?.calls).toBeGreaterThan(40);
  expect(stats?.calls).toBeLessThanOrEqual(250);
  expect(await canvasVariance(page)).toBeGreaterThan(20);
  await shoot(page, 'high');
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});

test('closeup swaps to the studio HDRI; runtime tier changes recompile cleanly', async ({ page }) => {
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  // The studio HDRI preloads right after app:ready, so listen before navigating.
  const studio = page.waitForResponse((r) => r.url().includes('ferndale_studio') && r.ok());
  await waitForReady(page, '/?e2e=1&paused=1&t=5&quality=high');
  const follow = await shoot(page, 'high-follow');
  await page.evaluate(() => globalThis.__app!.set('view', 'closeup'));
  await studio;
  await page.waitForTimeout(500); // PMREM + a few frames
  const closeup = await shoot(page, 'high-closeup');
  expect(closeup.equals(follow)).toBe(false);

  for (const tier of ['low', 'medium', 'high'] as const) {
    await page.evaluate((q) => globalThis.__app!.set('quality', q), tier);
    await page.waitForTimeout(300);
    await page.evaluate(() => globalThis.__app!.advance(0.05));
  }
  await page.evaluate(() => globalThis.__app!.set('view', 'follow'));
  await page.waitForTimeout(300);
  expect(await canvasVariance(page)).toBeGreaterThan(20);
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});
