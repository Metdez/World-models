/**
 * 04-01 camera rig: frame-rate independence, smoothness, blends that arc around the car, shots, 2-corner frames.
 * 08-04 manual chase (synthetic drive frames and withFakeDrive): predicted target, Auto <-> Manual cross-fade, cuts,
 * frame-rate independence, ground clearance, spins / reverse / standstill / kerbs, shots refused, views in manual.
 */
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { DirectorShot, ShotKind } from '../../src/contracts/services';
import type { PathState, SimCatalog, Simulation } from '../../src/contracts/sim';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { damp, dampAngle, smootherstep, wrapAngle } from '../../src/features/camera/damp';
import { dampRamp, MANUAL, manualHeading } from '../../src/features/camera/manual';
import { BLEND_S, CameraRig, CHASE, CLOSEUP, closeupLocal, PIVOT_Y, type Pose } from '../../src/features/camera/rig';
import { createDriveFrame, type DriveMode } from '../../src/contracts/drive';
import type { GroundWorld } from '../../src/contracts/world';
import { fakeSim, withFakeDrive } from '../kernel/helpers';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { createSimulation } from '../../src/sim-core/index';

const catalog: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const newSim = (): Simulation => createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'double-wishbone' });

/** Runs the rig from lap time t0 for `seconds` at `hz`, feeding a frame whose lap time advances with wall time. */
function run(rig: CameraRig, frame: TelemetryFrame, t0: number, seconds: number, hz: number, each?: (rig: CameraRig) => void): void {
  const n = Math.round(seconds * hz);
  for (let i = 1; i <= n; i++) {
    frame.lapTime = t0 + i / hz;
    rig.update(1 / hz, frame);
    each?.(rig);
  }
}

function start(sim: Simulation, lapTime: number, frame = sim.sample(1, 1)): { rig: CameraRig; frame: TelemetryFrame } {
  const rig = new CameraRig(() => sim);
  frame.lapTime = lapTime;
  rig.update(1 / 60, frame);
  return { rig, frame };
}

describe('damping helpers', () => {
  it('exponential damping is exactly frame-rate independent for a fixed target', () => {
    const after = (hz: number) => {
      let x = 0;
      for (let i = 0; i < hz; i++) x = damp(x, 10, 3, 1 / hz);
      return x;
    };
    expect(after(30)).toBeCloseTo(after(144), 9);
    expect(after(60)).toBeCloseTo(10 * (1 - Math.exp(-3)), 9);
  });

  it('angles take the short way round and wrap', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2, 12);
    // From +170 deg toward -170 deg goes through 180, not through 0.
    const a = dampAngle((170 * Math.PI) / 180, (-170 * Math.PI) / 180, Math.LN2, 1); // half-way
    expect(Math.abs(wrapAngle(a))).toBeGreaterThan((175 * Math.PI) / 180);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('chase camera', () => {
  it('ends in the same place at 30 Hz and 144 Hz through the hairpin (frame-rate independent)', () => {
    const sim = newSim();
    const a = start(sim, 7);
    const b = start(sim, 7);
    run(a.rig, a.frame, 7, 3, 30);
    run(b.rig, b.frame, 7, 3, 144);
    expect(a.rig.out.pos.distanceTo(b.rig.out.pos)).toBeLessThan(0.05);
    expect(Math.abs(wrapAngle(a.rig.chase.heading - b.rig.chase.heading))).toBeLessThan(0.01);
    expect(a.rig.out.quat.angleTo(b.rig.out.quat)).toBeLessThan(0.01);
  });

  it('is smooth over a whole lap: no NaN, no jitter beyond the car\'s own path, always above the road', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 0);
    // Second differences of world positions at 60 Hz: jitter shows up here; the driving line's own is the floor.
    const d2 = () => {
      const p = [new Vector3(Number.NaN), new Vector3(Number.NaN)];
      let max = 0;
      return (x: Vector3) => {
        if (!Number.isNaN(p[0]!.x)) max = Math.max(max, Math.hypot(x.x - 2 * p[1]!.x + p[0]!.x, x.y - 2 * p[1]!.y + p[0]!.y, x.z - 2 * p[1]!.z + p[0]!.z));
        p[0]!.copy(p[1]!);
        p[1]!.copy(x);
        return max;
      };
    };
    const cam = d2();
    const anchor = d2();
    let camMax = 0;
    let anchorMax = 0;
    let lowest = Infinity;
    let maxLag = 0;
    run(rig, frame, 0, sim.lapDuration - 0.1, 60, (r) => {
      expect(Number.isFinite(r.out.pos.x + r.out.pos.y + r.out.pos.z + r.out.fov)).toBe(true);
      camMax = cam(r.out.pos);
      anchorMax = anchor(r.frame.pos);
      lowest = Math.min(lowest, r.out.pos.y - r.frame.pos.y);
      maxLag = Math.max(maxLag, Math.abs(wrapAngle(r.chase.heading - r.frame.heading)));
    });
    console.info(
      `chase: max second difference ${(camMax * 1000).toFixed(2)} mm/frame² (driving line ${(anchorMax * 1000).toFixed(2)}), lowest eye ${lowest.toFixed(2)} m, max heading lag ${((maxLag * 180) / Math.PI).toFixed(1)} deg`,
    );
    expect(camMax).toBeLessThan(anchorMax * 1.5 + 0.002);
    expect(lowest).toBeGreaterThan(0.9);
    // The lag reveals the car's flank in corners but never swings the camera beside it.
    expect(maxLag).toBeGreaterThan(0.05);
    expect(maxLag).toBeLessThanOrEqual(CHASE.maxHeadingLag + 1e-9);
  });

  it('snaps instead of swinging when the lap clock jumps (seek)', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 2);
    run(rig, frame, 2, 1, 60);
    frame.lapTime = 40;
    rig.update(1 / 60, frame);
    expect(rig.chase.heading).toBeCloseTo(rig.frame.heading, 9);
  });
});

