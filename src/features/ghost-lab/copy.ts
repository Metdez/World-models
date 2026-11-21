/**
 * Ghost-lab copy (ARCHITECTURE-M2 §13.3, §13.7): templates carry no digits; every number comes from the simulation and
 * is formatted here. The sentence never ranks suspension types: it says what differed (or that nothing did beyond the
 * autopilot's own repeat error), or that no conclusion can be drawn.
 */
import type { Comparison } from '../../sim-core/ghost/compare';
import type { Channel } from '../../sim-core/ghost/ghost';

export const COPY = {
  chip: 'Compare',
  chipTitle: 'Same line, different suspension: an autopilot drives your last stretch again with another suspension (G)',
  computing: 'Comparing…',
  title: 'Same line, different suspension',
  you: 'you',
  yours: 'yours',
  ghost: 'ghost',
  control: 'Same (control)',
  controlTitle: 'Control run: the autopilot with your own suspension, to show how closely it repeats your drive',
  against: 'Ghost suspension',
  again: 'Watch again',
  close: 'Close comparison',
  playing: 'Ghost on track',
  /** Always visible while a ghost or its traces are shown (§13.3). */
  disclosure:
    'Driver model: both runs use the same autopilot on your line and speed: your own steering and pedals plus small corrections to stay on the line. It repeats your own run to within {floor}; smaller differences count as none.',
  short: 'Drive a few seconds forwards on one line, then compare.',
  unfit: 'This run cannot be compared here.',
  axis: 'along your line',
} as const;

/** Row labels of the strip chart (and the sentence's nouns). */
export const ROWS: readonly {
  readonly channel: Channel;
  readonly label: string;
  readonly noun: string;
}[] = [
  { channel: 'steer', label: 'Steer', noun: 'steering' },
  { channel: 'frontSlip', label: 'Front slip', noun: 'front slip angle' },
  { channel: 'rearSlip', label: 'Rear slip', noun: 'rear slip angle' },
  { channel: 'sideslip', label: 'Sideslip', noun: 'sideslip' },
  { channel: 'roll', label: 'Roll', noun: 'body roll' },
  { channel: 'offset', label: 'Off line', noun: 'distance from your line' },
];

const TEMPLATES = {
  refused: 'The autopilot could not repeat your own drive closely enough here (up to {a} off your line with {A}), so this comparison draws no conclusion.',
  lost: 'With {B} the autopilot could not hold your line (up to {b} off it): the two cars took different paths, so the traces are not like for like.',
  same: 'On this stretch {B} behaved like {A}: every difference stayed within the autopilot’s own repeat error.',
  different: 'With {B}, {clauses}.',
  control: 'Control run: with {A} the autopilot repeats your drive to within {a} of your line.',
  steer: 'the autopilot needed {pct} {dir} steering for your line',
  peak: '{noun} peaked {dir} ({b} against {a})',
  apart: '{noun} differed by up to {d} along the stretch',
  offset: 'the autopilot strayed up to {b} from your line',
  join: '{first}, and {second}',
} as const;

const fill = (t: string, v: Readonly<Record<string, string>>): string => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

const DEG = 180 / Math.PI;
/** Angles (rad) as degrees with one decimal below 10 deg; offsets (m) in cm (whole) or m above a metre. */
export function formatValue(channel: Channel, value: number): string {
  if (channel === 'offset') {
    const m = Math.abs(value);
    return m < 1 ? `${Math.max(1, Math.round(m * 100))} cm` : `${m.toFixed(1)} m`;
  }
  const d = Math.abs(value) * DEG;
  return `${d < 10 ? d.toFixed(1) : d.toFixed(0)}°`;
}
export const formatOffset = (m: number): string => formatValue('offset', m);
export const formatDelta = (channel: Channel, value: number): string => formatValue(channel, value);

/** One clause per significant channel. */
function clause(cmp: Comparison, channel: Channel): string {
  const st = cmp.channels[channel];
  const noun = ROWS.find((r) => r.channel === channel)!.noun;
  if (channel === 'steer' && Number.isFinite(cmp.steerEffort) && Math.abs(cmp.steerEffort) >= 0.02) {
    const pct = Math.round(Math.abs(cmp.steerEffort) * 100);
    return fill(TEMPLATES.steer, {
      pct: `${pct} %`,
      dir: cmp.steerEffort > 0 ? 'more' : 'less',
    });
  }
  if (channel === 'offset') return fill(TEMPLATES.offset, { b: formatValue(channel, st.bPeak) });
  if (Math.abs(st.bPeak - st.aPeak) > st.threshold)
    return fill(TEMPLATES.peak, {
      noun,
      dir: st.bPeak > st.aPeak ? 'higher' : 'lower',
      b: formatValue(channel, st.bPeak),
      a: formatValue(channel, st.aPeak),
    });
  return fill(TEMPLATES.apart, { noun, d: formatValue(channel, st.peakDiff) });
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The one honest sentence. `a` / `b` are suspension labels; `control` = the B run used the visitor's own suspension.
 * Steering first (the autopilot's effort is the headline), then the strongest other difference; at most two.
 */
export function sentence(cmp: Comparison, a: string, b: string, control: boolean): string {
  if (cmp.verdict === 'refused') return fill(TEMPLATES.refused, { a: formatOffset(cmp.aaOffset), A: a });
  if (control) return fill(TEMPLATES.control, { A: a, a: formatOffset(cmp.aaOffset) });
  if (cmp.verdict === 'lost') return fill(TEMPLATES.lost, { B: b, b: formatOffset(cmp.bOffset) });
  if (cmp.verdict === 'same') return fill(TEMPLATES.same, { A: a, B: b });
  const order = cmp.order.includes('steer') ? ['steer' as Channel, ...cmp.order.filter((c) => c !== 'steer')] : cmp.order;
  const parts = order.slice(0, 2).map((c) => clause(cmp, c));
  const clauses = parts.length === 2 ? fill(TEMPLATES.join, { first: parts[0]!, second: parts[1]! }) : parts[0]!;
  return capital(fill(TEMPLATES.different, { B: b, clauses }));
}

export const disclosure = (aaOffset: number): string => fill(COPY.disclosure, { floor: formatOffset(aaOffset) });

/** Every template string (tests: no digits in copy). */
export const TEMPLATE_STRINGS: readonly string[] = [...Object.values(COPY), ...Object.values(TEMPLATES), ...ROWS.flatMap((r) => [r.label, r.noun])];
