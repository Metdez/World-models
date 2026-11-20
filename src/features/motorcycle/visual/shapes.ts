/**
 * Procedural shape kit for the cafe racer: lofted surfaces (tank, seat, hump), lathed parts (tyres, rims, hubs,
 * headlight bucket), bent tubes (frame, exhausts) and finned cylinder stacks. Build time only.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Path,
  Shape,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakedTube, mergeParts } from '../../../kit3d/tube';
import { motoPaint, motoPaintGroups, type MotoFinish } from './palette';

/** Smooth interpolation through (s, value) knots (Catmull-Rom with clamped ends). */
export function curve(knots: readonly (readonly [number, number])[]): (s: number) => number {
  return (s: number) => {
    const n = knots.length;
    if (s <= knots[0]![0]) return knots[0]![1];
    if (s >= knots[n - 1]![0]) return knots[n - 1]![1];
    let i = 0;
    while (i < n - 2 && s > knots[i + 1]![0]) i++;
    const [s0, v0] = knots[i]!;
    const [s1, v1] = knots[i + 1]!;
    const prev = knots[i - 1] ?? knots[i]!;
    const next = knots[i + 2] ?? knots[i + 1]!;
    const m0 = (v1 - prev[1]) / Math.max(1e-9, s1 - prev[0]);
    const m1 = (next[1] - v0) / Math.max(1e-9, next[0] - s0);
    const h = s1 - s0;
    const t = (s - s0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m1;
  };
}

/**
 * Closed loft: rows along s in [0, 1], `cols` around t in [0, 2pi) (wrapping). `fn` writes the surface point.
 * Indexed, smooth normals. Rings that collapse to a point close the ends.
 */
export function loft(rows: number, cols: number, fn: (s: number, t: number, out: Vector3) => void): BufferGeometry {
  const pos = new Float32Array((rows + 1) * cols * 3);
  const p = new Vector3();
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j < cols; j++) {
      fn(i / rows, (j / cols) * Math.PI * 2, p);
      pos.set([p.x, p.y, p.z], (i * cols + j) * 3);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * cols + j;
      const b = i * cols + ((j + 1) % cols);
      const c = a + cols;
      const d = b + cols;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Superellipse coordinate: sign(c) |c|^(2/n). */
export function se(c: number, n: number): number {
  return Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
}

/** Quarter-ellipse end rounding: 0 at the end, 1 beyond `span` from it. */
export function endRound(d: number, span: number): number {
  const u = Math.min(1, Math.max(0, d / span));
  return Math.sqrt(1 - (1 - u) * (1 - u));
}

/** Flips a geometry's winding if its normals point inward (checked against the centroid). */
export function outward(g: BufferGeometry): BufferGeometry {
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new Vector3());
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  let score = 0;
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i += 7) {
    p.fromBufferAttribute(pos, i).sub(c);
    n.fromBufferAttribute(nor, i);
    score += p.dot(n);
  }
  if (score >= 0) return g;
  const index = g.index;
  if (index) {
    for (let k = 0; k < index.count; k += 3) {
      const b = index.getX(k + 1);
      index.setX(k + 1, index.getX(k + 2));
      index.setX(k + 2, b);
    }
  }
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return g;
}

/** Bent tube through points (centripetal Catmull-Rom). */
export function bentTube(points: readonly Vector3[], radius: number, segments = 48, radial = 12): BufferGeometry {
  return new TubeGeometry(new CatmullRomCurve3([...points], false, 'centripetal'), segments, radius, radial, false);
}

