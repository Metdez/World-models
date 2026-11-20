/**
 * Levenberg-Marquardt for small square-ish systems (research 03 §3.2): central-difference Jacobian,
 * warm start from x, step acceptance with adaptive damping. Allocation-free after creation.
 */
import { normalEquations, solveInPlace } from '../math/linsolve';

export type ResidualFn = (x: Float64Array, r: Float64Array) => void;

export interface LmSolver {
  readonly n: number;
  readonly m: number;
  /** Jacobian (m x n, row-major) at the last `jacobian()` call. */
  readonly J: Float64Array;
  /** Residual at the returned x of the last `solve()`. */
  readonly r: Float64Array;
  /** max |r| after the last solve. */
  residualMax: number;
  /**
   * Refines x in place until max|r| < tol. Returns the iteration count, or -1 if it did not converge
   * (x is then the best iterate found).
   */
  solve(f: ResidualFn, x: Float64Array, tol?: number, maxIter?: number): number;
  /** Central-difference Jacobian of f at x into J. */
  jacobian(f: ResidualFn, x: Float64Array): Float64Array;
}

const H = 1e-7;
const LAMBDA_MIN = 1e-9;

export function createLmSolver(n: number, m: number): LmSolver {
  const J = new Float64Array(m * n);
  const r = new Float64Array(m);
  const rp = new Float64Array(m);
  const rm = new Float64Array(m);
  const A = new Float64Array(n * n);
  const g = new Float64Array(n);
  const xTry = new Float64Array(n);

  const maxAbs = (v: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s = Math.max(s, Math.abs(v[i]!));
    return s;
  };
  const sumSq = (v: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
    return s;
  };

  const solver: LmSolver = {
    n,
    m,
    J,
    r,
    residualMax: Infinity,
    jacobian(f, x) {
      for (let j = 0; j < n; j++) {
        const xj = x[j]!;
        x[j] = xj + H;
        f(x, rp);
        x[j] = xj - H;
        f(x, rm);
        x[j] = xj;
        for (let i = 0; i < m; i++) J[i * n + j] = (rp[i]! - rm[i]!) / (2 * H);
      }
      return J;
    },
    solve(f, x, tol = 1e-12, maxIter = 40) {
      let lambda = LAMBDA_MIN;
      f(x, r);
      let cost = sumSq(r);
      for (let it = 0; it < maxIter; it++) {
        solver.residualMax = maxAbs(r);
        if (!(solver.residualMax >= tol)) return Number.isFinite(solver.residualMax) ? it : -1;
        solver.jacobian(f, x);
        // Damped step; on a rejected step raise lambda and retry from the same x.
        for (let attempt = 0; ; attempt++) {
          normalEquations(J, r, m, n, lambda, A, g);
          const ok = solveInPlace(A, g, n);
          if (ok) {
            for (let j = 0; j < n; j++) xTry[j] = x[j]! + g[j]!;
            f(xTry, rp);
            const c = sumSq(rp);
            if (c < cost) {
              x.set(xTry);
              r.set(rp);
              cost = c;
              lambda = Math.max(LAMBDA_MIN, lambda * 0.1);
              break;
            }
          }
          lambda *= 10;
          if (attempt >= 12) {
            solver.residualMax = maxAbs(r);
            return solver.residualMax < tol ? it : -1;
          }
        }
      }
      solver.residualMax = maxAbs(r);
      return solver.residualMax < tol ? maxIter : -1;
    },
  };
  return solver;
}
