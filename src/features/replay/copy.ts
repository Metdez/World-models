/** Replay feature copy and pure decisions (no DOM). Copy carries no digits (ARCH-M2 §13.7). */
import { REPLAY_LIMITS, type DriveEvent } from '../../contracts/drive';
import type { ReplayStatus } from '../../sim-core/drive/control';
import type { ReplayRefusal } from '../../sim-core/replay/format';
import type { LinkError } from './link';
import type { LoadError, SaveError } from './server';

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
  // saved runs (12-05)
  saveShort: 'Save a short link',
  saveWhole: 'Save the whole run',
  saveTitle: 'Save this run on the lab’s server and get a short link',
  saveRetry: 'Try again',
  savePrivacy: 'A quick check first, then only your inputs and the start state are kept, for thirty days: no account, nothing about you.',
  checking: 'Checking you are not a robot…',
  saving: 'Saving…',
  saved: 'Saved: this short link plays the whole run for thirty days.',
  longRun: 'A link holds up to a minute of driving: save the whole run for a short link.',
  tooBigSave: 'This run is too detailed to fit in a link: save it for a short link.',
  fetching: 'Fetching the shared run…',
} as const;

const MINUTES = ['', 'minute', 'two minutes', 'three minutes', 'four minutes', 'five minutes', 'six minutes', 'seven minutes', 'eight minutes', 'nine minutes', 'ten minutes'];
/** "the last five minutes" (copy carries no digits). */
export const lastMinutes = (m: number): string => `the last ${MINUTES[m] ?? 'few minutes'}`;
/** The saved state's line when only the newest part of the run was saved. */
export const savedPart = (m: number): string => `Saved: this short link plays ${lastMinutes(m)} of the run for thirty days.`;
/** Before saving a part: why. */
export const savingPart = (m: number): string => `Saving ${lastMinutes(m)}: a saved run holds up to ten minutes and must stay compact.`;

/** Save failures; `retry` = the same action may work in a moment. */
export const SAVE_ERROR: Readonly<Record<SaveError | 'unavailable' | 'expired' | 'unsupported', { readonly text: string; readonly retry: boolean }>> = {
  offline: { text: 'You are offline: saving needs a connection to the lab.', retry: true },
  challenge: { text: 'The check did not pass, so nothing was saved.', retry: true },
  unavailable: { text: 'The check could not load here (blocked or offline), so nothing was saved.', retry: true },
  expired: { text: 'The check timed out before saving.', retry: true },
  busy: { text: 'Several saves from this connection just now: wait a minute and try again.', retry: true },
  daily_cap: { text: 'Today’s allowance of saved runs is used up. Saving opens again tomorrow.', retry: false },
  storage: { text: 'Storage for saved runs is full or unavailable right now.', retry: true },
  disabled: { text: 'Saving runs is switched off on this server.', retry: false },
  too_large: { text: 'This run is too long or too detailed to save.', retry: false },
  unsupported: { text: 'This browser cannot pack a run for saving.', retry: false },
  failed: { text: 'Saving did not work this time.', retry: true },
};
/** After a save failure: what still works. */
export const FALLBACK = { whole: 'The link above still shares the whole run.', minute: 'The link above still shares the last minute.', none: '' } as const;

const LOAD_ERROR: Readonly<Record<Exclude<LoadError, LinkError>, string>> = {
  invalid: 'This saved-run link is incomplete, so there is nothing to fetch.',
  missing: 'This saved run has expired or was never saved: saved runs are kept for thirty days.',
  offline: 'Could not reach the lab to fetch this saved run. Check the connection and reload.',
  failed: 'The saved run could not be fetched right now. Reload in a moment to try again.',
};

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

/** What a `#rid=` link that cannot play says. */
export const loadMessage = (e: LoadError): string => (e in LOAD_ERROR ? LOAD_ERROR[e as keyof typeof LOAD_ERROR] : LINK_ERROR[e as LinkError]);
