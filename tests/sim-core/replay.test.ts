/**
 * Replays (ARCHITECTURE-M2 §7.10 F/G, §7.13; plan 11-03): binary format round trip and damage detection, recorder
 * windows, re-simulation from the recorded start state (another simulation, other lap time), refusals and labels,
 * branching, moment replay ending at the exact pre-replay state, keyframe mismatch → resync / "may differ",
 * allocation-free record and playback steps, and the size report (bytes per minute, link length).
 */
import { describe, expect, it } from 'vitest';
import { REPLAY_LIMITS, type DecodedReplay } from '../../src/contracts/drive';
import { SIM_DT } from '../../src/contracts/units';
import { REPLAY_START_LENGTH } from '../../src/sim-core/drive/control';
import { crc32, decodeReplay, decodeReplayResult, encodeReplay, paramsHash, SIM_VERSION, stateChecksum } from '../../src/sim-core/replay/format';
import { createRecorder, SNAP_TICKS } from '../../src/sim-core/replay/recorder';
import { runReplay } from '../../src/sim-core/replay/run';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { makeSim } from '../fixtures/08-02-drive';
import { host, manualSim, scriptedDriver } from '../fixtures/11-03-replay';

function recorded(seconds: number, seed = 3, analog = false) {
  const sim = manualSim(10);
  scriptedDriver(seed, analog)(sim, seconds);
  const replay = sim.drive!.recording()!;
  return { sim, replay, end: host(sim).stateChecksum() };
}

describe('format', () => {
  const { replay } = recorded(12);

  it('round trip is exact', () => {
    const bytes = encodeReplay(replay);
    const back = decodeReplay(bytes)!;
    expect(back).not.toBeNull();
    expect(back.header).toEqual(replay.header);
    expect(Array.from(back.start)).toEqual(Array.from(replay.start));
    expect(Array.from(back.intents)).toEqual(Array.from(replay.intents));
    expect(back.events).toEqual(replay.events);
    expect(Array.from(back.keyframes)).toEqual(Array.from(replay.keyframes));
    expect(back.header.simVersion).toBe(SIM_VERSION);
    expect(back.start.length).toBe(REPLAY_START_LENGTH);
    expect(back.keyframes.length).toBe(Math.floor(replay.header.ticks / REPLAY_LIMITS.keyframeTicks));
    expect(encodeReplay(back)).toEqual(bytes);
  });

  it('any flipped bit, truncation or trailing byte is rejected; a newer format says so', () => {
    const bytes = encodeReplay(replay);
    for (const at of [0, 3, 4, 10, 60, Math.floor(bytes.length / 2), bytes.length - 20, bytes.length - 1]) {
      const bad = bytes.slice();
      bad[at]! ^= 0x10;
      expect(decodeReplay(bad), `byte ${at}`).toBeNull();
    }
    expect(decodeReplay(bytes.slice(0, bytes.length - 1))).toBeNull();
    expect(decodeReplay(new Uint8Array([...bytes, 0]))).toBeNull();
    expect(decodeReplay(new Uint8Array(0))).toBeNull();
    expect(decodeReplayResult(new TextEncoder().encode('hello world, not a replay'))).toEqual({ error: 'damaged' });
    const newer = bytes.slice();
    newer[3] = 0x32; // 'SLR2'
    expect(decodeReplayResult(newer)).toEqual({ error: 'newer-format' });
    const v2 = bytes.slice();
    v2[4] = 2;
    // CRC no longer matches either, but the format byte is read first
    expect(decodeReplayResult(v2)).toEqual({ error: 'newer-format' });
  });

  it('a structurally valid file with out-of-range values is rejected (CRC recomputed)', () => {
    const r: DecodedReplay = { ...replay, intents: replay.intents.slice() };
    (r.intents as Int16Array)[0] = 2000; // steer beyond INTENT_QUANT.steer
    expect(decodeReplay(encodeReplay(r))).toBeNull();
    const wrongCount: DecodedReplay = { ...replay, keyframes: new Uint32Array(0) };
    expect(decodeReplay(encodeReplay(wrongCount))).toBeNull();
  });

  it('crc32 matches the IEEE check value; stateChecksum ignores -0 and sub-1e-6 noise but not 1e-5', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
    const a = new Float64Array([1.5, 0, 2e3, -7.25, NaN]);
    const b = new Float64Array([1.5 + 1e-10, -0, 2e3, -7.25, NaN]);
    expect(stateChecksum(a)).toBe(stateChecksum(b));
    b[0] = 1.5 + 1e-5;
    expect(stateChecksum(a)).not.toBe(stateChecksum(b));
  });

  it('paramsHash: 8 hex, stable, differs per suspension', () => {
    const h = paramsHash(gtCoupe, macpherson, null);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(paramsHash(gtCoupe, macpherson, null)).toBe(h);
    expect(paramsHash(gtCoupe, multilink, null)).not.toBe(h);
  });
});

