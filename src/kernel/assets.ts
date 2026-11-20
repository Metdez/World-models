import type { AssetManifest, Assets } from '../contracts/app';

export const EMPTY_MANIFEST: AssetManifest = { version: 1, assets: {}, attributions: [] };

export async function fetchManifest(): Promise<AssetManifest> {
  const res = await fetch('/asset-manifest.json');
  if (!res.ok) throw new Error(`asset-manifest.json: HTTP ${res.status}`);
  const manifest = (await res.json()) as AssetManifest;
  if (manifest.version !== 1) throw new Error(`asset-manifest.json: unsupported version ${String(manifest.version)}`);
  return manifest;
}

export function createAssets(manifest: AssetManifest): Assets {
  return {
    manifest,
    url(id) {
      const entry = manifest.assets[id];
      if (!entry) throw new Error(`Unknown asset "${id}"`);
      return entry.url;
    },
  };
}
