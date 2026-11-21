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
/** Free test views (sim x, y, height above the ground: eye, target; fov; fog), taken on the page of a station so the
 *  sun's shadow map (which follows the car) covers them. */
type Shot = [name: string, eye: View, target: View, fov?: number, fog?: boolean];
const VIEWS: Record<(typeof STATIONS)[number], Shot[]> = {
  'ride-street': [
    ['ride-washboard', [-226, 121, 1.4], [-180, 125, 0]],
    ['ride-pave', [-146, 120.5, 1.6], [-110, 125, 0]],
    ['ride-sleepers', [-68, 121, 1.3], [-45, 124.5, 0]],
    ['ride-steps-twist', [-12, 121.5, 1.3], [30, 124.5, 0]],
    ['ride-pothole', [45, 120.5, 1.6], [53.5, 124.8, 0]],
  ],
  'steering-pad': [['circle', [-170, 270, 35], [-170, 335, 0]], ['overview', [-30, -560, 380], [-20, 170, 0], 45, false]],
  slalom: [['slalom', [-120, 272, 5], [-40, 282, 0]], ['overview-annex', [-40, 20, 160], [-40, 300, 0], 55, false]],
  'lane-change': [['lane-gates', [-132, 394, 4], [-80, 403, 0]]],
  'braking-platform': [
    ['wet-lanes', [136, 250, 4], [150, 290, 0]],
    ['spur-east', [70, -12, 8], [100, 25, 0]],
    ['spur-west', [-15, -12, 8], [-50, 30, 0]],
  ],
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
      for (const [name, eye, at, fov, fog] of VIEWS[id]) {
        const url = await page.evaluate(([e, t, f, g]) => globalThis.__annexView!(e as View, t as View, f as number | undefined, g as boolean | undefined), [eye, at, fov, fog] as const);
        writeFileSync(join(SHOTS, `10-03-${name}.png`), Buffer.from(url.split(',')[1]!, 'base64'));
      }
      if (id === 'steering-pad') {
        const s = await draws(page);
        report.push(`draws at ${id} (${QUALITY}): ${s.calls} calls, ${s.triangles} triangles`);
      }
    }
    report.push(`load: track-ribbon ${(await measure(page, 'track-ribbon')).toFixed(0)} ms, track-terrain ${(await measure(page, 'track-terrain')).toFixed(0)} ms, proving-ground-meshes ${(await measure(page, 'proving-ground-meshes')).toFixed(0)} ms`);
    console.log(report.join('\n'));
    await expectHealthyBoot(page, errors);
  });

  test('draw calls with and without the annex (high tier)', async ({ page }) => {
    const errors = captureConsole(page);
    const out: string[] = [];
    const at = async (query: string) => {
      await waitForReady(page, `/?e2e=1&quality=high&paused=1&${query}`);
      await settle(page, 0.5);
      return draws(page);
    };
    // the M1 measuring point (lap t = 14 s, follow view): the annex is in view past the loop
    const without = await at('t=14&features=-proving-ground');
    const withAnnex = await at('t=14');
    out.push(`loop t=14 high: without annex ${without.calls} calls / ${without.triangles} tris; with ${withAnnex.calls} / ${withAnnex.triangles}`);
    expect(withAnnex.calls - without.calls).toBeLessThanOrEqual(25);
    expect(withAnnex.calls).toBeLessThanOrEqual(250);
    for (const id of ['steering-pad', 'ride-street', 'braking-platform']) {
      const s = await at(`drive=manual&spawn=${id}`);
      out.push(`${id} high: ${s.calls} calls / ${s.triangles} tris`);
      expect(s.calls).toBeLessThanOrEqual(250);
    }
    console.log(out.join('\n'));
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
