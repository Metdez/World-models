/**
 * Terrain height around the loop (ARCHITECTURE-M2 §8.1): the M1 `features/track/terrain.ts` groundHeight / farField
 * maths moved into sim-core with the same constants, using the deterministic kernels (so physics and the terrain
 * mesh agree; tests/sim-core/world-ground.test.ts compares the two to 1e-9). Pure, allocation-free.
 */
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import { dsin, dtan } from '../math/det';

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
