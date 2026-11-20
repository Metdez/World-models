/**
 * `db11` VehicleVisual: the hero mesh (CC BY 4.0, Black Snow; shape only) re-materialed, merged per finish, placed
 * in the vehicle frame from its own tyre meshes, with one hub per corner posed from the solved CornerFrame.
 */
import { Box3, Group, Matrix4, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VehicleVisual, VisualContext } from '../../../contracts/services';
import type { TelemetryFrame } from '../../../contracts/telemetry';
import { CAR_CORNERS, simQuatToThree, simToThree } from '../../../contracts/units';
import type { CarDefinition, VehicleDefinition } from '../../../contracts/vehicle';
import { bakeMerge, type BakePart } from './bake';
import { BODY_FINISH, WHEEL_FINISH, createFinishMaterial, type Finish } from './materials';
import { addBodyShader, createGhostMaterial } from './shaders';

export const DB11_VISUAL_ID = 'db11';
export const DB11_ASSET = 'car/aston-martin-db11';

/**
 * GLB parts that are never drawn (top-level node names under RootNode, as GLTFLoader sanitises them):
 * the model's own single-sided suspension stand-ins (the real linkage is procedural), a second brake disc sitting
 * inside the front-left one, and the V8 engine/intake overlapping the V12.
 */
export const HIDDEN_NODES: readonly RegExp[] = [
  /^amdb11_(tierod|swaybar|subframe|strut_F|steeringbox|lowerarm|upperarm|hub_[FR]|spring|shock|halfshaft)/,
  /^amdb11_brakedisc_RR/,
  /^amdb11_(engine|intake)_v8/,
];
/** Turn signals are coincident copies of the running/tail-light meshes (z-fighting). */
const HIDDEN_MATERIALS = /^amdb11_signal_/;
/** Badges and scripts (trademarks; honesty rule 4) are hidden when small; large "badging" meshes are trim. */
const BADGE = /^amdb11_badging/;
const BADGE_MAX_SIZE = 0.3;
const WHEEL_NODES = /^(amdb11_wheel_03|Object_4|amdb11_brakedisc|amdb11_caliper)/;
const BRAKE_NODES = /^(amdb11_brakedisc|amdb11_caliper)/;
const CALIPER_NODES = /^amdb11_caliper/;
/** Headlight cover glass: a clear lens, not tinted window glass. */
const LENS_NODES = /^amdb11_headlightglass/;
/** Finishes enclosed by the body shell: their shadows are never seen, so they skip the shadow pass. */
const ENCLOSED: ReadonlySet<string> = new Set(['leather', 'leather-dark', 'interior', 'engine', 'engine-red']);
/** Finishes of the outer skin: the x-ray ghost shell is made of these. */
const SHELL: ReadonlySet<Finish> = new Set(['paint', 'gloss-black', 'glass', 'lens', 'tail-lens']);

const _box = new Box3();
const _v = new Vector3();

function topNodeName(mesh: Object3D): string {
  let o: Object3D = mesh;
  while (o.parent && o.parent.name !== 'RootNode') o = o.parent;
  return o.name;
}

function meshCentre(mesh: Mesh, toCar: Matrix4, out: Vector3): Vector3 {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.getCenter(out).applyMatrix4(toCar);
}

interface Corner {
  readonly hub: Group;
  readonly spin: Group;
}

