import type { Emitter } from 'mitt';
import type { PresenterCue } from './net';
import type { SimEvent } from './sim';
import type { ComponentRole } from './suspension';
import type { CornerId } from './units';

/**
 * Discrete, one-off events (mitt). RULES: past tense or `noun:verb`; plain payloads; never per frame;
 * state lives in the store (subscribe to it), events announce transitions the store cannot express.
 */
export type AppEvents = {
  /** Boot finished: first frame rendered, loading overlay can go. */
  'app:ready': undefined;
  'assets:progress': { loaded: number; total: number };
  /** Emitted by the kernel AFTER the simulation was rebuilt for a new vehicle: TelemetryFrame layout may have changed. */
  'sim:vehicle': { vehicleId: string; suspensionId: string };
  /** Emitted by the kernel AFTER the simulation swapped suspension. */
  'sim:suspension': { suspensionId: string; previous: string };
  /** REQUEST from a feature (section jump, replay, AI tool): the kernel seeks and sets clock = 'local'. */
  'sim:seek-to': { lapTime: number };
  /** Emitted by the kernel AFTER any seek (live-clock resync or a request). */
  'sim:seek': { lapTime: number };
  /** Forwarded from Simulation.drainEvents(). */
  'sim:event': SimEvent;
  /** Request the camera to frame a corner (null = whole car). */
  'camera:focus': { corner: CornerId | null };
  /** Glow a component role (AI tool, part labels, insights). */
  'highlight': { role: ComponentRole; corner: CornerId | 'all'; durationMs: number };
  /** An insight caption was shown (attract mode and analytics listen). */
  'insight:shown': { id: string; text: string };
  /** One-off presenter cue received from the room. */
  'room:cue': { cue: PresenterCue };
  /** Any pointer/keyboard/touch input on the app (attract mode exits on it). */
  'user:activity': undefined;
};

export type AppBus = Emitter<AppEvents>;
