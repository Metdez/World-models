/**
 * `moto-planar` SuspensionVisual: the motorcycle front end and rear suspension for any MotorcycleSuspensionDefinition
 * (telescopic RSU/USD or Telelever front; twin-shock, single-sided or linkage rear are data). Driven only by contract
 * POSE fields: bodyPosition/bodyRotation, the corner points named in `pointOrder` (hidden until the frame carries
 * them), the front corner's steer and both wheels' spin. Part colours come from COMPONENT_COLORS via kit3d palette
 * materials; highlight is emissive in the part colours, per corner ('f' / 'r'). `update` allocates nothing.
 */
import { Group, Mesh, MeshPhysicalMaterial, Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import type { SuspensionVisual, SuspensionVisualDefinition } from '../../../contracts/services';
import type { ComponentRole, MotorcycleSuspensionDefinition, SuspensionDefinition } from '../../../contracts/suspension';
import type { TelemetryFrame } from '../../../contracts/telemetry';
import { simQuatToThree, simToThree, type CornerId } from '../../../contracts/units';
import type { VehicleDefinition } from '../../../contracts/vehicle';
import { createPalette, createPartMaterials, HIGHLIGHT_INTENSITY, type PartMaterials } from '../../../kit3d/materials';
import { mergeParts } from '../../../kit3d/tube';
import { createMotoPalette, disposeMotoPalette } from '../visual/palette';
import { buildFront } from './front';
import { buildRear } from './rear';

export const MOTO_PLANAR_VISUAL_ID = 'moto-planar';

export interface MotoPlanarVisual extends SuspensionVisual {
  /** Debug/test: meshes (draw calls) and the rigs' link end points at the last update (body space). */
  inspect(): {
    meshes: readonly Mesh[];
    front: { visible: boolean; armJoint: Vector3 | null; shockArm: Vector3 | null; slider: Vector3 };
    rear: { visible: boolean; dogBone: [Vector3, Vector3] | null; shocks: [Vector3, Vector3][] };
  };
}

interface Slot {
  readonly id: CornerId;
  readonly names: readonly string[];
  readonly points: readonly Vector3[];
  readonly byName: ReadonlyMap<string, Vector3>;
  readonly map: Int32Array;
  order: readonly string[] | null;
  ok: boolean;
}

function slot(id: CornerId, names: readonly string[]): Slot {
  const points = names.map(() => new Vector3());
  return { id, names, points, byName: new Map(names.map((n, i) => [n, points[i]!])), map: new Int32Array(names.length), order: null, ok: false };
}

const _q = new Quaternion();
const _p = new Vector3();

export function buildMotoPlanar(suspension: SuspensionDefinition, vehicle: VehicleDefinition): MotoPlanarVisual {
  if (suspension.vehicleClass !== 'motorcycle' || vehicle.class !== 'motorcycle') {
    throw new Error(`${MOTO_PLANAR_VISUAL_ID}: motorcycle suspensions only (got "${suspension.id}")`);
  }
  const def: MotorcycleSuspensionDefinition = suspension;
  const palette = createPalette();
  const mats: Record<'f' | 'r', PartMaterials> = { f: createPartMaterials(palette), r: createPartMaterials(palette) };
  const cosmetic = createMotoPalette('moto-parts');
  const lens = new MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.16, envMapIntensity: 2, depthWrite: false });
  lens.name = 'moto-headlight-lens';

  const root = new Group();
  root.name = `${MOTO_PLANAR_VISUAL_ID}:${def.id}`;
  const body = new Group();
  body.name = 'body';
  root.add(body);
  const front = buildFront(def.front, vehicle, mats.f, cosmetic, lens);
  const rear = buildRear(def.rear, vehicle, mats.r, mats.r.plain);
  body.add(front.steering, front.bodyParts, rear.group);
  const chassisGeo = mergeParts([...front.chassis, ...rear.chassis].map((g) => (g.index ? g.toNonIndexed() : g)));
  const chassis = new Mesh(chassisGeo, cosmetic);
  chassis.name = 'chassis';
  chassis.castShadow = chassis.receiveShadow = true;
  body.add(chassis);

  const slots = {
    f: slot('f', def.front.kind === 'telelever' ? ['axle', 'armJoint'] : ['axle']),
    r: slot('r', def.rear.kind === 'swingarm' ? ['pivot', 'axle', 'shockLower'] : ['pivot', 'axle', 'swingarmLink', 'rockerLink', 'rockerShock']),
  } as const;
  const springs: Record<'f' | 'r', readonly MeshStandardMaterial[]> = { f: front.springMaterials, r: rear.springMaterials };
  const frontJoint = slots.f.byName.get('armJoint') ?? null;
  const frontAxle = slots.f.byName.get('axle')!;
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const show = (s: Slot, on: boolean) => {
    if (s.id === 'f') {
      front.steering.visible = on;
      front.bodyParts.visible = on;
    } else rear.group.visible = on;
  };
  show(slots.f, false);
  show(slots.r, false);
  chassis.visible = false;

  return {
    root,
    update(t: TelemetryFrame) {
      simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, body.position);
      simQuatToThree(t.bodyRotation, body.quaternion);
      _q.copy(body.quaternion).invert();
      for (let i = 0; i < t.corners.length; i++) {
        const c = t.corners[i]!;
        const s = c.id === 'f' ? slots.f : c.id === 'r' ? slots.r : undefined;
        if (!s) continue;
        if (s.order !== c.pointOrder) {
          s.order = c.pointOrder;
          s.ok = true;
          for (let k = 0; k < s.names.length; k++) {
            const j = c.pointOrder.indexOf(s.names[k]!);
            s.map[k] = j;
            if (j < 0) s.ok = false;
          }
        }
        show(s, s.ok);
        if (!s.ok) continue;
        const p = c.points;
        for (let k = 0; k < s.names.length; k++) {
          const j = s.map[k]! * 3;
          simToThree(p[j]!, p[j + 1]!, p[j + 2]!, _p);
          s.points[k]!.copy(_p).sub(body.position).applyQuaternion(_q);
        }
        if (s.id === 'f') front.update(frontAxle, frontJoint, c.steer, c.spin);
        else rear.update(s.byName, c.spin);
      }
      chassis.visible = slots.f.ok || slots.r.ok;
    },
    setHighlight(role: ComponentRole, corner: CornerId | 'all', on: boolean) {
      for (const id of ['f', 'r'] as const) {
        if (corner !== 'all' && corner !== id) continue;
        const roles: readonly ComponentRole[] = role === 'damper' || role === 'strut' ? ['damper', 'strut'] : [role];
        for (const r of roles) mats[id].setHighlight(r, on);
        if (role === 'spring') for (const m of springs[id]) m.emissiveIntensity = on ? HIGHLIGHT_INTENSITY : 0;
      }
    },
    inspect() {
      const f = front.inspect();
      const r = rear.inspect();
      return { meshes, front: { visible: front.steering.visible, ...f }, rear: { visible: rear.group.visible, ...r } };
    },
    dispose() {
      root.removeFromParent();
      front.dispose();
      rear.dispose();
      chassisGeo.dispose();
      mats.f.dispose();
      mats.r.dispose();
      palette.dispose();
      disposeMotoPalette(cosmetic);
      lens.dispose();
    },
  };
}

export const motoPlanarVisual: SuspensionVisualDefinition = {
  id: MOTO_PLANAR_VISUAL_ID,
  build: (suspension, vehicle) => buildMotoPlanar(suspension, vehicle),
};
