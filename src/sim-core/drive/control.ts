/**
 * DriveControl (ARCHITECTURE-M2 §7.10 A-E, §7.2 step 0): who drives the car. Mode requests and resets apply at the
 * NEXT fixed step (beforeStep) and are reported as DriveEvents; intents are latched every CONTROL_TICKS steps,
 * quantised, and fed to the HumanDriver, whose command drives the plant.
 * Returning (10-01): 'auto' from manual hands the SAME plant to the PathDriver on the loop's driving line (no cut);
 * when it has converged the simulation latches onto the rails at profile.timeAtS(s) (`converged` + mode, no cut). A
 * return that has not converged within RETURN_TIMEOUT s (RETURN_TIMEOUT_OFF when it started off the loop corridor),
 * and an `immediate` request, release at once onto the rails at the projected lap time (a cut). A 'manual' request
 * while returning takes the wheel back (bumpless, no cut).
 * Replays (11-03, §7.10 F/G): every manual run is recorded (replay/recorder.ts: the latched integers the HumanDriver
 * consumed, suspension/aids/reset events at their ticks, a start-state snapshot = plant snapshot + HumanDriver state
 * every second). `play()` restores a replay's start state and feeds its integers on the same control ticks, so the
 * same build re-simulates bit-identically; keyframe CRCs every REPLAY_LIMITS.keyframeTicks detect a divergence (resync
 * from the recorder's snapshot when the replay came from this recorder, else the status says it may differ). A
 * 'manual' request, a user aids change or suspension swap during a replay branches into manual from the current state
 * (the recording continues); the last tick hands over to manual with no cut.
 */
import { CONTROL_TICKS, DEFAULT_AIDS, neutralIntent, REPLAY_LIMITS, type DecodedReplay, type DriveAids, type DriveControl, type DriveEvent, type DriveFrame, type DriveIntent, type DriveMode, type ReplayEventRecord } from '../../contracts/drive';
import type { PathState, SimEvent } from '../../contracts/sim';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { XYZ } from '../../contracts/units';
import type { CarDefinition, VehicleDefinition } from '../../contracts/vehicle';
import type { Frenet, GroundWorld } from '../../contracts/world';
import type { SpeedProfile } from '../path/speed-profile';
import type { VehicleModel } from '../vehicle-models';
import { aidsValue, parseAids, replayFit, SIM_VERSION, stateChecksum, type ReplayFit, type ReplayTarget } from '../replay/format';
import { createRecorder, type Recorder } from '../replay/recorder';
import { modeEvent, resetEvent } from './events';
import { createHumanDriver, HUMAN_DRIVER_STATE_LENGTH } from './human-driver';
import { PLANT_SNAPSHOT_LENGTH } from './plant';
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
  /** The newest >= `seconds` of the current run (whole snapshot seconds; the run so far if shorter), null in auto. */
  window(seconds: number): DecodedReplay | null;
  /** The current replay, or the last one until the next play / new run; null if none. */
  readonly replay: ReplayStatus | null;
  /** CRC (replay/format.ts stateChecksum) of the full current start state: plant snapshot + HumanDriver state. */
  stateChecksum(): number;
  /** simulation.setSuspension while driving: recorded; from the user during a replay it branches into manual. */
  noteSuspension(id: string): void;
  /** Ticks the current run holds (0 in auto): cheap, for UI gating. */
  readonly recordedTicks: number;
  /** Whether `play(replay)` would accept it here, and how it would be labelled (the feature's messages). */
  check(replay: DecodedReplay): ReplayFit;
}

/** What a replay is doing (the replay feature reads it every frame; plain mutable fields, no allocation per step). */
export interface ReplayStatus {
  readonly replay: DecodedReplay;
  /** Ticks played so far and in total (240 Hz). */
  tick: number;
  readonly ticks: number;
  /** Recorded with this build's parameters (paramsHash) and SIM_VERSION. */
  readonly sameModel: boolean;
  readonly sameVersion: boolean;
  /** A window of this simulation's own recording (moment replay): resync snapshots available. */
  readonly moment: boolean;
  state: 'playing' | 'ended' | 'branched';
  /** Keyframe CRC mismatches, resyncs from a recorder snapshot, tick of the first mismatch (-1 none). */
  mismatches: number;
  resyncs: number;
  firstMismatch: number;
  /** stateChecksum() when the replay reached its last tick (0 until then). */
  endChecksum: number;
}