describe('recorder', () => {
  it('windows start on a snapshot second, carry relative events and the aids in force', () => {
    const r = createRecorder({ snapshotLength: 3, paramsHash: (id) => `0000000${id.length % 10}` });
    const snap = new Float64Array(3);
    r.start(snap, { format: 1, simVersion: SIM_VERSION, paramsHash: '00000000', trackId: 't', worldId: null, vehicleId: 'v', suspensionId: 'a' });
    r.event('aids', 'abs');
    const q = { steer: 0, throttle: 0, brake: 0, handbrake: 0, flags: 1 };
    for (let t = 0; t < 2000; t++) {
      if (t === 700) r.event('suspension', 'bb');
      if (t === 1500) r.event('reset', '');
      if (t % 4 === 0) {
        q.steer = t / 4;
        r.latch(q);
      }
      snap[0] = t + 1;
      r.tick(() => snap);
    }
    const w = r.window(4)!;
    // 2000 - 960 = 1040 -> floor to 960
    expect(w.header.ticks).toBe(2000 - 960);
    expect(w.header.suspensionId).toBe('bb');
    expect(w.header.paramsHash).toBe('00000002');
    expect(w.start[0]).toBe(960);
    expect(w.intents[0]).toBe(240);
    expect(w.events).toEqual([
      { tick: 0, kind: 'aids', value: 'abs' },
      { tick: 1500 - 960, kind: 'reset', value: '' },
    ]);
    expect(w.keyframes.length).toBe(0);
    expect(r.origin(w)).toBe(960);
    const whole = r.whole()!;
    expect(whole.header.ticks).toBe(2000);
    expect(whole.header.suspensionId).toBe('a');
    expect(whole.keyframes.length).toBe(1);
    expect(whole.events.map((e) => e.kind)).toEqual(['aids', 'suspension', 'reset']);
    expect(r.origin(whole)).toBe(0);
    expect(r.rewind(1200)).toBe(true);
    expect(r.ticks).toBe(1200);
    expect(r.whole()!.events.map((e) => e.kind)).toEqual(['aids', 'suspension']);
    expect(r.origin(w)).toBe(960); // still inside the run
    r.start(snap, { format: 1, simVersion: SIM_VERSION, paramsHash: '00000000', trackId: 't', worldId: null, vehicleId: 'v', suspensionId: 'a' });
    expect(r.origin(w)).toBe(-1); // a window of an earlier run
  });

  it('keeps the newest maxSeconds: older data drops in whole seconds', () => {
    const r = createRecorder({ snapshotLength: 1, paramsHash: () => '00000000' });
    const snap = new Float64Array(1);
    r.start(snap, { format: 1, simVersion: SIM_VERSION, paramsHash: '00000000', trackId: 't', worldId: null, vehicleId: 'v', suspensionId: 'a' });
    const q = { steer: 0, throttle: 0, brake: 0, handbrake: 0, flags: 1 };
    const total = (REPLAY_LIMITS.maxSeconds + 3) * 240 + 17;
    for (let t = 0; t < total; t++) {
      if (t % 4 === 0) {
        q.throttle = (t / 4) % 256;
        r.latch(q);
      }
      snap[0] = t + 1;
      r.tick(() => snap);
    }
    const w = r.whole()!;
    expect(r.base % SNAP_TICKS).toBe(0);
    expect(w.header.ticks).toBeLessThanOrEqual(REPLAY_LIMITS.maxSeconds * 240 + SNAP_TICKS);
    expect(w.header.ticks).toBeGreaterThan((REPLAY_LIMITS.maxSeconds - 1) * 240);
    expect(w.start[0]).toBe(r.base);
    expect(w.intents[1]).toBe((r.base / 4) % 256);
    expect(w.intents[(w.intents.length / 5 - 1) * 5 + 1]).toBe(((total - 1) >> 2) % 256);
  });
});

