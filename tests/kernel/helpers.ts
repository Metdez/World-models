import type { AppContext } from '../../src/contracts/app';
import { neutralIntent, type DriveControl, type DriveEvent, type DriveIntent, type DriveMode } from '../../src/contracts/drive';
import type { PathState, SimEvent, Simulation, SimulationOptions } from '../../src/contracts/sim';
import { createTelemetryFrame } from '../../src/contracts/telemetry';
import { createSimulation } from '../../src/sim-core/index';

export interface FakeSim extends Simulation {
  steps: number;
  seeks: number[];
  calls: string[];
  events: SimEvent[];
}

/** Counting fake around the stub (real track/frame), lap duration 100 s, with call log. */
export function fakeSim(options: SimulationOptions, lapDuration = 100): FakeSim {
  const stub = createSimulation(options);
  let lapTime = options.lapTime ?? 0;
  let vehicle = stub.vehicle;
  let suspension = stub.suspension;
  const frame = createTelemetryFrame('car', [{ id: 'fl', axle: 'front', side: 1 }]);
  const sim: FakeSim = {
    steps: 0,
    seeks: [],
    calls: [],
    events: [],
    track: stub.track,
    get vehicle() {
      return vehicle;
    },
    get suspension() {
      return suspension;
    },
    lapDuration,
    get lapTime() {
      return lapTime;
    },
    get simTime() {
      return sim.steps / 240;
    },
    step(dt) {
      sim.steps++;
      lapTime = (lapTime + dt) % lapDuration;
    },
    sample(_alpha, amplification = 1) {
      frame.lapTime = lapTime;
      frame.amplification = amplification;
      return frame;
    },
    setSuspension(id) {
      sim.calls.push(`setSuspension:${id}`);
      suspension = { ...suspension, id };
    },
    setVehicle(id, suspensionId) {
      sim.calls.push(`setVehicle:${id}:${suspensionId ?? '-'}`);
      vehicle = { ...vehicle, id };
      suspension = { ...suspension, id: suspensionId ?? 'default-of-' + id };
    },
    seek(t) {
      sim.seeks.push(t);
      lapTime = ((t % lapDuration) + lapDuration) % lapDuration;
    },
    stateAt: (t: number, out: PathState) => stub.stateAt(t, out),
    lapTimeAt: (s) => stub.lapTimeAt(s),
    kinematics: () => stub.kinematics(),
    restPose: (i, out) => stub.restPose(i, out),
    drainEvents(handler) {
      for (const e of sim.events) handler(e);
      sim.events.length = 0;
    },
  };
  return sim;
}

export const fakeDom = (): AppContext['dom'] => ({ stage: {} as HTMLElement, overlay: {} as HTMLElement });

export interface FakeDrive extends DriveControl {
  calls: string[];
  /** Events queued for the next drainEvents (tests may push their own). */
  events: DriveEvent[];
  intent: DriveIntent;
  available: boolean;
  mode: DriveMode;
}

/**
 * Adds a recording fake `drive` to a FakeSim: requests apply at the next step (as the real control does), a toy
 * plant integrates x / u / yaw from the latest intent outside auto, seek releases with a cut, sample fills frame.drive.
 */
export function withFakeDrive(sim: FakeSim, available = true): FakeSim & { drive: FakeDrive } {
  let pending: { mode: 'auto' | 'manual'; immediate: boolean } | null = null;
  let x = 0;
  let u = 0;
  let yaw = 0;
  const setMode = (mode: DriveMode, cut: boolean) => {
    if (mode === drive.mode) return;
    drive.events.push({ kind: 'mode', mode, previous: drive.mode, cut, simTime: sim.simTime });
    drive.mode = mode;
  };
  const drive: FakeDrive = {
    calls: [],
    events: [],
    intent: neutralIntent(),
    available,
    mode: 'auto',
    setIntent(intent) {
      drive.intent = { ...intent };
    },
    request(mode, immediate = false) {
      drive.calls.push(`request:${mode}${immediate ? ':immediate' : ''}`);
      pending = { mode, immediate };
    },
    setAids(aids) {
      drive.calls.push(`setAids:${Object.entries(aids).filter(([, on]) => on).map(([k]) => k).join(',')}`);
    },
    reset(spawn) {
      drive.calls.push(`reset:${spawn ?? '-'}`);
    },
    play() {
      drive.calls.push('play');
      return false;
    },
    recording: () => null,
    drainEvents(handler) {
      for (const e of drive.events.splice(0)) handler(e);
    },
  };
  const { step, sample, seek } = sim;
  sim.step = (dt) => {
    if (pending) {
      setMode(pending.mode === 'manual' ? 'manual' : pending.immediate ? 'auto' : 'returning', pending.immediate);
      pending = null;
    }
    if (drive.mode === 'auto') return step(dt);
    sim.steps++;
    u += (drive.intent.throttle - drive.intent.brake) * 5 * dt;
    yaw += drive.intent.steer * 0.1 * dt;
    x += u * dt;
  };
  sim.sample = (alpha, amplification) => {
    const f = sample(alpha, amplification);
    Object.assign(f.drive, { mode: drive.mode, available: drive.available, x, u, yaw, steerDemand: drive.intent.steer });
    for (const c of f.corners) c.omega = u / 0.33;
    return f;
  };
  sim.seek = (t) => {
    if (drive.mode !== 'auto') setMode('auto', true);
    seek(t);
  };
  return Object.assign(sim, { drive });
}
