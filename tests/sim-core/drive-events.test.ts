/**
 * 11-02 drive-event detectors (ARCHITECTURE-M2 §7.11) on scripted plant runs: the plant is driven open-loop (bare rig,
 * flat ground unless stated) and every step's frame feeds the detectors, as the coach does with sampled frames.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, type DriveAids, type DriveEvent } from '../../src/contracts/drive';
import type { PathState } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/units';
import type { Frenet } from '../../src/contracts/world';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { createDetectorInput, createDriveDetectors, DETECTOR, frameDetectorInput, type DriveMoment } from '../../src/sim-core/drive/events';
import { createPathDriver } from '../../src/sim-core/drive/path-driver';
import { loopLine } from '../../src/sim-core/drive/reference';
import { buildSpeedProfile } from '../../src/sim-core/path/speed-profile';
import { plantRig, SUSPENSION_IDS } from '../fixtures/08-02-drive';
import { flatWorld, rig, type Rig } from '../fixtures/09-04-handling';

const OFF: Partial<DriveAids> = { abs: false, traction: false, stability: false, steering: false };
const L = gtCoupe.wheelbase;

interface Run {
  readonly events: (DriveEvent & { t: number })[];
  readonly moments: (DriveMoment & { t: number })[];
}

/** Drives `r` for `seconds` with `script(t)` setting r.cmd; feeds every step's frame to fresh detectors. */
function drive(r: Rig, seconds: number, script: (t: number, r: Rig) => void): Run {
  const det = createDriveDetectors(gtCoupe);
  const input = createDetectorInput();
  const ev: DriveEvent[] = [];
  const mo: DriveMoment[] = [];
  const run: Run = { events: [], moments: [] };
  for (let k = 0; k < Math.round(seconds / r.dt); k++) {
    const t = k * r.dt;
    script(t, r);
    const f = r.step();
    det.step(r.dt, r.plant.view, frameDetectorInput(f, input), ev, mo);
    for (const e of ev.splice(0)) run.events.push({ ...e, t });
    for (const m of mo.splice(0)) run.moments.push({ ...m, t });
  }
  return run;
}
const kinds = (r: Run) => r.events.map((e) => e.kind);
const of = <K extends DriveEvent['kind']>(r: Run, kind: K) => r.events.filter((e): e is Extract<DriveEvent, { kind: K }> & { t: number } => e.kind === kind);

/** Lift-off: R 40 m at 18 m/s with 0.7 throttle and 1.6x the kinematic steer; the throttle is released at 1.2 s. */
const liftOff = (release: boolean) => (t: number, r: Rig) => {
  r.cmd.steer = Math.atan(L / 40) * 1.6;
  r.cmd.throttle = !release || t < 1.2 ? 0.7 : 0;
};

describe('slide', () => {
  it('lift-off slide: the rear goes past its peak right after the throttle is released and fires with lift', () => {
    const r = rig({ aids: OFF });
    r.launch(18, 1 / 40);
    const run = drive(r, 3, liftOff(true));
    const rear = of(run, 'slide').filter((e) => e.axle === 'rear');
    console.log('lift-off:', JSON.stringify(of(run, 'slide').map((e) => ({ axle: e.axle, lift: e.lift, t: +e.t.toFixed(2) }))));
    expect(rear).toHaveLength(1);
    expect(rear[0]!.lift).toBe(true);
    expect(rear[0]!.t).toBeGreaterThan(1.2);
    expect(rear[0]!.t).toBeLessThan(1.2 + DETECTOR.liftWindow);
  });

  it('understeer push: a sudden steer at speed with a light throttle slides the front first, without lift', () => {
    const r = rig({ aids: OFF });
    r.launch(25);
    const run = drive(r, 3, (t, rr) => {
      rr.cmd.steer = t > 0.5 ? 0.25 : 0;
      rr.cmd.throttle = 0.2;
    });
    const slides = of(run, 'slide');
    expect(slides[0]).toMatchObject({ axle: 'front', lift: false });
    expect(slides.filter((e) => e.axle === 'front')).toHaveLength(1); // one push, held: no repeats
  });

  it('a steady corner below the limit and a straight produce no events', () => {
    const r = rig();
    r.launch(15, 1 / 60);
    const run = drive(r, 6, (_t, rr) => {
      rr.cmd.steer = Math.atan(L / 60);
      rr.cmd.throttle = 0.15;
    });
    expect(run.events).toEqual([]);
    expect(run.moments).toEqual([]);
  });

  it('without handling data (no tyre curve) the slide detector is off, the others still run', () => {
    const det = createDriveDetectors();
    const input = createDetectorInput();
    input.slipAngle.fill(1);
    input.load.fill(4000);
    input.capacity.fill(4000);
    input.slipRatio.fill(-1);
    input.vx.fill(20);
    input.brake = 1;
    const out: DriveEvent[] = [];
    for (let k = 0; k < 240; k++) det.step(SIM_DT, { u: 20 }, input, out);
    expect(out.map((e) => e.kind)).toEqual(['lockup', 'lockup', 'lockup', 'lockup']);
  });
});

