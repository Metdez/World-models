/**
 * Coach (plan 11-02; ARCHITECTURE-M2 §9, §10.5; research m2/13): while the visitor drives, one plain line explains a
 * moment right after it happened (a slide, a lift-off rotation, a lock-up, wheelspin, an assist stepping in, a kerb or
 * bump strike, a wheel going light, a hard stop, a suspension swap), and entering a station's zone shows what to try
 * there. Same place and look as the insights caption (insights stay with Auto), one polite announcement per line,
 * silent in attract mode and with the HUD hidden. Lines and their rate limits live in rules.ts.
 *
 * shortcut: the plant does not run the sim-core detectors yet (the hook belongs in drive/plant.ts, not owned by 11-02),
 * so the coach runs the same detectors (createDriveDetectors) on each rendered Manual frame. As soon as a detector kind
 * arrives on the bus ('drive:event' slide / lockup / wheelspin / aid) the local copy stops for those kinds.
 */
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { DriveEvent } from '../../contracts/drive';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { createDetectorInput, createDriveDetectors, frameDetectorInput, type DetectorInput, type DriveDetectors, type DriveMoment } from '../../sim-core/drive/events';
import { h, mount } from '../../ui/dom';
import { CoachEngine, compose, stationIn, stationLine, templateFor, type CoachMoment, type Line } from './rules';
import './coach.css';

/** Visible time and exit fade, simulation seconds (as the insights caption). */
const VISIBLE_S = 6;
const CARD_VISIBLE_S = 9;
const LEAVE_S = 0.3;
/** Moments right after a takeover are the engage transient, not the driver's doing. */
const TAKEOVER_QUIET_S = 1;
/** Longest frame step fed to the detectors, s (a longer gap restarts their timers instead). */
const MAX_DT = 0.25;

interface State {
  readonly ctx: FeatureContext;
  readonly root: HTMLElement;
  readonly caption: HTMLElement;
  readonly text: HTMLElement;
  readonly chip: HTMLElement;
  readonly announce: HTMLElement;
  readonly engine: CoachEngine;
  readonly input: DetectorInput;
  readonly events: DriveEvent[];
  readonly moments: DriveMoment[];
  detectors: DriveDetectors;
  /** The simulation already delivers detector events: the local detectors stand down. */
  hooked: boolean;
  quiet: boolean;
  lastSimTime: number;
  hideAt: number;
}

let st: State | undefined;

const driving = (t: TelemetryFrame) => t.drive.mode === 'manual';

function present(s: State, line: Line, visible: number): void {
  const t = s.ctx.sim.frame;
  s.hideAt = t.simTime + visible;
  s.text.textContent = line.text;
  s.chip.textContent = line.chip;
  s.chip.hidden = line.chip === '';
  s.caption.classList.toggle('is-warn', line.warn);
  s.caption.classList.remove('is-leaving');
  s.caption.hidden = true;
  void s.caption.offsetWidth; // restart the enter animation
  s.caption.hidden = false;
  // one polite announcement of the sentence; the number chip stays silent (07-03: numbers never sit in a live region)
  s.announce.textContent = line.text;
  s.ctx.bus.emit('insight:shown', { id: `coach:${line.id}`, text: line.text });
}

function hide(s: State): void {
  s.caption.hidden = true;
  s.caption.classList.remove('is-leaving');
  s.hideAt = Number.POSITIVE_INFINITY;
}

function label(c: FeatureContext, id: string): string {
  return c.registries.suspensions.get(id)?.copy.label ?? id;
}

function offer(s: State, m: CoachMoment): void {
  const t = s.ctx.sim.frame;
  if (s.quiet || !driving(t)) return;
  const tpl = templateFor(m);
  if (tpl) s.engine.offer(compose(tpl, m, t, (id) => label(s.ctx, id)), t.simTime);
}

