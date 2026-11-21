/**
 * T1/T2 (ARCHITECTURE-M2 §11; research m2/20 §4): with the test-only linear tyre and rigid loads (and compliance off)
 * the plant is the linear single-track model, so its steady states must match the closed form:
 *   r/delta = u / (L + K u^2),  a_y/delta = u^2 / (L + K u^2),  K = (m / L) (b / C_f - a / C_r)  (rad per m/s^2)
 * within 1 %; T2 varies the rear cornering stiffness for K = -0.5 .. +3 deg/g and checks the steer trend sign and the
 * characteristic speed sqrt(L / K).
 */
import { describe, expect, it } from 'vitest';
import type { CarDefinition } from '../../src/contracts/vehicle';
import { G } from '../../src/contracts/units';
import { prepareCarSuspension } from '../../src/sim-core/car/car-model';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { createCornerSolution } from '../../src/sim-core/kinematics/table';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { stiffnessAt, tyreCoefficients } from '../../src/sim-core/drive/tyre';
import { degPerG, rig, speedHold, type Rig } from '../fixtures/09-04-handling';

const OPTS = { linearTyre: true, rigidLoads: true } as const;
const h = gtCoupe.handling!;
/** Compliance off and an open differential (equal torque split: the limited-slip split of the inner/outer rear speed
 *  difference adds a small understeer moment the single-track model does not have, ~1 % of K at 20 m/s). */
const variant = (rearCornering = h.tyres.rear.corneringStiffness): CarDefinition => ({
  ...gtCoupe,
  handling: {
    ...h,
    compliance: { ...h.compliance, maxAngle: 0 },
    powertrain: { ...h.powertrain, limitedSlipRatio: 1e12 },
    tyres: { ...h.tyres, rear: { ...h.tyres.rear, corneringStiffness: rearCornering } },
  },
});

/** Closed-form single-track parameters of the plant on a vehicle (static loads by the plant's lever rule). */
function closedForm(r: Rig) {
  const v = r.vehicle;
  // the plant's contact-patch layout (car-model install: axle x + the table's design patch x)
  const sol = prepareCarSuspension(v, doubleWishbone);
  const patch = (t: typeof sol.front.table): number => t.sample(0, 0, createCornerSolution(t)).contactPatch.x;
  const xF = v.cgToFront + patch(sol.front.table);
  const xR = v.cgToFront - v.wheelbase + patch(sol.rear.table);
  const mu = [v.front.unsprungMass, v.front.unsprungMass, v.rear.unsprungMass, v.rear.unsprungMass].map((m) => m + doubleWishbone.extras.unsprungMassDelta);
  const m = v.sprungMass + mu.reduce((a, b) => a + b, 0);
  const L = xF - xR;
  const out = new Float64Array(3);
  const ca = (i: number): number => {
    const axle = i < 2 ? v.front : v.rear;
    const load = ((v.sprungMass * (i < 2 ? -xR : xF)) / L / 2 + mu[i]!) * G;
    return stiffnessAt(axle.tyre, tyreCoefficients(axle.tyre, i < 2 ? v.handling!.tyres.front : v.handling!.tyres.rear), load, out)[0]!;
  };
  const Cf = ca(0) + ca(1);
  const Cr = ca(2) + ca(3);
  const K = (m / L) * (-xR / Cf - xF / Cr);
  return { L, K, m };
}

const wa = new Float64Array(12);
/** Steady state at speed u and a fixed actuator steer: [r, a_y, effective road-wheel angle (front mean - rear mean)]. */
function steady(r: Rig, u: number, actuator: number): [number, number, number] {
  r.launch(u, 0);
  const hold = speedHold(u);
  r.cmd.steer = actuator;
  let f = r.frame;
  for (let k = 0; k < 240 * 12; k++) {
    hold(r);
    f = r.step();
  }
  r.plant.wheelAngles(wa);
  return [f.yawRate, f.ay, (wa[0]! + wa[1]!) / 2 - (wa[2]! + wa[3]!) / 2];
}

