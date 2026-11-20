import { describe, expect, it } from 'vitest';
import { SEEK_SETTLE_S, type PathState, type SimCatalog, type SimEvent, type Simulation } from '../../src/contracts/sim';
import type { MotorcycleSuspensionDefinition } from '../../src/contracts/suspension';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import type { BuiltTrack } from '../../src/contracts/track';
import { G, RAD_TO_DEG, SIM_DT } from '../../src/contracts/units';
import type { MotorcycleDefinition } from '../../src/contracts/vehicle';
import { createCarModel } from '../../src/sim-core/car/car-model';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createSimulation } from '../../src/sim-core/index';
import { buildSpeedProfile } from '../../src/sim-core/path/speed-profile';

const SUSPENSIONS = ['macpherson', 'double-wishbone', 'multilink'] as const;
const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const make = (suspensionId: string = 'double-wishbone', lapTime?: number, catalog: SimCatalog = empty): Simulation =>
  createSimulation({ catalog, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId, ...(lapTime === undefined ? {} : { lapTime }) });
const newPath = (o: Partial<PathState> = {}): PathState => ({
  lapTime: 0,
  s: 0,
  l: 0,
  v: 0,
  ax: 0,
  ay: 0,
  curvature: 0,
  heading: 0,
  x: 0,
  y: 0,
  z: 0,
  bank: 0,
  grade: 0,
  sectionIndex: 0,
  ...o,
});
const run = (sim: Simulation, seconds: number, each?: (f: TelemetryFrame) => void): void => {
  for (let k = Math.round(seconds / SIM_DT); k > 0; k--) {
    sim.step(SIM_DT);
    if (each) each(sim.sample(1));
  }
};
/** Every TRUE (physical) field of a frame, JSON-safe; POSE fields excluded. */
const trueFields = (f: TelemetryFrame) => ({
  lapTime: f.lapTime,
  s: f.s,
  speed: f.speed,
  ax: f.ax,
  ay: f.ay,
  roll: f.roll,
  pitch: f.pitch,
  heave: f.heave,
  steer: f.steer,
  wheelbase: f.wheelbase,
  trail: f.trail,
  corners: f.corners.map((c) => [
    c.travel,
    c.travelRate,
    c.camber,
    c.camberBody,
    c.toe,
    c.steer,
    c.load,
    c.springForce,
    c.damperForce,
    c.motionRatio,
    c.gripUse,
    c.stop,
  ]),
  axles: f.axles.map((a) => [a.rollCentreHeight, a.antiPitch]),
});
const poseFields = (f: TelemetryFrame) => ({
  body: [f.bodyPosition, f.bodyRotation],
  corners: f.corners.map((c) => [c.wheelPosition, c.wheelRotation, c.contactPatch, c.instantCentre, Array.from(c.points), c.springLength, c.spin]),
  axles: f.axles.map((a) => a.rollCentre),
});

/** Flat, straight, featureless road for closed-form checks of the car model. */
const flat = {
  def: { swell: { amplitude: 0, cycles: 0 } },
  length: 1e4,
  sections: [],
  props: [],
  sectionIndexAt: () => 0,
  sample: (s: number, o: object) => Object.assign(o, { s, x: s, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 }),
  lineOffset: () => 0,
  roadHeight: () => 0,
  toWorld: (s: number, l: number, o: object) => Object.assign(o, { x: s, y: l, z: 0 }),
} as unknown as BuiltTrack;
const blankFrame = (sim: Simulation) => sim.sample(1); // a correctly shaped frame to sample a bare model into