describe('blends', () => {
  it('chase -> closeup arcs around the car (never closer than the nearer endpoint) and settles within BLEND_S', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 3);
    run(rig, frame, 3, 1, 60);
    const pivot = new Vector3();
    const local = new Vector3();
    const r0 = rig.frame.pointToLocal(rig.out.pos, local).distanceTo(pivot.set(0, PIVOT_Y, 0));
    rig.setView('closeup', 'fl', false);
    expect(rig.transitioning).toBe(true);
    let nearest = Infinity;
    let frames = 0;
    run(rig, frame, 4, BLEND_S + 0.1, 60, (r) => {
      if (r.transitioning) frames++;
      nearest = Math.min(nearest, r.frame.pointToLocal(r.out.pos, local).distanceTo(pivot));
    });
    const r1 = rig.frame.pointToLocal(rig.out.pos, local).distanceTo(pivot);
    expect(rig.transitioning).toBe(false);
    expect(frames).toBeLessThanOrEqual(Math.ceil(BLEND_S * 60));
    expect(nearest).toBeGreaterThan(Math.min(r0, r1) - 0.05);
  });

  it('reduced motion cuts with a dip from black instead of moving', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 3);
    rig.setView('closeup', 'rr', true);
    expect(rig.transitioning).toBe(false);
    expect(rig.fade).toBe(1);
    run(rig, frame, 3, 0.5, 60);
    expect(rig.fade).toBe(0);
  });
});

