/**
 * N1 / MD-17 and the suspension-type honesty report (09-04): MacPherson, double wishbone and multi-link on the same
 * car, the same scripted driver inputs and the same shared bushing table; every difference comes from the geometry
 * tables and the compliance they derive (nothing per type is tuned). Printed as a table (copied into the 09-04
 * SUMMARY); the control runs identical tables twice and must give identical numbers. The test
 * asserts the control and plausibility (no type unstable), never that a type wins or loses.
 */
import { describe, expect, it } from 'vitest';
import { G } from '../../src/contracts/units';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { plantRig, SUSPENSION_IDS, type SuspensionId } from '../fixtures/08-02-drive';
import { flatWorld, kAt, ramp, rig, rollGradient, speedHold, stepSteer, steerFor, turnEvent } from '../fixtures/09-04-handling';

const OFF = { abs: false, traction: false, stability: false, steering: false } as const;
const deg = (r: number): number => (r * 180) / Math.PI;

/** ISO 3888-2-style lane change input (same for every type): one steer period then a smaller counter period. */
function laneChange(id: SuspensionId, u: number, amplitude: number) {
  const r = rig({ suspension: id, aids: OFF });
  r.launch(u);
  const hold = speedHold(u);
  let betaMax = 0;
  let rMax = 0;
  const n = Math.round(5 / r.dt);
  for (let k = 0; k < n; k++) {
    const t = k * r.dt;
    // 0-1.6 s: one full sine period (out and back), 1.6-2.8 s: a half-amplitude counter period to settle the heading
    r.cmd.steer = t < 1.6 ? amplitude * Math.sin((2 * Math.PI * t) / 1.6) : t < 2.8 ? -0.35 * amplitude * Math.sin((2 * Math.PI * (t - 1.6)) / 1.2) : 0;
    hold(r);
    r.step();
    betaMax = Math.max(betaMax, Math.abs(r.plant.view.beta));
    rMax = Math.max(rMax, Math.abs(r.plant.view.r));
  }
  const v = r.plant.view;
  return { betaMax, rMax, offset: v.y, heading: Math.atan2(v.sinYaw, v.cosYaw), yawRateEnd: v.r };
}

/** Bump strip on the left wheel track only (cosine bumps 30 mm x 0.5 m every 3 m), straight at u, steer held 0. */
function bumpStrip(id: SuspensionId, u: number) {
  const height = (x: number, y: number): number => {
    if (y < 0.3 || x < 20 || x > 80) return 0;
    const p = (x - 20) % 3;
    return p < 0.5 ? 0.015 * (1 - Math.cos((2 * Math.PI * p) / 0.5)) : 0;
  };
  const r = rig({ suspension: id, aids: OFF, world: flatWorld(height) });
  r.launch(u);
  const hold = speedHold(u);
  let rMax = 0;
  let loadMin = Infinity;
  while (r.plant.view.x < 110) {
    r.cmd.steer = 0;
    hold(r);
    const f = r.step();
    rMax = Math.max(rMax, Math.abs(r.plant.view.r));
    if (r.plant.view.x > 20 && r.plant.view.x < 85) for (const c of f.corners) loadMin = Math.min(loadMin, c.load);
  }
  return { drift: r.plant.view.y, heading: Math.atan2(r.plant.view.sinYaw, r.plant.view.cosYaw), rMax, loadMin };
}

/** 100-0 km/h with ABS on the flat pad. */
function braking(id: SuspensionId): number {
  const r = rig({ suspension: id });
  r.launch(100 / 3.6);
  const x0 = r.plant.view.x;
  r.cmd.brake = 1;
  while (r.plant.view.u > 0.01 && r.t < 10) r.step();
  return r.plant.view.x - x0;
}

