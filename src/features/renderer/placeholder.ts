import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { SimHost } from '../../contracts/app';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { simQuatToThree, simToThree, type XYZ } from '../../contracts/units';

/** Track step for the centreline polyline, m. */
const TRACK_STEP = 2;
const CHASE_BACK = 9;
const CHASE_UP = 3.2;
const AIM_UP = 0.8;

/**
 * Walking-skeleton scene: track centreline, body box, one cylinder per wheel, posed from POSE fields.
 * shortcut: placeholder geometry only; the track (03-01), vehicle-view (03-03) and camera (04-01) features replace it.
 */
export function createPlaceholder(sim: SimHost) {
  const root = new Group();
  root.name = 'placeholder';
  root.add(new HemisphereLight(0xdfe8ff, 0x20242a, 2.5));

  const track = sim.current.track;
  const points: Vector3[] = [];
  const p: XYZ = { x: 0, y: 0, z: 0 };
  for (let s = 0; s <= track.length; s += TRACK_STEP) {
    track.toWorld(s, 0, p);
    const v = new Vector3();
    simToThree(p.x, p.y, p.z, v);
    points.push(v);
  }
  points.push(points[0]!.clone());
  const trackLine = new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0x7cf0d4 }));
  root.add(trackLine);

  const bodyMaterial = new MeshLambertMaterial({ color: 0x8a94a3 });
  const wheelMaterial = new MeshLambertMaterial({ color: 0x2a2e35 });
  const body = new Group();
  root.add(body);
  let box: Mesh | undefined;
  let wheels: Mesh[] = [];

  function build(): void {
    if (box) {
      body.remove(box);
      box.geometry.dispose();
    }
    for (const w of wheels) {
      root.remove(w);
      w.geometry.dispose();
    }
    const v = sim.current.vehicle;
    const width = 'track' in v.front ? v.front.track : 0.35;
    // Vehicle frame: origin on the ground under the CG; box spans the wheelbase plus overhangs.
    box = new Mesh(new BoxGeometry(v.wheelbase + 1.2, v.cgHeight, width), bodyMaterial);
    box.position.set(v.cgToFront - v.wheelbase / 2, v.cgHeight, 0);
    body.add(box);
    wheels = sim.frame.corners.map((c) => {
      const r = v[c.axle].tyre.radius;
      // Cylinder axis is local Y; the wheel spins about sim +Y, which is three -Z.
      const wheel = new Mesh(new CylinderGeometry(r, r, 0.22, 24).rotateX(Math.PI / 2), wheelMaterial);
      root.add(wheel);
      return wheel;
    });
  }
  build();

  const q = new Quaternion();
  const forward = new Vector3();
  const target = new Vector3();

  return {
    root,
    /** Re-read the vehicle and corner layout (call after 'sim:vehicle'). */
    rebuild: build,
    update(t: TelemetryFrame): void {
      simToThree(t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z, body.position);
      simQuatToThree(t.bodyRotation, body.quaternion);
      for (let i = 0; i < wheels.length; i++) {
        const c = t.corners[i];
        const w = wheels[i];
        if (!c || !w) continue;
        simToThree(c.wheelPosition.x, c.wheelPosition.y, c.wheelPosition.z, w.position);
        simQuatToThree(c.wheelRotation, w.quaternion);
      }
    },
    /** Chase camera behind the body (only while no camera feature poses it). */
    chase(camera: PerspectiveCamera): void {
      simQuatToThree(sim.frame.bodyRotation, q);
      forward.set(1, 0, 0).applyQuaternion(q);
      forward.y = 0;
      forward.normalize();
      camera.position.copy(body.position).addScaledVector(forward, -CHASE_BACK);
      camera.position.y += CHASE_UP;
      target.copy(body.position);
      target.y += AIM_UP;
      camera.lookAt(target);
    },
    dispose(): void {
      box?.geometry.dispose();
      for (const w of wheels) w.geometry.dispose();
      trackLine.geometry.dispose();
      (trackLine.material as LineBasicMaterial).dispose();
      bodyMaterial.dispose();
      wheelMaterial.dispose();
    },
  };
}
