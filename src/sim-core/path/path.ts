/** Driving line: lateral offset knots cosine-interpolated along a section (contracts/track.ts `line`). */
import { cosineBlend } from '../math/interp';

/** Offset (m, + left) at section-local x; 0 before the first and after the last knot. */
export function knotOffset(knots: readonly (readonly [number, number])[] | undefined, x: number): number {
  if (!knots || knots.length === 0) return 0;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (x < first[0] || x > last[0]) return 0;
  for (let i = 1; i < knots.length; i++) {
    const b = knots[i]!;
    if (x <= b[0]) {
      const a = knots[i - 1]!;
      return b[0] > a[0] ? cosineBlend(a[1], b[1], (x - a[0]) / (b[0] - a[0])) : b[1];
    }
  }
  return last[1];
}