describe('close-up and director shots', () => {
  it('frames each corner from ahead of a front axle / behind a rear one, looking out at the wheel', () => {
    const eye = new Vector3();
    const aim = new Vector3();
    const fov = closeupLocal({ x: 1.4, halfTrack: 0.8, side: 1, front: true, radius: 0.35 }, eye, aim);
    expect(fov).toBe(CLOSEUP.fov);
    expect(eye.x).toBeGreaterThan(1.4);
    expect(eye.y).toBeGreaterThan(0.35); // above the hub, looking down onto the arms
    expect(eye.z).toBeLessThan(0); // left = three -z
    expect(aim.z).toBeCloseTo(-0.8, 9); // the wheel plane
    closeupLocal({ x: -1.5, halfTrack: 0.8, side: -1, front: false, radius: 0.35 }, eye, aim);
    expect(eye.x).toBeLessThan(-1.5);
    expect(eye.z).toBeGreaterThan(0);
    expect(aim.z).toBeCloseTo(0.8, 9);
  });

  it('handles a 2-corner (motorcycle) frame for every view and shot', () => {
    const sim = newSim();
    const moto = createTelemetryFrame('motorcycle', [
      { id: 'f', axle: 'front', side: 0 },
      { id: 'r', axle: 'rear', side: 0 },
    ]);
    // Body pose where the close-up runs end (lap time 6.5), so the car frame and the body frame agree there.
    sim.seek(6.5);
    const car = sim.sample(1, 1);
    Object.assign(moto.bodyPosition, car.bodyPosition);
    Object.assign(moto.bodyRotation, car.bodyRotation);
    // A bike-like vehicle (no track) on the car's path: the close-up switches to a side view of the fork/swingarm.
    const bike = Object.create(sim, {
      vehicle: { value: { ...gtCoupe, class: 'motorcycle', front: { tyre: gtCoupe.front.tyre }, rear: { tyre: gtCoupe.rear.tyre } } },
    }) as Simulation;
    const { rig, frame } = start(bike, 5, moto);
    const kinds: ShotKind[] = ['chase', 'orbit', 'closeup', 'trackside', 'overhead', 'front-view'];
    for (const corner of ['f', 'r'] as const) {
      rig.setView('closeup', corner, false);
      run(rig, frame, 5, 1.5, 30);
      expect(rig.transitioning).toBe(false);
      expect(Number.isFinite(rig.out.pos.length())).toBe(true);
      // Filmed from the left of the bike, clear of it.
      expect(rig.frame.pointToLocal(rig.out.pos, new Vector3()).z).toBeLessThan(-1);
    }
    for (const kind of kinds) {
      rig.playShot({ kind, corner: 'r', durationS: 1 }, false);
      run(rig, frame, 7, 0.5, 30);
      expect(Number.isFinite(rig.out.pos.length() + rig.out.fov)).toBe(true);
    }
  });

  it('a bike close-up films the outside of the lean, crossing over once per corner (hysteresis)', () => {
    const sim = newSim();
    const moto = createTelemetryFrame('motorcycle', [
      { id: 'f', axle: 'front', side: 0 },
      { id: 'r', axle: 'rear', side: 0 },
    ]);
    sim.seek(6.5);
    const car = sim.sample(1, 1);
    Object.assign(moto.bodyPosition, car.bodyPosition);
    Object.assign(moto.bodyRotation, car.bodyRotation);
    const bike = Object.create(sim, {
      vehicle: { value: { ...gtCoupe, class: 'motorcycle', front: { tyre: gtCoupe.front.tyre }, rear: { tyre: gtCoupe.rear.tyre } } },
    }) as Simulation;
    const { rig, frame } = start(bike, 5, moto);
    rig.setView('closeup', 'f', true);
    const sideAt = (roll: number) => {
      frame.roll = roll;
      run(rig, frame, 5, 1.5, 30);
      return Math.sign(rig.frame.pointToLocal(rig.out.pos, new Vector3()).z);
    };
    // left = three -z; a left lean (roll < 0) must be filmed from the right, and small leans never flip the side
    expect(sideAt(0.3)).toBe(-1);
    expect(sideAt(0.1)).toBe(-1);
    expect(sideAt(-0.1)).toBe(-1);
    expect(sideAt(-0.3)).toBe(1);
    expect(sideAt(0.1)).toBe(1);
    expect(sideAt(0.3)).toBe(-1);
  });

  it('the hero orbit opens on a front three-quarter and turns toward the profile', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 20);
    rig.playShot({ kind: 'orbit', durationS: 9 }, false);
    // A cut: no glide from behind the car.
    expect(rig.transitioning).toBe(false);
    run(rig, frame, 20, 0.1, 30);
    const open = rig.frame.pointToLocal(rig.out.pos, new Vector3());
    expect(open.x).toBeGreaterThan(0); // ahead of the car
    expect(open.z).toBeLessThan(0); // its left flank
    expect(Math.abs(Math.atan2(open.z, open.x))).toBeLessThan(0.8);
    run(rig, frame, 20.1, 7.5, 30);
    const end = rig.frame.pointToLocal(rig.out.pos, new Vector3());
    expect(Math.abs(Math.atan2(end.z, end.x))).toBeGreaterThan(1.2); // near the profile
  });

  it('shots override the view, expire back to it, and trackside is a fixed tripod cut', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 20);
    const shot: DirectorShot = { kind: 'trackside', durationS: 3 };
    rig.playShot(shot, false);
    expect(rig.transitioning).toBe(false);
    run(rig, frame, 20, 0.2, 60);
    const tripod = rig.out.pos.clone();
    run(rig, frame, 20.2, 1, 60);
    expect(rig.out.pos.distanceTo(tripod)).toBeLessThan(1e-9);
    expect(rig.out.fov).toBeGreaterThanOrEqual(9);
    expect(rig.out.fov).toBeLessThanOrEqual(48);
    run(rig, frame, 21.2, 2, 60);
    expect(rig.shot).toBeNull();
    expect(rig.transitioning).toBe(true);
    rig.playShot({ kind: 'overhead', durationS: 10, fov: 25 }, false);
    run(rig, frame, 23.2, 2, 60);
    expect(rig.out.fov).toBe(25);
    expect(rig.out.pos.y - rig.frame.pos.y).toBeGreaterThan(10);
    rig.clearShot(false);
    expect(rig.shot).toBeNull();
  });
});

