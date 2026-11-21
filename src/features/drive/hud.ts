/**
 * Handling HUD logic (plan 09-05; ARCHITECTURE-M2 §10.2, §10.5, §13): the four aid switches ("Assist: simplified
 * model", never a manufacturer system), the Assists button summary, and the intervention lamps + Approximate badge read
 * from `frame.drive`. Pure: the pill in index.ts renders it.
 */
import type { DriveAids, DriveFrame } from '../../contracts/drive';

export const AID_KEYS = ['abs', 'traction', 'stability', 'steering'] as const satisfies readonly (keyof DriveAids)[];
export type AidKey = (typeof AID_KEYS)[number];

/** Switch label and one plain line on what it does (copy: no digits, no brand names). */
export const AID_COPY: Readonly<Record<AidKey, { readonly name: string; readonly hint: string }>> = {
  abs: { name: 'Anti-lock brakes', hint: 'Eases brake pressure before a wheel locks' },
  traction: { name: 'Traction control', hint: 'Trims throttle when the driven wheels spin' },
  stability: { name: 'Stability control', hint: 'Brakes one wheel to hold the line' },
  steering: { name: 'Steering help', hint: 'Limits lock with speed and helps you catch a slide' },
};

export function withAid(aids: DriveAids, key: AidKey, on: boolean): DriveAids {
  return { ...aids, [key]: on };
}

/** Visible tag next to "Assists" ('' = all on) and the button's accessible name. */
export function aidsSummary(aids: DriveAids): { readonly tag: string; readonly label: string } {
  const off = AID_KEYS.filter((k) => !aids[k]);
  if (off.length === 0) return { tag: '', label: 'Assists: all on. Assist: simplified model' };
  const tag = off.length === AID_KEYS.length ? 'Off' : 'Some off';
  return { tag, label: `Assists: ${off.map((k) => AID_COPY[k].name).join(', ')} off. Assist: simplified model` };
}

/** Lamps in pill order: three aid interventions, then the honesty badge. */
export const LAMPS = ['abs', 'traction', 'stability', 'approximate'] as const;
export type LampId = (typeof LAMPS)[number];
export const LAMP_TEXT: Readonly<Record<LampId, string>> = { abs: 'ABS', traction: 'Traction', stability: 'Stability', approximate: 'Approximate' };
export const LAMP_TITLE: Readonly<Record<LampId, string>> = {
  abs: 'Anti-lock brakes intervening (Assist: simplified model)',
  traction: 'Traction control intervening (Assist: simplified model)',
  stability: 'Stability control intervening (Assist: simplified model)',
  approximate: 'Past the range this model is validated for: what you see is approximate',
};

const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Inline icons (decoration only: the text beside each one carries the meaning). */
export const HUD_ICON: Readonly<Record<LampId | 'assists', string>> = {
  abs: svg('<circle cx="10" cy="10" r="4.5"/><path d="M4.5 5a7.5 7.5 0 0 0 0 10M15.5 5a7.5 7.5 0 0 1 0 10"/>'),
  traction: svg('<circle cx="10" cy="8" r="4.5"/><path d="M3.5 16c2-1.6 3.5 1.6 5.5 0s3.5 1.6 5.5 0 2-.8 2-.8"/>'),
  stability: svg('<path d="M6 17c0-5 8-4 8-10"/><path d="M11 6l3-3 3 3"/>'),
  approximate: svg('<path d="M4 8.5c2-2 4 1.5 6 0s4-2 6 0M4 13.5c2-2 4 1.5 6 0s4-2 6 0"/>'),
  assists: svg('<path d="M3.5 6.5h13M3.5 13.5h13"/><circle cx="7.5" cy="6.5" r="2" fill="currentColor"/><circle cx="12.5" cy="13.5" r="2" fill="currentColor"/>'),
};

/** A lamp stays lit this long after its flag drops, so a pulsing aid reads as one steady lamp. */
export const LAMP_HOLD_S = 0.6;

type LampFlags = Pick<DriveFrame, 'absActive' | 'tractionActive' | 'stabilityActive' | 'approximate'>;
const FLAG: Readonly<Record<LampId, keyof LampFlags>> = { abs: 'absActive', traction: 'tractionActive', stability: 'stabilityActive', approximate: 'approximate' };

/**
 * Advances the per-lamp hold timers (`hold[i]` seconds left, in LAMPS order) by `dt` and returns a bit mask of lit
 * lamps (bit i = LAMPS[i]). Not driving: everything off at once.
 */
export function updateLamps(d: LampFlags, driving: boolean, dt: number, hold: Float64Array): number {
  let mask = 0;
  for (let i = 0; i < LAMPS.length; i++) {
    hold[i] = !driving ? 0 : d[FLAG[LAMPS[i]!]] ? LAMP_HOLD_S : Math.max(0, hold[i]! - dt);
    if (hold[i]! > 0) mask |= 1 << i;
  }
  return mask;
}
