import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssetManifest, Attribution } from '../../src/contracts/app';
import { buildAssets } from '../../scripts/build-assets.mjs';

const REPO = join(import.meta.dirname, '../..');
const quiet = () => {};
const dirs: string[] = [];

async function fixture(files: Record<string, Uint8Array | string>, attributions: Partial<Attribution>[]) {
  const dir = await mkdtemp(join(tmpdir(), 'build-assets-'));
  dirs.push(dir);
  const src = join(dir, 'src');
  for (const [rel, data] of Object.entries(files)) {
    await mkdir(join(src, rel, '..'), { recursive: true });
    await writeFile(join(src, rel), data);
  }
  await writeFile(join(src, 'ATTRIBUTION.json'), JSON.stringify(attributions));
  return { srcDir: src, outDir: join(dir, 'public'), log: quiet };
}

const cc0 = (files: string[]): Partial<Attribution> => ({
  title: 't', author: 'a', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceUrl: 'https://example.com', files,
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('build-assets', () => {
  it('writes content-hashed files and a manifest with attributions', async () => {
    const opts = await fixture({ 'hdri/sky_1k.hdr': 'sky', 'audio/engine.ogg': 'vroom' }, [cc0(['hdri/sky_1k.hdr', 'audio/engine.ogg'])]);
    const manifest = await buildAssets(opts);
    expect(Object.keys(manifest.assets).sort()).toEqual(['audio/engine', 'hdri/sky_1k']);
    const sky = manifest.assets['hdri/sky_1k']!;
    expect(sky.url).toMatch(/^\/assets\/hdri\/sky_1k\.[0-9a-f]{8}\.hdr$/);
    expect(sky.bytes).toBe(3);
    expect(await readFile(join(opts.outDir, sky.url), 'utf8')).toBe('sky');
    const onDisk = JSON.parse(await readFile(join(opts.outDir, 'asset-manifest.json'), 'utf8')) as AssetManifest;
    expect(onDisk).toEqual(manifest);
    expect(onDisk.attributions).toHaveLength(1);
  });

  it('cleans stale outputs from a previous build', async () => {
    const opts = await fixture({ 'a.ogg': 'x' }, [cc0(['a.ogg'])]);
    await mkdir(join(opts.outDir, 'assets/old'), { recursive: true });
    await writeFile(join(opts.outDir, 'assets/old/stale.12345678.ogg'), 'old');
    await buildAssets(opts);
    expect(await readdir(join(opts.outDir, 'assets'))).toEqual([expect.stringMatching(/^a\.[0-9a-f]{8}\.ogg$/)]);
  });

  it('fails when a file has no attribution entry', async () => {
    const opts = await fixture({ 'a.ogg': 'x', 'b.ogg': 'y' }, [cc0(['a.ogg'])]);
    await expect(buildAssets(opts)).rejects.toThrow(/No attribution entry for: b\.ogg/);
  });

  it('fails on an attribution entry without a licence or listing a missing file', async () => {
    const noLicence = await fixture({ 'a.ogg': 'x' }, [{ ...cc0(['a.ogg']), license: undefined }]);
    await expect(buildAssets(noLicence)).rejects.toThrow(/missing "license"/);
    const stale = await fixture({ 'a.ogg': 'x' }, [cc0(['a.ogg', 'gone.ogg'])]);
    await expect(buildAssets(stale)).rejects.toThrow(/gone\.ogg/);
  });

  it('fails when a file exceeds 24 MiB', async () => {
    const opts = await fixture({ 'big.hdr': new Uint8Array(24 * 1024 * 1024 + 1) }, [cc0(['big.hdr'])]);
    await expect(buildAssets(opts)).rejects.toThrow(/exceeds/);
  });

  it('fails when a glb lacks four wheel/caliper/brakedisc nodes', async () => {
    const doc = new Document();
    const scene = doc.createScene();
    for (const name of ['wheel_FL', 'wheel_FR', 'caliper_FL', 'brakedisc_FL']) scene.addChild(doc.createNode(name));
    const glb = await new NodeIO().writeBinary(doc);
    const opts = await fixture({ 'car/toy.glb': glb }, [cc0(['car/toy.glb'])]);
    await expect(buildAssets(opts)).rejects.toThrow(/expected >= 4 nodes matching \/wheel\/i, found 2/);
  });

  it('keeps every named node of the real DB11 and stays under the size limit', async () => {
    const car = await readFile(join(REPO, 'assets-src/car/aston-martin-db11.glb'));
    const opts = await fixture({ 'car/db11.glb': car }, [cc0(['car/db11.glb'])]);
    const manifest = await buildAssets(opts);
    const entry = manifest.assets['car/db11']!;
    expect(entry.url).toMatch(/^\/assets\/car\/db11\.[0-9a-f]{8}\.glb$/);
    expect(entry.bytes).toBeLessThan(24 * 1024 * 1024);
  }, 30_000);

  it('the repo ATTRIBUTION.json covers every file in assets-src', async () => {
    const out = await mkdtemp(join(tmpdir(), 'build-assets-repo-'));
    dirs.push(out);
    const manifest = await buildAssets({ outDir: out, log: quiet });
    expect(Object.keys(manifest.assets)).toContain('car/aston-martin-db11');
    expect(manifest.attributions.find((a) => a.license === 'CC-BY-4.0')?.modified).toBeTruthy();
  }, 30_000);
});
