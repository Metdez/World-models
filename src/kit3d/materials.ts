/**
 * Part materials. One colour per role from the contract palette (COMPONENT_COLORS), identical for every suspension
 * type and both vehicle classes; rubber, steel hardware, chrome rods and brake parts use their contract colours.
 * Metalness/roughness after the KRoshanK/AxleLab palette (MIT).
 *
 * Draw-call budget (ARCHITECTURE §18): a rigid body mixes finishes (arm + rubber bushes + steel sleeves) in ONE
 * mesh. Every finish is a texel of a tiny palette texture (colour map + roughness/metalness map); `paint()` sets a
 * part's UVs to its texel. Materials differ only by emissive highlight, so there is one per role per corner
 * (highlight = emissive in the part colours, never a colour change) plus one that never highlights.
 */
import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { BRAKE_COLORS, COMPONENT_COLORS, RUBBER_COLOR, type ComponentRole } from '../contracts/suspension';

export type Finish = ComponentRole | 'rubber' | 'steel' | 'chrome' | 'disc' | 'caliper';

/** [colour, metalness, roughness] per finish. */
const FINISH: Readonly<Record<Finish, readonly [color: number, metalness: number, roughness: number]>> = {
  'upper-arm': [COMPONENT_COLORS['upper-arm'], 0.8, 0.32],
  'lower-arm': [COMPONENT_COLORS['lower-arm'], 0.82, 0.3],
  'lateral-link': [COMPONENT_COLORS['lateral-link'], 0.8, 0.34],
  'trailing-link': [COMPONENT_COLORS['trailing-link'], 0.8, 0.34],
  'tie-rod': [COMPONENT_COLORS['tie-rod'], 0.55, 0.4],
  strut: [COMPONENT_COLORS.strut, 0.7, 0.3],
  spring: [COMPONENT_COLORS.spring, 0.5, 0.34],
  damper: [COMPONENT_COLORS.damper, 0.7, 0.3],
  upright: [COMPONENT_COLORS.upright, 0.62, 0.4],
  'anti-roll-bar': [COMPONENT_COLORS['anti-roll-bar'], 0.55, 0.38],
  fork: [COMPONENT_COLORS.fork, 0.75, 0.25],
  swingarm: [COMPONENT_COLORS.swingarm, 0.7, 0.35],
  linkage: [COMPONENT_COLORS.linkage, 0.8, 0.34],
  tyre: [COMPONENT_COLORS.tyre, 0, 0.9],
  rubber: [RUBBER_COLOR, 0.02, 0.85],
  steel: [0x8d9198, 0.9, 0.28],
  chrome: [0xdfe3e8, 1, 0.12],
  disc: [BRAKE_COLORS.disc, 0.75, 0.42],
  caliper: [BRAKE_COLORS.caliper, 0.35, 0.32],
};
const FINISHES = Object.keys(FINISH) as Finish[];

export const HIGHLIGHT_INTENSITY = 0.9;

/** Sets every vertex's UV to the palette texel of `finish`. Returns the geometry. */
export function paint(g: BufferGeometry, finish: Finish): BufferGeometry {
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

export interface Palette {
  /** sRGB colours (also the emissive map). */
  readonly map: DataTexture;
  /** G = roughness, B = metalness (three's channel convention). */
  readonly pbr: DataTexture;
  dispose(): void;
}

function texture(data: Uint8Array): DataTexture {
  const t = new DataTexture(data, FINISHES.length, 1, RGBAFormat, UnsignedByteType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createPalette(): Palette {
  const rgb = new Uint8Array(FINISHES.length * 4);
  const pbr = new Uint8Array(FINISHES.length * 4);
  FINISHES.forEach((f, i) => {
    const [hex, metal, rough] = FINISH[f];
    rgb.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], i * 4);
    pbr.set([0, Math.round(rough * 255), Math.round(metal * 255), 255], i * 4);
  });
  const map = texture(rgb);
  map.colorSpace = SRGBColorSpace;
  const pbrTex = texture(pbr);
  return {
    map,
    pbr: pbrTex,
    dispose() {
      map.dispose();
      pbrTex.dispose();
    },
  };
}

export interface PartMaterials {
  /** Palette material per role (highlightable). The 'spring' one is a plain-colour material reserved for the coil shader. */
  readonly roles: Readonly<Record<ComponentRole, MeshStandardMaterial>>;
  /** Palette material that never highlights (chassis brackets, brake disc, gaiters). */
  readonly plain: MeshStandardMaterial;
  setHighlight(role: ComponentRole, on: boolean): void;
  dispose(): void;
}

function paletteMaterial(p: Palette, name: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map: p.map, roughnessMap: p.pbr, metalnessMap: p.pbr, emissiveMap: p.map, roughness: 1, metalness: 1 });
  m.emissive.set(0xffffff);
  m.emissiveIntensity = 0;
  m.name = name;
  return m;
}

/** One set per corner; textures come from the shared palette (disposed by its owner). */
export function createPartMaterials(palette: Palette): PartMaterials {
  const roles = {} as Record<ComponentRole, MeshStandardMaterial>;
  for (const role of Object.keys(COMPONENT_COLORS) as ComponentRole[]) roles[role] = paletteMaterial(palette, `part:${role}`);
  const [hex, metalness, roughness] = FINISH.spring;
  const spring = new MeshStandardMaterial({ color: new Color(hex), metalness, roughness });
  spring.emissive.set(hex);
  spring.emissiveIntensity = 0;
  spring.name = 'part:spring';
  roles.spring.dispose();
  roles.spring = spring;
  const plain = paletteMaterial(palette, 'part:plain');
  const all = [...Object.values(roles), plain];
  return {
    roles,
    plain,
    setHighlight(role, on) {
      roles[role].emissiveIntensity = on ? HIGHLIGHT_INTENSITY : 0;
    },
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}
