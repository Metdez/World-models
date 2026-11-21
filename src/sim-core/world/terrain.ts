/**
 * Terrain height around the loop (ARCHITECTURE-M2 §8.1): the M1 `features/track/terrain.ts` groundHeight / farField
 * maths moved into sim-core with the same constants, using the deterministic kernels (so physics and the terrain
 * mesh agree; tests/sim-core/world-ground.test.ts compares the two to 1e-9). Pure, allocation-free.
 */
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import { dcos, dsin, dtan } from '../math/det';
import type { ProjectorCore } from './project';

/** Depth below the road plane where the ground is fully hidden by asphalt/kerb/apron, m. */
const HIDDEN = 0.3;
/** Depth below the runoff grass, m. */
const TUCK = 0.06;
const EDGE_DROP = 0.03;
/** Dip of the field away from the runoff edge (m) over DIP_DISTANCE (m); blend to the far field between BLEND_* (m). */
const DIP = 0.6;
const DIP_DISTANCE = 30;
const BLEND_NEAR = 20;
const BLEND_FAR = 220;
const FAR_LEVEL = -0.6;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Long-wave field undulation (sim x/y, m). */
export function farField(x: number, y: number): number {
  return FAR_LEVEL + 1.4 * dsin(x / 173 + 0.7) * dsin(y / 231 - 0.4) + 0.5 * dsin((x - 0.6 * y) / 97);
}

/** Terrain height at world (x, y) whose nearest loop centreline point is (s, signed l). */
export function loopTerrainHeight(track: BuiltTrack, x: number, y: number, s: number, l: number, scratch: TrackSample): number {
  const outer = track.def.width / 2 + track.def.kerbWidth + track.def.runoff;
  const e = Math.abs(l) - outer;
  if (e > BLEND_FAR) return farField(x, y);
  if (e < -6) {
    track.sample(s, scratch);
    return scratch.z + l * dtan(scratch.bank) - HIDDEN;
  }
  if (e < 0) return track.roadHeight(s, l) - TUCK;
  const edge = track.roadHeight(s, Math.sign(l) * outer) - EDGE_DROP - DIP * smoothstep(0, DIP_DISTANCE, e);
  const t = smoothstep(BLEND_NEAR, BLEND_FAR, e);
  return edge + (farField(x, y) - edge) * t;
}

/** Width of the left/right edge blend of a node seen almost along its tangent, m (side of the centreline). */
const SIDE_BLEND = 2;

/**
 * Off-ribbon terrain as a continuous function of (x, y) (09-04). The M1 terrain takes the edge height of the NEAREST
 * centreline point, so it steps (up to 3.5 m on the proving loop) where two loop sections at different heights compete
 * and the nearest one changes. Here every centreline node i within `reach` of the nearest contributes the same M1
 * profile (its ribbon-edge height on the point's side, the 30 m dip, the blend to the far field, all on the distance
 * d_i from the node) with the weight 1/e_i^2 - 1/(e_0 + reach)^2, e = d - `from`: the nearest section dominates near
 * its own edge (e -> 0; inverse-distance weights summed over a section's nodes would let the other section bleed into
 * the ribbon edge), sections farther than `reach` beyond the nearest weigh nothing, and the weights are continuous, so
 * is the height. Between two sections at different heights the ground is a smooth embankment across the gap. With one section in reach it is the M1 profile averaged over a few metres of edge.
 * Returns NaN when the point is within `from` of the centreline (the caller keeps the M1 terrain under the ribbon).
 */
export function createBlendedTerrain(track: BuiltTrack, core: ProjectorCore, from: number, reach: number) {
  const outer = track.def.width / 2 + track.def.kerbWidth + track.def.runoff;
  const { x: nx, y: ny, step } = core.nodes;
  const n = nx.length;
  const edgeL = new Float64Array(n);
  const edgeR = new Float64Array(n);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  for (let i = 0; i < n; i++) {
    edgeL[i] = track.roadHeight(i * step, outer) - EDGE_DROP;
    edgeR[i] = track.roadHeight(i * step, -outer) - EDGE_DROP;
    track.sample(i * step, ts);
    hx[i] = -dsin(ts.heading); // left normal
    hy[i] = dcos(ts.heading);
  }
  const range = new Int32Array(2);
  const runs = core.runs;
  return function blended(x: number, y: number, nearest: number): number {
    const e0 = nearest - from;
    if (!(e0 > 0)) return NaN;
    const cut = e0 + reach;
    const far = 1 / (cut * cut);
    core.cellRuns(x, y, range);
    let sw = 0;
    let sh = 0;
    let ff = NaN;
    for (let k = range[0]!; k < range[1]!; k += 2) {
      const a = runs[k]!;
      const end = a + runs[k + 1]!;
      for (let i = a; i < end; i++) {
        const dx = x - nx[i]!;
        const dy = y - ny[i]!;
        const d = Math.sqrt(dx * dx + dy * dy);
        const e = d - from;
        if (!(e < cut)) continue;
        const w = 1 / (e * e) - far;
        const side = smoothstep(-SIDE_BLEND, SIDE_BLEND, dx * hx[i]! + dy * hy[i]!);
        const edge = edgeR[i]! + (edgeL[i]! - edgeR[i]!) * side;
        const eo = d - outer;
        let t = edge - DIP * smoothstep(0, DIP_DISTANCE, eo);
        const b = smoothstep(BLEND_NEAR, BLEND_FAR, eo);
        if (b > 0) {
          if (ff !== ff) ff = farField(x, y);
          t += (ff - t) * b;
        }
        sw += w;
        sh += w * t;
      }
    }
    return sw > 0 ? sh / sw : farField(x, y);
  };
}
