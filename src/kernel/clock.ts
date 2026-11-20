import type { Clock } from '../contracts/app';

/** Wall clock + server offset (set by live-lab after time sync). */
export function createClock(now: () => number = Date.now): Clock {
  let offset = 0;
  let synced = false;
  return {
    serverNow: () => now() + offset,
    setOffset(ms) {
      offset = ms;
      synced = true;
    },
    get synced() {
      return synced;
    },
  };
}
