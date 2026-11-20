import { expect, test, type Page } from '@playwright/test';
import { SIM_DT } from '../../src/contracts/units';
import { canvasVariance, captureConsole, expectHealthyBoot } from './helpers';

// SwiftShader renders about one frame per second on a loaded machine: boot (shader compile + first frame) can take
// well over the helpers' 20 s, so the smoke allows for it rather than flaking.
test.describe.configure({ timeout: 120_000 });

async function waitForReady(page: Page, path = '/?e2e=1'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 90_000 });
}

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
  await waitForReady(page, '/?e2e=1&debug=1'); // e2e keeps the room offline and attract mode off
  await expect(page.locator('#overlay .sl-debug-stats canvas').first()).toBeVisible();
  await expectHealthyBoot(page, consoleErrors);
});
