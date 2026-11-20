/**
 * Brake disc (drilled friction ring + hat), wheel hub (flange + studs) and caliper (research 22 B6). All are built
 * around the +Y axis, centred on the friction ring's mid-plane, +Y = outboard (toward the hub face); the caller
 * rotates them onto the wheel axis. The caliper is centred on +X. Build time only.
 */
import { CylinderGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, Vector2, type BufferGeometry } from 'three';
import { mergeParts } from './tube';

export interface DiscSpec {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly thickness: number;
  /** Hat depth from the ring mid-plane to the hub face, outboard, m. */
  readonly hatDepth: number;
  /** Drilled holes per row; two staggered rows. */
  readonly holes: number;
  readonly holeRadius: number;
}

/** Ring (in the XZ plane) extruded along +Y from -t/2 to +t/2. */
function ring(shape: Shape, t: number, curveSegments: number): BufferGeometry {
  const g = new ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments });
  g.translate(0, 0, -t / 2);
  return g.rotateX(-Math.PI / 2);
}

export function brakeDiscGeometry(s: DiscSpec): BufferGeometry {
  const shape = new Shape();
  shape.absarc(0, 0, s.outerRadius, 0, Math.PI * 2, false);
  const hub = new Path();
  hub.absarc(0, 0, s.innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hub);
  const band = s.outerRadius - s.innerRadius;
  for (let row = 0; row < 2; row++) {
    const rr = s.innerRadius + band * (0.36 + 0.3 * row);
    for (let i = 0; i < s.holes; i++) {
      const a = ((i + row * 0.5) / s.holes) * Math.PI * 2;
      const h = new Path();
      h.absarc(Math.cos(a) * rr, Math.sin(a) * rr, s.holeRadius, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
  }
  const t = s.thickness;
  const wall = s.innerRadius - 0.002;
  const bore = s.innerRadius * 0.55;
  // Hat: a closed lathe profile (radius, axial) wound so the faces point out of the solid.
  const profile = [
    [wall, -t * 0.3],
    [wall, s.hatDepth],
    [bore, s.hatDepth],
    [bore, s.hatDepth - 0.007],
    [wall - 0.007, s.hatDepth - 0.007],
    [wall - 0.007, -t * 0.3],
    [wall, -t * 0.3],
  ].map(([x, y]) => new Vector2(x, y));
  const hat = new LatheGeometry(profile, 56);
  return mergeParts([ring(shape, t, 56), hat]);
}

/** Hub flange on the hub face (+Y at hatDepth) with five wheel studs. */
export function hubGeometry(hubFace: number, flangeRadius: number, studCircle: number): BufferGeometry {
  const parts: BufferGeometry[] = [
    new CylinderGeometry(flangeRadius, flangeRadius, 0.012, 32).translate(0, hubFace + 0.006, 0),
    new CylinderGeometry(flangeRadius * 0.55, flangeRadius * 0.6, 0.03, 24).translate(0, hubFace + 0.015, 0),
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(new CylinderGeometry(0.0062, 0.0062, 0.04, 10).translate(Math.cos(a) * studCircle, hubFace + 0.02, Math.sin(a) * studCircle));
  }
  return mergeParts(parts);
}

export interface CaliperSpec {
  /** Inner radius of the pad area and outer radius of the bridge, m. */
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** Half the angular span, rad. */
  readonly halfSpan: number;
  /** Total axial width, m. */
  readonly width: number;
  /** Disc (ring) thickness and outer radius: the caliper leaves a slot for them. */
  readonly discThickness: number;
  readonly discRadius: number;
}

function sector(r0: number, r1: number, half: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r1, -half, half, false);
  s.absarc(0, 0, r0, half, -half, true);
  s.closePath();
  return s;
}

function slab(shape: Shape, y0: number, y1: number): BufferGeometry {
  const bevel = Math.min(0.004, (y1 - y0) / 4);
  const g = new ExtrudeGeometry(shape, { depth: y1 - y0 - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, y0 + bevel);
  // Shape plane XY -> XZ, extrusion Z -> Y (keeps the sector centred on +X).
  return g.rotateX(-Math.PI / 2);
}

/** Fixed caliper: inboard and outboard halves beside the disc, bridged over the disc rim. */
export function caliperGeometry(s: CaliperSpec): BufferGeometry {
  const gap = 0.003;
  const half = s.width / 2;
  const t = s.discThickness / 2 + gap;
  const pads = sector(s.innerRadius, s.outerRadius, s.halfSpan);
  const bridge = sector(s.discRadius + gap, s.outerRadius, s.halfSpan * 0.92);
  return mergeParts([slab(pads, -half, -t), slab(pads, t, half), slab(bridge, -t - 0.002, t + 0.002)]);
}
