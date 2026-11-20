import type { MapStore } from 'nanostores';
import type { QualityTier } from './app';
import type { RoomRole } from './net';
import type { CornerId } from './units';

/** follow = chase camera; explore = free orbit around the moving car; closeup = suspension close-up (x-ray on). */
export type ViewMode = 'follow' | 'explore' | 'closeup';
/** clean = car + minimal HUD; engineer = construction lines, ghost pose, load arrows, curves. */
export type OverlayLevel = 'clean' | 'engineer';

export interface RoomStatus {
  readonly code: string | null;
  readonly role: RoomRole | null;
  readonly connected: boolean;
  /** Connected viewers in the room (excluding host). */
  readonly viewers: number;
  /** Live distribution: key `${vehicleId}:${suspensionId}` -> count. */
  readonly dist: Readonly<Record<string, number>>;
}

/**
 * Discrete app state (nanostores map). Single source of truth for configuration and UI state.
 * NEVER put per-frame data here. Features write with store.setKey(); the kernel applies
 * vehicleId/suspensionId/paused/timeScale/clock to the simulation.
 */
export interface AppState {
  vehicleId: string;
  suspensionId: string;
  trackId: string;
  view: ViewMode;
  focusCorner: CornerId | null;
  xray: boolean;
  overlay: OverlayLevel;
  /** Display amplification of body/wheel motion (1 = true scale). Readouts always show true values. */
  amplification: number;
  paused: boolean;
  /** 1 = real time; slow motion < 1. */
  timeScale: number;
  /** live = lap phase follows the shared server clock; local = free-running (pause/slow-mo/seek). */
  clock: 'live' | 'local';
  attract: boolean;
  hudVisible: boolean;
  creditsOpen: boolean;
  engineerOpen: boolean;
  quality: QualityTier;
  reducedMotion: boolean;
  /** 0..1 loading progress; 1 = ready. */
  loading: number;
  room: RoomStatus;
}

export type AppStore = MapStore<AppState>;

export const DEFAULT_IDS = {
  track: 'proving-loop',
  car: 'gt-coupe',
  carSuspension: 'double-wishbone',
  motorcycle: 'cafe-racer',
} as const;

export const AMPLIFICATION_ON = 2.5;

export function initialState(): AppState {
  return {
    vehicleId: DEFAULT_IDS.car,
    suspensionId: DEFAULT_IDS.carSuspension,
    trackId: DEFAULT_IDS.track,
    view: 'follow',
    focusCorner: null,
    xray: false,
    overlay: 'clean',
    amplification: 1,
    paused: false,
    timeScale: 1,
    clock: 'live',
    attract: false,
    hudVisible: true,
    creditsOpen: false,
    engineerOpen: false,
    quality: 'high',
    reducedMotion: false,
    loading: 0,
    room: { code: null, role: null, connected: false, viewers: 0, dist: {} },
  };
}