// ---------------------------------------------------------------- 08-04 manual chase

const DEG = Math.PI / 180;

/** Car motion for the manual provider: sim x, y, yaw, body-frame u, v, yaw rate and road-wheel steer at time t. */
interface Motion {
  (t: number, out: { x: number; y: number; z: number; yaw: number; u: number; v: number; r: number; steer: number }): void;
}

const motionState = () => ({ x: 0, y: 0, z: 0, yaw: 0, u: 0, v: 0, r: 0, steer: 0 });

/** Writes a manual frame for the motion at time t (lap time follows wall time, as the detached clock roughly does). */
function drivenAt(frame: TelemetryFrame, motion: Motion, t: number, mode: DriveMode = 'manual'): TelemetryFrame {
  const m = motionState();
  motion(t, m);
  frame.lapTime = t;
  Object.assign(frame.drive, { mode, available: true, x: m.x, y: m.y, yaw: m.yaw, u: m.u, v: m.v });
  frame.bodyPosition.x = m.x;
  frame.bodyPosition.y = m.y;
  frame.bodyPosition.z = m.z;
  frame.yawRate = m.r;
  frame.steer = m.steer;
  return frame;
}

/** Steady left-hand circle about the origin: radius R, speed V, sideslip beta (rad). */
const circle =
  (R: number, V: number, beta = 0, L = 2.9): Motion =>
  (t, o) => {
    const th = (V / R) * t;
    o.x = R * Math.cos(th);
    o.y = R * Math.sin(th);
    o.yaw = th + Math.PI / 2 - beta;
    o.u = V * Math.cos(beta);
    o.v = V * Math.sin(beta);
    o.r = V / R;
    o.steer = Math.atan(L / R);
  };

/** Horizontal angle between camera->car and the car's heading (deg): 0 = straight behind. */
function behindAngle(rig: CameraRig, frame: TelemetryFrame): number {
  const dx = frame.drive.x - rig.out.pos.x;
  const dy = frame.drive.y - -rig.out.pos.z;
  return Math.abs(wrapAngle(Math.atan2(dy, dx) - frame.drive.yaw)) / DEG;
}

function runDriven(rig: CameraRig, frame: TelemetryFrame, motion: Motion, t0: number, seconds: number, hz: number, each?: (r: CameraRig, t: number) => void, mode: DriveMode = 'manual'): void {
  const n = Math.round(seconds * hz);
  for (let i = 1; i <= n; i++) {
    const t = t0 + i / hz;
    rig.update(1 / hz, drivenAt(frame, motion, t, mode));
    each?.(rig, t);
  }
}

function startDriven(sim: Simulation, motion: Motion, t0 = 0): { rig: CameraRig; frame: TelemetryFrame } {
  const frame = sim.sample(1, 1);
  const rig = new CameraRig(() => sim);
  rig.update(1 / 60, drivenAt(frame, motion, t0));
  return { rig, frame };
}

/** Second difference tracker (jitter metric) for successive positions. */
function jitter(): (x: Vector3) => number {
  const p = [new Vector3(Number.NaN), new Vector3(Number.NaN)];
  let max = 0;
  return (x) => {
    if (!Number.isNaN(p[0]!.x)) max = Math.max(max, Math.hypot(x.x - 2 * p[1]!.x + p[0]!.x, x.y - 2 * p[1]!.y + p[0]!.y, x.z - 2 * p[1]!.z + p[0]!.z));
    p[0]!.copy(p[1]!);
    p[1]!.copy(x);
    return max;
  };
}

