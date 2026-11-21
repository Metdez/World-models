/**
 * Y1 (ARCHITECTURE-M2 §11, §7.4): the full tyre body. Signs, camber/toe sweeps, C_alpha(N) and mu(N), friction circle,
 * relaxation steady state and lag, continuity through v = 0, low-speed damping bounds. Prints the measured values.
 */
import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD, G } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { gtCoupeTyres } from '../../src/sim-core/content/gt-coupe-tyres';
import { createTyreIo, evaluateTyre, limitDeflection, relax, SLIDE_BOUND, slipCurve, tyreCoefficients, type TyreIo } from '../../src/sim-core/drive/tyre';
import { peakMu } from '../../src/sim-core/ride/tyre';

const tp = gtCoupe.front.tyre;
const th = gtCoupeTyres.front;
const c = tyreCoefficients(tp, th);
const N0 = tp.nominalLoad;

/** Rolling at speed (no low-speed damping), given slips. */
function at(o: { load?: number; kappa?: number; tanA?: number; incl?: number; vx?: number; slipVx?: number; vy?: number }): TyreIo {
  const io = createTyreIo();
  io.load = o.load ?? N0;
  io.ux = (o.kappa ?? 0) * c.sigmaX;
  io.uy = (o.tanA ?? 0) * c.sigmaY;
  io.vx = o.vx ?? 20;
  io.slipVx = o.slipVx ?? 0;
  io.vy = o.vy ?? 0;
  io.inclination = o.incl ?? 0;
  io.camberToRoad = o.incl ?? 0;
  evaluateTyre(tp, c, io);
  return io;
}
/** Small-slip cornering stiffness, N/rad. */
const cAlpha = (load: number): number => -at({ load, tanA: 1e-5 }).fy / 1e-5;
/** Peak |Fy| over a slip sweep, N. */
function peakFy(load: number): number {
  let best = 0;
  for (let a = 0; a <= 0.6; a += 0.0005) best = Math.max(best, Math.abs(at({ load, tanA: a }).fy));
  return best;
}

