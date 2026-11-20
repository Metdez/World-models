/**
 * What the phone remote offers. Car, suspensions and track sections come from sim-core content (pure data, no
 * three.js). The motorcycle's content lands in phase 5; its ids are the contract ids (ARCHITECTURE §7.1) and the big
 * screen ignores ids its build does not know.
 */
import type { PresenterCue } from '../contracts/net';
import { AMPLIFICATION_ON, DEFAULT_IDS, type ViewMode } from '../contracts/store';
import { gtCoupe } from '../sim-core/content/gt-coupe';
import { provingLoop } from '../sim-core/content/proving-loop';
import { doubleWishbone } from '../sim-core/content/susp-double-wishbone';
import { macpherson } from '../sim-core/content/susp-macpherson';
import { multilink } from '../sim-core/content/susp-multilink';

export interface Choice<T extends string | number = string> {
  readonly id: T;
  readonly label: string;
  /** One line under the control when selected. */
  readonly hint?: string;
}

export interface VehicleChoice extends Choice {
  readonly suspensions: readonly Choice[];
}

const carSuspensions = [macpherson, doubleWishbone, multilink];

export const VEHICLES: readonly VehicleChoice[] = [
  {
    id: gtCoupe.id,
    label: 'Car',
    hint: gtCoupe.name,
    suspensions: gtCoupe.suspensions.map((id) => {
      const s = carSuspensions.find((x) => x.id === id);
      return s ? { id, label: s.copy.short, hint: s.copy.descriptor } : { id, label: id };
    }),
  },
  {
    id: DEFAULT_IDS.motorcycle,
    label: 'Motorcycle',
    hint: 'Café racer',
    suspensions: [
      { id: 'moto-classic', label: 'Classic' },
      { id: 'moto-modern', label: 'Modern' },
      { id: 'moto-telelever', label: 'Telelever' },
    ],
  },
];

export const vehicleOf = (id: string | undefined): VehicleChoice => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0]!;

export const VIEWS: readonly Choice<ViewMode>[] = [
  { id: 'follow', label: 'Drive', hint: 'Chase camera follows the car.' },
  { id: 'explore', label: 'Inspect', hint: 'Free orbit around the moving car.' },
  { id: 'closeup', label: 'Close-up', hint: 'Suspension close-up.' },
];

export const SPEEDS: readonly Choice<number>[] = [
  { id: 1, label: 'Real time' },
  { id: 0.5, label: 'Half' },
  { id: 0.25, label: 'Quarter' },
];

export const AMPLIFY = AMPLIFICATION_ON;

export const SECTIONS: readonly Choice[] = provingLoop.segments.map((s) => ({ id: s.id, label: s.name }));

export const CAMERA_CUES: readonly Choice<PresenterCue>[] = [
  { id: 'focus-front-left', label: 'Front wheel' },
  { id: 'focus-car', label: 'Whole car' },
];

/** The ready-made audience poll for the vehicle on screen. */
export function suspensionPoll(vehicleId: string | undefined): { question: string; options: string[] } {
  return { question: 'Which suspension should we run next?', options: vehicleOf(vehicleId).suspensions.map((s) => s.label) };
}

/** Maps a poll option label back to a suspension of that vehicle (null if the poll was about something else). */
export function suspensionForOption(vehicleId: string | undefined, label: string): string | null {
  return vehicleOf(vehicleId).suspensions.find((s) => s.label === label)?.id ?? null;
}
