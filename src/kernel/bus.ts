import mitt from 'mitt';
import type { AppBus, AppEvents } from '../contracts/events';

export const createBus = (): AppBus => mitt<AppEvents>();

/** Total registered handlers (disposal leak check, §6.7). */
export function listenerCount(bus: AppBus): number {
  let n = 0;
  for (const handlers of bus.all.values()) n += handlers.length;
  return n;
}
