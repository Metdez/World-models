/**
 * DriveControl (ARCHITECTURE-M2 §7.10 A-E, §7.2 step 0): who drives the car. Mode requests and resets apply at the
 * NEXT fixed step (beforeStep) and are reported as DriveEvents; intents are latched every CONTROL_TICKS steps,
 * quantised, and fed to the HumanDriver, whose command drives the plant.
 * Returning (10-01): 'auto' from manual hands the SAME plant to the PathDriver on the loop's driving line (no cut);
 * when it has converged the simulation latches onto the rails at profile.timeAtS(s) (`converged` + mode, no cut). A
 * return that has not converged within RETURN_TIMEOUT s (RETURN_TIMEOUT_OFF when it started off the loop corridor),
 * and an `immediate` request, release at once onto the rails at the projected lap time (a cut). A 'manual' request
 * while returning takes the wheel back (bumpless, no cut). Replay play/recording arrive with 11-03.
 */
import { CONTROL_TICKS, DEFAULT_AIDS, neutralIntent, type DecodedReplay, type DriveAids, type DriveControl, type DriveEvent, type DriveFrame, type DriveIntent, type DriveMode } from '../../contracts/drive';
import type { PathState, SimEvent } from '../../contracts/sim';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { XYZ } from '../../contracts/units';
import type { CarDefinition, VehicleDefinition } from '../../contracts/vehicle';
import type { Frenet, GroundWorld } from '../../contracts/world';
import type { SpeedProfile } from '../path/speed-profile';
import type { VehicleModel } from '../vehicle-models';
import { modeEvent, resetEvent } from './events';
import { createHumanDriver } from './human-driver';
import { createPathDriver, type PathDriver } from './path-driver';
import { loopLine } from './reference';
import { createDriveCommand, createQuantIntent, quantiseIntent } from './types';

export interface DriveHost extends DriveControl {
  /** Called by simulation.step BEFORE time advances; returns true when the plant drives this step (mode != auto). */
  beforeStep(path: PathState): boolean;
  /** The plant step (called by simulation.step when beforeStep returned true). */
  stepPlant(dt: number, simEvents: SimEvent[]): void;
  /** Release now (seek / setVehicle / immediate): mode auto, cut event. */
  releaseNow(): void;
  readonly detached: boolean;
  /** The loop autopilot while returning (state, errors; read-only diagnostics), else null. */
  readonly autopilot: PathDriver | null;
  /** A seek re-attached the lap clock to the rails (clears `detached`). */
  attach(): void;
  /** Control-owned DriveFrame fields (mode, available, source, aids, idle, detached, steerDemand, faults in auto). */
  writeFrame(d: DriveFrame): void;
}

export interface DriveControlDeps {
  readonly model: () => VehicleModel;
  readonly vehicle: () => VehicleDefinition;
  readonly track: BuiltTrack;
  readonly world: GroundWorld;
  readonly profile: () => SpeedProfile;
  readonly simTime: () => number;
  /** Put the car back on the rails at this lap time (an M1 pre-roll seek: a cut). */
  readonly seekRails: (lapTime: number) => void;
  /** Latch (§7.10 C): lap clock = lapTime, `plant.releaseToPath(stateAt(lapTime))`; the next step is an Auto step. */
  readonly latchRails: (lapTime: number) => void;
  /** Current lap time (the detached clock while driving). */
  readonly lapTime: () => number;
}

/** The kernel's ride inputs stay as they are at the engage (the car model's input already holds them). */
const KEEP_INPUTS = { ax: NaN, ay: NaN } as const;
/** Returning gives up (immediate release, a cut) after this long on the loop corridor / when it started off it, s. */
export const RETURN_TIMEOUT = 20;
export const RETURN_TIMEOUT_OFF = 60;
/** The loop autopilot's speed margin while it recovers (§7.9; it fades to the exact profile speed when tracking). */
const LOOP_SPEED_SCALE = 0.97;

