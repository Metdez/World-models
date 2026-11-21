/**
 * Drive events (ARCHITECTURE-M2 §7.11). 08-02: mode, reset, zone, out-of-bounds, fault (raised by control/plant via
 * these factories). 11-02: the detectors of the moments worth explaining while a person drives.
 *
 * Detectors (thresholds from §7.11; dt-independent, so the same code runs per fixed step or per sampled frame):
 *  - slide (per axle): mean |tan alpha| / tan alpha_peak(load) > 1.05 for > 0.15 s at u > 3 m/s, where tan alpha_peak =
 *    peakSlip * capacity / C_alpha(load) is the lateral peak of the plant's own tyre curve (tyre.ts). `lift` when the
 *    throttle is < 0.05 at the event and was > 0.3 within the previous 0.5 s (and no traction-assist cut in that time).
 *  - lockup (per wheel): slip ratio < -0.8 (R omega < 0.2 v), u > 3 m/s, brake > 0.3, for 0.1 s.
 *  - wheelspin (per wheel): slip ratio > 0.25 and slip speed > 2 m/s with throttle > 0.3 at u > 3 m/s, for 0.2 s.
 *  - aid: rising edge of an assist's active flag (ABS, traction, stability).
 *  - moments (11-02, the `moments` output; DriveEvent kinds since 11-05, which added them to the contract union and has
 *    the plant forward them through `driveEvents`): strike (per wheel: compression rate
 *    >= 0.6 m/s at u > 3 m/s with the wheel >= 20 mm above its recent travel (lag, tau 0.2 s), never on cobbles (they
 *    are a texture, not a hit); `kerb` when the patch is on a kerb) and hard stop (from >= 8 m/s to < 0.5 m/s with a
 *    mean deceleration >= 0.6 g). Wheel lift and bump-stop hits are the M1 SimEvents ('liftoff', 'bump-stop').
 * Every detector channel (kind x axle/wheel/aid) re-arms only after its condition has been false for 0.5 s and fires
 * at most once per 0.3 s. Deterministic (+ - * / sqrt abs only), allocation-free between events; events are rare (a
 * small new object each).
 */
import type { DriveEvent, DriveMode } from '../../contracts/drive';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { G } from '../../contracts/units';
import type { VehicleDefinition } from '../../contracts/vehicle';
import { stiffnessAt, tyreCoefficients, type TyreCoefficients } from './tyre';
import type { PlantView } from './types';

export const modeEvent = (simTime: number, mode: DriveMode, previous: DriveMode, cut: boolean): DriveEvent => ({ kind: 'mode', mode, previous, cut, simTime });
export const resetEvent = (simTime: number, spawn: string | null): DriveEvent => ({ kind: 'reset', spawn, simTime });
export const zoneEvent = (simTime: number, zone: string, entered: boolean): DriveEvent => ({ kind: 'zone', zone, entered, simTime });
export const outOfBoundsEvent = (simTime: number): DriveEvent => ({ kind: 'out-of-bounds', simTime });
export const faultEvent = (simTime: number, count: number): DriveEvent => ({ kind: 'fault', count, simTime });

/**
 * Moments: a wheel striking a kerb or bump, a hard stop (`from` = speed when braking began, m/s). 11-02 kept them apart
 * because the DriveEvent union then had no kind for them; 11-05 added `strike` / `hard-stop` to the contract, so these
 * are structurally DriveEvents and the plant queues them with the other events (they reach the bus via drainEvents).
 */
export type DriveMoment =
  | { readonly kind: 'strike'; readonly corner: number; readonly kerb: boolean; readonly simTime: number }
  | { readonly kind: 'hard-stop'; readonly from: number; readonly simTime: number };

/** Detector thresholds (§7.11 and the moments above). */
export const DETECTOR = {
  minSpeed: 3,
  slideRatio: 1.05,
  slideSustain: 0.15,
  liftWindow: 0.5,
  liftFrom: 0.3,
  liftTo: 0.05,
  lockSlip: -0.8,
  lockBrake: 0.3,
  lockSustain: 0.1,
  spinSlip: 0.25,
  spinSustain: 0.2,
  /** and a slip speed (slip ratio x u) above this, m/s: the traction assist's launch slip stays below it. */
  spinSpeed: 2,
  strikeRate: 0.6,
  /** ... that has pushed the wheel this far (m) above its recent travel (a hit, not body roll or small ripples) ... */
  strikeRise: 0.02,
  /** ... the recent travel being a first-order lag with this time constant, s. */
  strikeTau: 0.2,
  hardStopFrom: 8,
  hardStopTo: 0.5,
  hardStopDecel: 0.6 * G,
  rearm: 0.5,
  minGap: 0.3,
} as const;

const WHEELS = 4;

