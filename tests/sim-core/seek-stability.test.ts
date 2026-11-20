/**
 * 02-05: seek() lands on a bounded ride state at any lap time (it once returned a diverged state on the pavé: the
 * static solve's full Newton steps from a guess with a wheel off the ground overshot without bound), and that state
 * matches continuous stepping to the same time within the pre-roll's settling error.
 */
import { describe, expect, it } from 'vitest';
import type { SimCatalog } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/units';
import { createSimulation } from '../../src/sim-core/index';

const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const SEEKS = 200;

describe.each(['macpherson', 'double-wishbone', 'multilink'])('seek on the proving loop: %s', (suspensionId) => {
  it(`${SEEKS} evenly spaced seeks are bounded and match continuous stepping`, () => {
    const make = () => createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId });
    const cont = make();
    const seeker = make();
    const steps = Math.floor(cont.lapDuration / SIM_DT);
    const targets = new Set<number>();
    for (let i = 1; i < SEEKS; i++) targets.add(Math.round((i / SEEKS) * steps));
    targets.add(Math.round(0.4 * cont.lapDuration / SIM_DT)); // the pavé time that diverged
    const worst = { heave: 0, roll: 0, pitch: 0, travel: 0 };
    for (let k = 1; k < steps; k++) {
      cont.step(SIM_DT);
      if (!targets.has(k)) continue;
      const a = cont.sample(1);
      const expected = { heave: a.heave, roll: a.roll, pitch: a.pitch, travel: a.corners.map((c) => c.travel) };
      seeker.seek(k * SIM_DT);
      const b = seeker.sample(1);
      expect(b.lapTime).toBeCloseTo(a.lapTime, 6);
      // Bounded: the GT coupe's ride stays within centimetres and a few degrees; travel within the stops' reach.
      expect(Math.abs(b.heave), `heave @${b.lapTime}`).toBeLessThan(0.1);
      expect(Math.abs(b.roll), `roll @${b.lapTime}`).toBeLessThan(0.1);
      expect(Math.abs(b.pitch), `pitch @${b.lapTime}`).toBeLessThan(0.1);
      for (const c of b.corners) expect(Math.abs(c.travel), `travel @${b.lapTime}`).toBeLessThan(0.1);
      worst.heave = Math.max(worst.heave, Math.abs(b.heave - expected.heave));
      worst.roll = Math.max(worst.roll, Math.abs(b.roll - expected.roll));
      worst.pitch = Math.max(worst.pitch, Math.abs(b.pitch - expected.pitch));
      for (let i = 0; i < 4; i++) worst.travel = Math.max(worst.travel, Math.abs(b.corners[i]!.travel - expected.travel[i]!));
    }
    console.info(
      `  ${suspensionId}: seek vs continuous, worst |diff| heave ${(worst.heave * 1000).toFixed(2)} mm, roll ${(worst.roll * 1000).toFixed(2)} mrad, ` +
        `pitch ${(worst.pitch * 1000).toFixed(2)} mrad, travel ${(worst.travel * 1000).toFixed(2)} mm`,
    );
    // The 1.5 s pre-roll forgets the start state to within a fraction of a millimetre (body modes ~1.5 Hz, damped).
    expect(worst.heave).toBeLessThan(0.001);
    expect(worst.travel).toBeLessThan(0.0015);
    expect(worst.roll).toBeLessThan(0.002);
    expect(worst.pitch).toBeLessThan(0.001);
  }, 60_000);
});
