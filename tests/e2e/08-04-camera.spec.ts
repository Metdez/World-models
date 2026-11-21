/**
 * 08-04 manual chase camera in the real app (ARCHITECTURE-M2 §10.3): with `?drive=manual` and the test intent hook,
 * the chase stays behind the driven car going straight, through a held corner and reversing; explore and close-up
 * still work while driving. Needs the Manual Drive plant (08-02); without it the test is skipped, never faked.
 * Real-time frames (SwiftShader is slow, so phases are counted in frames and speeds, not wall seconds).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/08-04-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1, viewport: { width: 1280, height: 720 } });
test.setTimeout(900_000);

declare global {
  var __THREE_DEVTOOLS__: EventTarget | undefined;
  var __scene0804: { scene: any; renderer: any; camera: any } | undefined;
}

async function installHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hook = new EventTarget();
    const found: { scene: any; renderer: any; camera: any } = { scene: null, renderer: null, camera: null };
    globalThis.__scene0804 = found;
    hook.addEventListener('observe', (e) => {
      const o = (e as CustomEvent).detail;
      if (o?.isScene && !found.scene) found.scene = o;
      if (o && typeof o.render === 'function' && o.domElement && !found.renderer) {
        found.renderer = o;
        const render = o.render.bind(o);
        o.render = (scene: any, camera: any) => {
          if (scene === found.scene && camera?.isPerspectiveCamera) found.camera = camera;
          return render(scene, camera);
        };
      }
    });
    globalThis.__THREE_DEVTOOLS__ = hook;
  });
}

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

/** Camera vs the driven car in the sim ground plane: angle between camera->car and the heading (deg; 0 = straight
 * behind), horizontal distance and height above the car. */
const relation = (page: Page) =>
  page.evaluate(() => {
    const cam = globalThis.__scene0804!.camera.position;
    const d = globalThis.__app!.drive();
    // three (x, y, z) = sim (x, z, -y)
    const dx = d.x - cam.x;
    const dy = d.y + cam.z;
    const off = Math.atan2(dy, dx) - d.yaw;
    return {
      angle: (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) * 180) / Math.PI,
      dist: Math.hypot(dx, dy),
      u: d.u,
      speed: d.speed,
      mode: d.mode,
    };
  });

const intent = (page: Page, i: Record<string, number> | null) => page.evaluate((x) => globalThis.__app!.driveIntent(x), i);
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `08-04-${name}.png`) });

test('manual chase: behind the car straight, cornering and reversing; explore and close-up while driving', async ({ page }) => {
  const consoleErrors = captureConsole(page);
  await installHook(page);
  await page.goto('/?e2e=1&quality=low&drive=manual');
  await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 180_000 });
  await frames(page, 3);
  test.skip(!(await page.evaluate(() => globalThis.__app!.drive().available)), 'Manual Drive plant (08-02) not in this build');
  await page.waitForFunction(() => globalThis.__app!.state().driveMode === 'manual', undefined, { timeout: 60_000 });

  // Straight: accelerate to 12 m/s, then hold.
  await intent(page, { throttle: 0.7 });
  await page.waitForFunction(() => globalThis.__app!.drive().speed > 12, undefined, { timeout: 300_000, polling: 100 });
  await intent(page, { throttle: 0.3 });
  await frames(page, 20);
  const straight = await relation(page);
  console.info('[08-04] straight', straight);
  expect(straight.angle).toBeLessThan(25);
  expect(straight.dist).toBeGreaterThan(3);
  expect(straight.dist).toBeLessThan(10);
  await shot(page, 'straight');

  // Held steer (left) for 2 s of frames at ~60 fps-equivalent sim time: still behind.
  await intent(page, { throttle: 0.35, steer: 0.5 });
  await frames(page, 40);
  const corner = await relation(page);
  console.info('[08-04] corner', corner);
  expect(corner.angle).toBeLessThan(25);
  await shot(page, 'corner');

  // Brake to a stop, keep braking: reverse is selected at standstill; hold it.
  await intent(page, { brake: 1 });
  await page.waitForFunction(() => globalThis.__app!.drive().u < -0.5, undefined, { timeout: 300_000, polling: 100 });
  await frames(page, 40);
  const reverse = await relation(page);
  console.info('[08-04] reverse', reverse);
  expect(reverse.u).toBeLessThan(-0.5);
  expect(reverse.angle).toBeLessThan(25);
  await shot(page, 'reversing');

  // Explore and close-up keep working while driving.
  await intent(page, { throttle: 0.2 });
  await page.evaluate(() => globalThis.__app!.set('view', 'explore'));
  await frames(page, 30);
  const explore = await relation(page);
  console.info('[08-04] explore', explore);
  expect(explore.dist).toBeLessThan(16);
  await page.evaluate(() => {
    globalThis.__app!.set('focusCorner', 'fl');
    globalThis.__app!.set('view', 'closeup');
  });
  await frames(page, 30);
  const close = await relation(page);
  console.info('[08-04] closeup', close);
  expect(close.dist).toBeLessThan(3);
  await page.evaluate(() => globalThis.__app!.set('view', 'follow'));
  await frames(page, 30);
  expect((await relation(page)).angle).toBeLessThan(25);
  await intent(page, null);

  const own = await page.evaluate(() => {
    const app = globalThis.__app!;
    const cam = app.features().find((f) => f.id === 'camera');
    return { enabled: cam?.enabled, error: cam?.error, errors: app.errors.filter((e) => /camera|CameraControls/i.test(e)) };
  });
  expect(own).toEqual({ enabled: true, error: undefined, errors: [] });
  expect(consoleErrors.filter((e) => /camera/i.test(e))).toEqual([]);
});
