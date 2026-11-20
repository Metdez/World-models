/** Frame-rate-independent smoothing (research 13 §A2). `lambda` is a decay rate in 1/s (half-life = ln 2 / lambda). */

export const damp = (x: number, target: number, lambda: number, dt: number): number => x + (target - x) * (1 - Math.exp(-lambda * dt));

/** Wraps an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  return w === -Math.PI ? Math.PI : w;
}

/** damp() along the shortest arc between two angles (rad). */
export const dampAngle = (a: number, target: number, lambda: number, dt: number): number => a + wrapAngle(target - a) * (1 - Math.exp(-lambda * dt));

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Ken Perlin's smootherstep on [0, 1]: zero velocity and acceleration at both ends. */
export function smootherstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