/** Tapered bent tube (e.g. a megaphone silencer): TubeGeometry with the radius scaled along the path. */
export function taperedTube(points: readonly Vector3[], r0: number, r1: number, segments = 32, radial = 16): BufferGeometry {
  const curveObj = new CatmullRomCurve3([...points], false, 'centripetal');
  const g = new TubeGeometry(curveObj, segments, 1, radial, false);
  const pos = g.getAttribute('position');
  const c = new Vector3();
  const p = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curveObj.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe around +Y of an (r, h) profile; creased normals at sharp corners. */
export function lathe(profile: readonly (readonly [number, number])[], segments = 48, crease = 0.6, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  const g = new LatheGeometry(
    profile.map(([r, h]) => new Vector2(r, h)),
    segments,
    phiStart,
    phiLength,
  );
  return crease > 0 ? toCreasedNormals(g, crease) : g;
}

/** Rotates a geometry built around +Y so that axis becomes +Z (wheels, discs: three Z is the axle). */
export function yToZ(g: BufferGeometry): BufferGeometry {
  return g.rotateX(Math.PI / 2);
}

/**
 * Outline of a parallel twin's finned block seen along the bores: two round barrels side by side (along x, width w,
 * barrel diameter d) joined by a filleted waist. Polar samples of a smooth union of the two circles.
 */
export function twinBarrel(w: number, d: number, samples = 56): Shape {
  const r = d / 2;
  const c = Math.max(0, w / 2 - r);
  const k = r * 0.55;
  // Polynomial smooth minimum of the two circle distances (negative inside).
  const sdf = (x: number, y: number) => {
    const a = Math.hypot(x - c, y) - r;
    const b = Math.hypot(x + c, y) - r;
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const pts: Vector2[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let lo = 0;
    let hi = w;
    for (let j = 0; j < 24; j++) {
      const m = (lo + hi) / 2;
      if (sdf(dx * m, dy * m) < 0) lo = m;
      else hi = m;
    }
    pts.push(new Vector2(dx * lo, dy * lo));
  }
  return new Shape(pts);
}

/** Rounded rectangle / stadium shape centred on the origin. */
export function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - rr);
  s.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x + rr, y + h);
  s.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + rr);
  s.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Convex polygon with corners rounded by radius r (quadratic corners). */
export function roundedPoly(points: readonly (readonly [number, number])[], r: number): Shape {
  const s = new Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = points[i]!;
    const [ax, ay] = points[(i + n - 1) % n]!;
    const [bx, by] = points[(i + 1) % n]!;
    const la = Math.hypot(ax - px, ay - py);
    const lb = Math.hypot(bx - px, by - py);
    const ra = Math.min(r, la / 2) / la;
    const rb = Math.min(r, lb / 2) / lb;
    const x0 = px + (ax - px) * ra;
    const y0 = py + (ay - py) * ra;
    if (i === 0) s.moveTo(x0, y0);
    else s.lineTo(x0, y0);
    s.quadraticCurveTo(px, py, px + (bx - px) * rb, py + (by - py) * rb);
  }
  s.closePath();
  return s;
}

/** Ellipse shape. */
export function ellipse(rx: number, ry: number): Shape {
  const s = new Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  return s;
}

/**
 * Extrudes a shape (in its XY plane) symmetrically along Z by `depth`, bevelled; then maps the result with
 * `matrix`. Caps and sides may take different finishes.
 */
export function slab(shape: Shape, depth: number, bevel: number, matrix: Matrix4, caps: MotoFinish, sides: MotoFinish = caps, curveSegments = 12): BufferGeometry {
  const core = Math.max(1e-4, depth - 2 * bevel);
  const g = new ExtrudeGeometry(shape, { depth: core, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments });
  g.translate(0, 0, -core / 2);
  motoPaintGroups(g, caps, sides);
  return g.applyMatrix4(matrix);
}

/** Basis matrix with local X along `x`, local Z along `z` (orthogonalised), at `origin`. */
export function basis(origin: Vector3, x: Vector3, z: Vector3): Matrix4 {
  const ex = x.clone().normalize();
  const ey = new Vector3().crossVectors(z, ex).normalize();
  const ez = new Vector3().crossVectors(ex, ey);
  return new Matrix4().makeBasis(ex, ey, ez).setPosition(origin);
}

/** Painted helper for kit3d tubes. */
export function rod(a: Vector3, b: Vector3, r: number, finish: MotoFinish, rb = r, radial = 14): BufferGeometry {
  return motoPaint(bakedTube(a, b, r, rb, radial), finish);
}

export interface FinSpec {
  /** Stadium footprint (x depth, z width), m. */
  readonly depth: number;
  readonly width: number;
  readonly thickness: number;
}

/**
 * Stack of cooling fins along the local +Y axis from y0 to y1 (count fins), each a stadium plate whose outline
 * shrinks by `taper` per unit height; caps in `face`, machined edges in `edge`. Plus the core block inside.
 */
