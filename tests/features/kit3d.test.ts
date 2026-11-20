/**
 * kit3d part helpers (research 22 B0-B7): rigid 3-point frames, tubes, the constant-wire-radius spring maths
 * (the TS mirror of the GLSL), coil bind, damper telescoping, and the build-time geometries (no NaN, outward
 * winding).
 */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { brakeDiscGeometry, caliperGeometry, hubGeometry } from '../../src/kit3d/brake';
import { createDamper } from '../../src/kit3d/damper';
import { lobedHull, padHull } from '../../src/kit3d/hull';
import { createPartMaterials } from '../../src/kit3d/materials';
import { aArmGeometry, frameFrom3, restInverse, setRigid, setSwing } from '../../src/kit3d/rigid';
import { clampSpringLength, makeSpringMaterial, solidLength, springGeometry, springVertex, updateSpring, type CoilSpec } from '../../src/kit3d/spring';
import { bakedTube, bellowsGeometry, mergeParts, unitCylinder, updateTube } from '../../src/kit3d/tube';
import { COMPONENT_COLORS } from '../../src/contracts/suspension';

const COIL: CoilSpec = { turns: 7.5, dead: 0.85, coilRadius: 0.04, wireRadius: 0.0064, restLength: 0.25, maxLength: 0.34 };

function finite(g: BufferGeometry): boolean {
  const a = g.getAttribute('position').array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

/** Fraction of triangles whose face normal points the same way as their vertex normals (outward winding). */
function outwardFraction(g: BufferGeometry): number {
  const flat = g.index ? g.toNonIndexed() : g;
  const p = flat.getAttribute('position');
  const n = flat.getAttribute('normal');
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const vn = new Vector3();
  let ok = 0;
  const tris = p.count / 3;
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(p, 3 * t);
    b.fromBufferAttribute(p, 3 * t + 1);
    c.fromBufferAttribute(p, 3 * t + 2);
    const fn = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    vn.fromBufferAttribute(n, 3 * t).add(new Vector3().fromBufferAttribute(n, 3 * t + 1)).add(new Vector3().fromBufferAttribute(n, 3 * t + 2));
    if (fn.dot(vn) > 0) ok++;
  }
  return ok / tris;
}

describe('rigid frames', () => {
  it('frameFrom3 is orthonormal and right-handed; setRigid maps rest hardpoints onto the current ones', () => {
    const rest = [new Vector3(0.1, 0.2, 0.3), new Vector3(0.5, 0.1, 0.2), new Vector3(0.2, 0.6, -0.1)];
    const m = frameFrom3(rest[0]!, rest[1]!, rest[2]!, new Matrix4());
    expect(m.determinant()).toBeCloseTo(1, 12);
    const motion = new Matrix4().compose(new Vector3(0.3, -0.2, 0.05), new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7), new Vector3(1, 1, 1));
    const now = rest.map((p) => p.clone().applyMatrix4(motion));
    const o = new Object3D();
    o.matrixAutoUpdate = false;
    setRigid(o, restInverse(rest[0]!, rest[1]!, rest[2]!), now[0]!, now[1]!, now[2]!);
    const probe = new Vector3(-0.4, 0.9, 0.33);
    expect(probe.clone().applyMatrix4(o.matrix).distanceTo(probe.clone().applyMatrix4(motion))).toBeLessThan(1e-12);
  });

  it('setSwing keeps the rod anchored and aligned (length preserved)', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(0, 0.4, 0);
    const o = new Object3D();
    o.matrixAutoUpdate = false;
    const nowA = new Vector3(0.1, 0.05, -0.02);
    const nowB = nowA.clone().add(new Vector3(0.1, 0.38, 0.05).normalize().multiplyScalar(0.4));
    setSwing(o, a, new Vector3(0, 1, 0), nowA, nowB);
    expect(a.clone().applyMatrix4(o.matrix).distanceTo(nowA)).toBeLessThan(1e-12);
    expect(b.clone().applyMatrix4(o.matrix).distanceTo(nowB)).toBeLessThan(1e-12);
  });
});

