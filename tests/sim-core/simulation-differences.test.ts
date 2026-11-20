/**
 * Honest-difference evidence: the three suspension types driven over the SAME lap (identical path), measured at the
 * showcase sections. Asserts only what the model actually shows; the printed table is copied into 02-04-SUMMARY.md.
 */
import { describe, expect, it } from 'vitest';
import type { PathState, SimCatalog, Simulation } from '../../src/contracts/sim';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { RAD_TO_DEG, SIM_DT } from '../../src/contracts/units';
import { createSimulation } from '../../src/sim-core/index';

const TYPES = ['macpherson', 'double-wishbone', 'multilink'] as const;
type Row = Record<string, number>;
const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const deg = (rad: number) => rad * RAD_TO_DEG;
const newPath = (): PathState => ({
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
});

/** Camber of a corner to the road plane (path frame incl. bank) read back from the POSED wheel orientation. */
function posedCamberToRoad(f: TelemetryFrame, i: number, p: PathState): number {
  const q = f.corners[i]!.wheelRotation;
  // Wheel spin axis = q * (0, 1, 0); road normal = Rz(heading) * Rx(bank) * (0, 0, 1).
  const ax = 2 * (q.x * q.y - q.w * q.z);
  const ay = 1 - 2 * (q.x * q.x + q.z * q.z);
  const az = 2 * (q.y * q.z + q.w * q.x);
  const n = [Math.sin(p.heading) * Math.sin(p.bank), -Math.cos(p.heading) * Math.sin(p.bank), Math.cos(p.bank)] as const;
  const dot = ax * n[0] + ay * n[1] + az * n[2];
  return f.corners[i]!.side > 0 ? -Math.asin(dot) : Math.asin(dot);
}

/** Road-surface deviation (features + roughness) under each contact patch: roadHeight minus the smooth surface. */
function featureUnderWheels(sim: Simulation, f: TelemetryFrame): number[] {
  const p = sim.stateAt(f.lapTime, newPath());
  const ts = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  return f.corners.map((c) => {
    const dx = (c.contactPatch.x - p.x) * Math.cos(p.heading) + (c.contactPatch.y - p.y) * Math.sin(p.heading);
    const dy = -(c.contactPatch.x - p.x) * Math.sin(p.heading) + (c.contactPatch.y - p.y) * Math.cos(p.heading);
    const s = p.s + dx;
    const l = p.l + dy;
    sim.track.sample(s, ts);
    return sim.track.roadHeight(s, l) - ts.z - l * Math.tan(ts.bank);
  });
}

