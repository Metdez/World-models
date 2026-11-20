import type { AnalyticsEvent } from '../../contracts/net';
import type { AppState } from '../../contracts/store';

/** A suspension counts as picked once it has stayed selected this long (skips click-throughs). */
export const PICK_DWELL_MS = 2000;
/** One session event (fps + tier) after this long on the page. */
export const SESSION_AFTER_MS = 60_000;

export interface TrackerDeps {
  push(e: AnalyticsEvent): void;
  /** Current renderer fps, undefined without a renderer. */
  fps(): number | undefined;
}

export interface Tracker {
  onState(s: Readonly<AppState>): void;
  dispose(): void;
}

/**
 * Turns store transitions into anonymous events. The boot state is not a pick; neither are changes made by attract
 * mode or applied to a presenter's big screen (role 'screen'): only what a person chose here counts.
 */
export function createTracker(deps: TrackerDeps): Tracker {
  let prev: Readonly<AppState> | undefined;
  let pickTimer: ReturnType<typeof setTimeout> | undefined;
  const sessionTimer = setTimeout(() => {
    const fps = deps.fps();
    if (prev && fps !== undefined && Number.isFinite(fps)) {
      deps.push({ type: 'session', quality: prev.quality, fps: Math.round(fps * 10) / 10 });
    }
  }, SESSION_AFTER_MS);

  return {
    onState(s) {
      const last = prev;
      prev = s;
      if (!last) return;
      const automatic = s.attract || s.room.role === 'screen';
      if (automatic) {
        clearTimeout(pickTimer);
        return;
      }
      if (s.vehicleId !== last.vehicleId || s.suspensionId !== last.suspensionId) {
        clearTimeout(pickTimer);
        const { vehicleId: vehicle, suspensionId: suspension } = s;
        pickTimer = setTimeout(() => deps.push({ type: 'suspension-picked', vehicle, suspension }), PICK_DWELL_MS);
      }
      if (s.view !== last.view) deps.push({ type: 'view-changed', view: s.view });
    },
    dispose() {
      clearTimeout(pickTimer);
      clearTimeout(sessionTimer);
    },
  };
}