function onDriveEvent(s: State, e: DriveEvent): void {
  const t = s.ctx.sim.frame;
  switch (e.kind) {
    case 'mode':
      s.detectors.reset();
      s.lastSimTime = Number.NaN;
      s.engine.clear(e.mode === 'manual' ? t.simTime + TAKEOVER_QUIET_S : Number.NEGATIVE_INFINITY);
      if (e.mode !== 'manual') hide(s);
      return;
    case 'reset':
      s.detectors.reset();
      s.engine.noteReset(t.simTime);
      s.engine.clear(t.simTime + TAKEOVER_QUIET_S);
      return;
    case 'zone': {
      const world = s.ctx.sim.current.world?.def;
      if (!e.entered || !world || s.quiet || !driving(t)) return;
      const station = stationIn(world.stations, e.zone, t.drive.x, t.drive.y);
      const line = station && s.engine.card(stationLine(station), t.simTime);
      if (line) present(s, line, CARD_VISIBLE_S);
      return;
    }
    case 'slide':
    case 'lockup':
    case 'wheelspin':
    case 'aid':
      s.hooked = true;
      offer(s, e);
      return;
    default:
      return;
  }
}

function resetVehicle(s: State): void {
  s.detectors = createDriveDetectors(s.ctx.sim.current.vehicle);
  s.engine.forget();
  s.lastSimTime = Number.NaN;
  hide(s);
}

const coach: FeatureModule = {
  id: 'coach',
  requires: [],
  phase: 'overlay',

  init(c) {
    const text = h('span', { class: 'sl-coach-text' });
    const chip = h('span', { class: 'sl-coach-chip sl-num', hidden: true });
    const caption = h('p', { class: 'sl-coach-caption', hidden: true }, text, chip);
    const root = h('div', { class: 'sl-coach' }, caption);
    const announce = h('div', { class: 'sl-coach-announce sl-visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
    c.addDisposer(mount(c.dom.overlay, root));
    c.addDisposer(mount(c.dom.overlay, announce));
    const s: State = {
      ctx: c,
      root,
      caption,
      text,
      chip,
      announce,
      engine: new CoachEngine(),
      input: createDetectorInput(),
      events: [],
      moments: [],
      detectors: createDriveDetectors(c.sim.current.vehicle),
      hooked: false,
      quiet: false,
      lastSimTime: Number.NaN,
      hideAt: Number.POSITIVE_INFINITY,
    };
    st = s;

    c.on('sim:vehicle', () => resetVehicle(s));
    c.on('sim:seek', () => {
      s.detectors.reset();
      s.lastSimTime = Number.NaN;
    });
    c.on('drive:event', (e) => onDriveEvent(s, e));
    c.on('sim:event', (e) => {
      if (e.kind === 'liftoff') offer(s, { kind: 'wheel-lift', corner: e.corner });
      else if (e.kind === 'bump-stop') offer(s, { kind: 'bump-stop', corner: e.corner });
    });
    c.on('sim:suspension', ({ suspensionId, previous }) => offer(s, { kind: 'swap', previous, next: suspensionId }));
    c.watch((state) => {
      s.quiet = state.attract || !state.hudVisible;
      root.hidden = s.quiet;
      if (s.quiet) s.engine.clear();
    });
    c.addDisposer(() => {
      st = undefined;
    });
  },

  update(frame: FrameInfo) {
    const s = st;
    if (!s) return;
    const t = frame.t;
    if (t.simTime >= s.hideAt) {
      s.caption.classList.add('is-leaving');
      if (t.simTime >= s.hideAt + LEAVE_S) hide(s);
    }
    if (!driving(t) || t.vehicleClass !== 'car') return;
    const dt = t.simTime - s.lastSimTime;
    if (dt === 0) return; // paused: nothing new
    s.lastSimTime = t.simTime;
    if (!(dt > 0 && dt <= MAX_DT)) s.detectors.reset();
    else {
      s.detectors.step(dt, t.drive, frameDetectorInput(t, s.input), s.events, s.moments);
      // DriveEvent kinds: from the bus once the simulation delivers them; the moments only come from here
      if (!s.hooked) for (let i = 0; i < s.events.length; i++) offer(s, s.events[i]!);
      for (let i = 0; i < s.moments.length; i++) offer(s, s.moments[i]!);
      s.events.length = 0;
      s.moments.length = 0;
    }
    if (s.quiet) return;
    const line = s.engine.tick(t.simTime);
    if (line) present(s, line, VISIBLE_S);
  },
};

export default coach;
