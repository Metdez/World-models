/**
 * Standstill and low-speed behaviour of the plant (ARCHITECTURE-M2 §11 S1, v0 — 09-04 adds the 5 % slope): brake held
 * without creep, coast to a monotone stop, launch / reverse / full lock / hard stop without wheel-speed chatter,
 * kerbs and pave without faults, no energy gain while coasting. Driven with plant commands (no driver), because a
 * held brake at standstill selects reverse in the HumanDriver.
 */
import { describe, expect, it } from 'vitest';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import type { TrackSample } from '../../src/contracts/track';
import { G, SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { finiteFrame, plantRig, steps, SUSPENSION_IDS } from '../fixtures/08-02-drive';
import { strip } from '../fixtures/08-02-test-tracks';
import { flatWorld, rig } from '../fixtures/09-04-handling';

const ts = (): TrackSample => ({ s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 });

/** Counts sign changes of each wheel's spin (ignoring exact zeros). */
function spinWatch() {
  const sign = [0, 0, 0, 0];
  const changes = [0, 0, 0, 0];
  return {
    changes,
    see(f: TelemetryFrame) {
      f.corners.forEach((c, i) => {
        const s = c.omega > 1e-6 ? 1 : c.omega < -1e-6 ? -1 : 0;
        if (s !== 0 && sign[i] !== 0 && s !== sign[i]) changes[i]!++;
        if (s !== 0) sign[i] = s;
      });
    },
  };
}

function placeOnLine(rig: ReturnType<typeof plantRig>, s: number) {
  const t = rig.track.sample(s, ts());
  rig.plant.place(t.x, t.y, t.heading);
  return t;
}

describe('plant at standstill (S1 v0)', () => {
  it.each(SUSPENSION_IDS)('%s: brake held 10 s on the steepest loop grade creeps < 1 mm; handbrake alone holds too', (id) => {
    const rig = plantRig(provingLoop, id);
    // steepest grade on the loop's driving line
    let best = 0;
    let sBest = 0;
    const t = ts();
    for (let s = 0; s < rig.track.length; s += 1) {
      rig.track.sample(s, t);
      if (Math.abs(t.grade) > best) {
        best = Math.abs(t.grade);
        sBest = s;
      }
    }
    placeOnLine(rig, sBest);
    for (const lever of ['brake', 'handbrake'] as const) {
      rig.cmd.brake = lever === 'brake' ? 1 : 0;
      rig.cmd.handbrake = lever === 'handbrake' ? 1 : 0;
      let f = rig.step(steps(1));
      const x0 = f.drive.x;
      const y0 = f.drive.y;
      f = rig.step(steps(10));
      const creep = Math.hypot(f.drive.x - x0, f.drive.y - y0);
      console.log(`[standstill] ${id} ${lever} on grade ${(best * 100).toFixed(2)} %: creep ${(creep * 1000).toFixed(4)} mm`);
      expect(creep).toBeLessThan(1e-3);
      expect(finiteFrame(f)).toBe(true);
    }
  });

  it('released on the loop slope: rolling resistance holds where the slope pulls less, no creep', () => {
    const rig = plantRig();
    placeOnLine(rig, 0); // swell grade 0.57 %, below the rolling-resistance coefficient
    rig.step(steps(1));
    const x0 = rig.frame.drive.x;
    const f = rig.step(steps(10));
    expect(Math.abs(f.drive.x - x0)).toBeLessThan(1e-3);
  });

  it('coasts to a monotone stop on the flat strip, no wheel-spin reversal', () => {
    const rig = plantRig(strip);
    placeOnLine(rig, 20);
    rig.cmd.throttle = 0.4;
    while (rig.step().drive.u < 5);
    rig.cmd.throttle = 0;
    // The first 0.5 s after the lift: the tyres' stored deflection and the spinning driveline still push (physical).
    rig.step(steps(0.5));
    const watch = spinWatch();
    let prev = rig.frame.drive.u;
    let rises = 0;
    let t = 0;
    for (; t < 60 && prev > 0; t += SIM_DT) {
      const f = rig.step();
      watch.see(f);
      if (f.drive.u > prev + 1e-9) rises++;
      prev = f.drive.u;
    }
    console.log(`[standstill] coast 5 m/s -> stop in ${t.toFixed(2)} s; speed rises ${rises}; spin sign changes ${watch.changes.join(',')}`);
    expect(prev).toBe(0);
    expect(rises).toBe(0);
    expect(Math.max(...watch.changes)).toBe(0);
    const x0 = rig.frame.drive.x;
    rig.step(steps(5));
    expect(Math.abs(rig.frame.drive.x - x0)).toBeLessThan(1e-6);
  });

  it.each([true, false])('full throttle from rest (traction aid %s): no spin chatter, moves forward', (traction) => {
    const rig = plantRig(strip);
    rig.setAids({ abs: true, traction, stability: true, steering: true });
    placeOnLine(rig, 20);
    rig.step(steps(0.5));
    rig.cmd.throttle = 1;
    const watch = spinWatch();
    for (let k = 0; k < steps(3); k++) watch.see(rig.step());
    console.log(`[standstill] launch traction=${traction}: u ${rig.frame.drive.u.toFixed(2)} m/s after 3 s, spin sign changes ${watch.changes.join(',')}`);
    expect(Math.max(...watch.changes)).toBeLessThanOrEqual(2);
    expect(rig.frame.drive.u).toBeGreaterThan(5);
    expect(finiteFrame(rig.frame)).toBe(true);
  });

  it('hard braking to a stop from 20 m/s, then held: stops, no rebound, spins zero', () => {
    const rig = plantRig(strip);
    placeOnLine(rig, 20);
    rig.cmd.throttle = 1;
    while (rig.step().drive.u < 20);
    rig.cmd.throttle = 0;
    rig.cmd.brake = 1;
    const watch = spinWatch();
    let t = 0;
    while (rig.frame.drive.u > 0 && t < 10) {
      watch.see(rig.step());
      t += SIM_DT;
    }
    const x0 = rig.frame.drive.x;
    for (let k = 0; k < steps(3); k++) {
      const f = rig.step();
      expect(f.drive.u).toBe(0);
      watch.see(f);
    }
    console.log(`[standstill] 20 m/s -> 0 in ${t.toFixed(2)} s (${(20 / t / G).toFixed(2)} g mean); spin sign changes ${watch.changes.join(',')}`);
    expect(Math.abs(rig.frame.drive.x - x0)).toBeLessThan(1e-6);
    expect(Math.max(...watch.changes)).toBe(0);
    for (const c of rig.frame.corners) expect(c.omega).toBe(0);
  });

  it('reverses from rest, and creeps at full lock forward and backward smoothly', () => {
    const rig = plantRig(strip);
    placeOnLine(rig, 20);
    rig.cmd.direction = -1;
    rig.cmd.throttle = 0.5;
    rig.cmd.steer = -gtCoupe.maxSteer;
    const watch = spinWatch();
    let rMin = Infinity;
    let rMax = -Infinity;
    for (let k = 0; k < steps(6); k++) {
      const f = rig.step();
      watch.see(f);
      if (k > steps(2)) {
        rMin = Math.min(rMin, f.yawRate);
        rMax = Math.max(rMax, f.yawRate);
      }
    }
    expect(rig.frame.drive.u).toBeLessThan(-1);
    expect(rig.frame.drive.u).toBeGreaterThanOrEqual(-gtCoupe.handling!.powertrain.reverseSpeedCap - 0.2);
    expect(rMin * rMax).toBeGreaterThan(0); // turns one way only
    rig.cmd.direction = 1;
    rig.cmd.throttle = 0;
    rig.cmd.brake = 1;
    rig.step(steps(2));
    expect(rig.frame.drive.u).toBe(0);
    rig.cmd.brake = 0;
    rig.cmd.throttle = 0.12;
    rig.cmd.steer = gtCoupe.maxSteer;
    let prevU = 0;
    let drops = 0;
    for (let k = 0; k < steps(6); k++) {
      const f = rig.step();
      watch.see(f);
      if (k > steps(0.5) && f.drive.u < prevU - 1e-3) drops++;
      prevU = f.drive.u;
    }
    console.log(`[standstill] full-lock creep: u ${prevU.toFixed(2)} m/s, r ${rig.frame.yawRate.toFixed(3)} rad/s; reverse spin sign changes ${watch.changes.join(',')}; speed drops ${drops}`);
    expect(prevU).toBeGreaterThan(0.5);
    expect(rig.frame.yawRate).toBeGreaterThan(0);
    expect(drops).toBe(0);
    expect(Math.max(...watch.changes)).toBeLessThanOrEqual(1); // the one reverse -> forward change
  });

  it('coasting on the flat strip gains no energy (translation + yaw + wheel spin)', () => {
    const rig = plantRig(strip);
    placeOnLine(rig, 20);
    rig.cmd.throttle = 1;
    while (rig.step().drive.u < 25);
    rig.cmd.throttle = 0;
    rig.step(steps(1)); // shift / clutch transients settle
    const m = gtCoupe.mass;
    const energy = (f: TelemetryFrame) =>
      0.5 * m * (f.drive.u ** 2 + f.drive.v ** 2) + 0.5 * gtCoupe.inertia.yaw * f.yawRate ** 2 + f.corners.reduce((a, c, i) => a + 0.5 * (i < 2 ? 1.2 : 1.3) * c.omega ** 2, 0);
    let prev = energy(rig.frame);
    let worst = 0;
    for (let k = 0; k < steps(10); k++) {
      const e = energy(rig.step());
      worst = Math.max(worst, (e - prev) / prev);
      prev = e;
    }
    console.log(`[standstill] coast: worst relative energy rise per step ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-4);
  });

  it.each(['pave', 'bump-strip', 'chicane'])('drives over %s (kerbs, cobbles, bumps) at speed without faults or spin chatter', (section) => {
    const rig = plantRig();
    const sec = rig.track.sections.find((x) => x.id === section)!;
    placeOnLine(rig, sec.s0 - 60);
    rig.cmd.throttle = 0.5;
    while (rig.step().drive.u < 15);
    rig.cmd.throttle = 0.25;
    const watch = spinWatch();
    for (let k = 0; k < steps(5); k++) {
      const f = rig.step();
      watch.see(f);
      expect(finiteFrame(f)).toBe(true);
    }
    expect(rig.plant.faults).toBe(0);
    expect(Math.max(...watch.changes)).toBe(0);
  });
});

describe('plant at standstill on a 5 % slope (S1, 09-04)', () => {
  const slopeWorld = flatWorld(
    (x) => 0.05 * x,
    (x) => 0.05 * x,
  );
  it.each(SUSPENSION_IDS)('%s: brake (and handbrake alone) held 10 s on a 5 percent slope, nose up and down: creep < 1 mm; released, it rolls', (id) => {
    const rows: string[] = [];
    for (const heading of [0, Math.PI]) {
      for (const hold of ['brake', 'handbrake'] as const) {
        const r = rig({ suspension: id, world: slopeWorld });
        r.place(10, 0, heading);
        r.cmd[hold] = 1;
        for (let k = 0; k < 24; k++) r.step(); // settle onto the slope at rest
        const x0 = r.plant.view.x;
        const y0 = r.plant.view.y;
        for (let k = 0; k < steps(10); k++) r.step();
        const creep = Math.hypot(r.plant.view.x - x0, r.plant.view.y - y0);
        rows.push(`${heading === 0 ? 'nose up' : 'nose down'} ${hold} ${(creep * 1000).toFixed(4)} mm`);
        expect(creep).toBeLessThan(1e-3);
        expect(r.plant.faults).toBe(0);
        // control: released, the slope pulls the car away
        r.cmd[hold] = 0;
        for (let k = 0; k < steps(3); k++) r.step();
        expect(Math.hypot(r.plant.view.x - x0, r.plant.view.y - y0)).toBeGreaterThan(0.5);
      }
    }
    console.log(`[standstill] ${id} 5 % slope: ${rows.join(', ')}`);
  });
});