describe('tubes', () => {
  it('updateTube spans a to b with the given radius and hides degenerate segments', () => {
    const m = new Mesh(unitCylinder());
    const a = new Vector3(0.1, 0.2, 0.3);
    const b = new Vector3(-0.2, 0.5, 0.1);
    expect(updateTube(m, a, b, 0.01)).toBeCloseTo(a.distanceTo(b), 12);
    m.updateMatrix();
    expect(new Vector3(0, -0.5, 0).applyMatrix4(m.matrix).distanceTo(a)).toBeLessThan(1e-12);
    expect(new Vector3(0, 0.5, 0).applyMatrix4(m.matrix).distanceTo(b)).toBeLessThan(1e-12);
    expect(m.scale.x).toBe(0.01);
    expect(updateTube(m, a, a, 0.01)).toBe(0);
    expect(m.visible).toBe(false);
  });

  it('bakedTube and bellows geometries are finite and wound outward', () => {
    const t = bakedTube(new Vector3(0, 0, 0), new Vector3(0.3, 0.1, -0.2), 0.02, 0.01);
    expect(finite(t)).toBe(true);
    expect(outwardFraction(t)).toBeGreaterThan(0.99);
    const merged = mergeParts([t, bakedTube(new Vector3(1, 0, 0), new Vector3(1, 1, 0), 0.01)]);
    expect(merged.index).toBeNull();
    expect(Object.keys(merged.attributes).sort()).toEqual(['normal', 'position']);
    const bel = bellowsGeometry(0.02, 0.011, 6, 0.005);
    expect(finite(bel)).toBe(true);
    expect(outwardFraction(bel)).toBeGreaterThan(0.95);
  });
});

describe('coil spring (TS mirror of the vertex shader)', () => {
  const centreline = (t: number, len: number) => {
    // Wire centre = average of opposite surface points.
    const p = springVertex(t, 0, COIL, len, new Vector3());
    const q = springVertex(t, Math.PI, COIL, len, new Vector3());
    return p.add(q).multiplyScalar(0.5);
  };

  it('keeps the wire radius constant at every length (the cross-section is normal to the helix tangent)', () => {
    for (const len of [solidLength(COIL), 0.12, 0.25, 0.34]) {
      for (const t of [0.03, 0.2, 0.5, 0.77, 0.97]) {
        const c = centreline(t, len);
        const tangent = centreline(t + 1e-6, len).sub(centreline(t - 1e-6, len)).normalize();
        for (let k = 0; k < 12; k++) {
          const n = new Vector3();
          const p = springVertex(t, (k / 12) * Math.PI * 2, COIL, len, new Vector3(), n);
          expect(p.distanceTo(c)).toBeCloseTo(COIL.wireRadius, 9);
          expect(n.length()).toBeCloseTo(1, 12);
          expect(Math.abs(n.dot(tangent))).toBeLessThan(1e-4);
        }
      }
    }
  });

  it('spans exactly the seat-to-seat length, closed end turns touch, and clamps at coil bind', () => {
    expect(centreline(0, 0.3).y).toBeCloseTo(0, 12);
    expect(centreline(1, 0.3).y).toBeCloseTo(0.3, 12);
    // Dead (closed) turns advance one wire diameter per turn: touching.
    expect(centreline(0.5 / COIL.turns, 0.3).y - centreline(0, 0.3).y).toBeCloseTo(COIL.wireRadius, 9);
    expect(solidLength(COIL)).toBeCloseTo(2 * COIL.wireRadius * COIL.turns, 12);
    expect(clampSpringLength(COIL, 0.01)).toBe(solidLength(COIL));
    expect(clampSpringLength(COIL, 0.2)).toBe(0.2);
    // At coil bind no two neighbouring turns overlap: centre-line pitch >= wire diameter everywhere.
    const L = solidLength(COIL);
    for (let t = 0; t + 1 / COIL.turns <= 1; t += 0.01) expect(centreline(t + 1 / COIL.turns, L).y - centreline(t, L).y).toBeGreaterThanOrEqual(2 * COIL.wireRadius - 1e-9);
  });

  it('geometry is wound outward, bounded and updated with one uniform (no allocation)', () => {
    const g = springGeometry(COIL);
    const pos = g.getAttribute('position');
    // Normals from the same closed form.
    const aT = g.getAttribute('aT');
    const aPhi = g.getAttribute('aPhi');
    const normals = new Float32Array(pos.count * 3);
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      springVertex(aT.getX(i), aPhi.getX(i), COIL, COIL.restLength, new Vector3(), v);
      normals.set([v.x, v.y, v.z], 3 * i);
    }
    g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    expect(outwardFraction(g)).toBeGreaterThan(0.99);
    expect(finite(g)).toBe(true);
    expect(g.boundingSphere!.radius).toBeGreaterThan(COIL.maxLength / 2);
    const mat = createPartMaterials().roles.spring;
    const { uniforms, depth } = makeSpringMaterial(mat, COIL);
    expect(depth.customProgramCacheKey()).not.toBe(mat.customProgramCacheKey());
    const m = new Mesh(g, mat);
    const len = updateSpring(m, uniforms, COIL, new Vector3(0, 0.1, 0), new Vector3(0.05, 0.4, 0.02));
    expect(len).toBeCloseTo(Math.hypot(0.05, 0.3, 0.02), 12);
    expect(uniforms.uLen.value).toBe(len);
    expect(updateSpring(m, uniforms, COIL, new Vector3(), new Vector3(0, 0.01, 0))).toBe(solidLength(COIL));
  });
});

