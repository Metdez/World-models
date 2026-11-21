/**
 * Shared helpers for the 09-04 handling / plant tests (test-only): a flat (optionally shaped) ground world, a bare
 * plant rig on it, launch at speed (engage from a synthetic path state), and small closed-loop helpers (speed hold,
 * circle following) standing in for a steady test driver. Measurements are read from the plant's TelemetryFrame.
 */
import { DEFAULT_AIDS, type DriveAids, type DriveEvent } from '../../src/contracts/drive';
import type { PathState, SimEvent } from '../../src/contracts/sim';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { SIM_DT } from '../../src/contracts/units';
import type { CarDefinition } from '../../src/contracts/vehicle';
import type { Frenet, GroundHit, GroundWorld, SurfaceKind } from '../../src/contracts/world';
import { createCarModel } from '../../src/sim-core/car/car-model';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import type { PlantOptions } from '../../src/sim-core/drive/plant';
import { createDriveCommand } from '../../src/sim-core/drive/types';
import { buildTrack } from '../../src/sim-core/track/build';
import { SUSPENSIONS, type SuspensionId } from './08-02-drive';
import { G } from '../../src/contracts/units';

const loop = buildTrack(provingLoop);

/** Flat ground (h = base = height(x, y), default 0) everywhere; the loop is "far away" (terrain zone). */
export function flatWorld(height?: (x: number, y: number) => number, base?: (x: number, y: number) => number, surface: SurfaceKind = 'asphalt'): GroundWorld {
  return {
    def: null,
    sample(x: number, y: number, _hint: number, out: GroundHit): GroundHit {
      out.h = height ? height(x, y) : 0;
      out.base = base ? base(x, y) : 0;
      out.surface = surface;
      out.zone = 'pad';
      out.s = NaN;
      out.l = NaN;
      return out;
    },
    terrainHeight: (x, y) => (height ? height(x, y) : 0),
    project(_x: number, _y: number, _hint: number, out: Frenet): Frenet {
      out.s = 0;
      out.l = 1000;
      out.heading = 0;
      out.curvature = 0;
      out.converged = true;
      return out;
    },
    inBounds: () => true,
    station: () => undefined,
  };
}

export interface RigOptions {
  readonly suspension?: SuspensionId;
  readonly vehicle?: CarDefinition;
  readonly options?: PlantOptions;
  readonly world?: GroundWorld;
  readonly aids?: Partial<DriveAids>;
  readonly dt?: number;
}

export function rig(o: RigOptions = {}) {
  const vehicle = o.vehicle ?? gtCoupe;
  const world = o.world ?? flatWorld();
  const model = createCarModel(vehicle, SUSPENSIONS[o.suspension ?? 'double-wishbone'], loop, world, o.options);
  const plant = model.plant!;
  const frame: TelemetryFrame = createTelemetryFrame('car', model.corners);
  const cmd = createDriveCommand();
  const simEvents: SimEvent[] = [];
  const driveEvents: DriveEvent[] = [];
  let aids: DriveAids = { ...DEFAULT_AIDS, ...o.aids };
  const dt = o.dt ?? SIM_DT;
  let t = 0;
  const r = {
    vehicle,
    model,
    plant,
    frame,
    cmd,
    driveEvents,
    dt,
    get t() {
      return t;
    },
    setAids: (a: Partial<DriveAids>) => void (aids = { ...aids, ...a }),
    /** One step with the current cmd; returns the frame at the end of it. */
    step(): TelemetryFrame {
      plant.step(dt, cmd, aids, simEvents, driveEvents);
      simEvents.length = 0;
      t += dt;
      plant.sample(1, 1, frame);
      return frame;
    },
    /** At rest at (x, y, heading). */
    place(x = 0, y = 0, heading = 0): TelemetryFrame {
      plant.place(x, y, heading);
      t = 0;
      plant.sample(1, 1, frame);
      return frame;
    },
    /** At speed u on a path of curvature kappa (steady-state seed, §7.10 A) from (x, y, heading). */
    launch(u: number, kappa = 0, x = 0, y = 0, heading = 0): TelemetryFrame {
      plant.place(x, y, heading);
      plant.engageFromPath(pathState(x, y, heading, u, kappa), { ax: 0, ay: u * u * kappa });
      cmd.steer = plant.view.steer;
      t = 0;
      plant.sample(1, 1, frame);
      return frame;
    },
  };
  return r;
}
export type Rig = ReturnType<typeof rig>;

