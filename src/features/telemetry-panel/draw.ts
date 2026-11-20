/**
 * Canvas painters for the telemetry card. Zero allocation per call: colours are strings read once from the CSS
 * tokens, dash patterns are module constants, every value arrives as a number.
 */
import type { History } from './history';

export interface Palette {
  readonly text1: string;
  readonly text2: string;
  readonly text3: string;
  readonly hair: string;
  readonly hairStrong: string;
  readonly accent: string;
  readonly warn: string;
}

/** Canvas colours come from the design tokens (src/ui/tokens.css), never literals. */
export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text1: v('--text-1'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    hair: v('--hair'),
    hairStrong: v('--hair-strong'),
    accent: v('--accent'),
    warn: v('--warn'),
  };
}

export interface Surface {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  /** CSS px. */
  readonly w: number;
  readonly h: number;
  dpr: number;
}

export function surface(canvas: HTMLCanvasElement, w: number, h: number): Surface {
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return { canvas, g, w, h, dpr: 0 };
}

/** Backing store follows devicePixelRatio (capped at 2) so hairlines stay crisp; returns the cleared context. */
export function begin(s: Surface, devicePixelRatio: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
  if (dpr !== s.dpr) {
    s.dpr = dpr;
    s.canvas.width = Math.round(s.w * dpr);
    s.canvas.height = Math.round(s.h * dpr);
  }
  const g = s.g;
  g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  g.clearRect(0, 0, s.w, s.h);
  g.globalAlpha = 1;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return g;
}