describe('tyre model (Y1)', () => {
  it('signs: slide left -> Fy < 0; driving kappa -> Fx > 0; inclination > 0 -> thrust left', () => {
    expect(at({ tanA: 0.02 }).fy).toBeLessThan(0);
    expect(at({ tanA: -0.02 }).fy).toBeGreaterThan(0);
    expect(at({ kappa: 0.03 }).fx).toBeGreaterThan(0);
    expect(at({ kappa: -0.03 }).fx).toBeLessThan(0);
    expect(at({ incl: 2 * DEG_TO_RAD }).fy).toBeGreaterThan(0);
    expect(at({ incl: -2 * DEG_TO_RAD }).fy).toBeLessThan(0);
    const z = at({});
    expect(z.fx === 0 && z.fy === 0).toBe(true);
  });

  it('camber thrust ratio = camberRatio at small angles; camber and toe sweeps monotone', () => {
    const small = 0.01 * DEG_TO_RAD; // linear range
    const ratio = at({ incl: small }).fy / -at({ tanA: Math.tan(small) }).fy;
    const thrust = at({ incl: 1 * DEG_TO_RAD }).fy;
    console.log(`[Y1] camber thrust / slip force per unit angle (linear) = ${ratio.toFixed(5)} (camberRatio ${th.camberRatio}); 1 deg camber = ${thrust.toFixed(0)} N at ${N0} N`);
    expect(ratio).toBeCloseTo(th.camberRatio, 3);
    // camber -6..6 deg at zero slip: thrust strictly increasing
    let prev = -Infinity;
    for (let g = -6; g <= 6; g += 0.25) {
      const fy = at({ incl: g * DEG_TO_RAD }).fy;
      expect(fy).toBeGreaterThan(prev);
      prev = fy;
    }
    // toe (= slip-angle offset) up to the peak: |Fy| strictly increasing, sign restoring
    let prevAbs = -1;
    let peakA = 0;
    for (let toe = 0; toe <= 10; toe += 0.05) {
      const fy = at({ tanA: Math.tan(toe * DEG_TO_RAD) }).fy;
      if (Math.abs(fy) <= prevAbs) break;
      prevAbs = Math.abs(fy);
      peakA = toe;
    }
    const D = peakMu(N0, 0, tp) * N0;
    console.log(`[Y1] lateral peak at ${peakA.toFixed(2)} deg slip (s_peak ${c.peakSlip.toFixed(3)}), |Fy| ${prevAbs.toFixed(0)} N = ${(prevAbs / D).toFixed(4)} D`);
    expect(peakA).toBeGreaterThan(6);
    expect(peakA).toBeLessThan(11);
    expect(prevAbs / D).toBeCloseTo(1, 3);
  });

  it('falling branch: sliding gives less than the peak; the curve is unit-slope', () => {
    const D = peakMu(N0, 0, tp) * N0;
    const lock = at({ kappa: -1 });
    const side = at({ tanA: 10 });
    console.log(`[Y1] locked wheel Fx = ${(lock.fx / D).toFixed(3)} D; 84 deg sideways Fy = ${(-side.fy / D).toFixed(3)} D; f(inf) = ${Math.sin(1.35 * Math.PI / 2).toFixed(3)}`);
    expect(-lock.fx / D).toBeGreaterThan(0.84);
    expect(-lock.fx / D).toBeLessThan(0.93);
    expect(slipCurve(1e-4, th.shape, th.curvature) / 1e-4).toBeCloseTo(1, 6);
    expect(slipCurve(c.peakSlip, th.shape, th.curvature)).toBeCloseTo(1, 9);
  });

  it('C_alpha(N) follows the g-shape and mu(N) comes from peakMu', () => {
    const rows: string[] = [];
    let prevC = 0;
    let prevPerN = Infinity;
    for (const n of [1000, 2000, 3000, 4200, 6000, 8000]) {
      const ca = cAlpha(n);
      const fy = peakFy(n);
      const mu = fy / n;
      rows.push(`N ${n}: C_alpha ${(ca / 1000).toFixed(1)} kN/rad (${(ca / n).toFixed(2)} /rad), peak mu ${mu.toFixed(4)} (peakMu ${peakMu(n, 0, tp).toFixed(4)})`);
      expect(mu).toBeCloseTo(peakMu(n, 0, tp), 3);
      expect(ca).toBeGreaterThan(prevC); // rises up to k*N0 = 8400 N
      expect(ca / n).toBeLessThan(prevPerN); // per unit load falls (load sensitivity)
      prevC = ca;
      prevPerN = ca / n;
    }
    console.log(`[Y1] ${rows.join('\n[Y1] ')}`);
    expect(cAlpha(N0) / N0).toBeCloseTo(th.corneringStiffness, 6);
    expect(cAlpha(2 * th.stiffnessLoadShape * N0)).toBeLessThan(cAlpha(th.stiffnessLoadShape * N0)); // past the top
  });

  it('friction circle is never exceeded (combined slip, camber, low-speed damping)', () => {
    let worst = 0;
    for (const load of [500, N0, 9000])
      for (let k = -1; k <= 1; k += 0.05)
        for (let a = -1; a <= 1; a += 0.05)
          for (const vx of [0, 0.8, 20]) {
            const io = at({ load, kappa: k, tanA: a, incl: 3 * DEG_TO_RAD, vx, slipVx: 5 * k, vy: 3 * a });
            worst = Math.max(worst, Math.hypot(io.fx, io.fy) / io.capacity);
          }
    console.log(`[Y1] max |F| / capacity over the combined sweep = ${worst.toFixed(12)}`);
    expect(worst).toBeLessThanOrEqual(1 + 1e-12);
    // combined slip reduces the lateral force
    expect(Math.abs(at({ tanA: 0.05, kappa: -0.1 }).fy)).toBeLessThan(Math.abs(at({ tanA: 0.05 }).fy));
  });

  it('relaxation: steady state uy = sigma * vy / |vx|; step lag = sigma / v within 10 %', () => {
    const dt = 1 / 240;
    for (const v of [10, 20]) {
      const vy = 0.05;
      let uy = 0;
      let t = 0;
      let t63 = NaN;
      const target = (c.sigmaY * vy) / v;
      for (let n = 0; n < 2000; n++) {
        const before = uy;
        uy = relax(uy, vy, v, c.sigmaY, dt);
        t += dt;
        const level = (1 - Math.exp(-1)) * target;
        if (Number.isNaN(t63) && uy >= level) t63 = t - dt + (dt * (level - before)) / (uy - before); // crossing within the step
      }
      // the force lags the same way (linear range)
      const fyEnd = at({ tanA: uy / c.sigmaY }).fy;
      console.log(`[Y1] v ${v} m/s: uy_ss ${uy.toExponential(4)} (sigma*vy/v ${target.toExponential(4)}), 63 % at ${(t63 * 1000).toFixed(1)} ms vs sigma/v ${((c.sigmaY / v) * 1000).toFixed(1)} ms`);
      expect(uy).toBeCloseTo(target, 12);
      expect(Math.abs(fyEnd / (-cAlpha(N0) * (vy / v)) - 1)).toBeLessThan(0.01);
      expect(Math.abs(t63 / (c.sigmaY / v) - 1)).toBeLessThan(0.1);
    }
    // non-singular at v = 0: pure integration
    expect(relax(0.01, 0.2, 0, c.sigmaY, dt)).toBeCloseTo(0.01 + 0.2 * dt, 15);
  });

  it('continuity through v = 0 and bounded low-speed damping', () => {
    let maxJump = 0;
    let prev: TyreIo | null = null;
    for (let vx = -2; vx <= 2 + 1e-9; vx += 0.001) {
      const io = at({ vx, kappa: 0.004, tanA: 0.003, slipVx: -vx * 0.01, vy: 0.02 });
      if (prev) maxJump = Math.max(maxJump, Math.abs(io.fx - prev.fx), Math.abs(io.fy - prev.fy));
      prev = { ...io };
    }
    console.log(`[Y1] largest force change per 1 mm/s of vx across -2..2 m/s: ${maxJump.toFixed(3)} N`);
    expect(maxJump).toBeLessThan(5);
    // damping: zero above 1.5 m/s; explicit-stable on the corner mass (c dt / m < 1); never beyond the circle
    expect(at({ vx: 1.6, slipVx: 1 }).dampX).toBe(0);
    for (const load of [300, N0, 12000]) {
      const io = at({ load, vx: 0, slipVx: 50, vy: 50 });
      const m = load / G;
      const cy = 2 * Math.sqrt(((th.corneringStiffness * N0 * 1.2) / c.sigmaY) * m); // >= the applied coefficient (g-shape <= 1.2 of nominal)
      expect((io.dampX * (1 / 240)) / m).toBeLessThan(1);
      expect((cy * (1 / 240)) / m).toBeLessThan(1);
      expect(Math.hypot(io.fx, io.fy)).toBeLessThanOrEqual(io.capacity * (1 + 1e-12));
    }
  });

  it('unloaded tyre makes no force; the secant slope is floored', () => {
    const io = at({ load: 0, kappa: 0.1, tanA: 0.1 });
    expect(io.fx).toBe(0);
    expect(io.fy).toBe(0);
    expect(io.capacity).toBe(0);
    const deep = at({ kappa: 50 });
    expect(deep.slopeX).toBeCloseTo((0.05 * c.c0Kappa) / c.sigmaX, 6);
  });

  it('slide bound: stored deflection clamped at SLIDE_BOUND x peak slip, camber offset kept, inside untouched', () => {
    const io = at({ kappa: 2, tanA: 3, incl: 2 * DEG_TO_RAD });
    const D = io.capacity;
    limitDeflection(tp, c, io);
    const sx = (c.c0Kappa * io.ux) / (c.sigmaX * D);
    const sy = (c.c0Alpha * (io.uy / c.sigmaY - c.camberRatio * io.inclination)) / D;
    expect(Math.hypot(sx, sy)).toBeCloseTo(SLIDE_BOUND * c.peakSlip, 9);
    expect(sx / sy).toBeCloseTo((c.c0Kappa * 2) / (c.c0Alpha * (3 - c.camberRatio * io.inclination)), 9);
    const small = at({ kappa: 0.05, tanA: 0.05 });
    const ux = small.ux;
    limitDeflection(tp, c, small);
    expect(small.ux).toBe(ux);
    console.log(`[Y1] slide bound s = ${(SLIDE_BOUND * c.peakSlip).toFixed(2)}, f there ${slipCurve(SLIDE_BOUND * c.peakSlip, th.shape, th.curvature).toFixed(3)}`);
  });
});
