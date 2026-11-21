/** Shared helpers for the 08-02 plant tests (test-only). */
import { DEFAULT_AIDS, type DriveAids, type DriveEvent, type DriveIntent } from '../../src/contracts/drive';
import type { SimCatalog, SimEvent, Simulation } from '../../src/contracts/sim';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import type { TrackDefinition } from '../../src/contracts/track';
import { SIM_DT } from '../../src/contracts/units';
import { createCarModel } from '../../src/sim-core/car/car-model';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createDriveCommand, type DriveCommand } from '../../src/sim-core/drive/types';
import { createSimulation } from '../../src/sim-core/index';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { testCatalog } from './08-02-test-tracks';

export const SUSPENSIONS = { macpherson, 'double-wishbone': doubleWishbone, multilink } as const;
export type SuspensionId = keyof typeof SUSPENSIONS;
export const SUSPENSION_IDS = Object.keys(SUSPENSIONS) as SuspensionId[];
export const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };

export const intent = (o: Partial<DriveIntent> = {}): DriveIntent => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, digital: false, source: 'gamepad', ...o });

export function makeSim(trackId = 'proving-loop', suspensionId: SuspensionId = 'double-wishbone', lapTime = 0): Simulation {
  return createSimulation({ catalog: testCatalog, trackId, vehicleId: 'gt-coupe', suspensionId, lapTime });
}

/** Manual at rest on the driving line nearest to the car's Auto position (request + reset, one step). */
export function manualAtRest(sim: Simulation): void {
  sim.drive!.request('manual');
  sim.drive!.reset();
  sim.step(SIM_DT);
}

export const steps = (seconds: number): number => Math.round(seconds / SIM_DT);

/** A bare plant on a track (no driver: commands go straight in). */
export function plantRig(track: TrackDefinition = provingLoop, suspension: SuspensionId = 'double-wishbone') {
  const built = buildTrack(track);
  const world = buildGroundWorld(built, null);
  const model = createCarModel(gtCoupe, SUSPENSIONS[suspension], built, world);
  const plant = model.plant!;
  const frame: TelemetryFrame = createTelemetryFrame('car', model.corners);
  const cmd: DriveCommand = createDriveCommand();
  const simEvents: SimEvent[] = [];
  const driveEvents: DriveEvent[] = [];
  let aids: DriveAids = DEFAULT_AIDS;
  return {
    track: built,
    world,
    model,
    plant,
    frame,
    cmd,
    driveEvents,
    setAids: (a: DriveAids) => void (aids = a),
    step(n = 1): TelemetryFrame {
      for (let k = 0; k < n; k++) {
        plant.step(SIM_DT, cmd, aids, simEvents, driveEvents);
        simEvents.length = 0;
      }
      plant.sample(1, 1, frame);
      return frame;
    },
  };
}

export const finiteFrame = (f: TelemetryFrame): boolean =>
  [f.speed, f.roll, f.pitch, f.heave, f.ax, f.ay, f.yawRate, f.bodyPosition.x, f.bodyPosition.y, f.bodyPosition.z, f.drive.x, f.drive.y, f.drive.u, f.drive.v, f.drive.yaw].every(Number.isFinite) &&
  f.corners.every((c) => [c.travel, c.load, c.omega, c.fx, c.fy, c.slipAngle, c.slipRatio, c.wheelPosition.x, c.wheelPosition.z].every(Number.isFinite));
