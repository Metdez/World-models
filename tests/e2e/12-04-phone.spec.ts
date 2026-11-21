import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';
import { captureConsole } from './helpers';

// Big screen + phone driver against the real Room DO (workerd via a private `vite preview`). The screen runs
// ?screen=1&debug=1 (not e2e=1, which keeps the room offline) to expose window.__app. Touch is emulated (CDP);
// tilt is driven with synthetic DeviceMotionEvents only: it was not tried on a real phone here.
const SHOTS = process.env['SHOTS_DIR'];
const LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 667, height: 375 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/12-04-${name}.png` });
};

async function phone(browser: Browser, path: string, size = LANDSCAPE) {
  const page = await (await browser.newContext(size)).newPage();
  const errors = captureConsole(page);
  const scripts: { url: string; body: string }[] = [];
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'script') scripts.push({ url: r.url(), body: await r.text().catch(() => '') });
  });
  // wall-clock stamp of every input event on the phone (same machine as the screen: comparable with its Date.now())
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __inputs: { t: number; type: string; x: number }[] };
    w.__inputs = [];
    for (const type of ['pointerdown', 'pointermove'])
      addEventListener(type, (e) => w.__inputs.push({ t: Date.now(), type, x: (e as PointerEvent).clientX }), { capture: true });
  });
  await page.goto(path);
  return { page, errors, scripts };
}

const pt = (x: number, y: number, id: number) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });
const centreOf = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: ReturnType<typeof pt>[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

test('a phone drives the big screen through the room, fails safe, and recovers calmly', async ({ browser }) => {
  test.setTimeout(300_000);
  const screen = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const screenErrors = captureConsole(screen);
  // record every relayed `in` frame as it reaches the screen's JS (wall clock), before the app's own handler
  await screen.addInitScript(() => {
    const w = globalThis as unknown as { __inLog: { t: number; s: number; n: number }[] };
    w.__inLog = [];
    const Native = WebSocket;
    class Logged extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (e) => {
          if (typeof e.data === 'string' && e.data.startsWith('{"t":"in"')) {
            const m = JSON.parse(e.data) as { s: number; n: number };
            w.__inLog.push({ t: Date.now(), s: m.s, n: m.n });
          }
        });
      }
    }
    globalThis.WebSocket = Logged;
  });
  await screen.goto('/?screen=1&quality=low&debug=1');
  await screen.waitForFunction(() => globalThis.__app?.ready === true, undefined, { timeout: 120_000 });
  const drive = () => screen.evaluate(() => globalThis.__app!.drive());
  const mode = async () => (await screen.evaluate(() => globalThis.__app!.state())).driveMode;

  // The card: QR with the driver key only in the fragment
  const card = screen.locator('.sl-phone-drive');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toHaveAttribute('data-state', 'waiting');
  await expect(card.locator('.sl-qr path')).toHaveAttribute('d', /^M/);
  const room = await screen.evaluate(() => JSON.parse(sessionStorage.getItem('sl-live-lab-screen-room')!) as { code: string; driverKey: string; hostKey: string });
  expect(room.driverKey).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(room.driverKey).not.toBe(room.hostKey);
  await shot(screen, 'screen-card');

  // Phone: /remote.html?room=CODE#d=KEY -> driver; the key moves to sessionStorage and leaves the address bar
  const p1 = await phone(browser, `/remote.html?room=${room.code}#d=${room.driverKey}`);
  await expect(p1.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  await expect(p1.page.locator('.rm-role')).toHaveText('Driver');
  expect(p1.page.url()).not.toContain('#');
  expect(await p1.page.evaluate((c) => sessionStorage.getItem(`sl-remote-driver:${c}`), room.code)).toBe(room.driverKey);
  await expect(card).toHaveAttribute('data-state', 'paired', { timeout: 10_000 });
  await expect(p1.page.locator('.rm-badge')).toHaveAttribute('data-level', /ok|amber/, { timeout: 10_000 });

  // landscape layout: thumb-sized targets, nothing scrolls, the controls fit the viewport
  for (const size of [LANDSCAPE.viewport, SMALL.viewport]) {
    await p1.page.setViewportSize(size);
    for (const sel of ['.rm-drive-pedal[data-pedal="gas"]', '.rm-drive-pedal[data-pedal="brake"]', '.rm-drive-steer', '.rm-drive-btn >> nth=0']) {
      const b = (await p1.page.locator(sel).boundingBox())!;
      expect(Math.min(b.width, b.height), `${sel} at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(48);
      expect(b.y + b.height).toBeLessThanOrEqual(size.height + 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width + 0.5);
    }
    expect(await p1.page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0]);
    if (size.width === 667) await shot(p1.page, 'phone-667');
  }
  await p1.page.setViewportSize(LANDSCAPE.viewport);

  // GAS takes the wheel on the screen through the drive arbitration ('phone' source)
  const cdp = await p1.page.context().newCDPSession(p1.page);
  const gas = await centreOf(p1.page, '.rm-drive-pedal[data-pedal="gas"]');
  const steer = await centreOf(p1.page, '.rm-drive-steer');
  const g = pt(gas.x, gas.y, 1);
  await touch(cdp, 'touchStart', [g]);
  await expect.poll(mode, { timeout: 10_000 }).toBe('manual');
  await expect(card).toHaveAttribute('data-state', 'driving', { timeout: 10_000 });
  await expect(card.locator('.sl-phone-drive-status-text')).toHaveText('Driven from a phone');
  await expect.poll(async () => (await drive()).speed, { timeout: 20_000 }).toBeGreaterThan(2);
  await expect(p1.page.locator('.rm-drive-mode')).toHaveText('You are driving', { timeout: 10_000 });
  await expect.poll(async () => Number(await p1.page.locator('.rm-drive-speed').textContent()), { timeout: 10_000 }).toBeGreaterThan(3);

  // Drag right = steer right (+ = left in the sim): flicks right and back, timed end to end
  const s0 = pt(steer.x, steer.y, 2);
  await touch(cdp, 'touchStart', [g, s0]);
  const net: number[] = [];
  for (let i = 0; i < 12; i++) {
    const right = i % 2 === 0;
    const before = await screen.evaluate(() => (globalThis as unknown as { __inLog: unknown[] }).__inLog.length);
    const t0 = Date.now();
    await touch(cdp, 'touchMove', [g, { ...s0, x: right ? s0.x + steer.w * 0.4 : s0.x }]);
    const tIn = await screen.evaluate(
      ({ before, right }) =>
        new Promise<number>((resolve) => {
          const log = (globalThis as unknown as { __inLog: { t: number; s: number }[] }).__inLog;
          const check = () => {
            const hit = log.slice(before).find((f) => (right ? f.s < -300 : f.s === 0));
            if (hit) resolve(hit.t);
            else setTimeout(check, 2);
          };
          check();
        }),
      { before, right },
    );
    const tEvent = await p1.page.evaluate(() => (globalThis as unknown as { __inputs: { t: number }[] }).__inputs.at(-1)!.t);
    net.push(tIn - Math.max(t0, tEvent));
    if (right) {
      await expect.poll(async () => (await drive()).steer, { timeout: 5_000 }).toBeLessThan(-0.05);
      if (i === 0) {
        await shot(p1.page, 'phone-driving');
        await shot(screen, 'screen-driving');
      }
    }
    await p1.page.waitForTimeout(150);
  }
  console.log(`12-04 latency phone input event -> in frame at the screen JS (ms, n=${net.length}): min ${Math.min(...net)} p50 ${pct(net, 0.5)} p90 ${pct(net, 0.9)} max ${Math.max(...net)}`);
  expect(pct(net, 0.5)).toBeLessThan(150);
  await touch(cdp, 'touchEnd', []);

  // Tilt (synthetic gravity vectors in a landscape hold; not a real phone): Centre, turn right + Done, then steer right
  const motion = (deg: number) =>
    p1.page.evaluate((d) => {
      const w = globalThis as unknown as { __tilt?: number; __tiltTimer?: number };
      w.__tilt = d;
      w.__tiltTimer ??= window.setInterval(() => {
        const a = ((w.__tilt ?? 0) * Math.PI) / 180;
        // landscape hold: gravity along device -x at rest; rolling the device by a turns gravity in the x-y plane
        const ev = new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: -9.81 * Math.cos(a), y: 9.81 * Math.sin(a), z: 0 }, interval: 16 });
        dispatchEvent(ev);
      }, 16);
    }, deg);
  await motion(0);
  await p1.page.getByRole('button', { name: 'Tilt to steer' }).click();
  await expect(p1.page.locator('.rm-drive-sheet-title')).toHaveText('Hold it like a wheel');
  await p1.page.getByRole('button', { name: 'Centre', exact: true }).click();
  await expect(p1.page.locator('.rm-drive-sheet-title')).toHaveText('Now turn right a little');
  await motion(20);
  await p1.page.waitForTimeout(150);
  await p1.page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(p1.page.locator('.rm-drive-sheet')).toBeHidden();
  await expect(p1.page.locator('.rm-drive')).toHaveAttribute('data-steering', 'tilt');
  await motion(0);
  await p1.page.waitForTimeout(400);
  const gas2 = await centreOf(p1.page, '.rm-drive-pedal[data-pedal="gas"]');
  await touch(cdp, 'touchStart', [pt(gas2.x, gas2.y, 3)]);
  await motion(25);
  await expect.poll(async () => (await drive()).steer, { timeout: 5_000 }).toBeLessThan(-0.05); // tilted right = steer right
  await shot(p1.page, 'phone-tilt');
  await motion(-25);
  await expect.poll(async () => (await drive()).steer, { timeout: 5_000 }).toBeGreaterThan(0.05);
  await touch(cdp, 'touchEnd', []);
  await p1.page.getByRole('button', { name: 'Use slider' }).click();
  await expect(p1.page.locator('.rm-drive')).toHaveAttribute('data-steering', 'touch');

  // A second phone takes the wheel (newest wins); the first gets a calm "replaced" sheet and does not reconnect
  const p2 = await phone(browser, `/remote.html?room=${room.code}#d=${room.driverKey}`);
  await expect(p2.page.locator('.rm-header')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
  await expect(p1.page.locator('.rm-drive-sheet-title')).toHaveText('Another phone took the wheel', { timeout: 10_000 });
  await expect(p1.page.locator('.rm-header')).toHaveAttribute('data-status', 'replaced');
  await shot(p1.page, 'phone-replaced');
  await p1.page.waitForTimeout(2000);
  await expect(p1.page.locator('.rm-header')).toHaveAttribute('data-status', 'replaced'); // final: no ping-pong
  // the second phone drives straight away (its sequence numbers start elsewhere: the screen takes it as a new stream)
  const cdp2 = await p2.page.context().newCDPSession(p2.page);
  const gasB = await centreOf(p2.page, '.rm-drive-pedal[data-pedal="gas"]');
  const steerB = await centreOf(p2.page, '.rm-drive-steer');
  await touch(cdp2, 'touchStart', [pt(gasB.x, gasB.y, 1), pt(steerB.x, steerB.y, 2)]);
  await touch(cdp2, 'touchMove', [pt(gasB.x, gasB.y, 1), pt(steerB.x - steerB.w * 0.4, steerB.y, 2)]);
  await expect.poll(async () => (await drive()).steer, { timeout: 5_000 }).toBeGreaterThan(0.05); // dragged left
  await expect.poll(mode).toBe('manual');

  // Closing the driving phone: failsafe -> Returning within 1.5 s, with a note on the screen
  const tClose = Date.now();
  await p2.page.close();
  await expect.poll(mode, { timeout: 3_000, intervals: [25] }).not.toBe('manual');
  const tReturn = Date.now() - tClose;
  console.log(`12-04 phone closed -> screen left manual after ${tReturn} ms (mode ${await mode()})`);
  expect(tReturn).toBeLessThan(1500);
  await expect(screen.locator('.sl-phone-drive-toast')).toBeVisible();
  await expect(screen.locator('.sl-phone-drive-toast')).toContainText('Phone controller lost');
  await shot(screen, 'screen-failsafe');

  // Wrong key and an unknown room: calm sheets, no reconnect loop
  const bad = await phone(browser, `/remote.html?room=${room.code}#d=${'x'.repeat(32)}`);
  await expect(bad.page.locator('.rm-drive-sheet-title')).toHaveText('This driving code has expired', { timeout: 20_000 });
  await shot(bad.page, 'phone-denied');
  const gone = await phone(browser, `/remote.html?room=ZZZZZ#d=${room.driverKey}`);
  await expect(gone.page.locator('.rm-drive-sheet-title')).toHaveText('Room ZZZZZ has ended', { timeout: 20_000 });

  // The phone page stays small and three.js-free
  const total = p1.scripts.reduce((sum, s) => sum + s.body.length, 0);
  console.log(`12-04 phone scripts: ${p1.scripts.length} files, ${(total / 1024).toFixed(1)} kB (uncompressed)`);
  for (const s of p1.scripts) {
    expect(s.body, s.url).not.toMatch(/WebGLRenderer|three\.module|THREE\./);
    expect(s.url).not.toMatch(/three/);
  }
  expect(total).toBeLessThan(80 * 1024);

  expect(screenErrors).toEqual([]);
  for (const p of [p1, bad, gone]) expect(p.errors.filter((e) => !/WebSocket|40[14]/.test(e))).toEqual([]);
});
