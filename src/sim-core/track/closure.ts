/**
 * Plan-view integration of line/arc/clothoid primitives into dense node arrays, and the 2-unknown closure solve
 * (research 11 §A.2). Heading psi(s) is exact per primitive (kappa is linear in s); position is integrated with
 * Simpson's rule per node step, which is accurate to ~1e-10 m per step at <= 0.25 m spacing.
 */
import type { TrackDefinition, TrackPrimitive, TrackSegmentDefinition } from '../../contracts/track';

/** Maximum node spacing along the centreline, m. */
export const NODE_DS = 0.25;

export interface PlanNodes {
  readonly length: number;
  /** Node arc length, position, heading (unwrapped), curvature and dkappa/ds of the step that starts at the node. */
  readonly s: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly psi: Float64Array;
  readonly k: Float64Array;
  readonly dk: Float64Array;
}

export function primitiveLength(p: TrackPrimitive): number {
  return p.kind === 'arc' ? Math.abs(p.radius * p.angle) : p.length;
}

function primitiveK0(p: TrackPrimitive): number {
  return p.kind === 'line' ? 0 : p.kind === 'arc' ? Math.sign(p.angle) / p.radius : p.k0;
}

function primitiveDk(p: TrackPrimitive): number {
  return p.kind === 'clothoid' && p.length > 0 ? (p.k1 - p.k0) / p.length : 0;
}

/** Heading change over a primitive (exact). */
export function primitiveTurn(p: TrackPrimitive): number {
  return p.kind === 'line' ? 0 : p.kind === 'arc' ? p.angle : (0.5 * (p.k0 + p.k1) * p.length);
}

/** Pose after advancing u metres from (x, y, psi) with curvature k and slope dk (Simpson). Writes into out. */
export function advancePose(x: number, y: number, psi: number, k: number, dk: number, u: number, out: { x: number; y: number; psi: number }): void {
  const pm = psi + 0.5 * k * u + 0.125 * dk * u * u;
  const p1 = psi + k * u + 0.5 * dk * u * u;
  out.x = x + (u / 6) * (Math.cos(psi) + 4 * Math.cos(pm) + Math.cos(p1));
  out.y = y + (u / 6) * (Math.sin(psi) + 4 * Math.sin(pm) + Math.sin(p1));
  out.psi = p1;
}

/** Integrates all segments' primitives from the origin, heading +X. */
export function integratePlan(segments: readonly TrackSegmentDefinition[]): PlanNodes {
  const s: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const psi: number[] = [];
  const k: number[] = [];
  const dk: number[] = [];
  const pose = { x: 0, y: 0, psi: 0 };
  let sAcc = 0;
  for (const seg of segments) {
    for (const p of seg.primitives) {
      const len = primitiveLength(p);
      if (len <= 0) continue;
      const n = Math.ceil(len / NODE_DS - 1e-9);
      const h = len / n;
      const k0 = primitiveK0(p);
      const d = primitiveDk(p);
      for (let i = 0; i < n; i++) {
        const ki = k0 + d * i * h;
        s.push(sAcc + i * h);
        x.push(pose.x);
        y.push(pose.y);
        psi.push(pose.psi);
        k.push(ki);
        dk.push(d);
        advancePose(pose.x, pose.y, pose.psi, ki, d, h, pose);
      }
      sAcc += len;
    }
  }
  // Closing node: its curvature continues the last step so sampling at the very end stays continuous.
  const last = k.length - 1;
  s.push(sAcc);
  x.push(pose.x);
  y.push(pose.y);
  psi.push(pose.psi);
  k.push(last >= 0 ? k[last]! + dk[last]! * (sAcc - s[last]!) : 0);
  dk.push(0);
  const f = (a: number[]): Float64Array => Float64Array.from(a);
  return { length: sAcc, s: f(s), x: f(x), y: f(y), psi: f(psi), k: f(k), dk: f(dk) };
}

function assertSingleLine(seg: TrackSegmentDefinition): void {
  const [p] = seg.primitives;
  if (seg.primitives.length !== 1 || p?.kind !== 'line') throw new Error(`closure segment "${seg.id}" must have exactly one line primitive`);
}

/**
 * Returns the segments with the two closure lines' lengths solved so the loop closes in position. End position is
 * linear in a straight's length (its heading does not depend on it), so a 2x2 solve is exact. Heading closure is
 * the author's job (net turn must be +-2 pi) and is checked here.
 */
export function solveClosure(def: TrackDefinition): TrackSegmentDefinition[] {
  const [idA, idB] = def.closure;
  const ia = def.segments.findIndex((seg) => seg.id === idA);
  const ib = def.segments.findIndex((seg) => seg.id === idB);
  if (ia < 0 || ib < 0 || ia === ib) throw new Error(`closure segments not found: ${idA}, ${idB}`);
  assertSingleLine(def.segments[ia]!);
  assertSingleLine(def.segments[ib]!);

  let turn = 0;
  for (const seg of def.segments) for (const p of seg.primitives) turn += primitiveTurn(p);
  if (Math.abs(Math.abs(turn) - 2 * Math.PI) > 1e-9) throw new Error(`net turn must be +-360 deg, got ${(turn * 180) / Math.PI}`);

  const zeroed = def.segments.map((seg, i) => (i === ia || i === ib ? { ...seg, primitives: [{ kind: 'line', length: 0 } as const] } : seg));
  const plan = integratePlan(zeroed);
  const n = plan.x.length - 1;
  const ex = plan.x[n]!;
  const ey = plan.y[n]!;
  // Heading at the start of each closure line = cumulative turn of everything before it.
  const headingBefore = (idx: number): number => {
    let h = 0;
    for (let i = 0; i < idx; i++) for (const p of def.segments[i]!.primitives) h += primitiveTurn(p);
    return h;
  };
  const ha = headingBefore(ia);
  const hb = headingBefore(ib);
  // La * (cos ha, sin ha) + Lb * (cos hb, sin hb) = -(ex, ey)
  const det = Math.cos(ha) * Math.sin(hb) - Math.sin(ha) * Math.cos(hb);
  if (Math.abs(det) < 1e-6) throw new Error('closure lines are parallel; pick two non-parallel straights');
  const la = (-ex * Math.sin(hb) + ey * Math.cos(hb)) / det;
  const lb = (-ey * Math.cos(ha) + ex * Math.sin(ha)) / det;
  if (!(la > 0 && lb > 0)) throw new Error(`closure solve gave non-positive lengths ${la}, ${lb}`);
  return def.segments.map((seg, i) => (i === ia || i === ib ? { ...seg, primitives: [{ kind: 'line', length: i === ia ? la : lb }] } : seg));
}
