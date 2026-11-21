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
    // station-visit (ARCH-M2 §12.5): entering a station's zone while driving; the nearest station of a shared zone
    ctx.on('drive:event', (e) => {
      if (e.kind !== 'zone' || !e.entered) return;
      const d = ctx.sim.frame.drive;
      if (d.mode !== 'manual') return;
      let best: string | undefined;
      let dist = Infinity;
      for (const st of ctx.sim.current.world?.def?.stations ?? []) {
        const dd = st.zone === e.zone ? (st.spawn.x - d.x) ** 2 + (st.spawn.y - d.y) ** 2 : Infinity;
        if (dd < dist) [dist, best] = [dd, st.id];
      }
      if (best) tracker.onStation(best, Math.sqrt(d.u * d.u + d.v * d.v));
    });
    const onHide = (): void => {
      tracker.endDrive();
      batcher.flush();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    ctx.addDisposer(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      tracker.dispose();
      batcher.flush();
    });
  },
} satisfies FeatureModule;
