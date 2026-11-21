/**
 * Drive events (ARCHITECTURE-M2 §7.11). 08-02: mode, reset, zone, out-of-bounds, fault (raised by control/plant via
 * these factories); the slide / lock-up / wheelspin / aid detectors are 11-02's (createDriveDetectors is inert here).
 * Events are rare (never per frame): each is a small new object.
 */
import type { DriveEvent, DriveMode } from '../../contracts/drive';
import type { PlantView } from './types';

export const modeEvent = (simTime: number, mode: DriveMode, previous: DriveMode, cut: boolean): DriveEvent => ({ kind: 'mode', mode, previous, cut, simTime });
export const resetEvent = (simTime: number, spawn: string | null): DriveEvent => ({ kind: 'reset', spawn, simTime });
export const zoneEvent = (simTime: number, zone: string, entered: boolean): DriveEvent => ({ kind: 'zone', zone, entered, simTime });
export const outOfBoundsEvent = (simTime: number): DriveEvent => ({ kind: 'out-of-bounds', simTime });
export const faultEvent = (simTime: number, count: number): DriveEvent => ({ kind: 'fault', count, simTime });

/** Per-wheel and driver values the detectors read (plain preallocated object; 11-02 fills the detectors). */
export interface DetectorInput {
  readonly slipAngle: Float64Array;
  readonly slipRatio: Float64Array;
  readonly omega: Float64Array;
  readonly vx: Float64Array;
  readonly load: Float64Array;
  readonly capacity: Float64Array;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  throttle: number;
  brake: number;
  absActive: boolean;
  tractionActive: boolean;
  stabilityActive: boolean;
  zone: string;
  simTime: number;
}

export interface DriveDetectors {
  reset(): void;
  step(dt: number, view: PlantView, frameLike: DetectorInput, out: DriveEvent[]): void;
}

/** shortcut: no detectors until 11-02 (slide, lockup, wheelspin, aid). */
export function createDriveDetectors(): DriveDetectors {
  return { reset() {}, step() {} };
}
