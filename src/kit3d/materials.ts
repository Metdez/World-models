/**
 * Part materials. One colour per role from the contract palette (COMPONENT_COLORS), identical for every suspension
 * type and both vehicle classes; rubber, steel hardware, chrome rods and brake parts use their contract colours.
 * Metalness/roughness after the KRoshanK/AxleLab palette (MIT). Highlight = emissive in the role colour (never a
 * colour change). One set per corner so a highlight can target one corner.
 */
import { Color, MeshStandardMaterial } from 'three';
import { BRAKE_COLORS, COMPONENT_COLORS, RUBBER_COLOR, type ComponentRole } from '../contracts/suspension';

const FINISH: Readonly<Record<ComponentRole, readonly [metalness: number, roughness: number]>> = {
  'upper-arm': [0.8, 0.32],
  'lower-arm': [0.82, 0.3],
  'lateral-link': [0.8, 0.34],
  'trailing-link': [0.8, 0.34],
  'tie-rod': [0.55, 0.4],
  strut: [0.7, 0.3],
  spring: [0.5, 0.34],
  damper: [0.7, 0.3],
  upright: [0.62, 0.4],
  'anti-roll-bar': [0.55, 0.38],
  fork: [0.75, 0.25],
  swingarm: [0.7, 0.35],
  linkage: [0.8, 0.34],
  tyre: [0, 0.9],
};

export const HIGHLIGHT_INTENSITY = 0.6;
const STEEL = 0x8d9198;
const CHROME = 0xdfe3e8;

export interface PartMaterials {
  /** Fresh material per role (the 'spring' one is reserved for the coil shader). */
  readonly roles: Readonly<Record<ComponentRole, MeshStandardMaterial>>;
  readonly rubber: MeshStandardMaterial;
  /** Fasteners, ball studs, bushing sleeves, seats. */
  readonly steel: MeshStandardMaterial;
  /** Damper rods. */
  readonly chrome: MeshStandardMaterial;
  readonly disc: MeshStandardMaterial;
  readonly caliper: MeshStandardMaterial;
  setHighlight(role: ComponentRole, on: boolean): void;
  dispose(): void;
}

function standard(color: number, metalness: number, roughness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), metalness, roughness });
}

export function createPartMaterials(): PartMaterials {
  const roles = {} as Record<ComponentRole, MeshStandardMaterial>;
  for (const role of Object.keys(COMPONENT_COLORS) as ComponentRole[]) {
    const [m, r] = FINISH[role];
    const mat = standard(COMPONENT_COLORS[role], m, r);
    mat.emissive.set(COMPONENT_COLORS[role]);
    mat.emissiveIntensity = 0;
    mat.name = `part:${role}`;
    roles[role] = mat;
  }
  const rubber = standard(RUBBER_COLOR, 0.02, 0.85);
  const steel = standard(STEEL, 0.9, 0.28);
  const chrome = standard(CHROME, 1, 0.12);
  const disc = standard(BRAKE_COLORS.disc, 0.75, 0.42);
  const caliper = standard(BRAKE_COLORS.caliper, 0.35, 0.32);
  const all = [...Object.values(roles), rubber, steel, chrome, disc, caliper];
  return {
    roles,
    rubber,
    steel,
    chrome,
    disc,
    caliper,
    setHighlight(role, on) {
      roles[role].emissiveIntensity = on ? HIGHLIGHT_INTENSITY : 0;
    },
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}
