/** 05-03: the cafe racer through the experience layer (camera framings, telemetry, insights) on the live 05-01 sim. */
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SimCatalog, Simulation } from '../../src/contracts/sim';
import { simQuatToThree, simToThree } from '../../src/contracts/units';
import { BIKE_CHASE, CameraRig } from '../../src/features/camera/rig';
import motorcycle from '../../src/features/motorcycle/index';
import { ctlStep } from '../../src/features/presenter/apply';
import { cafeRacer } from '../../src/sim-core/content/cafe-racer';
import { motoClassic } from '../../src/sim-core/content/moto-classic';
import { motoModern } from '../../src/sim-core/content/moto-modern';
import { motoTelelever } from '../../src/sim-core/content/moto-telelever';
import { createSimulation } from '../../src/sim-core/index';

const presets = Object.fromEntries([motoClassic, motoModern, motoTelelever].map((s) => [s.id, s]));
const catalog: SimCatalog = { track: () => undefined, vehicle: (id) => (id === cafeRacer.id ? cafeRacer : undefined), suspension: (id) => presets[id] };
const bike = (suspensionId = 'moto-classic', lapTime = 0): Simulation =>
  createSimulation({ catalog, trackId: 'proving-loop', vehicleId: 'cafe-racer', suspensionId, lapTime });

/** Lap time of the deepest lean (the carousel). */
function deepestLean(sim: Simulation): number {
  let best = 0;
  let at = 0;
  for (let t = 0; t < sim.lapDuration; t += 0.25) {
    sim.seek(t);
    const r = Math.abs(sim.sample(1, 1).roll);
    if (r > best) [best, at] = [r, t];
  }
  return at;
}

describe('bike camera', () => {
  it('chase uses the bike framing; side close-ups stay above the road with a level horizon at full lean', () => {
    const sim = bike();
    const at = deepestLean(sim);
    sim.seek(at);
    const t = sim.sample(1, 1);
    expect(Math.abs(t.roll)).toBeGreaterThan(0.55);
    const rig = new CameraRig(() => sim);
    rig.layout(t);
    rig.update(1 / 60, t);
    expect(rig.chase.framing).toBe(BIKE_CHASE);
    expect(rig.chase.dist).toBeLessThan(5);
    const body = new Vector3();
    const q = new Quaternion();
    simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, body);
    simQuatToThree(t.bodyRotation, q);
    q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -t.roll)); // the un-leaned body frame
    // Un-leaning leaves the bike upright: body up is world up within the road's grade/bank.
    expect(new Vector3(0, 1, 0).applyQuaternion(q).y).toBeGreaterThan(0.98);
    for (const corner of ['f', 'r'] as const) {
      rig.setView('closeup', corner, true);
      const pose = rig.update(1 / 60, t);
      const road = sim.track.roadHeight(t.s, 0);
      expect(pose.pos.y - road, corner).toBeGreaterThan(0.6);
      // Level horizon: the camera's right vector is horizontal.
      const right = new Vector3(1, 0, 0).applyQuaternion(pose.quat);
      expect(Math.abs(right.y), corner).toBeLessThan(0.03);
      // On the left of the bike (three -z in the un-leaned body frame) and 2-3 m from it.
      const local = pose.pos.clone().sub(body).applyQuaternion(q.clone().invert());
      expect(local.z, corner).toBeLessThan(-1.5);
      expect(pose.pos.distanceTo(body), corner).toBeLessThan(3.2);
    }
  });
});

describe('motorcycle feature', () => {
  it('contributes the cafe racer, its three presets and both visuals; the phone remote ids resolve', () => {
    const got: Record<string, string[]> = { vehicles: [], suspensions: [], vehicleVisuals: [], suspensionVisuals: [] };
    const reg = (k: string) => ({ register: (x: { id: string }) => (got[k]!.push(x.id), () => {}), get: () => undefined, require: () => undefined, list: () => [] });
    motorcycle.contribute!({ vehicles: reg('vehicles'), suspensions: reg('suspensions'), tracks: reg('tracks'), vehicleVisuals: reg('vehicleVisuals'), suspensionVisuals: reg('suspensionVisuals') } as never);
    expect(got).toEqual({
      vehicles: ['cafe-racer'],
      suspensions: ['moto-classic', 'moto-modern', 'moto-telelever'],
      vehicleVisuals: [cafeRacer.visualKey],
      suspensionVisuals: [motoClassic.visualKey],
    });
    expect(cafeRacer.suspensions).toEqual(got.suspensions);
    // The remote (06-04) sends vehicle `cafe-racer` with a moto suspension id: applied in order, vehicle first.
    const offered = (id: string) => (id === cafeRacer.id ? cafeRacer.suspensions : id === 'gt-coupe' ? ['macpherson', 'double-wishbone', 'multilink'] : undefined);
    const step = ctlStep(null, { seq: 1, vehicleId: 'cafe-racer', suspensionId: 'moto-telelever' }, 'gt-coupe', offered);
    expect(step?.patch).toEqual([
      ['vehicleId', 'cafe-racer'],
      ['suspensionId', 'moto-telelever'],
    ]);
  });
});

describe('bike close-up side', () => {
  it('films a single-sided swingarm from its own side, everything else from the left', () => {
    const sim = bike('moto-telelever', 3);
    const t = sim.sample(1, 1);
    const rig = new CameraRig(() => sim);
    rig.setView('closeup', 'r', true);
    const side = () => {
      const pose = rig.update(1 / 60, t);
      const q = new Quaternion();
      simQuatToThree(t.bodyRotation, q);
      const body = new Vector3();
      simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, body);
      return Math.sign(pose.pos.clone().sub(body).applyQuaternion(q.invert()).z);
    };
    expect(side()).toBe(motoTelelever.rear.kind === 'swingarm' && motoTelelever.rear.shockLower[1] < 0 ? 1 : -1);
    sim.setSuspension('moto-modern');
    expect(side()).toBe(-1);
    rig.setView('closeup', 'f', true);
    expect(side()).toBe(-1);
  });
});
