/** 10-01 Returning test helpers: arbitrary start states for the plant and a measured return (test-only). */
import type { DriveEvent } from '../../src/contracts/drive';
import type { PathState, Simulation } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/units';
import type { Frenet } from '../../src/contracts/world';
import type { DriveHost } from '../../src/sim-core/drive/control';
import { plantOf } from '../../src/sim-core/simulation';
import { finiteFrame, intent } from '../fixtures/08-02-drive';
const DEG = Math.PI / 180;

export interface Start {
  lapTime: number;
  offset: number;
  psi: number;
  v: number;
  yawRate: number;
}

export interface ReturnResult {
  latched: boolean;
  time: number;
  maxLineDistance: number;
  finite: boolean;
  braked: boolean;
  maxDecel: number;
  maxLat: number;
  maxSteerRate: number;
  events: DriveEvent[];
  /** Autopilot state, line errors and speeds when the return ended (diagnostics). */
  last: string;
}

const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
const newPath = (): PathState => ({ lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });

/** Put the plant into `start` (relative to the driving line at start.lapTime, or at `centre` m from the centreline). */
export function begin(sim: Simulation, start: Start, centreOffset?: number): void {
  const d = sim.drive!;
  sim.seek(start.lapTime);
  d.setIntent(intent());
  d.request('manual');
  sim.step(SIM_DT);
  const base = sim.stateAt(start.lapTime, newPath());
  const n = centreOffset === undefined ? start.offset : centreOffset - base.l;
  const heading = base.heading + start.psi;
  const p: PathState = {
    ...base,
    x: base.x - Math.sin(base.heading) * n,
    y: base.y + Math.cos(base.heading) * n,
    l: base.l + n,
    heading,
    v: start.v,
    curvature: Math.abs(start.v) > 1 ? start.yawRate / start.v : 0,
    ax: 0,
    ay: 0,
  };
  plantOf(sim)!.engageFromPath(p, { ax: 0, ay: 0 });
  d.request('auto');
}

export function runReturn(sim: Simulation, limit: number): ReturnResult {
  const d = sim.drive!;
  const res: ReturnResult = { latched: false, time: 0, maxLineDistance: 0, finite: true, braked: false, maxDecel: 0, maxLat: 0, maxSteerRate: 0, events: [], last: '' };
  let prevSteer = NaN;
  const n = Math.round((limit + 1) / SIM_DT);
  for (let k = 0; k < n; k++) {
    sim.step(SIM_DT);
    d.drainEvents((e) => res.events.push(e));
    const f = sim.sample(1);
    if (!finiteFrame(f)) res.finite = false;
    const ap = (d as DriveHost).autopilot;
    if (ap) res.last = `${ap.state} e ${ap.lateralError.toFixed(2)} psi ${((ap.headingError * 180) / Math.PI).toFixed(1)} u ${f.drive.u.toFixed(1)}/${ap.lineSpeed.toFixed(1)} s ${ap.lineS.toFixed(0)}`;
    if (f.drive.mode === 'auto') {
      res.latched = res.events.some((e) => e.kind === 'converged');
      res.time = k * SIM_DT;
      break;
    }
    sim.world.project(f.drive.x, f.drive.y, NaN, fr);
    res.maxLineDistance = Math.max(res.maxLineDistance, Math.abs(fr.l - sim.track.lineOffset(fr.s)));
    if (f.drive.brake > 0.75) res.braked = true;
    res.maxDecel = Math.max(res.maxDecel, -f.ax);
    res.maxLat = Math.max(res.maxLat, Math.abs(f.ay));
    if (prevSteer === prevSteer && k > 0) res.maxSteerRate = Math.max(res.maxSteerRate, Math.abs(f.steer - prevSteer) / SIM_DT);
    prevSteer = f.steer;
  }
  return res;
}

