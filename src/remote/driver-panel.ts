/**
 * Phone driver panel (plan 12-04; ARCHITECTURE-M2 §12.3; research m2/17). Hold the phone like a wheel: a relative-drag
 * steering slider with GAS / BRAKE by default; tilt steering after an explicit tap (motion permission asked inside
 * that tap, then Centre + Turn-right calibration). Streams `in` frames at 30 Hz plus immediate frames on pedal edges,
 * skipping a tick while the socket still holds bytes (latest wins). Shows the screen's `tel` (speed, gear, mode) and
 * pulses the vibration motor on kerb / grip-limit bits where the browser has one (not iOS). Keeps the screen awake.
 * Calm sheets for "another phone took the wheel", "code rejected" and "room ended".
 */
import { REMOTE_PAGE, type ClientMessage, type ServerMessage } from '../contracts/net';
import { h } from '../ui/dom';
import { forgetHostKey, type LinkStatus, type RemoteLink } from './connection';
import './driver.css';
import { inFrame, learnSign, OneEuro, pedalStep, rawAngle, sliderSteer, steerFromAngle, wrap180 } from './tilt';

export const DRIVER = {
  hz: 30,
  syncMs: 1000,
  /** Without a `tel` for this long the screen side looks stalled, ms. */
  telStaleMs: 1500,
  /** No motion event this long after the grant: sensors blocked (in-app browsers), ms. */
  motionWaitMs: 1000,
  /** Link badge on the round trip to the room, ms. */
  rttAmber: 150,
  rttRed: 300,
} as const;

const FLAG = { wanted: 1, touch: 4 } as const;
const MODE_TEXT = ['Auto · press Gas to drive', 'You are driving', 'Returning to the lap', 'Replay on the screen'] as const;
const VIBRATE = { kerb: [12], grip: [30] } as const;

type Steering = 'touch' | 'tilt';
type Calib = 'off' | 'centre' | 'right';

interface MotionPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export interface DriverPanel {
  readonly el: HTMLElement;
  /** Link badge for the page header. */
  readonly badge: HTMLElement;
  message(m: ServerMessage): void;
  status(s: LinkStatus): void;
  dispose(): void;
}

const gearText = (g: number) => (g < 0 ? 'R' : g === 0 ? 'N' : String(g));

