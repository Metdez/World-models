import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SIM_DT } from '../../src/contracts/units';
import { createSimulation } from '../../src/sim-core/index';
import { canvasVariance, captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/02-04-shots';
mkdirSync(SHOTS, { recursive: true });

// Carousel apex lap time, from the same pure stateAt the app uses.
const sim = createSimulation({
  catalog: { track: () => undefined, vehicle: () => undefined, suspension: () => undefined },
  trackId: 'proving-loop',
  vehicleId: 'gt-coupe',
  suspensionId: 'double-wishbone',
});
const carousel = sim.track.sections.find((s) => s.id === 'carousel')!;
const APEX = sim.lapTimeAt((carousel.s0 + carousel.s1) / 2).toFixed(3);
const TYPES = ['macpherson', 'double-wishbone', 'multilink'] as const;

test('the real simulation drives the placeholder car around the proving loop', async ({ page }) => {
  const errors = captureConsole(page);
  await waitForReady(page, '/?e2e=1&paused=1&t=20');
  const features = await page.evaluate(() => globalThis.__app!.features());
  expect(features.filter((f) => f.id === 'car' || f.id === 'track')).toEqual([
    { id: 'car', enabled: true },
    { id: 'track', enabled: true },
  ]);
  const a = await page.evaluate(() => globalThis.__app!.frame());
  const b = await page.evaluate(() => {
    globalThis.__app!.advance(1);
    return globalThis.__app!.frame();
  });
  expect(a.lapTime).toBe(20);
  expect(Math.abs(b.lapTime - a.lapTime - 1)).toBeLessThanOrEqual(SIM_DT + 1e-9);
  expect(b.s - a.s).toBeGreaterThan(5); // the car moves along the track at road speed
  expect(b.speed).toBeGreaterThan(5);
  expect(b.corners.map((c) => c.load).every((l) => l > 0)).toBe(true);
  expect(await canvasVariance(page)).toBeGreaterThan(5);
  await page.screenshot({ path: join(SHOTS, '02-04-placeholder.png') });
  await expectHealthyBoot(page, errors);
});

test('carousel apex: double wishbone keeps the most outer-wheel camber; at the rear the strut loses the most', async ({ page }) => {
  const errors = captureConsole(page);
  const frames: Record<string, Awaited<ReturnType<NonNullable<typeof globalThis.__app>['frame']>>> = {};
  for (const id of TYPES) {
    await waitForReady(page, `/?e2e=1&paused=1&t=${APEX}&suspension=${id}`);
    expect(await page.evaluate(() => globalThis.__app!.state().suspensionId)).toBe(id);
    frames[id] = await page.evaluate(() => globalThis.__app!.frame());
    await page.screenshot({ path: join(SHOTS, `02-04-carousel-${id}.png`) });
  }
  const [mp, dw, ml] = TYPES.map((id) => frames[id]!);
  for (const f of [mp, dw, ml]) expect(f!.sectionId).toBe('carousel');
  // Same path for every type.
  expect(dw!.s).toBe(mp!.s);
  expect(ml!.s).toBe(mp!.s);
  // Right-hand carousel: outer wheels are fl (0) and rl (2); camber to road (+ = top leaning out, camber lost).
  const deg = (r: number) => (r * 180) / Math.PI;
  const report = TYPES.map(
    (id) =>
      `${id}: fl ${deg(frames[id]!.corners[0]!.camber).toFixed(2)} deg, rl ${deg(frames[id]!.corners[2]!.camber).toFixed(2)} deg, roll ${deg(frames[id]!.roll).toFixed(2)} deg`,
  );
  console.log(`[02-04 e2e] carousel apex t=${APEX}: ${report.join(' | ')}`);
  expect(dw!.corners[0]!.camber).toBeLessThan(mp!.corners[0]!.camber);
  expect(dw!.corners[0]!.camber).toBeLessThan(ml!.corners[0]!.camber);
  expect(mp!.corners[2]!.camber).toBeGreaterThan(ml!.corners[2]!.camber);
  expect(ml!.corners[2]!.camber).toBeGreaterThan(dw!.corners[2]!.camber);
  await expectHealthyBoot(page, errors);
});

test('a suspension swap takes effect at once and the car keeps its place on the lap', async ({ page }) => {
  const errors = captureConsole(page);
  await waitForReady(page, `/?e2e=1&paused=1&t=${APEX}`);
  const before = await page.evaluate(() => globalThis.__app!.frame());
  const after = await page.evaluate(() => {
    globalThis.__app!.set('suspensionId', 'macpherson');
    globalThis.__app!.advance(0.1);
    return globalThis.__app!.frame();
  });
  // The lap clock and the path carry on as if nothing happened (one SIM_DT of interpolation lag allowed).
  expect(Math.abs(after.lapTime - before.lapTime - 0.1)).toBeLessThanOrEqual(SIM_DT + 1e-9);
  expect(Math.abs(after.s - before.s - before.speed * (after.lapTime - before.lapTime))).toBeLessThan(0.05);
  expect(after.corners[0]!.camber).not.toBe(before.corners[0]!.camber);
  expect(await page.evaluate(() => globalThis.__app!.state().suspensionId)).toBe('macpherson');
  await expectHealthyBoot(page, errors);
});
