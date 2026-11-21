/**
 * T10 (ARCHITECTURE-M2 §11; plan 10-04): the ISO 3888-2 obstacle-avoidance lane change on the proving ground's dynamics
 * pad (10-02 geometry: from x -120 on y 400 heading +x; gate 1 x -120..-108, width 1.1 W + 0.25 = 2.395 m centred
 * on y 400; gate 2 x -94.5..-83.5, W + 1 = 2.95 m centred on y 403.6725; gate 3 x -71..-59, 3.0 m centred on y 400; W =
 * 1.95 m), driven by the PathDriver on a recordedLine that uses the gate widths, per suspension. Each run starts at rest
 * 115 m before gate 1 with the aids on and a held line speed (the standard's throttle-off coast is not modelled: the
 * PathDriver keeps the speed, which is the harder case). Pass = every footprint corner inside every gate, all finite.
 * A speed sweep is PRINTED per suspension (margins, gate, the largest passing speed). Measured: the PathDriver (a
 * gentle return driver: 0.6 rad/s steering slew, grip-limited steer) lags this abrupt lane by 0.4-3 m, so the table
 * measures the driver far more than the suspension (10-04-SUMMARY); the assertions are only that every run stays finite
 * and the line itself is inside the gates.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, type DriveEvent } from '../../src/contracts/drive';
import type { SimEvent } from '../../src/contracts/sim';
import { createTelemetryFrame } from '../../src/contracts/telemetry';
import { SIM_DT } from '../../src/contracts/units';
import { createCarModel } from '../../src/sim-core/car/car-model';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { createPathDriver } from '../../src/sim-core/drive/path-driver';
import { recordedLine, RECORDED_DS } from '../../src/sim-core/drive/reference';
import { createDriveCommand } from '../../src/sim-core/drive/types';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { SUSPENSION_IDS, SUSPENSIONS, type SuspensionId } from '../fixtures/08-02-drive';

const W = 1.95;
/** [x start, x end, centre y, width] */
const GATES = [
  [-120, -108, 400, 1.1 * W + 0.25],
  [-94.5, -83.5, 403.6725, W + 1],
  [-71, -59, 400, 3.0],
] as const;
const START_X = -235;
const END_X = -30;

const built = buildTrack(provingLoop);
const world = buildGroundWorld(built, provingGround);

const quintic = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (10 + u * (-15 + 6 * u));
};
/** Centre-of-car path: up into the offset lane and back, inside the gate widths (smooth, C2). */
const UP = [-108, 12, 3.3] as const;
const DOWN = [-83, 13] as const;
const pathY = (x: number) => 400 + UP[2] * quintic((x - UP[0]) / UP[1]) - UP[2] * quintic((x - DOWN[0]) / DOWN[1]);

/** Samples (x, y, v) every RECORDED_DS of arc length. */
function laneLine(v: number) {
  const pts: number[] = [];
  let x = START_X;
  let y = pathY(x);
  pts.push(x, y, v);
  let acc = 0;
  const h = 0.005;
  while (x < END_X) {
    const nx = x + h;
    const ny = pathY(nx);
    acc += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
    if (acc >= RECORDED_DS) {
      acc -= RECORDED_DS;
      pts.push(x, y, v);
    }
  }
  return recordedLine(Float64Array.from(pts));
}

interface Run {
  pass: boolean;
  entry: number;
  margin: number;
  /** Gate (1-3) of the smallest margin; largest tracking error from the line, m. */
  gate: number;
  maxError: number;
  finite: boolean;
}

function run(id: SuspensionId, v: number): Run {
  const model = createCarModel(gtCoupe, SUSPENSIONS[id], built, world);
  const plant = model.plant!;
  const frame = createTelemetryFrame('car', model.corners);
  const cmd = createDriveCommand();
  const simEvents: SimEvent[] = [];
  const driveEvents: DriveEvent[] = [];
  plant.place(START_X, 400, 0);
  const pd = createPathDriver(gtCoupe, laneLine(v), { speedScale: 1, exactSpeed: true });
  pd.engage(plant.view, plant.command);
  const a = gtCoupe.cgToFront + 0.9;
  const b = gtCoupe.wheelbase - gtCoupe.cgToFront + 1.0;
  const w = W / 2;
  const res: Run = { pass: true, entry: Number.NaN, margin: Infinity, gate: 0, maxError: 0, finite: true };
  for (let k = 0; k < 240 * 40; k++) {
    pd.step(SIM_DT, plant.view, cmd);
    plant.step(SIM_DT, cmd, DEFAULT_AIDS, simEvents, driveEvents);
    simEvents.length = 0;
    driveEvents.length = 0;
    const p = plant.view;
    if (!Number.isFinite(p.x + p.y + p.u)) {
      res.finite = false;
      break;
    }
    if (res.entry !== res.entry && p.x + a >= GATES[0][0]) res.entry = p.u;
    for (const [dx, dy] of [[a, w], [a, -w], [-b, w], [-b, -w]] as const) {
      const cx = p.x + p.cosYaw * dx - p.sinYaw * dy;
      const cy = p.y + p.sinYaw * dx + p.cosYaw * dy;
      GATES.forEach(([x0, x1, yc, width], g) => {
        const m = width / 2 - Math.abs(cy - yc);
        if (cx >= x0 && cx <= x1 && m < res.margin) {
          res.margin = m;
          res.gate = g + 1;
        }
      });
    }
    if (p.x > GATES[0][0] - 20) res.maxError = Math.max(res.maxError, Math.abs(pd.lateralError));
    if (p.x - b > GATES[2][1] + 1) break;
  }
  plant.sample(1, 1, frame);
  res.pass = res.finite && res.margin > 0 && res.entry === res.entry;
  return res;
}

const SWEEP_KMH = [15, 20, 25, 30, 35, 40, 50, 60];

describe('T10: ISO 3888-2 lane change on the proving ground with the PathDriver', () => {
  it('speed sweep per suspension: every run finite; cone margins and the largest passing speed printed', () => {
    const rows: string[] = [];
    for (const id of SUSPENSION_IDS) {
      const cells: string[] = [];
      let best = Number.NaN;
      for (const kmh of SWEEP_KMH) {
        const r = run(id, kmh / 3.6);
        expect(r.finite).toBe(true);
        if (r.pass) best = Math.max(best === best ? best : 0, r.entry * 3.6);
        cells.push(`${String(kmh).padStart(3)}: ${r.pass ? 'pass' : 'cone'} ${(r.margin * 100).toFixed(0).padStart(5)} cm (gate ${r.gate}, line error ${r.maxError.toFixed(2)} m)`);
      }
      rows.push(`${id}: largest passing entry speed in the sweep ${best === best ? `${best.toFixed(1)} km/h` : 'none'}\n  ${cells.join('\n  ')}`);
    }
    console.log(`[T10] ISO 3888-2 on the pad, PathDriver at a held speed, aids on (margin < 0 = a cone hit)\n${rows.join('\n')}`);
  }, 300_000);

  it('the lane line itself stays inside every gate (centre point, geometry check)', () => {
    for (const [x0, x1, yc, width] of GATES) for (let x = x0; x <= x1; x += 0.1) expect(Math.abs(pathY(x) - yc)).toBeLessThan(width / 2);
  });
});
