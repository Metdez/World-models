/**
 * Headless re-simulation of a replay (tests, 11-04 `replayLine`): play it in `sim` and step until its last tick (or a
 * branch). The simulation ends in manual at the replay's final state, exactly as the live run left it (same build).
 */
import type { DecodedReplay } from '../../contracts/drive';
import type { Simulation } from '../../contracts/sim';
import { SIM_DT } from '../../contracts/units';
import type { DriveHost, ReplayStatus } from '../drive/control';

export function runReplay(sim: Simulation, replay: DecodedReplay, onStep?: (sim: Simulation, tick: number) => void): ReplayStatus | null {
  const drive = sim.drive as DriveHost | undefined;
  if (!drive || !drive.play(replay)) return null;
  const st = drive.replay!;
  for (let guard = replay.header.ticks + 2; st.state === 'playing' && guard > 0; guard--) {
    sim.step(SIM_DT);
    onStep?.(sim, st.tick);
  }
  return st;
}