describe('damper', () => {
  it('body hangs from the lower mount, rod from the upper mount, with fixed lengths', () => {
    const d = createDamper(unitCylinder(), { body: createPartMaterials().roles.damper, rod: createPartMaterials().chrome, rubber: createPartMaterials().rubber }, {
      bodyLength: 0.25,
      bodyBelow: 0,
      bodyRadius: 0.024,
      rodLength: 0.3,
      rodRadius: 0.009,
      eyeRadius: 0.017,
    });
    const body = d.group.children[0]!;
    const rod = d.group.children[2]!;
    for (const L of [0.4, 0.5]) {
      d.update(new Vector3(0, 0, 0), new Vector3(0, L, 0));
      expect(body.scale.y).toBeCloseTo(0.25, 12);
      expect(body.position.y).toBeCloseTo(0.125, 12);
      expect(rod.scale.y).toBeCloseTo(0.3, 12);
      expect(rod.position.y).toBeCloseTo(L - 0.15, 12);
    }
  });
});

describe('build-time geometries', () => {
  it('hull, A-arm, disc, caliper and hub are finite and wound outward', () => {
    const hull = lobedHull([{ p: new Vector3(0, 0, 0), r: 0.05 }], [[{ p: new Vector3(0.2, 0.1, 0), r: 0.02 }], [{ p: new Vector3(-0.1, -0.2, 0.05), r: 0.03 }]]);
    const single = padHull([{ p: new Vector3(), r: 0.03 }, { p: new Vector3(0.1, 0, 0), r: 0.02 }]);
    const arm = aArmGeometry(new Vector3(0, 0.15, 0.8), new Vector3(0.2, 0.14, 0.38), new Vector3(-0.2, 0.16, 0.4), new Vector3(0, 0.38, 0.85), [new Vector3(0, 0.15, 0.65)], {
      legRadius: [0.013, 0.017],
      bushing: { radius: 0.026, length: 0.05 },
      jointRadius: 0.025,
      gusset: 0.3,
    });
    const disc = brakeDiscGeometry({ outerRadius: 0.17, innerRadius: 0.1, thickness: 0.028, hatDepth: 0.04, holes: 18, holeRadius: 0.0042 });
    const caliper = caliperGeometry({ innerRadius: 0.122, outerRadius: 0.196, halfSpan: 0.42, width: 0.074, discThickness: 0.028, discRadius: 0.17 });
    const hub = hubGeometry(0.04, 0.074, 0.057);
    for (const [name, g] of Object.entries({ hull, single, armBody: arm.body, armRubber: arm.rubber, armSteel: arm.steel, disc, caliper, hub })) {
      expect(finite(g), name).toBe(true);
      expect(outwardFraction(g), name).toBeGreaterThan(0.97);
    }
    // Disc ring lies in the XZ plane around +Y, the caliper is centred on +X.
    disc.computeBoundingBox();
    expect(disc.boundingBox!.max.x).toBeCloseTo(0.17, 3);
    caliper.computeBoundingBox();
    expect(caliper.boundingBox!.min.x).toBeGreaterThan(0.09);
  });

  it('materials follow the contract palette and highlight by emissive only', () => {
    const m = createPartMaterials();
    for (const [role, hex] of Object.entries(COMPONENT_COLORS)) expect(m.roles[role as keyof typeof COMPONENT_COLORS].color.getHex()).toBe(hex);
    const before = m.roles['upper-arm'].color.getHex();
    m.setHighlight('upper-arm', true);
    expect(m.roles['upper-arm'].emissiveIntensity).toBeGreaterThan(0);
    expect(m.roles['upper-arm'].color.getHex()).toBe(before);
    m.setHighlight('upper-arm', false);
    expect(m.roles['upper-arm'].emissiveIntensity).toBe(0);
    m.dispose();
  });
});
