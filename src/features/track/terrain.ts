/**
 * Ground out to the fogged horizon (research 11 §A.5): one indexed grid, 4 m cells around the track growing
 * geometrically to HORIZON. Under the ribbon it hides below the road; at the runoff edge it meets the ribbon's
 * grass a few cm below (same world-space grass material, so the joint does not show) and then dips away into
 * gentle long-wave undulation.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { BuiltTrack, TrackSample } from '../../contracts/track';

const CELL = 4;
const GROWTH = 1.25;
/** Half-size of the ground from the track's bounding box, m (fog is opaque by about 700 m). */
const HORIZON = 4500;
/** Fine-cell margin around the track's bounding box, m. */
const FINE_MARGIN = 40;
/** Centreline sample step for the nearest-point search, m. */
const SEARCH_STEP = 2;
/** Depth below the road plane where the ground is fully hidden by asphalt/kerb/apron, m. */
const HIDDEN = 0.3;
/** Depth below the runoff grass, m (grass on grass: a small overlap is invisible). */
const TUCK = 0.06;
const EDGE_DROP = 0.03;
/** Dip of the field away from the runoff edge (m) over DIP_DISTANCE (m); blend to the far field over BLEND (m). */
const DIP = 0.6;
const DIP_DISTANCE = 30;
const BLEND: readonly [number, number] = [20, 220];
const FAR_LEVEL = -0.6;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Long-wave field undulation (sim x/y, m). */
const farField = (x: number, y: number): number => FAR_LEVEL + 1.4 * Math.sin(x / 173 + 0.7) * Math.sin(y / 231 - 0.4) + 0.5 * Math.sin((x - 0.6 * y) / 97);

/** Axis coordinates: CELL steps over [lo, hi], then geometrically growing steps out to HORIZON. */
function axis(lo: number, hi: number): number[] {
  const n = Math.ceil((hi - lo) / CELL);
  const inner = Array.from({ length: n + 1 }, (_, i) => lo + i * CELL);
  const outer: number[] = [];
  for (let step = CELL * GROWTH, d = step; d < HORIZON; step *= GROWTH, d += step) outer.push(d);
  outer.push(HORIZON);
  return [...outer.map((d) => lo - d).reverse(), ...inner, ...outer.map((d) => inner[inner.length - 1]! + d)];
}

/** Ground height at sim (x, y): `sNear`/`lNear` give the nearest centreline point (s, signed l). */
export function groundHeight(track: BuiltTrack, x: number, y: number, s: number, l: number, sample: TrackSample): number {
  const outer = track.def.width / 2 + track.def.kerbWidth + track.def.runoff;
  const e = Math.abs(l) - outer;
  if (e > BLEND[1]) return farField(x, y);
  if (e < -6) {
    track.sample(s, sample);
    return sample.z + l * Math.tan(sample.bank) - HIDDEN;
  }
  if (e < 0) return track.roadHeight(s, l) - TUCK;
  const edge = track.roadHeight(s, Math.sign(l) * outer) - EDGE_DROP - DIP * smoothstep(0, DIP_DISTANCE, e);
  const t = smoothstep(BLEND[0], BLEND[1], e);
  return edge + (farField(x, y) - edge) * t;
}

export function buildTerrain(track: BuiltTrack): BufferGeometry {
  const L = track.length;
  const n = Math.ceil(L / SEARCH_STEP);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const ch = new Float64Array(n);
  const sample: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    track.sample((i * L) / n, sample);
    cx[i] = sample.x;
    cy[i] = sample.y;
    ch[i] = sample.heading;
    minX = Math.min(minX, sample.x);
    maxX = Math.max(maxX, sample.x);
    minY = Math.min(minY, sample.y);
    maxY = Math.max(maxY, sample.y);
  }
  const reach = track.def.width / 2 + track.def.kerbWidth + track.def.runoff + BLEND[1];
  const xs = axis(minX - FINE_MARGIN, maxX + FINE_MARGIN);
  const ys = axis(minY - FINE_MARGIN, maxY + FINE_MARGIN);

  const position = new Float32Array(xs.length * ys.length * 3);
  let v = 0;
  for (const y of ys) {
    for (const x of xs) {
      let z: number;
      if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) z = farField(x, y);
      else {
        // Nearest centreline sample (brute force: ~800 samples), then project onto its tangent for s and l.
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
          const dx = x - cx[i]!;
          const dy = y - cy[i]!;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const h = ch[best]!;
        const s = (best * L) / n + (x - cx[best]!) * Math.cos(h) + (y - cy[best]!) * Math.sin(h);
        track.sample(s, sample);
        const l = -(x - sample.x) * Math.sin(sample.heading) + (y - sample.y) * Math.cos(sample.heading);
        z = groundHeight(track, x, y, s, l, sample);
      }
      position[v++] = x;
      position[v++] = z;
      position[v++] = -y;
    }
  }
  const w = xs.length;
  const index: number[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < w; i++) {
      const a = j * w + i;
      // Rows go +y (three -z), columns +x: (a, a+1, a+w) is counter-clockwise seen from above.
      index.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
