/**
 * 09-03 cross-engine determinism (ARCHITECTURE-M2 §7.12.6): the seeded 60 s manual drive hashes the same in this
 * Node process (sim-core imported directly) and in every browser engine available here, via `__app.driveHash`.
 * Chromium is the configured project; Firefox and WebKit join automatically when their builds exist under
 * PLAYWRIGHT_BROWSERS_PATH (never `playwright install`), otherwise their tests are skipped and say why.
 */
import { existsSync } from 'node:fs';
import { expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { createSimulation, runDriveScript } from '../../src/sim-core/index';
import { waitForReady } from './helpers';

const BOOT = '/?e2e=1&quality=low&paused=1';
const SEED = 7;
const SECONDS = 60;
const empty = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };

/**
 * The page's simulation ids, and the Node hash for the same ids (built-in content, as the app registers it). The page
 * grounds on the proving-ground world whenever that feature is on (its spurs join the loop), so the Node side must use
 * the same world: 13-01 found this spec comparing a world-less Node run with the page's world run since 10-03.
 */
async function nodeHashFor(page: Page): Promise<{ ids: string; hash: string }> {
  const st = await page.evaluate(() => globalThis.__app!.state());
  const annex = (await page.evaluate(() => globalThis.__app!.features())).some((f) => f.id === 'proving-ground' && f.enabled);
  const catalog = annex ? { ...empty, world: (trackId: string) => (trackId === provingGround.trackId ? provingGround : undefined) } : empty;
  const sim = createSimulation({ catalog, trackId: st.trackId, vehicleId: st.vehicleId, suspensionId: st.suspensionId });
  return { ids: `${st.trackId}/${st.vehicleId}/${st.suspensionId}${annex ? '+proving-ground' : ''}`, hash: runDriveScript(sim, SEED, SECONDS) };
}

async function compare(page: Page, engine: string): Promise<void> {
  await waitForReady(page, BOOT);
  const node = await nodeHashFor(page);
  expect(node.hash).toMatch(/^[0-9a-f]{8}$/);
  const browser = await page.evaluate(([s, t]) => globalThis.__app!.driveHash(s, t), [SEED, SECONDS] as const);
  console.log(`[09-03] runDriveScript(${SEED}, ${SECONDS}) ${node.ids}: node ${node.hash}, ${engine} ${browser}`);
  expect(browser).toBe(node.hash);
}

test.describe('09-03 drive hash: Node == browser engines', () => {
  test.setTimeout(120_000);

  test('Node and the configured project (Chromium) agree', async ({ page, browserName }) => {
    await compare(page, browserName);
  });

  const extra: readonly [string, BrowserType][] = [
    ['firefox', firefox],
    ['webkit', webkit],
  ];
  for (const [name, type] of extra) {
    test(`Node and ${name} agree (when installed)`, async () => {
      let path = '';
      try {
        path = type.executablePath();
      } catch {
        path = '';
      }
      test.skip(!path || !existsSync(path), `${name} is not installed in this environment (no playwright install): gap recorded in the 09-03 SUMMARY`);
      let browser: Browser | undefined;
      try {
        browser = await type.launch();
        const page = await browser.newPage({ baseURL: test.info().project.use.baseURL });
        await compare(page, name);
      } finally {
        await browser?.close();
      }
    });
  }
});
