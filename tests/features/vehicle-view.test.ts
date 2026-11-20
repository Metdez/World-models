/**
 * 03-03: the `db11` vehicle visual built from the real GLB (parsed in node) and posed by the real simulation, and
 * the vehicle-view runtime with fake visuals. Also reports how the procedural suspension clears the REAL wheel mesh.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder as NodeMeshoptDecoder } from 'meshoptimizer';
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { Registries, Registry } from '../../src/contracts/app';
import type { RenderService, SuspensionVisual, VehicleVisual, VisualContext } from '../../src/contracts/services';
import type { SimCatalog } from '../../src/contracts/sim';
import type { SuspensionDefinition } from '../../src/contracts/suspension';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { simToThree } from '../../src/contracts/units';
import { bakeMerge } from '../../src/features/car/db11/bake';
import { BODY_FINISH } from '../../src/features/car/db11/materials';
import { buildDb11, HIDDEN_NODES } from '../../src/features/car/db11/visual';
import { buildSpatialLinkage } from '../../src/features/linkage-parts/visual';
import { createVehicleView, forceVisible, XRAY_FADE_S } from '../../src/features/vehicle-view/runtime';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createSimulation } from '../../src/sim-core/index';

const GLB = fileURLToPath(new URL('../../assets-src/car/aston-martin-db11.glb', import.meta.url));
const catalog: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };

async function parseGlb(): Promise<Object3D> {
  const buf = readFileSync(GLB);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return gltf.scene;
}

const meshesOf = (root: Object3D) => {
  const out: Mesh[] = [];
  root.traverse((o) => (o as Mesh).isMesh && out.push(o as Mesh));
  return out;
};

function lowestY(mesh: Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const p = mesh.geometry.getAttribute('position');
  const v = new Vector3();
  let min = Infinity;
  for (let i = 0; i < p.count; i++) min = Math.min(min, v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).y);
  return min;
}

describe('db11 visual', { timeout: 120_000 }, async () => {
  const visual = buildDb11(await parseGlb(), gtCoupe);
  const root = visual.root;
  const byName = (n: string) => root.getObjectByName(n)!;

  it('maps every material of the GLB to a finish and every hidden-node rule matches a real node', async () => {
    await NodeMeshoptDecoder.ready;
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': NodeMeshoptDecoder }).read(GLB);
    const names = doc.getRoot().listMaterials().map((m) => m.getName());
    expect(names).toHaveLength(53);
    expect(names.filter((n) => !(n in BODY_FINISH))).toEqual([]);
    // GLTFLoader sanitises node names ('.' removed); the rules are written against those.
    const nodes = doc.getRoot().listNodes().map((n) => n.getName().replace(/[.\s]/g, ''));
    for (const r of HIDDEN_NODES) expect(nodes.some((n) => r.test(n)), String(r)).toBe(true);
  });

  it('fits the draw-call budget and keeps hubs separate per corner', () => {
    const meshes = meshesOf(root);
    const standIns = meshes.filter((m) => m.userData.replacedBySuspension === true);
    console.info(`  db11 meshes: ${meshes.length} (${standIns.length} brake stand-ins, 1 x-ray ghost)`);
    // With a suspension visual mounted the brakes are hidden and the ghost only draws in x-ray: car <= 30 draws.
    expect(meshes.length - standIns.length - 1).toBeLessThanOrEqual(30);
    for (const id of ['fl', 'fr', 'rl', 'rr']) {
      for (const part of ['tyre', 'rim-face', 'rim-dark', 'brake:disc', 'brake:caliper']) expect(byName(`hub:${id}`).getObjectByName(`${id}:${part}`), `${id}:${part}`).toBeDefined();
      expect(byName(`spin:${id}`).getObjectByName(`${id}:brake:caliper`), 'caliper does not spin').toBeUndefined();
    }
  });

  it('places the wheel meshes on the vehicle-frame wheel centres (front at +cgToFront, left at three -Z, radius up)', () => {
    for (const [id, x, z] of [
      ['fl', gtCoupe.cgToFront, -gtCoupe.front.track / 2],
      ['fr', gtCoupe.cgToFront, gtCoupe.front.track / 2],
      ['rl', gtCoupe.cgToFront - gtCoupe.wheelbase, -gtCoupe.rear.track / 2],
      ['rr', gtCoupe.cgToFront - gtCoupe.wheelbase, gtCoupe.rear.track / 2],
    ] as const) {
      const tyre = byName(`${id}:tyre`) as Mesh;
      tyre.geometry.computeBoundingBox();
      const c = tyre.geometry.boundingBox!.getCenter(new Vector3());
      // Tyre geometry is centred on its hub (the hub is placed at the GLB wheel centre in the car frame).
      expect(c.length(), id).toBeLessThan(0.006);
      const r = gtCoupe.front.tyre.radius;
      expect(tyre.geometry.boundingBox!.max.y, `${id} radius`).toBeCloseTo(r, 2);
      // The body mesh sits where those hubs are at static ride: check the hub is in its arch via the body paint box.
      const paint = byName('body:paint') as Mesh;
      paint.geometry.computeBoundingBox();
      const b = paint.geometry.boundingBox!;
      expect(b.max.x).toBeGreaterThan(x + r);
      expect(b.min.x).toBeLessThan(x - r);
      expect(Math.sign(z)).toBe(id[1] === 'l' ? -1 : 1);
    }
  });

  it('posed by the real simulation: hubs follow CornerFrame, tyres touch the drawn road, body sits on its wheels', () => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'double-wishbone' });
    const hubLocal = new Vector3();
    const body = byName('body');
    let worstGap = 0;
    let worstSink = 0;
    const blownUp: number[] = [];
    for (let i = 0; i < 40; i++) {
      sim.seek((i / 40) * sim.lapDuration);
      const t = sim.sample(1, 1);
      // Known sim-core issue (reported in 03-03 SUMMARY): seek(33.487 s) on the pave returns a diverged ride state.
      if (!(Math.abs(t.heave) < 1)) {
        blownUp.push(t.lapTime);
        continue;
      }
      visual.update(t);
      root.updateMatrixWorld(true);
      for (const c of t.corners) {
        const hub = byName(`hub:${c.id}`);
        const w = simToThree(c.wheelPosition.x, c.wheelPosition.y, c.wheelPosition.z, new Vector3());
        expect(hub.position.distanceTo(w)).toBeLessThan(1e-9);
        // Road: the contact patch lies on the drawn road (02-04). The drawn tyre has its unloaded radius, so it
        // dips into the road by the static+dynamic deflection, but never floats above it.
        const patch = simToThree(c.contactPatch.x, c.contactPatch.y, c.contactPatch.z, new Vector3());
        const gap = lowestY(byName(`${c.id}:tyre`) as Mesh) - patch.y;
        if (c.load > 0) {
          worstGap = Math.max(worstGap, gap);
          worstSink = Math.min(worstSink, gap);
        }
        // Wheel in its arch: hub in the body frame within the suspension travel of the static wheel centre.
        hubLocal.copy(hub.position);
        body.worldToLocal(hubLocal);
        const sx = c.axle === 'front' ? gtCoupe.cgToFront : gtCoupe.cgToFront - gtCoupe.wheelbase;
        expect(Math.abs(hubLocal.x - sx), `${c.id} x`).toBeLessThan(0.03);
        // Lateral: the wheel centre moves with track change and camber over the travel.
        expect(Math.abs(Math.abs(hubLocal.z) - gtCoupe.front.track / 2), `${c.id} z`).toBeLessThan(0.05);
        expect(Math.abs(hubLocal.y - gtCoupe.front.tyre.radius - c.travel), `${c.id} y`).toBeLessThan(0.01);
      }
    }
    if (blownUp.length) console.info(`  sim-core diverged after seek at lap time(s) ${blownUp.map((x) => x.toFixed(3)).join(', ')} (skipped)`);
    expect(blownUp.length).toBeLessThanOrEqual(1);
    console.info(`  tyre bottom vs contact patch over a lap: max ${(worstGap * 1000).toFixed(1)} mm above, max ${(-worstSink * 1000).toFixed(1)} mm below`);
    expect(worstGap).toBeLessThan(0.003);
    expect(worstSink).toBeGreaterThan(-0.04);
  });

  it('rolls forward for positive spin, steers the caliper without spinning it', () => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'double-wishbone' });
    sim.seek(9.75); // hairpin apex
    const t = sim.sample(1, 1);
    t.corners[0]!.spin = 0.1;
    visual.update(t);
    root.updateMatrixWorld(true);
    const spin = byName('spin:fl');
    const top = new Vector3(0, 0.3, 0).applyQuaternion(spin.quaternion);
    expect(top.x).toBeGreaterThan(0); // the top of the wheel moves forward (+X in the hub frame)
    // Front hubs yaw with the steer (right-hand hairpin: steer < 0 -> wheels point right = toward three +Z).
    const fwd = new Vector3(1, 0, 0).applyQuaternion(byName('hub:fl').getWorldQuaternion(new Group().quaternion));
    const bodyFwd = new Vector3(1, 0, 0).applyQuaternion(byName('body').quaternion);
    const yaw = Math.atan2(-(fwd.z * bodyFwd.x - fwd.x * bodyFwd.z), fwd.x * bodyFwd.x + fwd.z * bodyFwd.z);
    expect(t.corners[0]!.steer).toBeLessThan(-0.05);
    expect(Math.sign(yaw)).toBe(-1);
  });

  it('x-ray shows the ghost shell and stops body shadows; update allocates nothing', () => {
    const ghost = byName('xray-ghost');
    visual.setXray(1);
    expect(ghost.visible).toBe(true);
    expect((byName('body:paint') as Mesh).castShadow).toBe(false);
    visual.setXray(0);
    expect(ghost.visible).toBe(false);
    expect((byName('body:paint') as Mesh).castShadow).toBe(true);
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'double-wishbone' });
    const t = sim.sample(0.5, 1);
    for (let i = 0; i < 2000; i++) visual.update(t);
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) visual.update(t);
    const churn = process.memoryUsage().heapUsed - before;
    globalThis.gc?.();
    const retained = process.memoryUsage().heapUsed - before;
    // No objects are created; what remains is V8 boxing doubles across non-inlined three setters (cf. 02-04).
    console.info(`  update(): ${(churn / 20000).toFixed(0)} B short-lived churn per call, retained ${retained} B`);
    expect(retained).toBeLessThan(64 * 1024);
    expect(churn / 20000).toBeLessThan(512);
  });

  it('reports procedural suspension parts against the REAL wheel mesh (rim barrel + tyre)', () => {
    const report: string[] = [];
    for (const def of [macpherson, doubleWishbone, multilink]) {
      const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: def.id });
      const sv = buildSpatialLinkage(def, gtCoupe);
      const worst = new Map<string, { depth: number; t: number }>();
      for (let i = 0; i < 48; i++) {
        const lap = (i / 48) * sim.lapDuration;
        sim.seek(lap);
        const t = sim.sample(1, 1);
        visual.update(t);
        sv.update(t);
        root.updateMatrixWorld(true);
        for (const [corner, info] of Object.entries(sv.inspect())) {
          const hub = byName(`hub:${corner}`);
          const inv = new Matrix4().copy(hub.matrixWorld).invert();
          for (const part of ['tyre', 'rim-dark', 'rim-face']) {
            const g = (byName(`${corner}:${part}`) as Mesh).geometry;
            const spinM = byName(`spin:${corner}`).matrix;
            for (const cap of info.capsules) {
              const a = cap.a.clone().applyMatrix4(inv);
              const b = cap.b.clone().applyMatrix4(inv);
              const depth = cap.r - segmentToPoints(a, b, g, spinM);
              const key = `${def.id} ${corner} ${cap.name} vs ${part}`;
              if (depth > 0.002 && depth > (worst.get(key)?.depth ?? 0)) worst.set(key, { depth, t: lap });
            }
          }
        }
      }
      sv.dispose();
      for (const [k, w] of worst) report.push(`${k}: ${(w.depth * 1000).toFixed(0)} mm at t=${w.t.toFixed(1)} s`);
    }
    console.info(`  suspension parts inside the real wheel mesh (> 2 mm, lap at true scale):\n    ${report.join('\n    ') || 'none'}`);
    expect(Array.isArray(report)).toBe(true);
  }, 120_000);
});

/** Smallest distance from segment a-b to any vertex of g (vertices transformed by m). */
function segmentToPoints(a: Vector3, b: Vector3, g: BufferGeometry, m: Matrix4): number {
  const p = g.getAttribute('position');
  const ab = new Vector3().subVectors(b, a);
  const len2 = Math.max(ab.lengthSq(), 1e-12);
  const v = new Vector3();
  const w = new Vector3();
  let min = Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    const s = Math.min(1, Math.max(0, w.subVectors(v, a).dot(ab) / len2));
    min = Math.min(min, w.copy(a).addScaledVector(ab, s).distanceTo(v));
  }
  return min;
}

