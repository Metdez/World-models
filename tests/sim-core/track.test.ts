/** Plan-geometry gates for the proving loop (ARCHITECTURE §7.5). */
import { describe, expect, it } from 'vitest';
import type { TrackDefinition, TrackSample } from '../../src/contracts/track';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { integratePlan, primitiveLength } from '../../src/sim-core/track/closure';
import { buildTrack } from '../../src/sim-core/track/build';
import { wrapAngle } from '../../src/sim-core/math/interp';

const track = buildTrack(provingLoop);
const newSample = (): TrackSample => ({ s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 });

describe('proving loop plan', () => {
  it('closes in position (< 1 mm) and heading (< 1e-6 rad)', () => {
    const plan = integratePlan(track.def.segments);
    const n = plan.x.length - 1;
    expect(Math.hypot(plan.x[n]!, plan.y[n]!)).toBeLessThan(1e-3);
    expect(Math.abs(plan.psi[n]! + 2 * Math.PI)).toBeLessThan(1e-6); // clockwise: -360 deg
    // And through the public API, approaching the end from below.
    const a = track.sample(track.length - 1e-9, newSample());
    const b = track.sample(0, newSample());
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-3);
    expect(Math.abs(wrapAngle(a.heading - b.heading))).toBeLessThan(1e-6);
  });

  it('solves both closure straights longer than 50 m and a total of 1.3-1.7 km', () => {
    for (const id of provingLoop.closure) {
      const sec = track.sections.find((x) => x.id === id)!;
      expect(sec.s1 - sec.s0).toBeGreaterThan(50);
    }
    expect(track.length).toBeGreaterThan(1300);
    expect(track.length).toBeLessThan(1700);
    console.log(
      `lap length ${track.length.toFixed(2)} m; ` + track.sections.map((s) => `${s.id} ${(s.s1 - s.s0).toFixed(1)}`).join(', '),
    );
  });

  it('keeps >= 30 m between non-adjacent sections', () => {
    const pts = track.sections.map((sec) => {
      const out: [number, number][] = [];
      for (let s = sec.s0; s <= sec.s1; s += 2) {
        const p = track.sample(Math.min(s, sec.s1 - 1e-6), newSample());
        out.push([p.x, p.y]);
      }
      return out;
    });
    const n = pts.length;
    let min = Infinity;
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // adjacent across the start line
        for (const [ax, ay] of pts[i]!) for (const [bx, by] of pts[j]!) min = Math.min(min, Math.hypot(ax - bx, ay - by));
      }
    console.log(`min clearance between non-adjacent sections ${min.toFixed(1)} m`);
    expect(min).toBeGreaterThanOrEqual(30);
  });

  it('has continuous curvature everywhere, including every primitive joint', () => {
    const p = newSample();
    let prev = track.sample(0, newSample()).curvature;
    let maxJump = 0;
    for (let s = 0.01; s < track.length; s += 0.01) {
      const k = track.sample(s, p).curvature;
      maxJump = Math.max(maxJump, Math.abs(k - prev));
      prev = k;
    }
    // Steepest clothoid: (1/20) / 15 m = 0.0033 /m^2, so a 1 cm step changes kappa by < 4e-5.
    expect(maxJump).toBeLessThan(5e-5);
    let s = 0;
    for (const seg of track.def.segments)
      for (const prim of seg.primitives) {
        s += primitiveLength(prim);
        const k0 = track.sample(s - 1e-7, newSample()).curvature;
        const k1 = track.sample(s + 1e-7, newSample()).curvature;
        expect(Math.abs(k1 - k0)).toBeLessThan(1e-6);
      }
  });

  it('is parameterised by arc length: chord sum, heading and curvature agree with sample()', () => {
    const a = newSample();
    const b = newSample();
    let sum = 0;
    let maxHeadingErr = 0;
    let maxKappaErr = 0;
    const n = Math.round(track.length / 0.05);
    const ds = track.length / n;
    track.sample(0, a);
    for (let i = 1; i <= n; i++) {
      const s = i * ds;
      track.sample(s, b);
      sum += Math.hypot(b.x - a.x, b.y - a.y);
      const chordHeading = Math.atan2(b.y - a.y, b.x - a.x);
      maxHeadingErr = Math.max(maxHeadingErr, Math.abs(wrapAngle(chordHeading - wrapAngle(a.heading + 0.5 * a.curvature * ds))));
      maxKappaErr = Math.max(maxKappaErr, Math.abs(wrapAngle(b.heading - a.heading) / ds - 0.5 * (a.curvature + b.curvature)));
      track.sample(s, a);
    }
    expect(Math.abs(sum - track.length)).toBeLessThan(1e-3);
    expect(maxHeadingErr).toBeLessThan(1e-5);
    // Trapezoid on kappa is exact except in steps that straddle a clothoid/arc joint (kink in kappa).
    expect(maxKappaErr).toBeLessThan(5e-5);
  });

  it('wraps s, resolves sections and props, and offsets the driving line', () => {
    expect(track.sections.map((s) => s.id)).toEqual(provingLoop.segments.map((s) => s.id));
    expect(track.sections[0]!.s0).toBe(0);
    expect(track.sections.at(-1)!.s1).toBeCloseTo(track.length, 9);
    for (const sec of track.sections) {
      expect(track.sectionIndexAt((sec.s0 + sec.s1) / 2)).toBe(sec.index);
      expect(track.sectionIndexAt((sec.s0 + sec.s1) / 2 + track.length)).toBe(sec.index);
    }
    expect(track.sectionIndexAt(-1)).toBe(track.sections.length - 1);
    const dlc = track.sections.find((s) => s.id === 'dlc')!;
    expect(track.lineOffset(dlc.s0 + 160)).toBeCloseTo(3.5, 9);
    expect(track.lineOffset(dlc.s0 + 50)).toBe(0);
    const cones = track.props.filter((p) => p.kind === 'cone');
    expect(cones.length).toBe(18);
    for (const c of cones) expect(track.sectionIndexAt(c.s)).toBe(dlc.index);
    expect(track.props.find((p) => p.kind === 'start-line')!.s).toBe(0);
    // Start line at origin heading +X.
    const p0 = track.sample(0, newSample());
    expect([p0.x, p0.y, p0.heading]).toEqual([0, 0, 0]);
    // toWorld: l is a horizontal offset along the left normal.
    const c = track.sample(500, newSample());
    const w = track.toWorld(500, 2, { x: 0, y: 0, z: 0 });
    expect(w.x).toBeCloseTo(c.x - 2 * Math.sin(c.heading), 9);
    expect(w.y).toBeCloseTo(c.y + 2 * Math.cos(c.heading), 9);
    expect(w.z).toBe(track.roadHeight(500, 2));
  });

  it('turns right where the content says right (clockwise loop, signs per §4)', () => {
    const k = (id: string): number => {
      const sec = track.sections.find((s) => s.id === id)!;
      return track.sample((sec.s0 + sec.s1) / 2, newSample()).curvature;
    };
    expect(k('hairpin')).toBeCloseTo(-1 / 20, 9);
    expect(k('carousel')).toBeCloseTo(-1 / 45, 9);
    expect(k('sweeper')).toBeCloseTo(1 / 120, 9);
  });

  it('uses no digits in names or captions (copy honesty)', () => {
    for (const seg of provingLoop.segments) {
      expect(seg.name).not.toMatch(/\d/);
      expect(seg.caption).not.toMatch(/\d/);
    }
    expect(provingLoop.name).not.toMatch(/\d/);
  });

  it('rejects a layout whose heading does not close', () => {
    const bad: TrackDefinition = { ...provingLoop, segments: provingLoop.segments.filter((s) => s.id !== 'hairpin') };
    expect(() => buildTrack(bad)).toThrow(/net turn/);
  });
});
