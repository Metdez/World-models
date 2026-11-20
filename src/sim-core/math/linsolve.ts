/**
 * Dense linear algebra for small systems (3x3 .. 6x6 Newton / Levenberg-Marquardt steps).
 * Row-major Float64Arrays; everything in place, no allocation.
 */

/**
 * Solves A x = b by Gaussian elimination with partial pivoting. A (n*n, row-major) is destroyed;
 * b is overwritten with x. Returns false if A is singular to working precision (b then undefined).
 */
export function solveInPlace(A: Float64Array, b: Float64Array, n: number): boolean {
  let maxAbs = 0;
  for (let i = 0; i < n * n; i++) maxAbs = Math.max(maxAbs, Math.abs(A[i]!));
  const tiny = maxAbs * n * Number.EPSILON;
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(A[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]!);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (!(best > tiny)) return false;
    if (p !== k) {
      for (let j = k; j < n; j++) {
        const t = A[k * n + j]!;
        A[k * n + j] = A[p * n + j]!;
        A[p * n + j] = t;
      }
      const t = b[k]!;
      b[k] = b[p]!;
      b[p] = t;
    }
    const pivot = A[k * n + k]!;
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k]! / pivot;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) A[i * n + j]! -= f * A[k * n + j]!;
      b[i]! -= f * b[k]!;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= A[i * n + j]! * b[j]!;
    b[i] = s / A[i * n + i]!;
  }
  return true;
}

/**
 * Levenberg-Marquardt normal equations for residuals r (m) and Jacobian J (m x n, row-major):
 *   A = J^T J + lambda * I   (n x n),   g = -J^T r   (n).
 * Then `solveInPlace(A, g, n)` gives the step dx in g.
 */
export function normalEquations(J: Float64Array, r: Float64Array, m: number, n: number, lambda: number, A: Float64Array, g: Float64Array): void {
  for (let i = 0; i < n; i++) {
    let gi = 0;
    for (let k = 0; k < m; k++) gi -= J[k * n + i]! * r[k]!;
    g[i] = gi;
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k * n + i]! * J[k * n + j]!;
      if (i === j) s += lambda;
      A[i * n + j] = s;
      A[j * n + i] = s;
    }
  }
}
