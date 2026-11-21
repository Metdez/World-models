/**
 * T3/T4/T5 (ARCHITECTURE-M2 §11, research m2/20): ISO 4138-style quasi-steady constant-radius runs on a flat pad with
 * the full plant (09-01 tyre, load transfer, kinematic and compliance steer/camber, jacking), aids off, a circle-
 * following test driver and a slow speed ramp. Understeer gradient K(a_y) = d(delta - L r / u) / d(a_y) from the
 * actuator steer (steering-wheel angle / ratio), roll gradient, max steady a_y (skidpad R 45.7 m). Understeer here
 * must come out of the physics (load transfer on load-sensitive tyres, roll and compliance steer): nothing is tuned.
 */
import { describe, expect, it } from 'vitest';
import { G } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import type { PathState } from '../../src/contracts/sim';
import { createTelemetryFrame } from '../../src/contracts/telemetry';
import { createCarModel } from '../../src/sim-core/car/car-model';
import { buildTrack } from '../../src/sim-core/track/build';
import { SUSPENSION_IDS, SUSPENSIONS, type SuspensionId } from '../fixtures/08-02-drive';
import { strip } from '../fixtures/08-02-test-tracks';
import { circleKeeper, degPerG, rig, slope } from '../fixtures/09-04-handling';

export interface RampResult {
  readonly ay: number[];
  readonly excess: number[]; // delta - L r / u, rad
  readonly roll: number[];
  readonly beta: number[];
  readonly peak: number; // max 1 s mean a_y while on the circle, m/s^2
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

/** The Auto model's roll gradient (deg/g): static equilibrium of the same car at a_y 0.1 and 0.4 g on the flat strip. */
function autoRollGradient(id: SuspensionId): number {
  const track = buildTrack(strip);
  const model = createCarModel(gtCoupe, SUSPENSIONS[id], track);
  const frame = createTelemetryFrame('car', model.corners);
  const roll = (ay: number): number => {
    const path: PathState = { lapTime: 0, s: 300, l: 0, v: 20, ax: 0, ay, curvature: ay / 400, heading: 0, x: 300, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 };
    model.reset(path);
    model.sample(1, 1, path, frame);
    return frame.roll;
  };
  return degPerG((roll(0.4 * G) - roll(0.1 * G)) / (0.3 * G));
}

describe('quasi-steady constant radius (T3-T5)', () => {
  it.each(SUSPENSION_IDS)('%s: K(0.3 g), K rising toward the limit, left/right symmetry, roll gradient, skidpad', (id) => {
    const left = ramp(id, 50, 1);
    const right = ramp(id, 50, -1);
    const k03 = kAt(left, 0.3);
    const k03r = kAt(right, 0.3);
    const k85 = kAt(left, (0.85 * left.peak) / G, 0.04);
    const roll = rollGradient(left);
    const pad = ramp(id, 45.7, 1, 10, 0.08);
    const autoRoll = autoRollGradient(id);
    console.log(
      `[T3] ${id}: K(0.3 g) ${k03.toFixed(2)} deg/g (right turn ${k03r.toFixed(2)}), K(85 % of ${(left.peak / G).toFixed(3)} g) ${k85.toFixed(2)} deg/g (x${(k85 / k03).toFixed(2)}); roll gradient ${roll.toFixed(2)} deg/g (Auto ${autoRoll.toFixed(2)}); skidpad R 45.7 m ${(pad.peak / G).toFixed(3)} g`,
    );
    expect(k03).toBeGreaterThan(0.5);
    expect(k03).toBeLessThan(3.5);
    expect(k85).toBeGreaterThan(1.5 * k03);
    expect(Math.abs(k03r / k03 - 1)).toBeLessThan(0.03);
    expect(Math.abs(right.peak / left.peak - 1)).toBeLessThan(0.03);
    expect(pad.peak / G).toBeGreaterThan(0.9);
    expect(pad.peak / G).toBeLessThan(1.1);
    expect(Math.abs(roll / autoRoll - 1)).toBeLessThan(0.1);
  }, 120_000);
});