describe('manual target heading (research m2/08 §3.2)', () => {
  const d = (u: number, v: number, yaw = 0.3) => Object.assign(createDriveFrame(), { mode: 'manual' as const, u, v, yaw });

  it('follows the velocity direction at speed, within the slip window, less the dead zone', () => {
    const slip10 = manualHeading(d(20, 20 * Math.tan(10 * DEG)), 0, 0, 2.9);
    expect(slip10 - 0.3).toBeCloseTo((10 - 1.5) * DEG, 9);
    expect(manualHeading(d(20, 20 * Math.tan(MANUAL.slipMax)), 0, 0, 2.9) - 0.3).toBeCloseTo(MANUAL.slipMax - MANUAL.deadZone, 9);
    // Past the window the car is spinning: the offset stays clamped, then fades back to the heading by 90 deg.
    expect(manualHeading(d(20, 20 * Math.tan(40 * DEG)), 0, 0, 2.9) - 0.3).toBeLessThan(MANUAL.slipMax - MANUAL.deadZone);
    expect(manualHeading(d(20, -20 * Math.tan(60 * DEG)), 0, 0, 2.9) - 0.3).toBeCloseTo(-(MANUAL.slipMax / 2 - MANUAL.deadZone), 9);
    expect(manualHeading(d(0.01, 20), 0, 0, 2.9)).toBeCloseTo(0.3, 12);
    // Below the velocity band only the heading counts.
    expect(manualHeading(d(2.5, 1), 0, 0, 2.9)).toBeCloseTo(0.3, 12);
    // Offsets inside the dead zone are ignored.
    expect(manualHeading(d(20, 20 * Math.tan(1 * DEG)), 0, 0, 2.9)).toBeCloseTo(0.3, 12);
  });

  it('leads with the mean of measured and commanded yaw rate, clamped', () => {
    const r = 0.4;
    const steer = Math.atan((0.6 * 2.9) / 20); // commanded steady yaw rate 0.6 rad/s at 20 m/s
    expect(manualHeading(d(20, 0), r, steer, 2.9) - 0.3).toBeCloseTo(MANUAL.tau * 0.5 * (0.4 + 0.6) - MANUAL.deadZone, 9);
    expect(manualHeading(d(30, 0), 5, 0.3, 2.9) - 0.3).toBeCloseTo(MANUAL.leadMax - MANUAL.deadZone, 9);
  });

  it('reverse and standstill are heading-based: no flip-flop when the velocity direction is noise', () => {
    // Reversing and sliding: velocity points behind, the target stays on the heading.
    expect(manualHeading(d(-5, 3), 0, 0, 2.9)).toBeCloseTo(0.3, 12);
    for (let i = 0; i < 50; i++) {
      const s = i % 2 ? 1 : -1;
      expect(manualHeading(d(s * 1e-4, -s * 1e-4), s * 1e-4, s * 0.5, 2.9)).toBeCloseTo(0.3, 9);
    }
  });

  it('dampRamp has no lag error for a linearly moving target (exact for any step)', () => {
    const after = (hz: number) => {
      let x = 0;
      for (let i = 0; i < 2 * hz; i++) x = dampRamp(x, i / hz, (i + 1) / hz, 2.2, 1 / hz);
      return x;
    };
    expect(after(30)).toBeCloseTo(after(144), 12);
    // x' = lambda (t - x), x(0) = 0 -> x(2) = 2 - (1 - e^{-2 lambda}) / lambda
    expect(after(60)).toBeCloseTo(2 - (1 - Math.exp(-4.4)) / 2.2, 12);
  });
});

