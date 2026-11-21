/**
 * Manual Drive, v1 (plan 08-03; ARCHITECTURE-M2 §9, §10.1-10.2; research m2/07, m2/22): the DRIVE service (sources,
 * arbiter, takeover edges) with the keyboard source, the AUTO | MANUAL pill (speed and gear while driving), the
 * takeover prompt, the control hint, the idle cue and hand-back, R reset. 09-05: in Manual the Assists popover (four
 * switches writing store.driveAids, "Assist: simplified model"), aid lamps and the Approximate badge from frame.drive. Mode changes go through the bus
 * ('drive:request' / 'drive:reset'); the kernel mirrors the simulation's mode into store.driveMode.
 */
import { neutralIntent, type DriveMode } from '../../contracts/drive';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { DRIVE } from '../../contracts/services';
import { h, mount } from '../../ui/dom';
import { kmh } from '../../ui/format';
import { createArbiter } from './arbiter';
import { idleState, promptVisible, TIMING, type IdleState } from './idle';
import { AID_COPY, AID_KEYS, aidsSummary, HUD_ICON, LAMP_TEXT, LAMP_TITLE, LAMPS, updateLamps, withAid } from './hud';
import { createKeyboardSource } from './keyboard';
import { gearLabel, isDriving } from './keys';
import './drive.css';

type HintKind = 'none' | 'prompt' | 'controls' | 'cue';

const MODE_LABEL: Readonly<Record<DriveMode, string>> = { auto: 'Auto', manual: 'Manual', returning: 'Returning', replay: 'Replay' };
const ANNOUNCE: Readonly<Record<DriveMode, string>> = {
  auto: 'Auto. The car drives the lap.',
  manual: 'Manual. You are driving. Enter hands back to Auto.',
  returning: 'Returning to the driving line.',
  replay: 'Replay.',
};

const kbd = (...keys: string[]) => keys.map((k) => h('kbd', { class: 'sl-drive-kbd' }, k));
const icon = (id: keyof typeof HUD_ICON) => {
  const el = h('span', { class: 'sl-drive-icon', 'aria-hidden': 'true' });
  el.innerHTML = HUD_ICON[id];
  return el;
};

let frameHandler: ((frame: FrameInfo) => void) | undefined;

