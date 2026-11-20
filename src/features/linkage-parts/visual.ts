/**
 * `spatial-linkage` SuspensionVisual: procedural parts for any car AxleLinkage (MacPherson, double wishbone,
 * multi-link ... are data). Four corners plus the chassis-fixed axle parts (steering-rack housing, anti-roll-bar
 * torso). Driven only by CornerFrame.pointOrder/points/spin (POSE, sim world frame -> three via simToThree).
 */
import { Group, Mesh, Vector3, type BufferGeometry } from 'three';
import type { SuspensionVisual } from '../../contracts/services';
import type { CarSuspensionDefinition, ComponentRole, SuspensionDefinition } from '../../contracts/suspension';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { simToThree, type AxleId, type CornerId } from '../../contracts/units';
import type { VehicleDefinition } from '../../contracts/vehicle';
import { createPalette, createPartMaterials, paint } from '../../kit3d/materials';
import { bakedDisc, bakedTube, bellowsGeometry, mergeParts } from '../../kit3d/tube';
import { ARB, buildCorner, type Capsule, type CornerVisual } from './corner';
import { cornerLayout, restPoints } from './layout';

export const VISUAL_ID = 'spatial-linkage';

export interface SpatialLinkageVisual extends SuspensionVisual {
  /** Debug/test: part capsules and wheel axes per corner at the last update. */
  inspect(): Record<string, { capsules: Capsule[]; wheel: { centre: Vector3; axis: Vector3 }; visible: boolean }>;
}

interface CornerSlot {
  readonly id: CornerId;
  readonly visual: CornerVisual;
  readonly names: readonly string[];
  readonly points: Vector3[];
  /** Index into CornerFrame.pointOrder per name; resolved when pointOrder changes. */
  readonly map: Int32Array;
  order: readonly string[] | null;
  ok: boolean;
}

const CORNERS: readonly { id: CornerId; axle: AxleId; side: 1 | -1 }[] = [
  { id: 'fl', axle: 'front', side: 1 },
  { id: 'fr', axle: 'front', side: -1 },
  { id: 'rl', axle: 'rear', side: 1 },
  { id: 'rr', axle: 'rear', side: -1 },
];

