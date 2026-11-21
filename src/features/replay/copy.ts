/** Replay feature copy and pure decisions (no DOM). Copy carries no digits (ARCH-M2 §13.7). */
import { REPLAY_LIMITS, type DriveEvent } from '../../contracts/drive';
import type { ReplayStatus } from '../../sim-core/drive/control';
import type { ReplayRefusal } from '../../sim-core/replay/format';
import type { LinkError } from './link';

/** Moment replay: the newest seconds it replays and the slow motion it plays them at (MD-43). */
export const MOMENT_SECONDS = 4;
export const MOMENT_TIME_SCALE = 0.25;
/** A detected driving event offers the moment replay for this long, s. */
export const OFFER_S = 10;
/** Recorded seconds before the chip offers anything. */
export const MIN_RECORDED_S = 1;
/** How long a note stays, s. */
export const NOTE_S = 6;

export const COPY = {
  moment: 'Moment replay',
  momentTitle: 'Replay the last moments in slow motion, then drive on from here',
  share: 'Share',
  shareTitle: 'Share this run as a link',
  copy: 'Copy',
  copied: 'Link copied',
  copyManually: 'Select the link and copy it',
  shareLastMinute: 'Sharing the last minute: a link holds up to a minute of driving.',
  tooBig: 'This run is too detailed to fit in a link.',
  linkNote: 'The link replays your run in the visitor’s browser by re-simulating it.',
  replay: 'Replay',
  shared: 'Shared run',
  slow: 'Slow motion',
  driveIt: 'Drive it yourself',
  driveItTitle: 'Stop the replay and take the wheel from here',
  yourTurn: 'Your turn: you are driving on from where the replay ended.',
  back: 'Back in your run: you are driving again.',
  recording: 'Recording',
} as const;

export const LINK_ERROR: Readonly<Record<LinkError, string>> = {
  damaged: 'This replay link is damaged or incomplete, so there is nothing to play.',
  'newer-format': 'This replay link was made by a newer version of the lab. Reload the page to update it.',
  unsupported: 'This browser cannot unpack replay links.',
};

export const REFUSAL: Readonly<Record<ReplayRefusal | 'unavailable', string>> = {
  track: 'This replay was recorded on another track.',
  world: 'This replay was recorded on another proving ground layout.',
  vehicle: 'This replay was recorded with another vehicle.',
  suspension: 'This replay uses a suspension this car does not offer.',
  state: 'This replay was recorded with an incompatible version of the lab.',
  unavailable: 'Replays need a car you can drive.',
};

/** The honesty line under the replay chip, or null when the replay matches the recording. */
export function statusNote(s: Readonly<ReplayStatus>): string | null {
  if (!s.sameVersion) return 'Recorded with an older model: the replay may differ from the original run.';
  if (!s.sameModel) return 'Recorded with other model settings: the replay may differ from the original run.';
  if (s.resyncs > 0) return 'Drifted from the recording and put back on it: approximate from here.';
  if (s.mismatches > 0) return 'Drifted from the recording: the replay may differ from here on.';
  return null;
}

/** Share: the whole run when it fits the fragment limit, else the newest REPLAY_LIMITS.fragmentSeconds. */
export function shareSeconds(recordedTicks: number): { readonly seconds: number; readonly truncated: boolean } {
  const s = recordedTicks / 240;
  // a window rounds its start down to a whole snapshot second: ask for one less to stay within the limit
  return s <= REPLAY_LIMITS.fragmentSeconds ? { seconds: s, truncated: false } : { seconds: REPLAY_LIMITS.fragmentSeconds - 1, truncated: true };
}

/** Driving events that offer the moment replay (11-02 detectors). */
export const offers = (e: DriveEvent): boolean => e.kind === 'slide' || e.kind === 'lockup' || e.kind === 'wheelspin' || e.kind === 'aid';