/** Body vertical acceleration RMS on the loop's pave section at 15 m/s (line-following test driver). */
function rideRms(id: SuspensionId): number {
  const r = plantRig(provingLoop, id);
  const sec = r.track.sections.find((x) => x.id === 'pave')!;
  const ts = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  r.track.sample(sec.s0 - 40, ts);
  r.plant.place(ts.x, ts.y, ts.heading);
  const steerTo = () => {
    const f = r.frame;
    const e = Number.isFinite(f.drive.lineOffset) ? f.drive.lineOffset : 0;
    const he = Number.isFinite(f.drive.headingError) ? f.drive.headingError : 0;
    r.cmd.steer = Math.max(-0.5, Math.min(0.5, -0.08 * e - 0.8 * he));
  };
  while (r.frame.drive.u < 15) {
    r.cmd.throttle = 0.5;
    steerTo();
    r.step(1);
  }
  const z: number[] = [];
  for (let k = 0; k < 240 * 4; k++) {
    steerTo();
    r.cmd.throttle = Math.max(0, Math.min(1, 0.3 * (15 - r.frame.drive.u) + 0.15));
    z.push(r.step(1).bodyPosition.z);
  }
  let sum = 0;
  for (let k = 1; k < z.length - 1; k++) {
    const a = (z[k + 1]! - 2 * z[k]! + z[k - 1]!) * 240 * 240;
    sum += a * a;
  }
  return Math.sqrt(sum / (z.length - 2));
}

interface Report {
  readonly id: string;
  readonly k03: number;
  readonly k05: number;
  readonly roll: number;
  readonly skidpad: number;
  readonly tYaw: number;
  readonly overshoot: number;
  readonly ayStep: number;
  readonly laneBeta: number;
  readonly laneR: number;
  readonly brakeYaw: number;
  readonly brakeKappa: number;
  readonly toeOuterSteady: number;
  readonly toeInnerSteady: number;
  readonly toeOuterBrake: number;
  readonly toeInnerBrake: number;
  readonly rearSteerSteady: number;
  readonly rearSteerBrake: number;
  readonly bumpDrift: number;
  readonly bumpYaw: number;
  readonly brake100: number;
  readonly rideRms: number;
}

function report(id: SuspensionId): Report {
  const left = ramp(id, 50, 1);
  const pad = ramp(id, 45.7, 1, 10, 0.08);
  const u = 27.78;
  const step = stepSteer(id, u, STEP_DELTA);
  const lane = laneChange(id, 80 / 3.6, LANE_AMPLITUDE);
  const b = turnEvent(id, 'brake', 0.3);
  const bump = bumpStrip(id, 25);
  return {
    id,
    k03: kAt(left, 0.3),
    k05: kAt(left, 0.5),
    roll: rollGradient(left),
    skidpad: pad.peak / G,
    tYaw: step.tYaw,
    overshoot: step.overshoot,
    ayStep: step.aySteady,
    laneBeta: deg(lane.betaMax),
    laneR: lane.rMax,
    brakeYaw: deg(b.yawDeviation),
    brakeKappa: b.kappaRatio05,
    toeOuterSteady: deg(b.rearToeSteady[0]),
    toeInnerSteady: deg(b.rearToeSteady[1]),
    toeOuterBrake: deg(b.rearToeEvent[0]),
    toeInnerBrake: deg(b.rearToeEvent[1]),
    rearSteerSteady: deg(b.rearSteerSteady),
    rearSteerBrake: deg(b.rearSteerEvent),
    bumpDrift: bump.drift,
    bumpYaw: bump.rMax,
    brake100: braking(id),
    rideRms: rideRms(id),
  };
}

// the same driver inputs for every type: the double-wishbone steer for 4 m/s^2 at 100 km/h, a 2.2 deg lane change
let STEP_DELTA = 0;
const LANE_AMPLITUDE = (2.2 * Math.PI) / 180;