describe('manual chase camera (08-04)', () => {
  it('Auto mode never touches the manual provider (mix stays 0)', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 3);
    run(rig, frame, 3, 2, 60, (r) => expect(r.mix).toBe(0));
  });

  it('30 / 60 / 144 Hz end in the same pose (±1 cm) after 2 s of cornering with slip', () => {
    const sim = newSim();
    const motion = circle(40, 18, 4 * DEG);
    const poses = [30, 60, 144].map((hz) => {
      const { rig, frame } = startDriven(sim, motion, 0);
      runDriven(rig, frame, motion, 0, 2, hz);
      return { pos: rig.out.pos.clone(), quat: rig.out.quat.clone() };
    });
    for (const p of poses.slice(1)) {
      expect(p.pos.distanceTo(poses[0]!.pos)).toBeLessThan(0.01);
      expect(p.quat.angleTo(poses[0]!.quat)).toBeLessThan(0.005);
    }
  });

  it('cross-fades Auto -> Manual over 0.8 s with no jump, and back (returning -> auto)', () => {
    const sim = newSim();
    // A driver who stays exactly on the driving line: Auto and Manual providers see the same car.
    const p: PathState = { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 };
    const L = sim.vehicle.wheelbase;
    const online: Motion = (t, o) => {
      sim.stateAt(t, p);
      Object.assign(o, { x: p.x, y: p.y, z: p.z, yaw: p.heading, u: p.v, v: 0, r: p.v * p.curvature, steer: Math.atan(L * p.curvature) });
    };
    const { rig, frame } = start(sim, 5);
    run(rig, frame, 5, 1, 60);
    const cam = jitter();
    const line = jitter();
    let camMax = 0;
    let lineMax = 0;
    let halfway = Number.NaN;
    let blending = 0;
    const each = (r: CameraRig, t: number) => {
      camMax = cam(r.out.pos);
      lineMax = line(r.frame.pos);
      if (r.mix > 0 && r.mix < 1) blending++;
      if (Math.abs(t - 6.4) < 1e-9) halfway = r.mix;
      expect(Number.isFinite(r.out.pos.x + r.out.pos.y + r.out.pos.z)).toBe(true);
    };
    runDriven(rig, frame, online, 6, 2, 60, each, 'manual');
    expect(rig.mix).toBe(1);
    expect(halfway).toBeCloseTo(0.5, 9);
    expect(blending).toBe(Math.round(MANUAL.blendS * 60) - 1);
    runDriven(rig, frame, online, 8, 1, 60, each, 'returning');
    runDriven(rig, frame, online, 9, 1, 60, each, 'auto');
    expect(rig.mix).toBe(0);
    console.info(`auto<->manual: max second difference ${(camMax * 1000).toFixed(2)} mm/frame² (driving line ${(lineMax * 1000).toFixed(2)})`);
    expect(camMax).toBeLessThan(lineMax * 1.5 + 0.002);
  });

  it('hard cut on cut() (reset / immediate release) and on an anchor jump > 15 m, not on a 10 m one', () => {
    const sim = newSim();
    let offset = 0;
    const base = circle(60, 15);
    const motion: Motion = (t, o) => {
      base(t, o);
      o.x += offset;
    };
    const { rig, frame } = startDriven(sim, motion);
    runDriven(rig, frame, motion, 0, 1, 60);
    // Steer a long way off the target without moving the car: a cut snaps, the next frame swings again.
    rig.chase.heading += 0.4;
    rig.cut();
    runDriven(rig, frame, motion, 1, 1 / 60, 60);
    const target = manualHeading(frame.drive, frame.yawRate, frame.steer, frame.wheelbase || sim.vehicle.wheelbase);
    expect(rig.chase.heading).toBeCloseTo(target, 9);
    rig.chase.heading += 0.4;
    offset = 10;
    runDriven(rig, frame, motion, 1.02, 1 / 60, 60);
    expect(Math.abs(wrapAngle(rig.chase.heading - target))).toBeGreaterThan(0.2);
    offset = 30;
    runDriven(rig, frame, motion, 1.04, 1 / 60, 60);
    expect(Math.abs(wrapAngle(rig.chase.heading - manualHeading(frame.drive, frame.yawRate, frame.steer, frame.wheelbase || sim.vehicle.wheelbase)))).toBeLessThan(1e-9);
  });

  it('keeps the eye 0.7 m above world.sample() under it', () => {
    const sim = newSim();
    let calls = 0;
    const world = {
      sample(_x: number, _y: number, _hint: number, out: { h: number }) {
        calls++;
        out.h = 4;
        return out;
      },
    } as unknown as GroundWorld;
    const hilly = Object.create(sim, { world: { value: world } }) as Simulation;
    const { rig, frame } = startDriven(hilly, circle(50, 10));
    runDriven(rig, frame, circle(50, 10), 0, 1, 60);
    expect(calls).toBeGreaterThan(0);
    expect(rig.out.pos.y).toBeGreaterThanOrEqual(4 + MANUAL.clearance - 1e-9);
  });

  it('stays behind and smooth through a spin, a slide, a reverse and a standstill', () => {
    const sim = newSim();
    // Spin: the car slides along +x while its yaw turns at 3 rad/s and the speed bleeds off.
    const spin: Motion = (t, o) => {
      const V = Math.max(0, 20 - 6 * t);
      o.x = 20 * t - 3 * t * t;
      o.y = 0;
      o.yaw = 3 * t;
      o.u = V * Math.cos(o.yaw);
      o.v = -V * Math.sin(o.yaw);
      o.r = 3;
      o.steer = -0.2;
    };
    const { rig, frame } = startDriven(sim, spin);
    let maxRate = 0;
    let maxAccel = 0;
    let targetRate = 0;
    let targetAccel = 0;
    let lastTargetRate = Number.NaN;
    let rate = 0;
    let last = rig.chase.heading;
    let lastTarget = Number.NaN;
    let worst = 0;
    runDriven(rig, frame, spin, 0, 3, 60, (r) => {
      const now = wrapAngle(r.chase.heading - last) * 60;
      maxAccel = Math.max(maxAccel, Math.abs(now - rate) * 60);
      rate = now;
      maxRate = Math.max(maxRate, Math.abs(rate));
      last = r.chase.heading;
      const target = manualHeading(frame.drive, frame.yawRate, frame.steer, sim.vehicle.wheelbase);
      if (!Number.isNaN(lastTarget)) {
        const tr = wrapAngle(target - lastTarget) * 60;
        targetRate = Math.max(targetRate, Math.abs(tr));
        if (!Number.isNaN(lastTargetRate)) targetAccel = Math.max(targetAccel, Math.abs(tr - lastTargetRate) * 60);
        lastTargetRate = tr;
      }
      lastTarget = target;
      worst = Math.max(worst, Math.abs(wrapAngle(r.chase.heading - frame.drive.yaw)));
    });
    console.info(
      `spin: camera yaw rate max ${maxRate.toFixed(2)} rad/s (car 3, target ${targetRate.toFixed(2)}), yaw acceleration max ${maxAccel.toFixed(1)} rad/s² (target ${targetAccel.toFixed(1)}), max angle off the heading ${(worst / DEG).toFixed(0)} deg`,
    );
    // Never whips faster than its target, no velocity steps (the car itself starts spinning at 3 rad/s from rest).
    expect(maxRate).toBeLessThanOrEqual(targetRate);
    expect(maxAccel).toBeLessThan(targetAccel / 2);
    expect(worst).toBeLessThan(MANUAL.hardLag);
    // Reverse along a gentle arc for 2 s: the camera stays behind the car (no 180 deg flip).
    const reverse: Motion = (t, o) => {
      o.yaw = 1 - 0.1 * t;
      o.x = -4 * t * Math.cos(o.yaw);
      o.y = -4 * t * Math.sin(o.yaw);
      o.u = -4;
      o.v = 0.3;
      o.r = -0.1;
      o.steer = 0.15;
    };
    runDriven(rig, frame, reverse, 0, 3, 60);
    expect(behindAngle(rig, frame)).toBeLessThan(25);
    // Standstill with sensor noise: the camera heading does not wander or flip.
    const still: Motion = (t, o) => {
      const s = Math.round(t * 60) % 2 ? 1 : -1;
      Object.assign(o, { x: 5, y: 5, yaw: 2, u: s * 1e-3, v: -s * 1e-3, r: s * 1e-3, steer: s * 0.4 });
    };
    runDriven(rig, frame, still, 0, 4, 60);
    const settled = rig.chase.heading;
    runDriven(rig, frame, still, 4, 2, 60, (r) => expect(Math.abs(wrapAngle(r.chase.heading - settled))).toBeLessThan(0.002));
    expect(Math.abs(wrapAngle(settled - 2))).toBeLessThan(1 * DEG);
  });

  it('kerb chatter in the body height barely reaches the eye; a crest does', () => {
    const sim = newSim();
    const straight =
      (bump: (t: number) => number): Motion =>
      (t, o) =>
        Object.assign(o, { x: 15 * t, y: 0, z: bump(t), yaw: 0, u: 15, v: 0, r: 0, steer: 0 });
    const kerb = straight((t) => 0.03 * Math.sin(2 * Math.PI * 20 * t));
    const { rig, frame } = startDriven(sim, kerb);
    runDriven(rig, frame, kerb, 0, 2, 120);
    let lo = Infinity;
    let hi = -Infinity;
    runDriven(rig, frame, kerb, 2, 1, 120, (r) => {
      lo = Math.min(lo, r.out.pos.y);
      hi = Math.max(hi, r.out.pos.y);
    });
    expect(hi - lo).toBeLessThan(0.01);
    const crest = straight((t) => (t > 1 ? 1 : 0) * Math.min(1, t - 1));
    const b = startDriven(sim, crest);
    runDriven(b.rig, b.frame, crest, 0, 3, 60);
    expect(b.rig.out.pos.y - b.rig.frame.pos.y).toBeCloseTo(b.rig.chase.height, 1);
    expect(b.rig.frame.pos.y).toBeGreaterThan(0.98);
  });

  it('refuses director shots outside auto and lets a playing one go when the visitor takes the wheel', () => {
    const sim = newSim();
    const { rig, frame } = start(sim, 20);
    rig.playShot({ kind: 'overhead', durationS: 10 }, false);
    run(rig, frame, 20, 0.5, 60);
    expect(rig.shot).not.toBeNull();
    const motion = circle(80, 12);
    runDriven(rig, frame, motion, 0, 1 / 60, 60);
    expect(rig.shot).toBeNull();
    rig.playShot({ kind: 'orbit', durationS: 5 }, false);
    expect(rig.shot).toBeNull();
    runDriven(rig, frame, motion, 0.02, 2, 60);
    expect(behindAngle(rig, frame)).toBeLessThan(25);
  });

  it('close-up and explore keep working while driving', () => {
    const sim = newSim();
    const motion = circle(60, 14);
    const local = new Vector3();
    const explore = (f: { pos: Vector3; heading: number }, _dt: number, out: Pose) => {
      // A fixed orbit point beside the car (as camera-controls would hold it).
      out.pos.set(0, 2, -6).add(f.pos);
      out.quat.identity();
      out.fov = 45;
      return true;
    };
    const frame = sim.sample(1, 1);
    const rig = new CameraRig(() => sim, explore as never);
    rig.update(1 / 60, drivenAt(frame, motion, 0));
    runDriven(rig, frame, motion, 0, 1, 60);
    rig.setView('closeup', 'fl', false);
    runDriven(rig, frame, motion, 1, BLEND_S + 0.1, 60);
    expect(rig.transitioning).toBe(false);
    // The close-up hangs off the body pose: within a couple of metres of the car.
    expect(rig.out.pos.distanceTo(new Vector3(frame.bodyPosition.x, frame.bodyPosition.z, -frame.bodyPosition.y))).toBeLessThan(3);
    rig.setView('explore', null, false);
    runDriven(rig, frame, motion, 3, BLEND_S + 0.1, 60);
    expect(rig.frame.pointToLocal(rig.out.pos, local).length()).toBeGreaterThan(5);
    expect(rig.out.pos.y - rig.frame.pos.y).toBeCloseTo(2, 6);
    rig.setView('follow', null, false);
    runDriven(rig, frame, motion, 5, BLEND_S + 1, 60);
    expect(behindAngle(rig, frame)).toBeLessThan(25);
  });

  it('drives the camera from a (fake) Simulation.drive: manual request, then reverse, camera behind throughout', () => {
    const sim = withFakeDrive(fakeSim({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'double-wishbone' }));
    const rig = new CameraRig(() => sim);
    const frame = () => sim.sample(1, 1);
    rig.update(1 / 60, frame());
    sim.drive.request('manual');
    sim.drive.setIntent({ steer: 0, throttle: 1, brake: 0, handbrake: 0, digital: true, source: 'keyboard' });
    const tick = (n: number, each?: () => void) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) sim.step(1 / 240);
        rig.update(1 / 60, frame());
        each?.();
      }
    };
    tick(120);
    expect(sim.drive.mode).toBe('manual');
    expect(rig.mix).toBe(1);
    sim.drive.setIntent({ steer: 0.3, throttle: 0, brake: 1, handbrake: 0, digital: true, source: 'keyboard' });
    tick(240, () => expect(Number.isFinite(rig.out.pos.x + rig.out.pos.y + rig.out.pos.z)).toBe(true));
    expect(frame().drive.u).toBeLessThan(-0.5);
    expect(behindAngle(rig, frame())).toBeLessThan(25);
  });

  it('allocates nothing per frame in manual (pose objects identity-stable, retained heap < 64 KB)', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const sim = newSim();
    const motion = circle(40, 18, 3 * DEG);
    const { rig, frame } = startDriven(sim, motion);
    const refs = [rig.out, rig.out.pos, rig.out.quat, rig.frame, rig.chase.look];
    runDriven(rig, frame, motion, 0, 30, 60);
    if (!gc) return;
    gc();
    const before = process.memoryUsage().heapUsed;
    runDriven(rig, frame, motion, 30, 300, 60);
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024);
    expect([rig.out, rig.out.pos, rig.out.quat, rig.frame, rig.chase.look]).toEqual(refs);
  });
});
