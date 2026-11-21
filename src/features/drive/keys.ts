/** Desktop driving keys (ARCHITECTURE-M2 §10.1) as pure functions over `KeyboardEvent.code` (layout independent). */
import type { DriveIntent, DriveMode } from '../../contracts/drive';

const THROTTLE = ['KeyW', 'ArrowUp'];
const BRAKE = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const HANDBRAKE = ['ShiftLeft', 'ShiftRight'];

/** Codes that take the wheel from Auto. A and S keep their M1 meanings there (amplification, slow motion). */
export const TAKEOVER_CODES: ReadonlySet<string> = new Set(['KeyW', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Codes that drive in Manual. */
export const DRIVE_CODES: ReadonlySet<string> = new Set([...THROTTLE, ...BRAKE, ...LEFT, ...RIGHT, ...HANDBRAKE]);

/** True while the visitor (not the autopilot) drives the plant. */
export const isDriving = (mode: DriveMode): boolean => mode === 'manual';

/** Whether a keydown with this code joins the held set: every driving key in Manual, only takeover keys otherwise. */
export function capturesCode(code: string, mode: DriveMode): boolean {
  return isDriving(mode) ? DRIVE_CODES.has(code) : TAKEOVER_CODES.has(code);
}

const any = (held: ReadonlySet<string>, codes: readonly string[]): boolean => codes.some((c) => held.has(c));

/** Writes the digital intent of the held keys into `out`; opposite steering keys cancel. Returns true if non-neutral. */
export function keyIntent(held: ReadonlySet<string>, out: DriveIntent): boolean {
  out.throttle = any(held, THROTTLE) ? 1 : 0;
  out.brake = any(held, BRAKE) ? 1 : 0;
  out.steer = (any(held, LEFT) ? 1 : 0) - (any(held, RIGHT) ? 1 : 0); // + = left (ISO 8855)
  out.handbrake = any(held, HANDBRAKE) ? 1 : 0;
  out.digital = true;
  out.source = 'keyboard';
  return out.throttle !== 0 || out.brake !== 0 || out.steer !== 0 || out.handbrake !== 0 || held.size > 0;
}

/** Gear readout: R, N, 1..n. */
export function gearLabel(gear: number): string {
  return gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
}
