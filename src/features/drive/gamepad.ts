/**
 * Gamepad intent source (ARCHITECTURE-M2 §10.4; research m2/07 §2): standard mapping only, re-read with
 * `navigator.getGamepads()` every frame (never cached). Left stick X steers through our own axial dead zone and
 * response curve, RT/LT are analog pedals, X is the handbrake; A (toggle Auto/Manual) and Y (reset) are commands on the
 * press edge. Pure mapping functions first; the source keeps no DOM beyond `navigator`.
 */
import type { DriveIntent } from '../../contracts/drive';
import type { DriveIntentSource } from '../../contracts/services';

export const PAD = {
  /** Scaled axial dead zone on the steering stick and the response exponent (> 1 = finer near the centre). */
  stickDeadZone: 0.12,
  stickExponent: 1.6,
  /** Triggers rest at 0 but can float a little. */
  triggerDeadZone: 0.04,
} as const;

/** Standard-mapping button indices (W3C Gamepad §standard mapping). */
export const BUTTON = { a: 0, b: 1, x: 2, y: 3, lt: 6, rt: 7 } as const;

export interface PadButton {
  readonly value: number;
  readonly pressed: boolean;
}
export interface HapticLike {
  readonly effects?: readonly string[];
  playEffect?(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
}
/** The parts of a `Gamepad` this module reads (a structural type so tests and the e2e mock can provide one). */
export interface PadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly timestamp: number;
  readonly axes: readonly number[];
  readonly buttons: readonly PadButton[];
  readonly vibrationActuator?: HapticLike | null;
}

/** Scaled axial dead zone: 0 inside ±d, then linear from 0 at d to ±1 at ±1. */
export function deadZone(x: number, d: number): number {
  const a = Math.abs(x);
  if (!(a > d)) return 0; // also NaN
  return (Math.sign(x) * (Math.min(a, 1) - d)) / (1 - d);
}

/** Odd power curve: sign(x)·|x|^e. */
export function curve(x: number, e: number): number {
  return Math.sign(x) * Math.abs(x) ** e;
}

const value = (pad: PadLike, i: number): number => pad.buttons[i]?.value ?? 0;
const pressed = (pad: PadLike, i: number): boolean => pad.buttons[i]?.pressed === true || value(pad, i) > 0.5;

/** Writes the pad's analog intent into `out`; returns true when it is non-neutral (deliberate). */
export function padIntent(pad: PadLike, out: DriveIntent): boolean {
  // stick right (+x) = steer right = negative steer (ISO 8855: + left)
  out.steer = -curve(deadZone(pad.axes[0] ?? 0, PAD.stickDeadZone), PAD.stickExponent);
  out.throttle = deadZone(value(pad, BUTTON.rt), PAD.triggerDeadZone);
  out.brake = deadZone(value(pad, BUTTON.lt), PAD.triggerDeadZone);
  out.handbrake = pressed(pad, BUTTON.x) ? 1 : 0;
  out.digital = false;
  out.source = 'gamepad';
  return out.steer !== 0 || out.throttle !== 0 || out.brake !== 0 || out.handbrake !== 0;
}

/** The pad to read: the last one used if it is still there, else the first connected standard pad. */
export function pickPad(pads: readonly (PadLike | null | undefined)[], preferIndex: number): PadLike | null {
  let first: PadLike | null = null;
  for (const p of pads) {
    if (!p || !p.connected || p.mapping !== 'standard') continue;
    if (p.index === preferIndex) return p;
    first ??= p;
  }
  return first;
}

/** Dual rumble is offered only when the actuator says so (feature detection, research m2/18 §3). */
export function canRumble(pad: PadLike | null): boolean {
  const act = pad?.vibrationActuator;
  return !!act && typeof act.playEffect === 'function' && (act.effects === undefined || act.effects.includes('dual-rumble'));
}

export type PadCommand = 'toggle' | 'reset' | 'input';

export interface GamepadSource extends DriveIntentSource {
  /** The pad read last frame (null when none). */
  readonly pad: PadLike | null;
}

type GetPads = () => readonly (PadLike | null)[];
const navigatorPads: GetPads = () => (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? (navigator.getGamepads() as unknown as (PadLike | null)[]) : []);

/**
 * `onCommand` gets the A / Y press edges and 'input' on any deliberate input; `onPresence` the hot-plug changes (seen
 * by polling, so it also covers browsers that announce a pad only after a press).
 */
export function createGamepadSource(onCommand: (c: PadCommand) => void, onPresence: (pad: PadLike | null) => void, getPads: GetPads = navigatorPads): GamepadSource {
  let pad: PadLike | null = null;
  let prefer = -1;
  let lastA = false;
  let lastY = false;
  let present = '';
  return {
    id: 'gamepad',
    get pad() {
      return pad;
    },
    read(out) {
      let pads: readonly (PadLike | null)[] = [];
      try {
        pads = getPads();
      } catch {
        pads = []; // a browser that refuses (permissions policy) behaves as no pad
      }
      pad = pickPad(pads, prefer);
      const key = pad ? `${pad.index}:${pad.id}` : '';
      if (key !== present) {
        present = key;
        lastA = pad ? pressed(pad, BUTTON.a) : false; // a button held while plugging in is not a press
        lastY = pad ? pressed(pad, BUTTON.y) : false;
        onPresence(pad);
      }
      if (!pad) return false;
      prefer = pad.index;
      const deliberate = padIntent(pad, out);
      const a = pressed(pad, BUTTON.a);
      const y = pressed(pad, BUTTON.y);
      if (a && !lastA) onCommand('toggle');
      if (y && !lastY) onCommand('reset');
      lastA = a;
      lastY = y;
      if (deliberate) onCommand('input');
      return deliberate;
    },
  };
}
