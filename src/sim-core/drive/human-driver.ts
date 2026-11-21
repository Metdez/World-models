/**
 * HumanDriver (ARCHITECTURE-M2 §7.9; research m2/07 §1, m2/06 §5.4): turns latched, quantised device intents into a
 * DriveCommand every fixed step. Digital sources ramp (steer rise 3 /s, fall 7 /s, snap to 0 on reversal; throttle
 * 2.5 / 6; brake 4 / 10; handbrake instant); analog sources pass through (dead zone and curve live in the device
 * adapter). Steering limit (aids.steering): the road-wheel angle is capped near the speed-dependent grip limit
 * except when countersteering. Reverse is selected by holding the brake at standstill (never on the sign of u alone).
 * Bumpless engage: the output blends from the command in force to the conditioned command over 0.3 s.
 * Countersteer help is 09-04's (not here).
 */
import { DRIVE_SOURCES, INTENT_QUANT, type DriveAids, type DriveSource } from '../../contracts/drive';
import type { CarDefinition } from '../../contracts/vehicle';
import { datan } from '../math/det';
import type { DriveCommand, Driver, PlantView, QuantIntent } from './types';

export interface HumanDriver extends Driver {
  /** At control ticks only. */
  latch(q: Readonly<QuantIntent>): void;
  setAids(aids: DriveAids): void;
  /** s since the last non-neutral latched intent. */
  readonly idle: number;
  readonly source: DriveSource;
  /** Conditioned steer demand -1..1 actually applied (for DriveFrame.steerDemand). */
  readonly steerDemand: number;
}

const STEER_RISE = 3;
const STEER_FALL = 7;
const THROTTLE_RISE = 2.5;
const THROTTLE_FALL = 6;
const BRAKE_RISE = 4;
const BRAKE_FALL = 10;
const ALPHA_PEAK = 0.12;
const BLEND_S = 0.3;
const NEUTRAL = 0.02;
/** Reverse selection: brake > 0.3, throttle < 0.05, |u| < 0.5 m/s held 0.25 s; back: throttle > 0.3, u > -0.5 held 0.15 s. */
const TO_REVERSE_S = 0.25;
const TO_FORWARD_S = 0.15;

/** State slots (snapshot-friendly). */
const IN_STEER = 0;
const IN_THROTTLE = 1;
const IN_BRAKE = 2;
const IN_HAND = 3;
const DIGITAL = 4;
const STEER = 5;
const THROTTLE = 6;
const BRAKE = 7;
const HAND = 8;
const DIRECTION = 9;
const TIMER = 10;
const BLEND = 11;
const IDLE = 12;
const P_STEER = 13;
const P_THROTTLE = 14;
const P_BRAKE = 15;
const P_HAND = 16;
const SOURCE = 17;
const DEMAND = 18;
export const HUMAN_DRIVER_STATE_LENGTH = 19;

/** Move x toward target: `rise` rate when |target| > |x| (same sign), `fall` otherwise; snap to 0 on a reversal. */
function ramp(x: number, target: number, rise: number, fall: number, dt: number): number {
  if (x * target < 0) x = 0;
  const d = target - x;
  const rate = Math.abs(target) > Math.abs(x) ? rise : fall;
  const lim = rate * dt;
  return x + (d > lim ? lim : d < -lim ? -lim : d);
}

