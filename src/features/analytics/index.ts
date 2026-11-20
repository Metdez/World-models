import type { FeatureModule } from '../../contracts/app';
import { API } from '../../contracts/net';
import { RENDER } from '../../contracts/services';
import { createBatcher } from './batcher';
import { trackingAllowed, type PrivacySignals } from './privacy';
import { createTracker } from './tracker';

/** Fire-and-forget. A string body is sent as text/plain (no preflight); the route parses JSON regardless. */
function send(body: string): void {
  if (navigator.sendBeacon?.(API.event, body)) return;
  fetch(API.event, { method: 'POST', body, keepalive: true }).catch(() => {});
}

/** Anonymous interaction events → POST /api/event → Analytics Engine (ARCHITECTURE §12.3). */
export default {
  id: 'analytics',
  requires: [],
  init(ctx) {
    if (ctx.flags.e2e || !trackingAllowed(navigator as PrivacySignals, window as { doNotTrack?: string | null })) return;
    const batcher = createBatcher(send);
    const tracker = createTracker({ push: batcher.push, fps: () => ctx.services.tryGet(RENDER)?.stats().fps });
    ctx.watch(tracker.onState);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') batcher.flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', batcher.flush);
    ctx.addDisposer(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', batcher.flush);
      tracker.dispose();
      batcher.flush();
    });
  },
} satisfies FeatureModule;
