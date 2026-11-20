/** Loading overlay progress (UI-03): bytes of manifest assets fetched, weighted against the boot finish. */
import type { AssetManifest } from '../../contracts/app';

/** Share of the bar earned by asset bytes; the rest fills when the first frame (shaders compiled) is up. */
export const ASSET_WEIGHT = 0.85;

export function weightedProgress(assetFraction: number, ready: boolean): number {
  if (ready) return 1;
  return ASSET_WEIGHT * Math.min(1, Math.max(0, Number.isFinite(assetFraction) ? assetFraction : 0));
}

/**
 * Asset-id prefixes whose members are alternates: a boot fetches exactly one of them (the environment loads the
 * look for the starting view; the others stream in after app:ready). The group counts once, as its largest member.
 */
const ALTERNATES = ['hdri/'] as const;

/** Bytes a boot fetches: one slot per asset, one slot per alternates group. Audio is excluded (loaded lazily). */
export interface BootAssets {
  /** URL path -> slot. */
  readonly slotOf: ReadonlyMap<string, string>;
  /** slot -> bytes. */
  readonly bytes: ReadonlyMap<string, number>;
}

export function bootAssetBytes(manifest: AssetManifest): BootAssets {
  const slotOf = new Map<string, string>();
  const bytes = new Map<string, number>();
  for (const [id, a] of Object.entries(manifest.assets)) {
    if (id.startsWith('audio/')) continue;
    const slot = ALTERNATES.find((p) => id.startsWith(p)) ?? id;
    slotOf.set(a.url, slot);
    bytes.set(slot, Math.max(bytes.get(slot) ?? 0, a.bytes));
  }
  return { slotOf, bytes };
}

/** Fraction of the boot bytes covered by the fetched URLs (absolute or path; matched by path). */
export function assetFraction(boot: BootAssets, fetched: Iterable<string>): number {
  let total = 0;
  for (const b of boot.bytes.values()) total += b;
  if (total === 0) return 1;
  const seen = new Set<string>();
  let done = 0;
  for (const url of fetched) {
    const slot = boot.slotOf.get(url.startsWith('/') ? url : new URL(url).pathname);
    if (slot !== undefined && !seen.has(slot)) {
      seen.add(slot);
      done += boot.bytes.get(slot)!;
    }
  }
  return done / total;
}
