/**
 * 03-03: DB11 visual + vehicle-view. Checks the car is mounted (placeholder hidden), oriented forward, the tyres
 * touch the road (ray cast down from every hub onto the non-vehicle scene geometry), every suspension is pre-built
 * and swaps by visibility only, x-ray fades, and nothing logs an error or warning. Saves evidence screenshots.
 *
 * Test-only camera: three.js announces its renderer/scenes to `window.__THREE_DEVTOOLS__`; we capture them and wrap
 * renderer.render so a perspective camera can be placed in the CAR frame (x forward, y up, z right) for a shot.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole, expectHealthyBoot, waitForReady } from './helpers';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/03-03-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1 });

declare global {
  var __THREE_DEVTOOLS__: EventTarget | undefined;
  var __shot: { eye: [number, number, number]; look: [number, number, number]; fov: number } | null | undefined;
  var __three: { scene: any; renderer: any } | undefined;
}

async function installShotCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hook = new EventTarget();
    const found: { scene: any; renderer: any } = { scene: null, renderer: null };
    globalThis.__three = found;
    hook.addEventListener('observe', (e) => {
      const o = (e as CustomEvent).detail;
      if (o?.isScene && !found.scene) found.scene = o;
      if (o && typeof o.render === 'function' && o.domElement && !found.renderer) {
        found.renderer = o;
        const render = o.render.bind(o);
        o.render = (scene: any, camera: any) => {
          const shot = globalThis.__shot;
          const body = found.scene?.getObjectByName('vehicle:db11')?.getObjectByName('body');
          if (shot && body && camera?.isPerspectiveCamera && scene === found.scene) {
            body.updateMatrixWorld(true);
            camera.position.set(...shot.eye);
            body.localToWorld(camera.position);
            const look = camera.position.clone().set(...shot.look);
            body.localToWorld(look);
            camera.up.set(0, 1, 0);
            camera.lookAt(look);
            if (camera.fov !== shot.fov) {
              camera.fov = shot.fov;
              camera.updateProjectionMatrix();
            }
            camera.updateMatrixWorld(true);
          }
          return render(scene, camera);
        };
      }
    });
    globalThis.__THREE_DEVTOOLS__ = hook;
  });
}

/** Console warnings, minus Chromium's own readback notice caused by taking screenshots. */
function captureWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && !m.text().includes('GPU stall due to ReadPixels')) warnings.push(m.text());
  });
  return warnings;
}

async function shot(page: Page, name: string, eye: [number, number, number], look: [number, number, number], fov = 35): Promise<void> {
  await page.evaluate((s) => (globalThis.__shot = s), { eye, look, fov });
  await page.evaluate(() => globalThis.__app!.advance(0.02));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(SHOTS, `03-03-${name}.png`) });
}

/** Per corner: hub world position, lowest tyre point, and the road height under it (ray cast on non-car meshes). */
function contact(page: Page) {
  return page.evaluate(() => {
    const { scene } = globalThis.__three!;
    const car = scene.getObjectByName('vehicle:db11');
    const out: { id: string; hubY: number; tyreBottom: number; road: number | null }[] = [];
    for (const id of ['fl', 'fr', 'rl', 'rr']) {
      const hub = car.getObjectByName(`hub:${id}`);
      const tyre = hub.getObjectByName(`${id}:tyre`);
      tyre.updateMatrixWorld(true);
      const p = tyre.geometry.getAttribute('position');
      const v = hub.position.clone();
      let min = Infinity;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(tyre.matrixWorld);
        min = Math.min(min, v.y);
      }
      // Road: scan every non-vehicle mesh triangle under the hub in the mesh's local space (no Raycaster class in
      // the page). Track meshes are not rotated, so local "down" is world down.
      let road: number | null = null;
      scene.traverse((o: any) => {
        if (!o.isMesh || !o.visible) return;
        // Road only: skip the car, suspension visuals and the hidden placeholder.
        for (let a: any = o; a; a = a.parent) if (!a.visible || /^(vehicle:|spatial-linkage:|placeholder)/.test(a.name)) return;
        const g = o.geometry;
        const pos = g.getAttribute('position');
        if (!pos || o.material?.transparent) return;
        o.updateMatrixWorld(true);
        const local = o.worldToLocal(hub.position.clone());
        const hx = local.x;
        const hz = local.z;
        const idx = g.index;
        const tri = (idx ? idx.count : pos.count) / 3;
        for (let t = 0; t < tri; t++) {
          const ia = idx ? idx.getX(3 * t) : 3 * t;
          const ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
          const ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
          const ax = pos.getX(ia);
          const bx = pos.getX(ib);
          const cx = pos.getX(ic);
          if ((ax < hx && bx < hx && cx < hx) || (ax > hx && bx > hx && cx > hx)) continue;
          const az = pos.getZ(ia);
          const bz = pos.getZ(ib);
          const cz = pos.getZ(ic);
          if ((az < hz && bz < hz && cz < hz) || (az > hz && bz > hz && cz > hz)) continue;
          const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          if (Math.abs(d) < 1e-12) continue;
          const l1 = ((bz - cz) * (hx - cx) + (cx - bx) * (hz - cz)) / d;
          const l2 = ((cz - az) * (hx - cx) + (ax - cx) * (hz - cz)) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const y = o.localToWorld(local.clone().setY(l1 * pos.getY(ia) + l2 * pos.getY(ib) + l3 * pos.getY(ic))).y;
          if (y < hub.position.y && (road === null || y > road)) road = y;
        }
      });
      out.push({ id, hubY: hub.position.y, tyreBottom: min, road });
    }
    return out;
  });
}

