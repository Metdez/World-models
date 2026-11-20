import type { AppContext } from '../../src/contracts/app';
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
