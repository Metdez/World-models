// STUB — owner: plan 01-03 (ARCHITECTURE §11). Writes an empty asset manifest so builds and the kernel boot.
import { mkdir, rm, writeFile } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);
await rm(new URL('assets/', publicDir), { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
/** @type {import('../src/contracts/app').AssetManifest} */
const manifest = { version: 1, assets: {}, attributions: [] };
await writeFile(new URL('asset-manifest.json', publicDir), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('build-assets (stub): wrote public/asset-manifest.json with 0 assets');
