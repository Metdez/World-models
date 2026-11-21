/**
 * Ghost runs (ARCHITECTURE-M2 §7.14, §13.3; research m2/24 §d option B, m2/13 §3): "same line, different suspension".
 *
 * Open-loop input replay through another suspension diverges within seconds (heading integrates yaw rate), so the
 * comparison is closed-loop: a DISCLOSED driver model drives the visitor's recorded line and speed, once with the
 * visitor's suspension (the A/A control) and once with another (B). Both runs use the identical driver.
 *
 * Course (`buildCourse`): the span is re-simulated exactly (same build: the visitor's own run, bit for bit) in a fresh
 * simulation. The compared stretch is the longest one driven forwards above walking pace without a reset,
 * suspension or aids change inside it. Every GHOST_DS m of travel it stores the line point (x, y, forward speed), the
 * command the visitor's car applied there (road-wheel steer target, pedals, handbrake), the yaw rate, and the
 * visitor's traces.
 *
 * Driver (`createGhostDriver`), not the return autopilot (drive/path-driver.ts lags abrupt manoeuvres by design):
 * the visitor's own command at the same point of the line as feed-forward, plus line feedback on the CG offset and the
 * course error (velocity direction minus line heading) with gains scaled by the speed-dependent yaw gain (closed-loop
 * bandwidth OMEGA, damping ZETA), yaw-rate feedback against the visitor's yaw rate at that point, a small offset
 * integral, and a speed PI on the visitor's speed. With the visitor's suspension the feedback stays close to zero (the
 * ghost repeats the visitor); with another it supplies exactly the correction that suspension needs, which is what
 * the steering trace shows.
 *
 * Det kernels only; a ghost step does not allocate (buffers are per run).
 */
import { CONTROL_TICKS, DEFAULT_AIDS, type DecodedReplay, type DriveAids, type DriveEvent } from '../../contracts/drive';
import type { PathState, SimEvent, Simulation } from '../../contracts/sim';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { SIM_DT } from '../../contracts/units';
import type { CarDefinition } from '../../contracts/vehicle';
import type { Frenet } from '../../contracts/world';
import type { DriveHost } from '../drive/control';
import { PLANT_SNAPSHOT_LENGTH, type VehiclePlant } from '../drive/plant';
import { recordedLine, RECORDED_DS, type ReferenceLine } from '../drive/reference';
import { createDriveCommand, type DriveCommand, type PlantView } from '../drive/types';
import { datan, datan2, dwrapPi } from '../math/det';
import { parseAids } from '../replay/format';
import { plantOf } from '../simulation';

/** Trace and feed-forward spacing along the line, m. */
export const GHOST_DS = RECORDED_DS;
/** Trace channels (SI: rad, m). steer = mean front road-wheel angle; slips = mean axle slip angle; offset = CG
 *  distance from the visitor's line (+ left). */
