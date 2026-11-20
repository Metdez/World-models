/**
 * The cafe racer through createSimulation (ARCHITECTURE §7.6, §7.7): a full lap, the brake zone and carousel
 * differences, seek determinism and agreement with the continuously driven state at many lap times, suspension swap,
 * golden hash. Prints the per-preset metric report used in the 05-01 SUMMARY.
 */
import { describe, expect, it } from 'vitest';
import type { SimCatalog, Simulation } from '../../src/contracts/sim';
import type { MotorcycleSuspensionDefinition, SuspensionDefinition } from '../../src/contracts/suspension';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { G, RAD_TO_DEG, SIM_DT } from '../../src/contracts/units';
import { cafeRacer } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { motoModern } from '../../src/sim-core/content/moto-modern';
import { motoTelelever } from '../../src/sim-core/content/moto-telelever';
import { createSimulation } from '../../src/sim-core/index';
import { frameLean } from '../../src/sim-core/moto/lean';
import { prepareMotoSuspension, trailOf } from '../../src/sim-core/moto/model';
import { WX, WZ } from '../../src/sim-core/moto/planar';

const PRESETS: readonly MotorcycleSuspensionDefinition[] = [motoClassic, motoModern, motoTelelever];
const byId: Record<string, SuspensionDefinition> = Object.fromEntries(PRESETS.map((s) => [s.id, s]));
const catalog: SimCatalog = {
  track: () => undefined,
  vehicle: (id) => (id === cafeRacer.id ? cafeRacer : undefined),
  suspension: (id) => byId[id],
};
const bike = (suspensionId: string, lapTime = 0): Simulation =>
  createSimulation({ catalog, trackId: 'proving-loop', vehicleId: 'cafe-racer', suspensionId, lapTime });
const crown = ((cafeRacer.front.tyre.crownRadius ?? 0) + (cafeRacer.rear.tyre.crownRadius ?? 0)) / 2;
const deg = (r: number) => (r * RAD_TO_DEG).toFixed(2);
const mm = (m: number) => (m * 1000).toFixed(1);

const finite = (f: TelemetryFrame): boolean =>
  [f.heave, f.pitch, f.roll, f.steer, f.trail, f.wheelbase, f.bodyPosition.x, f.bodyPosition.z, f.bodyRotation.w].every(Number.isFinite) &&
  f.corners.every(
    (c) =>
      [c.travel, c.load, c.springForce, c.damperForce, c.motionRatio, c.gripUse, c.wheelPosition.z, c.contactPatch.z, c.instantCentre.x].every(Number.isFinite) &&
      Array.from(c.points.subarray(0, 3 * c.pointOrder.length)).every(Number.isFinite),
  );

interface LapStats {
  lapDuration: number;
  brake: { t: number; ax: number; front: number; rear: number; pitch: number; trail: number };
  carousel: { roll: number; closed: number; ay: number };
  maxLean: number;
  events: Record<string, number>;
  frames: number;
  bad: number;
}

function lap(id: string): LapStats {
  const sim = bike(id);
  const n = Math.round(sim.lapDuration / SIM_DT);
  const st: LapStats = {
    lapDuration: sim.lapDuration,
    brake: { t: 0, ax: 0, front: 0, rear: 0, pitch: 0, trail: 0 },
    carousel: { roll: 0, closed: 0, ay: 0 },
    maxLean: 0,
    events: {},
    frames: 0,
    bad: 0,
  };
  const carousel: LapStats['carousel'][] = [];
  for (let k = 0; k < n; k++) {
    sim.step(SIM_DT);
    const f = sim.sample(1);
    st.frames++;
    if (!finite(f)) st.bad++;
    st.maxLean = Math.max(st.maxLean, Math.abs(f.roll));
    if (f.sectionId === 'brake-zone' && f.ax < st.brake.ax)
      st.brake = { t: f.lapTime, ax: f.ax, front: f.corners[0]!.travel, rear: f.corners[1]!.travel, pitch: f.pitch, trail: f.trail };
    if (f.sectionId === 'carousel') {
      const p = sim.stateAt(f.lapTime, { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });
      const gamma = Math.atan(f.ay / (G / Math.sqrt(1 + p.grade * p.grade))) + p.bank;
      carousel.push({ roll: f.roll, closed: -frameLean(gamma, cafeRacer.cgHeight, crown), ay: f.ay });
    }
    sim.drainEvents((e) => (st.events[e.kind] = (st.events[e.kind] ?? 0) + 1));
  }
  // The apex: the last frame at the steady peak (the tracker lags on turn-in by design).
  const peak = Math.max(...carousel.map((c) => Math.abs(c.ay)));
  st.carousel = carousel.filter((c) => Math.abs(c.ay) >= 0.995 * peak).at(-1)!;
  return st;
}