export default {
  id: 'drive',
  requires: [],
  phase: 'overlay',

  init(c) {
    const { store, bus } = c;
    const mode = () => store.get().driveMode;
    const available = () => c.sim.current.drive?.available === true;

    const arbiter = createArbiter();
    c.services.provide(DRIVE, {
      addSource: (source) => arbiter.add(source),
      get activeSource() {
        return arbiter.active;
      },
    });

    // --- DOM: hint line above the pill, the pill (one toggle button + readout + note), a polite live region
    const hintPrompt = h('span', { class: 'sl-drive-hint-row', 'data-kind': 'prompt' }, 'Press ', ...kbd('W'), ' or ', ...kbd('↑'), ' to take the wheel');
    const hintControls = h(
      'span',
      { class: 'sl-drive-hint-row', 'data-kind': 'controls' },
      h('span', { class: 'sl-drive-hint-group' }, ...kbd('W', 'A', 'S', 'D'), h('span', { class: 'sl-drive-hint-or' }, 'or arrows'), 'Drive'),
      h('span', { class: 'sl-drive-hint-group' }, ...kbd('R'), 'Reset'),
      h('span', { class: 'sl-drive-hint-group' }, ...kbd('Enter'), 'Hand back'),
    );
    const cueCount = h('span', { class: 'sl-drive-cue-count' });
    const hintCue = h('span', { class: 'sl-drive-hint-row', 'data-kind': 'cue' }, 'Back to Auto in ', cueCount, h('span', { class: 'sl-drive-hint-or' }, '· press any key'));
    const hint = h('div', { class: 'sl-drive-hint', 'aria-hidden': 'true' }, hintPrompt, hintControls, hintCue);

    const autoLabel = h('span', { class: 'sl-drive-seg-label' }, 'Auto');
    const segAuto = h('span', { class: 'sl-drive-seg', 'data-mode': 'auto' }, h('span', { class: 'sl-drive-dot', 'aria-hidden': 'true' }), autoLabel, ...kbd('Enter'));
    const segManual = h('span', { class: 'sl-drive-seg', 'data-mode': 'manual' }, h('span', { class: 'sl-drive-dot', 'aria-hidden': 'true' }), 'Manual', ...kbd('W'));
    const toggle = h(
      'button',
      { type: 'button', class: 'sl-drive-toggle', 'aria-keyshortcuts': 'Enter' },
      h('span', { class: 'sl-drive-thumb', 'aria-hidden': 'true' }),
      segAuto,
      segManual,
    );
    const speed = h('span', { class: 'sl-drive-speed' });
    const gear = h('span', { class: 'sl-drive-gear' });
    const readout = h('span', { class: 'sl-drive-readout', 'aria-hidden': 'true' }, speed, h('span', { class: 'sl-drive-unit' }, 'km/h'), gear);
    const note = h('span', { class: 'sl-drive-note' }, 'Auto only for this vehicle');

    // handling HUD (09-05), Manual only: aid lamps + the Approximate badge in the pill (icon + text, shown only while
    // lit: presence, never colour alone), and the Assists button with its popover of four switches.
    const lampEls = LAMPS.map((id) => h('span', { class: 'sl-drive-lamp', 'data-lamp': id, title: LAMP_TITLE[id], hidden: true }, icon(id), LAMP_TEXT[id]));
    const lamps = h('span', { class: 'sl-drive-lamps' }, ...lampEls);
    const aidsTag = h('span', { class: 'sl-drive-aids-tag' });
    const aidsBtn = h(
      'button',
      { type: 'button', class: 'sl-drive-aids-btn', title: 'Assists', 'aria-expanded': 'false', 'aria-controls': 'sl-drive-aids-panel' },
      icon('assists'),
      aidsTag,
    );
    const switches = AID_KEYS.map((key) =>
      h('input', { type: 'checkbox', role: 'switch', class: 'sl-drive-switch', 'aria-labelledby': `sl-drive-aid-${key}`, 'aria-describedby': `sl-drive-aid-${key}-hint` }),
    );
    const aidsPanel = h(
      'div',
      { id: 'sl-drive-aids-panel', class: 'sl-drive-aids-panel', role: 'group', 'aria-labelledby': 'sl-drive-aids-title', hidden: true },
      h('div', { class: 'sl-drive-aids-head' }, h('span', { id: 'sl-drive-aids-title', class: 'sl-drive-aids-title' }, 'Assists'), h('span', { class: 'sl-drive-aids-model' }, 'Assist: simplified model')),
      ...AID_KEYS.map((key, i) =>
        h(
          'label',
          { class: 'sl-drive-aid' },
          h(
            'span',
            { class: 'sl-drive-aid-text' },
            h('span', { id: `sl-drive-aid-${key}`, class: 'sl-drive-aid-name' }, AID_COPY[key].name),
            h('span', { id: `sl-drive-aid-${key}-hint`, class: 'sl-drive-aid-hint' }, AID_COPY[key].hint),
          ),
          switches[i],
        ),
      ),
    );

    const pill = h('div', { class: 'sl-drive-pill' }, toggle, readout, lamps, aidsBtn, note);
    const root = h('div', { class: 'sl-drive' }, hint, pill, aidsPanel);
    const announce = h('div', { class: 'sl-visually-hidden', 'aria-live': 'polite' });
    c.addDisposer(mount(c.dom.overlay, root));
    c.addDisposer(mount(c.dom.overlay, announce));

    // --- state
    const intent = neutralIntent();
    const idle: IdleState = { countdown: 0, handBack: false };
    let idleS = 0;
    let autoS = 0;
    let controlsS = 0;
    const shown = { mode: '' as DriveMode | '', available: null as boolean | null, hint: 'none' as HintKind, countdown: -1, kmh: -1, gear: Number.NaN, lamps: 0 };
    const lampHold = new Float64Array(LAMPS.length);

    const refuse = () => {
      note.classList.remove('is-pulse');
      void note.offsetWidth; // restart the pulse
      note.classList.add('is-pulse');
      if (announce.textContent !== 'Manual driving is not available for this vehicle.') announce.textContent = 'Manual driving is not available for this vehicle.';
    };
    const takeOver = () => {
      if (!available()) return refuse();
      bus.emit('drive:request', { mode: 'manual' });
    };
    const handBack = () => {
      idleS = 0;
      bus.emit('drive:request', { mode: 'auto', immediate: true });
      if (store.get().paused) store.setKey('paused', false);
    };
    const toggleMode = () => (isDriving(mode()) ? handBack() : takeOver());

    const keyboard = createKeyboardSource(mode, (command) => {
      idleS = 0;
      if (command === 'toggle') toggleMode();
      else if (command === 'reset') bus.emit('drive:reset', {});
      // a driving key while paused unpauses (§10.1)
      else if (isDriving(mode()) && store.get().paused) store.setKey('paused', false);
    });
    c.addDisposer(() => keyboard.dispose());
    c.addDisposer(arbiter.add(keyboard));

    toggle.addEventListener('click', (e) => {
      if (e.detail > 0) toggle.blur(); // pointer click: keep Space/Enter for the scene
      toggleMode();
    });

    // Assists popover: a disclosure; Escape or a click elsewhere closes it. A pointer toggle gives focus back to the
    // page so the driving keys keep working (a focused switch would swallow them as a form control).
    const setAidsOpen = (open: boolean, focusButton = false) => {
      if (open === !aidsPanel.hidden) return;
      aidsPanel.hidden = !open;
      aidsBtn.setAttribute('aria-expanded', String(open));
      aidsBtn.classList.toggle('is-open', open);
      if (focusButton) aidsBtn.focus();
    };
    aidsBtn.addEventListener('click', (e) => {
      if (e.detail > 0) aidsBtn.blur();
      setAidsOpen(aidsPanel.hidden);
    });
    let pointerToggle = false;
    aidsPanel.addEventListener('pointerdown', () => (pointerToggle = true));
    aidsPanel.addEventListener('keydown', () => (pointerToggle = false));
    switches.forEach((input, i) =>
      input.addEventListener('change', () => {
        store.setKey('driveAids', withAid(store.get().driveAids, AID_KEYS[i]!, input.checked));
        if (pointerToggle) input.blur();
      }),
    );
    const onAidsKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || aidsPanel.hidden) return;
      e.preventDefault(); // controls' Escape (and anything else) leaves it alone
      setAidsOpen(false, true);
    };
    aidsPanel.addEventListener('keydown', onAidsKey);
    aidsBtn.addEventListener('keydown', onAidsKey);
    const onOutside = (e: PointerEvent) => {
      if (!aidsPanel.hidden && e.target instanceof Node && !aidsPanel.contains(e.target) && !aidsBtn.contains(e.target)) setAidsOpen(false);
    };
    window.addEventListener('pointerdown', onOutside, true);
    c.addDisposer(() => window.removeEventListener('pointerdown', onOutside, true));

    const onPointer = () => (idleS = 0);
    for (const type of ['pointerdown', 'wheel'] as const) {
      window.addEventListener(type, onPointer, { passive: true });
      c.addDisposer(() => window.removeEventListener(type, onPointer));
    }

    c.on('drive:mode', ({ mode: next, previous }) => {
      if (isDriving(previous) && !isDriving(next)) {
        arbiter.disarm(); // a key still held after the hand-back must be released before it can take over again
        autoS = 0;
      }
      if (isDriving(next)) {
        controlsS = TIMING.controlsFor;
        idleS = 0;
      }
      announce.textContent = ANNOUNCE[next];
    });
    c.watch((s) => {
      root.classList.toggle('is-hidden', s.attract || !s.hudVisible);
      root.classList.toggle('is-attract', s.attract);
      if (s.attract || !s.hudVisible) setAidsOpen(false);
      const aids = s.driveAids;
      switches.forEach((input, i) => (input.checked = aids[AID_KEYS[i]!]));
      const sum = aidsSummary(aids);
      aidsTag.textContent = sum.tag;
      aidsTag.hidden = sum.tag === '';
      aidsBtn.setAttribute('aria-label', sum.label);
    });

    const setHint = (kind: HintKind) => {
      if (kind === shown.hint) return;
      shown.hint = kind;
      hint.dataset.kind = kind;
      hint.classList.toggle('is-shown', kind !== 'none');
      root.classList.toggle('has-hint', kind !== 'none');
    };

    frameHandler = ({ dt, time, t }) => {
      const m = mode();
      const driving = isDriving(m);
      const can = available();

      const r = arbiter.update(time, intent);
      if (r.deliberate) idleS = 0;
      if (r.fresh && !driving) takeOver();
      if (driving) c.sim.current.drive?.setIntent(intent);

      // timers
      let kind: HintKind = 'none';
      if (driving) {
        idleS += dt;
        controlsS = Math.max(0, controlsS - dt);
        idleState(idleS, c.flags.screen, idle);
        if (idle.handBack) handBack();
        else if (idle.countdown > 0) kind = 'cue';
        else if (controlsS > 0) kind = 'controls';
      } else {
        idleS = 0;
        if (m === 'auto') autoS += dt;
        if (can && m === 'auto' && promptVisible(autoS)) kind = 'prompt';
      }
      setHint(kind);
      if (kind === 'cue' && idle.countdown !== shown.countdown) {
        if (shown.countdown <= 0) announce.textContent = 'Back to Auto in 3 seconds. Press any key to keep driving.';
        shown.countdown = idle.countdown;
        cueCount.textContent = String(idle.countdown);
      } else if (kind !== 'cue') shown.countdown = 0;

      // pill
      if (m !== shown.mode || can !== shown.available) {
        shown.mode = m;
        shown.available = can;
        pill.dataset.mode = driving ? 'manual' : 'auto';
        pill.classList.toggle('is-unavailable', !can && !driving);
        autoLabel.textContent = driving ? 'Auto' : MODE_LABEL[m];
        toggle.setAttribute('aria-pressed', String(driving));
        if (!can && !driving) {
          toggle.setAttribute('aria-disabled', 'true');
          toggle.setAttribute('aria-label', `Driving mode: ${MODE_LABEL[m]}. Manual driving is not available for this vehicle`);
          toggle.title = 'Auto only for this vehicle';
        } else {
          toggle.removeAttribute('aria-disabled');
          toggle.setAttribute('aria-label', driving ? 'Driving mode: Manual. Hand back to Auto' : `Driving mode: ${MODE_LABEL[m]}. Take the wheel`);
          toggle.title = driving ? 'Hand back to Auto (Enter)' : 'Take the wheel (W, ↑ or Enter)';
        }
      }
      const lit = updateLamps(t.drive, driving, dt, lampHold);
      if (lit !== shown.lamps) {
        shown.lamps = lit;
        lampEls.forEach((el, i) => (el.hidden = (lit & (1 << i)) === 0));
        lamps.classList.toggle('is-lit', lit !== 0);
      }
      if (!driving) setAidsOpen(false);
      if (driving) {
        const d = t.drive;
        const v = Math.round(kmh(Math.hypot(d.u, d.v)));
        if (v !== shown.kmh) speed.textContent = String((shown.kmh = v));
        if (d.gear !== shown.gear) gear.textContent = gearLabel((shown.gear = d.gear));
      }
    };
    c.addDisposer(() => (frameHandler = undefined));
  },

  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
