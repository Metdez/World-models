/**
 * 13-01 feature-off matrix (MD-70; the modularity promise of ARCHITECTURE §9 / ARCHITECTURE-M2 §9): every feature
 * switched off alone with `?features=-<id>`, all M2 features off together, and every feature off at once. Each boot must
 * be clean (no console or page errors, no feature errors), the switched-off features must be off and every other
 * feature on (live-ghosts is off by default), the lap must still run, and the features that remain must still work:
 * the driving probe takes the wheel, drives and hands back whenever `drive` is on; it must NOT take over when `drive`
 * is off. M2 features' own DOM must be absent when they are off.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

const ALL = [
  'analytics', 'attract', 'audio', 'camera', 'car', 'coach', 'controls', 'credits', 'debug', 'drive', 'engineer',
  'environment', 'ghost-lab', 'insights', 'linkage-parts', 'live-ghosts', 'live-lab', 'motorcycle', 'phone-drive', 'poll',
  'presenter', 'proving-ground', 'renderer', 'replay', 'teaching-overlays', 'telemetry-panel', 'track', 'tyre-vfx',
  'vehicle-view',
] as const;
const M2 = ['drive', 'proving-ground', 'tyre-vfx', 'coach', 'replay', 'ghost-lab', 'phone-drive', 'live-ghosts'] as const;
/** Off by default: live-ghosts (ARCHITECTURE-M2 §F1, stretch not built), debug (on only with ?debug=1). */
const DEFAULT_OFF = new Set<string>(['live-ghosts', 'debug']);
/** `requires` of every feature (src/features/<id>/index.ts): a feature whose requirement is off is off too (§6.2). */
const REQUIRES: Record<string, readonly string[]> = {
  attract: ['camera'], camera: ['renderer'], debug: ['renderer'], environment: ['renderer'], 'ghost-lab': ['renderer'],
  'live-ghosts': ['live-lab', 'renderer'], 'phone-drive': ['drive', 'live-lab'], poll: ['live-lab'], presenter: ['live-lab'],
  'proving-ground': ['renderer'], 'teaching-overlays': ['renderer'], track: ['renderer'], 'tyre-vfx': ['renderer'],
  'vehicle-view': ['renderer'],
};
/** The features the kernel should enable with `off` switched off: defaults, then the requires cascade to a fixpoint. */
function expectedOn(off: readonly string[]): Set<string> {
  const on = new Set<string>(ALL.filter((id) => !off.includes(id) && !DEFAULT_OFF.has(id)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of [...on]) if ((REQUIRES[id] ?? []).some((r) => !on.has(r))) changed = on.delete(id) || changed;
  }
  return on;
}
/** M2 features' own DOM roots (present in the DOM whenever the feature is on and drive hosts them). */
const DOM: Record<string, string> = {
  drive: '.sl-drive-pill',
  coach: '.sl-coach',
  'tyre-vfx': '.sl-tyre-vfx',
  replay: '.sl-replay',
  'ghost-lab': '.sl-ghost-lab-chip',
};

const cases: { name: string; off: readonly string[] }[] = [
  ...ALL.map((id) => ({ name: `-${id}`, off: [id] })),
  { name: 'all M2 features off', off: M2 },
  { name: 'every feature off', off: ALL },
];

const mode = (page: Page) => page.evaluate(() => globalThis.__app!.state().driveMode);

