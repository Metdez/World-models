import { describe, expect, it } from 'vitest';
import * as interp from '../../src/sim-core/math/interp';
import { normalEquations, solveInPlace } from '../../src/sim-core/math/linsolve';
import * as m3 from '../../src/sim-core/math/mat';
import * as q from '../../src/sim-core/math/quat';
import { createRng, hashFloat } from '../../src/sim-core/math/rng';
import * as v3 from '../../src/sim-core/math/vec3';

const rng = createRng(1234);
const randVec = (s = 1): v3.V3 => [rng.uniform(-s, s), rng.uniform(-s, s), rng.uniform(-s, s)];
const expectVec = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 12) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, digits);
};

describe('vec3', () => {
  it('arithmetic, products, norms', () => {
    const a = v3.create(1, 2, 3);
    const b = v3.create(-4, 0.5, 2);
    const o = v3.create();
    expect(v3.add(o, a, b)).toEqual([-3, 2.5, 5]);
    expect(v3.sub(o, a, b)).toEqual([5, 1.5, 1]);
    expect(v3.scale(o, a, 2)).toEqual([2, 4, 6]);
    expect(v3.scaleAndAdd(o, a, b, 2)).toEqual([-7, 3, 7]);
    expect(v3.negate(o, a)).toEqual([-1, -2, -3]);
    expect(v3.lerp(o, a, b, 0.5)).toEqual([-1.5, 1.25, 2.5]);
    expect(v3.dot(a, b)).toBe(3);
    expect(v3.cross(o, [1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(v3.length([3, 4, 12])).toBe(13);
    expect(v3.distance(a, [1, 2, 4])).toBe(1);
    expect(v3.normalize(o, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(v3.length(v3.normalize(o, b))).toBeCloseTo(1, 15);
  });

  it('cross is aliasing-safe and orthogonal', () => {
    for (let k = 0; k < 50; k++) {
      const a = randVec();
      const b = randVec();
      const c = v3.cross(v3.create(), a, b);
      expect(v3.dot(c, a)).toBeCloseTo(0, 14);
      expect(v3.dot(c, b)).toBeCloseTo(0, 14);
      const alias = v3.copy(v3.create(), a);
      expect(v3.cross(alias, alias, b)).toEqual(c);
    }
  });

  it('flat-array and XYZ interop', () => {
    const arr = new Float64Array(6);
    v3.write([7, 8, 9], arr, 3);
    expect(Array.from(arr)).toEqual([0, 0, 0, 7, 8, 9]);
    expect(v3.read(v3.create(), arr, 3)).toEqual([7, 8, 9]);
    const xyz = { x: 0, y: 0, z: 0 };
    expect(v3.toXYZ([1, 2, 3], xyz)).toEqual({ x: 1, y: 2, z: 3 });
    expect(v3.fromXYZ(v3.create(), xyz)).toEqual([1, 2, 3]);
    expect(v3.equals([1, 2, 3], [1, 2, 3 + 1e-13])).toBe(true);
  });
});

describe('rotations', () => {
  it('sign conventions (units.ts): roll + lifts left, pitch + nose down, yaw + turns left', () => {
    const o = v3.create();
    const r = q.create();
    q.rotate(o, q.fromRollPitchYaw(r, 0.1, 0, 0), [0, 1, 0]);
    expect(o[2]).toBeGreaterThan(0);
    q.rotate(o, q.fromRollPitchYaw(r, 0, 0.1, 0), [1, 0, 0]);
    expect(o[2]).toBeLessThan(0);
    q.rotate(o, q.fromRollPitchYaw(r, 0, 0, 0.1), [1, 0, 0]);
    expect(o[1]).toBeGreaterThan(0);
  });

  it('roll/pitch/yaw = Rz(yaw) * Ry(pitch) * Rx(roll) and round-trips', () => {
    const X: v3.V3 = [1, 0, 0];
    const Y: v3.V3 = [0, 1, 0];
    const Z: v3.V3 = [0, 0, 1];
    for (let k = 0; k < 100; k++) {
      const roll = rng.uniform(-3, 3);
      const pitch = rng.uniform(-1.5, 1.5);
      const yaw = rng.uniform(-3, 3);
      const a = q.fromRollPitchYaw(q.create(), roll, pitch, yaw);
      const qz = q.fromAxisAngle(q.create(), Z, yaw);
      const qy = q.fromAxisAngle(q.create(), Y, pitch);
      const qx = q.fromAxisAngle(q.create(), X, roll);
      const b = q.multiply(q.create(), qz, q.multiply(q.create(), qy, qx));
      expect(q.angleBetween(a, b)).toBeLessThan(1e-7);
      expectVec(q.toRollPitchYaw(v3.create(), a), [roll, pitch, yaw], 9);
    }
  });

  it('quaternion and matrix agree (fromQuat, fromRotationVector, multiply order, toQuat)', () => {
    for (let k = 0; k < 200; k++) {
      const w = randVec(k < 100 ? 3 : 1e-5); // includes the small-angle series branch
      const qa = q.fromRotationVector(q.create(), w);
      expect(Math.sqrt(q.dot(qa, qa))).toBeCloseTo(1, 14);
      const ma = m3.fromRotationVector(m3.create(), w);
      expectVec(m3.fromQuat(m3.create(), qa), ma, 13);
      const p = randVec();
      expectVec(q.rotate(v3.create(), qa, p), m3.transformVec3(v3.create(), ma, p), 13);
      expectVec(q.rotateInverse(v3.create(), qa, q.rotate(v3.create(), qa, p)), p, 13);
      expectVec(m3.transformTransposeVec3(v3.create(), ma, m3.transformVec3(v3.create(), ma, p)), p, 13);
      // orthonormal, det +1
      expectVec(m3.multiply(m3.create(), ma, m3.transpose(m3.create(), ma)), m3.create(), 13);
      expect(m3.determinant(ma)).toBeCloseTo(1, 13);
      // composition order
      const qb = q.fromRotationVector(q.create(), randVec(2));
      const mb = m3.fromQuat(m3.create(), qb);
      expectVec(m3.fromQuat(m3.create(), q.multiply(q.create(), qa, qb)), m3.multiply(m3.create(), ma, mb), 13);
      // matrix -> quaternion (same rotation, sign-agnostic)
      expect(q.angleBetween(m3.toQuat(q.create(), ma), qa)).toBeLessThan(1e-7);
    }
  });

  it('toQuat handles 180-degree rotations about every axis', () => {
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], v3.normalize(v3.create(), [1, -2, 0.5])] as v3.V3[]) {
      const qa = q.fromAxisAngle(q.create(), axis, Math.PI);
      const back = m3.toQuat(q.create(), m3.fromQuat(m3.create(), qa));
      expect(q.angleBetween(back, qa)).toBeLessThan(1e-7);
    }
  });

  it('rotation vector exp/log round-trip, incl. near zero and near pi', () => {
    const cases: v3.V3[] = [[0, 0, 0], [1e-9, -2e-9, 0], [0.3, -0.2, 0.1], [0, 0, Math.PI - 1e-6], randVec(1.5)];
    for (const w of cases) expectVec(q.toRotationVector(v3.create(), q.fromRotationVector(q.create(), w)), w, 9);
    // q and -q give the same rotation vector
    const qa = q.fromRotationVector(q.create(), [0.2, 0.1, -0.4]);
    const neg = q.set(q.create(), -qa[0], -qa[1], -qa[2], -qa[3]);
    expectVec(q.toRotationVector(v3.create(), neg), [0.2, 0.1, -0.4], 12);
  });

  it('Rodrigues is smooth across the series switch (finite-difference Jacobians stay valid)', () => {
    const h = 1e-7;
    const a = m3.fromRotationVector(m3.create(), [h, 0, 0]);
    const b = m3.fromRotationVector(m3.create(), [-h, 0, 0]);
    // dR/dw_x at 0 = skew(e_x)
    const d = a.map((v, i) => (v - b[i]!) / (2 * h));
    expectVec(d, m3.skew(m3.create(), [1, 0, 0]), 7);
  });

  it('slerp: endpoints, midpoint angle, shortest path', () => {
    const a = q.fromAxisAngle(q.create(), [0, 0, 1], 0.2);
    const b = q.fromAxisAngle(q.create(), [0, 0, 1], 1.0);
    expect(q.angleBetween(q.slerp(q.create(), a, b, 0), a)).toBeLessThan(1e-7);
    expect(q.angleBetween(q.slerp(q.create(), a, b, 1), b)).toBeLessThan(1e-7);
    expect(q.toRollPitchYaw(v3.create(), q.slerp(q.create(), a, b, 0.5))[2]).toBeCloseTo(0.6, 12);
    const negB = q.set(q.create(), -b[0], -b[1], -b[2], -b[3]);
    expect(q.toRollPitchYaw(v3.create(), q.slerp(q.create(), a, negB, 0.5))[2]).toBeCloseTo(0.6, 12);
  });

  it('XYZW interop and invert', () => {
    const xyzw = { x: 0, y: 0, z: 0, w: 0 };
    q.toXYZW([0.1, 0.2, 0.3, 0.9], xyzw);
    expect(q.fromXYZW(q.create(), xyzw)).toEqual([0.1, 0.2, 0.3, 0.9]);
    const m: m3.Mat3 = [2, 1, 0, 1, 3, 1, 0, 1, 4];
    const inv = m3.create();
    expect(m3.invert(inv, m)).toBe(true);
    expectVec(m3.multiply(m3.create(), m, inv), m3.create(), 14);
    expect(m3.invert(inv, [1, 2, 3, 2, 4, 6, 0, 0, 1])).toBe(false);
  });
});

describe('linsolve', () => {
  it('solves random dense systems (3x3 and 6x6) to round-off', () => {
    for (const n of [3, 6]) {
      for (let k = 0; k < 50; k++) {
        const A = Float64Array.from({ length: n * n }, () => rng.uniform(-1, 1));
        const x = Float64Array.from({ length: n }, () => rng.uniform(-5, 5));
        const b = new Float64Array(n);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) b[i]! += A[i * n + j]! * x[j]!;
        expect(solveInPlace(Float64Array.from(A), b, n)).toBe(true);
        expectVec(b, x, 8);
      }
    }
  });

  it('pivots past a zero diagonal and detects singular matrices', () => {
    const b = Float64Array.of(2, 3);
    expect(solveInPlace(Float64Array.of(0, 1, 1, 0), b, 2)).toBe(true);
    expect(Array.from(b)).toEqual([3, 2]);
    expect(solveInPlace(Float64Array.of(1, 2, 2, 4), Float64Array.of(1, 1), 2)).toBe(false);
    expect(solveInPlace(new Float64Array(9), new Float64Array(3), 3)).toBe(false);
  });

  it('normalEquations builds J^T J + lambda I and -J^T r', () => {
    const J = Float64Array.of(1, 2, 3, 4, 5, 6); // 3 x 2
    const r = Float64Array.of(1, -1, 2);
    const A = new Float64Array(4);
    const g = new Float64Array(2);
    normalEquations(J, r, 3, 2, 0.5, A, g);
    expect(Array.from(A)).toEqual([35 + 0.5, 44, 44, 56 + 0.5]);
    expect(Array.from(g)).toEqual([-(1 - 3 + 10), -(2 - 4 + 12)]);
  });

  it('is enough for a 6-DOF rigid-body Newton/LM solve (translation + rotation vector)', () => {
    // Recover the pose that maps three body points onto measured world points: the kinematics solver's core loop.
    const body: v3.V3[] = [[0.1, 0.7, 0.2], [-0.05, 0.75, 0.55], [0.15, 0.68, 0.33]];
    const truthR = m3.fromRotationVector(m3.create(), [0.05, -0.12, 0.08]);
    const truthT: v3.V3 = [0.01, -0.02, 0.06];
    const world = body.map((p) => v3.add(v3.create(), m3.transformVec3(v3.create(), truthR, p), truthT));
    const x = new Float64Array(6);
    const R = m3.create();
    const tmp = v3.create();
    const residuals = (state: Float64Array, out: Float64Array) => {
      m3.fromRotationVector(R, [state[3]!, state[4]!, state[5]!]);
      body.forEach((p, i) => {
        m3.transformVec3(tmp, R, p);
        for (let c = 0; c < 3; c++) out[3 * i + c] = tmp[c]! + state[c]! - world[i]![c]!;
      });
      return out;
    };
    const r = new Float64Array(9);
    const rp = new Float64Array(9);
    const rm = new Float64Array(9);
    const J = new Float64Array(9 * 6);
    const A = new Float64Array(36);
    const g = new Float64Array(6);
    const h = 1e-7;
    let iterations = 0;
    for (; iterations < 40; iterations++) {
      residuals(x, r);
      if (Math.hypot(...r) < 1e-12) break;
      for (let j = 0; j < 6; j++) {
        const xj = x[j]!;
        x[j] = xj + h;
        residuals(x, rp);
        x[j] = xj - h;
        residuals(x, rm);
        x[j] = xj;
        for (let i = 0; i < 9; i++) J[i * 6 + j] = (rp[i]! - rm[i]!) / (2 * h);
      }
      normalEquations(J, r, 9, 6, 1e-9, A, g);
      expect(solveInPlace(A, g, 6)).toBe(true);
      for (let j = 0; j < 6; j++) x[j]! += g[j]!;
    }
    expect(iterations).toBeLessThan(10);
    expectVec(x.subarray(0, 3), truthT, 10);
    expectVec(x.subarray(3), [0.05, -0.12, 0.08], 10);
  });
});

describe('interp', () => {
  it('scalar helpers', () => {
    expect(interp.clamp(5, 0, 1)).toBe(1);
    expect(interp.lerp(2, 4, 0.25)).toBe(2.5);
    expect(interp.invLerp(2, 4, 3)).toBe(0.5);
    expect(interp.invLerp(2, 2, 3)).toBe(0);
    expect(interp.smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(interp.smoothstep(0, 1, -1)).toBe(0);
    expect(interp.cosineBlend(0, 2, 0.5)).toBeCloseTo(1, 15);
    expect(interp.cosineBlend(0, 2, 1)).toBe(2);
  });

  it('wrapping', () => {
    expect(interp.wrap(7, 5)).toBe(2);
    expect(interp.wrap(-1, 5)).toBe(4);
    expect(interp.wrap(-5, 5)).toBe(0);
    expect(interp.wrap(-1e-18, 5)).toBe(0); // never returns the period itself
    expect(interp.wrapHalf(9, 10)).toBe(-1);
    expect(interp.wrapHalf(-9, 10)).toBe(1);
    expect(interp.wrapAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 15);
    expect(interp.lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 12); // through pi, not through 0
  });

  it('lookup tables', () => {
    const xs = Float64Array.of(0, 1, 2, 4);
    const ys = Float64Array.of(0, 10, 20, 0);
    expect(interp.findInterval(xs, -1)).toBe(0);
    expect(interp.findInterval(xs, 1)).toBe(1);
    expect(interp.findInterval(xs, 3.9)).toBe(2);
    expect(interp.findInterval(xs, 9)).toBe(2);
    expect(interp.interp1(xs, ys, 0.5)).toBe(5);
    expect(interp.interp1(xs, ys, 3)).toBe(10);
    expect(interp.interp1(xs, ys, -3)).toBe(0);
    expect(interp.interp1(xs, ys, 99)).toBe(0);
  });

  it('bilinear is exact for bilinear functions and clamps', () => {
    const xs = Float64Array.of(-1, 0, 2);
    const ys = Float64Array.of(0, 1, 3, 4);
    const f = (x: number, y: number) => 1 + 2 * x - y + 0.5 * x * y;
    const values = new Float64Array(xs.length * ys.length);
    xs.forEach((x, i) => ys.forEach((y, j) => (values[i * ys.length + j] = f(x, y))));
    for (let k = 0; k < 50; k++) {
      const x = rng.uniform(-1, 2);
      const y = rng.uniform(0, 4);
      expect(interp.bilinear(xs, ys, values, x, y)).toBeCloseTo(f(x, y), 12);
    }
    expect(interp.bilinear(xs, ys, values, 9, 9)).toBeCloseTo(f(2, 4), 12);
  });

  it('cumulative trapezoid and low-pass gain', () => {
    const xs = Float64Array.of(0, 1, 3);
    const out = interp.cumulativeTrapezoid(xs, Float64Array.of(2, 2, 2), new Float64Array(3));
    expect(Array.from(out)).toEqual([0, 2, 6]);
    // two half steps == one full step (exact discretisation)
    const a1 = interp.lowPassAlpha(0.01, 8);
    const ah = interp.lowPassAlpha(0.005, 8);
    expect(1 - a1).toBeCloseTo((1 - ah) ** 2, 15);
  });
});

describe('rng', () => {
  it('is deterministic per seed and in range', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(sa).toEqual(Array.from({ length: 5 }, () => b.next()));
    expect(sa).not.toEqual(Array.from({ length: 5 }, () => c.next()));
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const u = r.next();
      expect(u >= 0 && u < 1).toBe(true);
      const k = r.int(6);
      expect(Number.isInteger(k) && k >= 0 && k < 6).toBe(true);
      const w = r.uniform(-2, 3);
      expect(w >= -2 && w < 3).toBe(true);
    }
  });

  it('normal() has zero mean and unit variance', () => {
    const r = createRng(99);
    const n = 20000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const z = r.normal();
      s += z;
      s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.04);
  });

  it('hashFloat is stateless and seed-dependent', () => {
    expect(hashFloat(42, 3, 7)).toBe(hashFloat(42, 3, 7));
    expect(hashFloat(42, 3, 7)).not.toBe(hashFloat(42, 7, 3));
    expect(hashFloat(42, 3, 7)).not.toBe(hashFloat(43, 3, 7));
    let mean = 0;
    for (let i = 0; i < 1000; i++) mean += hashFloat(1, i) / 1000;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
  });
});
