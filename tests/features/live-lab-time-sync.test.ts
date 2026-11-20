import { describe, expect, it } from 'vitest';
import { sampleFrom, TimeSync } from '../../src/features/live-lab/time-sync';

/**
 * Simulated probes against a server whose clock is `trueOffset` ms ahead of ours, with asymmetric jitter.
 * Returns the sample the client would compute.
 */
function probe(trueOffset: number, wallAtSend: number, upMs: number, downMs: number) {
  const c0 = 1000; // performance.now() at send (arbitrary base)
  const s1 = wallAtSend + upMs + trueOffset; // server stamps on arrival
  const c2 = c0 + upMs + downMs;
  const wall2 = wallAtSend + upMs + downMs;
  return sampleFrom(c0, s1, c2, wall2)!;
}

describe('sampleFrom', () => {
  it('recovers the exact offset for a symmetric round trip', () => {
    expect(probe(250, 1e12, 20, 20)).toEqual({ rtt: 40, offset: 250 });
    expect(probe(-3000, 1e12, 5, 5).offset).toBe(-3000);
  });

  it('error is bounded by half the asymmetry', () => {
    const s = probe(100, 1e12, 30, 10);
    expect(s.rtt).toBe(40);
    expect(Math.abs(s.offset - 100)).toBeLessThanOrEqual(10);
  });

  it('rejects negative round trips and non-finite server stamps', () => {
    expect(sampleFrom(10, 5, 9, 0)).toBeNull();
    expect(sampleFrom(0, Number.NaN, 9, 0)).toBeNull();
  });
});

describe('TimeSync', () => {
  it('first fix jumps to the min-RTT estimate', () => {
    const sync = new TimeSync();
    expect(sync.add({ rtt: 80, offset: 500 })).toBe(500);
    expect(sync.add({ rtt: 20, offset: 520 })).toBe(510);
    expect(sync.bestRtt).toBe(20);
  });

  it('after the first fix it slews at most 5 ms per sample', () => {
    const sync = new TimeSync();
    for (let i = 0; i < 3; i++) sync.add({ rtt: 30, offset: 0 });
    expect(sync.offset).toBe(0);
    for (let i = 0; i < 16; i++) sync.add({ rtt: 10, offset: 40 });
    expect(sync.offset).toBe(40);
    const before = sync.offset;
    sync.add({ rtt: 1, offset: 200 });
    expect(sync.offset - before).toBe(5);
  });

  it('prefers the 3 lowest-RTT samples of the last 16 (outliers with high RTT are ignored)', () => {
    const sync = new TimeSync();
    for (let i = 0; i < 3; i++) sync.add({ rtt: 15, offset: 100 });
    for (let i = 0; i < 10; i++) sync.add({ rtt: 400, offset: 900 });
    expect(sync.offset).toBe(100);
  });

  it('a local clock step of more than 1 s is applied at once', () => {
    const sync = new TimeSync();
    for (let i = 0; i < 4; i++) sync.add({ rtt: 10, offset: 0 });
    for (let i = 0; i < 16; i++) sync.add({ rtt: 10, offset: 3600_000 });
    expect(sync.offset).toBe(3600_000);
  });

  it('converges within one probe burst for realistic jitter (lap-time error well below 0.15 s)', () => {
    const sync = new TimeSync();
    const jitter = [12, 45, 8, 30, 9, 60, 7, 25];
    for (const [i, up] of jitter.entries()) sync.add(probe(1234, 1e12 + i * 150, up, jitter[(i + 3) % jitter.length]!));
    expect(Math.abs(sync.offset - 1234)).toBeLessThan(30);
  });
});