const laps = Object.fromEntries(PRESETS.map((s) => [s.id, lap(s.id)])) as Record<string, LapStats>;

describe('cafe racer on the proving loop', () => {
  it('all presets share one lap (the path does not depend on the suspension)', () => {
    const d = PRESETS.map((s) => laps[s.id]!.lapDuration);
    expect(new Set(d).size).toBe(1);
    const a = bike('moto-classic');
    const b = bike('moto-telelever');
    const pa = a.stateAt(30, { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });
    const pb = b.stateAt(30, { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });
    expect(pb).toEqual(pa);
  });

  it.each(PRESETS.map((s) => s.id))('%s: a full lap is finite with sections, a lap event and two corners', (id) => {
    const st = laps[id]!;
    expect(st.bad).toBe(0);
    expect(st.events.section).toBe(12);
    expect(st.events.lap).toBe(1);
    const f = bike(id).sample(1);
    expect(f.vehicleClass).toBe('motorcycle');
    expect(f.corners.map((c) => c.id)).toEqual(['f', 'r']);
    expect(f.corners[0]!.pointOrder.length).toBeGreaterThan(4);
    expect(Number.isNaN(f.axles[0]!.rollCentreHeight)).toBe(true);
  });

  it('brake zone: the classic fork compresses more than the Telelever at the same deceleration; trail falls less', () => {
    const c = laps['moto-classic']!.brake;
    const m = laps['moto-modern']!.brake;
    const t = laps['moto-telelever']!.brake;
    expect(c.ax).toBe(t.ax);
    expect(c.front).toBeGreaterThan(t.front + 0.02);
    expect(m.front).toBeGreaterThan(t.front + 0.02);
    expect(c.pitch).toBeGreaterThan(t.pitch);
    const drop = (id: string, b: LapStats['brake']) => prepareMotoSuspension(cafeRacer, byId[id] as MotorcycleSuspensionDefinition).kinematics.front.summary.trail - b.trail;
    expect(drop('moto-classic', c)).toBeGreaterThan(2 * drop('moto-telelever', t));
  });

  it('carousel (a right turn): the bike leans RIGHT, roll > 0 (left side up), within 1° of the closed form', () => {
    for (const s of PRESETS) {
      const k = laps[s.id]!.carousel;
      expect(k.ay).toBeLessThan(0);
      expect(k.roll).toBeGreaterThan(0);
      expect(Math.abs(k.roll - k.closed) * RAD_TO_DEG).toBeLessThan(1);
    }
  });
});

