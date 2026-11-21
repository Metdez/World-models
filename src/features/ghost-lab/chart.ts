/**
 * Strip chart of two ghost runs against distance along the visitor's line (one row per channel), drawn once per
 * comparison; a separate cursor layer moves with the ghost while it plays. Colours come from the design tokens. Neither
 * painter allocates (the chart's labels are drawn once per comparison).
 */
import type { Comparison } from '../../sim-core/ghost/compare';
import type { Channel, Trace } from '../../sim-core/ghost/ghost';
import { formatDelta, ROWS } from './copy';

export interface ChartPalette {
  readonly text1: string;
  readonly text3: string;
  readonly hair: string;
  readonly a: string;
  readonly b: string;
  readonly font: string;
}

export function readPalette(el: Element): ChartPalette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    text1: v('--text-1'),
    text3: v('--text-3'),
    hair: v('--hair'),
    a: v('--accent'),
    b: v('--warn'),
    font: `500 11px ${v('--font-sans') || 'system-ui, sans-serif'}`,
  };
}

export const ROW_H = 24;
const LABEL_W = 62;
const VALUE_W = 50;

export interface Layer {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
}

export function layer(canvas: HTMLCanvasElement): Layer {
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return { canvas, g, w: 0, h: 0, dpr: 0 };
}

function begin(l: Layer, w: number, h: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  if (dpr !== l.dpr || w !== l.w || h !== l.h) {
    l.dpr = dpr;
    l.w = w;
    l.h = h;
    l.canvas.width = Math.round(w * dpr);
    l.canvas.height = Math.round(h * dpr);
    l.canvas.style.width = `${w}px`;
    l.canvas.style.height = `${h}px`;
  }
  const g = l.g;
  g.setTransform(l.dpr, 0, 0, l.dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

export const chartHeight = (): number => ROWS.length * ROW_H;

/** The plot's x range in CSS px (the cursor layer uses the same mapping). */
export const plotX = (w: number, k: number, n: number): number => LABEL_W + ((w - LABEL_W - VALUE_W) * k) / Math.max(1, n - 1);

/**
 * Draws A (accent) and B (amber) per channel over samples 1..n-1, each row scaled to the pair's range (zero line when
 * inside it); the right column holds the peak difference, bright when it counts (beyond the A/A floor), dim when not.
 */
export function drawChart(l: Layer, w: number, p: ChartPalette, a: Trace, b: Trace, cmp: Comparison): void {
  const h = chartHeight();
  const g = begin(l, w, h);
  const n = cmp.n;
  g.font = p.font;
  g.textBaseline = 'middle';
  for (let r = 0; r < ROWS.length; r++) {
    const row = ROWS[r]!;
    const c: Channel = row.channel;
    const top = r * ROW_H + 3;
    const bottom = (r + 1) * ROW_H - 3;
    const xa = a.ch[c];
    const xb = b.ch[c];
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 1; k < n; k++) {
      lo = Math.min(lo, xa[k]!, xb[k]!);
      hi = Math.max(hi, xa[k]!, xb[k]!);
    }
    // a minimum span so a flat channel is not blown up into noise (2 x the perceptual threshold)
    const span = Math.max(hi - lo, 2 * cmp.channels[c].threshold);
    const mid = (hi + lo) / 2;
    lo = mid - span / 2;
    hi = mid + span / 2;
    const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
    g.fillStyle = p.text3;
    g.textAlign = 'left';
    g.fillText(row.label, 0, (top + bottom) / 2);
    g.strokeStyle = p.hair;
    g.lineWidth = 1;
    g.beginPath();
    const base = lo < 0 && hi > 0 ? Math.round(y(0)) + 0.5 : Math.round(bottom) + 0.5;
    g.moveTo(LABEL_W, base);
    g.lineTo(w - VALUE_W + 4, base);
    g.stroke();
    for (const [series, colour] of [
      [xa, p.a],
      [xb, p.b],
    ] as const) {
      g.strokeStyle = colour;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 1; k < n; k++) {
        const x = plotX(w, k, n);
        if (k === 1) g.moveTo(x, y(series[k]!));
        else g.lineTo(x, y(series[k]!));
      }
      g.stroke();
    }
    const st = cmp.channels[c];
    g.textAlign = 'right';
    g.fillStyle = st.significant ? p.text1 : p.text3;
    g.fillText(st.significant ? `Δ ${formatDelta(c, st.peakDiff)}` : '≈', w, (top + bottom) / 2);
  }
}

/** The ghost's position on the chart (k = fractional sample), or nothing when k < 0. */
export function drawCursor(l: Layer, w: number, p: ChartPalette, k: number, n: number): void {
  const h = chartHeight();
  const g = begin(l, w, h);
  if (k < 0) return;
  const x = Math.round(plotX(w, Math.min(k, n - 1), n)) + 0.5;
  g.strokeStyle = p.b;
  g.globalAlpha = 0.6;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, h);
  g.stroke();
  g.globalAlpha = 1;
}
