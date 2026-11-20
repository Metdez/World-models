/**
 * Attract-mode storyboard (research 21 §3), adapted to what the app has: a 60 s loop of beats, each with one shot,
 * one caption (≤ 8 words, no digits: numbers only ever come from the sim) and the store keys it sets.
 * Beats that need a particular stretch of road name its phenomenon; the director seeks there behind a fade.
 */
import type { DirectorShot } from '../../contracts/services';
import type { AppState } from '../../contracts/store';
import type { Phenomenon } from '../../contracts/track';

export type AttractPatch = Partial<Pick<AppState, 'xray' | 'overlay' | 'timeScale' | 'amplification'>>;

export interface Beat {
  /** Wall-clock seconds (independent of slow motion). */
  readonly duration: number;
  readonly caption: string;
  /** Show the product title above the caption. */
  readonly title?: boolean;
  readonly shot: Omit<DirectorShot, 'durationS'>;
  /** Seek to the start of the first section showing this phenomenon, `lead` seconds early. */
  readonly at?: Phenomenon;
  readonly lead?: number;
  readonly patch: AttractPatch;
  /** Suspension to show: index offset from the one the visitor had (0 = theirs). */
  readonly swap: number;
}

const CLEAN: AttractPatch = { xray: false, overlay: 'clean', timeScale: 1, amplification: 1 };

export const STORYBOARD: readonly Beat[] = [
  { duration: 8, title: true, caption: 'Every bump is a geometry problem.', shot: { kind: 'orbit' }, patch: CLEAN, swap: 0 },
  {
    duration: 9,
    caption: 'Watch the links work over a bump.',
    shot: { kind: 'closeup', corner: 'fl' },
    at: 'single-wheel-bump',
    lead: 3,
    patch: { ...CLEAN, xray: true },
    swap: 0,
  },
  {
    duration: 10,
    caption: 'Roll, made visible.',
    shot: { kind: 'front-view' },
    at: 'roll-reversal',
    lead: 0.6,
    patch: { xray: false, overlay: 'engineer', timeScale: 0.25, amplification: 2.5 },
    swap: 0,
  },
  {
    duration: 10,
    caption: 'Geometry decides the grip.',
    shot: { kind: 'trackside' },
    at: 'steady-state-roll',
    lead: 1,
    patch: { ...CLEAN, overlay: 'engineer' },
    swap: 0,
  },
  {
    duration: 6,
    caption: 'Same bump. Different answer.',
    shot: { kind: 'closeup', corner: 'fl' },
    at: 'single-wheel-bump',
    lead: 1.5,
    patch: { ...CLEAN, xray: true },
    swap: 1,
  },
  {
    duration: 6,
    caption: 'Same bump. Different answer.',
    shot: { kind: 'closeup', corner: 'fl' },
    at: 'single-wheel-bump',
    lead: 1.5,
    patch: { ...CLEAN, xray: true },
    swap: 2,
  },
  { duration: 6, caption: 'Brakes on. The nose dives.', shot: { kind: 'trackside' }, at: 'brake-dive', lead: 0.4, patch: CLEAN, swap: 0 },
  { duration: 5, title: true, caption: 'Touch to explore.', shot: { kind: 'chase' }, patch: CLEAN, swap: 0 },
];

export const loopDuration = (board: readonly Beat[]): number => board.reduce((sum, b) => sum + b.duration, 0);

/** Beat index and its start time at loop time t (wrapped). */
export function beatAt(board: readonly Beat[], t: number): { index: number; start: number } {
  const total = loopDuration(board);
  const x = ((t % total) + total) % total;
  let start = 0;
  for (let i = 0; i < board.length; i++) {
    const end = start + board[i]!.duration;
    if (x < end) return { index: i, start };
    start = end;
  }
  return { index: board.length - 1, start: total - board[board.length - 1]!.duration };
}

/** Fade (black) around seeks: out over FADE_OUT before a beat that seeks, back in over FADE_IN after it starts. */
export const FADE_OUT = 0.35;
export const FADE_IN = 0.5;

export function fadeAt(board: readonly Beat[], t: number): number {
  const { index, start } = beatAt(board, t);
  const total = loopDuration(board);
  const local = (((t % total) + total) % total) - start;
  const beat = board[index]!;
  const next = board[(index + 1) % board.length]!;
  const toEnd = beat.duration - local;
  let out = 0;
  if (next.at && toEnd < FADE_OUT) out = 1 - toEnd / FADE_OUT;
  if (beat.at && local < FADE_IN) out = Math.max(out, 1 - local / FADE_IN);
  return out;
}

/** Steps a wall clock through the board; returns the beat index that starts during this step, else -1. */
export function createTimeline(board: readonly Beat[]) {
  let t = 0;
  let current = -1;
  return {
    get time() {
      return t;
    },
    /** Call once with dt = 0 to start the first beat. */
    step(dt: number): number {
      t += dt;
      const { index } = beatAt(board, t);
      if (index === current) return -1;
      current = index;
      return index;
    },
  };
}
