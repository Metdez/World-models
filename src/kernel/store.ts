import { map } from 'nanostores';
import type { ResolvedFlags } from '../contracts/app';
import { initialState, type AppStore } from '../contracts/store';

/** Boot step 2 (§6.2): initial state overlaid with URL flags. */
export function createStore(flags: ResolvedFlags, reducedMotion: boolean): AppStore {
  const s = initialState();
  if (flags.vehicle) s.vehicleId = flags.vehicle;
  if (flags.suspension) s.suspensionId = flags.suspension;
  if (flags.view) s.view = flags.view;
  s.quality = flags.quality ?? (flags.e2e ? 'low' : s.quality);
  s.paused = flags.paused;
  if (flags.amplification !== undefined) s.amplification = flags.amplification;
  if (flags.clock) s.clock = flags.clock;
  if (flags.lapTime !== undefined || flags.paused) s.clock = 'local';
  if (flags.attract !== undefined) s.attract = flags.attract;
  s.reducedMotion = reducedMotion;
  return map(s);
}
