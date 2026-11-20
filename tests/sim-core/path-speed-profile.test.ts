/** Speed profile gates (ARCHITECTURE §7.2.1 / ROADMAP 02-01): limits, periodicity, purity, lap time. */
import { describe, expect, it } from 'vitest';
import type { PathState } from '../../src/contracts/sim';
import type { TrackSample } from '../../src/contracts/track';
import { G } from '../../src/contracts/units';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { wrapAngle } from '../../src/sim-core/math/interp';
import { buildSpeedProfile } from '../../src/sim-core/path/speed-profile';
import { buildTrack } from '../../src/sim-core/track/build';
import { GT_DRAG_AREA, GT_LIMITS, GT_MASS } from '../fixtures/02-01-gt-limits';

const track = buildTrack(provingLoop);
const profile = buildSpeedProfile(track, GT_LIMITS, GT_DRAG_AREA, GT_MASS);
const newState = (): PathState => ({ lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });

/** States every 5 ms over one lap. */
const states: PathState[] = [];
for (let t = 0; t < profile.lapDuration; t += 0.005) states.push(profile.stateAt(t, newState()));

describe('speed profile on the proving loop (GT limits)', () => {
  it('laps in 65-85 s; reports the key numbers', () => {
    const v = states.map((s) => s.v);
    const ax = states.map((s) => s.ax);
    const ay = states.map((s) => Math.abs(s.ay));
    const lines = track.sections.map((sec) => {
      const t0 = profile.timeAtS(sec.s0);
      const t1 = sec.index === track.sections.length - 1 ? profile.lapDuration : profile.timeAtS(sec.s1);
      const inSec = states.filter((s) => s.sectionIndex === sec.index);
      const sv = inSec.map((s) => s.v);
      const say = inSec.map((s) => Math.abs(s.ay));
      return `${sec.id.padEnd(11)} t0 ${t0.toFixed(2).padStart(6)} s  dur ${(t1 - t0).toFixed(2).padStart(5)} s  v ${Math.min(...sv).toFixed(1)}-${Math.max(...sv).toFixed(1)} m/s  |ay| max ${(Math.max(...say) / G).toFixed(2)} g`;
    });
    console.log(
      [
        `lap ${profile.lapDuration.toFixed(2)} s over ${track.length.toFixed(1)} m (mean ${(track.length / profile.lapDuration).toFixed(1)} m/s)`,
        `v min ${Math.min(...v).toFixed(2)} max ${Math.max(...v).toFixed(2)} m/s; ay peak ${(Math.max(...ay) / G).toFixed(3)} g; ax ${(Math.min(...ax) / G).toFixed(3)} .. ${(Math.max(...ax) / G).toFixed(3)} g`,
        ...lines,
      ].join('\n'),
    );
    expect(profile.lapDuration).toBeGreaterThan(65);
    expect(profile.lapDuration).toBeLessThan(85);
  });

  it('respects lateral, longitudinal and combined friction limits everywhere', () => {
    const { lateral, accel, brake, vMax } = GT_LIMITS;
    for (const s of states) {
      expect(s.v).toBeGreaterThan(0);
      expect(s.v).toBeLessThanOrEqual(vMax + 1e-9);
      expect(Math.abs(s.ay)).toBeLessThanOrEqual(lateral * 1.01);
      expect(s.ax).toBeLessThanOrEqual(accel * 1.01);
      expect(s.ax).toBeGreaterThanOrEqual(-brake * 1.01);
      const axMax = s.ax >= 0 ? accel : brake;
      expect((s.ax / axMax) ** 2 + (s.ay / lateral) ** 2).toBeLessThanOrEqual(1.02);
      // Raw (unfiltered) lateral demand v^2 kappa also stays within the limit.
      expect(s.v * s.v * Math.abs(s.curvature)).toBeLessThanOrEqual(lateral * 1.01);
    }
  });

  it('honours section target speeds', () => {
    for (const s of states) {
      const target = track.sections[s.sectionIndex]!.def.targetSpeed;
      if (target !== undefined) expect(s.v).toBeLessThanOrEqual(target + 1e-9);
    }
  });

  it('is continuous and periodic over the lap', () => {
    const a = profile.stateAt(0, newState());
    const b = profile.stateAt(profile.lapDuration - 1e-9, newState());
    expect(Math.abs(a.s - b.s + track.length) % track.length).toBeLessThan(1e-6);
    expect(b.v).toBeCloseTo(a.v, 6);
    expect(b.ax).toBeCloseTo(a.ax, 4);
    expect(b.ay).toBeCloseTo(a.ay, 4);
    for (const t of [0.3, 17.1, 44.4]) {
      const p = profile.stateAt(t, newState());
      const q = profile.stateAt(t + 3 * profile.lapDuration, newState());
      expect(q.s).toBeCloseTo(p.s, 6);
      expect(q.v).toBeCloseTo(p.v, 6);
      expect(q.x).toBeCloseTo(p.x, 6);
    }
    // No jumps between 5 ms samples (positions move at most v * dt, speed changes at most a * dt).
    for (let i = 1; i < states.length; i++) {
      const p = states[i - 1]!;
      const q = states[i]!;
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(36 * 0.005 * 1.05);
      expect(Math.abs(q.v - p.v)).toBeLessThan(9 * 0.005);
      expect(Math.abs(wrapAngle(q.heading - p.heading))).toBeLessThan(0.02);
    }
  });

  it('stateAt is pure (same input -> same output, out object reused) and timeAtS inverts it within 1 ms', () => {
    const out = newState();
    const first = { ...profile.stateAt(23.456, out) };
    profile.stateAt(51.2, out);
    expect(profile.stateAt(23.456, out)).toEqual(first);
    expect(profile.stateAt(23.456, newState())).toEqual(first);
    for (let t = 0; t < profile.lapDuration; t += 0.731) {
      const s = profile.stateAt(t, out).s;
      expect(Math.abs(profile.timeAtS(s) - t)).toBeLessThan(1e-3);
    }
    expect(profile.timeAtS(0)).toBe(0);
    expect(profile.timeAtS(track.length)).toBe(0);
  });

  it('writes the driving line on the smooth road surface with §4 signs', () => {
    const smp: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
    const dlc = track.sections.find((s) => s.id === 'dlc')!;
    const p = profile.stateAt(profile.timeAtS(dlc.s0 + 160), newState());
    expect(p.l).toBeCloseTo(3.5, 6);
    track.sample(p.s, smp);
    expect(p.x).toBeCloseTo(smp.x - Math.sin(smp.heading) * p.l, 9);
    expect(p.y).toBeCloseTo(smp.y + Math.cos(smp.heading) * p.l, 9);
    expect(p.sectionIndex).toBe(dlc.index);
    // Right-hand carousel: curvature < 0 and ay < 0 (toward the right).
    const car = track.sections.find((s) => s.id === 'carousel')!;
    const c = profile.stateAt(profile.timeAtS((car.s0 + car.s1) / 2), newState());
    expect(c.curvature).toBeLessThan(0);
    expect(c.ay).toBeLessThan(-0.7 * GT_LIMITS.lateral);
    // Crest at the actual speed: |a_z| <= 0.6 g.
    const crest = track.sections.find((s) => s.id === 'crest')!;
    let worst = 0;
    for (let s = crest.s0; s < crest.s1; s += 0.25) {
      const st = profile.stateAt(profile.timeAtS(s), newState());
      const g1 = track.sample(s + 0.05, smp).grade;
      const g0 = track.sample(s - 0.05, smp).grade;
      worst = Math.max(worst, (st.v * st.v * Math.abs(g1 - g0)) / 0.1);
    }
    expect(worst).toBeLessThanOrEqual(0.6 * G);
  });
});
