/**
 * Painted markings of the annex as one vertex-coloured decal mesh (one draw call): the steering circle, slalom cone
 * spots, ISO 3888-2 lane edges and gates, braking-lane lines with the brake bar, ride-street edge lines with yellow
 * bars before and after each module and a ring round the pothole, link-road edge and centre lines. Strips follow the
 * GroundWorld (`world.sample`) every 0.5 m, lifted MARK_LIFT above it with a polygon offset. Geometry instead of the
 * track's per-pixel shader loop: exact on any surface and cheap under a software renderer.
 * 11-05 (reads as a facility from above): painted edge lines on every paved edge that meets grass, a low concrete kerb
 * and a gravel margin outside it, sealed construction joints on the large slabs, radius rings and spokes on the steering
 * pad, wider braking-lane lines with a chevron at each lane's start.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { GroundHit, GroundWorld, WorldDefinition } from '../../contracts/world';
import type { CompiledZone } from '../../sim-core/world/zones';

/** Paint lift above the drawn surface (covers the zone mesh's interpolation between its vertices), m. */
export const MARK_LIFT = 0.008;
const MAX_STEP = 0.5;
const WHITE = [0.78, 0.78, 0.76] as const;
const YELLOW = [0.8, 0.54, 0.07] as const;
/** Faint paint (radius rings), a sealed joint, the kerb's concrete and the gravel margin (two tones). */
const FAINT = [0.42, 0.42, 0.41] as const;
const JOINT = [0.07, 0.07, 0.075] as const;
const KERB = [0.62, 0.61, 0.58] as const;
const GRAVEL = [0.21, 0.2, 0.17] as const;
const GRAVEL_DARK = [0.16, 0.15, 0.13] as const;
/** Edge line inset from a paved edge; kerb and gravel margin widths outside it, m. */
const EDGE_INSET = 0.35;
const KERB_W = 0.3;
const KERB_LIFT = 0.04;
const GRAVEL_W = 2.4;
/** Construction joints on slabs larger than this (m^2), spaced so, m. */
const JOINT_AREA = 8000;
const JOINT_STEP = 25;
type Rgb = readonly [number, number, number];
type Pt = readonly [x: number, y: number];

interface Strip {
  readonly points: readonly Pt[];
  readonly width: number;
  readonly colour: Rgb;
  /** Resampling step along the strip (default MAX_STEP), m: flat runs need fewer points. */
  readonly step?: number;
  /** Lift above the ground (default MARK_LIFT), m. */
  readonly lift?: number;
}

/** Cuts a polyline into dashes (dash, gap metres along it). */
function dashed(points: readonly Pt[], dash: number, gap: number, width: number, colour: Rgb): Strip[] {
  const out: Strip[] = [];
  let cur: Pt[] = [];
  let phase = 0; // distance into the current dash+gap period
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    let t = 0;
    while (t < len) {
      const inDash = phase < dash;
      const next = Math.min(len, t + (inDash ? dash - phase : dash + gap - phase));
      const at = (d: number): Pt => [x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len];
      if (inDash) {
        if (cur.length === 0) cur.push(at(t));
        cur.push(at(next));
      }
      phase += next - t;
      t = next;
      if (phase >= dash && cur.length) {
        out.push({ points: cur, width, colour });
        cur = [];
      }
      if (phase >= dash + gap - 1e-9) phase = 0;
    }
  }
  if (cur.length > 1) out.push({ points: cur, width, colour });
  return out;
}

