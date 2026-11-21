/**
 * 11-01 tyre VFX (ARCHITECTURE-M2 §10.5): grip rings under each tyre in steady cornering on the steering pad (unequal
 * sizes), a slide with the aids off (rings past the limit, skid marks), and an ABS-off stop on the braking platform's
 * split-grip lane (lock-up marks). Scripted with __app.driveIntent on a paused clock, 1/30 s per rendered frame.
 * Screenshots (1280x720, DPR 1) go to SHOTS_DIR; judged under a software renderer (SwiftShader).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../../src/features/tyre-vfx/index'; // declares window.__tyreVfx
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/11-01-shots';
mkdirSync(SHOTS, { recursive: true });
const QUALITY = process.env.QUALITY ?? 'low';
const boot = (spawn: string) => `/?e2e=1&quality=${QUALITY}&paused=1&drive=manual&spawn=${spawn}`;

type View = readonly [number, number, number];
type Plan = 'pad' | 'pad-slide' | 'brake';

const vfx = (page: Page) => page.evaluate(() => globalThis.__tyreVfx!());
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `11-01-${name}.png`) });
async function top(page: Page, name: string, eye: View, at: View, fov = 40) {
  const url = await page.evaluate(([e, t, f]) => globalThis.__annexView!(e as View, t as View, f as number), [eye, at, fov] as const);
  writeFileSync(join(SHOTS, `11-01-${name}.png`), Buffer.from(url.split(',')[1]!, 'base64'));
}

/**
 * Drives `seconds` of simulated time in 1/30 s rendered frames with a small closed-loop driver:
 *   pad: hold `speed` on the painted circle (centre (-170, 335), R 40, counter-clockwise);
 *   pad-slide: as pad, then from `slideAt` s full throttle and extra lock (aids off: power oversteer);
 *   brake: hold `speed` north along x = 149.75, from `brakeAt` s full brake, wheel straight.
 * Returns how many frames had a corner past the limit.
 */
function drive(page: Page, plan: Plan, seconds: number, speed: number, at = Infinity) {
  return page.evaluate(
    ([plan, seconds, speed, at]) => {
      const app = globalThis.__app!;
      const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
      let past = 0;
      for (let t = 0; t < seconds; t += 1 / 30) {
        const d = app.drive();
        let steer = 0;
        let throttle = clamp(0.3 * (speed - d.u) + 0.12, 0, 1);
        let brake = 0;
        if (plan === 'brake') {
          steer = clamp(0.25 * (d.x - 149.75) + 1.2 * wrap(Math.PI / 2 - d.yaw));
          if (t >= at) {
            steer = 0;
            throttle = 0;
            brake = 1;
          }
        } else {
          const dx = d.x + 170;
          const dy = d.y - 335;
          const r = Math.hypot(dx, dy);
          const yawT = Math.atan2(dy, dx) + Math.PI / 2;
          steer = clamp(0.2 + 0.08 * (r - 40) + 1.2 * wrap(yawT - d.yaw));
          if (plan === 'pad-slide' && t >= at) {
            throttle = 1;
            steer = 0.6;
          }
        }
        app.driveIntent({ steer, throttle, brake });
        app.advance(1 / 30);
        if (globalThis.__tyreVfx!().corners.some((c) => c.past)) past++;
      }
      app.driveIntent(null);
      return past;
    },
    [plan, seconds, speed, at] as const,
  );
}