/** Per-wheel and driver values the detectors read (plain preallocated object). */
export interface DetectorInput {
  readonly slipAngle: Float64Array;
  readonly slipRatio: Float64Array;
  readonly omega: Float64Array;
  readonly vx: Float64Array;
  readonly load: Float64Array;
  readonly capacity: Float64Array;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  /** 11-02: wheel travel (m, + bump) and its rate (m/s, + compressing); surface under the patch: 1 kerb, 2 cobbles, 0 other. */
  readonly travel: Float64Array;
  readonly travelRate: Float64Array;
  readonly kerb: Uint8Array;
  throttle: number;
  brake: number;
  absActive: boolean;
  tractionActive: boolean;
  stabilityActive: boolean;
  zone: string;
  simTime: number;
}

export function createDetectorInput(): DetectorInput {
  const f = () => new Float64Array(WHEELS);
  return {
    slipAngle: f(),
    slipRatio: f(),
    omega: f(),
    vx: f(),
    load: f(),
    capacity: f(),
    fx: f(),
    fy: f(),
    travel: f(),
    travelRate: f(),
    kerb: new Uint8Array(WHEELS),
    throttle: 0,
    brake: 0,
    absActive: false,
    tractionActive: false,
    stabilityActive: false,
    zone: '',
    simTime: 0,
  };
}

/** Fills `input` from a sampled car frame (TRUE fields; the wheel's forward speed is taken as the body's u). */
export function frameDetectorInput(frame: TelemetryFrame, input: DetectorInput): DetectorInput {
  const d = frame.drive;
  const n = frame.corners.length < WHEELS ? frame.corners.length : WHEELS;
  for (let i = 0; i < n; i++) {
    const c = frame.corners[i]!;
    input.slipAngle[i] = c.slipAngle;
    input.slipRatio[i] = c.slipRatio;
    input.omega[i] = c.omega;
    input.vx[i] = d.u;
    input.load[i] = c.load;
    input.capacity[i] = c.capacity;
    input.fx[i] = c.fx;
    input.fy[i] = c.fy;
    input.travel[i] = c.travel;
    input.travelRate[i] = c.travelRate;
    input.kerb[i] = c.surface === 'kerb' ? 1 : c.surface === 'pave' ? 2 : 0;
  }
  input.throttle = d.throttle;
  input.brake = d.brake;
  input.absActive = d.absActive;
  input.tractionActive = d.tractionActive;
  input.stabilityActive = d.stabilityActive;
  input.zone = d.zone;
  input.simTime = frame.simTime;
  return input;
}

export interface DriveDetectors {
  reset(): void;
  /** `moments` (optional) receives the strike / hard-stop moments (DriveEvent kinds since 11-05). `view` is read for u only. */
  step(dt: number, view: Pick<PlantView, 'u'>, frameLike: DetectorInput, out: DriveEvent[], moments?: DriveMoment[]): void;
}

// channel layout: slide front/rear, lockup x4, wheelspin x4, aid x3, strike x4
const SLIDE = 0;
const LOCK = 2;
const SPIN = 6;
const AID = 10;
const STRIKE = 13;
const CHANNELS = 17;
const AIDS = ['abs', 'traction', 'stability'] as const;
const AXLES = ['front', 'rear'] as const;

/**
 * `vehicle` with handling data enables the slide detector (it needs the tyre curve's peak); without it the other
 * detectors still run.
 */
