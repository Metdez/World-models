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
