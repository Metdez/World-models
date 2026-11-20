/** 04-01 attract storyboard: one 60 s loop, honest short captions, reachable road, deterministic scheduler. */
import { describe, expect, it } from 'vitest';
import { beatAt, createTimeline, FADE_IN, FADE_OUT, fadeAt, loopDuration, STORYBOARD } from '../../src/features/attract/storyboard';
import { provingLoop } from '../../src/sim-core/content/proving-loop';

describe('attract storyboard', () => {
  it('is one 60 s loop with captions of at most 8 words and no digits', () => {
    expect(loopDuration(STORYBOARD)).toBe(60);
    for (const beat of STORYBOARD) {
      expect(beat.caption.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(beat.caption).not.toMatch(/\d/);
      expect(beat.duration).toBeGreaterThanOrEqual(3);
    }
    // Loops seamlessly: ends where it begins (clean layer, the visitor's own suspension).
    const first = STORYBOARD[0]!;
    const last = STORYBOARD[STORYBOARD.length - 1]!;
    expect(last.patch).toEqual(first.patch);
    expect(last.swap).toBe(0);
  });

  it('only seeks to phenomena the proving loop has', () => {
    const phenomena = new Set(provingLoop.segments.map((s) => s.phenomenon));
    for (const beat of STORYBOARD) if (beat.at) expect(phenomena.has(beat.at)).toBe(true);
  });

  it('beatAt maps loop time to beats, inclusive start, wrapping both ways', () => {
    expect(beatAt(STORYBOARD, 0)).toEqual({ index: 0, start: 0 });
    expect(beatAt(STORYBOARD, 7.999).index).toBe(0);
    expect(beatAt(STORYBOARD, 8)).toEqual({ index: 1, start: 8 });
    expect(beatAt(STORYBOARD, 59.99).index).toBe(STORYBOARD.length - 1);
    expect(beatAt(STORYBOARD, 60)).toEqual({ index: 0, start: 0 });
    expect(beatAt(STORYBOARD, -0.5).index).toBe(STORYBOARD.length - 1);
  });

  it('fades to black only around seeks', () => {
    // Beat 1 (t = 8) seeks: black at the cut, clear before the fade-out and after the fade-in.
    expect(fadeAt(STORYBOARD, 8)).toBe(1);
    expect(fadeAt(STORYBOARD, 8 - FADE_OUT - 0.01)).toBe(0);
    expect(fadeAt(STORYBOARD, 8 - FADE_OUT / 2)).toBeCloseTo(0.5, 6);
    expect(fadeAt(STORYBOARD, 8 + FADE_IN + 0.01)).toBe(0);
    // Beat 0 does not seek: the loop restart is a camera move, not a fade.
    expect(fadeAt(STORYBOARD, 0.1)).toBe(0);
  });

  it('the timeline starts every beat once per loop, in order, for any frame rate', () => {
    for (const dts of [[1 / 30], [1 / 144], [1 / 60, 0.1, 0.007, 1 / 24]]) {
      const timeline = createTimeline(STORYBOARD);
      const started: [number, number][] = [[timeline.step(0), 0]];
      for (let i = 0; timeline.time + dts[i % dts.length]! < 2 * loopDuration(STORYBOARD) - 1e-6; i++) {
        const index = timeline.step(dts[i % dts.length]!);
        if (index >= 0) started.push([index, timeline.time]);
      }
      const order = started.map(([i]) => i);
      const n = STORYBOARD.length;
      expect(order).toEqual([...Array(2 * n).keys()].map((i) => i % n));
      // Each beat starts within one frame of its scheduled time.
      let scheduled = 0;
      for (const [k, [index, time]] of started.entries()) {
        expect(time - scheduled).toBeGreaterThanOrEqual(-1e-9);
        expect(time - scheduled).toBeLessThanOrEqual(0.1 + 1e-9);
        scheduled += STORYBOARD[index]!.duration;
        if (k === n - 1) expect(scheduled).toBe(60);
      }
    }
  });
});