test.describe('11-01 tyre VFX', () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  test.setTimeout(300_000);

  test('steering pad: rings show load transfer; a slide turns them and lays marks', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, boot('steering-pad'));
    await page.evaluate(() => globalThis.__app!.advance(0.5));
    let v = await vfx(page);
    expect(v.chip).toMatchObject({ shown: true, pressed: true });
    expect(v.chip.text).toContain('model');
    expect(v.rings).toBe(true);

    await drive(page, 'pad', 6, 12); // launch (a brief wheelspin from rest is past the limit, truthfully)
    const launchMarks = (await vfx(page)).marks.written;
    expect(await drive(page, 'pad', 8, 12)).toBe(0);
    v = await vfx(page);
    const d = await page.evaluate(() => globalThis.__app!.drive());
    const r = Object.fromEntries(v.corners.map((c) => [c.id, c.radius]));
    console.log(`[11-01] pad at ${d.u.toFixed(1)} m/s (${d.x.toFixed(1)}, ${d.y.toFixed(1)}) on ${d.corners.map((c) => c.surface).join(',')}: radius fl ${r.fl!.toFixed(3)} fr ${r.fr!.toFixed(3)} rl ${r.rl!.toFixed(3)} rr ${r.rr!.toFixed(3)} m`);
    expect(r.fr!).toBeGreaterThan(r.fl! * 1.05); // left turn: the right (outside) rings are bigger
    expect(r.rr!).toBeGreaterThan(r.rl! * 1.05);
    expect(v.marks.written).toBe(launchMarks); // within the limit: no new marks
    await shot(page, 'pad-cornering');
    await top(page, 'pad-cornering-top', [d.x - 6 * Math.cos(d.yaw), d.y - 6 * Math.sin(d.yaw), 6], [d.x, d.y, 0], 50);
    const calls = (await page.evaluate(() => globalThis.__app!.stats()))!.calls;
    await page.evaluate(() => globalThis.__app!.set('driveAids', { abs: false, traction: false, stability: false, steering: false }));

    const past = await drive(page, 'pad-slide', 1.6, 16, 0.7);
    v = await vfx(page);
    console.log(`[11-01] slide: ${past} frames past the limit, past now ${v.corners.filter((c) => c.past).map((c) => c.id).join(',')}, marks ${v.marks.written}`);
    expect(past).toBeGreaterThan(3);
    expect(v.marks.written).toBeGreaterThan(launchMarks + 5);
    await shot(page, 'pad-slide');
    const s = await page.evaluate(() => globalThis.__app!.drive());
    await top(page, 'pad-slide-top', [s.x - 9 * Math.cos(s.yaw), s.y - 9 * Math.sin(s.yaw), 9], [s.x, s.y, 0], 50);
    const after = (await page.evaluate(() => globalThis.__app!.stats()))!.calls;
    console.log(`[11-01] draw calls: cornering ${calls}, with marks ${after}`);
    expect(after - calls).toBeLessThanOrEqual(1); // the marks: one draw

    // reset clears the marks
    await page.keyboard.press('KeyR');
    await page.evaluate(() => globalThis.__app!.advance(0.2));
    expect((await vfx(page)).marks.visible).toBe(false);
    await expectHealthyBoot(page, errors);
  });

  test('braking platform, ABS off: lock-up on the split-grip lane', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, boot('braking-platform'));
    await page.evaluate(() => globalThis.__app!.set('driveAids', { abs: false, traction: true, stability: false, steering: true }));
    await page.evaluate(() => globalThis.__app!.advance(0.3));
    const past = await drive(page, 'brake', 9.2, 22, 8.2);
    const v = await vfx(page);
    const d = await page.evaluate(() => globalThis.__app!.drive());
    console.log(`[11-01] braking at (${d.x.toFixed(1)}, ${d.y.toFixed(1)}) ${d.u.toFixed(1)} m/s on ${d.corners.map((c) => `${c.id} ${c.surface}`).join(', ')}: past ${v.corners.filter((c) => c.past).map((c) => c.id).join(',')} (${past} frames), marks ${v.marks.written}`);
    expect(past).toBeGreaterThan(3);
    expect(v.marks.written).toBeGreaterThan(5);
    await shot(page, 'brake-split');
    await top(page, 'brake-split-top', [d.x + 6, d.y - 14, 8], [d.x, d.y - 4, 0], 45);
    await expectHealthyBoot(page, errors);
  });

  test('Auto: no chip and no rings unless the engineer overlay is on', async ({ page }) => {
    const errors = captureConsole(page);
    await waitForReady(page, `/?e2e=1&quality=${QUALITY}&paused=1&t=30`);
    let v = await vfx(page);
    expect(v.chip.shown).toBe(false);
    expect(v.rings).toBe(false);
    await page.evaluate(() => globalThis.__app!.set('overlay', 'engineer'));
    await page.evaluate(() => globalThis.__app!.advance(0.1));
    v = await vfx(page);
    expect(v.chip.shown).toBe(true);
    expect(v.rings).toBe(true);
    expect(v.marks.written).toBe(0);
    await shot(page, 'auto-engineer');
    await expectHealthyBoot(page, errors);
  });
});