test.describe('13-01 feature-off matrix', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(300_000);

  test('the requires table matches the feature sources', () => {
    for (const id of ALL) {
      const src = readFileSync(`src/features/${id}/index.ts`, 'utf8');
      const got = [...(src.match(/requires: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(got, id).toEqual([...(REQUIRES[id] ?? [])]);
    }
  });

  for (const c of cases) {
    test(c.name, async ({ page }) => {
      const errors = captureConsole(page);
      const flags = c.off.map((id) => `-${id}`).join(',');
      await page.goto(`/?e2e=1&quality=low&t=40&features=${flags}`);
      // SwiftShader boots slowly on a shared machine: a generous allowance (a boot timeout is not a matrix failure)
      await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 180_000 });

      // the switched-off features are off (with whatever requires them), all others on, none with an error
      const features = await page.evaluate(() => globalThis.__app!.features());
      expect(features.map((f) => f.id).sort()).toEqual([...ALL].sort());
      const want = expectedOn(c.off);
      for (const f of features) {
        expect(f.error, `${f.id} error`).toBeUndefined();
        expect(f.enabled, `${f.id} enabled`).toBe(want.has(f.id));
      }
      const on = (id: string) => features.find((f) => f.id === id)!.enabled;

      // the lap still runs
      const t0 = (await page.evaluate(() => globalThis.__app!.frame())).lapTime;
      await page.evaluate(() => globalThis.__app!.advance(2));
      const t1 = (await page.evaluate(() => globalThis.__app!.frame())).lapTime;
      expect(t1).not.toBe(t0);

      // M2 DOM is absent when off
      for (const [id, sel] of Object.entries(DOM)) if (!on(id)) expect(await page.locator(sel).count(), `${sel} with -${id}`).toBe(0);

      // driving: the remaining features still let a visitor take the wheel, drive and hand back; never without drive
      // without `car` the coupe is not registered and the app runs the motorcycle: Auto only (MD-03), so no takeover
      const vehicle = await page.evaluate(() => globalThis.__app!.state().vehicleId);
      const available = (await page.evaluate(() => globalThis.__app!.drive())).available;
      expect(available, `plant for ${vehicle}`).toBe(on('car'));
      if (!on('car')) expect(vehicle).not.toBe('gt-coupe');
      await page.keyboard.down('ArrowUp');
      if (on('drive') && available) {
        await expect.poll(() => mode(page), { timeout: 30_000 }).toBe('manual');
        await page.keyboard.up('ArrowUp');
        await page.evaluate(() => globalThis.__app!.driveIntent({ throttle: 0.6 }));
        await page.evaluate(() => globalThis.__app!.advance(3));
        const d = await page.evaluate(() => globalThis.__app!.drive());
        expect(d.mode).toBe('manual');
        expect(d.speed).toBeGreaterThan(3);
        expect(d.faults).toBe(0);
        await page.evaluate(() => globalThis.__app!.driveIntent(null));
        // chips of the M2 features that are on and live in the drive action row
        for (const id of ['tyre-vfx', 'replay', 'ghost-lab'] as const) if (on(id)) expect(await page.locator(DOM[id]!).count(), `${id} chip`).toBeGreaterThan(0);
        await page.keyboard.press('Enter');
        await expect.poll(() => mode(page), { timeout: 30_000 }).not.toBe('manual');
      } else {
        await page.waitForTimeout(500);
        await page.evaluate(() => globalThis.__app!.advance(1));
        await page.keyboard.up('ArrowUp');
        expect(await mode(page)).toBe('auto');
      }

      expect(await page.evaluate(() => globalThis.__app!.errors)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('offline fallback: with the network cut after boot, Manual still drives and hands back (MD-70)', async ({ page, context }) => {
    const errors = captureConsole(page);
    await page.goto('/?e2e=1&quality=low&t=40');
    await page.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 180_000 });
    await context.setOffline(true);
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => mode(page), { timeout: 30_000 }).toBe('manual');
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => globalThis.__app!.driveIntent({ throttle: 0.6 }));
    await page.evaluate(() => globalThis.__app!.advance(3));
    expect((await page.evaluate(() => globalThis.__app!.drive())).speed).toBeGreaterThan(3);
    await page.evaluate(() => globalThis.__app!.driveIntent(null));
    await page.keyboard.press('Enter');
    await expect.poll(() => mode(page), { timeout: 30_000 }).not.toBe('manual');
    await context.setOffline(false);
    expect(await page.evaluate(() => globalThis.__app!.errors)).toEqual([]);
    // offline network failures of background requests (room, analytics) are allowed; nothing else
    expect(errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|WebSocket/i.test(e))).toEqual([]);
  });
});
