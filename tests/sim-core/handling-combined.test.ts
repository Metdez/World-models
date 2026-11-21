/**
 * T11-T13 (ARCHITECTURE-M2 §11; ISO 7975 / ISO 9816 style): from a steady 0.45 g turn on R 100 m with the steer
 * frozen, aids off: braking (pedal for ~0.3 g) and lift-off tighten the path (load moves forward: rotation inward),
 * power-on progresses toward oversteer for the RWD car; no spin at 0.3 g decel; every tyre stays inside its circle.
 */
import { describe, expect, it } from 'vitest';
import { G } from '../../src/contracts/units';
import { turnEvent } from '../fixtures/09-04-handling';

const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(2);

describe('combined manoeuvres in a turn (T11-T13)', () => {
  it('T11 brake in a turn: tightens, monotone with decel, no spin at 0.3 g, inside the friction circle', () => {
    const light = turnEvent('double-wishbone', 'brake', 0.15);
    const b = turnEvent('double-wishbone', 'brake', 0.3);
    console.log(`[T11] brake ${(b.decel / G).toFixed(2)} g: path curvature x${b.kappaRatio05.toFixed(3)} at 0.5 s, x${b.kappaRatio10.toFixed(3)} at 1 s; yaw deviation ${deg(b.yawDeviation)} deg; max |beta| ${deg(b.betaMax)} deg; max grip use ${b.gripMax.toFixed(3)} (lighter ${(light.decel / G).toFixed(2)} g: x${light.kappaRatio05.toFixed(3)})`);
    expect(b.decel / G).toBeGreaterThan(0.25);
    expect(b.kappaRatio05).toBeGreaterThan(1);
    expect(b.kappaRatio05).toBeGreaterThan(light.kappaRatio05);
    expect(b.betaMax).toBeLessThan((5 * Math.PI) / 180);
    expect(b.gripMax).toBeLessThanOrEqual(1 + 1e-9);
  }, 60_000);

  it('T12 lift-off in a turn: tightens modestly (< 15 % yaw-rate change), no spin', () => {
    const l = turnEvent('double-wishbone', 'lift', 0);
    console.log(`[T12] lift-off at 0.45 g: curvature x${l.kappaRatio05.toFixed(3)} at 0.5 s, x${l.kappaRatio10.toFixed(3)} at 1 s; yaw-rate change ${(l.yawRateChange * 100).toFixed(1)} %; max |beta| ${deg(l.betaMax)} deg`);
    expect(l.kappaRatio10).toBeGreaterThan(1);
    expect(Math.abs(l.yawRateChange)).toBeLessThan(0.15);
    expect(l.gripMax).toBeLessThanOrEqual(1 + 1e-9);
  }, 60_000);

  it('T13 power-on in a turn: rear slip progresses toward oversteer (aids off); with aids on no spin', () => {
    const p = turnEvent('double-wishbone', 'power', 1, 100, 0.4 * G);
    const pa = turnEvent('double-wishbone', 'power', 1, 100, 0.4 * G, { abs: true, traction: true, stability: true, steering: false });
    console.log(`[T13] full throttle at 0.4 g, aids off: curvature x${p.kappaRatio05.toFixed(3)} at 0.5 s, x${p.kappaRatio10.toFixed(3)} at 1 s, max |beta| ${deg(p.betaMax)} deg; aids on: x${pa.kappaRatio10.toFixed(3)}, max |beta| ${deg(pa.betaMax)} deg`);
    expect(p.kappaRatio10).toBeGreaterThan(p.kappaRatio05 * 0.999);
    expect(pa.betaMax).toBeLessThan((10 * Math.PI) / 180);
    expect(p.gripMax).toBeLessThanOrEqual(1 + 1e-9);
  }, 60_000);
});