export function createHumanDriver(vehicle: CarDefinition): HumanDriver & { readonly state: Float64Array } {
  const st = new Float64Array(HUMAN_DRIVER_STATE_LENGTH);
  st[DIRECTION] = 1;
  st[DIGITAL] = 1;
  st[BLEND] = 1;
  let aids: DriveAids = { abs: true, traction: true, stability: true, steering: true };

  const driver = {
    state: st,
    get idle() {
      return st[IDLE]!;
    },
    get source(): DriveSource {
      return DRIVE_SOURCES[st[SOURCE]!] ?? 'keyboard';
    },
    get steerDemand() {
      return st[DEMAND]!;
    },
    setAids(a: DriveAids) {
      aids = a;
    },
    latch(q: Readonly<QuantIntent>) {
      st[IN_STEER] = q.steer / INTENT_QUANT.steer;
      st[IN_THROTTLE] = q.throttle / INTENT_QUANT.pedal;
      st[IN_BRAKE] = q.brake / INTENT_QUANT.pedal;
      st[IN_HAND] = q.handbrake / INTENT_QUANT.pedal;
      st[DIGITAL] = q.flags & 1;
      st[SOURCE] = (q.flags >> 1) & 7;
      if (Math.abs(st[IN_STEER]!) > NEUTRAL || st[IN_THROTTLE]! > NEUTRAL || st[IN_BRAKE]! > NEUTRAL || st[IN_HAND]! > NEUTRAL) st[IDLE] = 0;
    },
    engage(view: PlantView, previous: Readonly<DriveCommand>) {
      st[P_STEER] = previous.steer;
      st[P_THROTTLE] = previous.throttle;
      st[P_BRAKE] = previous.brake;
      st[P_HAND] = previous.handbrake;
      st[DIRECTION] = previous.direction;
      st[STEER] = 0;
      st[THROTTLE] = 0;
      st[BRAKE] = 0;
      st[HAND] = 0;
      st[TIMER] = 0;
      st[BLEND] = 0;
      st[IDLE] = 0;
      void view;
    },
    step(dt: number, view: PlantView, out: DriveCommand) {
      st[IDLE] = st[IDLE]! + dt;
      // Conditioning: digital sources ramp, analog pass through.
      if (st[DIGITAL]) {
        st[STEER] = ramp(st[STEER]!, st[IN_STEER]!, STEER_RISE, STEER_FALL, dt);
        st[THROTTLE] = ramp(st[THROTTLE]!, st[IN_THROTTLE]!, THROTTLE_RISE, THROTTLE_FALL, dt);
        st[BRAKE] = ramp(st[BRAKE]!, st[IN_BRAKE]!, BRAKE_RISE, BRAKE_FALL, dt);
      } else {
        st[STEER] = st[IN_STEER]!;
        st[THROTTLE] = st[IN_THROTTLE]!;
        st[BRAKE] = st[IN_BRAKE]!;
      }
      st[HAND] = st[IN_HAND]!;

      // Reverse logic on the latched pedals (the user's intent), with hold timers.
      const u = view.u;
      if (st[DIRECTION]! > 0) {
        if (st[IN_BRAKE]! > 0.3 && st[IN_THROTTLE]! < 0.05 && Math.abs(u) < 0.5) st[TIMER] = st[TIMER]! + dt;
        else st[TIMER] = 0;
        if (st[TIMER]! >= TO_REVERSE_S) {
          st[DIRECTION] = -1;
          st[TIMER] = 0;
        }
      } else {
        if (st[IN_THROTTLE]! > 0.3 && u > -0.5) st[TIMER] = st[TIMER]! + dt;
        else st[TIMER] = 0;
        if (st[TIMER]! >= TO_FORWARD_S) {
          st[DIRECTION] = 1;
          st[TIMER] = 0;
        }
      }
      const reverse = st[DIRECTION]! < 0;
      // In reverse the brake pedal drives backwards and the throttle pedal brakes.
      const throttle = reverse ? st[BRAKE]! : st[THROTTLE]!;
      const brake = reverse ? st[THROTTLE]! : st[BRAKE]!;

      // Steering limit (aids.steering): near the grip limit at speed, full lock when countersteering.
      const s = st[STEER]!;
      let steer = s * view.maxSteer;
      if (aids.steering) {
        const V = Math.abs(u);
        const lim = Math.min(view.maxSteer, datan((view.wheelbase * view.lateralLimit) / Math.max(V * V, 1)) + ALPHA_PEAK);
        const countersteer = s * view.r < 0 && Math.abs(view.beta) > 0.05;
        if (!countersteer) steer = s * lim;
      }
      st[DEMAND] = steer / view.maxSteer;

      // Bumpless engage: blend from the command in force over BLEND_S (a harder user brake applies at once).
      let w = st[BLEND]!;
      if (w < 1) {
        w = Math.min(1, w + dt / BLEND_S);
        st[BLEND] = w;
        out.steer = st[P_STEER]! + (steer - st[P_STEER]!) * w;
        out.throttle = st[P_THROTTLE]! + (throttle - st[P_THROTTLE]!) * w;
        out.brake = brake > st[P_BRAKE]! ? brake : st[P_BRAKE]! + (brake - st[P_BRAKE]!) * w;
        out.handbrake = st[P_HAND]! + (st[HAND]! - st[P_HAND]!) * w;
      } else {
        out.steer = steer;
        out.throttle = throttle;
        out.brake = brake;
        out.handbrake = st[HAND]!;
      }
      out.direction = reverse ? -1 : 1;
    },
  };
  void vehicle;
  return driver;
}