export function buildSpatialLinkage(suspension: SuspensionDefinition, vehicle: VehicleDefinition): SpatialLinkageVisual {
  if (suspension.vehicleClass !== 'car' || vehicle.class !== 'car') throw new Error(`${VISUAL_ID}: car suspensions only (got "${suspension.id}")`);
  const def: CarSuspensionDefinition = suspension;
  const root = new Group();
  root.name = `${VISUAL_ID}:${def.id}`;
  const gaiter = paint(bellowsGeometry(0.02, 0.011, 6, 0.005), 'rubber');
  const shared = { gaiter };
  const owned: BufferGeometry[] = [gaiter];
  const palette = createPalette();
  const axleX: Record<AxleId, number> = { front: vehicle.cgToFront, rear: -(vehicle.wheelbase - vehicle.cgToFront) };

  const slots: CornerSlot[] = CORNERS.map(({ id, axle, side }) => {
    const linkage = def.axles[axle];
    const layout = cornerLayout(linkage);
    const visual = buildCorner({
      layout,
      rest: restPoints(linkage, layout, axleX[axle], side),
      side,
      camber: linkage.alignment.camber,
      toe: linkage.alignment.toe,
      materials: createPartMaterials(palette),
      shared,
    });
    visual.group.name = id;
    visual.group.visible = false;
    root.add(visual.group);
    return { id, visual, names: layout.names, points: layout.names.map(() => new Vector3()), map: new Int32Array(layout.names.length), order: null, ok: false };
  });

  // The chassis is one rigid body: every corner's brackets/top mounts and the rack housing are ONE mesh, and the
  // anti-roll-bar torsos one mesh per axle (highlightable), all driven by the front-left corner's chassis frame.
  const chassisParts: BufferGeometry[] = slots.flatMap((s) => [...s.visual.chassisParts]);
  const torsos: Mesh[] = [];
  for (const [left, right] of [
    [slots[0]!, slots[1]!],
    [slots[2]!, slots[3]!],
  ] as const) {
    const L = left.visual;
    const Rv = right.visual;
    if (L.arbTorso && Rv.arbTorso) {
      const axis = new Vector3(0, 0, 1);
      const mounts = [L.arbTorso, Rv.arbTorso].map((p) => p.clone().addScaledVector(axis, -Math.sign(p.z) * 0.12));
      const g = mergeParts([
        paint(bakedTube(L.arbTorso, Rv.arbTorso, ARB.radius), 'anti-roll-bar'),
        ...mounts.map((p) => paint(bakedDisc(p, axis, ARB.radius * 2.1, 0.034), 'rubber')),
        ...mounts.map((p) => paint(bakedDisc(p.clone().setY(p.y + ARB.radius * 1.7), axis, ARB.radius * 1.2, 0.04), 'steel')),
      ]);
      owned.push(g);
      const o = new Mesh(g, L.materials.roles['anti-roll-bar']);
      o.name = `anti-roll-bar-${left.id}`;
      torsos.push(o);
    }
    if (L.rackEnd && Rv.rackEnd) {
      const a = L.rackEnd;
      const b = Rv.rackEnd;
      const dir = new Vector3().subVectors(b, a).normalize();
      const pinion = new Vector3().lerpVectors(a, b, 0.3);
      chassisParts.push(
        ...[
          bakedTube(a, b, 0.021),
          bakedTube(a, a.clone().addScaledVector(dir, 0.05), 0.026),
          bakedTube(b.clone().addScaledVector(dir, -0.05), b, 0.026),
          bakedTube(pinion, pinion.clone().setY(a.y + 0.09), 0.024),
        ].map((g) => paint(g, 'steel')),
      );
    }
  }
  const chassis = new Mesh(mergeParts(chassisParts), slots[0]!.visual.materials.plain);
  chassis.name = 'chassis';
  owned.push(chassis.geometry);
  // Body-fixed meshes posed by the front-left chassis frame (one array, reused every frame).
  const followers = [chassis, ...torsos];
  for (const o of followers) {
    o.matrixAutoUpdate = false;
    o.castShadow = true;
    o.receiveShadow = true;
    o.visible = false;
    root.add(o);
  }

  const aliases = (role: ComponentRole): readonly ComponentRole[] => (role === 'damper' || role === 'strut' ? ['damper', 'strut'] : [role]);

  return {
    root,
    update(t: TelemetryFrame) {
      for (let i = 0; i < t.corners.length; i++) {
        const c = t.corners[i]!;
        let slot: CornerSlot | undefined;
        for (let k = 0; k < slots.length; k++) if (slots[k]!.id === c.id) slot = slots[k];
        if (!slot) continue;
        if (slot.order !== c.pointOrder) {
          slot.order = c.pointOrder;
          slot.ok = true;
          for (let k = 0; k < slot.names.length; k++) {
            const j = c.pointOrder.indexOf(slot.names[k]!);
            slot.map[k] = j;
            if (j < 0) slot.ok = false;
          }
        }
        slot.visual.group.visible = slot.ok;
        if (!slot.ok) continue;
        const p = c.points;
        for (let k = 0; k < slot.names.length; k++) {
          const j = slot.map[k]! * 3;
          simToThree(p[j]!, p[j + 1]!, p[j + 2]!, slot.points[k]!);
        }
        slot.visual.update(slot.points, c.spin);
      }
      const front = slots[0]!;
      for (const o of followers) {
        o.visible = front.ok;
        o.matrix.copy(front.visual.chassis);
        o.matrixWorldNeedsUpdate = true;
      }
    },
    setHighlight(role, corner, on) {
      for (const s of slots) if (corner === 'all' || corner === s.id) for (const r of aliases(role)) s.visual.materials.setHighlight(r, on);
    },
    inspect() {
      return Object.fromEntries(slots.map((s) => [s.id, { capsules: s.visual.capsules(), wheel: s.visual.wheel(), visible: s.visual.group.visible }]));
    },
    dispose() {
      root.removeFromParent();
      for (const s of slots) {
        s.visual.dispose();
        s.visual.materials.dispose();
      }
      for (const g of owned) g.dispose();
      palette.dispose();
    },
  };
}