/** Pure part: builds the visual from a loaded glTF scene (node tests parse the GLB directly). */
export function buildDb11(gltfScene: Object3D, vehicle: CarDefinition): VehicleVisual {
  gltfScene.updateMatrixWorld(true);
  // glTF forward is +Z: +π/2 about three Y makes it three +X = sim +X (ARCHITECTURE §4); glTF +X (left) -> three -Z.
  const rot = new Matrix4().makeRotationY(Math.PI / 2);
  const meshes: Mesh[] = [];
  gltfScene.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const matrixOf = (m: Mesh) => new Matrix4().multiplyMatrices(rot, m.matrixWorld);

  // Placement from the tyres: front wheel centres at x = cgToFront, wheel centres at the tyre radius (vehicle
  // frame, origin on the ground under the CG), centred laterally.
  const tyres = meshes.filter((m) => WHEEL_NODES.test(topNodeName(m)) && (m.material as Material).name === 'Scene_-_Root');
  if (tyres.length !== 4) throw new Error(`db11: expected 4 tyre meshes, found ${tyres.length}`);
  const tyreCentres = tyres.map((m) => meshCentre(m, matrixOf(m), new Vector3()));
  const front = tyreCentres.filter((c) => c.x > 0);
  const mean = (cs: Vector3[], k: 'x' | 'y' | 'z') => cs.reduce((s, c) => s + c[k], 0) / cs.length;
  const offset = new Matrix4().makeTranslation(
    vehicle.cgToFront - mean(front, 'x'),
    vehicle.front.tyre.radius - mean(tyreCentres, 'y'),
    -mean(tyreCentres, 'z'),
  );
  const toCar = (m: Mesh) => new Matrix4().multiplyMatrices(offset, matrixOf(m));
  const cornerOf = (c: Vector3) => (c.x > 0 ? 0 : 2) + (c.z < 0 ? 0 : 1); // fl, fr, rl, rr
  const hubCentres = [0, 1, 2, 3].map(() => new Vector3());
  for (const t of tyres) {
    const c = meshCentre(t, toCar(t), new Vector3());
    hubCentres[cornerOf(c)]!.copy(c);
  }

  const body: Record<string, BakePart[]> = {};
  const shell: BakePart[] = [];
  // Per corner: finish -> parts, split into spinning (rim, tyre, disc) and steer-only (caliper).
  const spinParts = hubCentres.map(() => ({}) as Record<string, BakePart[]>);
  const fixedParts = hubCentres.map(() => ({}) as Record<string, BakePart[]>);
  const brakeFinishes = hubCentres.map(() => new Set<string>());
  const unmapped = new Set<string>();
  for (const m of meshes) {
    const node = topNodeName(m);
    const matName = (m.material as Material).name;
    if (HIDDEN_NODES.some((r) => r.test(node)) || HIDDEN_MATERIALS.test(matName)) continue;
    const M = toCar(m);
    if (BADGE.test(matName)) {
      m.geometry.computeBoundingBox();
      _box.copy(m.geometry.boundingBox!).applyMatrix4(M);
      if (Math.max(..._box.getSize(_v).toArray()) < BADGE_MAX_SIZE) continue;
    }
    if (WHEEL_NODES.test(node)) {
      const i = cornerOf(meshCentre(m, M, _v));
      const finish = WHEEL_FINISH[matName] ?? BODY_FINISH[matName];
      if (!finish) {
        unmapped.add(matName);
        continue;
      }
      const local = new Matrix4().makeTranslation(-hubCentres[i]!.x, -hubCentres[i]!.y, -hubCentres[i]!.z).multiply(M);
      const target = CALIPER_NODES.test(node) ? fixedParts[i]! : spinParts[i]!;
      // Brake parts get their own finish key so they can be hidden independently of the rim.
      const key = BRAKE_NODES.test(node) ? `brake:${finish}` : finish;
      if (BRAKE_NODES.test(node)) brakeFinishes[i]!.add(key);
      (target[key] ??= []).push({ geometry: m.geometry, matrix: local });
      continue;
    }
    const finish: Finish | undefined = LENS_NODES.test(node) ? 'lens' : BODY_FINISH[matName];
    if (!finish) {
      unmapped.add(matName);
      continue;
    }
    (body[finish] ??= []).push({ geometry: m.geometry, matrix: M });
    if (SHELL.has(finish)) shell.push({ geometry: m.geometry, matrix: M });
  }
  if (unmapped.size) throw new Error(`db11: no finish for materials ${[...unmapped].join(', ')}`);

  const xray = { uXray: { value: 0 } };
  const owned: { geometries: BufferGeometry[]; materials: Material[] } = { geometries: [], materials: [] };
  const materials = new Map<string, Material>();
  const material = (key: string, isBody: boolean): Material => {
    const id = `${isBody ? 'body' : 'wheel'}:${key}`;
    let mat = materials.get(id);
    if (!mat) {
      const finish = key.replace(/^brake:/, '') as Finish;
      mat = createFinishMaterial(finish);
      mat.name = `db11-${finish}`;
      if (isBody) addBodyShader(mat, xray, finish === 'paint');
      materials.set(id, mat);
      owned.materials.push(mat);
    }
    return mat;
  };
  const addMesh = (parent: Object3D, parts: BakePart[], mat: Material, name: string): Mesh => {
    const geometry = bakeMerge(parts);
    owned.geometries.push(geometry);
    const mesh = new Mesh(geometry, mat);
    mesh.name = name;
    const transparent = mat.transparent;
    mesh.castShadow = !transparent;
    mesh.receiveShadow = !transparent;
    parent.add(mesh);
    return mesh;
  };

  const root = new Group();
  root.name = `vehicle:${DB11_VISUAL_ID}`;
  const bodyGroup = new Group();
  bodyGroup.name = 'body';
  root.add(bodyGroup);
  const bodyMeshes = Object.entries(body).map(([finish, parts]) => addMesh(bodyGroup, parts, material(finish, true), `body:${finish}`));
  const shadowCasters = bodyMeshes.filter((m) => m.castShadow && !ENCLOSED.has(m.name.slice('body:'.length)));
  for (const m of bodyMeshes) m.castShadow = shadowCasters.includes(m);
  const ghostMaterial = createGhostMaterial(xray);
  owned.materials.push(ghostMaterial);
  const ghost = addMesh(bodyGroup, shell, ghostMaterial, 'xray-ghost');
  ghost.castShadow = false;
  ghost.receiveShadow = false;
  ghost.renderOrder = 10;
  ghost.visible = false;

  const corners: Corner[] = CAR_CORNERS.map((id, i) => {
    const hub = new Group();
    hub.name = `hub:${id}`;
    const spin = new Group();
    spin.name = `spin:${id}`;
    hub.add(spin);
    root.add(hub);
    for (const [parts, parent] of [
      [spinParts[i]!, spin],
      [fixedParts[i]!, hub],
    ] as const) {
      for (const [key, list] of Object.entries(parts)) {
        const mesh = addMesh(parent, list, material(key, false), `${id}:${key}`);
        if (brakeFinishes[i]!.has(key)) mesh.userData.replacedBySuspension = true;
      }
    }
    return { hub, spin };
  });

  return {
    root,
    update(t: TelemetryFrame): void {
      simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, bodyGroup.position);
      simQuatToThree(t.bodyRotation, bodyGroup.quaternion);
      for (let i = 0; i < t.corners.length; i++) {
        const c = t.corners[i]!;
        const k = CAR_CORNERS.indexOf(c.id as (typeof CAR_CORNERS)[number]);
        const corner = corners[k];
        if (!corner) continue;
        simToThree(c.wheelPosition.x, c.wheelPosition.y, c.wheelPosition.z, corner.hub.position);
        simQuatToThree(c.wheelRotation, corner.hub.quaternion);
        // Rolling forward is + about sim +Y (the axle, left), i.e. three -Z.
        corner.spin.rotation.z = -c.spin;
      }
    },
    setXray(amount: number): void {
      xray.uXray.value = amount;
      ghost.visible = amount > 0.001;
      for (const m of shadowCasters) m.castShadow = amount < 0.5;
    },
    dispose(): void {
      root.removeFromParent();
      for (const g of owned.geometries) g.dispose();
      for (const m of owned.materials) m.dispose();
    },
  };
}

/** VehicleVisualDefinition.load: fetches the GLB through the asset manifest and builds the visual. */
export async function loadDb11(vehicle: VehicleDefinition, ctx: VisualContext): Promise<VehicleVisual> {
  if (vehicle.class !== 'car') throw new Error(`${DB11_VISUAL_ID}: car visual, got vehicle class "${vehicle.class}"`);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(ctx.assets.url(DB11_ASSET));
  return buildDb11(gltf.scene, vehicle);
}
