/**
 * Auto -> Manual continuity (ARCHITECTURE-M2 §7.10 A, §11 H1): engaging the plant from stateAt(t) anywhere on the lap
 * shows no jump. Two identical simulations run to the same step; one engages Manual (neutral intent: the bumpless
 * engage holds the Auto command), the other stays in Auto. The first plant step must match the twin's next Auto step
 * within the §7.10 A thresholds: position step <= v dt + 1 mm (and within 5 mm of the twin), speed 0.05 m/s, yaw rate 0.02 rad/s, steer rate * dt,
 * roll and pitch 1 mrad, travel 1 mm, load 3 % (of the static corner load); wheel spin within 10 % of the Auto (kinematic)
 * value (the plant seeds the steady-state slip of the Auto demand).
 */
import { describe, expect, it } from 'vitest';
import { neutralIntent } from '../../src/contracts/drive';
import type { Simulation } from '../../src/contracts/sim';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { G, SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { createRng } from '../../src/sim-core/math/rng';
import { makeSim, SUSPENSION_IDS } from '../fixtures/08-02-drive';

interface Snap {
  x: number;
  y: number;
  speed: number;
  yawRate: number;
  steer: number;
  roll: number;
  pitch: number;
  heave: number;
  travel: number[];
  load: number[];
  omega: number[];
  body: number[];
}
const snap = (f: TelemetryFrame): Snap => ({
  x: f.drive.x,
  y: f.drive.y,
  speed: f.speed,
  yawRate: f.yawRate,
  steer: f.steer,
  roll: f.roll,
  pitch: f.pitch,
  heave: f.heave,
  travel: f.corners.map((c) => c.travel),
  load: f.corners.map((c) => c.load),
  omega: f.corners.map((c) => c.omega),
  body: [f.bodyPosition.x, f.bodyPosition.y, f.bodyPosition.z],
});
const maxAbs = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));

const STATIC_LOAD = (gtCoupe.mass * G) / 4;
const STEER_STEP = gtCoupe.handling!.steering.rate * SIM_DT;

function engageAt(id: (typeof SUSPENSION_IDS)[number], lapTime: number) {
  const make = (): Simulation => makeSim('proving-loop', id, lapTime);
  const auto = make();
  const manual = make();
  for (const sim of [auto, manual]) sim.step(SIM_DT);
  const before = snap(manual.sample(1));
  manual.drive!.setIntent(neutralIntent('keyboard'));
  manual.drive!.request('manual');
  manual.step(SIM_DT);
  auto.step(SIM_DT);
  const f = manual.sample(1);
  expect(f.drive.mode).toBe('manual');
  return { before, plant: snap(f), twin: snap(auto.sample(1)) };
}