describe('seek (shared lap clock)', () => {
  it.each(PRESETS.map((s) => s.id))('%s: seek at 400 lap times keeps the state bounded and finite', (id) => {
    const sim = bike(id);
    const D = sim.lapDuration;
    const bad: string[] = [];
    for (let i = 0; i < 400; i++) {
      const t = (i / 400) * D;
      sim.seek(t);
      const f = sim.sample(1);
      const ok =
        finite(f) &&
        Math.abs(f.heave) < 0.1 &&
        Math.abs(f.pitch) < 0.15 &&
        Math.abs(f.roll) < 0.9 &&
        f.corners.every((c) => c.travel > -0.07 && c.travel < 0.12 && c.load >= 0) &&
        Math.abs(f.lapTime - t) < 1e-9;
      if (!ok) bad.push(t.toFixed(2));
    }
    expect(bad).toEqual([]);
  });

  it.each(PRESETS.map((s) => s.id))('%s: seek agrees with the continuously driven state (every 0.4 s of a lap) and is history-free', (id) => {
    const cont = bike(id);
    const seeker = bike(id);
    const D = cont.lapDuration;
    const every = Math.round(0.4 / SIM_DT);
    let maxTravel = 0;
    let maxRoll = 0;
    let maxPitch = 0;
    let n = 0;
    for (let k = 1; k * SIM_DT < D; k++) {
      cont.step(SIM_DT);
      if (k % every) continue;
      const fc = cont.sample(1);
      const want = [fc.corners[0]!.travel, fc.corners[1]!.travel, fc.roll, fc.pitch];
      seeker.seek(cont.lapTime);
      const fs = seeker.sample(1);
      maxTravel = Math.max(maxTravel, Math.abs(fs.corners[0]!.travel - want[0]!), Math.abs(fs.corners[1]!.travel - want[1]!));
      maxRoll = Math.max(maxRoll, Math.abs(fs.roll - want[2]!));
      maxPitch = Math.max(maxPitch, Math.abs(fs.pitch - want[3]!));
      n++;
    }
    console.log(`[moto] ${id} seek vs continuous at ${n} lap times: max |d travel| ${mm(maxTravel)} mm, |d roll| ${deg(maxRoll)} deg, |d pitch| ${deg(maxPitch)} deg`);
    expect(n).toBeGreaterThanOrEqual(200);
    expect(maxTravel).toBeLessThan(0.0005);
    expect(maxRoll).toBeLessThan(0.05 / RAD_TO_DEG);
    expect(maxPitch).toBeLessThan(0.05 / RAD_TO_DEG);
    // History-free: a fresh sim and the well-used seeker give bitwise-identical TRUE values at the same t.
    const t = 0.37 * D;
    seeker.seek(t);
    const a = seeker.sample(1);
    const fa = [a.heave, a.pitch, a.roll, a.steer, a.corners[0]!.travel, a.corners[1]!.load];
    const b = bike(id, t).sample(1);
    expect([b.heave, b.pitch, b.roll, b.steer, b.corners[0]!.travel, b.corners[1]!.load]).toEqual(fa);
  });

  it('setSuspension swaps in place: same frame object, state equal to a seek with the new preset', () => {
    const sim = bike('moto-classic', 4);
    const f0 = sim.sample(1);
    sim.setSuspension('moto-telelever');
    const f1 = sim.sample(1);
    expect(f1).toBe(f0);
    expect(f1.suspensionId).toBe('moto-telelever');
    const ref = bike('moto-telelever', 4).sample(1);
    expect(f1.corners[0]!.travel).toBeCloseTo(ref.corners[0]!.travel, 9);
    expect(f1.pitch).toBeCloseTo(ref.pitch, 9);
    expect(() => sim.setSuspension('double-wishbone')).toThrow();
  });

  it('switching vehicles car <-> bike keeps the lap fraction and changes the corner layout', () => {
    const sim = createSimulation({
      catalog: { track: () => undefined, vehicle: (id) => (id === cafeRacer.id ? cafeRacer : undefined), suspension: (id) => byId[id] },
      trackId: 'proving-loop',
      vehicleId: 'gt-coupe',
      suspensionId: 'double-wishbone',
      lapTime: 20,
    });
    const frac = sim.lapTime / sim.lapDuration;
    sim.setVehicle('cafe-racer');
    expect(sim.sample(1).corners.length).toBe(2);
    expect(sim.lapTime / sim.lapDuration).toBeCloseTo(frac, 9);
  });

  it('amplification changes POSE only and never the lean', () => {
    const sim = bike('moto-classic', 4);
    const a = sim.sample(1, 1);
    const one = { pitch: a.pitch, travel: a.corners[0]!.travel, z: a.corners[0]!.wheelPosition.z, q: { ...a.bodyRotation } };
    const b = sim.sample(1, 2.5);
    expect(b.pitch).toBe(one.pitch);
    expect(b.corners[0]!.travel).toBe(one.travel);
    expect(b.corners[0]!.wheelPosition.z).not.toBeCloseTo(one.z, 4);
    expect(b.amplification).toBe(2.5);
  });
});

