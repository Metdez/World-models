/**
 * GT geometry is measured from the hero mesh, not typed in: wheel positions and tyre size from the tyre-mesh
 * bounding boxes of assets-src/car/aston-martin-db11.glb (glTF: Y up, forward +Z, left +X) must match
 * src/sim-core/content/gt-geometry.ts within 5 mm (ARCHITECTURE §7.5).
 */
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GT_GEOMETRY } from '../../src/sim-core/content/gt-geometry';

const GLB = fileURLToPath(new URL('../../assets-src/car/aston-martin-db11.glb', import.meta.url));

interface Box {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

function worldBox(node: Node): Box {
  const m = node.getWorldMatrix();
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = [0, 0, 0];
  for (const prim of node.getMesh()!.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let r = 0; r < 3; r++) {
        const w = m[r]! * v[0]! + m[4 + r]! * v[1]! + m[8 + r]! * v[2]! + m[12 + r]!;
        min[r] = Math.min(min[r]!, w);
        max[r] = Math.max(max[r]!, w);
      }
    }
  }
  return { min, max };
}

describe('GT geometry fitted to the DB11 mesh', async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(GLB);
  // The four tyres: mesh nodes named Object_4* (research 06: one tyre mesh per corner).
  const tyres = doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh() && n.getName().startsWith('Object_4'))
    .map((n) => {
      const b = worldBox(n);
      const c = [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2) as [number, number, number];
      return { name: n.getName(), centre: c, radius: (b.max[1] - b.min[1]) / 2, length: (b.max[2] - b.min[2]) / 2 };
    });
  const corner = (front: boolean, left: boolean) => {
    const t = tyres.filter((w) => w.centre[2] > 0 === front && w.centre[0] > 0 === left);
    expect(t, `${front ? 'front' : 'rear'} ${left ? 'left' : 'right'} tyre`).toHaveLength(1);
    return t[0]!;
  };
  const fl = corner(true, true);
  const fr = corner(true, false);
  const rl = corner(false, true);
  const rr = corner(false, false);
  const measured = {
    wheelbase: (fl.centre[2] + fr.centre[2] - rl.centre[2] - rr.centre[2]) / 2,
    trackFront: fl.centre[0] - fr.centre[0],
    trackRear: rl.centre[0] - rr.centre[0],
    radiusFront: (fl.radius + fr.radius + fl.length + fr.length) / 4,
    radiusRear: (rl.radius + rr.radius + rl.length + rr.length) / 4,
    wheelCentreHeight: (fl.centre[1] + fr.centre[1] + rl.centre[1] + rr.centre[1]) / 4,
  };

  it('finds exactly four tyres', () => expect(tyres).toHaveLength(4));
  it('matches wheelbase, tracks, tyre radii and wheel-centre height within 5 mm', () => {
    console.info('  measured', Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, +v.toFixed(4)])));
    const near = (a: number, b: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(0.005);
    near(measured.wheelbase, GT_GEOMETRY.wheelbase);
    near(measured.trackFront, GT_GEOMETRY.front.track);
    near(measured.trackRear, GT_GEOMETRY.rear.track);
    near(measured.radiusFront, GT_GEOMETRY.front.tyreRadius);
    near(measured.radiusRear, GT_GEOMETRY.rear.tyreRadius);
    near(measured.wheelCentreHeight, GT_GEOMETRY.wheelCentreHeight);
  });
});
