import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../src/contracts/app';
import { createGovernor, startRatio, stepGovernor, type Governor, type GovernorAction } from '../../src/features/renderer/governor';

const high = QUALITY_PRESETS.high;

/** Runs frames of `frameMs` for `seconds`, collecting non-'none' actions. */
function run(g: Governor, frameMs: number, seconds: number, b = high): GovernorAction[] {
  const actions: GovernorAction[] = [];
  const dt = frameMs / 1000;
  for (let t = 0; t < seconds; t += dt) {
    const a = stepGovernor(g, dt, b);
    if (a !== 'none') actions.push(a);
  }
  return actions;
}

describe('renderer governor (§10)', () => {
  it('starts at the device ratio clamped into the tier', () => {
    expect(startRatio(3, high)).toBe(high.maxPixelRatio);
    expect(startRatio(0.5, high)).toBe(high.minPixelRatio);
    expect(startRatio(1, high)).toBe(1);
  });

  it('holds steady at 60 fps', () => {
    const g = createGovernor(1.5);
    expect(run(g, 16.7, 30)).toEqual([]);
    expect(g.ratio).toBe(1.5);
  });

  it('steps the ratio down by 0.1 after 2 s slow, never below min, then downgrades once', () => {
    const g = createGovernor(1.2);
    // EMA crosses 18.5 ms within ~0.3 s at 30 fps, then 2 s of hold.
    expect(run(g, 33, 3.3)).toEqual(['ratio']);
    expect(g.ratio).toBeCloseTo(1.1, 10);
    run(g, 33, 20);
    expect(g.ratio).toBe(high.minPixelRatio);
    expect(g.downgraded).toBe(true);
    // Once per session: staying slow at min never downgrades again.
    expect(run(g, 33, 30)).not.toContain('downgrade');
  });

  it('downgrades only after 5 s at min while still slow', () => {
    const g = createGovernor(high.minPixelRatio);
    const actions = run(g, 33, 4.5);
    expect(actions).toEqual([]);
    expect(run(g, 33, 1.5)).toEqual(['downgrade']);
  });

  it('a fast device at min keeps its tier and climbs by 0.05 every 5 s up to max', () => {
    const g = createGovernor(high.minPixelRatio);
    expect(run(g, 8, 6)).toEqual(['ratio']);
    expect(g.ratio).toBeCloseTo(high.minPixelRatio + 0.05, 10);
    run(g, 8, 120);
    expect(g.ratio).toBe(high.maxPixelRatio);
    expect(g.downgraded).toBe(false);
  });

  it('a short spike does not change anything (hysteresis)', () => {
    const g = createGovernor(1.5);
    run(g, 16.7, 2);
    expect(run(g, 50, 0.5)).toEqual([]);
    expect(run(g, 16.7, 10)).toEqual([]);
    expect(g.ratio).toBe(1.5);
  });

  it('ignores non-positive dt', () => {
    const g = createGovernor(1);
    expect(stepGovernor(g, 0, high)).toBe('none');
    expect(g.ema).toBeCloseTo(1000 / 60, 10);
  });
});
