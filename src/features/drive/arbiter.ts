/**
 * Source arbitration (contracts/services.ts DriveService): every frame each source writes its intent; the most recent
 * deliberate input wins, with 1 s hysteresis before another source can take over from a still-active one. `fresh` is a
 * rising edge of deliberate input while armed: the only thing that may take the wheel (a held key never flickers modes).
 * After a hand-back the arbiter is disarmed until every source is neutral again. Pure; no DOM.
 */
import { neutralIntent, type DriveIntent, type DriveSource } from '../../contracts/drive';
import type { DriveIntentSource } from '../../contracts/services';

export const HYSTERESIS_S = 1;

interface Slot {
  readonly source: DriveIntentSource;
  readonly intent: DriveIntent;
  deliberate: boolean;
  lastDeliberate: number;
}

export interface ArbiterResult {
  /** A source showed a new deliberate input this update (and the arbiter is armed). */
  fresh: boolean;
  /** Any source shows deliberate input. */
  deliberate: boolean;
}

export interface Arbiter {
  add(source: DriveIntentSource): () => void;
  readonly active: DriveSource | null;
  /** Reads every source at time `now` (s) and writes the winning intent (neutral if none) into `out`. */
  update(now: number, out: DriveIntent): ArbiterResult;
  /** Called on hand-back: no takeover until all sources return to neutral. */
  disarm(): void;
  readonly armed: boolean;
}

function copy(from: Readonly<DriveIntent>, to: DriveIntent): void {
  to.steer = from.steer;
  to.throttle = from.throttle;
  to.brake = from.brake;
  to.handbrake = from.handbrake;
  to.digital = from.digital;
  to.source = from.source;
}

export function createArbiter(): Arbiter {
  const slots: Slot[] = [];
  let active: Slot | null = null;
  let armed = true;
  const result: ArbiterResult = { fresh: false, deliberate: false };
  const neutral = neutralIntent();

  return {
    add(source) {
      const slot: Slot = { source, intent: neutralIntent(source.id), deliberate: false, lastDeliberate: -Infinity };
      slots.push(slot);
      return () => {
        const i = slots.indexOf(slot);
        if (i >= 0) slots.splice(i, 1);
        if (active === slot) active = null;
      };
    },
    get active() {
      return active?.source.id ?? null;
    },
    get armed() {
      return armed;
    },
    update(now, out) {
      result.fresh = false;
      result.deliberate = false;
      for (const slot of slots) {
        const was = slot.deliberate;
        slot.deliberate = slot.source.read(slot.intent);
        if (!slot.deliberate) continue;
        result.deliberate = true;
        if (!was && armed) result.fresh = true;
        if (active === null || (active !== slot && !active.deliberate && now - active.lastDeliberate >= HYSTERESIS_S)) active = slot;
        slot.lastDeliberate = now;
      }
      if (!result.deliberate) armed = true;
      copy(active?.deliberate ? active.intent : neutral, out);
      out.source = active?.source.id ?? 'keyboard';
      return result;
    },
    disarm() {
      armed = false;
    },
  };
}
