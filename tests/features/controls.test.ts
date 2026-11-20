import { describe, expect, it } from 'vitest';
import type { AssetManifest } from '../../src/contracts/app';
import { AMPLIFICATION_ON, initialState } from '../../src/contracts/store';
import { amplificationText, keyAction, LIVE_PATCH, SLOW_MO } from '../../src/features/controls/keys';
import { ASSET_WEIGHT, assetFraction, bootAssetBytes, weightedProgress } from '../../src/features/controls/loading';

const car = { suspensions: ['macpherson', 'double-wishbone', 'multilink'], otherVehicleId: 'cafe-racer' };
const moto = { suspensions: ['moto-classic', 'moto-modern'], otherVehicleId: null };

describe('keyAction (UI-01 keyboard map)', () => {
  const s = initialState();

  it('1/2/3 pick the vehicle’s suspensions in UI order; missing digits do nothing', () => {
    expect(keyAction('1', s, car)).toEqual({ suspensionId: 'macpherson' });
    expect(keyAction('3', s, car)).toEqual({ suspensionId: 'multilink' });
    expect(keyAction('2', s, moto)).toEqual({ suspensionId: 'moto-modern' });
    expect(keyAction('3', s, moto)).toBeNull(); // two-corner vehicle with two presets
    expect(keyAction('0', s, car)).toBeNull();
  });

  it('F/E/C set the view, case-insensitive', () => {
    expect(keyAction('f', s, car)).toEqual({ view: 'follow' });
    expect(keyAction('E', s, car)).toEqual({ view: 'explore' });
    expect(keyAction('c', s, car)).toEqual({ view: 'closeup' });
  });

  it('toggles: X x-ray, Space pause, S slow motion, A amplification, H HUD', () => {
    expect(keyAction('x', s, car)).toEqual({ xray: true });
    expect(keyAction('x', { ...s, xray: true }, car)).toEqual({ xray: false });
    expect(keyAction(' ', s, car)).toEqual({ paused: true });
    expect(keyAction('s', s, car)).toEqual({ timeScale: SLOW_MO });
    expect(keyAction('S', { ...s, timeScale: SLOW_MO }, car)).toEqual({ timeScale: 1 });
    expect(keyAction('a', s, car)).toEqual({ amplification: AMPLIFICATION_ON });
    expect(keyAction('a', { ...s, amplification: AMPLIFICATION_ON }, car)).toEqual({ amplification: 1 });
    expect(keyAction('h', s, car)).toEqual({ hudVisible: false });
  });

  it('V swaps vehicle class only when another class exists', () => {
    expect(keyAction('v', s, car)).toEqual({ vehicleId: 'cafe-racer' });
    expect(keyAction('v', s, moto)).toBeNull();
  });

  it('? and Escape are UI commands; other keys are ignored', () => {
    expect(keyAction('?', s, car)).toBe('help');
    expect(keyAction('Escape', s, car)).toBe('escape');
    expect(keyAction('q', s, car)).toBeNull();
    expect(keyAction('Enter', s, car)).toBeNull();
  });

  it('Live rejoins the shared clock at real time', () => {
    expect(LIVE_PATCH).toEqual({ paused: false, timeScale: 1, clock: 'live' });
  });

  it('the amplification chip states the factor and that values stay true scale', () => {
    expect(amplificationText(AMPLIFICATION_ON)).toBe('Motion ×2.5 · values true scale');
  });
});

describe('loading progress (UI-03)', () => {
  const manifest: AssetManifest = {
    version: 1,
    assets: {
      'car/db11': { id: 'car/db11', url: '/assets/car/db11.aa.glb', bytes: 600 },
      'hdri/a': { id: 'hdri/a', url: '/assets/hdri/a.bb.hdr', bytes: 400 },
      'audio/engine': { id: 'audio/engine', url: '/assets/audio/engine.cc.ogg', bytes: 1000 },
    },
    attributions: [],
  };
  const bytes = bootAssetBytes(manifest);

  it('weights fetched asset bytes, ignores audio, other URLs and duplicates', () => {
    expect([...bytes.keys()]).toEqual(['/assets/car/db11.aa.glb', '/assets/hdri/a.bb.hdr']);
    expect(assetFraction(bytes, [])).toBe(0);
    expect(assetFraction(bytes, ['http://localhost:4173/assets/car/db11.aa.glb', 'http://x/main.js'])).toBeCloseTo(0.6);
    expect(assetFraction(bytes, ['/assets/hdri/a.bb.hdr', '/assets/hdri/a.bb.hdr', 'https://h/assets/audio/engine.cc.ogg'])).toBeCloseTo(0.4);
    expect(assetFraction(new Map(), [])).toBe(1);
  });

  it('assets fill at most ASSET_WEIGHT; only the first rendered frame completes the bar', () => {
    expect(weightedProgress(0, false)).toBe(0);
    expect(weightedProgress(0.5, false)).toBeCloseTo(ASSET_WEIGHT / 2);
    expect(weightedProgress(2, false)).toBe(ASSET_WEIGHT);
    expect(weightedProgress(Number.NaN, false)).toBe(0);
    expect(weightedProgress(0.1, true)).toBe(1);
  });
});