describe('linear single-track identities (T1, T2)', () => {
  it('T1: r/delta, a_y/delta and K within 1 % of the closed form at 20 / 27.8 / 40 m/s', () => {
    const r = rig({ vehicle: variant(), options: OPTS });
    const { L, K } = closedForm(r);
    const rows: string[] = [];
    const deltas = [0.004, 0.008];
    for (const u of [20, 27.8, 40]) {
      const [r1, a1, e1] = steady(r, u, deltas[0]!);
      const [r2, a2, e2] = steady(r, u, deltas[1]!);
      const gainR = (r2 - r1) / (e2 - e1);
      const gainA = (a2 - a1) / (e2 - e1);
      const refR = u / (L + K * u * u);
      const refA = (u * u) / (L + K * u * u);
      // K from the steady states: delta = L r / u + K a_y (difference of the two runs: no offset)
      const kMeas = (e2 - e1 - (L * (r2 - r1)) / u) / (a2 - a1);
      rows.push(`u ${u}: r/delta ${gainR.toFixed(4)} (ref ${refR.toFixed(4)}), a_y/delta ${gainA.toFixed(2)} (ref ${refA.toFixed(2)}), K ${degPerG(kMeas).toFixed(4)} deg/g (ref ${degPerG(K).toFixed(4)})`);
      expect(Math.abs(gainR / refR - 1)).toBeLessThan(0.01);
      expect(Math.abs(gainA / refA - 1)).toBeLessThan(0.01);
      expect(Math.abs(kMeas / K - 1)).toBeLessThan(0.01);
    }
    console.log(`[T1] linear tyre, rigid loads: ${rows.join('; ')}`);
  }, 60_000);

  it('T2: K = -0.5 .. +3 deg/g by the rear stiffness: steer trend sign and characteristic speed within 3 %', () => {
    const rows: string[] = [];
    const base = h.tyres.rear.corneringStiffness;
    for (const target of [-0.5, 0, 1, 3]) {
      // solve the rear stiffness for the target K with the closed form (bisection on the per-load coefficient)
      let lo = base * 0.1;
      let hi = base * 40;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        const { K } = closedForm(rig({ vehicle: variant(mid), options: OPTS }));
        if (degPerG(K) > target) hi = mid;
        else lo = mid;
      }
      const r = rig({ vehicle: variant((lo + hi) / 2), options: OPTS });
      const { L, K } = closedForm(r);
      // constant radius R 100 m: the steer needed at 10 and 20 m/s (open-loop: delta = L/R + K a_y; measure a_y, r)
      const u1 = 12;
      const u2 = 24;
      const d0 = 0.005;
      const d1 = 0.01;
      const kAt = (u: number): number => {
        const [ra, aa, ea] = steady(r, u, d0);
        const [rb, ab, eb] = steady(r, u, d1);
        return (eb - ea - (L * (rb - ra)) / u) / (ab - aa);
      };
      const ka = kAt(u1);
      const kb = kAt(u2);
      const kMeas = (ka + kb) / 2;
      const sign = Math.sign(Math.round(degPerG(kMeas) * 100));
      expect(sign).toBe(Math.sign(target));
      // steer for a fixed radius rises (understeer), stays (neutral) or falls (oversteer) with a_y
      if (target !== 0) {
        const vc = Math.sqrt(L / Math.abs(kMeas));
        const ref = Math.sqrt(L / Math.abs(K));
        expect(Math.abs(vc / ref - 1)).toBeLessThan(0.03);
        rows.push(`target ${target} (closed form ${degPerG(K).toFixed(3)}, the rear coefficient alone tops out near 2.85) deg/g: measured ${degPerG(kMeas).toFixed(3)}, ${target > 0 ? 'V_char' : 'V_crit'} ${vc.toFixed(1)} m/s (ref ${ref.toFixed(1)})`);
      } else {
        expect(Math.abs(degPerG(kMeas))).toBeLessThan(0.01);
        rows.push(`K 0: measured ${degPerG(kMeas).toFixed(4)} deg/g`);
      }
    }
    console.log(`[T2] ${rows.join('; ')}`);
  }, 120_000);
});