const circle = (cx: number, cy: number, r: number, from = 0, to = 2 * Math.PI, step = MAX_STEP): Pt[] => {
  const n = Math.max(8, Math.ceil((Math.abs(to - from) * r) / step));
  return Array.from({ length: n + 1 }, (_, i): Pt => {
    const a = from + ((to - from) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
};
const line = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y1],
];

/** A polyline along a zone at constant w from u0 to u1 (zone-local), sampled every metre. */
function along(zone: CompiledZone, w: number, u0: number, u1: number, step = 1): Pt[] {
  const p = { x: 0, y: 0 };
  const n = Math.max(1, Math.ceil(Math.abs(u1 - u0) / step));
  return Array.from({ length: n + 1 }, (_, i): Pt => {
    zone.toWorld(u0 + ((u1 - u0) * i) / n, w, p);
    return [p.x, p.y];
  });
}
/** A bar across a zone at u from w0 to w1. */
function across(zone: CompiledZone, u: number, w0: number, w1: number): Pt[] {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  zone.toWorld(u, w0, a);
  zone.toWorld(u, w1, b);
  return line(a.x, a.y, b.x, b.y);
}

/**
 * Runs of a rect zone's outline whose outside (`out` m beyond the edge) is grass, as zone-local (u, w) intervals: the
 * paved edges that meet the field, not the joins to another zone or the loop.
 */
export function grassEdges(zone: CompiledZone, world: GroundWorld, out = 1): { readonly side: 'u' | 'w'; readonly at: number; readonly from: number; readonly to: number }[] {
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const p = { x: 0, y: 0 };
  const res: { side: 'u' | 'w'; at: number; from: number; to: number }[] = [];
  const L = zone.length;
  const W = zone.halfWidth;
  const sides: [side: 'u' | 'w', at: number, outAt: number, span: number][] = [
    ['w', W, W + out, L],
    ['w', -W, -W - out, L],
    ['u', 0, -out, 2 * W],
    ['u', L, L + out, 2 * W],
  ];
  for (const [side, at, outAt, span] of sides) {
    const n = Math.max(1, Math.round(span));
    let start = Number.NaN;
    for (let i = 0; i <= n; i++) {
      const t = (span * i) / n;
      const a = side === 'w' ? t : t - W; // along: u for the long sides, w for the ends
      if (side === 'w') zone.toWorld(a, outAt, p);
      else zone.toWorld(outAt, a, p);
      const grass = i < n && world.sample(p.x, p.y, NaN, hit).surface === 'grass';
      if (grass && start !== start) start = a;
      if (!grass && start === start) {
        res.push({ side, at, from: start, to: a });
        start = Number.NaN;
      }
    }
  }
  return res;
}

/** Every marking of the proving ground (world (x, y) polylines). `world` enables the edge treatment (lines, kerb and
 *  gravel margin where the paving meets grass). */
export function annexMarkings(def: WorldDefinition, zones: readonly CompiledZone[], world?: GroundWorld): Strip[] {
  const strips: Strip[] = [];
  const solid = (points: Pt[], width: number, colour: Rgb = WHITE) => strips.push({ points, width, colour });

  // Paved edges meeting grass: an edge line inside, a low kerb and a mottled gravel margin outside (2 m resampling:
  // the field is flat there).
  for (const z of world ? zones : []) {
    if (z.def.shape.kind !== 'rect') continue;
    for (const e of grassEdges(z, world!)) {
      const sign = e.at > 0 ? 1 : -1;
      const run = (off: number): Pt[] => {
        const w = e.at + sign * off;
        return e.side === 'w' ? along(z, w, e.from, e.to, 4) : across(z, w, e.from, e.to);
      };
      // the ride street has its own edge lines; the field is flat along these edges: 2 m resampling
      if (!z.def.features?.length) strips.push({ points: run(-EDGE_INSET), width: 0.15, colour: WHITE, step: 4 });
      strips.push({ points: run(KERB_W / 2), width: KERB_W, colour: KERB, step: 4, lift: KERB_LIFT });
      strips.push({ points: run(KERB_W + GRAVEL_W * 0.3), width: GRAVEL_W * 0.6 + 0.02, colour: GRAVEL, step: 4 });
      strips.push({ points: run(KERB_W + GRAVEL_W * 0.8), width: GRAVEL_W * 0.4, colour: GRAVEL_DARK, step: 4 });
    }
    // sealed construction joints on the large slabs (not on the edge line itself)
    if (z.length * 2 * z.halfWidth > JOINT_AREA && !z.def.patches?.length && !z.def.features?.length) {
      for (let u = JOINT_STEP; u < z.length - 1; u += JOINT_STEP) strips.push({ points: across(z, u, -z.halfWidth + 0.6, z.halfWidth - 0.6), width: 0.05, colour: JOINT, step: 8 });
      for (let w = -z.halfWidth + JOINT_STEP; w < z.halfWidth - 1; w += JOINT_STEP) strips.push({ points: along(z, w, 0.6, z.length - 0.6, 8), width: 0.05, colour: JOINT, step: 8 });
    }
  }

  // Steering circle: the driven line solid, the lane edges dashed; faint radius rings every 10 m and eight spokes with
  // a tick at each ring, a centre cross: the radius reads from the chase camera.
  for (const p of def.props) {
    if (p.kind !== 'circle') continue;
    solid(circle(p.x, p.y, p.radius), 0.25);
    strips.push(...dashed(circle(p.x, p.y, p.radius - 2.5), 1.5, 1.5, 0.15, WHITE));
    strips.push(...dashed(circle(p.x, p.y, p.radius + 2.5), 1.5, 1.5, 0.15, WHITE));
    for (let r = 10; r < p.radius + 25; r += 10) if (Math.abs(r - p.radius) > 3) strips.push({ points: circle(p.x, p.y, r, 0, 2 * Math.PI, 1.5), width: 0.1, colour: FAINT, step: 1.5 });
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      strips.push(...dashed(line(p.x + 3 * c, p.y + 3 * sn, p.x + (p.radius - 4) * c, p.y + (p.radius - 4) * sn), 1, 2, 0.08, FAINT));
      for (let r = 10; r < p.radius + 25; r += 10) solid(line(p.x + r * c - 0.6 * sn, p.y + r * sn + 0.6 * c, p.x + r * c + 0.6 * sn, p.y + r * sn - 0.6 * c), 0.12, r === p.radius ? WHITE : FAINT);
    }
    solid(line(p.x - 1.5, p.y, p.x + 1.5, p.y), 0.15);
    solid(line(p.x, p.y - 1.5, p.x, p.y + 1.5), 0.15);
  }
  // Cones: two at the same x within a lane width of each other are a gate post pair (lane change), a lone cone is a
  // slalom cone.
  const cones = def.props.filter((p) => p.kind === 'cone');
  const partner = (c: (typeof cones)[number]) => cones.find((o) => o !== c && o.x === c.x && Math.abs(o.y - c.y) < 6);
  const posts = cones.filter((c) => partner(c));
  const slalom = cones.filter((c) => !partner(c));
  const byX = new Map<number, number[]>();
  for (const c of posts) byX.set(c.x, [...(byX.get(c.x) ?? []), c.y]);
  // Slalom: a spot ring round each cone, a dashed run-up line and a start bar.
  if (slalom.length) {
    for (const c of slalom) solid(circle(c.x, c.y, 0.45), 0.08);
    const x0 = Math.min(...slalom.map((c) => c.x));
    const y = slalom.find((c) => c.x === x0)!.y;
    strips.push(...dashed(line(x0 - 70, y, x0 - 12, y), 3, 3, 0.12, WHITE));
    solid(line(x0 - 10, y - 2.5, x0 - 10, y + 2.5), 0.3);
  }
  // Lane change: gate sections of three post pairs (start, middle, end): edge lines along them, gates across.
  const xs = [...byX.keys()].sort((a, b) => a - b);
  for (let i = 0; i + 2 < xs.length; i += 3) {
    const [lo, hi] = byX.get(xs[i]!)!.sort((a, b) => a - b) as [number, number];
    solid(line(xs[i]!, lo, xs[i + 2]!, lo), 0.1);
    solid(line(xs[i]!, hi, xs[i + 2]!, hi), 0.1);
    solid(line(xs[i]!, lo, xs[i]!, hi), 0.1, YELLOW);
    solid(line(xs[i + 2]!, lo, xs[i + 2]!, hi), 0.1, YELLOW);
  }
  if (xs.length) {
    const ys0 = byX.get(xs[0]!)!;
    const yc = (Math.min(...ys0) + Math.max(...ys0)) / 2;
    strips.push(...dashed(line(xs[0]! - 75, yc, xs[0]! - 4, yc), 3, 3, 0.12, WHITE));
  }

  // Surface patches (the braking platform): lanes as wide as the widest patch, lined across the patches' extent plus one
  // dry lane each side; an edge inside a lane (a split lane) dashed along the patches; a yellow brake bar where the
  // patches start, a white bar where they end and 10 m ticks beyond.
  for (const z of zones) {
    const patches = z.def.patches ?? [];
    if (patches.length === 0 || (z.def.features?.length ?? 0) > 0) continue;
    const u0 = Math.min(...patches.map((p) => p.u[0]));
    const u1 = Math.max(...patches.map((p) => p.u[1]));
    const lane = Math.max(...patches.map((p) => p.w[1] - p.w[0]));
    const w0 = Math.min(...patches.map((p) => p.w[0])) - lane;
    const w1 = Math.max(...patches.map((p) => p.w[1])) + lane;
    const lanes: number[] = [];
    for (let w = w0; w <= w1 + 1e-6; w += lane) if (Math.abs(w) <= z.halfWidth - 0.5) lanes.push(w);
    for (const w of lanes) solid(along(z, w, 4, z.length - 4), 0.2);
    // a chevron in each lane, pointing the way to drive, before the run-up
    for (let i = 0; i + 1 < lanes.length; i++) {
      const wc = (lanes[i]! + lanes[i + 1]!) / 2;
      const half = Math.abs(lanes[i + 1]! - lanes[i]!) / 2 - 0.8;
      const tip = { x: 0, y: 0 };
      const l = { x: 0, y: 0 };
      const r = { x: 0, y: 0 };
      for (const u of [10, 13]) {
        z.toWorld(u + 2, wc, tip);
        z.toWorld(u, wc - half, l);
        z.toWorld(u, wc + half, r);
        solid([[l.x, l.y], [tip.x, tip.y], [r.x, r.y]], 0.3);
      }
    }
    const inner = [...new Set(patches.flatMap((p) => p.w))].filter((w) => !lanes.some((l) => Math.abs(l - w) < 1e-6));
    for (const w of inner) strips.push(...dashed(along(z, w, u0, u1), 2, 2, 0.1, WHITE));
    const [a, b] = [Math.max(...lanes), Math.min(...lanes)];
    solid(across(z, u0 - 0.4, a, b), 0.5, YELLOW);
    solid(across(z, u1 + 0.2, a, b), 0.25);
    for (let u = u1 + 10; u < z.length - 5; u += 10) for (const w of lanes) solid(across(z, u, w - 0.6, w + 0.6), 0.15);
  }

  // Ride street: edge lines (not over the cobbles), yellow bars round each module, a ring round the pothole.
  for (const rs of zones) {
    if (!rs.def.features?.length || rs.def.shape.kind !== 'rect') continue;
    const inset = rs.halfWidth - 0.35;
    const pave = (rs.def.features ?? []).find((f) => f.kind === 'pave');
    const gaps = pave && pave.kind === 'pave' ? [pave.s - 1, pave.s + pave.length + 1] : [rs.length, rs.length];
    for (const w of [inset, -inset]) {
      solid(along(rs, w, 1, gaps[0]!), 0.12);
      if (gaps[1]! < rs.length - 1) solid(along(rs, w, gaps[1]!, rs.length - 1), 0.12);
    }
    const bar = (u: number) => solid(across(rs, u, -inset + 0.3, inset - 0.3), 0.2, YELLOW);
    // modules: washboard, pave, sleepers, the single-wheel steps (one group), the twist bumps (one group)
    const fs = rs.def.features ?? [];
    const extent = (f: (typeof fs)[number]): [number, number] => {
      switch (f.kind) {
        case 'humps':
          return [f.s, f.s + (f.count - 1) * f.spacing + f.length];
        case 'pothole':
          return [f.s - f.radius, f.s + f.radius];
        case 'cosine-bump':
        case 'washboard':
        case 'pave':
        case 'kerb-strike':
        case 'vertical-curve':
          return [f.s, f.s + f.length];
      }
    };
    const modules: [number, number][] = [];
    let prev = '';
    for (const f of fs) {
      if (f.kind === 'pothole') continue;
      const [a, b] = extent(f);
      const last = modules[modules.length - 1];
      // bumps less than 12 m apart are one module (the twist bumps)
      if (last && f.kind === 'cosine-bump' && prev === 'cosine-bump' && a - last[1] < 12) last[1] = Math.max(last[1], b);
      else modules.push([a, b]);
      prev = f.kind;
    }
    for (const [a, b] of modules) {
      bar(a - 0.7);
      bar(b + 0.7);
    }
    for (const f of fs) {
      if (f.kind !== 'pothole') continue;
      const p = { x: 0, y: 0 };
      rs.toWorld(f.s, f.l, p);
      solid(circle(p.x, p.y, f.radius + 0.2), 0.08, YELLOW);
    }
  }

  // Link roads (path zones): edge lines and a dashed centre line.
  for (const z of zones) {
    if (z.def.shape.kind !== 'path') continue;
    for (const w of [z.halfWidth - 0.3, -(z.halfWidth - 0.3)]) solid(along(z, w, 3, z.length), 0.12);
    strips.push(...dashed(along(z, 0, 3, z.length), 3, 4, 0.12, WHITE));
  }
  return strips;
}

