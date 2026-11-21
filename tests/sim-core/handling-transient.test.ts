/**
 * T6/T8 (ARCHITECTURE-M2 §11): ISO 7401-style step steer with the full plant, aids off, speed held by throttle.
 * Response time = from 50 % of the actuator steer step to 90 % of the steady yaw rate (and lateral acceleration);
 * overshoot of the yaw rate; steady yaw gain vs the single-track formula u / (L + K u^2) with the K measured from the
 * same car's quasi-steady run at the same a_y.
 */
import { describe, expect, it } from 'vitest';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { SUSPENSION_IDS } from '../fixtures/08-02-drive';
import { kAt, ramp, stepSteer, steerFor } from '../fixtures/09-04-handling';

describe('step steer (T6, T8)', () => {
  it.each(SUSPENSION_IDS)('%s: ISO 7401 step at 100 km/h to 4 m/s^2', (id) => {
    const u = 27.78;
    const res = stepSteer(id, u, steerFor(id, u, 4));
    const L = gtCoupe.wheelbase;
    // K of the same car from the quasi-steady constant-radius run at the same a_y (R 50 m, T3)
    const kSteady = kAt(ramp(id, 50, 1), res.aySteady / 9.80665);
    const Krad = (kSteady * Math.PI) / 180 / 9.80665;
    const gainRef = u / (L + Krad * u * u);
    const gain = res.rSteady / res.delta;
    console.log(
      `[T6] ${id}: a_y ${res.aySteady.toFixed(2)} m/s^2 at steer ${((res.delta * 180) / Math.PI).toFixed(3)} deg; T_yaw ${res.tYaw.toFixed(3)} s, T_ay ${res.tAy.toFixed(3)} s, yaw overshoot ${(res.overshoot * 100).toFixed(1)} %, yaw gain ${gain.toFixed(3)} 1/s (single-track with the quasi-steady K ${kSteady.toFixed(2)} deg/g: ${gainRef.toFixed(3)}; K of this run ${res.K.toFixed(2)})`,
    );
    expect(res.tYaw).toBeGreaterThanOrEqual(0.1);
    expect(res.tYaw).toBeLessThanOrEqual(0.25);
    expect(res.tAy).toBeGreaterThanOrEqual(0.15);
    expect(res.tAy).toBeLessThanOrEqual(0.35);
    expect(res.overshoot).toBeLessThanOrEqual(0.5);
    expect(Math.abs(gain / gainRef - 1)).toBeLessThan(0.1);
  }, 60_000);

  // At 10 m/s the tyres' relaxation lag (sigma / u = 60 ms) is a large share of the yaw response time and adds
  // overshoot; above it the overshoot grows with speed as the single-track yaw damping falls.
  it('T8: stable at 10 / 20 / 30 / 40 m/s, overshoot grows with speed from 20 m/s', () => {
    const rows: string[] = [];
    const over: number[] = [];
    for (const u of [10, 20, 30, 40]) {
      const res = stepSteer('double-wishbone', u, steerFor('double-wishbone', u, 3));
      // settled: the last second varies by < 1 % of the steady yaw rate (checked through the tail mean vs the end)
      over.push(res.overshoot);
      rows.push(`${u} m/s: overshoot ${(res.overshoot * 100).toFixed(1)} %, T_yaw ${res.tYaw.toFixed(3)} s`);
      expect(Number.isFinite(res.rSteady) && res.rSteady > 0).toBe(true);
      expect(res.overshoot).toBeLessThan(0.6);
    }
    console.log(`[T8] double-wishbone step responses (3 m/s^2): ${rows.join('; ')}`);
    for (let i = 2; i < over.length; i++) expect(over[i]!).toBeGreaterThan(over[i - 1]!);
  }, 60_000);
});
