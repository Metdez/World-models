import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { canvasVariance, captureConsole, expectHealthyBoot, waitForReady } from './helpers';

// Evidence screenshots (DPR 1); point SHOTS_DIR elsewhere to keep them.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/03-01-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1 });

/** Console warnings, minus Chromium's own readback notice caused by taking screenshots. */
function captureWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && !m.text().includes('GPU stall due to ReadPixels')) warnings.push(m.text());
  });
  return warnings;
}

test('track textures load, the road renders around the lap with zero console errors and warnings', async ({ page }) => {
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  test.setTimeout(240_000); // six boots with screenshots under SwiftShader
  const textures: string[] = [];
  page.on('response', (r) => r.ok() && r.url().includes('/assets/textures/') && textures.push(r.url()));
  // Launch washboard, bump strip, pavé, carousel, lane-change cones, run-in towards the start line.
  for (const t of [1, 15, 30, 50, 62, 82]) {
    await waitForReady(page, `/?e2e=1&paused=1&t=${t}`);
    expect((await page.evaluate(() => globalThis.__app!.features())).find((f) => f.id === 'track')).toEqual({ id: 'track', enabled: true });
    await page.evaluate(() => globalThis.__app!.advance(0.05));
    expect(await canvasVariance(page)).toBeGreaterThan(20);
    await page.screenshot({ path: join(SHOTS, `03-01-app-t${t}.png`) });
  }
  for (const set of ['asphalt_track', 'cobblestone_floor_08', 'concrete_floor_01', 'grass_ground']) expect(textures.some((u) => u.includes(set))).toBe(true);
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});

test('high tier (shadow, AO, fine ribbon) compiles cleanly and stays inside the frame budget', async ({ page }) => {
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  test.setTimeout(120_000);
  await waitForReady(page, '/?e2e=1&paused=1&t=14&quality=high');
  await page.evaluate(() => globalThis.__app!.advance(0.05));
  const stats = (await page.evaluate(() => globalThis.__app!.stats()))!;
  expect(stats.calls).toBeLessThanOrEqual(250);
  expect(stats.triangles).toBeLessThanOrEqual(1_500_000);
  await page.screenshot({ path: join(SHOTS, '03-01-app-high-t14.png') });
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});
