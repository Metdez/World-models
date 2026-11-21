/**
 * Simulation facade (ARCHITECTURE §7.6): owns time, the speed profile, path interpolation, the frame and the event
 * queue; the vehicle model (vehicle-models.ts) owns dynamics and kinematics.
 * Determinism for the shared lap clock: the state after seek(t) is a pure function of (t, vehicle, suspension):
 * static equilibrium at stateAt(t - SEEK_SETTLE_S), then fixed steps to t. setSuspension() re-derives the ride state
 * the same way at the current lap time, so every device shows the same body motion for the same lap time.
 */
import { SEEK_SETTLE_S, type PathState, type SimCatalog, type SimEvent, type Simulation, type SimulationOptions } from '../contracts/sim';
import type { SuspensionDefinition } from '../contracts/suspension';
import { createTelemetryFrame, type TelemetryFrame } from '../contracts/telemetry';
import type { BuiltTrack, TrackDefinition } from '../contracts/track';
import { SIM_DT } from '../contracts/units';
import type { VehicleDefinition } from '../contracts/vehicle';
import type { GroundWorld, WorldDefinition } from '../contracts/world';
import type { DriveFrame } from '../contracts/drive';
import { prepareCarSuspension } from './car/car-model';
import { createDriveControl } from './drive/control';
import { dwrapPi } from './math/det';
import { buildGroundWorld } from './world/ground';
import { gtCoupe } from './content/gt-coupe';
import { provingLoop } from './content/proving-loop';
import { doubleWishbone } from './content/susp-double-wishbone';
import { macpherson } from './content/susp-macpherson';
import { multilink } from './content/susp-multilink';
import { wrap, wrapHalf } from './math/interp';
import { buildSpeedProfile, type SpeedProfile } from './path/speed-profile';
import { buildTrack } from './track/build';
import { VEHICLE_MODELS, type VehicleModel } from './vehicle-models';
import type { VehiclePlant } from './drive/plant';
import { paramsHash } from './replay/format';

/** Built-in content: used when the catalog lacks an id (no content features registered, e.g. kernel tests). */
const BUILT_IN = {
  track: { [provingLoop.id]: provingLoop } as Record<string, TrackDefinition>,
  vehicle: { [gtCoupe.id]: gtCoupe } as Record<string, VehicleDefinition>,
  suspension: { [macpherson.id]: macpherson, [doubleWishbone.id]: doubleWishbone, [multilink.id]: multilink } as Record<string, SuspensionDefinition>,
};

/** Unknown ids fall back to the built-in default content under the requested id, so the kernel can boot without content. */
function resolver(catalog: SimCatalog) {
  const pick = <T extends { readonly id: string }>(found: T | undefined, builtIn: T | undefined, fallback: T, id: string): T =>
    found ?? builtIn ?? { ...fallback, id };
  return {
    track: (id: string) => pick(catalog.track(id), BUILT_IN.track[id], provingLoop, id),
    vehicle: (id: string) => pick(catalog.vehicle(id), BUILT_IN.vehicle[id], gtCoupe, id),
    suspension: (id: string) => pick(catalog.suspension(id), BUILT_IN.suspension[id], doubleWishbone, id),
  };
}

