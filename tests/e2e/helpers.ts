import { expect, type Page } from '@playwright/test';
import type {} from '../../src/kernel/test-hooks'; // declares window.__app

/** Collects console errors and uncaught page errors from the moment it is called. */
export function captureConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  return errors;
}

/** Navigates and waits for `window.__app.ready` (boot finished, first frame rendered). */
export async function waitForReady(page: Page, path = '/?e2e=1'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 20_000 });
}

/** Greyscale pixel variance of the stage canvas, from a composited screenshot decoded in the page. */
export async function canvasVariance(page: Page): Promise<number> {
  const png = await page.locator('#stage canvas').first().screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    if (!g) return 0;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    return sq / n - mean * mean;
  }, png.toString('base64'));
}

/** Boot invariants every spec can reuse. */
export async function expectHealthyBoot(page: Page, consoleErrors: readonly string[]): Promise<void> {
  expect(await page.evaluate(() => globalThis.__app?.errors ?? ['no __app'])).toEqual([]);
  expect(consoleErrors).toEqual([]);
}