function lap(id: string): Row {
  const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: id, lapTime: 0 });
  const section = (sid: string) => sim.track.sections.find((s) => s.id === sid)!;
  const apex = (sid: string) => sim.lapTimeAt((section(sid).s0 + section(sid).s1) / 2);
  const tHairpin = apex('hairpin');
  const tCarousel = apex('carousel');
  const bump = section('bump-strip');
  const pave = section('pave');
  const r: Row = {
    brakePitch: 0,
    bumpToe: 0,
    bumpTravel: 0,
    kerbToe: 0,
    kerbTravelR: 0,
    kerbTravelL: 0,
    bumpRoad: 0,
    potholeRoad: 0,
    kerbRoadR: 0,
    kerbRoadL: 0,
  };
  let toeRef = NaN;
  let toeRefKerb = NaN;
  let pave2 = 0;
  let paveLoad = 0;
  let paveN = 0;
  let h1 = NaN;
  let h2 = NaN;
  let paveAcc = 0;
  let paveAccN = 0;
  const n = Math.round(sim.lapDuration / SIM_DT);
  for (let k = 0; k < n; k++) {
    const before = sim.lapTime;
    sim.step(SIM_DT);
    const f = sim.sample(1);
    sim.drainEvents(() => {});
    const c = f.corners;
    const crossed = (t: number) => before < t && sim.lapTime >= t;
    if (crossed(tHairpin)) {
      // Right-hand hairpin: the outer wheels are on the left.
      r.hairpinCamberOF = deg(c[0]!.camber);
      r.hairpinRoll = deg(f.roll);
    }
    if (crossed(tCarousel)) {
      const p = sim.stateAt(f.lapTime, newPath());
      r.carouselAy = f.ay / 9.80665;
      r.carouselCamberOF = deg(c[0]!.camber);
      r.carouselCamberIF = deg(c[1]!.camber);
      r.carouselCamberOR = deg(c[2]!.camber);
      r.carouselCamberBodyOF = deg(c[0]!.camberBody);
      r.carouselRoll = deg(f.roll);
      r.rcFront = f.axles[0]!.rollCentreHeight * 1000;
      r.rcRear = f.axles[1]!.rollCentreHeight * 1000;
      const dF = (c[0]!.load - c[1]!.load) / 2;
      const dR = (c[2]!.load - c[3]!.load) / 2;
      r.transferFront = dF;
      r.transferRear = dR;
      r.transferShareFront = dF / (dF + dR);
      r.gripOF = c[0]!.gripUse;
      r.gripIF = c[1]!.gripUse;
      r.gripOR = c[2]!.gripUse;
      r.posedCamberOF1 = deg(posedCamberToRoad(f, 0, p));
      r.posedCamberOF25 = deg(posedCamberToRoad(sim.sample(1, 2.5), 0, p));
      sim.sample(1, 1);
    }
    if (f.sectionId === 'brake-zone') r.brakePitch = Math.max(r.brakePitch!, deg(f.pitch));
    const x = f.s - bump.s0;
    if (f.sectionId === 'bump-strip') {
      const road = featureUnderWheels(sim, f);
      if (x > 30 && x < 45) {
        toeRef = Number.isNaN(toeRef) ? c[0]!.toe : toeRef;
        r.bumpToe = Math.max(r.bumpToe!, Math.abs(deg(c[0]!.toe - toeRef)));
        r.bumpTravel = Math.max(r.bumpTravel!, c[0]!.travel * 1000);
        r.bumpRoad = Math.max(r.bumpRoad!, road[0]! * 1000);
      }
      if (x > 65 && x < 75) r.potholeRoad = Math.min(r.potholeRoad!, road[1]! * 1000);
      if (x > 95 && x < 118) {
        toeRefKerb = Number.isNaN(toeRefKerb) ? c[1]!.toe : toeRefKerb;
        r.kerbToe = Math.max(r.kerbToe!, Math.abs(deg(c[1]!.toe - toeRefKerb)));
        r.kerbTravelR = Math.max(r.kerbTravelR!, c[1]!.travel * 1000);
        r.kerbTravelL = Math.max(r.kerbTravelL!, c[0]!.travel * 1000);
        r.kerbRoadR = Math.max(r.kerbRoadR!, Math.min(road[1]!, road[3]!) * 1000);
        r.kerbRoadL = Math.max(r.kerbRoadL!, Math.max(road[0]!, road[2]!) * 1000);
      }
    }
    // Pave stones only (the humps follow from 55 m): body vertical acceleration and front-left load fluctuation.
    if (f.sectionId === 'pave' && f.s - pave.s0 > 3 && f.s - pave.s0 < 45) {
      if (!Number.isNaN(h2)) {
        const a = (f.heave - 2 * h1 + h2) / (SIM_DT * SIM_DT);
        paveAcc += a * a;
        paveAccN++;
      }
      pave2 += c[0]!.travelRate ** 2;
      paveLoad += c[0]!.load;
      paveN++;
    }
    if (f.sectionId === 'pave') {
      h2 = h1;
      h1 = f.heave;
    }
  }
  r.paveRmsAcc = Math.sqrt(paveAcc / paveAccN);
  r.paveRmsTravelRate = Math.sqrt(pave2 / paveN);
  r.paveMeanLoad = paveLoad / paveN;
  r.lapDuration = sim.lapDuration;
  return r;
}

