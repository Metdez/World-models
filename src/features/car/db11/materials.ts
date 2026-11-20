/**
 * DB11 re-materialing. The GLB ships 53 flat colour materials (no textures, no UVs); every one is mapped to one
 * of OUR finishes below. Plain finishes share palette materials (colour / roughness / metalness / emissive read from
 * a one-row texture through a per-part UV texel), so the whole car is a handful of draws (ARCHITECTURE §18).
 */
import { Color, DataTexture, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, NearestFilter, RGBAFormat, SRGBColorSpace, type Material } from 'three';

export type Finish =
  | 'paint'
  | 'gloss-black'
  | 'trim'
  | 'underbody'
  | 'chrome'
  | 'mirror'
  | 'glass'
  | 'lens'
  | 'tail-lens'
  | 'reflector'
  | 'drl'
  | 'tail'
  | 'leather'
  | 'leather-dark'
  | 'interior'
  | 'engine'
  | 'engine-red'
  | 'tyre'
  | 'rim-face'
  | 'rim-dark'
  | 'disc'
  | 'disc-hat'
  | 'caliper';

/** GLB material name -> finish, for meshes of the car body. Every material of the GLB must be listed (tested). */
export const BODY_FINISH: Readonly<Record<string, Finish>> = {
  amdb11: 'paint',
  amdb11_roof: 'gloss-black',
  amdb11_black_2: 'trim',
  amdb11_black_ext: 'trim',
  amdb11_grille: 'trim',
  amdb11_mirrors: 'trim',
  amdb11_amr: 'trim',
  amdb11_badging: 'trim',
  amdb11_grey: 'underbody',
  amdb11_misc: 'underbody',
  amdb11_misc_chrome: 'chrome',
  amdb11_badging_chrome: 'chrome',
  amdb11_mirror: 'mirror',
  amdb11_glass: 'glass',
  amdb11_glass_tint: 'glass',
  amdb11_rearglass: 'tail-lens',
  amdb11_lights: 'reflector',
  amdb11_headlight: 'reflector',
  amdb11_highbeam: 'reflector',
  amdb11_headlights: 'reflector',
  amdb11_reverselight: 'reflector',
  amdb11_runninglight: 'drl',
  amdb11_signal_L: 'drl',
  amdb11_signal_R: 'drl',
  amdb11_taillight: 'tail',
  amdb11_chmsl: 'tail',
  amdb11_signal_RL: 'tail',
  amdb11_signal_RR: 'tail',
  amdb11_leather: 'leather',
  amdb11_leather_2: 'leather-dark',
  amdb11_stitch_1: 'leather-dark',
  amdb11_stitch_2: 'leather-dark',
  amdb11_detail_2: 'leather-dark',
  amdb11_detail: 'interior',
  amdb11_interior: 'interior',
  amdb11_interior_light: 'interior',
  amdb11_finish: 'interior',
  amdb11_trim: 'interior',
  amdb11_gauge: 'interior',
  amdb11_gauge_speedo: 'interior',
  amdb11_screen_2: 'interior',
  amdb11_symbols2: 'interior',
  amdb11_wheel_grey: 'interior',
  amdb11_leather_3: 'engine',
  amdb11_silver: 'engine',
  amdb11_bolt: 'engine',
  amdb11_stickers: 'engine',
  etk_engine_i6: 'engine',
  etkc: 'engine',
  amdb11_engine: 'engine-red',
  amdb11_brake: 'disc',
  amdb11_caliper: 'caliper',
  'Scene_-_Root': 'tyre',
};

/** Overrides for wheel-corner meshes (the same GLB materials mean different parts there). */
export const WHEEL_FINISH: Readonly<Record<string, Finish>> = {
  amdb11_mirror: 'rim-face',
  amdb11_black_ext: 'rim-dark',
  amdb11_misc_chrome: 'disc-hat',
  amdb11_misc: 'disc-hat',
};

const srgb = (hex: number) => new Color(hex);

/** Plain (MeshStandard) finishes: sRGB colour, metalness, roughness, optional emissive sRGB colour x strength. */
interface Plain {
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly emissive?: readonly [color: number, strength: number];
}

