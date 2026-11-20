/**
 * Vehicle-view runtime: mounts the current vehicle's visual and EVERY suspension visual of that vehicle (built once,
 * hidden, compiled together so a swap never compiles a shader), shows the active one, fades x-ray and routes
 * highlights. Works with no suspension visual registered (the car then shows its own brakes).
 */
import type { Object3D } from 'three';
import type { Registries } from '../../contracts/app';
import type { SuspensionVisual, VehicleVisual, VisualContext } from '../../contracts/services';
import type { ComponentRole } from '../../contracts/suspension';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { CornerId } from '../../contracts/units';
import type { VehicleDefinition } from '../../contracts/vehicle';

/** x-ray fade duration, s (0 -> 1). */
export const XRAY_FADE_S = 0.4;

/**
 * Convention with vehicle visuals: an Object3D whose `userData.replacedBySuspension` is true is a stand-in part
 * (e.g. the car mesh's own brake disc and caliper) hidden while a suspension visual is mounted, which draws its own.
 */
export const REPLACED_BY_SUSPENSION = 'replacedBySuspension';

interface Highlight {
  role: ComponentRole;
  corner: CornerId | 'all';
  remaining: number;
}

/** Makes every object under `roots` visible (programs are compiled only for visible objects); returns the undo. */
export function forceVisible(roots: readonly Object3D[]): () => void {
  const hidden: Object3D[] = [];
  for (const r of roots)
    r.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
  return () => {
    for (const o of hidden) o.visible = false;
  };
}

export function createVehicleView(registries: Registries, visualCtx: VisualContext) {
  let generation = 0;
  let vehicleVisual: VehicleVisual | null = null;
  let standIns: Object3D[] = [];
  const suspensionVisuals = new Map<string, SuspensionVisual>();
  const removers: (() => void)[] = [];
  let active: SuspensionVisual | null = null;
  let xray = 0;
  let xrayTarget = 0;
  let xrayInstant = false;
  const highlights: Highlight[] = [];

  function clear(): void {
    for (const remove of removers.splice(0)) remove();
    vehicleVisual?.dispose();
    vehicleVisual = null;
    for (const v of suspensionVisuals.values()) v.dispose();
    suspensionVisuals.clear();
    standIns = [];
    active = null;
  }

  function show(suspensionId: string): void {
    const next = suspensionVisuals.get(suspensionId) ?? null;
    if (next !== active)
      for (const h of highlights) {
        active?.setHighlight(h.role, h.corner, false);
        next?.setHighlight(h.role, h.corner, true);
      }
    active = next;
    for (const [id, v] of suspensionVisuals) v.root.visible = id === suspensionId;
    for (const o of standIns) o.visible = active === null;
  }

  return {
    /** Loads `vehicle`'s visual and pre-builds all of its suspension visuals; resolves once compiled. */
    async load(vehicle: VehicleDefinition, suspensionId: string, frame: () => TelemetryFrame): Promise<void> {
      const gen = ++generation;
      clear();
      const def = registries.vehicleVisuals.get(vehicle.visualKey);
      const visual = def ? await def.load(vehicle, visualCtx) : null;
      if (gen !== generation) {
        visual?.dispose();
        return;
      }
      vehicleVisual = visual;
      const roots: Object3D[] = [];
      if (visual) {
        roots.push(visual.root);
        visual.root.traverse((o) => {
          if (o.userData[REPLACED_BY_SUSPENSION] === true) standIns.push(o);
        });
      }
      for (const id of vehicle.suspensions) {
        const suspension = registries.suspensions.get(id);
        const builder = suspension && registries.suspensionVisuals.get(suspension.visualKey);
        if (!suspension || !builder) continue;
        const sv = builder.build(suspension, vehicle, visualCtx);
        suspensionVisuals.set(id, sv);
        roots.push(sv.root);
      }
      for (const r of roots) removers.push(visualCtx.render.add(r));
      // Compile everything at once: all suspension visuals and the x-ray materials, posed at the current frame.
      const t = frame();
      visual?.update(t);
      visual?.setXray(1);
      const restore = forceVisible(roots);
      try {
        const { renderer, scene, camera } = visualCtx.render;
        // compileAsync warns (once) where KHR_parallel_shader_compile is missing (e.g. Firefox, SwiftShader);
        // there the synchronous compile does the same work behind the loading overlay.
        if (renderer.extensions.has('KHR_parallel_shader_compile')) await visualCtx.render.compile();
        else renderer.compile(scene, camera);
      } finally {
        restore();
        visual?.setXray(xray);
      }
      if (gen !== generation) return;
      show(suspensionId);
    },

    setSuspension: show,

    /** x-ray on/off; `instant` skips the fade (reduced motion). */
    setXray(on: boolean, instant: boolean): void {
      xrayTarget = on ? 1 : 0;
      xrayInstant = instant;
    },

    highlight(role: ComponentRole, corner: CornerId | 'all', durationMs: number): void {
      let h = highlights.find((x) => x.role === role && x.corner === corner);
      if (!h) highlights.push((h = { role, corner, remaining: 0 }));
      h.remaining = durationMs / 1000;
      active?.setHighlight(role, corner, true);
    },

    /** Per frame; allocates nothing. */
    update(t: TelemetryFrame, dt: number): void {
      if (xray !== xrayTarget) {
        const step = xrayInstant ? 1 : dt / XRAY_FADE_S;
        xray = xrayTarget > xray ? Math.min(xrayTarget, xray + step) : Math.max(xrayTarget, xray - step);
        vehicleVisual?.setXray(xray);
      }
      for (let i = highlights.length - 1; i >= 0; i--) {
        const h = highlights[i]!;
        h.remaining -= dt;
        if (h.remaining > 0) continue;
        active?.setHighlight(h.role, h.corner, false);
        highlights[i] = highlights[highlights.length - 1]!;
        highlights.length--;
      }
      vehicleVisual?.update(t);
      active?.update(t);
    },

    /** Test/debug view of the mounted state. */
    get state() {
      return { vehicle: vehicleVisual, suspensions: suspensionVisuals, active, xray, highlights: highlights.length, standIns };
    },

    dispose(): void {
      generation++;
      clear();
    },
  };
}

export type VehicleView = ReturnType<typeof createVehicleView>;