describe('createSimulation (§7.6)', () => {
  it('stateAt is pure, periodic, identical for every suspension type and inverted by lapTimeAt', () => {
    const sims = SUSPENSIONS.map((id) => make(id, 12));
    const [a, b, c] = sims as [Simulation, Simulation, Simulation];
    const D = a.lapDuration;
    expect(D).toBeGreaterThan(65);
    expect(D).toBeLessThan(85);
    const before = JSON.stringify(trueFields(a.sample(1)));
    const p1 = a.stateAt(40.5, newPath());
    expect(a.lapTime).toBe(12);
    expect(JSON.stringify(trueFields(a.sample(1)))).toBe(before); // no side effects
    expect(a.stateAt(40.5, newPath())).toEqual(p1);
    expect(a.stateAt(40.5 + 3 * D, newPath()).s).toBeCloseTo(p1.s, 6);
    for (const sim of [b, c]) {
      expect(sim.lapDuration).toBe(D);
      expect(sim.stateAt(40.5, newPath())).toEqual(p1);
    }
    // Also identical to the speed profile on its own (stateAt delegates, no suspension input).
    const profile = buildSpeedProfile(a.track, gtCoupe.limits, gtCoupe.dragArea, gtCoupe.mass);
    expect(profile.stateAt(40.5, newPath())).toEqual(p1);
    expect(a.lapTimeAt(p1.s)).toBeCloseTo(40.5, 3);
  });

  it('seek(t) is a pure function of t: same state whatever ran before (server-time sync)', () => {
    const fresh = make('double-wishbone');
    const busy = make('double-wishbone', 30);
    run(busy, 7.3);
    busy.setSuspension('macpherson');
    run(busy, 1);
    busy.setSuspension('double-wishbone');
    const t0 = busy.simTime;
    for (const t of [3.2, 49.9, 61.0, 83.0]) {
      fresh.seek(t);
      busy.seek(t);
      expect(busy.lapTime).toBe(t);
      const f = trueFields(fresh.sample(0));
      expect(f.lapTime).toBe(t); // after a seek the frame shows exactly t (alpha ignored until the next step)
      expect(JSON.stringify(trueFields(busy.sample(0.37)))).toBe(JSON.stringify(f));
      run(fresh, 0.5);
      run(busy, 0.5);
      expect(JSON.stringify(trueFields(busy.sample(1)))).toBe(JSON.stringify(trueFields(fresh.sample(1))));
    }
    expect(busy.simTime).toBeCloseTo(t0 + 4 * (SEEK_SETTLE_S + 0.5), 6); // simTime includes the pre-roll
  });

  it('seek pre-roll converges to the continuously driven state', () => {
    const cont = make('double-wishbone', 0);
    const probe = make('double-wishbone', 0);
    const D = cont.lapDuration;
    let worstRoll = 0;
    let worstTravel = 0;
    let worstAt = '';
    const smooth = new Set(['brake-zone', 'hairpin', 'sweeper', 'chicane', 'carousel', 'dlc', 'off-camber', 'run-in']);
    let rough = 0;
    // First lap from rest, then compare every 2 s of the second lap.
    run(cont, D);
    for (let k = 0; k < Math.floor(D / 2); k++) {
      run(cont, 2);
      const t = cont.lapTime;
      probe.seek(t);
      const a = cont.sample(1);
      const b = probe.sample(1);
      expect(b.lapTime).toBeCloseTo(a.lapTime, 6);
      const dRoll = Math.abs(a.roll - b.roll) * RAD_TO_DEG;
      const dTravel = Math.max(...a.corners.map((c, i) => Math.abs(c.travel - b.corners[i]!.travel)));
      if (!smooth.has(a.sectionId)) {
        rough = Math.max(rough, dTravel);
        continue;
      }
      if (dTravel > worstTravel) worstAt = `${a.sectionId}@${t.toFixed(1)}`;
      worstRoll = Math.max(worstRoll, dRoll);
      worstTravel = Math.max(worstTravel, dTravel);
    }
    console.log(
      `[sim] seek vs continuous (every 2 s, smooth sections): max |d roll| ${worstRoll.toFixed(4)} deg, max |d travel| ${(worstTravel * 1000).toFixed(2)} mm (${worstAt}); rough sections max |d travel| ${(rough * 1000).toFixed(2)} mm`,
    );
    expect(worstRoll).toBeLessThan(0.05);
    expect(worstTravel).toBeLessThan(0.001);
  });

  it('setSuspension keeps the path, frame object and interpolation; equals a seek with that suspension', () => {
    const sim = make('double-wishbone', 50);
    run(sim, 0.3);
    const frame = sim.sample(0.5);
    const before = { s: frame.s, lapTime: frame.lapTime, x: frame.bodyPosition.x, y: frame.bodyPosition.y, roll: frame.roll };
    const simTime = sim.simTime;
    sim.setSuspension('macpherson');
    const after = sim.sample(0.5);
    expect(after).toBe(frame);
    expect(after.suspensionId).toBe('macpherson');
    expect(sim.simTime).toBe(simTime);
    expect(after.s).toBe(before.s);
    expect(after.lapTime).toBe(before.lapTime);
    expect(Math.hypot(after.bodyPosition.x - before.x, after.bodyPosition.y - before.y)).toBeLessThan(1e-9);
    expect(Math.abs(after.roll - before.roll) * RAD_TO_DEG).toBeLessThan(0.3); // only the type difference remains
    const ref = make('macpherson');
    ref.seek(sim.lapTime);
    expect(JSON.stringify(trueFields(sim.sample(1)))).toBe(JSON.stringify(trueFields(ref.sample(1))));
    run(sim, 0.1);
    run(ref, 0.1);
    expect(JSON.stringify(trueFields(sim.sample(1)))).toBe(JSON.stringify(trueFields(ref.sample(1))));
  });

  it('class mismatches throw; a failed setVehicle leaves the car running; setVehicle keeps the lap fraction', () => {
    const motoSusp = { ...doubleWishbone, id: 'moto-x', vehicleClass: 'motorcycle' } as unknown as MotorcycleSuspensionDefinition;
    const moto = { ...gtCoupe, id: 'bike', class: 'motorcycle', suspensions: ['moto-x'], defaultSuspension: 'moto-x' } as unknown as MotorcycleDefinition;
    const catalog: SimCatalog = {
      track: () => undefined,
      vehicle: (id) => (id === 'bike' ? moto : undefined),
      suspension: (id) => (id === 'moto-x' ? motoSusp : undefined),
    };
    const sim = make('double-wishbone', 20, catalog);
    expect(() => sim.setSuspension('moto-x')).toThrow(/motorcycle/);
    expect(sim.suspension.id).toBe('double-wishbone');
    // The fake bike is a relabelled car definition: the real motorcycle model (05-01) rejects it.
    expect(() => sim.setVehicle('bike')).toThrow();
    expect(sim.vehicle.id).toBe('gt-coupe');
    const frame = sim.sample(1);
    const fraction = sim.lapTime / sim.lapDuration;
    sim.setVehicle('gt-coupe', 'multilink');
    expect(sim.suspension.id).toBe('multilink');
    expect(sim.lapTime / sim.lapDuration).toBeCloseTo(fraction, 9);
    expect(sim.sample(1)).not.toBe(frame);
  });

  it('amplification scales POSE only; TRUE fields are identical', () => {
    const sim = make('macpherson', 50); // carousel: roll and travel present
    run(sim, 0.2);
    const t1 = JSON.stringify(trueFields(sim.sample(0.4, 1)));
    const p1 = JSON.stringify(poseFields(sim.sample(0.4, 1)));
    const amp = sim.sample(0.4, 2.5);
    expect(amp.amplification).toBe(2.5);
    expect(JSON.stringify(trueFields(amp))).toBe(t1);
    expect(JSON.stringify(poseFields(amp))).not.toBe(p1);
    const back = sim.sample(0.4, 1);
    expect(back.amplification).toBe(1);
    expect(JSON.stringify(poseFields(back))).toBe(p1);
  });

  it('events: sections once per lap in order, lap once, per-corner events at least 0.5 s apart', () => {
    const sim = make('double-wishbone', 0);
    const events: { t: number; e: SimEvent }[] = [];
    let t = 0;
    for (let k = Math.round((sim.lapDuration + 1) / SIM_DT); k > 0; k--) {
      sim.step(SIM_DT);
      t += SIM_DT;
      sim.drainEvents((e) => events.push({ t, e }));
    }
    const sections = events.filter((x) => x.e.kind === 'section').map((x) => (x.e as { id: string }).id);
    expect(sections).toEqual([...sim.track.sections.slice(1), sim.track.sections[0]!].map((s) => s.id));
    expect(events.filter((x) => x.e.kind === 'lap').map((x) => x.e)).toEqual([{ kind: 'lap', lap: 1, duration: sim.lapDuration }]);
    const last = new Map<string, number>();
    const counts: Record<string, number> = {};
    for (const { t: te, e } of events) {
      if (!('corner' in e)) continue;
      const key = `${e.kind}/${e.corner}`;
      counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      const prev = last.get(key);
      if (prev !== undefined) expect(te - prev).toBeGreaterThanOrEqual(0.5);
      last.set(key, te);
    }
    console.log(`[sim] events over one lap: ${JSON.stringify(counts)}`);
    let drained = 0;
    sim.drainEvents(() => drained++);
    expect(drained).toBe(0);
  });

  it('a full lap is finite and stable, wheels stay on the road, step cost', () => {
    const sim = make('macpherson', 0);
    const n = Math.round(sim.lapDuration / SIM_DT);
    let maxRoll = 0;
    let maxGap = 0;
    let gapAt = '';
    const roadAt = (f: TelemetryFrame, i: number): number => {
      const c = f.corners[i]!.contactPatch;
      const p = sim.stateAt(f.lapTime, newPath());
      const dx = (c.x - p.x) * Math.cos(p.heading) + (c.y - p.y) * Math.sin(p.heading);
      const dy = -(c.x - p.x) * Math.sin(p.heading) + (c.y - p.y) * Math.cos(p.heading);
      return sim.track.roadHeight(p.s + dx, p.l + dy);
    };
    const onRoad = new Set(['brake-zone', 'hairpin', 'sweeper', 'carousel', 'off-camber']);
    run(sim, sim.lapDuration, (f) => {
      maxRoll = Math.max(maxRoll, Math.abs(f.roll));
      for (const c of f.corners) {
        for (const v of [c.travel, c.load, c.camber, c.toe, c.gripUse, c.springForce, c.wheelPosition.z, c.points[0]!]) expect(Number.isFinite(v)).toBe(true);
        expect(c.load).toBeGreaterThanOrEqual(0);
        expect(c.travel).toBeGreaterThan(-0.095);
        expect(c.travel).toBeLessThan(0.095);
      }
      if (onRoad.has(f.sectionId) && Math.round(f.lapTime / SIM_DT) % 24 === 0) {
        for (let i = 0; i < 4; i++) {
          const gap = Math.abs(f.corners[i]!.contactPatch.z - roadAt(f, i));
          if (gap > maxGap) gapAt = `${f.sectionId} ${f.corners[i]!.id}`;
          maxGap = Math.max(maxGap, gap);
        }
      }
    });
    console.log(
      `[sim] lap: max |roll| ${(maxRoll * RAD_TO_DEG).toFixed(2)} deg; contact patch vs drawn road (smooth sections) max ${(maxGap * 1000).toFixed(1)} mm (${gapAt})`,
    );
    expect(maxRoll * RAD_TO_DEG).toBeLessThan(4);
    expect(maxGap).toBeLessThan(0.01);

    // Step cost: the kernel runs 240 steps and ~60 samples per second.
    const timed = make('double-wishbone', 0);
    let t0 = performance.now();
    for (let k = 0; k < n; k++) timed.step(SIM_DT);
    const stepUs = ((performance.now() - t0) * 1000) / n;
    t0 = performance.now();
    for (let k = 0; k < 5000; k++) timed.sample(k / 5000, 1);
    const sampleUs = ((performance.now() - t0) * 1000) / 5000;
    t0 = performance.now();
    timed.seek(30);
    const seekMs = performance.now() - t0;
    console.log(
      `[sim] cost: step ${stepUs.toFixed(2)} us, sample ${sampleUs.toFixed(2)} us, seek (1.5 s pre-roll) ${seekMs.toFixed(2)} ms; per simulated second ${((240 * stepUs + 60 * sampleUs) / 1000).toFixed(2)} ms`,
    );
    expect(stepUs).toBeLessThan(50);
    expect(sampleUs).toBeLessThan(100);
  });
});