describe('Auto -> Manual handoff (H1)', () => {
  const rng = createRng(2026);
  const lapTimes = Array.from({ length: 20 }, () => rng.uniform(0, 120));
  const worst: Record<string, number> = { pos: 0, speed: 0, yawRate: 0, steer: 0, roll: 0, pitch: 0, travel: 0, load: 0, omega: 0, body: 0 };

  it.each(SUSPENSION_IDS)('%s: 20 random lap times within the §7.10 A thresholds', (id) => {
    for (const t of lapTimes) {
      const { before, plant, twin } = engageAt(id, t);
      // §7.10 A: the first plant step moves no more than v dt + 1 mm; and it lands within 5 mm of the Auto twin (the
      // plant's seeded sideslip drifts the CG off the zero-sideslip rails by v_y dt per step).
      const stepLen = Math.hypot(plant.x - before.x, plant.y - before.y);
      expect(stepLen, `position step @${t.toFixed(2)}`).toBeLessThanOrEqual(before.speed * SIM_DT + 1e-3);
      const d = {
        pos: Math.hypot(plant.x - twin.x, plant.y - twin.y),
        speed: Math.abs(plant.speed - twin.speed),
        yawRate: Math.abs(plant.yawRate - twin.yawRate),
        steer: Math.abs(plant.steer - twin.steer),
        roll: Math.abs(plant.roll - twin.roll),
        pitch: Math.abs(plant.pitch - twin.pitch),
        travel: maxAbs(plant.travel, twin.travel),
        load: maxAbs(plant.load, twin.load) / STATIC_LOAD,
        omega: maxAbs(plant.omega, twin.omega) / Math.max(1, Math.max(...twin.omega.map(Math.abs))),
        body: maxAbs(plant.body, twin.body),
      };
      for (const k of Object.keys(d) as (keyof typeof d)[]) worst[k] = Math.max(worst[k]!, d[k]);
      expect(d.pos, `position vs twin @${t.toFixed(2)}`).toBeLessThanOrEqual(5e-3);
      expect(d.speed, `speed @${t.toFixed(2)}`).toBeLessThanOrEqual(0.05);
      expect(d.yawRate, `yaw rate @${t.toFixed(2)}`).toBeLessThanOrEqual(0.02);
      expect(d.steer, `steer @${t.toFixed(2)}`).toBeLessThanOrEqual(STEER_STEP);
      expect(d.roll, `roll @${t.toFixed(2)}`).toBeLessThanOrEqual(1e-3);
      expect(d.pitch, `pitch @${t.toFixed(2)}`).toBeLessThanOrEqual(1e-3);
      expect(d.travel, `travel @${t.toFixed(2)}`).toBeLessThanOrEqual(1e-3);
      expect(d.load, `load @${t.toFixed(2)}`).toBeLessThanOrEqual(0.03);
      expect(d.omega, `wheel spin @${t.toFixed(2)}`).toBeLessThanOrEqual(0.1); // seeded longitudinal slip (Auto shows kinematic spin)
      expect(d.body, `body pose @${t.toFixed(2)}`).toBeLessThanOrEqual(5e-3);
    }
  });

  it('prints the worst continuity errors', () => {
    console.log(
      `[handoff] worst over 3 x 20 engages: position ${(worst.pos! * 1000).toFixed(3)} mm, speed ${worst.speed!.toFixed(4)} m/s, yaw rate ${worst.yawRate!.toFixed(4)} rad/s, ` +
        `steer ${(worst.steer! * 1000).toFixed(3)} mrad, roll ${(worst.roll! * 1000).toFixed(3)} mrad, pitch ${(worst.pitch! * 1000).toFixed(3)} mrad, ` +
        `travel ${(worst.travel! * 1000).toFixed(3)} mm, load ${(worst.load! * 100).toFixed(2)} %, wheel spin ${(worst.omega! * 100).toFixed(3)} %, body pose ${(worst.body! * 1000).toFixed(3)} mm`,
    );
  });

  it('a manual suspension swap keeps pose and velocities (no more than one step of change)', () => {
    const sim = makeSim('proving-loop', 'double-wishbone', 30);
    sim.drive!.request('manual');
    sim.step(SIM_DT);
    for (let k = 0; k < 120; k++) sim.step(SIM_DT);
    const a = snap(sim.sample(1));
    sim.step(SIM_DT);
    const b = snap(sim.sample(1));
    sim.setSuspension('macpherson');
    expect(sim.drive!.mode).toBe('manual');
    sim.step(SIM_DT);
    const c = snap(sim.sample(1));
    const stepPos = Math.hypot(b.x - a.x, b.y - a.y);
    expect(Math.abs(Math.hypot(c.x - b.x, c.y - b.y) - stepPos)).toBeLessThan(1e-3);
    expect(Math.abs(c.speed - b.speed)).toBeLessThan(Math.abs(b.speed - a.speed) + 0.05);
    expect(Math.abs(c.yawRate - b.yawRate)).toBeLessThan(Math.abs(b.yawRate - a.yawRate) + 0.02);
    expect(Math.abs(c.roll - b.roll)).toBeLessThan(Math.abs(b.roll - a.roll) + 2e-3);
    expect(sim.sample(1).suspensionId).toBe('macpherson');
  });

  // 09-04: the engage with aids, compliance and jacking live. A neutral keyboard intent blends the Auto command to
  // hands-off over 0.3 s, so in a corner the stability aid rightly reacts; but no wheel is braked into ABS, nothing
  // faults and the yaw rate has no step.
  it.each(SUSPENSION_IDS)('%s: the first second after an engage: no ABS, no fault, smooth yaw rate', (id) => {
    for (const t of [12, 47, 83, 118]) {
      const sim = makeSim('proving-loop', id, t);
      sim.step(SIM_DT);
      sim.drive!.setIntent(neutralIntent('keyboard'));
      sim.drive!.request('manual');
      let prevR = NaN;
      let worstJump = 0;
      for (let k = 0; k < 240; k++) {
        sim.step(SIM_DT);
        const f = sim.sample(1);
        expect(f.drive.absActive, `ABS lamp @${t} +${k}`).toBe(false);
        if (prevR === prevR) worstJump = Math.max(worstJump, Math.abs(f.yawRate - prevR));
        prevR = f.yawRate;
        expect(f.drive.faults).toBe(0);
      }
      expect(worstJump, `yaw-rate step @${t}`).toBeLessThan(0.02);
    }
  });
});
