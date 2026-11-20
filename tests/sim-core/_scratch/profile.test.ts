import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mesh, Object3D, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { it } from 'vitest';
import { buildDb11 } from '../../../src/features/car/db11/visual';
import { gtCoupe } from '../../../src/sim-core/content/gt-coupe';
const GLB = fileURLToPath(new URL('../../../assets-src/car/aston-martin-db11.glb', import.meta.url));
it('profile', async () => {
  const buf = readFileSync(GLB);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const v = buildDb11(gltf.scene as Object3D, gtCoupe);
  for (const id of ['fl', 'rl']) {
    const g = (v.root.getObjectByName(`${id}:wheel`) as Mesh).geometry;
    const p = g.getAttribute('position'); const w = new Vector3();
    const bins = new Map<number, [number, number]>();
    for (let i = 0; i < p.count; i++) { w.fromBufferAttribute(p, i); const ax = -w.z; const r = Math.hypot(w.x, w.y); const b = Math.round(ax*100); const e = bins.get(b) ?? [Infinity, 0]; bins.set(b, [Math.min(e[0], r), Math.max(e[1], r)]); }
    console.log(id, [...bins.entries()].sort((a,b)=>a[0]-b[0]).map(([b,[mn,mx]])=>`ax${b}cm r${(mn*1000).toFixed(0)}-${(mx*1000).toFixed(0)}`).join(' | '));
  }
}, 60000);
