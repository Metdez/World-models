/** Pure presenter logic: which parts of a room `ctl` state the screen must apply, and what a cue means. */
import type { PresenterCue, PresenterState } from '../../contracts/net';
import type { AppState } from '../../contracts/store';
import type { CornerId } from '../../contracts/units';

/** Store keys a presenter may set, in the order they must be written (vehicle before its suspension). */
const KEYS = ['vehicleId', 'suspensionId', 'view', 'xray', 'overlay', 'timeScale', 'amplification', 'attract'] as const;
type Key = (typeof KEYS)[number];

export type StorePatch = [key: Key, value: AppState[Key]][];

export interface CtlStep {
  /** Ordered store writes. */
  readonly patch: StorePatch;
  /** Section to seek to (only when it changed; never on the first state after a (re)load). */
  readonly section: string | null;
}

/**
 * Returns null for stale or duplicate state (seq not newer). `prev` is the last applied state, null after a load:
 * then every set field is applied except the section (a reload must not yank the lap position).
 * `offered(vehicleId)` lists the suspensions of a vehicle the app knows (undefined = unknown vehicle);
 * `current` is the vehicle the screen runs now.
 */
export function ctlStep(
  prev: PresenterState | null,
  next: PresenterState,
  current: string,
  offered: (vehicleId: string) => readonly string[] | undefined,
): CtlStep | null {
  if (prev && next.seq <= prev.seq) return null;
  const patch: StorePatch = [];
  let vehicle: string | undefined;
  for (const key of KEYS) {
    const value = next[key];
    if (value === undefined || (prev && prev[key] === value)) continue;
    if (key === 'vehicleId') {
      if (!offered(value as string)) continue; // unknown vehicle on this build: ignore quietly
      vehicle = value as string;
    }
    patch.push([key, value]);
  }
  // A suspension is only valid for the vehicle it will run on (the kernel would warn and revert otherwise).
  const sIdx = patch.findIndex(([k]) => k === 'suspensionId');
  const sus = next.suspensionId;
  if (sus !== undefined) {
    const list = offered(vehicle ?? current);
    if (vehicle && list?.includes(sus) && sIdx < 0) patch.push(['suspensionId', sus]); // re-assert after a vehicle swap
    if (sIdx >= 0 && !list?.includes(sus)) patch.splice(sIdx, 1);
  }
  patch.sort((a, b) => KEYS.indexOf(a[0]) - KEYS.indexOf(b[0]));
  const section = prev && next.section !== undefined && next.section !== prev.section ? next.section : null;
  return { patch, section };
}

export type CueAction = { readonly kind: 'focus'; readonly corner: CornerId | null } | { readonly kind: 'replay' };

export function cueAction(cue: PresenterCue, vehicleClass: 'car' | 'motorcycle'): CueAction {
  switch (cue) {
    case 'focus-front-left':
      return { kind: 'focus', corner: vehicleClass === 'motorcycle' ? 'f' : 'fl' };
    case 'focus-car':
      return { kind: 'focus', corner: null };
    case 'replay-section':
      return { kind: 'replay' };
  }
}

/** Audience link (short, safe to show to everyone) and the presenter link (host key in the fragment only). */
export function remoteLinks(origin: string, code: string, hostKey: string | null): { audience: string; host: string | null } {
  return {
    audience: `${origin}/r/${code}`,
    host: hostKey ? `${origin}/remote.html?room=${code}#k=${hostKey}` : null,
  };
}
