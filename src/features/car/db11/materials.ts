/**
 * DB11 re-materialing. The GLB ships 53 flat colour materials (no textures, no UVs); every one is mapped to one
 * of OUR finishes below, and meshes are merged per finish (draw-call budget, ARCHITECTURE §18).
 */
import { Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from 'three';

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

/** One material per finish (double-sided like the GLB). Body finishes later get the x-ray dither, the paint its flakes. */
export function createFinishMaterial(finish: Finish): Material {
  const m = make(finish);
  m.side = DoubleSide;
  return m;
}

function make(finish: Finish): Material {
  const std = (hex: number, metalness: number, roughness: number) => new MeshStandardMaterial({ color: srgb(hex), metalness, roughness });
  switch (finish) {
    case 'paint':
      // Deep metallic racing green under a hard clearcoat; flakes are added in shader (no UVs on this mesh).
      return new MeshPhysicalMaterial({ color: srgb(0x0c3324), metalness: 0.65, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.035 });
    case 'gloss-black':
      return new MeshPhysicalMaterial({ color: srgb(0x050607), metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
    case 'trim': {
      // Upward-facing diffuser/sill plastics otherwise mirror the bright sky at grazing angles and read light grey.
      const m = std(0x0b0c0d, 0.1, 0.5);
      m.envMapIntensity = 0.45;
      return m;
    }
    case 'underbody': {
      const m = std(0x16171a, 0.2, 0.7);
      m.envMapIntensity = 0.45;
      return m;
    }
    case 'chrome':
      return std(0xe6e8eb, 1, 0.06);
    case 'mirror':
      return std(0xd8dade, 1, 0.02);
    case 'glass':
      return new MeshPhysicalMaterial({ color: srgb(0x0b0e10), metalness: 0, roughness: 0.03, transparent: true, opacity: 0.82, envMapIntensity: 1.6, depthWrite: false });
    case 'lens':
      return new MeshPhysicalMaterial({ color: srgb(0xffffff), metalness: 0, roughness: 0.02, transparent: true, opacity: 0.12, envMapIntensity: 2, depthWrite: false });
    case 'tail-lens':
      return new MeshPhysicalMaterial({ color: srgb(0x3a0508), metalness: 0, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6, depthWrite: false });
    case 'reflector':
      return std(0xc9cdd2, 1, 0.12);
    case 'drl':
      // Above the bloom threshold (3, linear) so the light signature glows.
      return new MeshStandardMaterial({ color: srgb(0xffffff), emissive: srgb(0xf4f8ff), emissiveIntensity: 4, roughness: 0.4 });
    case 'tail':
      return new MeshStandardMaterial({ color: srgb(0x6a0a0e), emissive: srgb(0xff1a1a), emissiveIntensity: 1.2, roughness: 0.35 });
    case 'leather':
      return std(0x6e4128, 0, 0.62);
    case 'leather-dark':
      return std(0x2a1912, 0, 0.7);
    case 'interior':
      return std(0x121314, 0.4, 0.5);
    case 'engine':
      return std(0x232528, 0.6, 0.45);
    case 'engine-red':
      return std(0x8c1218, 0.2, 0.4);
    case 'tyre':
      return std(0x101112, 0, 0.88);
    case 'rim-face':
      // Machined/polished face.
      return std(0xb4b8bd, 1, 0.22);
    case 'rim-dark':
      return std(0x2b2e33, 0.9, 0.38);
    case 'disc':
      return std(0x6c6f74, 1, 0.42);
    case 'disc-hat':
      return std(0x3a3c40, 0.8, 0.45);
    case 'caliper':
      return new MeshPhysicalMaterial({ color: srgb(0x8e1016), metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  }
}