export function createDriverPanel(code: string, link: () => RemoteLink | null): DriverPanel {
  // ---------------------------------------------------------------- DOM
  const knob = h('span', { class: 'rm-drive-knob', 'aria-hidden': 'true' });
  const steerEl = h(
    'div',
    { class: 'rm-drive-steer', role: 'slider', 'aria-label': 'Steering: drag left or right', 'aria-valuemin': '-1', 'aria-valuemax': '1', 'aria-valuenow': '0' },
    h('span', { class: 'rm-drive-track', 'aria-hidden': 'true' }, h('span', { class: 'rm-drive-mark' }), knob),
    h('span', { class: 'rm-drive-cap' }, 'Drag to steer'),
  );
  const gas = h('div', { class: 'rm-drive-pedal', 'data-pedal': 'gas', role: 'button', 'aria-label': 'Gas' }, 'Gas');
  const brake = h('div', { class: 'rm-drive-pedal', 'data-pedal': 'brake', role: 'button', 'aria-label': 'Brake, hold at a stop to reverse' }, 'Brake');

  const wheel = h('span', { class: 'rm-drive-wheel', 'aria-hidden': 'true' }, h('span', { class: 'rm-drive-wheel-spoke' }));
  const speed = h('span', { class: 'rm-drive-speed' }, '–');
  const gear = h('span', { class: 'rm-drive-gear' }, 'N');
  const modeText = h('p', { class: 'rm-drive-mode', 'aria-live': 'polite' }, 'Connecting to the big screen');
  const tiltBtn = h('button', { type: 'button', class: 'rm-button rm-drive-btn', 'aria-pressed': 'false' }, 'Tilt to steer');
  const centreBtn = h('button', { type: 'button', class: 'rm-button rm-drive-btn', hidden: true }, 'Re-centre');
  const handBtn = h('button', { type: 'button', class: 'rm-button rm-drive-btn', hidden: true }, 'Hand back');
  const tiltNote = h('p', { class: 'rm-drive-tiltnote', hidden: true });
  const centre = h(
    'div',
    { class: 'rm-drive-centre' },
    wheel,
    h('div', { class: 'rm-drive-readout' }, speed, h('span', { class: 'rm-drive-unit' }, 'km/h'), gear),
    modeText,
    h('div', { class: 'rm-drive-btns' }, tiltBtn, centreBtn, handBtn),
    tiltNote,
  );

  const sheetTitle = h('h2', { class: 'rm-drive-sheet-title' });
  const sheetText = h('p', { class: 'rm-note' });
  const sheetBtn = h('button', { type: 'button', class: 'rm-button rm-primary' });
  const sheetAlt = h('button', { type: 'button', class: 'rm-button' });
  const sheet = h('div', { class: 'rm-drive-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rm-drive-sheet-title', hidden: true }, h('div', { class: 'rm-card rm-drive-sheet-card' }, sheetTitle, sheetText, h('div', { class: 'rm-drive-sheet-btns' }, sheetBtn, sheetAlt)));
  sheetTitle.id = 'rm-drive-sheet-title';

  const el = h('section', { class: 'rm-panel rm-drive', 'data-steering': 'touch', 'aria-label': `Drive room ${code}` }, steerEl, centre, gas, brake, sheet);
  const badgeText = h('span', { class: 'rm-badge-text' }, '–');
  const badge = h('span', { class: 'rm-badge', title: 'Round trip to the room', 'data-level': 'off' }, h('span', { class: 'rm-badge-dot', 'aria-hidden': 'true' }), badgeText);

  // ---------------------------------------------------------------- state
  let status: LinkStatus = 'connecting';
  let steering: Steering = 'touch';
  let calib: Calib = 'off';
  let wanted = true;
  let n = (Math.random() * 0x100000000) >>> 0; // a fresh stream per page: the screen tells it from an older phone
  let touchSteer = 0;
  let steerId = -1;
  let x0 = 0;
  const held = { gas: -1, brake: -1 };
  const level = { gas: 0, brake: 0 };
  let lastTick = performance.now();
  // tilt
  const filter = new OneEuro();
  let rawNow: number | null = null;
  let neutral = 0;
  let dir: 1 | -1 = 1;
  let tiltDeg = 0;
  let motionAt = -Infinity;
  let motionOn = false;
  // link
  const rtts: number[] = [];
  let telAt = -Infinity;
  let mode = -1;

  const send = (m: ClientMessage) => link()?.send(m);
  const steerRight = () => (steering === 'tilt' && calib === 'off' ? steerFromAngle(tiltDeg) : touchSteer);

  const frame = () => inFrame(n, steerRight(), level.gas, level.brake, (wanted ? FLAG.wanted : 0) | (steering === 'touch' ? FLAG.touch : 0));
  const pushFrame = (edge: boolean) => {
    const l = link();
    if (!l || status !== 'live' || document.visibilityState === 'hidden') return;
    if (!edge && l.bufferedAmount > 0) return; // the network is behind: skip, the next tick carries the newest state
    n = (n + 1) >>> 0;
    l.send(frame());
  };

  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    level.gas = pedalStep(level.gas, held.gas !== -1, dt);
    level.brake = pedalStep(level.brake, held.brake !== -1, dt);
    pushFrame(false);
    paintSteer();
  };
  const timer = setInterval(tick, 1000 / DRIVER.hz);
  const syncTimer = setInterval(() => {
    if (status === 'live') send({ t: 'sync', c0: performance.now() });
    paintBadge();
    if (motionOn && performance.now() - motionAt > DRIVER.motionWaitMs && calib !== 'off') noMotion();
  }, DRIVER.syncMs);

  // ---------------------------------------------------------------- wake lock (tilting is not a touch: the OS would dim)
  type Sentinel = { released: boolean; release(): Promise<void> };
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
  let wake: Sentinel | null = null;
  let wakeWanted = false;
  const keepAwake = () => {
    if (!nav.wakeLock || (wake && !wake.released) || document.visibilityState !== 'visible') return;
    nav.wakeLock.request('screen').then(
      (s) => (wake = s),
      () => undefined,
    );
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && wakeWanted) keepAwake();
    if (document.visibilityState !== 'visible') release();
  };
  document.addEventListener('visibilitychange', onVisible);

  // ---------------------------------------------------------------- touch controls
  const capture = (target: HTMLElement, id: number) => {
    try {
      target.setPointerCapture(id);
    } catch {
      /* synthetic pointer */
    }
  };
  const engage = () => {
    wanted = true;
    if (!wakeWanted) {
      wakeWanted = true;
      keepAwake();
    }
  };
  steerEl.addEventListener('pointerdown', (e) => {
    if (steerId !== -1 || steering !== 'touch') return;
    e.preventDefault();
    steerId = e.pointerId;
    x0 = e.clientX;
    capture(steerEl, e.pointerId);
    steerEl.classList.add('is-held');
    engage();
  });
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== steerId) return;
    touchSteer = sliderSteer(e.clientX - x0, steerEl.getBoundingClientRect().width / 2);
  };
  const endSteer = (e: PointerEvent) => {
    if (e.pointerId !== steerId) return;
    steerId = -1;
    touchSteer = 0;
    steerEl.classList.remove('is-held');
  };
  steerEl.addEventListener('pointermove', onMove);
  addEventListener('pointermove', onMove);
  for (const type of ['pointerup', 'pointercancel'] as const) addEventListener(type, endSteer);
  steerEl.addEventListener('lostpointercapture', endSteer);

  const pedal = (node: HTMLElement, key: 'gas' | 'brake') => {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (held[key] !== -1) return;
      held[key] = e.pointerId;
      capture(node, e.pointerId);
      node.classList.add('is-held');
      engage();
      level[key] = pedalStep(level[key], true, 0);
      pushFrame(true);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== held[key]) return;
      held[key] = -1;
      node.classList.remove('is-held');
      level[key] = Math.max(0, level[key] - 0.25);
      pushFrame(true);
    };
    for (const type of ['pointerup', 'pointercancel'] as const) addEventListener(type, end);
    node.addEventListener('lostpointercapture', end);
  };
  pedal(gas, 'gas');
  pedal(brake, 'brake');
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  handBtn.addEventListener('click', () => {
    wanted = false; // the screen hands back to Auto; any control takes the wheel again
    pushFrame(true);
  });

  // ---------------------------------------------------------------- tilt
  const onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    motionAt = performance.now();
    const raw = rawAngle(g.x, g.y);
    rawNow = raw;
    if (raw === null) {
      tiltNote.textContent = 'Hold the phone upright, like a wheel';
      tiltNote.hidden = steering !== 'tilt';
      return; // too flat: hold the last angle
    }
    if (steering === 'tilt' && calib === 'off' && tiltNote.textContent === 'Hold the phone upright, like a wheel') tiltNote.hidden = true;
    tiltDeg = filter.filter(dir * wrap180(raw - neutral), e.timeStamp);
  };
  const stopMotion = () => {
    if (motionOn) removeEventListener('devicemotion', onMotion);
    motionOn = false;
  };
  const useTouch = (note = '') => {
    stopMotion();
    steering = 'touch';
    calib = 'off';
    el.dataset['steering'] = 'touch';
    tiltBtn.textContent = 'Tilt to steer';
    tiltBtn.setAttribute('aria-pressed', 'false');
    centreBtn.hidden = true;
    tiltNote.textContent = note;
    tiltNote.hidden = !note;
    hideSheet();
  };
  const noMotion = () => useTouch('No motion data here (some in-app browsers block it). Open the link in Safari or Chrome, or keep the slider.');
  const startTilt = () => {
    if (!motionOn) addEventListener('devicemotion', onMotion);
    motionOn = true;
    motionAt = performance.now();
    steering = 'tilt';
    el.dataset['steering'] = 'tilt';
    tiltBtn.textContent = 'Use slider';
    tiltBtn.setAttribute('aria-pressed', 'true');
    centreBtn.hidden = false;
    tiltNote.hidden = true;
    engage();
    calibrate('centre');
  };
  const calibrate = (step: Calib) => {
    calib = step;
    if (step === 'off') return hideSheet();
    if (step === 'centre') showSheet('Hold it like a wheel', 'Hold the phone level in both hands, the way you would hold a steering wheel, then tap Centre.', 'Centre', 'Use slider');
    else showSheet('Now turn right a little', 'Turn the phone gently to the right, like a wheel, then tap Done.', 'Done', 'Use slider');
  };
  tiltBtn.addEventListener('click', () => {
    if (steering === 'tilt') return useTouch();
    // iOS: the permission prompt needs this tap's activation, so it is requested before anything is awaited
    const DM = (globalThis as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
    if (DM && typeof DM.requestPermission === 'function') {
      DM.requestPermission().then(
        (r) => (r === 'granted' ? startTilt() : useTouch('Motion access was not allowed. The slider steers.')),
        () => useTouch('Motion access was not allowed. The slider steers.'),
      );
    } else if (DM) startTilt();
    else useTouch('This browser has no motion sensors. The slider steers.');
  });
  centreBtn.addEventListener('click', () => calibrate('centre'));

  // ---------------------------------------------------------------- sheets (calibration and recovery)
  type SheetKind = 'calib' | 'status';
  let sheetKind: SheetKind | null = null;
  let onPrimary: () => void = () => undefined;
  let onAlt: (() => void) | null = null;
  function showSheet(title: string, text: string, primary: string, alt: string | null, kind: SheetKind = 'calib'): void {
    sheetKind = kind;
    sheetTitle.textContent = title;
    sheetText.textContent = text;
    sheetBtn.textContent = primary;
    sheetAlt.textContent = alt ?? '';
    sheetAlt.hidden = alt === null;
    sheet.hidden = false;
    el.dataset['sheet'] = kind;
  }
  function hideSheet(): void {
    sheetKind = null;
    sheet.hidden = true;
    delete el.dataset['sheet'];
  }
  sheetBtn.addEventListener('click', () => {
    if (sheetKind === 'status') return onPrimary();
    if (calib === 'centre') {
      if (rawNow === null) return void (sheetText.textContent = 'Hold the phone upright, like a wheel, then tap Centre.');
      neutral = rawNow;
      filter.reset();
      tiltDeg = 0;
      return calibrate(dir && centreBtn.dataset['learned'] ? 'off' : 'right');
    }
    if (calib === 'right') {
      const s = rawNow === null ? 0 : learnSign(neutral, rawNow);
      if (s === 0) return void (sheetText.textContent = 'Turn a little further to the right, then tap Done.');
      dir = s;
      centreBtn.dataset['learned'] = '1';
      filter.reset();
      calibrate('off');
    }
  });
  sheetAlt.addEventListener('click', () => (sheetKind === 'status' ? onAlt?.() : useTouch()));

  // ---------------------------------------------------------------- painting
  let painted = Number.NaN;
  function paintSteer(): void {
    const s = steerRight();
    if (s === painted) return;
    painted = s;
    knob.parentElement!.style.setProperty('--s', s.toFixed(3));
    wheel.style.transform = `rotate(${(s * 90).toFixed(1)}deg)`;
    steerEl.setAttribute('aria-valuenow', s.toFixed(2));
  }
  function paintBadge(): void {
    const now = performance.now();
    if (status !== 'live') {
      badge.dataset['level'] = 'off';
      badgeText.textContent = '–';
      return;
    }
    const sorted = [...rtts].sort((a, b) => a - b);
    const rtt = sorted.length ? sorted[sorted.length >> 1]! : Number.NaN;
    const stale = now - telAt > DRIVER.telStaleMs;
    badge.dataset['level'] = stale || rtt > DRIVER.rttRed ? 'red' : rtt > DRIVER.rttAmber ? 'amber' : rtt === rtt ? 'ok' : 'off';
    badgeText.textContent = stale ? 'No screen' : rtt === rtt ? `${Math.round(rtt)} ms` : '–';
    badge.title = stale ? 'The big screen has not answered for a moment' : 'Round trip to the room';
  }

  function message(m: ServerMessage): void {
    if (m.t === 'sync') {
      rtts.push(performance.now() - m.c0);
      if (rtts.length > 5) rtts.shift();
    } else if (m.t === 'tel') {
      const fresh = performance.now() - telAt > DRIVER.telStaleMs;
      telAt = performance.now();
      speed.textContent = String(m.v);
      gear.textContent = gearText(m.g);
      if (m.m !== mode || fresh) {
        mode = m.m;
        el.dataset['mode'] = String(m.m);
        modeText.textContent = MODE_TEXT[m.m] ?? '';
        handBtn.hidden = m.m !== 1;
        if (fresh) paintBadge();
      }
      if (m.k && m.m === 1 && typeof navigator.vibrate === 'function') navigator.vibrate(m.k & 1 ? [...VIBRATE.kerb] : [...VIBRATE.grip]);
    } else if (m.t === 'welcome') {
      telAt = performance.now(); // the screen gets a moment to start its telemetry
      modeText.textContent = 'Press Gas to take the wheel';
      send({ t: 'sync', c0: performance.now() });
    }
  }

  function forgetKey(): void {
    try {
      forgetHostKey(code, sessionStorage);
    } catch {
      /* storage blocked: nothing stored */
    }
  }

  function release(): void {
    held.gas = held.brake = steerId = -1;
    level.gas = level.brake = touchSteer = 0;
    for (const node of [gas, brake, steerEl]) node.classList.remove('is-held');
  }

  function setStatus(s: LinkStatus): void {
    status = s;
    el.dataset['status'] = s;
    paintBadge();
    if (s !== 'live') release();
    if (s === 'live') {
      if (sheetKind === 'status') hideSheet();
      if (steering === 'tilt' && calib !== 'off') calibrate(calib);
      return;
    }
    if (s === 'connecting') modeText.textContent = 'Connecting to the big screen';
    else if (s === 'offline') modeText.textContent = 'Reconnecting…';
    if (s === 'replaced') {
      onPrimary = () => link()?.reconnect();
      onAlt = null;
      showSheet('Another phone took the wheel', 'One phone drives at a time and the newest one wins. You can take the wheel back.', 'Take the wheel back', null, 'status');
    } else if (s === 'denied') {
      onPrimary = () => {
        forgetKey();
        location.replace(`${REMOTE_PAGE}?room=${code}`);
      };
      onAlt = null;
      showSheet('This driving code has expired', 'Scan the "Drive from your phone" code on the big screen again, or follow along from here.', 'Join as audience', null, 'status');
    } else if (s === 'gone') {
      onPrimary = () => {
        forgetKey();
        location.assign(REMOTE_PAGE);
      };
      onAlt = null;
      showSheet(`Room ${code} has ended`, 'Scan the new code on the big screen to drive again.', 'Enter a code', null, 'status');
    }
  }

  return {
    el,
    badge,
    message,
    status: setStatus,
    dispose() {
      clearInterval(timer);
      clearInterval(syncTimer);
      stopMotion();
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('pointermove', onMove);
      for (const type of ['pointerup', 'pointercancel'] as const) removeEventListener(type, endSteer);
      void wake?.release().catch(() => undefined);
    },
  };
}