export const pathState = (x: number, y: number, heading: number, v: number, curvature: number): PathState => ({
  lapTime: 0,
  s: 0,
  l: 1000,
  v,
  ax: 0,
  ay: v * v * curvature,
  curvature,
  heading,
  x,
  y,
  z: 0,
  bank: 0,
  grade: 0,
  sectionIndex: 0,
});

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Throttle / brake for a target speed (P + I; brake only when well above the target). */
export function speedHold(target: number) {
  let integral = 0;
  return (r: Rig): void => {
    const e = target - r.plant.view.u;
    integral = clamp(integral + e * r.dt * 0.3, -0.3, 0.5);
    const a = 0.25 * e + integral + 0.05;
    r.cmd.throttle = clamp(a, 0, 1);
    r.cmd.brake = clamp(-a - 0.3, 0, 1);
  };
}
/** Steering (road-wheel rad) that follows a circle of radius R about (cx, cy); dir +1 = counter-clockwise (left). */
export function circleKeeper(R: number, cx: number, cy: number, dir: 1 | -1, wheelbase: number) {
  let integral = 0;
  return (r: Rig): number => {
    const v = r.plant.view;
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const e = dist - R; // + outside
    const tangent = Math.atan2(dy, dx) + (dir * Math.PI) / 2;
    const course = Math.atan2(v.sinYaw, v.cosYaw) + v.beta;
    let he = course - tangent;
    he = Math.atan2(Math.sin(he), Math.cos(he));
    integral = clamp(integral + r.dt * 0.01 * e * dir, -0.05, 0.05);
    const delta = dir * Math.atan(wheelbase / R) + integral + 0.02 * e * dir - 0.6 * he;
    r.cmd.steer = clamp(delta, -0.6, 0.6);
    return e;
  };
}
/** Degrees per g from rad per (m/s^2). */
export const degPerG = (radPerMs2: number): number => (radPerMs2 * 180 * 9.80665) / Math.PI;
/** Least-squares slope of y on x. */
export function slope(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]! - mx) * (y[i]! - my);
    den += (x[i]! - mx) * (x[i]! - mx);
  }
  return num / den;
}

// ---- ISO 4138-style quasi-steady constant-radius ramp (T3-T5, the honesty report)
export interface RampResult {
  readonly ay: number[];
  readonly excess: number[]; // delta - L r / u, rad
  readonly roll: number[];
  readonly beta: number[];
  peak: number; // max 1 s mean a_y while on the circle, m/s^2
}

/** Quasi-steady ramp on radius R (dir +1 left, -1 right) from u0 at `rate` m/s^2 until the circle is lost. */
export function ramp(suspension: SuspensionId, R: number, dir: 1 | -1, u0 = 8, rate = 0.1, maxU = 40): RampResult {
  const r = rig({ suspension, aids: { abs: false, traction: false, stability: false, steering: false } });
  const L = gtCoupe.wheelbase;
  // start on the circle centred at (0, dir R), heading +x at the origin
  r.launch(u0, dir / R);
  const keep = circleKeeper(R, 0, dir * R, dir, L);
  const out: RampResult = { ay: [], excess: [], roll: [], beta: [], peak: 0 };
  const win: number[] = [];
  let integral = 0;
  for (let k = 0; ; k++) {
    const t = k * r.dt;
    const target = u0 + rate * t;
    if (target > maxU) break;
    const v = r.plant.view;
    const e = target - v.u;
    integral = Math.max(-0.3, Math.min(0.6, integral + e * r.dt * 0.5));
    r.cmd.throttle = Math.max(0, Math.min(1, 0.3 * e + integral + 0.1));
    r.cmd.brake = 0;
    const radial = keep(r);
    const f = r.step();
    if (Math.abs(radial) > 2 || r.plant.view.u < target - 3) break;
    if (t < 3) continue;
    const ay = dir * f.ay;
    win.push(ay);
    if (win.length > 240) win.shift();
    if (win.length === 240) out.peak = Math.max(out.peak, win.reduce((a, b) => a + b, 0) / 240);
    if (k % 12 === 0) {
      out.ay.push(ay);
      out.excess.push(dir * (v.steer - (L * v.r) / v.u));
      out.roll.push(dir * f.roll);
      out.beta.push(dir * v.beta);
    }
  }
  return out;
}

