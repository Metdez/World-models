/**
 * T16-T18, T20 (ARCHITECTURE-M2 §11): load sum and lateral transfer in a steady 0.5 g turn, mirror symmetry and idle
 * drift, 240 vs 480 Hz, the validity flag (DriveFrame.approximate), and the ride model's jacking term (§7.6):
 * linkVertical with equal left/right forces along IC lines through the roll centre equals the M1 pair to 1e-9.
 */
import { describe, expect, it } from 'vitest';
import { G } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { prepareCarSuspension } from '../../src/sim-core/car/car-model';
import { createCornerSolution } from '../../src/sim-core/kinematics/table';
import { createRideModel, type RideInput } from '../../src/sim-core/ride/ride7dof';
import { SUSPENSION_IDS, SUSPENSIONS } from '../fixtures/08-02-drive';
import { circleKeeper, rig, speedHold, stepSteer, steerFor } from '../fixtures/09-04-handling';

const massOf = (id: (typeof SUSPENSION_IDS)[number]): number =>
  gtCoupe.sprungMass + 2 * gtCoupe.front.unsprungMass + 2 * gtCoupe.rear.unsprungMass + 4 * SUSPENSIONS[id].extras.unsprungMassDelta;

describe('invariants (T16-T18, T20) and the jacking term', () => {
  it.each(SUSPENSION_IDS)('T16 %s: steady 0.5 g: load sum = m g (1e-6), lateral transfer = statics of the ride model (1 %)', (id) => {
    const r = rig({ suspension: id, aids: { abs: false, traction: false, stability: false, steering: false } });
    const R = 80;
    const u = Math.sqrt(0.5 * G * R);
    r.launch(u, 1 / R);
    const keep = circleKeeper(R, 0, R, 1, gtCoupe.wheelbase);
    const hold = speedHold(u);
    for (let k = 0; k < 240 * 12; k++) {
      keep(r);
      hold(r);
      r.step();
    }
    // freeze the inputs and let every transient die out
    let f = r.frame;
    for (let k = 0; k < 240 * 15; k++) f = r.step();
    const loads = f.corners.map((c) => c.load);
    const sum = loads.reduce((a, b) => a + b, 0);
    const sol = prepareCarSuspension(gtCoupe, SUSPENSIONS[id]);
    const y = (t: typeof sol.front.table): number => t.sample(0, 0, createCornerSolution(t)).contactPatch.y;
    const yF = y(sol.front.table);
    const yR = y(sol.rear.table);
    const moment = (loads[1]! - loads[0]!) * yF + (loads[3]! - loads[2]!) * yR; // outer (right) minus inner
    const ms = gtCoupe.sprungMass;
    const xF = gtCoupe.cgToFront + sol.front.table.sample(0, 0, createCornerSolution(sol.front.table)).contactPatch.x;
    const xR = gtCoupe.cgToFront - gtCoupe.wheelbase + sol.rear.table.sample(0, 0, createCornerSolution(sol.rear.table)).contactPatch.x;
    const msF = (ms * -xR) / (xF - xR);
    const hRA = (msF * f.axles[0]!.rollCentreHeight + (ms - msF) * f.axles[1]!.rollCentreHeight) / ms;
    const dm = SUSPENSIONS[id].extras.unsprungMassDelta;
    const unsprungH = 2 * (gtCoupe.front.unsprungMass + dm) * gtCoupe.front.tyre.radius + 2 * (gtCoupe.rear.unsprungMass + dm) * gtCoupe.rear.tyre.radius;
    const ay = f.ay;
    const expected = ay * (ms * gtCoupe.cgHeight + unsprungH) + ms * G * (gtCoupe.cgHeight - hRA) * f.roll;
    console.log(`[T16] ${id}: a_y ${(ay / G).toFixed(3)} g, load sum / m g - 1 = ${(sum / (massOf(id) * G) - 1).toExponential(2)}, transfer moment ${moment.toFixed(1)} N m vs ${expected.toFixed(1)} (${((moment / expected - 1) * 100).toFixed(2)} %)`);
    expect(Math.abs(sum / (massOf(id) * G) - 1)).toBeLessThan(1e-6);
    expect(Math.abs(moment / expected - 1)).toBeLessThan(0.01);
  }, 60_000);

  it('T17: mirrored steer gives mirrored states (1e-9); 10 s idle at rest drifts < 1 mm', () => {
    const run = (sign: 1 | -1) => {
      const r = rig({ suspension: 'multilink', aids: { abs: false, traction: false, stability: false, steering: false } });
      r.launch(25);
      const hold = speedHold(25);
      const out: number[][] = [];
      for (let k = 0; k < 240 * 4; k++) {
        r.cmd.steer = k > 120 ? sign * 0.03 : 0;
        hold(r);
        const f = r.step();
        if (k % 24 === 0) out.push([f.drive.x, f.drive.y, f.drive.v, f.yawRate, f.roll, f.pitch, f.heave, ...f.corners.map((c) => c.load), ...f.corners.map((c) => c.travel)]);
      }
      return out;
    };
    const a = run(1);
    const b = run(-1);
    let worst = 0;
    for (let k = 0; k < a.length; k++) {
      const p = a[k]!;
      const m = b[k]!;
      const mirrored = [m[0]!, -m[1]!, -m[2]!, -m[3]!, -m[4]!, m[5]!, m[6]!, m[8]!, m[7]!, m[10]!, m[9]!, m[12]!, m[11]!, m[14]!, m[13]!];
      for (let j = 0; j < p.length; j++) worst = Math.max(worst, Math.abs(p[j]! - mirrored[j]!) / (j >= 7 && j <= 10 ? 1000 : 1));
    }
    const r = rig({ suspension: 'multilink' });
    r.place(3, -2, 0.7);
    for (let k = 0; k < 2400; k++) r.step();
    const drift = Math.hypot(r.plant.view.x - 3, r.plant.view.y + 2);
    console.log(`[T17] mirror: worst |left - mirrored right| ${worst.toExponential(2)} (loads in kN, else SI); idle 10 s drift ${(drift * 1000).toFixed(4)} mm`);
    expect(worst).toBeLessThan(1e-9);
    expect(drift).toBeLessThan(1e-3);
  }, 60_000);

  it('T18: 240 vs 480 Hz step steer within 2 %', () => {
    const d = steerFor('double-wishbone', 27.78, 4);
    const a = stepSteer('double-wishbone', 27.78, d);
    const b = stepSteer('double-wishbone', 27.78, d, 1 / 480);
    const peak = (x: typeof a): number => x.rSteady * (1 + x.overshoot);
    const rows = [
      ['steady a_y', a.aySteady, b.aySteady],
      ['steady yaw rate', a.rSteady, b.rSteady],
      ['peak yaw rate', peak(a), peak(b)],
    ] as const;
    console.log(`[T18] 240 vs 480 Hz: ${rows.map(([n, x, y]) => `${n} ${x.toFixed(4)} / ${y.toFixed(4)} (${((y / x - 1) * 100).toFixed(2)} %)`).join('; ')}; T_yaw ${a.tYaw.toFixed(4)} / ${b.tYaw.toFixed(4)} s`);
    for (const [, x, y] of rows) expect(Math.abs(y / x - 1)).toBeLessThan(0.02);
  }, 60_000);

  it('T20: approximate beyond 0.85 mu g, |beta| > 10 deg or |kappa| > 0.3, quiet in gentle driving', () => {
    // gentle: 20 m/s straight, then 0.3 g turn
    const g = rig({ suspension: 'double-wishbone' });
    g.launch(20, 1 / 130);
    const hold = speedHold(20);
    let gentle = false;
    for (let k = 0; k < 240 * 4; k++) {
      hold(g);
      gentle ||= g.step().drive.approximate;
    }
    expect(gentle).toBe(false);
    // wheelspin: full throttle from rest, traction aid off
    const w = rig({ suspension: 'double-wishbone', aids: { traction: false } });
    w.place();
    w.cmd.throttle = 1;
    let spin = false;
    for (let k = 0; k < 240; k++) spin ||= w.step().drive.approximate && Math.abs(w.frame.corners[2]!.slipRatio) > 0.3;
    expect(spin).toBe(true);
    // slide: handbrake at 15 m/s with full lock, aids off
    const s = rig({ suspension: 'double-wishbone', aids: { abs: false, traction: false, stability: false, steering: false } });
    s.launch(15);
    s.cmd.steer = gtCoupe.maxSteer;
    s.cmd.handbrake = 1;
    let slide = false;
    for (let k = 0; k < 480; k++) slide ||= s.step().drive.approximate && Math.abs(s.frame.drive.beta) > (10 * Math.PI) / 180;
    expect(slide).toBe(true);
    // lateral: the skidpad limit (0.85 mu g = 0.935 g for mu 1.1)
    const l = rig({ suspension: 'double-wishbone', aids: { abs: false, traction: false, stability: false, steering: false } });
    const R = 45.7;
    l.launch(19, 1 / R);
    const keep = circleKeeper(R, 0, R, 1, gtCoupe.wheelbase);
    let lateral = false;
    for (let k = 0; k < 240 * 20 && !lateral; k++) {
      keep(l);
      const e = 19 + k * l.dt * 0.15 - l.plant.view.u;
      l.cmd.throttle = Math.max(0, Math.min(1, 0.3 * e + 0.15));
      const f = l.step();
      lateral = f.drive.approximate && Math.abs(f.ay) > 0.85 * gtCoupe.front.tyre.mu * G && Math.abs(f.drive.beta) < (10 * Math.PI) / 180;
    }
    expect(lateral).toBe(true);
  }, 60_000);

  it('jacking term: equal forces along IC lines through the roll centre give the M1 link pair (1e-9)', () => {
    for (const id of SUSPENSION_IDS) {
      const sol = prepareCarSuspension(gtCoupe, SUSPENSIONS[id]);
      for (const [axle, table] of [['front', sol.front.table], ['rear', sol.rear.table]] as const) {
        for (const travel of [-0.02, 0, 0.015]) {
          const c = table.sample(travel, 0, createCornerSolution(table));
          const slopeL = (c.instantCentre.z - c.contactPatch.z) / (c.instantCentre.y - c.contactPatch.y);
          const t = 2 * c.contactPatch.y;
          // roll-centre height above the patch where the left line crosses the centre plane (symmetric travel: both
          // lines meet there) = the table's roll-centre height (above the design ground) less the patch's rise
          const rc = -slopeL * c.contactPatch.y;
          const z0 = table.sample(0, 0, createCornerSolution(table)).contactPatch.z;
          expect(Math.abs(rc - (table.rollCentreHeight(travel, travel) - (c.contactPatch.z - z0)))).toBeLessThan(1e-9);
          const F = 3000; // per wheel, vehicle-frame lateral force (sprung share)
          const left = -slopeL * F;
          const right = -(-slopeL) * F;
          const m1 = (2 * F * rc) / t; // ms_axle a_y h_rc / t with 2 F = ms_axle a_y
          expect(Math.abs(left - m1)).toBeLessThan(1e-9 * Math.max(1, Math.abs(m1)));
          expect(Math.abs(right + m1)).toBeLessThan(1e-9 * Math.max(1, Math.abs(m1)));
          void axle;
        }
      }
    }
    // the ride model: with linkVertical = the M1 pair the step is bit-identical to the M1 path
    const P = {
      sprungMass: 1540,
      cgHeight: 0.5,
      inertiaRoll: 500,
      inertiaPitch: 2200,
      corners: [0, 1, 2, 3].map((i) => ({ x: i < 2 ? 1.3 : -1.4, y: i & 1 ? -0.8 : 0.8, unsprungMass: 40, wheelRate: 37000, damping: { bump: 2500, rebound: 4000 }, friction: 15, tyreRate: 260e3, tyreDamping: 200, bump: 0.06, droop: 0.08, wheelCentreHeight: 0.34 })) as never,
      arbRate: { front: 20000, rear: 12000 },
    };
    const mk = (lv?: Float64Array): RideInput => ({ ax: 1, ay: 5, road: new Float64Array(4), roadRate: new Float64Array(4), rcHeight: { front: 0.07, rear: 0.1 }, antiPitch: { front: 0.2, rear: 0.3 }, ...(lv ? { linkVertical: lv } : {}) });
    const a = createRideModel(P);
    const b = createRideModel(P);
    const ia = mk();
    const msF = (1540 * 1.4) / 2.7;
    const pair = Float64Array.from([0, 1, 2, 3], (i) => ((i & 1 ? -1 : 1) * 5 * (i < 2 ? msF : 1540 - msF) * (i < 2 ? 0.07 : 0.1)) / 1.6);
    const ib = mk(pair);
    a.reset(ia);
    b.reset(ib);
    for (let k = 0; k < 500; k++) {
      a.step(1 / 240, ia);
      b.step(1 / 240, ib);
    }
    for (let i = 0; i < 4; i++) expect(Math.abs(a.state.load[i]! - b.state.load[i]!)).toBeLessThan(1e-9 * a.state.load[i]!);
  });
});