export function finStack(
  count: number,
  y0: number,
  y1: number,
  fin: FinSpec,
  core: { depth: number; width: number },
  taper: number,
  face: MotoFinish,
  edge: MotoFinish,
  outline: (w: number, d: number) => Shape = (w, d) => roundedRect(w, d, d / 2.2),
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const y = y0 + ((y1 - y0) * (i + 0.5)) / count;
    const k = 1 - taper * (y - y0);
    const s = outline(fin.width * k, fin.depth * k);
    const g = new ExtrudeGeometry(s, { depth: fin.thickness, bevelEnabled: false, curveSegments: 6 });
    motoPaintGroups(g, face, edge);
    // Shape plane XY (x = width -> three z, y = depth -> three x); extrusion -> three y.
    g.applyMatrix4(new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)));
    g.translate(0, y - fin.thickness / 2, 0);
    parts.push(g);
  }
  const c = new ExtrudeGeometry(outline(core.width, core.depth), { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 });
  motoPaint(c, face);
  c.applyMatrix4(new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)));
  c.translate(0, y0, 0);
  parts.push(c);
  return mergeParts(parts);
}

// ------------------------------------------------------------------------------------------------- wheels

export interface WheelSpec {
  /** Tyre outer radius and section width, m. */
  readonly radius: number;
  readonly width: number;
  /** Tyre crown radius (cross-section), m. */
  readonly crown: number;
  /** Rim bead-seat radius and rim width, m. */
  readonly rimRadius: number;
  readonly rimWidth: number;
  /** Hub flange half-spacing and radius, m. */
  readonly hubHalf: number;
  readonly hubRadius: number;
  readonly spokes: number;
  /** Optional sprocket: axial offset (three z) and pitch radius. */
  readonly sprocket?: { readonly z: number; readonly radius: number };
}

/** Motorcycle tyre: round crown (tread finish) and sidewalls down to the bead, around +Y. */
function tyreProfile(s: WheelSpec): { crown: [number, number][]; walls: [number, number][][] } {
  const w = s.width / 2;
  const rc = Math.max(s.crown, w * 0.9);
  const alpha = Math.asin(Math.min(0.97, (w * 0.92) / rc));
  const cr = s.radius - rc;
  const crown: [number, number][] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = -alpha + (2 * alpha * i) / n;
    crown.push([cr + rc * Math.cos(a), rc * Math.sin(a)]);
  }
  const bead = s.rimRadius + 0.004;
  const wr = s.rimWidth / 2 + 0.002;
  const walls: [number, number][][] = [];
  for (const side of [-1, 1]) {
    const shoulder = crown[side < 0 ? 0 : n]!;
    const ctrl: [number, number] = [bead + (shoulder[0] - bead) * 0.62, side * w * 1.02];
    const wall: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const u = 1 - t;
      // Quadratic Bezier from the bead up to the shoulder.
      wall.push([u * u * bead + 2 * u * t * ctrl[0] + t * t * shoulder[0], u * u * side * wr + 2 * u * t * ctrl[1] + t * t * shoulder[1]]);
    }
    walls.push(side < 0 ? wall : wall.reverse());
  }
  return { crown, walls };
}

/**
 * Spoked wheel around three +Z (the axle): tyre, polished rim, alloy hub with flanges, cross-laced spokes with
 * nipples and an optional rear sprocket. One painted geometry (one draw).
 */
