import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { canvasVariance, captureConsole, expectHealthyBoot, waitForReady } from './helpers';

// Evidence screenshots (DPR 1); point SHOTS_DIR elsewhere to keep them.
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/03-04-shots';
mkdirSync(SHOTS, { recursive: true });
test.use({ deviceScaleFactor: 1 });

/** Console warnings (shader compile/link problems surface here), minus Chromium's screenshot readback notice. */
function captureWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && !m.text().includes('GPU stall due to ReadPixels')) warnings.push(m.text());
  });
  return warnings;
}

// The `spatial-linkage` visual is mounted on the car by vehicle-view (03-03); this spec runs at the phase gate and
// checks every car suspension in the close-up view at high quality (shadow pass = the spring's depth shader).
for (const suspension of ['macpherson', 'double-wishbone', 'multilink']) {
  test(`${suspension}: closeup renders with linkage-parts on, zero console errors and warnings`, async ({ page }) => {
    const errors = captureConsole(page);
    const warnings = captureWarnings(page);
    await waitForReady(page, `/?e2e=1&paused=1&t=20&quality=high&view=closeup&suspension=${suspension}`);
    expect((await page.evaluate(() => globalThis.__app!.features())).find((f) => f.id === 'linkage-parts')).toEqual({ id: 'linkage-parts', enabled: true });
    expect(await page.evaluate(() => globalThis.__app!.state().suspensionId)).toBe(suspension);
    await page.evaluate(() => globalThis.__app!.advance(0.25));
    await page.waitForTimeout(300);
    expect(await canvasVariance(page)).toBeGreaterThan(20);
    await page.screenshot({ path: join(SHOTS, `03-04-app-${suspension}.png`) });
    await expectHealthyBoot(page, errors);
    expect(warnings).toEqual([]);
  });
}