// Pure, deterministic builds, cached for the session (track ~0.2 s, profile ~10 ms).
const tracks = new WeakMap<TrackDefinition, BuiltTrack>();
const profiles = new WeakMap<BuiltTrack, WeakMap<VehicleDefinition, SpeedProfile>>();
function trackFor(def: TrackDefinition): BuiltTrack {
  let t = tracks.get(def);
  if (!t) tracks.set(def, (t = buildTrack(def)));
  return t;
}
const loopWorlds = new WeakMap<BuiltTrack, GroundWorld>();
const zonedWorlds = new WeakMap<WorldDefinition, WeakMap<BuiltTrack, GroundWorld>>();
/** The GroundWorld of (track, world definition), built once per pair (ARCH-M2 §7.3). */
function worldFor(track: BuiltTrack, def: WorldDefinition | undefined): GroundWorld {
  if (!def) {
    let w = loopWorlds.get(track);
    if (!w) loopWorlds.set(track, (w = buildGroundWorld(track, null)));
    return w;
  }
  let byTrack = zonedWorlds.get(def);
  if (!byTrack) zonedWorlds.set(def, (byTrack = new WeakMap()));
  let w = byTrack.get(track);
  if (!w) byTrack.set(track, (w = buildGroundWorld(track, def)));
  return w;
}
function profileFor(track: BuiltTrack, v: VehicleDefinition): SpeedProfile {
  let byVehicle = profiles.get(track);
  if (!byVehicle) profiles.set(track, (byVehicle = new WeakMap()));
  let p = byVehicle.get(v);
  if (!p) byVehicle.set(v, (p = buildSpeedProfile(track, v.limits, v.dragArea, v.mass)));
  return p;
}

const newPath = (): PathState => ({
  lapTime: 0,
  s: 0,
  l: 0,
  v: 0,
  ax: 0,
  ay: 0,
  curvature: 0,
  heading: 0,
  x: 0,
  y: 0,
  z: 0,
  bank: 0,
  grade: 0,
  sectionIndex: 0,
});

function classOf(def: VehicleDefinition | SuspensionDefinition): string {
  return 'class' in def ? def.class : def.vehicleClass;
}

/** frame.drive in auto (ARCH-M2 §7.3 (4)): the path as the car's state; demands and powertrain fields neutral. */
function writeAutoDrive(d: DriveFrame, path: PathState): void {
  d.x = path.x;
  d.y = path.y;
  d.yaw = dwrapPi(path.heading);
  d.u = path.v;
  d.v = 0;
  d.beta = 0;
  d.throttle = 0;
  d.brake = 0;
  d.handbrake = 0;
  d.gear = 0;
  d.engineRpm = 0;
  d.absActive = false;
  d.tractionActive = false;
  d.stabilityActive = false;
  d.zone = 'loop';
  d.lineOffset = 0;
  d.headingError = 0;
  d.approximate = false;
}

const plants = new WeakMap<Simulation, () => VehiclePlant | undefined>();
/** The plant of a simulation's current vehicle (tests and tooling: arbitrary start states); not part of the contract. */
export const plantOf = (sim: Simulation): VehiclePlant | undefined => plants.get(sim)?.();

