/** SI -> display-unit conversions and number formatting for readouts (ARCHITECTURE §4). */
import { G, RAD_TO_DEG } from '../contracts/units';

export const deg = (rad: number): number => rad * RAD_TO_DEG;
export const mm = (m: number): number => m * 1000;
export const kmh = (mps: number): number => mps * 3.6;
export const kN = (n: number): number => n / 1000;
export const gUnits = (mps2: number): number => mps2 / G;

/** Fixed-decimal readout with a true minus sign and no "-0". */
export function fmt(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const s = value.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s.replace('-', '−');
}