describe('re-simulation', () => {
  it('a recorded run replays bit-identically in another simulation (other lap time, other suspension installed)', () => {
    const { replay, end } = recorded(14, 5, true);
    const other = makeSim('proving-loop', 'multilink', 47);
    const st = runReplay(other, replay)!;
    expect(st.state).toBe('ended');
    expect(st.mismatches).toBe(0);
    expect(st.endChecksum).toBe(end);
    expect(other.suspension.id).toBe('double-wishbone');
    expect(other.drive!.mode).toBe('manual');
    // and through the binary format
    const again = runReplay(makeSim('proving-loop', 'macpherson', 3), decodeReplay(encodeReplay(replay))!)!;
    expect(again.endChecksum).toBe(end);
  });

  it('suspension swaps, aids changes and resets inside the run are replayed at their ticks', () => {
    const sim = manualSim(30);
    const drive = scriptedDriver(9, false);
    drive(sim, 3);
    sim.setSuspension('multilink');
    drive(sim, 2);
    sim.drive!.setAids({ abs: false, traction: true, stability: false, steering: true });
    drive(sim, 2);
    sim.drive!.reset();
    drive(sim, 3);
    const replay = sim.drive!.recording()!;
    expect(replay.events.map((e) => e.kind)).toEqual(['aids', 'suspension', 'aids', 'reset']);
    const end = host(sim).stateChecksum();
    const other = makeSim('proving-loop', 'macpherson', 5);
    const st = runReplay(other, replay)!;
    expect(st.mismatches).toBe(0);
    expect(st.endChecksum).toBe(end);
    expect(other.suspension.id).toBe('multilink');
    expect(other.sample(1).drive.aids).toEqual({ abs: false, traction: true, stability: false, steering: true });
  });

  it('refuses another vehicle, track or world; labels another model or version; plays the header suspension', () => {
    const { replay } = recorded(3);
    const d = makeSim().drive!;
    expect(d.play({ ...replay, header: { ...replay.header, vehicleId: 'other-car' } })).toBe(false);
    expect(d.play({ ...replay, header: { ...replay.header, trackId: 'other-track' } })).toBe(false);
    expect(d.play({ ...replay, header: { ...replay.header, worldId: 'proving-ground' } })).toBe(false);
    expect(d.play({ ...replay, header: { ...replay.header, suspensionId: 'leaf-spring' } })).toBe(false);
    expect(d.play({ ...replay, start: replay.start.slice(1) })).toBe(false);
    expect(d.mode).toBe('auto');
    const older = runReplay(makeSim(), { ...replay, header: { ...replay.header, simVersion: 'm2.0' } })!;
    expect(older.sameVersion).toBe(false);
    expect(older.sameModel).toBe(true);
    const other = runReplay(makeSim(), { ...replay, header: { ...replay.header, paramsHash: '12345678' } })!;
    expect(other.sameModel).toBe(false);
    expect(other.state).toBe('ended');
  });

  it('a deliberate input during a replay branches into manual; the recording continues from the replay prefix', () => {
    const { replay } = recorded(6);
    const sim = makeSim('proving-loop', 'double-wishbone', 20);
    const d = sim.drive!;
    expect(d.play(replay)).toBe(true);
    for (let k = 0; k < 480; k++) sim.step(SIM_DT);
    expect(d.mode).toBe('replay');
    expect(sim.sample(1).drive.source).toBe('replay');
    d.request('manual');
    sim.step(SIM_DT);
    expect(d.mode).toBe('manual');
    expect(host(sim).replay!.state).toBe('branched');
    for (let k = 0; k < 240; k++) sim.step(SIM_DT);
    expect(d.recording()!.header.ticks).toBe(481 + 240);
    // user aids change during a replay branches too
    expect(d.play(replay)).toBe(true);
    sim.step(SIM_DT);
    d.setAids({ abs: false, traction: false, stability: false, steering: false });
    sim.step(SIM_DT);
    expect(d.mode).toBe('manual');
  });

  it('moment replay: the last seconds replay and end in manual at exactly the pre-replay state', () => {
    const sim = manualSim(15);
    scriptedDriver(11, true)(sim, 9.3);
    const h = host(sim);
    const before = h.stateChecksum();
    const ticksBefore = sim.drive!.recording()!.header.ticks;
    const w = h.window(4)!;
    expect(w.header.ticks / 240).toBeGreaterThanOrEqual(4);
    expect(w.header.ticks / 240).toBeLessThan(5);
    const st = runReplay(sim, w)!;
    expect(st.moment).toBe(true);
    expect(st.state).toBe('ended');
    expect(st.mismatches).toBe(0);
    expect(h.stateChecksum()).toBe(before);
    expect(sim.drive!.mode).toBe('manual');
    // the recording is the same run again, not a new one
    const after = sim.drive!.recording()!;
    expect(after.header.ticks).toBe(ticksBefore);
    // twice in a row
    expect(runReplay(sim, h.window(4)!)!.endChecksum).toBe(before);
  });

  it('a keyframe mismatch resyncs a moment replay from the recorder and marks a shared one "may differ"', () => {
    const sim = manualSim(15);
    scriptedDriver(2, true)(sim, 12.2);
    const h = host(sim);
    const before = h.stateChecksum();
    const w = h.window(11)!;
    expect(w.keyframes.length).toBe(2);
    (w.keyframes as Uint32Array)[0]! ^= 1; // as if this engine had diverged by then
    const st = runReplay(sim, w)!;
    expect(st.mismatches).toBe(1);
    expect(st.resyncs).toBe(1);
    expect(st.firstMismatch).toBe(1200);
    expect(h.stateChecksum()).toBe(before);
    // a shared (decoded) copy has no snapshots: it counts and carries on
    const { replay } = recorded(11, 4);
    const bad = { ...replay, keyframes: replay.keyframes.slice() };
    bad.keyframes[1]! ^= 1;
    const shared = runReplay(makeSim(), bad)!;
    expect(shared.mismatches).toBe(1);
    expect(shared.resyncs).toBe(0);
    expect(shared.moment).toBe(false);
  });

  it('record and playback steps do not allocate', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, 'vitest must run with --expose-gc').toBeTypeOf('function');
    const sim = manualSim(10);
    const drive = scriptedDriver(1, true);
    const measure = (block: () => void) => {
      block();
      let churn = Infinity;
      for (let r = 0; r < 3; r++) {
        gc!();
        const before = process.memoryUsage().heapUsed;
        block();
        churn = Math.min(churn, process.memoryUsage().heapUsed - before);
      }
      return churn / 4800;
    };
    const recordChurn = measure(() => {
      drive(sim, 20);
      sim.drainEvents(() => {});
      sim.drive!.drainEvents(() => {});
    });
    const replay = host(sim).window(30)!;
    const playChurn = measure(() => {
      sim.drive!.play(replay);
      for (let k = 0; k < 4800; k++) sim.step(SIM_DT);
      sim.drainEvents(() => {});
      sim.drive!.drainEvents(() => {});
    });
    console.log(`[11-03] heap churn per step: recording ${recordChurn.toFixed(0)} B, replay ${playChurn.toFixed(0)} B (scripted driver closures included)`);
    expect(recordChurn).toBeLessThan(1500);
    expect(playChurn).toBeLessThan(1500);
  }, 60_000);
});

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

describe('size report', () => {
  it('bytes per minute and #r= link length (30 s and 2 min, keyboard and gamepad-like)', async () => {
    const rows: string[] = [];
    for (const analog of [false, true])
      for (const seconds of [30, 120]) {
        const { replay } = recorded(seconds, 21, analog);
        const raw = encodeReplay(replay);
        const z = await deflate(raw);
        const chars = Math.ceil(((z.length + 1) * 4) / 3); // codec byte + base64url, no padding
        const perMin = (z.length * 60) / seconds;
        rows.push(`${analog ? 'gamepad-like' : 'keyboard'} ${seconds} s: raw ${raw.length} B, deflate-raw ${z.length} B (${perMin.toFixed(0)} B/min), link ${'https://host/#r='.length + chars} chars (fragment ${chars})`);
        expect(z.length).toBeLessThan(REPLAY_LIMITS.maxBytes);
      }
    console.log(`[11-03] replay size\n  ${rows.join('\n  ')}`);
  }, 120_000);
});
