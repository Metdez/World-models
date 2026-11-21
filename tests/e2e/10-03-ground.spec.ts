/**
 * 10-03 proving-ground visuals (ARCHITECTURE-M2 §8.4): the annex boots cleanly, each station renders with the car on it,
 * the annex stays inside its draw-call budget, the terrain re-bake's load time is measured, and `?features=-proving-ground`
 * boots without the annex. Screenshots (1280x720, DPR 1) go to SHOTS_DIR. Judged under a software renderer (SwiftShader).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/10-03-shots';
mkdirSync(SHOTS, { recursive: true });
const STATIONS = ['ride-street', 'steering-pad', 'slalom', 'lane-change', 'braking-platform'] as const;
const QUALITY = process.env.QUALITY ?? 'low';

type View = readonly [number, number, number];
/** Free test views (sim x, y, z: eye, target). */
const VIEWS: Record<string, [View, View, number?, boolean?]> = {
  overview: [[-60, -140, 260], [-40, 260, 0], 50, false],
  'overview-annex': [[-40, 40, 140], [-40, 300, 0], 55, false],
  'spur-east': [[60, -14, 9], [100, 25, 0]],
  'spur-west': [[-10, -12, 9], [-50, 30, 0]],
  'ride-modules': [[-24, 118, 3.2], [40, 125, 0]],
  'ride-pave': [[-136, 119, 2.2], [-110, 126, 0]],
  'ride-sleepers': [[-66, 119.5, 2.2], [-40, 125, 0]],
  'wet-lanes': [[130, 240, 6], [150, 300, 0]],
  circle: [[-170, 280, 30], [-170, 340, 0]],
  slalom: [[-120, 272, 6], [-40, 282, 0]],
  'lane-gates': [[-130, 392, 5], [-80, 403, 0]],
};

const measure = (page: Page, name: string) => page.evaluate((n) => performance.getEntriesByName(n).map((e) => e.duration)[0] ?? NaN, name);
const draws = async (page: Page) => (await page.evaluate(() => globalThis.__app!.stats()))!;

async function settle(page: Page, seconds: number) {
  await page.evaluate((s) => globalThis.__app!.advance(s), seconds);
  // two rendered frames after the step
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('10-03 proving ground', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  test.setTimeout(600_000);

  test('stations, overview and spur joins render; budgets and load time', async ({ page }) => {
    const errors = captureConsole(page);
    const report: string[] = [];
    for (const id of STATIONS) {
      await waitForReady(page, `/?e2e=1&quality=${QUALITY}&paused=1&drive=manual&spawn=${id}`);
      await settle(page, 1.5);
      const d = await page.evaluate(() => globalThis.__app!.drive());
      report.push(`${id}: mode ${d.mode} zone ${d.zone} at (${d.x.toFixed(1)}, ${d.y.toFixed(1)})`);
      await page.screenshot({ path: join(SHOTS, `10-03-${id}.png`) });
      if (id === 'steering-pad') {
        const s = await draws(page);
        report.push(`draws at ${id} (${QUALITY}): ${s.calls} calls, ${s.triangles} triangles`);
      }
    }
    report.push(`load: track-ribbon ${(await measure(page, 'track-ribbon')).toFixed(0)} ms, track-terrain ${(await measure(page, 'track-terrain')).toFixed(0)} ms, proving-ground-meshes ${(await measure(page, 'proving-ground-meshes')).toFixed(0)} ms`);
    for (const [name, [eye, at, fov, fog]] of Object.entries(VIEWS)) {
      const url = await page.evaluate(([e, t, f, g]) => globalThis.__annexView!(e as View, t as View, f as number | undefined, g as boolean | undefined), [eye, at, fov, fog] as const);
      writeFileSync(join(SHOTS, `10-03-${name}.png`), Buffer.from(url.split(',')[1]!, 'base64'));
    }
    console.log(report.join('\n'));
    await expectHealthyBoot(page, errors);
  });

  test('?features=-proving-ground boots and draws no annex', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, `/?e2e=1&quality=${QUALITY}&paused=1&features=-proving-ground`);
    const features = await page.evaluate(() => globalThis.__app!.features());
    expect(features.find((f) => f.id === 'proving-ground')?.enabled).toBe(false);
    await settle(page, 0.5);
    await page.screenshot({ path: join(SHOTS, '10-03-no-annex.png') });
    await expectHealthyBoot(page, errors);
  });
});
