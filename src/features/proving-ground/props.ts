/**
 * Annex props: one InstancedMesh of traffic cones (a procedural lathe, vertex-coloured orange with a white band, on
 * a square base) and one merged mesh of station signboards whose faces read the station names from a canvas atlas
 * (the track's signboard style: dark board, accent bar, Geist Sans). Heights from the GroundWorld.
 */
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GroundHit, GroundWorld, WorldDefinition } from '../../contracts/world';

const ORANGE = [1, 0.22, 0.02] as const;
const WHITE = [0.86, 0.86, 0.86] as const;
/** Cone profile (radius, height) m: 0.5 m cone, reflective band 0.24-0.36 m. */
const PROFILE = [
  [0.155, 0.03],
  [0.135, 0.12],
  [0.112, 0.24],
  [0.097, 0.3],
  [0.083, 0.36],
  [0.02, 0.495],
  [0, 0.5],
] as const;
const BAND: readonly [number, number] = [0.24, 0.36];

function coloured(g: BufferGeometry, colourAt: (y: number) => readonly [number, number, number]): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const c = new Float32Array(pos.count * 3);
  // one colour per triangle (by its centre height): crisp bands
  for (let i = 0; i < pos.count; i += 3) {
    const rgb = colourAt((pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3);
    for (let k = 0; k < 3; k++) c.set(rgb, (i + k) * 3);
  }
  ng.setAttribute('color', new BufferAttribute(c, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** Traffic cone, origin on the ground. */
export function coneGeometry(): BufferGeometry {
  const lathe = new LatheGeometry(
    PROFILE.map(([r, y]) => new Vector2(r, y)),
    20,
  );
  const body = coloured(lathe, (y) => (y > BAND[0] && y < BAND[1] ? WHITE : ORANGE));
  const base = coloured(new BoxGeometry(0.38, 0.03, 0.38).translate(0, 0.015, 0), () => ORANGE);
  return mergeGeometries([body, base])!;
}

export function createCones(world: GroundWorld, def: WorldDefinition): InstancedMesh | undefined {
  const cones = def.props.filter((p) => p.kind === 'cone');
  if (cones.length === 0) return undefined;
  const mesh = new InstancedMesh(coneGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), cones.length);
  mesh.name = 'annex-cones';
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  cones.forEach((c, i) => {
    m.compose(new Vector3(c.x, world.sample(c.x, c.y, NaN, hit).h, -c.y), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Atlas: one column of 1024 x 256 cells; the last cell is plain board colour for the body and posts. */
const CELL_W = 1024;
const CELL_H = 256;
const BOARD = { width: 2.6, height: 0.65, depth: 0.08, lift: 0.75, post: 0.07 } as const;

function drawAtlas(names: readonly string[], fontFamily: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W;
  canvas.height = CELL_H * (names.length + 1);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, canvas.width, canvas.height);
  names.forEach((name, i) => {
    const y = i * CELL_H;
    g.fillStyle = '#7cf0d4'; // --accent
    g.fillRect(56, y + 64, 14, CELL_H - 128);
    g.fillStyle = '#edeef0'; // --text-1
    let size = 104;
    g.font = `600 ${size}px ${fontFamily}`;
    g.textBaseline = 'middle';
    while (g.measureText(name.toUpperCase()).width > CELL_W - 160 && size > 56) g.font = `600 ${(size -= 4)}px ${fontFamily}`;
    g.fillText(name.toUpperCase(), 112, y + CELL_H / 2 + 4);
  });
  return canvas;
}

function toCell(g: BufferGeometry, i: number, rows: number): BufferGeometry {
  const uv = g.getAttribute('uv') as BufferAttribute;
  const v0 = 1 - (i + 1) / rows;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), v0 + uv.getY(k) / rows);
  return g.index ? g.toNonIndexed() : g;
}

/** Station signboards (world props `sign`), each facing its prop heading. Needs a DOM canvas. */
export async function createSigns(world: GroundWorld, def: WorldDefinition): Promise<Mesh | undefined> {
  const signs = def.props.filter((p) => p.kind === 'sign');
  if (signs.length === 0) return undefined;
  const names = signs.map((s) => def.stations.find((st) => st.id === s.station)?.name ?? s.station);
  const fontFamily = '"Geist Sans", system-ui, sans-serif';
  try {
    await document.fonts.load(`600 104px ${fontFamily}`);
  } catch {
    // fall back to the system face
  }
  const rows = names.length + 1;
  const map = new CanvasTexture(drawAtlas(names, fontFamily));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const q = new Quaternion();
  const m = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const parts: BufferGeometry[] = [];
  const top = BOARD.lift + BOARD.height;
  signs.forEach((s, i) => {
    // three +Z of the board -> world direction of `heading`: rotation heading + pi/2 about three Y
    q.setFromAxisAngle(up, s.heading + Math.PI / 2);
    m.compose(new Vector3(s.x, world.sample(s.x, s.y, NaN, hit).h, -s.y), q, new Vector3(1, 1, 1));
    const face = toCell(new PlaneGeometry(BOARD.width, BOARD.height), i, rows).translate(0, BOARD.lift + BOARD.height / 2, BOARD.depth / 2 + 0.002);
    const body = toCell(new BoxGeometry(BOARD.width + 0.06, BOARD.height + 0.06, BOARD.depth), names.length, rows).translate(0, BOARD.lift + BOARD.height / 2, 0);
    const posts = [-1, 1].map((k) =>
      toCell(new BoxGeometry(BOARD.post, top, BOARD.post), names.length, rows).translate((k * BOARD.width) / 3, top / 2 - 0.1, -BOARD.depth / 2 - BOARD.post / 2),
    );
    for (const g of [face, body, ...posts]) parts.push(g.applyMatrix4(m));
  });
  const mesh = new Mesh(mergeGeometries(parts)!, new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.1 }));
  mesh.name = 'annex-signs';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
