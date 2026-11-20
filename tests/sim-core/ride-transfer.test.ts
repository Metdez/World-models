/**
 * Steady-state load transfer, roll gradient and braking pitch against closed forms derived from the free-body
 * diagram (independent of the model code):
 *  per axle j:  t_j*dFz_j = ms_j*ay*hRc_j + ay*Σ(m_u*h_u)_j + Ks_j*(phi - phiU_j),   t_j*dFz_j = Kt_j*phiU_j
 *  body:        Σ Ks_j*(phi - phiU_j) = ms*ay*(h - hRa) + ms*g*(h - hRa)*phi
 *  with Ks_j = k*t²/2 + kArb*t² (springs + ARB), Kt_j = kt*t²/2 (tyres), phiU_j = axle (unsprung) roll.
 */
import { describe, expect, it } from 'vitest';
import { G, RAD_TO_DEG } from '../../src/contracts/units';
import { createRideModel, type RideParams } from '../../src/sim-core/ride/ride7dof';
import { GT, rideInput, rideParams, run, totalMass, type CarSpec } from '../fixtures/02-03-ride';

const P = rideParams(GT);

function axleGeometry(p: RideParams) {
  const c = p.corners;
  const xF = c[0].x;
  const xR = c[2].x;
  const L = xF - xR;
  const ms = [(p.sprungMass * -xR) / L, (p.sprungMass * xF) / L];
  const t = [c[0].y - c[1].y, c[2].y - c[3].y];
  const k = [c[0].wheelRate, c[2].wheelRate];
  const kt = [c[0].tyreRate, c[2].tyreRate];
  const arb = [p.arbRate.front, p.arbRate.rear];
  const uh = [0, 1].map((j) => c[2 * j]!.unsprungMass * (c[2 * j]!.wheelCentreHeight ?? 0) + c[2 * j + 1]!.unsprungMass * (c[2 * j + 1]!.wheelCentreHeight ?? 0));
  const Ks = [0, 1].map((j) => (k[j]! * t[j]! ** 2) / 2 + arb[j]! * t[j]! ** 2);
  const Kt = [0, 1].map((j) => (kt[j]! * t[j]! ** 2) / 2);
  return { L, xF, xR, ms, t, k, kt, uh, Ks, Kt };
}

/** Closed-form steady state in a corner: body roll, per-axle outer-wheel load gain. */
function closedFormCornering(p: RideParams, ay: number, rc: [number, number]) {
  const g = axleGeometry(p);
  const hRa = (g.ms[0]! * rc[0] + g.ms[1]! * rc[1]) / p.sprungMass;
  const hr = p.cgHeight - hRa;
  const F = [0, 1].map((j) => g.ms[j]! * ay * rc[j]! + ay * g.uh[j]!); // geometric + unsprung moments per axle
  // phiU_j = (F_j + Ks_j*phi)/(Kt_j + Ks_j)  ->  phi * [Σ Ks Kt/(Ks+Kt) - ms g hr] = ms ay hr + Σ Ks F/(Ks+Kt)
  let num = p.sprungMass * ay * hr;
  let den = -p.sprungMass * G * hr;
  for (let j = 0; j < 2; j++) {
    const s = g.Ks[j]! + g.Kt[j]!;
    num += (g.Ks[j]! * F[j]!) / s;
    den += (g.Ks[j]! * g.Kt[j]!) / s;
  }
  const phi = num / den;
  const dFz = [0, 1].map((j) => {
    const phiU = (F[j]! + g.Ks[j]! * phi) / (g.Kt[j]! + g.Ks[j]!);
    return (g.Kt[j]! * phiU) / g.t[j]!;
  });
  return { phi, dFz, hr, g };
}