describe('lock-up and wheelspin depend on the assists', () => {
  it('full brake at speed: lock-up only with ABS off; ABS on reports the aid once; both end in a hard stop', () => {
    const on = rig();
    on.launch(25);
    const a = drive(on, 4, (_t, rr) => void (rr.cmd.brake = 1));
    expect(of(a, 'lockup')).toEqual([]);
    expect(of(a, 'aid').map((e) => e.aid)).toEqual(['abs']);
    const off = rig({ aids: OFF });
    off.launch(25);
    const b = drive(off, 4, (_t, rr) => void (rr.cmd.brake = 1));
    const corners = of(b, 'lockup').map((e) => e.corner);
    expect(corners).toContain(0);
    expect(corners).toContain(1);
    expect(new Set(corners).size).toBe(corners.length); // once per wheel while it stays locked
    for (const run of [a, b]) {
      const stop = run.moments.filter((m) => m.kind === 'hard-stop');
      expect(stop).toHaveLength(1);
      expect(stop[0]).toMatchObject({ kind: 'hard-stop' });
      expect((stop[0] as { from: number }).from).toBeGreaterThan(24);
    }
  });

  it('full throttle from rest: wheelspin only with traction assist off', () => {
    const on = rig();
    on.launch(0.5);
    const a = drive(on, 3, (_t, rr) => void (rr.cmd.throttle = 1));
    expect(of(a, 'wheelspin')).toEqual([]);
    expect(of(a, 'aid').map((e) => e.aid)).toContain('traction');
    const off = rig({ aids: OFF });
    off.launch(0.5);
    const b = drive(off, 2, (_t, rr) => void (rr.cmd.throttle = 1));
    expect(of(b, 'wheelspin').map((e) => e.corner).sort()).toEqual([2, 3]); // the driven rear wheels
  });

  it('a gentle stop is not a hard stop', () => {
    const r = rig();
    r.launch(15);
    const run = drive(r, 10, (_t, rr) => void (rr.cmd.brake = 0.12));
    expect(run.moments.filter((m) => m.kind === 'hard-stop')).toEqual([]);
  });
});

describe('strikes', () => {
  // a 5 cm, 0.6 m raised-cosine bump under the left wheels at x = 20 m
  const bump = (x: number, y: number) => (y > 0 && x > 20 && x < 20.6 ? 0.025 * (1 - Math.cos(((x - 20) / 0.6) * 2 * Math.PI)) : 0);

  it('each left wheel striking a bump fires once; on a kerb surface the strike says kerb', () => {
    for (const surface of ['asphalt', 'kerb'] as const) {
      const r = rig({ world: flatWorld(bump, undefined, surface) });
      r.launch(15);
      const run = drive(r, 2.5, (_t, rr) => void (rr.cmd.throttle = 0.1));
      const strikes = run.moments.filter((m) => m.kind === 'strike') as Extract<DriveMoment, { kind: 'strike' }>[];
      expect(strikes.map((m) => m.corner)).toEqual([0, 2]);
      expect(strikes.every((m) => m.kerb === (surface === 'kerb'))).toBe(true);
      expect(run.events).toEqual([]);
    }
  });
});