const PLAIN: Partial<Record<Finish, Plain>> = {
  trim: { color: 0x0b0c0d, metalness: 0.1, roughness: 0.55 },
  // Rough and near-black: the diffuser and arch liners face the bright sky at grazing angles (read light grey).
  underbody: { color: 0x0b0c0d, metalness: 0, roughness: 0.92 },
  leather: { color: 0x6e4128, metalness: 0, roughness: 0.62 },
  'leather-dark': { color: 0x2a1912, metalness: 0, roughness: 0.7 },
  interior: { color: 0x121314, metalness: 0.4, roughness: 0.5 },
  engine: { color: 0x232528, metalness: 0.6, roughness: 0.45 },
  'engine-red': { color: 0x8c1218, metalness: 0.2, roughness: 0.4 },
  chrome: { color: 0xe6e8eb, metalness: 1, roughness: 0.06 },
  mirror: { color: 0xd8dade, metalness: 1, roughness: 0.02 },
  reflector: { color: 0xc9cdd2, metalness: 1, roughness: 0.12 },
  // Above the bloom threshold (3, linear) so the light signature glows.
  drl: { color: 0xffffff, metalness: 0, roughness: 0.4, emissive: [0xf4f8ff, 1] },
  // Strength is applied before the sRGB decode: 0.58 -> about 0.3 linear, x4 = 1.2.
  tail: { color: 0x6a0a0e, metalness: 0, roughness: 0.35, emissive: [0xff1a1a, 0.58] },
  tyre: { color: 0x101112, metalness: 0, roughness: 0.88 },
  // Machined/polished face.
  'rim-face': { color: 0xb4b8bd, metalness: 1, roughness: 0.22 },
  'rim-dark': { color: 0x2b2e33, metalness: 0.9, roughness: 0.38 },
  disc: { color: 0x6c6f74, metalness: 1, roughness: 0.42 },
  'disc-hat': { color: 0x3a3c40, metalness: 0.8, roughness: 0.45 },
  caliper: { color: 0x8e1016, metalness: 0.2, roughness: 0.3 },
};
/** Emissive strength at map value 1. */
const EMISSIVE_SCALE = 4;
const PLAIN_LIST = Object.keys(PLAIN) as Finish[];

/**
 * Palette a plain finish draws with: 'dark' plastics/interior get a weaker environment (upward-facing diffuser and
 * sill plastics otherwise mirror the bright sky at grazing angles and read light grey); 'bright' metals full env.
 * Finishes without a palette (paint, glass ...) get their own material.
 */
export function paletteOf(finish: Finish): 'dark' | 'bright' | null {
  if (!(finish in PLAIN)) return null;
  return ['chrome', 'mirror', 'reflector', 'drl', 'tail', 'tyre', 'rim-face', 'rim-dark', 'disc', 'disc-hat', 'caliper'].includes(finish) ? 'bright' : 'dark';
}

/** UV of a plain finish's texel in the palette textures. */
export function paletteUv(finish: Finish): readonly [number, number] {
  return [(PLAIN_LIST.indexOf(finish) + 0.5) / PLAIN_LIST.length, 0.5];
}

function paletteTexture(texel: (p: Plain) => readonly [number, number, number], srgbData: boolean): DataTexture {
  const data = new Uint8Array(PLAIN_LIST.length * 4);
  PLAIN_LIST.forEach((f, i) => {
    const [r, g, b] = texel(PLAIN[f]!);
    data.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], i * 4);
  });
  const t = new DataTexture(data, PLAIN_LIST.length, 1, RGBAFormat);
  t.magFilter = t.minFilter = NearestFilter;
  if (srgbData) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const rgb = (hex: number, k = 1) => [((hex >> 16) & 255) / 255 * k, ((hex >> 8) & 255) / 255 * k, (hex & 255) / 255 * k] as const;

/** Palette material: one draw for every plain finish of a mesh group. Dispose with disposePalette(). */
export function createPaletteMaterial(kind: 'dark' | 'bright'): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: paletteTexture((p) => rgb(p.color), true),
    // glTF convention: roughness in G, metalness in B.
    roughnessMap: paletteTexture((p) => [0, p.roughness, p.metalness], false),
    emissiveMap: paletteTexture((p) => (p.emissive ? rgb(p.emissive[0], p.emissive[1]) : [0, 0, 0]), true),
    emissive: srgb(0xffffff),
    emissiveIntensity: EMISSIVE_SCALE,
    // The maps multiply these factors.
    metalness: 1,
    roughness: 1,
    side: DoubleSide,
  });
  m.metalnessMap = m.roughnessMap;
  m.envMapIntensity = kind === 'dark' ? 0.45 : 1;
  return m;
}

export function disposePalette(m: MeshStandardMaterial): void {
  m.map?.dispose();
  m.roughnessMap?.dispose();
  m.emissiveMap?.dispose();
  m.dispose();
}

/** Own material for a finish that is not plain (double-sided like the GLB). */
export function createFinishMaterial(finish: Finish): Material {
  const m = make(finish);
  m.side = DoubleSide;
  return m;
}

function make(finish: Finish): Material {
  switch (finish) {
    case 'paint':
      // Deep metallic racing green under a hard clearcoat; flakes are added in shader (no UVs on this mesh). The hue
      // leans yellow-green: the metallic base tints the blue overcast sky it reflects, which read teal from above.
      return new MeshPhysicalMaterial({ color: srgb(0x103a1c), metalness: 0.6, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.035 });
    case 'gloss-black':
      return new MeshPhysicalMaterial({ color: srgb(0x050607), metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
    case 'glass':
      return new MeshPhysicalMaterial({ color: srgb(0x0b0e10), metalness: 0, roughness: 0.03, transparent: true, opacity: 0.82, envMapIntensity: 1.6, depthWrite: false });
    case 'lens':
      return new MeshPhysicalMaterial({ color: srgb(0xffffff), metalness: 0, roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 2, depthWrite: false });
    case 'tail-lens':
      return new MeshPhysicalMaterial({ color: srgb(0x3a0508), metalness: 0, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6, depthWrite: false });
    default:
      throw new Error(`db11: finish "${finish}" is plain; use its palette`);
  }
}