const DASH: number[] = [2, 3];
const SOLID: number[] = [];
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** g-g trail: ring of lateral/longitudinal acceleration in g. */
export class GgTrail {
  readonly x: Float32Array;
  readonly y: Float32Array;
  head = 0;
  count = 0;
  constructor(readonly n: number) {
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
  }
  push(lateralG: number, longitudinalG: number): void {
    this.x[this.head] = lateralG;
    this.y[this.head] = longitudinalG;
    this.head = (this.head + 1) % this.n;
    if (this.count < this.n) this.count++;
  }
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

/** Outer edge of the g-g plot, g. */
export const GG_RANGE = 1.25;
const ggClamp = (v: number) => clamp(v, -GG_RANGE, GG_RANGE);

/**
 * Friction-circle view of the accelerations the car is making: left turn -> dot left, braking -> dot down.
 * Rings at half and one g; fading 1.5 s trail (skipped with reduced motion).
 */
export function drawGg(s: Surface, p: Palette, dpr: number, trail: GgTrail, showTrail: boolean): void {
  const g = begin(s, dpr);
  const cx = s.w / 2;
  const cy = s.h / 2;
  const r = Math.min(cx, cy) - 2;
  const k = r / GG_RANGE;
  g.lineWidth = 1;
  g.strokeStyle = p.hair;
  g.beginPath();
  g.moveTo(cx - r, cy);
  g.lineTo(cx + r, cy);
  g.moveTo(cx, cy - r);
  g.lineTo(cx, cy + r);
  g.stroke();
  g.setLineDash(DASH);
  g.beginPath();
  g.arc(cx, cy, 0.5 * k, 0, TAU);
  g.stroke();
  g.setLineDash(SOLID);
  g.strokeStyle = p.hairStrong;
  g.beginPath();
  g.arc(cx, cy, k, 0, TAU);
  g.stroke();
  if (trail.count === 0) return;
  const newest = (trail.head - 1 + trail.n) % trail.n;
  if (showTrail) {
    g.strokeStyle = p.accent;
    g.lineWidth = 1.5;
    for (let j = trail.count - 1; j > 0; j--) {
      const a = (trail.head - j - 1 + trail.n) % trail.n;
      const b = (a + 1) % trail.n;
      g.globalAlpha = 0.55 * (1 - j / trail.count);
      g.beginPath();
      g.moveTo(cx - ggClamp(trail.x[a]!) * k, cy - ggClamp(trail.y[a]!) * k);
      g.lineTo(cx - ggClamp(trail.x[b]!) * k, cy - ggClamp(trail.y[b]!) * k);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  g.fillStyle = p.accent;
  g.beginPath();
  g.arc(cx - ggClamp(trail.x[newest]!) * k, cy - ggClamp(trail.y[newest]!) * k, 3, 0, TAU);
  g.fill();
}

export interface CornerGlyph {
  /** rad, to the road (TRUE). */
  camber: number;
  /** rad, static camber (tick). */
  staticCamber: number;
  /** +1 left, -1 right, 0 centreline: the needle leans the way the wheel top leans, seen from behind. */
  side: number;
  /** m, + bump. */
  travel: number;
  /** m (> 0), usable travel each way. */
  bump: number;
  droop: number;
  /** load / static corner load. */
  loadRatio: number;
  /** 0..1 stop engagement. */
  stop: number;
  /** rad, needle full-scale each way (CAMBER_RANGE; a leaning motorcycle needs LEAN_RANGE). */
  range: number;
}

/** Camber arc span each way, rad (six degrees). */
export const CAMBER_RANGE = (6 * Math.PI) / 180;
/** Needle span for a single-track vehicle, whose wheel camber to the road is its lean, rad (fifty degrees). */
export const LEAN_RANGE = (50 * Math.PI) / 180;

/** Per-corner glyph: camber arc with needle + static tick, travel bar between the stops, load square. */
export function drawCorner(s: Surface, p: Palette, dpr: number, c: CornerGlyph): void {
  const g = begin(s, dpr);
  const cx = 16;
  const cy = s.h - 6;
  const r = 14;
  const lean = c.side === 0 ? 1 : c.side;
  g.lineWidth = 1;
  g.strokeStyle = p.hair;
  g.beginPath();
  g.arc(cx, cy, r, Math.PI, TAU);
  g.stroke();
  // static tick
  const a0 = needleAngle(c.staticCamber, lean, c.range);
  g.strokeStyle = p.text3;
  g.beginPath();
  g.moveTo(cx + Math.cos(a0) * (r - 3), cy + Math.sin(a0) * (r - 3));
  g.lineTo(cx + Math.cos(a0) * (r + 2), cy + Math.sin(a0) * (r + 2));
  g.stroke();
  // arc from vertical (zero camber) to the needle, then the needle (the wheel's vertical axis)
  const a = needleAngle(c.camber, lean, c.range);
  const up = 1.5 * Math.PI;
  g.strokeStyle = p.accent;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, r, Math.min(up, a), Math.max(up, a));
  g.stroke();
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1));
  g.stroke();
  g.fillStyle = p.text2;
  g.beginPath();
  g.arc(cx, cy, 1.5, 0, TAU);
  g.fill();

  // travel bar: droop at the bottom, bump at the top, zero = static ride height
  const bx = 41;
  const top = 3;
  const bottom = s.h - 3;
  const y0 = barY(0, c, top, bottom);
  g.lineWidth = 3;
  g.lineCap = 'butt';
  g.strokeStyle = p.hair;
  g.beginPath();
  g.moveTo(bx, top);
  g.lineTo(bx, bottom);
  g.stroke();
  g.strokeStyle = c.stop > 0 ? p.warn : c.travel >= 0 ? p.accent : p.text2;
  g.beginPath();
  g.moveTo(bx, y0);
  g.lineTo(bx, barY(c.travel, c, top, bottom));
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = p.text3;
  g.beginPath();
  g.moveTo(bx - 3, y0);
  g.lineTo(bx + 3, y0);
  g.stroke();

  // load square: opacity follows load / static load (half-filled at static), outlined amber when unloaded
  const q = 10;
  const qx = s.w - q - 1.5;
  const qy = (s.h - q) / 2;
  g.globalAlpha = clamp(c.loadRatio / 2, 0, 1);
  g.fillStyle = p.accent;
  g.fillRect(qx, qy, q, q);
  g.globalAlpha = 1;
  g.strokeStyle = c.loadRatio < 0.05 ? p.warn : p.hairStrong;
  g.strokeRect(qx, qy, q, q);
}

