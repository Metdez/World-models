/** Loading overlay progress (UI-03): bytes of manifest assets fetched, weighted against the boot finish. */
import type { AssetManifest } from '../../contracts/app';

/** Share of the bar earned by asset bytes; the rest fills when the first frame (shaders compiled) is up. */
export const ASSET_WEIGHT = 0.85;

export function weightedProgress(assetFraction: number, ready: boolean): number {
  if (ready) return 1;
  return ASSET_WEIGHT * Math.min(1, Math.max(0, Number.isFinite(assetFraction) ? assetFraction : 0));
}

/**
 * Bytes per URL path for the assets a boot may fetch. Audio is excluded (stretch feature, loaded lazily).
 * shortcut: counts every visual asset, so alternate HDRIs not used at boot keep the bar below ASSET_WEIGHT
 * until ready; replace with an 'assets:progress' emitter if a loader ever reports its own set.
 */
export function bootAssetBytes(manifest: AssetManifest): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, a] of Object.entries(manifest.assets)) if (!id.startsWith('audio/')) out.set(a.url, a.bytes);
  return out;
}

/** Fraction of `bytes` covered by the fetched URLs (absolute or path; matched by path). */
export function assetFraction(bytes: ReadonlyMap<string, number>, fetched: Iterable<string>): number {
  let total = 0;
  for (const b of bytes.values()) total += b;
  if (total === 0) return 1;
  const seen = new Set<string>();
  let done = 0;
  for (const url of fetched) {
    const path = url.startsWith('/') ? url : new URL(url).pathname;
    const b = bytes.get(path);
    if (b !== undefined && !seen.has(path)) {
      seen.add(path);
      done += b;
    }
  }
  return done / total;
}
