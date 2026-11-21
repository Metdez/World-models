import type { AnalyticsEvent } from '../../contracts/net';
import type { AppState } from '../../contracts/store';

/** A suspension counts as picked once it has stayed selected this long (skips click-throughs). */
export const PICK_DWELL_MS = 2000;
/** One session event (fps + tier) after this long on the page. */
export const SESSION_AFTER_MS = 60_000;

/** A Manual Drive session shorter than this (whole seconds) is not reported (a takeover tap, a mis-key). */
export const DRIVE_MIN_S = 5;
/** The same station again within this long counts once (zone-edge flicker). */
export const STATION_REPEAT_MS = 30_000;

export interface TrackerDeps {
  push(e: AnalyticsEvent): void;
  /** Current renderer fps, undefined without a renderer. */
  fps(): number | undefined;
  /** Monotonic ms clock (performance.now in the browser). */
  now?(): number;
}

export interface Tracker {
  onState(s: Readonly<AppState>): void;
  /** A station's zone was entered while driving, at `speed` m/s (ARCH-M2 §12.5). */
  onStation(station: string, speed: number): void;
  /** Page hidden or feature disposed: close an open drive session now. */
  endDrive(): void;
  dispose(): void;
}

/**
 * Turns store transitions into anonymous events. The boot state is not a pick; neither are changes made by attract
 * mode or applied to a presenter's big screen (role 'screen'): only what a person chose here counts.
 */
export function createTracker(deps: TrackerDeps): Tracker {
  const now = deps.now ?? (() => performance.now());
  let prev: Readonly<AppState> | undefined;
  let pickTimer: ReturnType<typeof setTimeout> | undefined;
  /** Start (ms) of the current Manual Drive session, or undefined. */
  let driveStart: number | undefined;
  const lastStation = new Map<string, number>();

  // Anonymous by construction: vehicle and suspension ids and whole seconds; never inputs, positions or ids.
  function endDrive(s: Readonly<AppState> | undefined): void {
    if (driveStart === undefined || !s) return;
    const seconds = Math.floor((now() - driveStart) / 1000);
    driveStart = undefined;
    if (seconds >= DRIVE_MIN_S) deps.push({ type: 'drive-session', vehicle: s.vehicleId, suspension: s.suspensionId, seconds: Math.min(seconds, 86400) });
  }
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
      // drive sessions: from entering Manual to leaving it (Returning, a cut to Auto or a replay); boot state included
      if (s.driveMode === 'manual' && driveStart === undefined && !s.attract) driveStart = now();
      else if (s.driveMode !== 'manual' && driveStart !== undefined) endDrive(last ?? s);
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
    onStation(station, speed) {
      const s = prev;
      if (!s || s.attract || s.driveMode !== 'manual' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(station)) return;
      const t = now();
      if (t - (lastStation.get(station) ?? -Infinity) < STATION_REPEAT_MS) return;
      lastStation.set(station, t);
      deps.push({ type: 'station-visit', station, suspension: s.suspensionId, speed: Math.min(100, Math.max(0, Math.round(speed))) });
    },
    endDrive() {
      const s = prev;
      endDrive(s);
      if (s?.driveMode === 'manual') driveStart = now(); // the page may come back (bfcache): a new session
    },
    dispose() {
      endDrive(prev);
      clearTimeout(pickTimer);
      clearTimeout(sessionTimer);
    },
  };
}