describe('the three suspension types over the same lap', () => {
  const rows = Object.fromEntries(TYPES.map((t) => [t, lap(t)])) as Record<(typeof TYPES)[number], Row>;
  const [mp, dw, ml] = TYPES.map((t) => rows[t]);

  it('prints the difference table', () => {
    const lines: [string, string, number][] = [
      ['Carousel apex: lateral acceleration', 'g', 2],
      ['carouselCamberOF', 'deg', 2],
      ['carouselCamberBodyOF', 'deg', 2],
      ['carouselCamberIF', 'deg', 2],
      ['carouselCamberOR', 'deg', 2],
      ['posedCamberOF1', 'deg', 2],
      ['posedCamberOF25', 'deg', 2],
      ['carouselRoll', 'deg', 2],
      ['rcFront', 'mm', 0],
      ['rcRear', 'mm', 0],
      ['transferFront', 'N', 0],
      ['transferRear', 'N', 0],
      ['transferShareFront', '', 3],
      ['gripOF', '', 3],
      ['gripIF', '', 3],
      ['gripOR', '', 3],
      ['hairpinCamberOF', 'deg', 2],
      ['hairpinRoll', 'deg', 2],
      ['brakePitch', 'deg', 2],
      ['bumpRoad', 'mm', 1],
      ['bumpTravel', 'mm', 1],
      ['bumpToe', 'deg', 4],
      ['potholeRoad', 'mm', 1],
      ['kerbRoadR', 'mm', 1],
      ['kerbRoadL', 'mm', 1],
      ['kerbTravelR', 'mm', 1],
      ['kerbTravelL', 'mm', 1],
      ['kerbToe', 'deg', 4],
      ['paveRmsAcc', 'm/s2', 3],
      ['paveRmsTravelRate', 'm/s', 3],
    ];
    const key = (k: string) => (k.startsWith('Carousel') ? 'carouselAy' : k);
    const table = [
      `| metric | unit | ${TYPES.join(' | ')} |`,
      '|---|---|---:|---:|---:|',
      ...lines.map(([k, u, d]) => `| ${k} | ${u} | ${TYPES.map((t) => rows[t][key(k)]!.toFixed(d)).join(' | ')} |`),
    ].join('\n');
    console.log(`[diff]\n${table}`);
    for (const r of Object.values(rows)) for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });

  it('same path for every type: lap duration and lateral acceleration are identical', () => {
    expect(dw!.lapDuration).toBe(mp!.lapDuration);
    expect(ml!.lapDuration).toBe(mp!.lapDuration);
    expect(dw!.carouselAy).toBe(mp!.carouselAy);
  });

  it('roll centres: MacPherson highest, multi-link lowest (front)', () => {
    expect(mp!.rcFront).toBeGreaterThan(dw!.rcFront!);
    expect(dw!.rcFront).toBeGreaterThan(ml!.rcFront!);
  });

  it('carousel outer wheels: double wishbone keeps the most camber; at the rear the strut loses the most', () => {
    // Front: caster-induced camber from steering offsets the strut's weak roll camber, so strut and multi-link end up
    // about equal; the wishbone keeps its lead.
    expect(dw!.carouselCamberOF).toBeLessThan(mp!.carouselCamberOF!);
    expect(dw!.carouselCamberOF).toBeLessThan(ml!.carouselCamberOF!);
    expect(mp!.carouselCamberOR).toBeGreaterThan(ml!.carouselCamberOR!);
    expect(ml!.carouselCamberOR).toBeGreaterThan(dw!.carouselCamberOR!);
  });

  it('POSE camber read back from the wheel orientation matches the TRUE value; amplification enlarges it', () => {
    for (const r of [mp, dw, ml]) {
      expect(Math.abs(r!.posedCamberOF1! - r!.carouselCamberOF!)).toBeLessThan(0.05);
      expect(r!.posedCamberOF25).toBeGreaterThan(r!.posedCamberOF1!);
    }
  });

  it('the bump strip hits the intended wheels (measured track, half track 0.847 m)', () => {
    for (const r of [mp, dw, ml]) {
      expect(r!.bumpRoad).toBeGreaterThan(40); // left wheels over the cosine bump
      expect(r!.potholeRoad).toBeLessThan(-40); // right front through the pothole
      expect(r!.kerbRoadR).toBeGreaterThan(55); // both right wheels on the raised kerb
      expect(r!.kerbRoadL).toBeLessThan(15); // left wheels stay on the asphalt (roughness only)
    }
  });
});
