import { it } from 'vitest';
import type { AxleLinkage, CarSuspensionDefinition } from '../../../src/contracts/suspension';
import { RAD_TO_DEG } from '../../../src/contracts/units';
import { GT_GEOMETRY } from '../../../src/sim-core/content/gt-geometry';
import { doubleWishbone } from '../../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../../src/sim-core/content/susp-multilink';
import { createCornerSolution, solveAxleKinematics } from '../../../src/sim-core/kinematics/table';
const DEFS: Record<string, CarSuspensionDefinition> = { macpherson, 'double-wishbone': doubleWishbone, multilink };
const solve = (l: AxleLinkage, axle: 'front' | 'rear') => solveAxleKinematics(l, { tyreRadius: GT_GEOMETRY[axle].tyreRadius, axle, cgHeight: 0.5, wheelbase: GT_GEOMETRY.wheelbase, brakeShare: axle === 'front' ? 0.62 : 0.38, ...(axle === 'front' ? { maxSteer: 0.35 } : {}) });
function tieRod(l: AxleLinkage, axle: 'front' | 'rear'): AxleLinkage {
  const cost = (y: number, z: number) => { try { const ll = { ...l, points: { ...l.points, tieRodInner: [l.points.tieRodInner![0], y, z] as const } }; const { table } = solve(ll, axle); const s = createCornerSolution(table); const toe = (t: number) => (table.sample(t, 0, s), s.toe); const t0 = toe(0); let m = 0; for (const t of [-0.07, -0.05, -0.03, 0.03, 0.05, 0.07]) m = Math.max(m, Math.abs(toe(t) - t0)); return m; } catch { return Infinity; } };
  let y = l.points.tieRodInner![1], z = l.points.tieRodInner![2]; let best = cost(y, z); let step = 0.02;
  while (step > 1e-5) { let bd: number[] | null = null; for (const [dy, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) { const c = cost(y + dy!*step, z + dz!*step); if (c < best) { best = c; bd = [dy!, dz!]; } } if (bd) { y += bd[0]!*step; z += bd[1]!*step; } else step /= 2; }
  return { ...l, points: { ...l.points, tieRodInner: [l.points.tieRodInner![0], +y.toFixed(4), +z.toFixed(4)] as const } };
}
it('variant', () => {
  const variants = JSON.parse(process.env.V!) as { type: string; axle: 'front' | 'rear'; label?: string; pts: Record<string, [number, number, number]> }[];
  for (const v of variants) {
    let l: AxleLinkage = { ...DEFS[v.type]!.axles[v.axle], points: { ...DEFS[v.type]!.axles[v.axle].points, ...v.pts } };
    if (process.env.TR) l = tieRod(l, v.axle);
    try {
      const { table, kinematics } = solve(l, v.axle); const s = kinematics.summary;
      const c = createCornerSolution(table); const at = (t: number) => (table.sample(t, 0, c), c.toe);
      console.log(`VAR ${v.label ?? ''} ${v.type}/${v.axle}: gain ${(s.camberGain * RAD_TO_DEG * 0.01).toFixed(3)} rollC ${s.rollCamber.toFixed(2)} RC ${(s.rollCentreHeight*1000).toFixed(1)} bs ${(s.bumpSteer*RAD_TO_DEG*0.01).toFixed(3)} toe70 ${((at(0.07)-at(0))*RAD_TO_DEG).toFixed(3)} KPI ${(s.kingpinInclination*RAD_TO_DEG).toFixed(2)} caster ${(s.caster*RAD_TO_DEG).toFixed(2)} scrub ${(s.scrubRadius*1000).toFixed(1)} trail ${(s.trail*1000).toFixed(1)} MR ${s.motionRatio.toFixed(3)} anti ${(s.antiPitch*100).toFixed(1)} rack ${(table.rackRange[1]*1000).toFixed(0)} TR ${JSON.stringify(l.points.tieRodInner)}`);
    } catch (e) { console.log(`VAR ${v.label} FAIL ${(e as Error).message}`); }
  }
}, 300000);