export function createDriveDetectors(vehicle?: VehicleDefinition): DriveDetectors {
  const handling = vehicle && vehicle.class === 'car' ? vehicle.handling : undefined;
  const coeff: readonly [TyreCoefficients, TyreCoefficients] | null =
    vehicle && vehicle.class === 'car' && handling ? [tyreCoefficients(vehicle.front.tyre, handling.tyres.front), tyreCoefficients(vehicle.rear.tyre, handling.tyres.rear)] : null;
  const params = vehicle && vehicle.class === 'car' ? ([vehicle.front.tyre, vehicle.rear.tyre] as const) : null;
  const stiff = new Float64Array(3);

  /** Time the channel's condition has been true (s); NaN = false. */
  const onFor = new Float64Array(CHANNELS);
  /** Time the condition has been false since the last event (s). */
  const offFor = new Float64Array(CHANNELS);
  const armed = new Uint8Array(CHANNELS);
  const lastFire = new Float64Array(CHANNELS);
  // driver history: last time throttle > liftFrom, last time traction assist acted, speed and time braking began; and
  // the detector clock (sum of dt: timing never depends on the caller's simTime; a typed slot, so no boxed number)
  const hist = new Float64Array(5);
  /** Recent (lagged) travel per wheel, m; NaN = not seen yet. */
  const recent = new Float64Array(WHEELS);

  function reset(): void {
    onFor.fill(Number.NaN);
    offFor.fill(Number.POSITIVE_INFINITY);
    armed.fill(1);
    lastFire.fill(Number.NEGATIVE_INFINITY);
    hist[0] = Number.NEGATIVE_INFINITY;
    hist[1] = Number.NEGATIVE_INFINITY;
    hist[2] = Number.NaN;
    hist[3] = Number.NaN;
    hist[4] = 0;
    recent.fill(Number.NaN);
  }
  reset();

  /** Advances channel `k` with this step's condition; true when it should fire now (after `sustain` s). */
  function channel(k: number, condition: boolean, sustain: number, dt: number, now: number): boolean {
    if (!condition) {
      onFor[k] = Number.NaN;
      offFor[k] = offFor[k]! + dt;
      if (offFor[k]! >= DETECTOR.rearm) armed[k] = 1;
      return false;
    }
    offFor[k] = 0;
    onFor[k] = onFor[k] !== onFor[k] ? 0 : onFor[k]! + dt;
    if (!armed[k] || onFor[k]! < sustain - 1e-9 || now - lastFire[k]! < DETECTOR.minGap) return false;
    armed[k] = 0;
    lastFire[k] = now;
    return true;
  }

  /** Lateral slip over the tyre curve's lateral peak at this load and grip (0 when unloaded). */
  function slideRatio(i: number, input: DetectorInput): number {
    const load = input.load[i]!;
    const cap = input.capacity[i]!;
    if (!coeff || !params || !(load > 0) || !(cap > 0)) return 0;
    const a = i < 2 ? 0 : 1;
    stiffnessAt(params[a]!, coeff[a]!, load, stiff);
    return (stiff[0]! * Math.abs(input.slipAngle[i]!)) / (coeff[a]!.peakSlip * cap);
  }

  return {
    reset,
    step(dt, view, input, out, moments) {
      const now = (hist[4] = hist[4]! + dt);
      const at = input.simTime;
      const u = view.u;
      const moving = u > DETECTOR.minSpeed;
      if (input.throttle > DETECTOR.liftFrom) hist[0] = now;
      if (input.tractionActive) hist[1] = now;

      // §7.11 `lift`: at the event the throttle is < 0.05 and was > 0.3 within the previous 0.5 s (not a traction cut)
      const lift = input.throttle < DETECTOR.liftTo && now - hist[0]! <= DETECTOR.liftWindow && now - hist[1]! > DETECTOR.liftWindow;
      for (let a = 0; a < 2; a++) {
        const r = moving ? (slideRatio(2 * a, input) + slideRatio(2 * a + 1, input)) / 2 : 0;
        if (channel(SLIDE + a, r > DETECTOR.slideRatio, DETECTOR.slideSustain, dt, now)) out.push({ kind: 'slide', axle: AXLES[a]!, lift, simTime: at });
      }

      for (let i = 0; i < WHEELS; i++) {
        const k = input.slipRatio[i]!;
        const lock = moving && input.brake > DETECTOR.lockBrake && k < DETECTOR.lockSlip && input.vx[i]! > DETECTOR.minSpeed;
        if (channel(LOCK + i, lock, DETECTOR.lockSustain, dt, now)) out.push({ kind: 'lockup', corner: i, simTime: at });
        const spin = moving && input.throttle > DETECTOR.liftFrom && k > DETECTOR.spinSlip && k * input.vx[i]! > DETECTOR.spinSpeed;
        if (channel(SPIN + i, spin, DETECTOR.spinSustain, dt, now)) out.push({ kind: 'wheelspin', corner: i, simTime: at });
        const travel = input.travel[i]!;
        if (recent[i] !== recent[i]) recent[i] = travel;
        const strike = moving && input.kerb[i] !== 2 && input.travelRate[i]! >= DETECTOR.strikeRate && travel - recent[i]! >= DETECTOR.strikeRise;
        if (travel === travel) recent[i] = recent[i]! + (dt < DETECTOR.strikeTau ? dt / DETECTOR.strikeTau : 1) * (travel - recent[i]!);
        if (channel(STRIKE + i, strike, 0, dt, now) && moments) moments.push({ kind: 'strike', corner: i, kerb: input.kerb[i] === 1, simTime: at });
      }

      // an aid's rising edge (after it stayed quiet for the re-arm time)
      if (channel(AID, input.absActive, 0, dt, now)) out.push({ kind: 'aid', aid: AIDS[0], simTime: at });
      if (channel(AID + 1, input.tractionActive, 0, dt, now)) out.push({ kind: 'aid', aid: AIDS[1], simTime: at });
      if (channel(AID + 2, input.stabilityActive, 0, dt, now)) out.push({ kind: 'aid', aid: AIDS[2], simTime: at });

      // hard stop: braking began at speed and ended near standstill with a high mean deceleration
      const braking = input.brake > DETECTOR.lockBrake;
      if (!braking) hist[2] = Number.NaN;
      else if (hist[2] !== hist[2] && u >= DETECTOR.hardStopFrom) {
        hist[2] = u;
        hist[3] = now;
      }
      if (hist[2] === hist[2] && Math.abs(u) < DETECTOR.hardStopTo) {
        const decel = (hist[2]! - Math.abs(u)) / Math.max(now - hist[3]!, dt);
        if (decel >= DETECTOR.hardStopDecel && moments) moments.push({ kind: 'hard-stop', from: hist[2]!, simTime: at });
        hist[2] = Number.NaN;
      }
    },
  };
}