/** Closed-form steady braking/accelerating pitch (+ nose down) with link-carried fractions anti[j]. */
function closedFormPitch(p: RideParams, ax: number, anti: [number, number]) {
  const g = axleGeometry(p);
  const h = p.cgHeight;
  const ms = p.sprungMass;
  const uhAll = g.uh[0]! + g.uh[1]!;
  const dTf = (-ax * (ms * h + uhAll)) / g.L; // front axle tyre gain (both wheels)
  const dSf = (-ms * ax * h * (1 - anti[0])) / g.L; // front spring force change (both wheels)
  const dSr = (ms * ax * h * (1 - anti[1])) / g.L;
  const zbF = -dTf / 2 / g.kt[0]! - dSf / 2 / g.k[0]!;
  const zbR = dTf / 2 / g.kt[1]! - dSr / 2 / g.k[1]!;
  return { pitch: (zbR - zbF) / g.L, dTf };
}

const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('ride7dof: lateral load transfer (left turn, ay > 0)', () => {
  const ay = 0.8 * G;
  const rc: [number, number] = [0.08, 0.1];

  const settled = (params = P, rcH = rc) => {
    const m = createRideModel(params);
    m.reset(rideInput({ rcHeight: { front: rcH[0], rear: rcH[1] } }));
    const input = rideInput({ rcHeight: { front: rcH[0], rear: rcH[1] } });
    // ramp in over 0.5 s, then hold 4 s
    run(m, input, 4.5, (t) => (input.ay = ay * Math.min(1, t / 0.5)));
    return m.state;
  };

  it('signs: body rolls left-side-up (roll > 0), right wheels in bump and loaded', () => {
    const s = settled();
    expect(s.roll).toBeGreaterThan(0);
    expect(s.travel[1]).toBeGreaterThan(0);
    expect(s.travel[3]).toBeGreaterThan(0);
    expect(s.travel[0]).toBeLessThan(0);
    expect(s.load[1]).toBeGreaterThan(s.load[0]!);
    expect(s.load[3]).toBeGreaterThan(s.load[2]!);
  });

  it('per-axle transfer and roll angle match the closed form (±1 %); total = (m·ay·h + tilt)/t', () => {
    const s = settled();
    const cf = closedFormCornering(P, ay, rc);
    const dF = [(s.load[1]! - s.load[0]!) / 2, (s.load[3]! - s.load[2]!) / 2];
    expect(rel(s.roll, cf.phi)).toBeLessThan(0.01);
    expect(rel(dF[0]!, cf.dFz[0]!)).toBeLessThan(0.01);
    expect(rel(dF[1]!, cf.dFz[1]!)).toBeLessThan(0.01);

    // Global moment balance: Σ t_j dFz_j = ay*(ms*h + Σ m_u h_u) + ms*g*(h - hRa)*phi.
    const g = cf.g;
    const mh = GT.sprungMass * GT.cgHeight + g.uh[0]! + g.uh[1]!;
    const lhs = g.t[0]! * dF[0]! + g.t[1]! * dF[1]!;
    const tilt = GT.sprungMass * G * cf.hr * s.roll;
    expect(rel(lhs, ay * mh + tilt)).toBeLessThan(0.005);

    const tAvg = (g.t[0]! + g.t[1]!) / 2;
    const textbook = (totalMass(GT) * ay * (mh / totalMass(GT))) / tAvg; // m·ay·h/t, h = combined CG height
    const total = dF[0]! + dF[1]!;
    console.log(
      `[ride] 0.8 g: roll ${(s.roll * RAD_TO_DEG).toFixed(3)}° (closed form ${(cf.phi * RAD_TO_DEG).toFixed(3)}°), ` +
        `transfer front ${dF[0]!.toFixed(0)} N rear ${dF[1]!.toFixed(0)} N (closed form ${cf.dFz.map((x) => x.toFixed(0)).join(' / ')}), ` +
        `total ${total.toFixed(0)} N vs m·ay·h/t ${textbook.toFixed(0)} N (+${((total / textbook - 1) * 100).toFixed(2)} % = roll tilt + track difference)`,
    );
    expect(rel(total, textbook)).toBeLessThan(0.03);
  });

  it('roll gradient (deg/g) matches the closed form; higher roll centres roll less and transfer more geometrically', () => {
    const grad = (rcH: [number, number]) => (settled(P, rcH).roll * RAD_TO_DEG) / 0.8;
    const low = grad([0.03, 0.05]);
    const mid = grad(rc);
    const high = grad([0.13, 0.15]);
    const cf = (closedFormCornering(P, ay, rc).phi * RAD_TO_DEG) / 0.8;
    // Textbook body-only gradient (rigid tyres, no geometric/unsprung coupling) for reference:
    const g = axleGeometry(P);
    const hr = closedFormCornering(P, ay, rc).hr;
    const rigid = ((GT.sprungMass * G * hr) / (g.Ks[0]! + g.Ks[1]! - GT.sprungMass * G * hr)) * RAD_TO_DEG;
    console.log(
      `[ride] roll gradient: ${mid.toFixed(3)} °/g (closed form ${cf.toFixed(3)}, rigid-tyre textbook ${rigid.toFixed(3)}); ` +
        `RC 30/50 mm ${low.toFixed(3)}, RC 130/150 mm ${high.toFixed(3)} °/g`,
    );
    expect(rel(mid, cf)).toBeLessThan(0.01);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it('reset under a lateral acceleration lands on the dynamic steady state', () => {
    const s = settled();
    const m = createRideModel(P);
    m.reset(rideInput({ ay, rcHeight: { front: rc[0], rear: rc[1] } }));
    expect(m.state.roll).toBeCloseTo(s.roll, 6);
    for (let i = 0; i < 4; i++) expect(m.state.load[i]).toBeCloseTo(s.load[i]!, 0);
  });
});

describe('ride7dof: longitudinal load transfer and anti-pitch', () => {
  const settledPitch = (ax: number, anti: [number, number], car: CarSpec = GT) => {
    const p = rideParams(car);
    const m = createRideModel(p);
    m.reset(rideInput());
    const input = rideInput({ antiPitch: { front: anti[0], rear: anti[1] } });
    run(m, input, 4.5, (t) => (input.ax = ax * Math.min(1, t / 0.5)));
    return m.state;
  };

  it('1 g braking: nose down (pitch > 0), fronts in bump, total transfer = m·ax·h/L; pitch matches closed form ±1 %', () => {
    const results: string[] = [];
    for (const anti of [
      [0, 0],
      [0.25, 0.25],
      [0.25, 0],
    ] as [number, number][]) {
      const s = settledPitch(-G, anti);
      const cf = closedFormPitch(P, -G, anti);
      expect(s.pitch).toBeGreaterThan(0);
      expect(s.travel[0]).toBeGreaterThan(0);
      expect(s.travel[2]).toBeLessThan(0);
      expect(rel(s.pitch, cf.pitch)).toBeLessThan(0.01);
      const static0 = createRideModel(P);
      static0.reset(rideInput());
      const gain = s.load[0]! + s.load[1]! - static0.state.load[0]! - static0.state.load[1]!;
      expect(rel(gain, cf.dTf)).toBeLessThan(0.01);
      results.push(`anti ${anti.join('/')}: ${(s.pitch * RAD_TO_DEG).toFixed(3)}° (closed form ${(cf.pitch * RAD_TO_DEG).toFixed(3)}°)`);
    }
    console.log(`[ride] pitch under 1 g braking: ${results.join('; ')}; front axle gain ${closedFormPitch(P, -G, [0, 0]).dTf.toFixed(0)} N`);
    const p0 = settledPitch(-G, [0, 0]).pitch;
    const p25 = settledPitch(-G, [0.25, 0.25]).pitch;
    expect(p25).toBeLessThan(p0);
  });

  it('acceleration squats (pitch < 0), anti-squat reduces it', () => {
    const a0 = settledPitch(0.5 * G, [0, 0]).pitch;
    const a3 = settledPitch(0.5 * G, [0, 0.3]).pitch;
    expect(a0).toBeLessThan(0);
    expect(a3).toBeGreaterThan(a0);
    expect(rel(a3, closedFormPitch(P, 0.5 * G, [0, 0.3]).pitch)).toBeLessThan(0.01);
  });
});
