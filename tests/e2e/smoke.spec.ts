import { expect, test } from '@playwright/test';
import { SIM_DT } from '../../src/contracts/units';
import { canvasVariance, captureConsole, expectHealthyBoot, waitForReady } from './helpers';

test('boots, renders a non-blank scene, no errors', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await waitForReady(page);
  const features = await page.evaluate(() => globalThis.__app!.features());
  expect(features.find((f) => f.id === 'renderer')).toEqual({ id: 'renderer', enabled: true });
  const stats = await page.evaluate(() => globalThis.__app!.stats());
  expect(stats?.calls).toBeGreaterThan(0);
  expect(stats?.pixelRatio).toBe(1);
  expect(await canvasVariance(page)).toBeGreaterThan(5);
  await expectHealthyBoot(page, consoleErrors);
});

test('paused start is deterministic and advance() moves the lap clock', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await waitForReady(page, '/?e2e=1&paused=1&t=5');
  const before = await page.evaluate(() => globalThis.__app!.frame().lapTime);
  const after = await page.evaluate(() => {
    globalThis.__app!.advance(1);
    return globalThis.__app!.frame().lapTime;
  });
  // Rendering samples the previous fixed step after advance(): allow one SIM_DT of interpolation lag.
  expect(Math.abs(after - before - 1)).toBeLessThanOrEqual(SIM_DT + 1e-9);
  await expectHealthyBoot(page, consoleErrors);
});

test('?debug=1 shows the stats panel', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await waitForReady(page, '/?debug=1');
  await expect(page.locator('#overlay .sl-debug-stats canvas').first()).toBeVisible();
  await expectHealthyBoot(page, consoleErrors);
});
