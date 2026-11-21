/** Attract mode only runs while the car drives itself (ARCHITECTURE-M2 §9): never over a visitor at the wheel. */
import type { AppState } from '../../contracts/store';

export function attractMayRun(s: Pick<AppState, 'driveMode'>): boolean {
  return s.driveMode === 'auto';
}

/** Store keys the kernel owns while driving: attract must not restore them over a takeover. */
export const CLOCK_KEYS: ReadonlySet<keyof AppState> = new Set(['clock', 'paused', 'timeScale']);
