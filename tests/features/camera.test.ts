/** 04-01 camera rig: frame-rate independence, smoothness, blends that arc around the car, shots, 2-corner frames. */
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { DirectorShot, ShotKind } from '../../src/contracts/services';
import type { SimCatalog, Simulation } from '../../src/contracts/sim';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { damp, dampAngle, smootherstep, wrapAngle } from '../../src/features/camera/damp';
import { BLEND_S, CameraRig, CHASE, closeupLocal, CLOSEUP, PIVOT_Y } from '../../src/features/camera/rig';
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
  it('frames each wheel well from outboard, ahead of a front axle and behind a rear one', () => {
    const eye = new Vector3();
    const aim = new Vector3();
    const fov = closeupLocal({ x: 1.4, halfTrack: 0.8, side: 1, front: true, radius: 0.35 }, eye, aim);
    expect(fov).toBe(CLOSEUP.fov);
    expect(eye.x).toBeGreaterThan(1.4);
    expect(eye.z).toBeLessThan(-0.8); // left = three -z, outboard of the tyre
    expect(aim.z).toBeGreaterThan(eye.z);
    closeupLocal({ x: -1.5, halfTrack: 0.8, side: -1, front: false, radius: 0.35 }, eye, aim);
    expect(eye.x).toBeLessThan(-1.5);
    expect(eye.z).toBeGreaterThan(0.8);
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
    const { rig, frame } = start(sim, 5, moto);
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
