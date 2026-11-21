/**
 * Replay golden (ARCHITECTURE-M2 §7.13): a scripted 20 s Manual run is recorded, replayed in a fresh simulation that
 * started elsewhere on the lap, and must give the identical state CRC at every keyframe and at the end. The encoded
 * bytes and the end-state CRC are pinned together with SIM_VERSION: a plant behaviour change must bump SIM_VERSION
 * (old replays then play labelled "recorded with an older model") and re-baseline these values in the same commit.
 */
import { describe, expect, it } from 'vitest';
import { REPLAY_LIMITS } from '../../src/contracts/drive';
import { crc32, encodeReplay, SIM_VERSION, stateChecksum } from '../../src/sim-core/replay/format';
import { runReplay } from '../../src/sim-core/replay/run';
import { makeSim } from '../fixtures/08-02-drive';
import { host, manualSim, scriptedDriver } from '../fixtures/11-03-replay';

const GOLDEN = { simVersion: 'm2.1', bytes: '2144df1c', end: '0a38e90a' };

describe('replay golden', () => {
  it('record -> replay: identical state CRC at every keyframe and at the end; pinned to SIM_VERSION', () => {
    const sim = manualSim(10, 'double-wishbone');
    const live: number[] = [];
    let t = 1; // manualSim stepped once (the engage step)
    scriptedDriver(7, true)(sim, 20, () => {
      t++;
      if (t % REPLAY_LIMITS.keyframeTicks === 0) live.push(host(sim).stateChecksum());
    });
    const replay = sim.drive!.recording()!;
    const end = host(sim).stateChecksum();
    expect(replay.header.ticks).toBe(t);
    expect(Array.from(replay.keyframes)).toEqual(live);
    expect(replay.keyframes.length).toBe(4);

    const fresh = makeSim('proving-loop', 'macpherson', 61);
    const played: number[] = [];
    const st = runReplay(fresh, replay, (s, tick) => {
      if (tick % REPLAY_LIMITS.keyframeTicks === 0) played.push(host(s).stateChecksum());
    })!;
    expect(played).toEqual(live);
    expect(st.mismatches).toBe(0);
    expect(st.endChecksum).toBe(end);
    expect(stateChecksum(replay.start)).toBe(stateChecksum(fresh.drive!.recording()!.start));

    const bytes = crc32(encodeReplay(replay)).toString(16).padStart(8, '0');
    const endHex = end.toString(16).padStart(8, '0');
    console.log(`[11-03] replay golden: SIM_VERSION ${SIM_VERSION}, bytes crc ${bytes}, end state crc ${endHex}`);
    expect(SIM_VERSION).toBe(GOLDEN.simVersion);
    expect(bytes).toBe(GOLDEN.bytes);
    expect(endHex).toBe(GOLDEN.end);
  });
});
