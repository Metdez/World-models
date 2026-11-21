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
import { degPerG, kAt, ramp, rollGradient } from '../fixtures/09-04-handling';

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