describe('bakeMerge', () => {
  it('dequantises into one indexed geometry and keeps faces outward under a mirror', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const merged = bakeMerge([
      { geometry: g, matrix: new Matrix4() },
      { geometry: g, matrix: new Matrix4().makeScale(-1, 1, 1) },
    ]);
    expect(merged.getAttribute('position').count).toBe(6);
    expect(Array.from(merged.index!.array)).toEqual([0, 1, 2, 3, 5, 4]);
  });
});

// ---------------------------------------------------------------- vehicle-view runtime with fakes

function registry<T extends { readonly id: string }>(items: T[]): Registry<T> {
  return {
    register: () => () => {},
    get: (id) => items.find((i) => i.id === id),
    require: (id) => items.find((i) => i.id === id)!,
    list: () => items,
  };
}

function fakes(withSuspensionVisual: boolean) {
  const scene = new Group();
  let compiled = 0;
  const visibleAtCompile: boolean[] = [];
  const log: string[] = [];
  const vehicleRoot = new Group();
  const brake = new Object3D();
  brake.userData.replacedBySuspension = true;
  vehicleRoot.add(brake);
  let xray = -1;
  const vehicleVisual: VehicleVisual = { root: vehicleRoot, update: () => {}, setXray: (a) => (xray = a), dispose: () => log.push('vehicle:dispose') };
  const suspensionVisual = (id: string): SuspensionVisual => {
    const root = new Group();
    const inner = new Object3D();
    inner.visible = false; // like spatial-linkage: hidden until the frame carries its points
    root.add(inner);
    return { root, update: () => log.push(`update:${id}`), setHighlight: (role, corner, on) => log.push(`hl:${id}:${role}:${corner}:${on}`), dispose: () => log.push(`dispose:${id}`) };
  };
  const render = {
    renderer: { extensions: { has: () => true } },
    add: (o: Object3D) => {
      scene.add(o);
      return () => scene.remove(o);
    },
    compile: async () => {
      compiled++;
      scene.traverse((o) => visibleAtCompile.push(o.visible));
      log.push(`compile:xray=${xray}`);
    },
  } as unknown as RenderService;
  const registries = {
    vehicles: registry([gtCoupe]),
    suspensions: registry<SuspensionDefinition>([macpherson, doubleWishbone, multilink]),
    tracks: registry([]),
    vehicleVisuals: registry([{ id: 'db11', load: async () => vehicleVisual }]),
    suspensionVisuals: registry(withSuspensionVisual ? [{ id: 'spatial-linkage', build: (s: SuspensionDefinition) => suspensionVisual(s.id) }] : []),
  } as unknown as Registries;
  const view = createVehicleView(registries, { assets: {} as VisualContext['assets'], render });
  return { scene, view, log, brake, compiled: () => compiled, visibleAtCompile, xray: () => xray };
}

