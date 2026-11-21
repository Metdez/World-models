/** Manual Drive internal types (ARCHITECTURE-M2 §7.1): driver commands, quantised intents, the plant view. */
import { DRIVE_SOURCES, INTENT_QUANT, type DriveIntent } from '../../contracts/drive';

/** One fixed step's driver output. */
export interface DriveCommand {
  /** rad, road-wheel target (mean front), + left. */
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
  direction: 1 | -1;
}

/** A latched intent as integers (INTENT_QUANT); replays store exactly these. */
export interface QuantIntent {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
  /** bit 0 digital, bits 1-3 DRIVE_SOURCES index. */
  flags: number;
}

export const createDriveCommand = (): DriveCommand => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, direction: 1 });
export const createQuantIntent = (): QuantIntent => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, flags: 1 });

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
/** NaN-safe: a non-finite demand quantises to 0. */
const finite = (x: number): number => (x === x && x !== Infinity && x !== -Infinity ? x : 0);

export function quantiseIntent(intent: Readonly<DriveIntent>, out: QuantIntent): QuantIntent {
  const P = INTENT_QUANT.pedal;
  out.steer = Math.round(clamp(finite(intent.steer), -1, 1) * INTENT_QUANT.steer);
  out.throttle = Math.round(clamp(finite(intent.throttle), 0, 1) * P);
  out.brake = Math.round(clamp(finite(intent.brake), 0, 1) * P);
  out.handbrake = Math.round(clamp(finite(intent.handbrake), 0, 1) * P);
  const src = DRIVE_SOURCES.indexOf(intent.source);
  out.flags = (intent.digital ? 1 : 0) | ((src < 0 ? 0 : src) << 1);
  return out;
}

export interface PlantView {
  readonly x: number;
  readonly y: number;
  readonly cosYaw: number;
  readonly sinYaw: number;
  readonly u: number;
  readonly v: number;
  readonly r: number;
  /** Actuator output (mean road-wheel), rad. */
  readonly steer: number;
  /** atan2(v, |u|) via datan2, 0 below 1 m/s. */
  readonly beta: number;
  readonly wheelbase: number;
  readonly maxSteer: number;
  /** 0.9 * front tyre mu * G, m/s^2 (steering limit and stability clamp). */
  readonly lateralLimit: number;
  readonly simTime: number;
}

export interface Driver {
  /** Bumpless start from the command in force. */
  engage(view: PlantView, previous: Readonly<DriveCommand>): void;
  step(dt: number, view: PlantView, out: DriveCommand): void;
}