export const CHANNELS = ['steer', 'frontSlip', 'rearSlip', 'sideslip', 'roll', 'offset'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Trace {
  /** Samples written (sample k is at k * GHOST_DS along the line). */
  n: number;
  readonly ch: Readonly<Record<Channel, Float64Array>>;
}

/** Window rules: forward speed at least MIN_U (m/s) throughout, at least MIN_WINDOW_S long and MIN_WINDOW_M of line. */
export const MIN_U = 2;
export const MIN_WINDOW_S = 4;
export const MIN_WINDOW_M = 25;

/** Feed-forward per stretch tick: steer target (rad), throttle, brake, handbrake, yaw rate (rad/s), course (rad: yaw +
 *  sideslip, the visitor's velocity direction), forward speed (m/s). */
const FF_STRIDE = 7;

export interface GhostCourse {
  readonly span: DecodedReplay;
  /** The visitor's suspension (the span's, constant inside the stretch). */
  readonly suspensionId: string;
  /** Span tick where the stretch starts, and its length in ticks. */
  readonly offset: number;
  readonly ticks: number;
  /** Plant snapshot at the stretch start. */
  readonly start: Float64Array;
  readonly aids: DriveAids;
  readonly line: ReferenceLine;
  /** Line samples (n = trace length). */
  readonly n: number;
  /** Per stretch tick j (0..ticks): the visitor's distance travelled at state j, m. */
  readonly dist: Float64Array;
  /** Per stretch tick j, FF_STRIDE values: the command of step j (steer, throttle, brake, handbrake) and the yaw rate,
   *  course (unwrapped) and forward speed at state j. */
  readonly ff: Float64Array;
  readonly visitor: Trace;
}

export type CourseRefusal = 'unfit' | 'short';

export type GhostStatus = 'running' | 'finished' | 'lost' | 'stopped' | 'timeout';

/** A fresh simulation of the visitor's track and vehicle with this suspension (the caller owns the catalog). */
export type SimFactory = (suspensionId: string) => Simulation;

function createTrace(capacity: number): Trace {
  const ch = {} as Record<Channel, Float64Array>;
  for (const c of CHANNELS) ch[c] = new Float64Array(capacity);
  return { n: 0, ch };
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** The trace channels of the plant's current state into sample k (frame = scratch telemetry of that plant). */
function writeSample(trace: Trace, k: number, plant: VehiclePlant, frame: TelemetryFrame, offset: number): void {
  plant.sample(1, 1, frame);
  const c = frame.corners;
  let f = 0;
  let r = 0;
  for (let i = 0; i < c.length; i++) {
    const a = datan(c[i]!.slipAngle);
    if (c[i]!.axle === 'front') f += a;
    else r += a;
  }
  const ch = trace.ch;
  ch.steer[k] = frame.steer;
  ch.frontSlip[k] = f / 2;
  ch.rearSlip[k] = r / 2;
  ch.sideslip[k] = frame.drive.beta;
  ch.roll[k] = frame.roll;
  ch.offset[k] = offset;
  trace.n = k + 1;
}

const noSim = (): never => {
  throw new Error('ghost: the simulation has no plant');
};

/** Starts `span` playing in `sim` (beforeStep restores it at the first step). */
function playIn(sim: Simulation, span: DecodedReplay): { host: DriveHost; plant: VehiclePlant } | null {
  const host = sim.drive as DriveHost | undefined;
  if (!host || !host.play(span)) return null;
  return { host, plant: plantOf(sim) ?? noSim() };
}

/**
 * The comparison course of a recorded span (ARCH-M2 §7.14 `replayLine`): stretch, line, feed-forward, the visitor's
 * traces and the start state. Two exact re-simulations of the span (the first finds the stretch).
 */
export function buildCourse(span: DecodedReplay, makeSim: SimFactory): GhostCourse | CourseRefusal {
  const ticks = span.header.ticks;
  // --- pass 1: forward speed per tick state, direction per step
  const sim1 = makeSim(span.header.suspensionId);
  const run1 = playIn(sim1, span);
  if (!run1) return 'unfit';
  const u = new Float64Array(ticks + 1);
  const forward = new Uint8Array(ticks);
  sim1.step(SIM_DT);
  forward[0] = run1.plant.command.direction > 0 ? 1 : 0;
  u[1] = run1.plant.view.u;
  u[0] = u[1]!; // a stretch never starts at tick 0 (below)
  for (let t = 1; t < ticks && run1.host.replay!.state === 'playing'; t++) {
    sim1.step(SIM_DT);
    forward[t] = run1.plant.command.direction > 0 ? 1 : 0;
    u[t + 1] = run1.plant.view.u;
  }
  // events inside the span (tick > 0) may only start a stretch
  const starts = new Uint8Array(ticks + 1);
  for (const e of span.events) if (e.tick > 0 && e.tick <= ticks) starts[e.tick] = 1;
  let bestA = 0;
  let bestLen = 0;
  let a = -1;
  for (let t = 0; t < ticks; t++) {
    const good = forward[t] === 1 && u[t]! >= MIN_U && u[t + 1]! >= MIN_U;
    if (!good) {
      a = -1;
      continue;
    }
    if (a < 0 || starts[t]) a = t;
    if (t + 1 - a >= bestLen) {
      bestLen = t + 1 - a;
      bestA = a;
    }
  }
  // the stretch starts after at least one step (the start state is then a live plant state of pass 2)
  if (bestA === 0) {
    bestA = 1;
    bestLen -= 1;
  }
  if (bestLen < MIN_WINDOW_S / SIM_DT) return 'short';
  const offset = bestA;
  const end = bestA + bestLen;

  // --- pass 2: the stretch's line, feed-forward and traces
  const sim2 = makeSim(span.header.suspensionId);
  const run2 = playIn(sim2, span);
  if (!run2) return 'unfit';
  const plant = run2.plant;
  const frame = sim2.sample(1);
  const view = plant.view;
  for (let t = 0; t < offset; t++) sim2.step(SIM_DT);
  const start = plant.snapshot(new Float64Array(PLANT_SNAPSHOT_LENGTH));
  // capacity: the stretch's travel at its top speed
  let vmax = 0;
  for (let t = offset; t <= end; t++) vmax = Math.max(vmax, u[t]!);
  const cap = Math.ceil((vmax * bestLen * SIM_DT) / GHOST_DS) + 4;
  const xyz = new Float64Array(3 * cap);
  const visitor = createTrace(cap);
  // per tick of the stretch: distance travelled at state j, the command of step j, yaw rate, course and speed at state j
  const dist = new Float64Array(bestLen + 1);
  const ff = new Float64Array(FF_STRIDE * (bestLen + 1));
  const putFf = (j: number, cmd: Readonly<DriveCommand>) => {
    const o = FF_STRIDE * j;
    ff[o] = cmd.steer;
    ff[o + 1] = cmd.throttle;
    ff[o + 2] = cmd.brake;
    ff[o + 3] = cmd.handbrake;
    ff[o + 4] = view.r;
    ff[o + 5] = datan2(view.sinYaw, view.cosYaw) + view.beta;
    ff[o + 6] = view.u;
  };
  let k = 0;
  const put = (x: number, y: number, speed: number) => {
    xyz[3 * k] = x;
    xyz[3 * k + 1] = y;
    xyz[3 * k + 2] = speed;
  };
  put(view.x, view.y, view.u);
  writeSample(visitor, 0, plant, frame, 0);
  for (let j = 0; j < bestLen; j++) {
    const x0 = view.x;
    const y0 = view.y;
    const u0 = view.u;
    putFf(j, plant.command); // state j (the command slot is overwritten below with step j's command)
    sim2.step(SIM_DT);
    const o = FF_STRIDE * j;
    ff[o] = plant.command.steer;
    ff[o + 1] = plant.command.throttle;
    ff[o + 2] = plant.command.brake;
    ff[o + 3] = plant.command.handbrake;
    const dx = view.x - x0;
    const dy = view.y - y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    dist[j + 1] = dist[j]! + d;
    // line points (and the visitor's traces) every GHOST_DS of travel
    while ((k + 1) * GHOST_DS <= dist[j + 1]! && k + 1 < cap) {
      k++;
      const f = d > 0 ? (k * GHOST_DS - dist[j]!) / d : 1;
      put(x0 + dx * f, y0 + dy * f, u0 + (view.u - u0) * f);
      writeSample(visitor, k, plant, frame, 0);
    }
  }
  putFf(bestLen, plant.command);
  // course angles unwrapped along the stretch (interpolation)
  for (let j = 1; j <= bestLen; j++) ff[FF_STRIDE * j + 5] = ff[FF_STRIDE * (j - 1) + 5]! + dwrapPi(ff[FF_STRIDE * j + 5]! - ff[FF_STRIDE * (j - 1) + 5]!);
  const n = k + 1;
  if (n * GHOST_DS < MIN_WINDOW_M) return 'short';
  let aids: DriveAids = DEFAULT_AIDS;
  for (const e of span.events) if (e.kind === 'aids' && e.tick <= offset) aids = parseAids(e.value);
  return {
    span,
    suspensionId: span.header.suspensionId,
    offset,
    ticks: bestLen,
    start,
    aids,
    line: recordedLine(xyz.subarray(0, 3 * n)),
    n,
    dist,
    ff,
    visitor,
  };
}

// ---------------------------------------------------------------- driver model

/** Closed-loop line bandwidth (rad/s) and damping; yaw-rate gain (rad per rad/s); offset integral (1/s); speed P
 *  (pedal per m/s), I (pedal per m), integral clamp (m); characteristic speed of the yaw-gain estimate (m/s); lowest
 *  speed the gains are scheduled for (m/s). These are the disclosed driver model's whole parameter set. */
export const DRIVER_MODEL = {
  omega: 2.5,
  zeta: 0.9,
  yawRate: 0.1,
  offsetIntegral: 0.3,
  speedP: 0.25,
  speedI: 0.3,
  speedIMax: 1.5,
  vChar: 45,
  vMin: 4,
} as const;

// driver state slots
const D_S = 0; // line s of the last projection
const D_E = 1; // CG offset from the line, m (+ left)
const D_PSI = 2; // course error, rad
const D_EI = 3; // offset integral, m s
const D_VI = 4; // speed integral, m
const D_SLOTS = 5;

export interface GhostDriver {
  /** Projection of the current state (call after every plant step; the next command uses it). */
  project(view: PlantView): void;
  command(dt: number, view: PlantView, out: DriveCommand): void;
  readonly s: number;
  readonly offset: number;
}

export function createGhostDriver(course: GhostCourse, wheelbase: number): GhostDriver {
  const st = new Float64Array(D_SLOTS);
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  const line = course.line;
  const ff = course.ff;
  const M = DRIVER_MODEL;
  const dist = course.dist;
  const lastTick = course.ticks;
  // The visitor at the projected s: tick j with dist[j] <= s < dist[j + 1] (monotone search from the last one). `ref`
  // holds what the driver reads there: step j's command (the visitor applied it over that whole step) and the yaw rate,
  // course and speed linear between states j and j + 1. Written in place (no double returns: they would box).
  const at = new Int32Array(1);
  const ref = new Float64Array(FF_STRIDE);
  const locate = (s: number): void => {
    let j = at[0]!;
    while (j < lastTick - 1 && dist[j + 1]! <= s) j++;
    while (j > 0 && dist[j]! > s) j--;
    at[0] = j;
    const d = dist[j + 1]! - dist[j]!;
    const f = d > 0 ? clamp((s - dist[j]!) / d, 0, 1) : 0;
    const o = FF_STRIDE * j;
    for (let c = 0; c < 4; c++) ref[c] = ff[o + c]!;
    for (let c = 4; c < FF_STRIDE; c++) ref[c] = ff[o + c]! + (ff[o + FF_STRIDE + c]! - ff[o + c]!) * f;
  };
  st[D_S] = 0;
  return {
    get s() {
      return st[D_S]!;
    },
    get offset() {
      return st[D_E]!;
    },
    project(view) {
      line.project(view.x, view.y, st[D_S]!, fr);
      st[D_S] = fr.s;
      st[D_E] = fr.l;
      locate(fr.s);
      // course error against the visitor's own course at this point (the line's chord heading is half a sample off
      // at its ends)
      st[D_PSI] = dwrapPi(datan2(view.sinYaw, view.cosYaw) + view.beta - ref[5]!);
    },
    command(dt, view, out) {
      const u = view.u;
      const e = st[D_E]!;
      // gains from the steady-state yaw gain G = u / (L (1 + u^2 / vChar^2)): e'' + 2 zeta omega e' + omega^2 e = 0
      const uc = u > M.vMin ? u : M.vMin;
      const g = uc / (wheelbase * (1 + (uc * uc) / (M.vChar * M.vChar)));
      const kPsi = (2 * M.zeta * M.omega) / g;
      const kE = (M.omega * M.omega) / (uc * g);
      st[D_EI] = clamp(st[D_EI]! + e * dt, -1, 1);
      const fb = -kE * (e + M.offsetIntegral * st[D_EI]!) - kPsi * st[D_PSI]! + M.yawRate * (ref[4]! - view.r);
      out.steer = clamp(ref[0]! + fb, -view.maxSteer, view.maxSteer);
      // speed: the visitor's pedals at this point plus PI on the visitor's speed
      const ev = ref[6]! - u;
      st[D_VI] = clamp(st[D_VI]! + ev * dt, -M.speedIMax, M.speedIMax);
      const pedal = ref[1]! - ref[2]! + M.speedP * ev + M.speedI * st[D_VI]!;
      out.throttle = clamp(pedal, 0, 1);
      out.brake = clamp(-pedal, 0, 1);
      out.handbrake = ref[3]!;
      out.direction = 1;
    },
  };
}

// ---------------------------------------------------------------- ghost

/** Beyond this CG distance from the line (m) a ghost run stops: it no longer drives the visitor's line. */
export const LOST_OFFSET = 3;

export interface Ghost {
  /** One fixed step (SIM_DT). No-op once the run has ended. */
  step(): void;
  readonly status: GhostStatus;
  readonly steps: number;
  /** Line s and offset of the current state. */
  readonly s: number;
  readonly offset: number;
  /** Largest |offset| so far, m. */
  readonly maxOffset: number;
  /** The run's traces (written only with `traces`). */
  readonly trace: Trace;
  /** Interpolated pose/telemetry for rendering (between the last two steps). */
  pose(alpha: number, amplification: number): TelemetryFrame;
}

/**
 * A ghost of `course` in `sim` (a fresh simulation with the ghost's suspension; never stepped by anyone else): its
 * plant restored at the stretch start, driven by the ghost driver. `traces` samples the trace channels (headless runs).
 */
export function createGhost(sim: Simulation, course: GhostCourse, traces = true): Ghost {
  const plant = plantOf(sim) ?? noSim();
  const frame = sim.sample(1);
  const path: PathState = {
    lapTime: 0,
    s: 0,
    l: 0,
    v: 0,
    ax: 0,
    ay: 0,
    curvature: 0,
    heading: 0,
    x: 0,
    y: 0,
    z: 0,
    bank: 0,
    grade: 0,
    sectionIndex: 0,
  };
  sim.stateAt(sim.lapTime, path);
  plant.engageFromPath(path, { ax: NaN, ay: NaN });
  plant.restore(course.start);
  const driver = createGhostDriver(course, (sim.vehicle as CarDefinition).wheelbase);
  const cmd = createDriveCommand();
  const simEvents: SimEvent[] = [];
  const driveEvents: DriveEvent[] = [];
  const trace = createTrace(traces ? course.n : 0);
  const view = plant.view;
  driver.project(view);
  if (traces) writeSample(trace, 0, plant, frame, driver.offset);
  const n = new Float64Array(3); // [steps, maxOffset, next sample index]
  n[2] = 1;
  const limit = Math.round(course.ticks * 1.5) + 2 * CONTROL_TICKS * 60;
  const end = (course.n - 1) * GHOST_DS;
  let status: GhostStatus = 'running';
  return {
    step() {
      if (status !== 'running') return;
      (view as { simTime: number }).simTime = n[0]! * SIM_DT;
      driver.command(SIM_DT, view, cmd);
      plant.step(SIM_DT, cmd, course.aids, simEvents, driveEvents);
      simEvents.length = 0;
      driveEvents.length = 0;
      n[0] = n[0]! + 1;
      driver.project(view);
      const s = driver.s;
      // at the line's end the projection clamps to its last point (the offset there includes the overshoot)
      if (s >= end - 1e-9) {
        status = 'finished';
        return;
      }
      const e = driver.offset;
      const ae = e < 0 ? -e : e;
      if (ae > n[1]!) n[1] = ae;
      if (traces) {
        // the sample point(s) this step reached (nearest step, at most GHOST_DS / 2 early or late)
        while (n[2]! < course.n && n[2]! * GHOST_DS <= s) {
          writeSample(trace, n[2]!, plant, frame, e);
          n[2] = n[2]! + 1;
        }
      }
      if (ae > LOST_OFFSET) status = 'lost';
      else if (view.u < 0.5) status = 'stopped';
      else if (n[0]! >= limit) status = 'timeout';
    },
    get status() {
      return status;
    },
    get steps() {
      return n[0]!;
    },
    get s() {
      return driver.s;
    },
    get offset() {
      return driver.offset;
    },
    get maxOffset() {
      return n[1]!;
    },
    trace,
    pose(alpha, amplification) {
      plant.sample(alpha, amplification, frame);
      return frame;
    },
  };
}

export interface GhostRun {
  readonly suspensionId: string;
  readonly status: GhostStatus;
  readonly maxOffset: number;
  readonly steps: number;
  readonly trace: Trace;
}

/** A headless ghost run of `course` with `suspensionId` (ARCH-M2 §7.14 `ghostTrace`). */
export function runGhost(course: GhostCourse, makeSim: SimFactory, suspensionId: string): GhostRun {
  const g = createGhost(makeSim(suspensionId), course, true);
  while (g.status === 'running') g.step();
  return {
    suspensionId,
    status: g.status,
    maxOffset: g.maxOffset,
    steps: g.steps,
    trace: g.trace,
  };
}
