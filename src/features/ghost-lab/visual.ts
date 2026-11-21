/**
 * The ghost car: a second instance of the vehicle's own visual (VehicleVisualDefinition from the registry, contract
 * only), switched to its x-ray mode, which shows its fresnel ghost shell (ARCHITECTURE-M2 §7.14). Prepared once:
 * the shell's opaque siblings (the dithered-away body) and parts the visual marks as replaced by the suspension visual
 * are hidden, the wheels take the shell's own material, nothing casts or receives shadows, and the shell is tinted with
 * the ghost colour. A handful of draw calls (DRAW_BUDGET is the §14 cap).
 */
import { Color, type Material, type Mesh, type Object3D } from 'three';
import type { VehicleVisual } from '../../contracts/services';

export const DRAW_BUDGET = 40;
/** Face-on fill and rim exponent of the ghost shell (the x-ray look uses a fainter fill and a tighter rim). */
const GHOST_BASE = 0.05;
const GHOST_POWER = 2;

const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (isMesh(o)) out.push(o);
  });
  return out;
}

/** Visible meshes = draw calls of the ghost (one material each). */
export function drawCalls(root: Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if (isMesh(o)) n++;
  });
  return n;
}

/**
 * Turns a freshly loaded vehicle visual into the ghost. Returns false (and leaves it hidden) when the visual has no
 * x-ray shell to show: the caller then shows traces only.
 */
export function prepareGhost(visual: VehicleVisual, colour: string): boolean {
  const all = meshes(visual.root);
  const hiddenBefore = new Set(all.filter((m) => !m.visible));
  visual.setXray(1);
  const shell = all.find((m) => hiddenBefore.has(m) && m.visible);
  if (!shell) {
    visual.root.visible = false;
    return false;
  }
  const shellMaterial = shell.material as Material & {
    uniforms?: Record<string, { value: unknown }>;
  };
  // the shell's own look, a little more body than the x-ray rim so the ghost reads at follow distance (uniforms the
  // shell may not have are left alone)
  const u = shellMaterial.uniforms;
  const tint = u?.uColor?.value;
  if (tint instanceof Color) tint.set(colour);
  if (u?.uBase && typeof u.uBase.value === 'number') u.uBase.value = GHOST_BASE;
  if (u?.uPower && typeof u.uPower.value === 'number') u.uPower.value = GHOST_POWER;
  for (const m of all) {
    m.castShadow = false;
    m.receiveShadow = false;
    if (m === shell) continue;
    if (m.parent === shell.parent || m.userData.replacedBySuspension === true || !m.visible) m.visible = false;
    else m.material = shellMaterial; // wheels: the same fresnel rim
  }
  shell.renderOrder = 11;
  return drawCalls(visual.root) <= DRAW_BUDGET;
}