describe('car model physics (flat road, closed-form checks)', () => {
  const equilibrium = (susp = doubleWishbone, o: Partial<PathState> = {}) => {
    const model = createCarModel(gtCoupe, susp, flat);
    const path = newPath(o);
    model.reset(path);
    const f = blankFrame(make(susp.id));
    model.sample(1, 1, path, f);
    return f;
  };

  it('static: loads carry the weight, zero travel, contact patches on the ground, wheel centres at the loaded radius', () => {
    const f = equilibrium();
    const sumLoad = f.corners.reduce((a, c) => a + c.load, 0);
    const unsprung = 2 * gtCoupe.front.unsprungMass + 2 * gtCoupe.rear.unsprungMass;
    expect(sumLoad).toBeCloseTo((gtCoupe.sprungMass + unsprung) * G, 3);
    for (const c of f.corners) {
      expect(Math.abs(c.travel)).toBeLessThan(1e-9);
      expect(Math.abs(c.contactPatch.z)).toBeLessThan(0.0025); // mean static tyre deflection places the body
      expect(c.camber).toBeCloseTo(c.axle === 'front' ? -1.5 / RAD_TO_DEG : -1.2 / RAD_TO_DEG, 6);
    }
    expect(f.roll).toBeCloseTo(0, 12);
  });

  it('signs (§4): left turn rolls the body left-side-up and loads the right wheels; braking pitches nose down', () => {
    const left = equilibrium(doubleWishbone, { ay: 0.5 * G });
    expect(left.roll).toBeGreaterThan(0);
    expect(left.corners[1]!.travel).toBeGreaterThan(0);
    expect(left.corners[1]!.load).toBeGreaterThan(left.corners[0]!.load);
    expect(left.corners[1]!.camber).toBeGreaterThan(left.corners[1]!.camberBody); // outer (right) wheel tilts out with the roll
    const brake = equilibrium(doubleWishbone, { ax: -0.8 * G });
    expect(brake.pitch).toBeGreaterThan(0);
    expect(brake.corners[0]!.load).toBeGreaterThan(brake.corners[2]!.load);
  });

  it('anti-roll stiffness: double wishbone suspension roll gradient in the 1.0-1.2 deg/g band', () => {
    const rows = [macpherson, doubleWishbone, multilink].map((s) => {
      const f = equilibrium(s, { ay: 0.5 * G });
      const c = f.corners;
      const tF = c[0]!.contactPatch.y - c[1]!.contactPatch.y;
      const tR = c[2]!.contactPatch.y - c[3]!.contactPatch.y;
      // Body relative to the axles (springs + ARB only) and relative to the road (incl. tyre compliance).
      const suspension = ((c[1]!.travel - c[0]!.travel) / tF + (c[3]!.travel - c[2]!.travel) / tR) / 2;
      return { id: s.id, suspension: (suspension * RAD_TO_DEG) / 0.5, total: (f.roll * RAD_TO_DEG) / 0.5 };
    });
    console.log(
      `[sim] roll gradient deg/g (suspension / incl. tyres): ${rows.map((r) => `${r.id} ${r.suspension.toFixed(3)} / ${r.total.toFixed(3)}`).join(', ')}`,
    );
    const dw = rows[1]!;
    expect(dw.suspension).toBeGreaterThanOrEqual(1.0);
    expect(dw.suspension).toBeLessThanOrEqual(1.2);
    // Higher roll centre, less roll: MacPherson < double wishbone < multi-link.
    expect(rows[0]!.total).toBeLessThan(rows[1]!.total);
    expect(rows[1]!.total).toBeLessThan(rows[2]!.total);
  });
});