/** Start state length: plant snapshot + HumanDriver state (DecodedReplay.start). */
export const REPLAY_START_LENGTH = PLANT_SNAPSHOT_LENGTH + HUMAN_DRIVER_STATE_LENGTH;

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
  /** Replays: the installed suspension, switching it (simulation.setSuspension), ids and paramsHash per suspension. */
  readonly suspensionId: () => string;
  readonly setSuspension: (id: string) => void;
  readonly paramsHash: (suspensionId: string) => string;
}

/** The kernel's ride inputs stay as they are at the engage (the car model's input already holds them). */
const KEEP_INPUTS = { ax: NaN, ay: NaN } as const;
/** Returning gives up (immediate release, a cut) after this long on the loop corridor / when it started off it, s
 * (40 s: the measured p90 of a rejoin from any start is 38 s; orchestrator decision for 10-04). */
export const RETURN_TIMEOUT = 40;
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

  // ---- recording and replay state
  let recorder: Recorder | null = null;
  let recording = false; // the recorder follows the plant (manual / replay); frozen while returning
  let status: ReplayStatus | null = null;
  let pendingPlay: DecodedReplay | null = null;
  let resync: Float64Array | null = null; // moment replays: the recorder's keyframe snapshots, REPLAY_START_LENGTH each
  let resyncFrom = -1;
  let applying = false; // replay events being applied (not user changes)
  const scratch = new Float64Array(REPLAY_START_LENGTH);
  const steps = new Float64Array(2); // [step counter, step of the scratch snapshot]
  steps[1] = -1;

  const plant = () => deps.model().plant;
  function setMode(next: DriveMode, cut: boolean): void {
    if (next === mode) return;
    events.push(modeEvent(deps.simTime(), next, mode, cut));
    mode = next;
  }

  function snapshotInto(out: Float64Array, offset = 0): Float64Array {
    plant()!.snapshot(scratch);
    const st = driver.state;
    for (let k = 0; k < HUMAN_DRIVER_STATE_LENGTH; k++) scratch[PLANT_SNAPSHOT_LENGTH + k] = st[k]!;
    if (out !== scratch) for (let k = 0; k < REPLAY_START_LENGTH; k++) out[offset + k] = scratch[k]!;
    return out;
  }
  /** The current state in `scratch`, taken at most once per step (recorder snapshot ticks, keyframe checks). */
  const currentSnapshot = (): Float64Array => {
    if (steps[1] !== steps[0]) {
      snapshotInto(scratch);
      steps[1] = steps[0]!;
    }
    return scratch;
  };
  function restoreFrom(src: Float64Array, offset = 0): void {
    // plant.restore reads indices [0, PLANT_SNAPSHOT_LENGTH) only
    if (offset === 0) plant()!.restore(src);
    else {
      for (let k = 0; k < PLANT_SNAPSHOT_LENGTH; k++) scratch[k] = src[offset + k]!;
      plant()!.restore(scratch);
    }
    const st = driver.state;
    for (let k = 0; k < HUMAN_DRIVER_STATE_LENGTH; k++) st[k] = src[offset + PLANT_SNAPSHOT_LENGTH + k]!;
    steps[1] = -1;
  }

  const target: ReplayTarget = {
    get trackId() {
      return deps.track.def.id;
    },
    worldId: deps.world.def?.id ?? null,
    get vehicleId() {
      return deps.vehicle().id;
    },
    get suspensions() {
      return deps.vehicle().suspensions;
    },
    paramsHash: deps.paramsHash,
    startLength: REPLAY_START_LENGTH,
  };

  function startRecording(): void {
    recorder ??= createRecorder({ snapshotLength: REPLAY_START_LENGTH, paramsHash: deps.paramsHash });
    const sid = deps.suspensionId();
    recorder.start(snapshotInto(scratch), {
      format: 1,
      simVersion: SIM_VERSION,
      paramsHash: deps.paramsHash(sid),
      trackId: deps.track.def.id,
      worldId: target.worldId,
      vehicleId: deps.vehicle().id,
      suspensionId: sid,
    });
    recorder.event('aids', aidsValue(aids));
    recording = true;
  }
  const record = (kind: ReplayEventRecord['kind'], value: string) => {
    if (recording) recorder!.event(kind, value);
  };

  /** A user change during a replay: the replay ends here and the visitor drives on from the current state. */
  function branch(): void {
    if (mode !== 'replay') return;
    if (status && status.state === 'playing') status.state = 'branched';
    setMode('manual', false);
  }

  function applyAids(next: DriveAids): void {
    aids = next;
    driver.setAids(next);
    record('aids', aidsValue(next));
  }

  /** The deferred start of a replay (beforeStep): state, recorder, mode. */
  function beginReplay(replay: DecodedReplay, path: PathState): void {
    const p = plant()!;
    if (mode === 'auto') {
      // seed the plant's records from the Auto state first; the restore then sets every state variable
      p.engageFromPath(path, KEEP_INPUTS);
      detached = true;
    }
    restoreFrom(replay.start);
    tick[0] = 0;
    const origin = recorder ? recorder.origin(replay) : -1;
    if (origin >= 0) recorder!.rewind(origin);
    else startRecording();
    recording = true;
    if (mode === 'replay') events.push(modeEvent(deps.simTime(), 'replay', 'replay', true));
    else setMode('replay', true);
    applyReplayEvents();
  }

  function applyReplayEvents(): void {
    const st = status!;
    const evs = st.replay.events;
    applying = true;
    while (st.tick < st.ticks && eventIndex < evs.length && evs[eventIndex]!.tick <= st.tick) {
      const e = evs[eventIndex++]!;
      if (e.kind === 'aids') applyAids(parseAids(e.value));
      else if (e.kind === 'suspension') {
        if (e.value !== deps.suspensionId()) deps.setSuspension(e.value);
      } else place(e.value === '' ? null : e.value);
    }
    applying = false;
  }
  let eventIndex = 0;

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
    // the latch phase continues (a reset is an event inside a recording, not a new run)
    events.push(resetEvent(deps.simTime(), station ? spawn : null));
    record('reset', station ? spawn! : '');
  }

  /** §7.10 D: release at once onto the rails at the lap time of the projected s (else the clock's), a cut. */
  function release(): void {
    const p = plant();
    const s = p ? p.loopS : NaN;
    const lap = s === s ? deps.profile().timeAtS(s) : deps.lapTime();
    endRun();
    setMode('auto', true);
    deps.seekRails(lap);
  }
  function endRun(): void {
    recording = false;
    pendingPlay = null;
    if (status && status.state === 'playing') status.state = 'branched';
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
      if (next.abs === aids.abs && next.traction === aids.traction && next.stability === aids.stability && next.steering === aids.steering) return;
      if (!applying) branch();
      applyAids(next);
    },
    noteSuspension(id) {
      if (!applying) branch();
      record('suspension', id);
    },
    reset(spawn) {
      pendingReset = true;
      resetSpawn = spawn ?? null;
    },
    play(replay: DecodedReplay) {
      const p = plant();
      if (!p) return false;
      const fit: ReplayFit = replayFit(replay, target);
      if (!fit.ok || replay.intents.length < Math.ceil(replay.header.ticks / CONTROL_TICKS) * 5) return false;
      // moment replay: keep the recorder's keyframe snapshots of this window for resyncs
      const origin = recorder ? recorder.origin(replay) : -1;
      resync = null;
      resyncFrom = origin;
      if (origin >= 0) {
        const n = replay.keyframes.length;
        resync = new Float64Array(Math.max(1, n) * REPLAY_START_LENGTH);
        for (let k = 0; k < n; k++) recorder!.snapshotAt(origin + (k + 1) * REPLAY_LIMITS.keyframeTicks, resync, k * REPLAY_START_LENGTH);
      }
      if (status && status.state === 'playing') status.state = 'branched';
      status = {
        replay,
        tick: 0,
        ticks: replay.header.ticks,
        sameModel: fit.sameModel,
        sameVersion: fit.sameVersion,
        moment: origin >= 0,
        state: 'playing',
        mismatches: 0,
        resyncs: 0,
        firstMismatch: -1,
        endChecksum: 0,
      };
      eventIndex = 0;
      // the header's suspension now (the kernel syncs the store after play); the start state follows at the next step
      applying = true;
      if (deps.suspensionId() !== replay.header.suspensionId) deps.setSuspension(replay.header.suspensionId);
      applying = false;
      pending = null;
      pendingReset = false;
      pendingPlay = replay;
      return true;
    },
    recording() {
      return mode === 'auto' || !recorder || recorder.ticks === 0 ? null : recorder.whole();
    },
    window(seconds) {
      return mode === 'auto' || !recorder || recorder.ticks === 0 ? null : recorder.window(seconds);
    },
    get replay() {
      return status;
    },
    get recordedTicks() {
      return mode === 'auto' || !recorder ? 0 : recorder.ticks - recorder.base;
    },
    check(replay) {
      return replayFit(replay, target);
    },
    stateChecksum() {
      return plant() ? stateChecksum(currentSnapshot()) : 0;
    },
    drainEvents(handler) {
      for (let i = 0; i < events.length; i++) handler(events[i]!);
      events.length = 0;
    },

    beforeStep(path) {
      if (pendingPlay !== null) {
        const r = pendingPlay;
        pendingPlay = null;
        if (plant()) beginReplay(r, path);
      } else if (mode === 'replay') applyReplayEvents();
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
          startRecording();
          setMode('manual', false);
        } else if (want === 'manual' && mode === 'returning' && p) {
          // take the wheel back from the autopilot: bumpless from its command, no cut
          driver.engage(p.view, p.command);
          tick[0] = 0;
          startRecording();
          setMode('manual', false);
        } else if (want === 'manual' && mode === 'replay') {
          branch();
        } else if (want === 'auto' && (mode === 'manual' || mode === 'replay') && !immediate && p) {
          if (status && status.state === 'playing') status.state = 'branched';
          recording = false;
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
          endRun();
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
      const st = mode === 'replay' ? status! : null;
      if (mode === 'returning') {
        autopilot!.step(dt, p.view, cmd);
        returning[0] = returning[0]! + dt;
      } else {
        if (tick[0]! % CONTROL_TICKS === 0) {
          if (st) {
            const a = st.replay.intents;
            const j = (tick[0]! / CONTROL_TICKS) * 5;
            q.steer = a[j]!;
            q.throttle = a[j + 1]!;
            q.brake = a[j + 2]!;
            q.handbrake = a[j + 3]!;
            q.flags = a[j + 4]!;
          } else quantiseIntent(intent, q);
          driver.latch(q);
          if (recording) recorder!.latch(q);
        }
        driver.step(dt, p.view, cmd);
      }
      p.step(dt, cmd, aids, simEvents, events);
      tick[0] = tick[0]! + 1;
      steps[0] = steps[0]! + 1;
      if (st) {
        st.tick = tick[0]!;
        // keyframe check (before the recorder stores this tick's snapshot): resync from the recorder's own snapshot
        const K = REPLAY_LIMITS.keyframeTicks;
        if (st.tick % K === 0 && st.tick / K <= st.replay.keyframes.length) {
          const k = st.tick / K - 1;
          if (stateChecksum(currentSnapshot()) !== st.replay.keyframes[k]) {
            st.mismatches++;
            if (st.firstMismatch < 0) st.firstMismatch = st.tick;
            if (resync && resyncFrom >= 0) {
              restoreFrom(resync, k * REPLAY_START_LENGTH);
              st.resyncs++;
            }
          }
        }
      }
      if (recording && mode !== 'returning') recorder!.tick(currentSnapshot);
      if (st && st.tick >= st.ticks) {
        st.endChecksum = stateChecksum(currentSnapshot());
        st.state = 'ended';
        setMode('manual', false);
      }
    },

    releaseNow() {
      pending = null;
      pendingReset = false;
      endRun();
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
      } else if (mode === 'replay') {
        d.source = 'replay';
        d.idle = 0;
        d.steerDemand = driver.steerDemand;
      } else {
        d.source = driver.source;
        d.idle = driver.idle;
        d.steerDemand = driver.steerDemand;
      }
    },
  };
  return host;
}