test('DB11 mounted, oriented forward, tyres on the road; screenshots', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  await installShotCamera(page);
  await waitForReady(page, '/?e2e=1&paused=1&t=20&quality=high');
  await page.evaluate(() => globalThis.__app!.advance(0.05));

  const mounted = await page.evaluate(() => {
    const { scene } = globalThis.__three!;
    const car = scene.getObjectByName('vehicle:db11');
    const placeholder = scene.getObjectByName('placeholder');
    // Forward check: the front hubs are ahead of the rear hubs along the body's +X (the driving direction).
    const body = car.getObjectByName('body');
    const fl = body.worldToLocal(car.getObjectByName('hub:fl').position.clone());
    const rl = body.worldToLocal(car.getObjectByName('hub:rl').position.clone());
    let meshes = 0;
    car.traverseVisible((o: any) => (meshes += o.isMesh ? 1 : 0));
    return { car: !!car, placeholderVisible: placeholder?.visible ?? false, flx: fl.x, rlx: rl.x, flz: fl.z, meshes };
  });
  console.info('[03-03] mounted', mounted);
  expect(mounted.car).toBe(true);
  expect(mounted.placeholderVisible).toBe(false);
  expect(mounted.flx).toBeGreaterThan(1.3); // front axle at +cgToFront (1.43 m) in the body frame
  expect(mounted.rlx).toBeLessThan(-1.3);
  expect(mounted.flz).toBeLessThan(-0.8); // left = three -Z
  // With the procedural suspension mounted the car's own discs/calipers are hidden: <= 31 car meshes drawn.
  expect(mounted.meshes).toBeLessThanOrEqual(31);

  for (const t of [5, 9.75, 20, 51.65]) {
    await page.evaluate((lap) => globalThis.__app!.seek(lap), t);
    await page.evaluate(() => globalThis.__app!.advance(0.05));
    const c = await contact(page);
    console.info(`[03-03] contact t=${t}`, c.map((k) => `${k.id}: tyre ${(k.tyreBottom * 1000).toFixed(0)} road ${k.road === null ? '-' : (k.road * 1000).toFixed(0)} mm`).join(' | '));
    for (const k of c) {
      if (k.road === null) continue; // no road geometry under this wheel (track feature not mounted)
      // Unloaded radius drawn, loaded tyre on the road: the tyre dips by its deflection (~16 mm), never floats.
      expect(k.tyreBottom - k.road).toBeLessThan(0.005);
      expect(k.tyreBottom - k.road).toBeGreaterThan(-0.04);
    }
  }

  await page.evaluate(() => globalThis.__app!.seek(20));
  await page.evaluate(() => globalThis.__app!.advance(0.05));
  await shot(page, 'three-quarter-front', [5.2, 1.5, -3.6], [0, 0.55, 0], 32);
  await shot(page, 'side', [0, 0.8, -7.5], [0, 0.6, 0], 32);
  await shot(page, 'rear', [-6.2, 1.6, 2.4], [0, 0.6, 0], 32);
  await shot(page, 'top', [0.01, 9, 0], [0, 0, 0], 38);

  // Hairpin apex (right-hand): front wheels near their largest steer; close on the outer (left) front wheel.
  await page.evaluate(() => globalThis.__app!.seek(9.75));
  await page.evaluate(() => globalThis.__app!.advance(0.05));
  console.info('[03-03] hairpin frame', JSON.stringify(await page.evaluate(() => globalThis.__app!.frame().corners)));
  await shot(page, 'front-wheel-lock', [2.9, 0.6, -2.1], [1.43, 0.35, -0.85], 30);

  await page.evaluate(() => globalThis.__app!.seek(20));
  await page.evaluate(() => globalThis.__app!.set('xray', true));
  for (let i = 0; i < 30; i++) await page.evaluate(() => globalThis.__app!.advance(1 / 60));
  await shot(page, 'xray', [4.4, 1.9, -3.4], [0.2, 0.45, 0], 34);

  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});

test('every suspension is pre-built; swaps toggle visibility; the car works without suspension visuals', async ({ page }) => {
  test.setTimeout(200_000);
  const errors = captureConsole(page);
  const warnings = captureWarnings(page);
  await installShotCamera(page);
  await waitForReady(page, '/?e2e=1&paused=1&t=10');
  const roots = () =>
    page.evaluate(() =>
      (globalThis.__three!.scene.children as any[]).filter((o) => o.name.startsWith('spatial-linkage:')).map((o) => `${o.name}=${o.visible}`),
    );
  expect(await roots()).toEqual(['spatial-linkage:macpherson=false', 'spatial-linkage:double-wishbone=true', 'spatial-linkage:multilink=false']);
  await page.evaluate(() => globalThis.__app!.set('suspensionId', 'multilink'));
  await page.evaluate(() => globalThis.__app!.advance(0.02));
  expect(await roots()).toEqual(['spatial-linkage:macpherson=false', 'spatial-linkage:double-wishbone=false', 'spatial-linkage:multilink=true']);
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);

  // Without linkage-parts the DB11 shows its own discs and calipers.
  await waitForReady(page, '/?e2e=1&paused=1&t=10&features=-linkage-parts');
  const brakes = await page.evaluate(() => {
    let n = 0;
    globalThis.__three!.scene.getObjectByName('vehicle:db11').traverseVisible((o: any) => (n += o.userData.replacedBySuspension ? 1 : 0));
    return n;
  });
  expect(brakes).toBe(16);
  await shot(page, 'own-brakes', [2.6, 0.55, -2.4], [1.43, 0.38, -0.85], 30);
  await page.evaluate(() => globalThis.__app!.set('xray', true));
  for (let i = 0; i < 30; i++) await page.evaluate(() => globalThis.__app!.advance(1 / 60));
  await expectHealthyBoot(page, errors);
  expect(warnings).toEqual([]);
});