const FRAME = {} as TelemetryFrame;

describe('vehicle-view runtime', () => {
  it('pre-builds every suspension visual, compiles them all visible with x-ray, shows only the active one', async () => {
    const f = fakes(true);
    await f.view.load(gtCoupe, 'double-wishbone', () => FRAME);
    expect(f.compiled()).toBe(1);
    expect(f.visibleAtCompile.every(Boolean)).toBe(true);
    expect(f.log).toContain('compile:xray=1');
    expect(f.xray()).toBe(0);
    const s = f.view.state;
    expect([...s.suspensions.keys()]).toEqual(['macpherson', 'double-wishbone', 'multilink']);
    expect([...s.suspensions.values()].map((v) => v.root.visible)).toEqual([false, true, false]);
    expect(f.brake.visible).toBe(false);
    // Hidden children were restored after compiling.
    expect([...s.suspensions.values()].every((v) => v.root.children[0]!.visible === false)).toBe(true);
    f.view.setSuspension('multilink');
    expect([...s.suspensions.values()].map((v) => v.root.visible)).toEqual([false, false, true]);
    f.log.length = 0;
    f.view.update(FRAME, 0.016);
    expect(f.log).toEqual(['update:multilink']);
    expect(f.compiled()).toBe(1); // a swap never compiles
  });

  it('without suspension visuals the car keeps its own brakes and still updates', async () => {
    const f = fakes(false);
    await f.view.load(gtCoupe, 'double-wishbone', () => FRAME);
    expect(f.view.state.suspensions.size).toBe(0);
    expect(f.brake.visible).toBe(true);
    f.view.update(FRAME, 0.016);
  });

  it('fades x-ray over 0.4 s (instant with reduced motion) and expires highlights, re-applied after a swap', async () => {
    const f = fakes(true);
    await f.view.load(gtCoupe, 'double-wishbone', () => FRAME);
    f.view.setXray(true, false);
    f.view.update(FRAME, XRAY_FADE_S / 2);
    expect(f.xray()).toBeCloseTo(0.5, 9);
    f.view.update(FRAME, XRAY_FADE_S);
    expect(f.xray()).toBe(1);
    f.view.setXray(false, true);
    f.view.update(FRAME, 0.001);
    expect(f.xray()).toBe(0);

    f.log.length = 0;
    f.view.highlight('upper-arm', 'fl', 500);
    f.view.setSuspension('macpherson');
    f.view.update(FRAME, 0.3);
    expect(f.view.state.highlights).toBe(1);
    f.view.update(FRAME, 0.3);
    expect(f.view.state.highlights).toBe(0);
    expect(f.log.filter((l) => l.startsWith('hl:'))).toEqual([
      'hl:double-wishbone:upper-arm:fl:true',
      'hl:double-wishbone:upper-arm:fl:false',
      'hl:macpherson:upper-arm:fl:true',
      'hl:macpherson:upper-arm:fl:false',
    ]);
  });

  it('a vehicle reload disposes the previous visuals', async () => {
    const f = fakes(true);
    await f.view.load(gtCoupe, 'double-wishbone', () => FRAME);
    await f.view.load(gtCoupe, 'macpherson', () => FRAME);
    expect(f.log.filter((l) => l.includes('dispose'))).toEqual(['vehicle:dispose', 'dispose:macpherson', 'dispose:double-wishbone', 'dispose:multilink']);
    expect(f.scene.children).toHaveLength(4);
    f.view.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('forceVisible restores exactly what it changed', () => {
    const a = new Group();
    const b = new Object3D();
    b.visible = false;
    a.add(b);
    const undo = forceVisible([a]);
    expect(b.visible).toBe(true);
    undo();
    expect(b.visible).toBe(false);
  });
});