export function createDriveControl(deps: DriveControlDeps): DriveHost {
  let mode: DriveMode = 'auto';
  let pending: 'auto' | 'manual' | null = null;
  let pendingImmediate = false;
  let pendingReset = false;
  let resetSpawn: string | null = null;
  let detached = false;
  let aids: DriveAids = DEFAULT_AIDS;
  const intent: DriveIntent = neutralIntent();
  const q = createQuantIntent();
  const cmd = createDriveCommand();
  const tick = new Int32Array(1);
  const events: DriveEvent[] = [];
  const driver = createHumanDriver(deps.vehicle() as CarDefinition);
  driver.setAids(aids);
  // The loop autopilot, built per (vehicle, profile) at the first return (not per step).
  let autopilot: PathDriver | null = null;
  let autopilotKey: SpeedProfile | null = null;
  const returning = new Float64Array(2); // [time returning, timeout]
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  const xyz: XYZ = { x: 0, y: 0, z: 0 };

  const plant = () => deps.model().plant;
  function setMode(next: DriveMode, cut: boolean): void {
    if (next === mode) return;
    events.push(modeEvent(deps.simTime(), next, mode, cut));
    mode = next;
  }

  function place(spawn: string | null): void {
    const p = plant()!;
    const station = spawn ? deps.world.station(spawn) : undefined;
    if (station) p.place(station.spawn.x, station.spawn.y, station.spawn.heading);
    else {
      // Nearest driving-line point, heading along the line.
      deps.world.project(p.view.x, p.view.y, p.loopS, fr);
      const l = deps.track.lineOffset(fr.s);
      deps.track.toWorld(fr.s, l, xyz);
      deps.track.sample(fr.s, ts);
      p.place(xyz.x, xyz.y, ts.heading);
    }
    driver.engage(p.view, p.command);
    tick[0] = 0;
    events.push(resetEvent(deps.simTime(), station ? spawn : null));
  }

  /** §7.10 D: release at once onto the rails at the lap time of the projected s (else the clock's), a cut. */
  function release(): void {
    const p = plant();
    const s = p ? p.loopS : NaN;
    const lap = s === s ? deps.profile().timeAtS(s) : deps.lapTime();
    setMode('auto', true);
    deps.seekRails(lap);
  }

  function loopAutopilot(): PathDriver {
    const profile = deps.profile();
    if (autopilot === null || autopilotKey !== profile) {
      const line = loopLine(deps.track, profile, deps.world);
      autopilot = createPathDriver(deps.vehicle() as CarDefinition, line, { speedScale: LOOP_SPEED_SCALE, exactSpeed: false });
      autopilotKey = profile;
    }
    return autopilot;
  }

  const host: DriveHost = {
    get available() {
      return plant() !== undefined;
    },
    get mode() {
      return mode;
    },
    get detached() {
      return detached;
    },
    get autopilot() {
      return mode === 'returning' ? autopilot : null;
    },
    setIntent(next) {
      intent.steer = next.steer;
      intent.throttle = next.throttle;
      intent.brake = next.brake;
      intent.handbrake = next.handbrake;
      intent.digital = next.digital;
      intent.source = next.source;
    },
    request(next, immediate = false) {
      pending = next;
      pendingImmediate = immediate;
    },
    setAids(next) {
      aids = next;
      driver.setAids(next);
    },
    reset(spawn) {
      pendingReset = true;
      resetSpawn = spawn ?? null;
    },
    play(replay: DecodedReplay) {
      // shortcut: replays arrive with 11-03.
      void replay;
      return false;
    },
    recording: () => null,
    drainEvents(handler) {
      for (let i = 0; i < events.length; i++) handler(events[i]!);
      events.length = 0;
    },

    beforeStep(path) {
      if (pending !== null) {
        const want = pending;
        const immediate = pendingImmediate;
        pending = null;
        pendingImmediate = false;
        const p = plant();
        if (want === 'manual' && mode === 'auto' && p) {
          p.engageFromPath(path, KEEP_INPUTS);
          driver.engage(p.view, p.command);
          tick[0] = 0;
          detached = true;
          setMode('manual', false);
        } else if (want === 'manual' && mode === 'returning' && p) {
          // take the wheel back from the autopilot: bumpless from its command, no cut
          driver.engage(p.view, p.command);
          tick[0] = 0;
          setMode('manual', false);
        } else if (want === 'auto' && mode === 'manual' && !immediate && p) {
          const ap = loopAutopilot();
          ap.engage(p.view, p.command);
          returning[0] = 0;
          returning[1] = p.loopS === p.loopS ? RETURN_TIMEOUT : RETURN_TIMEOUT_OFF;
          setMode('returning', false);
        } else if (want === 'auto' && mode !== 'auto' && (immediate || !p)) release();
      }
      if (pendingReset) {
        pendingReset = false;
        if (mode === 'manual' && plant()) place(resetSpawn);
      }
      if (mode === 'returning') {
        const p = plant()!;
        const s = p.loopS;
        if (autopilot!.converged && s === s) {
          // §7.10 C: latch onto the rails at the lap time of the projected s; the next step is an Auto step
          deps.latchRails(deps.profile().timeAtS(s));
          events.push({ kind: 'converged', simTime: deps.simTime() });
          setMode('auto', false);
        } else if (returning[0]! >= returning[1]!) release();
      }
      return mode !== 'auto';
    },

    stepPlant(dt, simEvents) {
      const p = plant()!;
      (p.view as { simTime: number }).simTime = deps.simTime();
      if (mode === 'returning') {
        autopilot!.step(dt, p.view, cmd);
        returning[0] = returning[0]! + dt;
      } else {
        if (tick[0]! % CONTROL_TICKS === 0) driver.latch(quantiseIntent(intent, q));
        driver.step(dt, p.view, cmd);
      }
      p.step(dt, cmd, aids, simEvents, events);
      tick[0] = tick[0]! + 1;
    },

    releaseNow() {
      pending = null;
      pendingReset = false;
      setMode('auto', true);
    },
    attach() {
      detached = false;
    },

    writeFrame(d) {
      const p = plant();
      d.mode = mode;
      d.available = p !== undefined;
      d.aids = aids;
      d.detached = detached;
      if (mode === 'auto') {
        d.source = null;
        d.idle = 0;
        d.steerDemand = 0;
        d.faults = p ? p.faults : 0;
      } else if (mode === 'returning') {
        d.source = 'autopilot';
        d.idle = 0;
        d.steerDemand = p ? p.command.steer / p.view.maxSteer : 0;
      } else {
        d.source = driver.source;
        d.idle = driver.idle;
        d.steerDemand = driver.steerDemand;
      }
    },
  };
  return host;
}
