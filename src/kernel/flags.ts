import type { QualityTier, ResolvedFlags } from '../contracts/app';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../contracts/net';
import type { ViewMode } from '../contracts/store';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const VIEWS: readonly ViewMode[] = ['follow', 'explore', 'closeup'];
const QUALITIES: readonly QualityTier[] = ['low', 'medium', 'high'];
const ROOM_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** URL flags (ARCHITECTURE §8). Unknown params or invalid values warn and are ignored. */
export function parseFlags(search: string, warn: (msg: string) => void = console.warn): ResolvedFlags {
  const flags: Mutable<ResolvedFlags> = { features: {}, paused: false, screen: false, debug: false, e2e: false };
  const features: Record<string, boolean> = {};
  const bad = (key: string, value: string) => warn(`Ignoring ?${key}=${value}: invalid value`);
  const bool = (key: string, value: string): boolean | undefined => {
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    bad(key, value);
    return undefined;
  };
  const id = (key: string, value: string): string | undefined => (ID_RE.test(value) ? value : (bad(key, value), undefined));

  for (const [key, value] of new URLSearchParams(search)) {
    switch (key) {
      case 'features':
        for (const raw of value.split(',')) {
          const item = raw.trim();
          if (!item) continue;
          // URLSearchParams decodes a literal '+' to a space, hence the trim() above and the bare-id case.
          const on = !item.startsWith('-');
          const name = item.replace(/^[+-]/, '');
          if (ID_RE.test(name)) features[name] = on;
          else bad(key, item);
        }
        break;
      case 'vehicle':
      case 'suspension': {
        const v = id(key, value);
        if (v) flags[key] = v;
        break;
      }
      case 'view':
        if ((VIEWS as readonly string[]).includes(value)) flags.view = value as ViewMode;
        else bad(key, value);
        break;
      case 'quality':
        if ((QUALITIES as readonly string[]).includes(value)) flags.quality = value as QualityTier;
        else bad(key, value);
        break;
      case 't': {
        const t = Number(value);
        if (value !== '' && Number.isFinite(t) && t >= 0) flags.lapTime = t;
        else bad(key, value);
        break;
      }
      case 'amp': {
        const a = Number(value);
        if (value !== '' && Number.isFinite(a) && a >= 1 && a <= 10) flags.amplification = a;
        else bad(key, value);
        break;
      }
      case 'clock':
        if (value === 'live' || value === 'local') flags.clock = value;
        else bad(key, value);
        break;
      case 'room': {
        const code = value.toUpperCase();
        if (ROOM_RE.test(code)) flags.room = code;
        else bad(key, value);
        break;
      }
      case 'attract': {
        const b = bool(key, value);
        if (b !== undefined) flags.attract = b;
        break;
      }
      case 'paused':
      case 'screen':
      case 'debug':
      case 'e2e': {
        const b = bool(key, value);
        if (b !== undefined) flags[key] = b;
        break;
      }
      default:
        warn(`Ignoring unknown URL parameter ?${key}`);
    }
  }
  flags.features = features;
  return flags;
}
