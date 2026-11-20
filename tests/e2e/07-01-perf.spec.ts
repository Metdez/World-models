/**
 * 07-01: renderer.info budgets in the real app (SwiftShader: counts only, frame times are meaningless here).
 * Draw calls and triangles per tier for the car and the bike, in follow and in the close-up; ≤ 250 calls everywhere;
 * GPU geometries/textures do not grow over repeated suspension and vehicle swaps (nothing leaks).
 */
import { expect, test, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

test.use({ deviceScaleFactor: 1, viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
test.setTimeout(3_600_000);

const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let k = 0;
        const f = () => (++k >= count ? resolve() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
const stats = async (page: Page) => (await page.evaluate(() => globalThis.__app!.stats()))!;
const set = (page: Page, key: string, value: unknown) => page.evaluate(([k, v]) => globalThis.__app!.set(k as never, v as never), [key, value] as const);
const until = (page: Page, key: string, value: unknown) =>
  page.waitForFunction(([k, v]) => (globalThis.__app!.state() as unknown as Record<string, unknown>)[k as string] === v, [key, value] as const, { timeout: 600_000 });

test('draw calls and triangles per tier for car and bike stay in budget; swaps leak no GPU resources', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await page.goto('/?e2e=1&paused=1&t=14&quality=high');
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 600_000 });

  const rows: string[] = [];
  for (const tier of ['high', 'medium', 'low'] as const) {
    await set(page, 'quality', tier);
    for (const vehicle of ['gt-coupe', 'cafe-racer'] as const) {
      await set(page, 'vehicleId', vehicle);
      await until(page, 'vehicleId', vehicle);
      for (const view of ['follow', 'closeup'] as const) {
        await set(page, 'view', view);
        await frames(page, 3);
        const s = await stats(page);
        rows.push(`${tier.padEnd(6)} ${vehicle.padEnd(10)} ${view.padEnd(7)} calls ${String(s.calls).padStart(3)}  triangles ${s.triangles}`);
        expect(s.calls, `${tier} ${vehicle} ${view}`).toBeLessThanOrEqual(250);
      }
    }
  }
  console.log(`[07-01] renderer.info per tier\n${rows.join('\n')}`);

  // Leak check on the high tier: warm every suspension and both vehicles once, then three more rounds.
  await set(page, 'quality', 'high');
  await set(page, 'view', 'follow');
  const round = async () => {
    for (const [vehicle, suspensions] of [
      ['gt-coupe', ['macpherson', 'double-wishbone', 'multilink']],
      ['cafe-racer', ['moto-classic', 'moto-modern', 'moto-telelever']],
    ] as const) {
      await set(page, 'vehicleId', vehicle);
      await until(page, 'vehicleId', vehicle);
      for (const id of suspensions) {
        await set(page, 'suspensionId', id);
        await until(page, 'suspensionId', id);
        await frames(page, 2);
      }
    }
    return stats(page);
  };
  const warm = await round();
  const after: { geometries: number; textures: number }[] = [];
  for (let i = 0; i < 3; i++) after.push(await round());
  console.log(`[07-01] GPU resources after warm-up ${warm.geometries} geometries / ${warm.textures} textures; after 3 rounds ${after.map((a) => `${a.geometries}/${a.textures}`).join(', ')}`);
  for (const a of after) {
    expect(a.geometries).toBe(warm.geometries);
    expect(a.textures).toBe(warm.textures);
  }
  expect(await page.evaluate(() => globalThis.__app!.errors)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
