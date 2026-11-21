/**
 * Painted markings of the annex as one vertex-coloured decal mesh (one draw call): the steering circle, slalom cone
 * spots, ISO 3888-2 lane edges and gates, braking-lane lines with the brake bar, ride-street edge lines with yellow
 * bars before and after each module and a ring round the pothole, link-road edge and centre lines. Strips follow the
 * GroundWorld (`world.sample`) every 0.5 m, lifted MARK_LIFT above it with a polygon offset. Geometry instead of the
 * track's per-pixel shader loop: exact on any surface and cheap under a software renderer.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { GroundHit, GroundWorld, WorldDefinition } from '../../contracts/world';
import type { CompiledZone } from '../../sim-core/world/zones';

/** Paint lift above the drawn surface (covers the zone mesh's interpolation between its vertices), m. */
export const MARK_LIFT = 0.008;
const MAX_STEP = 0.5;
const WHITE = [0.78, 0.78, 0.76] as const;
const YELLOW = [0.8, 0.54, 0.07] as const;
type Rgb = readonly [number, number, number];
type Pt = readonly [x: number, y: number];

interface Strip {
  readonly points: readonly Pt[];
  readonly width: number;
  readonly colour: Rgb;
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

const circle = (cx: number, cy: number, r: number, from = 0, to = 2 * Math.PI): Pt[] => {
  const n = Math.max(8, Math.ceil((Math.abs(to - from) * r) / MAX_STEP));
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
function along(zone: CompiledZone, w: number, u0: number, u1: number): Pt[] {
  const p = { x: 0, y: 0 };
  const n = Math.max(1, Math.ceil(Math.abs(u1 - u0)));
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

/** Every marking of the proving ground (world (x, y) polylines). */
export function annexMarkings(def: WorldDefinition, zones: readonly CompiledZone[]): Strip[] {
  const strips: Strip[] = [];
  const solid = (points: Pt[], width: number, colour: Rgb = WHITE) => strips.push({ points, width, colour });

  // Steering circle: the driven line solid, the lane edges dashed.
  for (const p of def.props) {
    if (p.kind !== 'circle') continue;
    solid(circle(p.x, p.y, p.radius), 0.2);
    strips.push(...dashed(circle(p.x, p.y, p.radius - 2.5), 1.5, 1.5, 0.12, WHITE));
    strips.push(...dashed(circle(p.x, p.y, p.radius + 2.5), 1.5, 1.5, 0.12, WHITE));
  }
  // Cones: two at the same x are a gate post pair (lane change), a lone cone is a slalom cone.
  const cones = def.props.filter((p) => p.kind === 'cone');
  const byX = new Map<number, number[]>();
  for (const c of cones) byX.set(c.x, [...(byX.get(c.x) ?? []), c.y]);
  const slalom = cones.filter((c) => byX.get(c.x)!.length === 1);
  // Slalom: a spot ring round each cone, a dashed run-up line and a start bar.
  if (slalom.length) {
    for (const c of slalom) solid(circle(c.x, c.y, 0.45), 0.08);
    const x0 = Math.min(...slalom.map((c) => c.x));
    const y = slalom.find((c) => c.x === x0)!.y;
    strips.push(...dashed(line(x0 - 70, y, x0 - 12, y), 3, 3, 0.12, WHITE));
    solid(line(x0 - 10, y - 2.5, x0 - 10, y + 2.5), 0.3);
  }
  // Lane change: gate sections of three post pairs (start, middle, end): edge lines along them, gates across.
  const xs = [...byX.keys()].filter((x) => byX.get(x)!.length === 2).sort((a, b) => a - b);
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
    for (const w of lanes) solid(along(z, w, 4, z.length - 4), 0.12);
    const inner = [...new Set(patches.flatMap((p) => p.w))].filter((w) => !lanes.some((l) => Math.abs(l - w) < 1e-6));
    for (const w of inner) strips.push(...dashed(along(z, w, u0, u1), 2, 2, 0.1, WHITE));
    const [a, b] = [Math.max(...lanes), Math.min(...lanes)];
    solid(across(z, u0 - 0.4, a, b), 0.4, YELLOW);
    solid(across(z, u1 + 0.2, a, b), 0.15);
    for (let u = u1 + 10; u < z.length - 5; u += 10) for (const w of lanes) solid(across(z, u, w - 0.4, w + 0.4), 0.1);
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
  const h = (x: number, y: number) => world.sample(x, y, NaN, hit).h + MARK_LIFT;
  for (const { points, width, colour } of strips) {
    // resample every MAX_STEP so the strip follows the surface
    const pts: Pt[] = [points[0]!];
    for (let i = 0; i + 1 < points.length; i++) {
      const [x0, y0] = points[i]!;
      const [x1, y1] = points[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / MAX_STEP));
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
        pos.push(x, h(x, y), -y);
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