describe('determinism golden (seed 42, 10 s)', () => {
  const GOLDEN: Record<string, string> = { 'moto-classic': 'd015332e', 'moto-modern': '49727a3b', 'moto-telelever': 'ef5f24be' };
  function hashRun(id: string): string {
    const sim = bike(id);
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      const q = Math.round(v * 1e6);
      for (const part of [q | 0, Math.floor(q / 4294967296) | 0]) {
        h ^= part;
        h = Math.imul(h, 0x01000193);
      }
    };
    for (let k = 0; k < 10 / SIM_DT; k++) {
      sim.step(SIM_DT);
      const f = sim.sample(0.5, k % 2 ? 2.5 : 1);
      for (const x of [f.lapTime, f.s, f.speed, f.roll, f.pitch, f.heave, f.steer, f.trail, f.wheelbase, f.bodyPosition.x, f.bodyPosition.z]) mix(x);
      for (const c of f.corners) {
        for (const x of [c.travel, c.load, c.springForce, c.damperForce, c.motionRatio, c.gripUse, c.wheelPosition.z, c.contactPatch.z]) mix(x);
        for (let i = 0; i < c.pointOrder.length * 3; i++) mix(c.points[i]!);
      }
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  it.each(Object.keys(GOLDEN))('%s hashes identically across runs and matches the recording', (id) => {
    const a = hashRun(id);
    console.log(`[moto] golden ${id} ${a}`);
    expect(hashRun(id)).toBe(a);
    expect(a).toBe(GOLDEN[id]);
  });
});

describe('metric report', () => {
  it('prints the per-preset numbers (all computed)', () => {
    const lines = ['| preset | AD | AS | trail static / brake peak | front / rear travel at brake peak | pitch | sag f / r | bounce | lean carousel / closed form |'];
    for (const s of PRESETS) {
      const m = prepareMotoSuspension(cafeRacer, s);
      const st = laps[s.id]!;
      const k = m.kinematics;
      // Bounce from the 2-DOF body modes on the series rates (same as moto.test.ts).
      const ser = (p: typeof m.front) => (p.wheelRate * p.tyreRate) / (p.wheelRate + p.tyreRate);
      const a = cafeRacer.cgToFront;
      const b = cafeRacer.wheelbase - a;
      const kf = ser(m.front);
      const kr = ser(m.rear);
      const ms = cafeRacer.sprungMass;
      const iy = cafeRacer.inertia.pitch;
      const kzz = kf + kr;
      const kzt = -(a * kf - b * kr);
      const ktt = a * a * kf + b * b * kr;
      const B = -(kzz * iy + ktt * ms);
      const C = kzz * ktt - kzt * kzt;
      const f1 = Math.sqrt((-B - Math.sqrt(B * B - 4 * ms * iy * C)) / (2 * ms * iy)) / (2 * Math.PI);
      lines.push(
        `| ${s.id} | ${(k.front.summary.antiPitch * 100).toFixed(0)} % | ${(k.rear.summary.antiPitch * 100).toFixed(0)} % | ${mm(k.front.summary.trail)} / ${mm(st.brake.trail)} mm | ${mm(st.brake.front)} / ${mm(st.brake.rear)} mm at ${(st.brake.ax / G).toFixed(2)} g | ${deg(st.brake.pitch)} deg | ${mm(m.front.droop)} (${((100 * m.front.droop) / m.front.table.travel).toFixed(0)} %) / ${mm(m.rear.droop)} (${((100 * m.rear.droop) / m.rear.table.travel).toFixed(0)} %) mm | ${f1.toFixed(2)} Hz | ${deg(st.carousel.roll)} / ${deg(st.carousel.closed)} deg |`,
      );
      // Trail against front travel with the frame held level (the mechanism alone).
      const r = new Float64Array(64);
      const head: [number, number] = [s.front.steeringHead[0], s.front.steeringHead[2]];
      const R = cafeRacer.front.tyre.radius - m.front.tyreDeflection;
      const trailAt = (w: number) => (m.front.table.sample(w, r), trailOf(r, head, 0, 0, r[WZ]! - R));
      lines.push(`|   level frame: trail at -20 / 0 / +40 mm travel: ${mm(trailAt(-0.02))} / ${mm(trailAt(0))} / ${mm(trailAt(0.04))} mm; wheelbase change at +40 mm ${mm(m.front.table.sample(0.04, r)[WX]! - m.front.table.sample(0, r)[WX]!)} mm; MR rear ${k.rear.curves.motionRatio[0]!.toFixed(3)} -> ${k.rear.curves.motionRatio[k.rear.curves.motionRatio.length - 1]!.toFixed(3)}; max lean ${deg(st.maxLean)} deg; events ${JSON.stringify(st.events)} |`);
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(1 + 2 * PRESETS.length);
  });
});
