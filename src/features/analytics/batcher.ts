import type { AnalyticsEvent } from '../../contracts/net';

/** Mirrors the route's EVENT_BATCH_MAX (worker/schemas/event.ts); features may not import worker code. */
export const BATCH_MAX = 8;
export const FLUSH_DELAY_MS = 10_000;

export interface Batcher {
  push(e: AnalyticsEvent): void;
  /** Sends whatever is queued now (page hide, dispose). */
  flush(): void;
}

/** Queues events and hands JSON batches to `send`. Never throws: analytics must not affect the experience. */
export function createBatcher(send: (body: string) => void): Batcher {
  let queue: AnalyticsEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    clearTimeout(timer);
    timer = undefined;
    if (queue.length === 0) return;
    const body = JSON.stringify(queue);
    queue = [];
    try {
      send(body);
    } catch {
      // dropped on purpose
    }
  }

  return {
    push(e) {
      queue.push(e);
      if (queue.length >= BATCH_MAX) flush();
      else timer ??= setTimeout(flush, FLUSH_DELAY_MS);
    },
    flush,
  };
}
