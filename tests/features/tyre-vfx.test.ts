/**
 * 11-01 tyre VFX: ring mapping from CornerFrame (radius, dot, past-limit), the plant's own limit on a live Manual Drive
 * simulation (rest, steady cornering, wheelspin, lock-up), the skid-mark ring buffer (spacing, breaks, wrap, clear),
 * no per-frame allocation, draw calls, and a 2-corner (motorcycle) frame drawing nothing.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS } from '../../src/contracts/drive';
import type { Simulation } from '../../src/contracts/sim';
import { createTelemetryFrame, type CornerFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { SIM_DT } from '../../src/contracts/units';
import type { MotorcycleDefinition } from '../../src/contracts/vehicle';
import { createMarks, MARK_SEGMENTS, MARK_SPACING } from '../../src/features/tyre-vfx/marks';
import { axleModels, createRingState, DOT_MAX, RING_RADIUS, ringOf, slipOverPeak } from '../../src/features/tyre-vfx/model';
import { createRings } from '../../src/features/tyre-vfx/rings';
import { createVfx } from '../../src/features/tyre-vfx/vfx';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { intent, makeSim, manualAtRest, steps } from '../fixtures/08-02-drive';

const models = axleModels(gtCoupe)!;
const corner = (o: Partial<CornerFrame>): CornerFrame => ({ load: 4000, capacity: models[0].staticCapacity, fx: 0, fy: 0, gripUse: 0, slipAngle: 0, slipRatio: 0, ...o }) as CornerFrame;

const run = (sim: Simulation, seconds: number, i: Parameters<typeof intent>[0]) => {
  for (let k = 0; k < steps(seconds); k++) {
    sim.drive!.setIntent(intent(i));
    sim.step(SIM_DT);
  }
  return sim.sample(1);
};
const rings = (t: TelemetryFrame, plant = true) => t.corners.map((c) => ringOf(c, models[c.axle === 'front' ? 0 : 1], plant, createRingState()));

describe('ring mapping', () => {
  it('derives the static capacity per axle from the vehicle; a motorcycle has no rings', () => {
    expect(models[0].staticCapacity).toBeGreaterThan(3000);
    expect(models[1].staticCapacity).toBeGreaterThan(3000);
    expect(models[0].coefficients?.peakSlip).toBeGreaterThan(1);
    expect(axleModels({ class: 'motorcycle' } as MotorcycleDefinition)).toBeNull();
  });

  it('radius = 0.25 m sqrt(capacity / static); dot = (fx, fy) / capacity * radius; unloaded = no ring', () => {
    const cap = models[0].staticCapacity;
    const s = ringOf(corner({ capacity: cap }), models[0], true, createRingState());
    expect(s.radius).toBeCloseTo(RING_RADIUS, 12);
    expect(ringOf(corner({ capacity: 4 * cap }), models[0], true, createRingState()).radius).toBeCloseTo(2 * RING_RADIUS, 12);
    const d = ringOf(corner({ capacity: cap, fx: -0.5 * cap, fy: 0.25 * cap }), models[0], true, createRingState());
    expect(d.dotX).toBeCloseTo(-0.5 * RING_RADIUS, 12);
    expect(d.dotY).toBeCloseTo(0.25 * RING_RADIUS, 12);
    const off = ringOf(corner({ capacity: 0, load: 0, fx: 100 }), models[0], true, createRingState());
    expect(off).toMatchObject({ radius: 0, dotX: 0, dotY: 0, past: false });
    const bad = ringOf(corner({ fx: Number.NaN }), models[0], true, createRingState());
    expect(bad.radius).toBe(0);
  });

  it('Auto: past the limit when the demand estimate exceeds the capacity; the dot is clamped at DOT_MAX', () => {
    const cap = models[0].staticCapacity;
    expect(ringOf(corner({ gripUse: 0.99, fy: 0.99 * cap }), models[0], false, createRingState()).past).toBe(false);
    const over = ringOf(corner({ gripUse: 1.2, fy: 3 * cap }), models[0], false, createRingState());
    expect(over.past).toBe(true);
    expect(Math.hypot(over.dotX, over.dotY)).toBeCloseTo(DOT_MAX * RING_RADIUS, 12);
    // Auto frames have no slip state: the plant criterion would never fire there
    expect(ringOf(corner({ gripUse: 1.2 }), models[0], true, createRingState()).past).toBe(false);
  });

  it('plant: past the limit exactly when the normalised slip passes the curve peak', () => {
    const k = models[0].coefficients!;
    // pure longitudinal slip at the nominal load: s = C_kappa kappa / D
    const load = gtCoupe.front.tyre.nominalLoad;
    const cap = 10_000;
    const kappaAtPeak = (k.peakSlip * cap) / k.c0Kappa;
    expect(slipOverPeak(corner({ load, capacity: cap, slipRatio: kappaAtPeak }), models[0])).toBeCloseTo(1, 9);
    expect(ringOf(corner({ load, capacity: cap, slipRatio: 0.98 * kappaAtPeak }), models[0], true, createRingState()).past).toBe(false);
    const past = ringOf(corner({ load, capacity: cap, slipRatio: -1.2 * kappaAtPeak }), models[0], true, createRingState());
    expect(past.past).toBe(true);
    expect(past.excess).toBeGreaterThan(0);
    expect(past.excess).toBeLessThanOrEqual(1);
  });
});

describe('rings on a live Manual Drive simulation', () => {
  it('at rest: every ring near the reference radius, none past the limit', () => {
    const sim = makeSim();
    manualAtRest(sim);
    const t = run(sim, 1, {});
    for (const r of rings(t)) {
      expect(r.radius).toBeGreaterThan(0.9 * RING_RADIUS);
      expect(r.radius).toBeLessThan(1.1 * RING_RADIUS);
      expect(r.past).toBe(false);
    }
  });

  it('steady cornering: outside rings larger than inside ones (load transfer), within the limit', () => {
    const sim = makeSim();
    manualAtRest(sim);
    run(sim, 4, { throttle: 0.35 });
    let t = sim.sample(1);
    for (let k = 0; k < steps(3); k++) {
      const u = t.drive.u;
      sim.drive!.setIntent(intent({ steer: 0.12, throttle: Math.max(0, Math.min(1, 0.25 * (14 - u) + 0.15)) }));
      sim.step(SIM_DT);
      t = sim.sample(1);
    }
    const r = rings(t);
    const by = (axle: string, side: number) => r[t.corners.findIndex((c) => c.axle === axle && c.side === side)]!;
    console.log(`[11-01] cornering at ${t.drive.u.toFixed(1)} m/s, a_y ${(t.ay / 9.81).toFixed(2)} g: radius front L/R ${by('front', 1).radius.toFixed(3)}/${by('front', -1).radius.toFixed(3)} m, rear L/R ${by("rear", 1).radius.toFixed(3)}/${by("rear", -1).radius.toFixed(3)} m on ${t.corners.map((c) => c.surface).join(",")}, loads ${t.corners.map((c) => c.load.toFixed(0)).join(",")} N`);
    expect(t.ay).toBeGreaterThan(2); // turning left
    expect(by('front', -1).radius).toBeGreaterThan(by('front', 1).radius * 1.05);
    expect(by('rear', -1).radius).toBeGreaterThan(by('rear', 1).radius * 1.05);
    expect(r.some((x) => x.past)).toBe(false);
    // the dots point to the left (lateral force towards the turn centre)
    expect(r.every((x) => x.dotY > 0)).toBe(true);
  });

  it('full throttle with the aids off spins the driven rear wheels past the limit; a locked brake does too', () => {
    const sim = makeSim();
    manualAtRest(sim);
    sim.drive!.setAids({ ...DEFAULT_AIDS, abs: false, traction: false, stability: false });
    const t = run(sim, 0.6, { throttle: 1 });
    const r = rings(t);
    const rear = t.corners.map((c, i) => (c.axle === 'rear' ? r[i]!.past : null)).filter((x) => x !== null);
    expect(rear).toEqual([true, true]);
    run(sim, 3, { throttle: 0.6 });
    const b = rings(run(sim, 0.4, { brake: 1 }));
    console.log(`[11-01] lock-up ABS off: past ${b.map((x) => x.past).join(',')}`);
    expect(b.filter((x) => x.past).length).toBeGreaterThanOrEqual(2);
  });
});

describe('skid marks', () => {
  it('lays quads only past the limit at the sample spacing; breaks; skips jumps; wraps; clears', () => {
    const m = createMarks('#000000', '#ffb454', 1);
    let x = 0;
    m.feed(0, x, 0, 0, true, 1, 0.12); // starts a streak, no quad yet
    expect(m.written).toBe(0);
    for (let k = 0; k < 10; k++) m.feed(0, (x += MARK_SPACING * 0.51), 0, 0, true, 1, 0.12);
    m.flush();
    expect(m.written).toBe(5);
    expect(m.mesh.visible).toBe(true);
    // edges perpendicular to the travel (+x): three z = -(y +- w)
    expect(m.positions[2]).toBeCloseTo(-0.12, 6);
    expect(m.positions[5]).toBeCloseTo(0.12, 6);
    m.feed(0, (x += 1), 0, 0, false, 1, 0.12); // back within the limit: the streak ends
    m.feed(0, (x += 1), 0, 0, true, 1, 0.12);
    m.feed(0, (x += 0.1), 0, 0, true, 1, 0.12);
    expect(m.written).toBe(5);
    m.feed(0, (x += 5), 0, 0, true, 1, 0.12); // a jump: no quad across it
    expect(m.written).toBe(5);
    for (let k = 0; k < MARK_SEGMENTS + 10; k++) m.feed(0, (x += MARK_SPACING * 1.05), 0, 0, true, 0.5, 0.12);
    m.flush();
    expect(m.written).toBe(5 + MARK_SEGMENTS + 10);
    expect(m.head).toBe((5 + MARK_SEGMENTS + 10) % MARK_SEGMENTS);
    expect(m.positions.every(Number.isFinite)).toBe(true);
    m.clear();
    expect(m.mesh.visible).toBe(false);
    expect(m.mesh.material.uniforms.uMinSeq!.value).toBe(m.written);
    m.feed(0, (x += 1), 0, 0, true, 1, 0.12);
    m.feed(0, (x += 1), 0, 0, true, 1, 0.12);
    m.flush();
    expect(m.mesh.visible).toBe(true);
  });

  it('non-finite patches never reach the buffer', () => {
    const m = createMarks('#000000', '#ffb454', 1);
    m.feed(0, 0, 0, 0, true, 1, 0.1);
    m.feed(0, Number.NaN, 0, 0, true, 1, 0.1);
    m.feed(0, 1, 0, 0, true, 1, 0.1);
    expect(m.written).toBe(0);
  });
});

describe('frame driver', () => {
  it('Auto: rings show the demand estimate, no marks; Manual sliding lays marks; 2 draw calls; no allocation', () => {
    const r = createRings('#edeef0', '#ffb454');
    const m = createMarks('#030304', '#ffb454');
    const vfx = createVfx(r, m);
    vfx.setVehicle(gtCoupe);
    // draw calls: instanced rings (visible + x-ray pass), one mark mesh (budget 1 + 4)
    expect([r.mesh, r.xray, m.mesh].length).toBeLessThanOrEqual(5);
    expect(r.xray.geometry).toBe(r.mesh.geometry);
    const sim = makeSim('proving-loop', 'double-wishbone', 20);
    sim.step(SIM_DT);
    vfx.update(sim.sample(1), true, false);
    expect(r.mesh.visible).toBe(true);
    expect(r.mesh.geometry.instanceCount).toBe(4);
    expect(r.data.every(Number.isFinite)).toBe(true);
    expect(m.written).toBe(0);
    // ring axes: unit and orthogonal
    for (let i = 0; i < 4; i++) {
      const o = i * 13;
      const f = r.data.subarray(o + 3, o + 6);
      const l = r.data.subarray(o + 6, o + 9);
      expect(Math.hypot(f[0]!, f[1]!, f[2]!)).toBeCloseTo(1, 6);
      expect(f[0]! * l[0]! + f[1]! * l[1]! + f[2]! * l[2]!).toBeCloseTo(0, 6);
    }
    manualAtRest(sim);
    sim.drive!.setAids({ ...DEFAULT_AIDS, traction: false, stability: false });
    let warned = false;
    for (let k = 0; k < 120; k++) {
      for (let j = 0; j < 4; j++) {
        sim.drive!.setIntent(intent({ throttle: 1 }));
        sim.step(SIM_DT);
      }
      vfx.update(sim.sample(1), true, false);
      warned ||= vfx.warn.some((w) => w === 1);
    }
    expect(m.written).toBeGreaterThan(10);
    expect(warned).toBe(true);
    // ring hidden: count 0
    vfx.update(sim.sample(1), false, false);
    expect(r.mesh.visible).toBe(false);
    expect(r.xray.visible).toBe(false);
    // allocation: the frame driver over many frames (the sim sample reused)
    const t = sim.sample(1);
    for (let k = 0; k < 20_000; k++) vfx.update(t, true, (k & 1) === 0); // warm-up (JIT, inline caches)
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < 20_000; k++) vfx.update(t, true, (k & 1) === 0);
    globalThis.gc?.();
    const delta = process.memoryUsage().heapUsed - before;
    console.log(`[11-01] vfx.update(): heap delta over 20000 frames ${delta} B`);
    expect(delta).toBeLessThan(64_000);
  });

  it('a 2-corner (motorcycle) frame draws nothing and lays no marks', () => {
    const r = createRings('#edeef0', '#ffb454');
    const m = createMarks('#030304', '#ffb454');
    const vfx = createVfx(r, m);
    vfx.setVehicle({ class: 'motorcycle' } as MotorcycleDefinition);
    expect(vfx.hasRings).toBe(false);
    const t = createTelemetryFrame('motorcycle', [
      { id: 'f', axle: 'front', side: 0 },
      { id: 'r', axle: 'rear', side: 0 },
    ]);
    t.drive.mode = 'manual';
    for (const c of t.corners) c.gripUse = 2;
    vfx.update(t, true, false);
    expect(r.mesh.visible).toBe(false);
    expect(m.written).toBe(0);
    // a car with a 2-corner frame (should never happen) also draws nothing
    vfx.setVehicle(gtCoupe);
    vfx.update(t, true, false);
    expect(r.mesh.visible).toBe(false);
  });
});