const needleAngle = (camber: number, lean: number, range: number) => 1.5 * Math.PI - clamp(camber / range, -1, 1) * 0.5 * Math.PI * lean;
const barY = (t: number, c: CornerGlyph, top: number, bottom: number) =>
  bottom - ((clamp(t, -c.droop, c.bump) + c.droop) / (c.bump + c.droop)) * (bottom - top);

export interface SparkScale {
  lo: number;
  hi: number;
}

/**
 * Sparkline of one corner metric over the live window, newest at the right; the ghost (previous suspension at
 * the same track positions) is drawn dashed underneath. `ref` is the hairline reference (static value).
 * `minSpan` keeps a flat signal from being blown up into noise. The y-range eases toward the data.
 */
export function drawSpark(
  s: Surface,
  p: Palette,
  dpr: number,
  h: History,
  corner: number,
  metric: number,
  ref: number,
  minSpan: number,
  scale: SparkScale,
): void {
  const g = begin(s, dpr);
  const n = h.count;
  let lo = ref;
  let hi = ref;
  for (let k = 0; k < n; k++) {
    const v = h.liveAt(k, corner, metric);
    if (v === v) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const gv = h.ghostAt(k, corner, metric);
    if (gv === gv) {
      if (gv < lo) lo = gv;
      if (gv > hi) hi = gv;
    }
  }
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  if (!(scale.hi > scale.lo)) {
    scale.lo = lo;
    scale.hi = hi;
  } else {
    // widen at once, shrink slowly: no clipping, no jitter
    scale.lo = lo < scale.lo ? lo : scale.lo + (lo - scale.lo) * 0.08;
    scale.hi = hi > scale.hi ? hi : scale.hi + (hi - scale.hi) * 0.08;
  }
  map.lo = scale.lo;
  map.hi = scale.hi;
  map.top = 3;
  map.bottom = s.h - 3;
  map.right = s.w - 4;
  map.dx = (s.w - 6) / (h.slots - 1);
  map.n = n;

  g.lineWidth = 1;
  g.strokeStyle = p.hair;
  g.beginPath();
  g.moveTo(0, yOf(ref));
  g.lineTo(s.w, yOf(ref));
  g.stroke();
  if (n === 0) return;

  if (h.hasGhost) {
    g.strokeStyle = p.text2;
    g.globalAlpha = 0.7;
    g.setLineDash(DASH);
    trace(g, h, corner, metric, true);
    g.setLineDash(SOLID);
    g.globalAlpha = 1;
  }
  g.strokeStyle = p.accent;
  g.lineWidth = 1.5;
  trace(g, h, corner, metric, false);
  const last = h.liveAt(n - 1, corner, metric);
  if (last === last) {
    g.fillStyle = p.accent;
    g.beginPath();
    g.arc(xOf(n - 1), yOf(last), 2.5, 0, TAU);
    g.fill();
  }
}

/** Spark mapping for the current draw (module state instead of per-call closures). */
const map = { lo: 0, hi: 1, top: 0, bottom: 1, right: 0, dx: 1, n: 0 };
const yOf = (v: number) => map.bottom - ((v - map.lo) / (map.hi - map.lo)) * (map.bottom - map.top);
const xOf = (k: number) => map.right - (map.n - 1 - k) * map.dx;

function trace(g: CanvasRenderingContext2D, h: History, corner: number, metric: number, ghost: boolean): void {
  g.beginPath();
  let pen = false;
  for (let k = 0; k < map.n; k++) {
    const v = ghost ? h.ghostAt(k, corner, metric) : h.liveAt(k, corner, metric);
    if (v !== v) {
      pen = false;
      continue;
    }
    if (pen) g.lineTo(xOf(k), yOf(v));
    else g.moveTo(xOf(k), yOf(v));
    pen = true;
  }
  g.stroke();
}
