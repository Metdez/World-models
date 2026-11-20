/**
 * Motorcycle finish palette. Every plain finish (powder-coated frame, black engine paint, machined fin edges,
 * brushed and polished alloy, chrome, chain, rubber, leather, lamps) is one texel of a one-row texture set
 * (colour, roughness/metalness, emissive), so a rigid body that mixes finishes is ONE draw call (ARCHITECTURE §18,
 * the 03-03/03-04 approach). Paint and glass keep their own materials. Colours are sRGB.
 */
import { DataTexture, Float32BufferAttribute, MeshStandardMaterial, NearestFilter, RGBAFormat, SRGBColorSpace, type BufferGeometry } from 'three';

export interface FinishSpec {
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  /** Emissive sRGB colour and strength (x EMISSIVE_SCALE). */
  readonly emissive?: readonly [color: number, strength: number];
}

export const MOTO_FINISH = {
  /** Gloss black powder coat (frame, yokes). */
  frame: { color: 0x0a0b0d, metalness: 0.2, roughness: 0.22 },
  /** Satin black plastics and brackets. */
  black: { color: 0x101114, metalness: 0.1, roughness: 0.5 },
  /** Black engine paint (cases, cylinder cores). */
  engine: { color: 0x1e1f23, metalness: 0.55, roughness: 0.34 },
  /** Machined fin edges and cover rims. */
  fin: { color: 0xb2b6bb, metalness: 1, roughness: 0.2 },
  /** Brushed aluminium. */
  alloy: { color: 0xa3a7ac, metalness: 1, roughness: 0.3 },
  /** Polished aluminium (rims, hubs, covers). */
  polished: { color: 0xd6d9dd, metalness: 1, roughness: 0.1 },
  /** Chrome / polished stainless (exhaust, mirrors, headlight bucket). */
  chrome: { color: 0xeceef1, metalness: 1, roughness: 0.04 },
  /** Dull steel (axles, bolts, spokes nipples). */
  steel: { color: 0x7c8086, metalness: 0.9, roughness: 0.32 },
  /** Bright zinc spokes. */
  spoke: { color: 0xc4c7cc, metalness: 1, roughness: 0.18 },
  chain: { color: 0x34363a, metalness: 0.85, roughness: 0.42 },
  /** Heat-blued header tint near the ports. */
  heat: { color: 0x9a8a78, metalness: 1, roughness: 0.16 },
  tread: { color: 0x0f1011, metalness: 0, roughness: 0.86 },
  sidewall: { color: 0x161719, metalness: 0, roughness: 0.68 },
  grip: { color: 0x1a1b1d, metalness: 0, roughness: 0.78 },
  leather: { color: 0x1d1611, metalness: 0, roughness: 0.6 },
  piping: { color: 0x6b4529, metalness: 0, roughness: 0.55 },
  dial: { color: 0x0c0d0e, metalness: 0.1, roughness: 0.25 },
  needle: { color: 0xf2f2f2, metalness: 0, roughness: 0.4, emissive: [0xffffff, 0.15] },
  lamp: { color: 0xffffff, metalness: 0, roughness: 0.3, emissive: [0xfff3e0, 1] },
  reflector: { color: 0xd9dce0, metalness: 1, roughness: 0.06 },
  tail: { color: 0x5c080c, metalness: 0, roughness: 0.3, emissive: [0xff1a1a, 0.55] },
  amber: { color: 0x8a4a06, metalness: 0, roughness: 0.3 },
  gold: { color: 0xc49a45, metalness: 1, roughness: 0.26 },
} as const satisfies Record<string, FinishSpec>;

export type MotoFinish = keyof typeof MOTO_FINISH;
const FINISHES = Object.keys(MOTO_FINISH) as MotoFinish[];
/** Emissive strength at map value 1 (lamps sit above the bloom threshold, as the DB11's lights). */
const EMISSIVE_SCALE = 4;

/** Sets every vertex's UV to the palette texel of `finish`. Returns the geometry. */
export function motoPaint<T extends BufferGeometry>(g: T, finish: MotoFinish): T {
  const u = (FINISHES.indexOf(finish) + 0.5) / FINISHES.length;
  const n = g.getAttribute('position').count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[2 * i] = u;
    uv[2 * i + 1] = 0.5;
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** Paints an ExtrudeGeometry's caps (group 0) and sides (group 1) with different finishes. */
export function motoPaintGroups<T extends BufferGeometry>(g: T, caps: MotoFinish, sides: MotoFinish): T {
  motoPaint(g, caps);
  const uv = g.getAttribute('uv') as Float32BufferAttribute;
  const u = (FINISHES.indexOf(sides) + 0.5) / FINISHES.length;
  const index = g.index;
  for (const group of g.groups) {
    if (group.materialIndex !== 1) continue;
    for (let k = group.start; k < group.start + group.count; k++) uv.setX(index ? index.getX(k) : k, u);
  }
  g.clearGroups();
  return g;
}

function texture(texel: (f: FinishSpec) => readonly [number, number, number], srgb: boolean): DataTexture {
  const data = new Uint8Array(FINISHES.length * 4);
  FINISHES.forEach((f, i) => {
    const [r, g, b] = texel(MOTO_FINISH[f]);
    data.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], i * 4);
  });
  const t = new DataTexture(data, FINISHES.length, 1, RGBAFormat);
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const rgb = (hex: number, k = 1) => [(((hex >> 16) & 255) / 255) * k, (((hex >> 8) & 255) / 255) * k, ((hex & 255) / 255) * k] as const;

/** Palette material (one draw for every plain finish of a rigid body). Dispose with `disposeMotoPalette`. */
export function createMotoPalette(name: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: texture((f) => rgb(f.color), true),
    // glTF convention: roughness in G, metalness in B; the maps multiply these factors.
    roughnessMap: texture((f) => [0, f.roughness, f.metalness], false),
    emissiveMap: texture((f) => (f.emissive ? rgb(f.emissive[0], f.emissive[1]) : [0, 0, 0]), true),
    emissiveIntensity: EMISSIVE_SCALE,
    metalness: 1,
    roughness: 1,
  });
  m.metalnessMap = m.roughnessMap;
  m.emissive.set(0xffffff);
  m.name = name;
  return m;
}

export function disposeMotoPalette(m: MeshStandardMaterial): void {
  m.map?.dispose();
  m.roughnessMap?.dispose();
  m.emissiveMap?.dispose();
  m.dispose();
}