/** K (deg/g) at a_y0 (g) by a local linear fit within +-0.05 g. */
export function kAt(res: RampResult, ay0: number, half = 0.05): number {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < res.ay.length; i++) {
    const g = res.ay[i]! / G;
    if (Math.abs(g - ay0) <= half) {
      x.push(res.ay[i]!);
      y.push(res.excess[i]!);
    }
  }
  return degPerG(slope(x, y));
}
/** Roll gradient (deg/g) over 0.1..0.5 g; roll + = left side up (a left turn rolls the body to the right). */
export function rollGradient(res: RampResult): number {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < res.ay.length; i++) {
    const g = res.ay[i]! / G;
    if (g >= 0.1 && g <= 0.5) {
      x.push(res.ay[i]!);
      y.push(res.roll[i]!);
    }
  }
  return degPerG(slope(x, y));
}


// ---- combined manoeuvres in a steady turn (T11-T13, the honesty report)
export interface TurnResult {
  readonly kappa0: number;
  /** Path curvature r / u relative to the steady value at 0.5 s and 1.0 s after the event. */
  readonly kappaRatio05: number;
  readonly kappaRatio10: number;
  /** Yaw angle gained over 1 s beyond the steady yaw rate, rad (+ = toward the turn). */
  readonly yawDeviation: number;
  readonly betaMax: number;
  readonly yawRateChange: number;
  readonly gripMax: number;
  readonly decel: number;
  /** Rear compliance toe (rad, + toe-in) of the outer / inner rear wheel: steady and 0.5 s into the event. */
  readonly rearToeSteady: readonly [number, number];
  readonly rearToeEvent: readonly [number, number];
  /** Rear road-wheel angle (mean, rad, + toward the turn) steady and in the event (kinematic + compliance). */
  readonly rearSteerSteady: number;
  readonly rearSteerEvent: number;
}

/**
 * Steady left turn on R at a_y (circle keeper, aids off unless given), then the steer is frozen and the event applied
 * for 1 s: 'brake' (pedal), 'lift' (throttle to 0), 'power' (throttle to `pedal`).
 */