export function spokedWheel(s: WheelSpec): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const { crown, walls } = tyreProfile(s);
  parts.push(motoPaint(lathe(crown, 60, 0), 'tread'));
  parts.push(motoPaint(lathe(walls[0]!, 60, 0), 'sidewall'), motoPaint(lathe(walls[1]!, 60, 0), 'sidewall'));
  // Tread grooves: shallow dark rings would vanish; instead a slightly darker centre band via a thin ring.
  const R = s.rimRadius;
  const wr = s.rimWidth / 2;
  const rim: [number, number][] = [
    [R + 0.012, -wr - 0.005],
    [R + 0.013, -wr + 0.001],
    [R + 0.002, -wr + 0.005],
    [R + 0.001, wr - 0.005],
    [R + 0.013, wr - 0.001],
    [R + 0.012, wr + 0.005],
    [R - 0.004, wr + 0.006],
    [R - 0.016, wr * 0.45],
    [R - 0.019, 0],
    [R - 0.016, -wr * 0.45],
    [R - 0.004, -wr - 0.006],
    [R + 0.012, -wr - 0.005],
  ];
  parts.push(motoPaint(lathe(rim, 60, 0.5), 'polished'));
  const h = s.hubHalf;
  const hr = s.hubRadius;
  const hub: [number, number][] = [
    [0.012, -h - 0.03],
    [0.03, -h - 0.03],
    [0.034, -h - 0.012],
    [hr * 0.7, -h - 0.006],
    [hr, -h - 0.004],
    [hr, -h + 0.004],
    [hr * 0.62, -h + 0.008],
    [hr * 0.55, 0],
    [hr * 0.62, h - 0.008],
    [hr, h - 0.004],
    [hr, h + 0.004],
    [hr * 0.7, h + 0.006],
    [0.034, h + 0.012],
    [0.03, h + 0.03],
    [0.012, h + 0.03],
  ];
  parts.push(motoPaint(lathe(hub, 40, 0.5), 'polished'));
  // Cross-laced spokes: half on each flange, alternating leading/trailing.
  const half = s.spokes / 2;
  const nippleR = R - 0.017;
  const rimAt = new Vector3();
  const hubAt = new Vector3();
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < half; k++) {
      const a = ((k + (side > 0 ? 0.5 : 0)) / half) * Math.PI * 2;
      const lead = k % 2 === 0 ? 1 : -1;
      const ar = a + lead * ((2 * Math.PI) / half) * 1.5;
      hubAt.set(Math.cos(a) * (hr - 0.004), Math.sin(a) * (hr - 0.004), side * h);
      rimAt.set(Math.cos(ar) * nippleR, Math.sin(ar) * nippleR, side * 0.006);
      parts.push(motoPaint(bakedTube(hubAt, rimAt, 0.0026, 0.0026, 6), 'spoke'));
      const dir = new Vector3().subVectors(rimAt, hubAt).normalize();
      parts.push(motoPaint(bakedTube(rimAt.clone().addScaledVector(dir, -0.014), rimAt.clone().addScaledVector(dir, 0.002), 0.0032, 0.0032, 6), 'steel'));
    }
  }
  if (s.sprocket) {
    // Sprocket carrier from the hub flange out to the chain line, then the sprocket itself.
    const z = s.sprocket.z;
    const z0 = Math.sign(z) * (h + 0.01);
    const carrier: [number, number][] = [
      [0.034, z0],
      [0.075, z0],
      [0.075, z - Math.sign(z) * 0.004],
      [0.034, z - Math.sign(z) * 0.004],
      [0.034, z0],
    ];
    parts.push(motoPaint(lathe(Math.sign(z) < 0 ? carrier : [...carrier].reverse(), 32, 0.5), 'alloy'), sprocketGeometry(s.sprocket.radius, z));
  }
  return yToZ(mergeParts(parts));
}

/** Toothed sprocket around +Y at axial offset `h` (rotate with `yToZ` for a wheel). */
export function sprocketGeometry(pitchRadius: number, h: number, thickness = 0.006): BufferGeometry {
  const teeth = Math.max(12, Math.round((2 * Math.PI * pitchRadius) / 0.01588));
  const s = new Shape();
  const ro = pitchRadius + 0.006;
  const ri = pitchRadius - 0.005;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const r = i % 4 === 1 || i % 4 === 2 ? ro : ri;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const bore = new Path();
  bore.absarc(0, 0, Math.min(0.03, pitchRadius * 0.4), 0, Math.PI * 2, true);
  s.holes.push(bore);
  if (pitchRadius > 0.07) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const hp = new Path();
      hp.absarc(Math.cos(a) * pitchRadius * 0.6, Math.sin(a) * pitchRadius * 0.6, pitchRadius * 0.17, 0, Math.PI * 2, true);
      s.holes.push(hp);
    }
  }
  const g = new ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -thickness / 2);
  motoPaintGroups(g, 'alloy', 'steel');
  // Shape plane XY with extrusion Z -> plane XZ with extrusion along Y at height h.
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g.toNonIndexed();
}