describe('suspension-type honesty report (N1, MD-17)', () => {
  it('per-type report with the same driver inputs; identical tables give identical numbers (control)', () => {
    STEP_DELTA = steerFor('double-wishbone', 27.78, 4);
    const rows = SUSPENSION_IDS.map((id) => report(id));
    // control: the same tables twice
    const again = report('macpherson');
    expect(again).toEqual(rows[0]);
    const f = (x: number, d = 2): string => x.toFixed(d);
    const lines = [
      '| metric | ' + rows.map((r) => r.id).join(' | ') + ' |',
      '|---|' + rows.map(() => '---').join('|') + '|',
      `| understeer gradient K at 0.3 g (deg/g) | ${rows.map((r) => f(r.k03)).join(' | ')} |`,
      `| K at 0.5 g (deg/g) | ${rows.map((r) => f(r.k05)).join(' | ')} |`,
      `| roll gradient 0.1-0.5 g (deg/g) | ${rows.map((r) => f(r.roll)).join(' | ')} |`,
      `| skidpad R 45.7 m max steady a_y (g) | ${rows.map((r) => f(r.skidpad, 3)).join(' | ')} |`,
      `| step steer 100 km/h, same steer ${f(deg(STEP_DELTA), 3)} deg: steady a_y (m/s^2) | ${rows.map((r) => f(r.ayStep)).join(' | ')} |`,
      `| step steer: yaw-rate response time (s) | ${rows.map((r) => f(r.tYaw, 3)).join(' | ')} |`,
      `| step steer: yaw overshoot (%) | ${rows.map((r) => f(r.overshoot * 100, 1)).join(' | ')} |`,
      `| lane change 80 km/h, same 2.2 deg input: peak sideslip (deg) | ${rows.map((r) => f(r.laneBeta)).join(' | ')} |`,
      `| lane change: peak yaw rate (rad/s) | ${rows.map((r) => f(r.laneR, 3)).join(' | ')} |`,
      `| brake in turn (0.45 g, pedal 0.3): yaw deviation over 1 s (deg) | ${rows.map((r) => f(r.brakeYaw)).join(' | ')} |`,
      `| brake in turn: path curvature ratio at 0.5 s | ${rows.map((r) => f(r.brakeKappa, 3)).join(' | ')} |`,
      `| rear compliance toe, steady 0.45 g, outer / inner (deg, + toe-in) | ${rows.map((r) => `${f(r.toeOuterSteady, 3)} / ${f(r.toeInnerSteady, 3)}`).join(' | ')} |`,
      `| rear compliance toe, braking in the turn, outer / inner (deg) | ${rows.map((r) => `${f(r.toeOuterBrake, 3)} / ${f(r.toeInnerBrake, 3)}`).join(' | ')} |`,
      `| rear axle steer (kinematic + compliance), steady / braking (deg, + into the turn) | ${rows.map((r) => `${f(r.rearSteerSteady, 3)} / ${f(r.rearSteerBrake, 3)}`).join(' | ')} |`,
      `| bump strip (left track, 30 mm, 25 m/s, steer 0): lateral drift at 110 m (m) | ${rows.map((r) => f(r.bumpDrift, 3)).join(' | ')} |`,
      `| bump strip: peak yaw rate (rad/s) | ${rows.map((r) => f(r.bumpYaw, 4)).join(' | ')} |`,
      `| 100-0 km/h, ABS (m) | ${rows.map((r) => f(r.brake100, 1)).join(' | ')} |`,
      `| ride: body vertical acceleration RMS, loop pave 15 m/s (m/s^2) | ${rows.map((r) => f(r.rideRms, 2)).join(' | ')} |`,
    ];
    // "best" per metric (lower is better except skidpad); report a universal winner instead of hiding it
    const better: [keyof Report, 1 | -1][] = [['skidpad', 1], ['laneBeta', -1], ['brake100', -1], ['rideRms', -1], ['bumpYaw', -1], ['overshoot', -1]];
    const wins = better.map(([k, sgn]) => rows.reduce((a, b) => ((b[k] as number) * sgn > (a[k] as number) * sgn ? b : a)).id);
    const universal = SUSPENSION_IDS.find((id) => wins.every((w) => w === id));
    console.log(`[N1] suspension-type report (same car, same inputs, aids off unless stated)\n${lines.join('\n')}\n[N1] best per metric (${better.map(([k]) => k).join(', ')}): ${wins.join(', ')}; universal winner: ${universal ?? 'none'}`);
    // plausibility: no type unstable in these manoeuvres
    for (const r of rows) {
      expect(r.laneBeta).toBeLessThan(10);
      expect(r.overshoot).toBeLessThan(0.5);
      expect(Math.abs(r.bumpDrift)).toBeLessThan(2);
    }
  }, 300_000);
});
