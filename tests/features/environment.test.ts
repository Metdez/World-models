import { readFileSync } from 'node:fs';
import { DataUtils, HalfFloatType } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { describe, expect, it } from 'vitest';
import { clampHdr, equirectDirection, snapToTexel } from '../../src/features/environment/hdri';

function loadHdr(file: string) {
  const buf = readFileSync(new URL(`../../assets-src/hdri/${file}`, import.meta.url));
  const loader = new HDRLoader().setDataType(HalfFloatType);
  const r = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return { width: r.width ?? 0, height: r.height ?? 0, data: r.data as Uint16Array };
}

function maxValue(data: Uint16Array): number {
  let m = 0;
  for (let i = 0; i < data.length; i += 4) m = Math.max(m, data[i]!, data[i + 1]!, data[i + 2]!);
  return DataUtils.fromHalfFloat(m);
}

describe('environment HDRI clamp', () => {
  it('clamps the airfield sun and recovers a low sun above the horizon', () => {
    const { width, height, data } = loadHdr('derelict_airfield_01_1k.hdr');
    expect(maxValue(data)).toBeGreaterThan(10_000);
    const hdr = clampHdr(data, width, height, 48);
    expect(maxValue(data)).toBeLessThanOrEqual(48);
    const [x, y, z] = hdr.sunDirection;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    // Sun sits ~18 deg above the horizon in this HDRI (brightest pixel row 204 of 512).
    expect(Math.asin(y) * (180 / Math.PI)).toBeGreaterThan(14);
    expect(Math.asin(y) * (180 / Math.PI)).toBeLessThan(22);
    expect(hdr.sunIrradiance).toBeGreaterThan(1);
    expect(Math.max(...hdr.sunColor)).toBeCloseTo(1, 6);
    // Warm-ish white sun, bright blue-white horizon haze.
    expect(hdr.sunColor[0]).toBeGreaterThanOrEqual(hdr.sunColor[2]);
    expect(hdr.horizon.every((c) => c > 0.3 && c < 5)).toBe(true);
  });

  it('leaves values under the clamp untouched and falls back to the brightest pixel', () => {
    const width = 8;
    const height = 4;
    const data = new Uint16Array(width * height * 4).fill(DataUtils.toHalfFloat(0.5));
    const hot = (1 * width + 2) * 4;
    data[hot] = data[hot + 1] = data[hot + 2] = DataUtils.toHalfFloat(4);
    const before = data.slice();
    const hdr = clampHdr(data, width, height, 16);
    expect(data).toEqual(before);
    expect(hdr.sunIrradiance).toBe(0);
    const expected = equirectDirection(2.5 / width, 1 - 1.5 / height, [0, 0, 0]);
    hdr.sunDirection.forEach((c, i) => expect(c).toBeCloseTo(expected[i]!, 9));
  });

  it('equirectDirection matches three.js equirectUv (u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5)', () => {
    for (const [u, v] of [[0.1, 0.2], [0.6, 0.6], [0.9, 0.45]] as const) {
      const [x, y, z] = equirectDirection(u, v, [0, 0, 0]);
      expect(Math.atan2(z, x) / (2 * Math.PI) + 0.5).toBeCloseTo(u, 9);
      expect(Math.asin(y) / Math.PI + 0.5).toBeCloseTo(v, 9);
    }
  });
});

describe('shadow texel snap', () => {
  const right = { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const forward = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 };
  const dot = (a: typeof right, b: typeof right) => a.x * b.x + a.y * b.y + a.z * b.z;

  it('quantises the image-plane coordinates to whole texels and keeps depth', () => {
    const texel = 24 / 2048;
    const out = { x: 0, y: 0, z: 0 };
    for (const c of [{ x: 3.21, y: 0.4, z: -17.9 }, { x: -250.03, y: 1.2, z: 88.88 }]) {
      snapToTexel(c, right, up, forward, texel, out);
      expect(Math.abs(dot(out, right) / texel - Math.round(dot(out, right) / texel))).toBeLessThan(1e-6);
      expect(Math.abs(dot(out, up) / texel - Math.round(dot(out, up) / texel))).toBeLessThan(1e-6);
      expect(dot(out, forward)).toBeCloseTo(dot(c, forward), 9);
      expect(Math.hypot(out.x - c.x, out.y - c.y, out.z - c.z)).toBeLessThanOrEqual(texel);
    }
  });

  it('moves the box only in whole-texel steps as the car creeps forward', () => {
    const texel = 0.05;
    const out = { x: 0, y: 0, z: 0 };
    const seen = new Set<string>();
    for (let s = 0; s < 0.2; s += 0.001) {
      snapToTexel({ x: s, y: 0, z: 0 }, right, up, forward, texel, out);
      seen.add(out.x.toFixed(9));
    }
    expect(seen.size).toBe(5); // 0, 0.05, 0.1, 0.15, 0.2
  });
});