describe('hysteresis and rate limits', () => {
  it('a condition that flickers faster than the re-arm time fires once; after a quiet re-arm time it fires again', () => {
    const det = createDriveDetectors();
    const input = createDetectorInput();
    const out: DriveEvent[] = [];
    const set = (on: boolean) => {
      input.absActive = on;
    };
    // flicker 0.1 s on / 0.2 s off for 3 s: one event
    for (let k = 0; k < Math.round(3 / SIM_DT); k++) {
      set(k * SIM_DT % 0.3 < 0.1);
      det.step(SIM_DT, { u: 20 }, input, out);
    }
    expect(out).toHaveLength(1);
    // quiet for the re-arm time, then on again: a second event
    set(false);
    for (let k = 0; k < Math.round(DETECTOR.rearm / SIM_DT) + 1; k++) det.step(SIM_DT, { u: 20 }, input, out);
    set(true);
    det.step(SIM_DT, { u: 20 }, input, out);
    expect(out).toHaveLength(2);
    det.reset();
    out.length = 0;
    det.step(SIM_DT, { u: 20 }, input, out);
    expect(out).toHaveLength(1);
  });

  it('frame rate does not change what is detected (240 Hz steps vs 60 Hz samples)', () => {
    const at = (every: number) => {
      const r = rig({ aids: OFF });
      r.launch(18, 1 / 40);
      const det = createDriveDetectors(gtCoupe);
      const input = createDetectorInput();
      const ev: DriveEvent[] = [];
      for (let k = 0; k < Math.round(3 / r.dt); k++) {
        liftOff(true)(k * r.dt, r);
        const f = r.step();
        if (k % every === every - 1) det.step(r.dt * every, r.plant.view, frameDetectorInput(f, input), ev);
      }
      return ev.map((e) => `${e.kind}:${'axle' in e ? `${e.axle}:${e.lift}` : ''}`).sort();
    };
    expect(at(4)).toEqual(at(1));
  });

  it('deterministic: the same run twice gives the same events at the same times', () => {
    const once = () => {
      const r = rig({ aids: OFF });
      r.launch(18, 1 / 40);
      return JSON.stringify(drive(r, 3, liftOff(true)));
    };
    expect(once()).toBe(once());
  });

  it('no allocation between events', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc).toBeTypeOf('function');
    const det = createDriveDetectors(gtCoupe);
    const input = createDetectorInput();
    input.load.fill(4000);
    input.capacity.fill(4000);
    input.slipAngle.fill(0.01);
    input.vx.fill(20);
    input.throttle = 0.4;
    const out: DriveEvent[] = [];
    const view = { u: 20 };
    const block = () => {
      for (let k = 0; k < 20000; k++) {
        input.slipRatio[k & 3] = (k & 63) * 1e-3;
        det.step(SIM_DT, view, input, out);
      }
    };
    block();
    let churn = Infinity;
    let retained = Infinity;
    for (let i = 0; i < 3; i++) {
      gc!();
      const before = process.memoryUsage().heapUsed;
      block();
      churn = Math.min(churn, process.memoryUsage().heapUsed - before);
      gc!();
      retained = Math.min(retained, process.memoryUsage().heapUsed - before);
    }
    // same tripwire as the plant (plant-no-alloc.test.ts): nothing retained, churn at the level of runtime noise
    console.log(`detectors: heap churn ${(churn / 20000).toFixed(0)} B/step, retained ${retained} B`);
    expect(out).toEqual([]);
    expect(retained).toBeLessThan(64 * 1024);
    expect(churn / 20000).toBeLessThan(200);
  });
});

describe('no false positives on a normal lap', () => {
  const newPath = (): PathState => ({ lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });

  it.each(SUSPENSION_IDS)('%s: the loop autopilot at Auto speeds, aids on: no slide, lock-up, wheelspin or hard stop; strikes only on road features', (id) => {
    const r = plantRig(undefined, id);
    const profile = buildSpeedProfile(r.track, gtCoupe.limits, gtCoupe.dragArea, gtCoupe.mass);
    const path = profile.stateAt(0, newPath());
    r.model.reset(path);
    r.plant.engageFromPath(path, { ax: NaN, ay: NaN });
    const pd = createPathDriver(gtCoupe, loopLine(r.track, profile, r.world), { speedScale: 0.97, exactSpeed: false });
    pd.engage(r.plant.view, r.plant.command);
    r.setAids(DEFAULT_AIDS);
    const det = createDriveDetectors(gtCoupe);
    const input = createDetectorInput();
    const ev: DriveEvent[] = [];
    const mo: DriveMoment[] = [];
    const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
    const strikes: { section: string; kerb: boolean }[] = [];
    const settle = Math.round(1 / SIM_DT); // the engage transient (as the coach ignores the first second after a takeover)
    for (let k = 0; k < Math.round(profile.lapDuration / SIM_DT); k++) {
      pd.step(SIM_DT, r.plant.view, r.cmd);
      const f = r.step();
      const n = mo.length;
      det.step(SIM_DT, r.plant.view, frameDetectorInput(f, input), ev, mo);
      if (k < settle) {
        ev.length = 0;
        mo.length = 0;
        continue;
      }
      for (const m of mo.slice(n)) {
        const sAt = r.world.project(f.drive.x, f.drive.y, NaN, fr).s;
        const sec = r.track.sections.find((x) => sAt >= x.s0 && sAt < x.s1)!;
        if (m.kind === 'strike') strikes.push({ section: sec.id, kerb: m.kerb });
      }
    }
    const aids = ev.filter((e) => e.kind === 'aid').length;
    console.log(`${id}: lap: ${aids} aid edges, strikes ${JSON.stringify(strikes)}`);
    expect(ev.filter((e) => e.kind === 'slide' || e.kind === 'lockup' || e.kind === 'wheelspin')).toEqual([]);
    expect(mo.filter((m) => m.kind === 'hard-stop')).toEqual([]);
    // strikes only where the loop has bumps, potholes, kerbs or humps; the kerb strike is reported as a kerb
    const featured = new Set(r.track.sections.filter((x) => x.def.features?.some((f) => f.kind !== 'vertical-curve' && f.kind !== 'pave')).map((x) => x.id));
    expect(strikes.every((x) => featured.has(x.section))).toBe(true);
    expect(strikes.some((x) => x.kerb && x.section === 'bump-strip')).toBe(true);
    expect(strikes.length).toBeLessThan(20);
  });
});
