// Scratch harness for 03-01 visual review (NOT committed): free camera placed in track coordinates.
import { Vector3 } from 'three';
import * as FEATURES from '../src/app/features';
import type { FeatureModule } from '../src/contracts/app';
import { CAMERA, RENDER } from '../src/contracts/services';
import { createApp } from '../src/kernel/app';

const q = new URLSearchParams(location.search);
const parse = (k: string, d: string) => (q.get(k) ?? d).split(',').map(Number);
let pose: (() => void) | undefined;
const camera: FeatureModule = {
  id: 'camera',
  requires: ['renderer'],
  phase: 'camera',
  init(ctx) {
    ctx.services.provide(CAMERA, { playShot() {}, clearShot() {}, transitioning: false });
    const render = ctx.services.get(RENDER);
    const track = ctx.sim.current.track;
    const at = parse('at', '0,0,3');
    const look = parse('look', '30,0,0');
    const fov = Number(q.get('fov') ?? 50);
    const p = { x: 0, y: 0, z: 0 };
    const a = new Vector3();
    const b = new Vector3();
    track.toWorld(at[0]!, at[1]!, p);
    a.set(p.x, p.z + at[2]!, -p.y);
    track.toWorld(look[0]!, look[1]!, p);
    b.set(p.x, p.z + look[2]!, -p.y);
    pose = () => {
      render.camera.fov = fov;
      render.camera.updateProjectionMatrix();
      render.camera.position.copy(a);
      render.camera.lookAt(b);
    };
  },
  update() {
    pose?.();
  },
};
const features = Object.values(FEATURES).map((f) => (f.id === 'camera' ? camera : f));
void createApp({ features }).start();