export function turnEvent(suspension: SuspensionId, kind: 'brake' | 'lift' | 'power', pedal: number, R = 100, ay = 0.45 * 9.80665, aids: Partial<DriveAids> = { abs: false, traction: false, stability: false, steering: false }): TurnResult {
  const r = rig({ suspension, aids });
  const u0 = Math.sqrt(ay * R);
  r.launch(u0, 1 / R);
  const keep = circleKeeper(R, 0, R, 1, r.vehicle.wheelbase);
  const hold = speedHold(u0);
  const wa = new Float64Array(12);
  for (let k = 0; k < Math.round(10 / r.dt); k++) {
    keep(r);
    hold(r);
    r.step();
  }
  const v = r.plant.view;
  const kappa0 = v.r / v.u;
  const r0 = v.r;
  r.plant.wheelAngles(wa);
  const rearToeSteady = [wa[4 + 3]!, wa[4 + 2]!] as const; // outer = right rear in a left turn
  const rearSteerSteady = (wa[2]! + wa[3]!) / 2;
  const steer = r.cmd.steer;
  const throttle0 = r.cmd.throttle;
  let yawDev = 0;
  let betaMax = 0;
  let gripMax = 0;
  let k05 = 0;
  let decel = 0;
  let rearToeEvent: readonly [number, number] = [0, 0];
  let rearSteerEvent = 0;
  const n = Math.round(1 / r.dt);
  for (let k = 0; k < n; k++) {
    r.cmd.steer = steer;
    if (kind === 'brake') {
      r.cmd.throttle = 0;
      r.cmd.brake = pedal;
    } else r.cmd.throttle = kind === 'lift' ? 0 : Math.max(throttle0, pedal);
    const f = r.step();
    yawDev += (v.r - r0) * r.dt;
    betaMax = Math.max(betaMax, Math.abs(v.beta));
    for (const c of f.corners) gripMax = Math.max(gripMax, c.gripUse);
    if (k === Math.round(n / 2) - 1) {
      k05 = v.r / v.u;
      r.plant.wheelAngles(wa);
      rearToeEvent = [wa[4 + 3]!, wa[4 + 2]!];
      rearSteerEvent = (wa[2]! + wa[3]!) / 2;
      decel = -f.ax;
    }
  }
  return {
    kappa0,
    kappaRatio05: k05 / kappa0,
    kappaRatio10: v.r / v.u / kappa0,
    yawDeviation: yawDev,
    betaMax,
    yawRateChange: v.r / r0 - 1,
    gripMax,
    decel,
    rearToeSteady,
    rearToeEvent,
    rearSteerSteady,
    rearSteerEvent,
  };
}

// ---- ISO 7401-style step steer (T6, T8, T18, the honesty report)
export interface StepResult {
  readonly tYaw: number;
  readonly tAy: number;
  readonly overshoot: number;
  readonly rSteady: number;
  readonly aySteady: number;
  readonly delta: number;
  readonly K: number; // deg/g from the steady state of this run
}

/** Step of the actuator target to `delta` at t = 0.5 s from straight running at u; 6 s total. */
export function stepSteer(id: SuspensionId, u: number, delta: number, dt?: number): StepResult {
  const r = rig({ suspension: id, aids: { abs: false, traction: false, stability: false, steering: false }, ...(dt ? { dt } : {}) });
  r.launch(u, 0);
  const hold = speedHold(u);
  const t: number[] = [];
  const st: number[] = [];
  const yaw: number[] = [];
  const ay: number[] = [];
  const n = Math.round(6 / r.dt);
  for (let k = 0; k < n; k++) {
    const time = k * r.dt;
    r.cmd.steer = time >= 0.5 ? delta : 0;
    hold(r);
    const f = r.step();
    t.push(time + r.dt);
    st.push(r.plant.view.steer);
    yaw.push(f.yawRate);
    ay.push(f.ay);
  }
  const tail = (a: number[]): number => a.slice(-Math.round(1 / r.dt)).reduce((x, y) => x + y, 0) / Math.round(1 / r.dt);
  const rSs = tail(yaw);
  const aSs = tail(ay);
  const cross = (a: number[], level: number): number => t[a.findIndex((x, i) => t[i]! > 0.5 && x >= level)]!;
  const t50 = cross(st, 0.5 * delta);
  const L = gtCoupe.wheelbase;
  return {
    tYaw: cross(yaw, 0.9 * rSs) - t50,
    tAy: cross(ay, 0.9 * aSs) - t50,
    overshoot: Math.max(...yaw) / rSs - 1,
    rSteady: rSs,
    aySteady: aSs,
    delta,
    K: degPerG((delta - (L * rSs) / u) / aSs),
  };
}

/** Actuator steer giving ~4 m/s^2 steady at u (two probes, linear interpolation). */
export function steerFor(id: SuspensionId, u: number, ay: number): number {
  const a = stepSteer(id, u, 0.01);
  return (0.01 * ay) / a.aySteady;
}

