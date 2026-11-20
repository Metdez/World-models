import { it } from 'vitest';
import type { AxleLinkage, CarSuspensionDefinition } from '../../../src/contracts/suspension';
import { GT_GEOMETRY } from '../../../src/sim-core/content/gt-geometry';
import { doubleWishbone } from '../../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../../src/sim-core/content/susp-multilink';
import { createCornerSolution, solveAxleKinematics } from '../../../src/sim-core/kinematics/table';
const DEFS: Record<string, CarSuspensionDefinition> = { macpherson, 'double-wishbone': doubleWishbone, multilink };
it('tierod', () => {
  const def = DEFS[process.env.TYPE!]!; const axle = process.env.AXLE as 'front' | 'rear';
  const base = def.axles[axle];
  const cost = (y: number, z: number) => {
    const p = { ...base.points, tieRodInner: [base.points.tieRodInner![0], y, z] as const };
    const l: AxleLinkage = { ...base, points: p };
    try {
      const { table } = solveAxleKinematics(l, { tyreRadius: GT_GEOMETRY[axle].tyreRadius, axle, cgHeight: 0.5, wheelbase: GT_GEOMETRY.wheelbase, brakeShare: axle === 'front' ? 0.62 : 0.38, ...(axle === 'front' ? { maxSteer: 0.35 } : {}) });
      const s = createCornerSolution(table);
      const toe = (t: number) => (table.sample(t, 0, s), s.toe);
      const t0 = toe(0); let m = 0;
      for (const t of [-0.06, -0.03, 0.03, 0.06]) m = Math.max(m, Math.abs(toe(t) - t0));
      return m;
    } catch { return Infinity; }
  };
  let y = base.points.tieRodInner![1], z = base.points.tieRodInner![2]; let best = cost(y, z); let step = 0.02;
  while (step > 1e-5) { let moved = false; for (const [dy, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) { const c = cost(y + dy*step, z + dz*step); if (c < best) { best = c; y += dy*step; z += dz*step; moved = true; break; } } if (!moved) step /= 2; }
  console.log(`TIEROD ${process.env.TYPE} ${axle}: [${base.points.tieRodInner![0]}, ${y.toFixed(4)}, ${z.toFixed(4)}] max toe dev ${(best*180/Math.PI).toFixed(4)} deg`);
}, 120000);