export function createSimulation(options: SimulationOptions): Simulation {
  const resolve = resolver(options.catalog);
  const track = trackFor(resolve.track(options.trackId));
  const worldDef = options.catalog.world?.(track.def.id);
  const world = worldFor(track, worldDef);
  // replay paramsHash per (vehicle definition, suspension id): JSON of the definitions, computed once
  const hashes = new WeakMap<VehicleDefinition, Map<string, string>>();
  const hashFor = (id: string): string => {
    let byId = hashes.get(vehicle);
    if (!byId) hashes.set(vehicle, (byId = new Map()));
    let h = byId.get(id);
    if (h === undefined) byId.set(id, (h = paramsHash(vehicle, resolve.suspension(id), worldDef ?? null)));
    return h;
  };
  const sectionEvents = track.sections.map((s) => ({ kind: 'section', index: s.index, id: s.id }) as const);
  const events: SimEvent[] = [];
  const path = newPath();
  const pathSample = newPath();

  let vehicle!: VehicleDefinition;
  let suspension!: SuspensionDefinition;
  let profile!: SpeedProfile;
  let model!: VehicleModel;
  let frame!: TelemetryFrame;
  let lapTime = 0;
  let prevLapTime = 0;
  let simTime = 0;
  let prevSimTime = 0;
  let lap = 0;
  let sectionIndex = 0;
  /** After a seek the current step IS the requested time: sample() shows it (alpha 1) until the next step. */
  let held = false;

  /** The M1 step: time, lap/section clock and the rails (stateAt) model step. */
  function autoStep(dt: number): void {
    held = false;
    prevLapTime = lapTime;
    prevSimTime = simTime;
    simTime += dt;
    lapTime += dt;
    const d = profile.lapDuration;
    if (lapTime >= d) {
      lapTime -= d;
      lap++;
      events.push({ kind: 'lap', lap, duration: d });
    }
    profile.stateAt(lapTime, path);
    if (path.sectionIndex !== sectionIndex) {
      sectionIndex = path.sectionIndex;
      events.push(sectionEvents[sectionIndex]!);
    }
    model.step(dt, path, events);
  }

  function step(dt: number): void {
    if (!drive.beforeStep(path)) {
      autoStep(dt);
      return;
    }
    // Plant step: time advances the same way; the lap clock is detached (lap time of the projected s on the loop
    // corridor, else held); no lap events outside auto.
    held = false;
    prevLapTime = lapTime;
    prevSimTime = simTime;
    simTime += dt;
    drive.stepPlant(dt, events);
    const s = model.plant!.loopS;
    if (s === s) {
      lapTime = profile.timeAtS(s);
      const k = track.sectionIndexAt(s);
      if (k !== sectionIndex) {
        sectionIndex = k;
        events.push(sectionEvents[k]!);
      }
    }
  }

  /** Equilibrium at t - SEEK_SETTLE_S, then fixed steps to t. Events of the pre-roll are dropped. */
  function preroll(t: number): void {
    const d = profile.lapDuration;
    const queued = events.length;
    const keepLap = lap;
    lapTime = wrap(t - SEEK_SETTLE_S, d);
    profile.stateAt(lapTime, path);
    sectionIndex = path.sectionIndex;
    model.reset(path);
    const n = Math.round(SEEK_SETTLE_S / SIM_DT);
    for (let k = 0; k < n; k++) autoStep(SIM_DT);
    events.length = queued;
    lap = keepLap;
    lapTime = wrap(t, d);
    prevLapTime = wrap(t - SIM_DT, d);
    held = true;
    // The summed pre-roll steps can land a hair before t: take the section of t itself (no event for it).
    sectionIndex = profile.stateAt(lapTime, path).sectionIndex;
  }

  function prepare(v: VehicleDefinition): void {
    if (v.class !== 'car') return;
    for (const id of v.suspensions) {
      const s = resolve.suspension(id);
      if (s.vehicleClass === 'car') prepareCarSuspension(v, s);
    }
  }

  /** New model, profile and frame (no pre-roll). */
  function load(id: string, suspensionId?: string): void {
    const v = resolve.vehicle(id);
    const s = resolve.suspension(suspensionId ?? v.defaultSuspension);
    if (classOf(s) !== v.class) throw new Error(`Suspension "${s.id}" is for a ${classOf(s)}, vehicle "${v.id}" is a ${v.class}`);
    prepare(v);
    const m = VEHICLE_MODELS[v.class](v, s, track, world);
    vehicle = v;
    suspension = s;
    model = m;
    profile = profileFor(track, v);
    frame = createTelemetryFrame(v.class, m.corners);
  }

  const drive = createDriveControl({
    model: () => model,
    vehicle: () => vehicle,
    track,
    world,
    profile: () => profile,
    simTime: () => simTime,
    seekRails: (t) => preroll(t),
    latchRails(t) {
      // §7.10 C: the lap clock continues from the lap time of the car's projected s; the body goes back to the Auto
      // model there with its ride state (plant.releaseToPath refits the Auto reference plane). The next step is an
      // Auto step from this path, interpolating from the last plant step (no blend across a cut: there is none).
      lapTime = wrap(t, profile.lapDuration);
      profile.stateAt(lapTime, path);
      if (path.sectionIndex !== sectionIndex) {
        sectionIndex = path.sectionIndex;
        events.push(sectionEvents[sectionIndex]!);
      }
      model.plant!.releaseToPath(path);
    },
    lapTime: () => lapTime,
    suspensionId: () => suspension.id,
    setSuspension: (id) => sim.setSuspension(id),
    paramsHash: hashFor,
  });

  const sim: Simulation = {
    track,
    drive,
    world,
    get vehicle() {
      return vehicle;
    },
    get suspension() {
      return suspension;
    },
    get lapDuration() {
      return profile.lapDuration;
    },
    get lapTime() {
      return lapTime;
    },
    get simTime() {
      return simTime;
    },

    step,

    sample(alphaIn, amplification = 1) {
      const alpha = held ? 1 : alphaIn;
      if (drive.mode !== 'auto') {
        const f = frame;
        f.vehicleId = vehicle.id;
        f.suspensionId = suspension.id;
        f.simTime = prevSimTime + (simTime - prevSimTime) * alpha;
        f.lapTime = lapTime;
        f.lap = lap;
        const s = model.plant!.loopS;
        if (s === s) f.s = s;
        f.sectionIndex = sectionIndex;
        f.sectionId = track.sections[sectionIndex]!.id;
        model.plant!.sample(alpha, amplification, f);
        drive.writeFrame(f.drive);
        return f;
      }
      const d = profile.lapDuration;
      const lt = held ? lapTime : wrap(prevLapTime + wrapHalf(lapTime - prevLapTime, d) * alpha, d);
      profile.stateAt(lt, pathSample);
      const f = frame;
      f.vehicleId = vehicle.id;
      f.suspensionId = suspension.id;
      f.simTime = prevSimTime + (simTime - prevSimTime) * alpha;
      f.lapTime = lt;
      // An interpolated time just before the wrap still belongs to the previous lap.
      f.lap = lt > lapTime + SIM_DT ? lap - 1 : lap;
      f.s = pathSample.s;
      f.sectionIndex = pathSample.sectionIndex;
      f.sectionId = track.sections[pathSample.sectionIndex]!.id;
      f.speed = pathSample.v;
      f.ax = pathSample.ax;
      f.ay = pathSample.ay;
      f.yawRate = pathSample.v * pathSample.curvature;
      model.sample(alpha, amplification, pathSample, f);
      writeAutoDrive(f.drive, pathSample);
      drive.writeFrame(f.drive);
      return f;
    },

    setSuspension(id) {
      const s = resolve.suspension(id);
      if (classOf(s) !== vehicle.class) throw new Error(`Suspension "${s.id}" is for a ${classOf(s)}, not a ${vehicle.class}`);
      if (drive.mode !== 'auto') {
        // Driving: only tables and extras change; pose, velocities and the ride state continue (no pre-roll).
        model.setSuspension(s, true);
        suspension = s;
        drive.noteSuspension(s.id);
        return;
      }
      model.setSuspension(s);
      suspension = s;
      // No time passes: re-derive the ride state for the new geometry at the same lap time (the model's previous
      // step is then t - SIM_DT, so interpolation and the path carry on exactly where they were).
      const keep = { simTime, prevSimTime, prevLapTime, held };
      preroll(lapTime);
      ({ simTime, prevSimTime, prevLapTime, held } = keep);
    },

    setVehicle(id, suspensionId) {
      drive.releaseNow();
      const fraction = lapTime / profile.lapDuration;
      load(id, suspensionId);
      preroll(fraction * profile.lapDuration);
    },

    seek(t) {
      drive.releaseNow();
      drive.attach();
      preroll(t);
    },

    stateAt: (t, out) => profile.stateAt(t, out),
    lapTimeAt: (s) => profile.timeAtS(s),
    kinematics: () => model.kinematics,
    restPose: (i, out) => model.restPose(i, pathSample, out),

    drainEvents(handler) {
      for (let i = 0; i < events.length; i++) handler(events[i]!);
      events.length = 0;
    },
  };

  plants.set(sim, () => model.plant);
  load(options.vehicleId, options.suspensionId);
  preroll(options.lapTime ?? 0);
  simTime = prevSimTime = 0;
  sim.sample(1);
  return sim;
}
