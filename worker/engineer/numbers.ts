/**
 * Number grounding (ARCHITECTURE §12.5 step 6): every number in the answer must come from the telemetry payload,
 * equal after rounding to 0, 1 or 2 decimals or within 5 %. An explicit sign must match; an unsigned number may
 * match the magnitude ("rolls 1.26 degrees" for roll_deg -1.26).
 */

// Thousands separators ("6,100") or plain decimals; an optional leading sign (ASCII or U+2212 minus).
const NUMBER = /([-+−]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;

export interface QuotedNumber {
  readonly value: number;
  readonly signed: boolean;
  readonly decimals: number;
}

export function numbersInText(text: string): QuotedNumber[] {
  const out: QuotedNumber[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const [, sign = '', digits = ''] = m;
    const clean = digits.replace(/,/g, '');
    const v = Number(clean);
    out.push({ value: sign === '' || sign === '+' ? v : -v, signed: sign !== '', decimals: (clean.split('.')[1] ?? '').length });
  }
  return out;
}

/** Every number in the payload, plus digits in its keys (e.g. a derived key "..._per_10mm"). */
export function payloadNumbers(payload: unknown, out: number[] = []): number[] {
  if (typeof payload === 'number' && Number.isFinite(payload)) out.push(payload);
  else if (Array.isArray(payload)) for (const v of payload) payloadNumbers(v, out);
  else if (typeof payload === 'object' && payload !== null) {
    for (const [k, v] of Object.entries(payload)) {
      for (const q of numbersInText(k)) out.push(q.value);
      payloadNumbers(v, out);
    }
  }
  return out;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function matches(q: QuotedNumber, v: number): boolean {
  const target = q.signed ? v : Math.abs(v);
  const x = q.signed ? q.value : Math.abs(q.value);
  if (x === target) return true;
  if (q.decimals <= 2 && round(target, q.decimals) === x) return true;
  return target !== 0 && Math.abs(x - target) <= 0.05 * Math.abs(target);
}

/** Numbers quoted in `text` that no payload value supports (empty = grounded). */
export function ungroundedNumbers(text: string, payload: unknown): number[] {
  const allowed = payloadNumbers(payload);
  return numbersInText(text)
    .filter((q) => !allowed.some((v) => matches(q, v)))
    .map((q) => q.value);
}