/** Decal mesh of `strips` on the GroundWorld: positions (x, h + lift, -y), vertex colours, normals up. */
export function buildMarkings(world: GroundWorld, strips: readonly Strip[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const h = (x: number, y: number, lift: number) => world.sample(x, y, NaN, hit).h + lift;
  for (const { points, width, colour, step = MAX_STEP, lift = MARK_LIFT } of strips) {
    // resample every MAX_STEP so the strip follows the surface
    const pts: Pt[] = [points[0]!];
    for (let i = 0; i + 1 < points.length; i++) {
      const [x0, y0] = points[i]!;
      const [x1, y1] = points[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 1; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const [ax, ay] = pts[Math.max(0, i - 1)]!;
      const [bx, by] = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      // left normal of the local direction
      const nx = (-(by - ay) / len) * (width / 2);
      const ny = ((bx - ax) / len) * (width / 2);
      for (const [x, y] of [
        [px - nx, py - ny],
        [px + nx, py + ny],
      ] as const) {
        pos.push(x, h(x, y, lift), -y);
        col.push(...colour);
      }
      if (i > 0) {
        const r0 = base + 2 * (i - 1);
        // right(i-1), right(i), left(i-1) / left(i-1), right(i), left(i): counter-clockwise seen from above
        index.push(r0, r0 + 2, r0 + 1, r0 + 1, r0 + 2, r0 + 3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  const normal = new Float32Array(pos.length);
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1;
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
