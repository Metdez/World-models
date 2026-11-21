/**
 * Per-frame driver of the rings and marks (no DOM, no store: testable in node). Reads the frame's corners, maps each to
 * its ring (model.ts), orients the rings in the car's road plane by the wheel heading, and feeds the marks only from the
 * Manual Drive plant. Allocation-free per frame.
 */
import type { CornerFrame, TelemetryFrame } from '../../contracts/telemetry';
import type { VehicleDefinition } from '../../contracts/vehicle';
import type { Marks } from './marks';
import { axleModels, createRingState, ringOf, type AxleModel, type RingState } from './model';
import { RING_CORNERS, type Rings } from './rings';

/** Warn level rise / fall times, s of simulated time (instant with reduced motion). */
const WARN_RISE = 0.06;
const WARN_FALL = 0.25;
/** Mark darkness: base + span * how far past the limit. */
const MARK_BASE = 0.55;
const MARK_SPAN = 0.45;

export interface Vfx {
  readonly states: readonly RingState[];
  /** Warn level per corner, 0..1. */
  readonly warn: Float64Array;
  /** Four-corner vehicle with rings (false for the motorcycle). */
  readonly hasRings: boolean;
  setVehicle(vehicle: VehicleDefinition): void;
  /** One rendered frame. `ringsOn`: draw the rings; `reduced`: reduced motion (no warn easing). */
  update(t: TelemetryFrame, ringsOn: boolean, reduced: boolean): void;
}

export function createVfx(rings: Rings, marks: Marks): Vfx {
  let models: readonly [AxleModel, AxleModel] | null = null;
  let halfWidth: readonly [number, number] = [0.12, 0.12];
  const states: RingState[] = [createRingState(), createRingState(), createRingState(), createRingState()];
  const warn = new Float64Array(RING_CORNERS);
  let lastSim = Number.NaN;
  const n = { x: 0, y: 0, z: 1 };

  // the car's road plane from the four contact patches (sim frame)
  function plane(t: TelemetryFrame): void {
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let lx = 0;
    let ly = 0;
    let lz = 0;
    for (const c of t.corners) {
      const p = c.contactPatch;
      const a = c.axle === 'front' ? 0.5 : -0.5;
      const s = c.side * 0.5;
      fx += a * p.x;
      fy += a * p.y;
      fz += a * p.z;
      lx += s * p.x;
      ly += s * p.y;
      lz += s * p.z;
    }
    const nx = fy * lz - fz * ly;
    const ny = fz * lx - fx * lz;
    const nz = fx * ly - fy * lx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-6 && nz > 0) {
      n.x = nx / len;
      n.y = ny / len;
      n.z = nz / len;
    } else {
      n.x = 0;
      n.y = 0;
      n.z = 1;
    }
  }

  function writeRing(i: number, c: Readonly<CornerFrame>, st: RingState, w: number): void {
    const q = c.wheelRotation;
    // wheel forward axis (sim frame) = q * (1, 0, 0), projected onto the road plane
    let hx = 1 - 2 * (q.y * q.y + q.z * q.z);
    let hy = 2 * (q.x * q.y + q.w * q.z);
    let hz = 2 * (q.x * q.z - q.w * q.y);
    const d = hx * n.x + hy * n.y + hz * n.z;
    hx -= d * n.x;
    hy -= d * n.y;
    hz -= d * n.z;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
    hx /= hl;
    hy /= hl;
    hz /= hl;
    // left = n x h
    const lx = n.y * hz - n.z * hy;
    const ly = n.z * hx - n.x * hz;
    const lz = n.x * hy - n.y * hx;
    const p = c.contactPatch;
    // sim (x, y, z) -> three (x, z, -y)
    rings.write(i, p.x, p.z, -p.y, hx, hz, -hy, lx, lz, -ly, st.radius, st.dotX, st.dotY, w);
  }

  return {
    states,
    warn,
    get hasRings() {
      return models !== null;
    },
    setVehicle(v) {
      models = axleModels(v);
      halfWidth = v.class === 'car' ? [v.front.tyre.width * 0.45, v.rear.tyre.width * 0.45] : [0.06, 0.06];
      marks.clear();
      warn.fill(0);
      for (const s of states) {
        s.radius = 0;
        s.past = false;
        s.excess = 0;
      }
      lastSim = Number.NaN;
    },
    update(t, ringsOn, reduced) {
      const m = models;
      if (!m || t.corners.length !== RING_CORNERS) {
        rings.setCount(0);
        marks.breakAll();
        return;
      }
      const plant = t.drive.mode !== 'auto';
      const dt = Number.isFinite(lastSim) ? Math.min(0.1, Math.max(0, t.simTime - lastSim)) : 0;
      lastSim = t.simTime;
      if (ringsOn) plane(t);
      for (let i = 0; i < RING_CORNERS; i++) {
        const c = t.corners[i]!;
        const axle = c.axle === 'front' ? 0 : 1;
        const st = ringOf(c, m[axle]!, plant, states[i]!);
        const target = st.past ? 1 : 0;
        if (reduced) warn[i] = target;
        else if (target > warn[i]!) warn[i] = Math.min(1, warn[i]! + dt / WARN_RISE);
        else warn[i] = Math.max(0, warn[i]! - dt / WARN_FALL);
        if (ringsOn) writeRing(i, c, st, warn[i]!);
        const p = c.contactPatch;
        marks.feed(i, p.x, p.y, p.z, plant && st.past, MARK_BASE + MARK_SPAN * st.excess, halfWidth[axle]!);
      }
      rings.setCount(ringsOn ? RING_CORNERS : 0);
      marks.flush();
    },
  };
}
