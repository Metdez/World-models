/**
 * Friction-ring mapping (ARCHITECTURE-M2 §10.5; research m2/19 §6, m2/13 device 1). Pure: CornerFrame values in, ring
 * geometry out. Every size comes from the simulation's own model values (capacity, fx, fy, slips); nothing is tuned to
 * look right, and nothing here is shown as a number.
 *   radius = RING_RADIUS * sqrt(capacity / static capacity)  (load transfer and surface grip grow / shrink the ring)
 *   dot    = (fx, fy) / capacity * radius, wheel frame (x along the wheel heading, y left)
 * Past the limit:
 *   plant (manual / returning / replay): the tyre's normalised combined slip is beyond the peak of its force curve, the
 *     plant's own definition (sim-core drive/tyre.ts). |F| <= capacity always holds there (the resultant never leaves the
 *     circle), so the dot reaches the ring at the limit and stays on it while the tyre slides.
 *   auto: the demand estimate gripUse > 1 (Auto has no slip state; the dot may leave the ring, clamped at DOT_MAX).
 */
import type { CornerFrame } from '../../contracts/telemetry';
import { G } from '../../contracts/units';
import type { CarDefinition, TyreHandling, TyreParams, VehicleDefinition } from '../../contracts/vehicle';
import { tyreCoefficients, type TyreCoefficients } from '../../sim-core/drive/tyre';
import { peakMu } from '../../sim-core/ride/tyre';

/** Ring radius at the static load on dry asphalt, m (ARCH-M2 §10.5). */
export const RING_RADIUS = 0.25;
/** Largest drawn dot offset, in ring radii (Auto demand estimates can exceed the capacity). */
export const DOT_MAX = 1.25;
/** Slip beyond the peak (in peak-slip units) at which the over-limit intensity saturates. */
const EXCESS_SPAN = 1.5;

/** Per-axle constants of the current vehicle (front, rear). */
export interface AxleModel {
  /** Model capacity at the static load, dry asphalt, no camber (N). */
  readonly staticCapacity: number;
  /** Plant tyre coefficients; null when the vehicle has no Manual Drive plant. */
  readonly coefficients: TyreCoefficients | null;
  readonly tyre: TyreParams;
}

/** Ring per corner, written in place. */
export interface RingState {
  /** m; 0 = no ring (wheel unloaded). */
  radius: number;
  /** Dot in the wheel frame, m from the ring centre. */
  dotX: number;
  dotY: number;
  /** Past the limit (see header). */
  past: boolean;
  /** 0..1: how far past the limit (plant: slip beyond the peak; auto: demand beyond the capacity). */
  excess: number;
}

export const createRingState = (): RingState => ({ radius: 0, dotX: 0, dotY: 0, past: false, excess: 0 });

/** Front and rear axle constants, or null for a vehicle without four-corner rings (the motorcycle). */
export function axleModels(vehicle: VehicleDefinition): readonly [AxleModel, AxleModel] | null {
  if (vehicle.class !== 'car') return null;
  const car: CarDefinition = vehicle;
  const L = car.wheelbase;
  const a = car.cgToFront;
  const axle = (share: number, tyre: TyreParams, handling: TyreHandling | undefined): AxleModel => {
    const load = (car.mass * G * share) / 2;
    return { staticCapacity: peakMu(load, 0, tyre) * load, coefficients: handling ? tyreCoefficients(tyre, handling) : null, tyre };
  };
  return [axle((L - a) / L, car.front.tyre, car.handling?.tyres.front), axle(a / L, car.rear.tyre, car.handling?.tyres.rear)];
}

/** g(x) = 2x / (1 + x^2): the plant's load shape of the slip stiffnesses (sim-core drive/tyre.ts). */
const gShape = (x: number): number => (2 * x) / (1 + x * x);

/**
 * The plant's normalised combined slip of a corner divided by the curve's peak slip (1 = at the limit), from the frame's
 * slip ratio, slip angle (tangent, camber term included) and capacity. 0 without a plant or load.
 */
export function slipOverPeak(c: Pick<CornerFrame, 'load' | 'capacity' | 'slipRatio' | 'slipAngle'>, m: AxleModel): number {
  const k = m.coefficients;
  if (!k || !(c.capacity > 0) || !(c.load > 0) || !(k.peakSlip < Infinity)) return 0;
  const shape = gShape(c.load / (k.loadShape * m.tyre.nominalLoad)) / k.g0;
  const sx = (k.c0Kappa * shape * c.slipRatio) / c.capacity;
  const sy = (k.c0Alpha * shape * c.slipAngle) / c.capacity;
  const s = Math.sqrt(sx * sx + sy * sy) / k.peakSlip;
  return Number.isFinite(s) ? s : 0;
}

/** Writes the ring of one corner. `plant` = the frame comes from the Manual Drive plant (mode !== 'auto'). */
export function ringOf(c: Readonly<CornerFrame>, m: AxleModel, plant: boolean, out: RingState): RingState {
  const cap = c.capacity;
  if (!(cap > 0) || !(m.staticCapacity > 0) || !Number.isFinite(c.fx) || !Number.isFinite(c.fy)) {
    out.radius = 0;
    out.dotX = 0;
    out.dotY = 0;
    out.past = false;
    out.excess = 0;
    return out;
  }
  const r = RING_RADIUS * Math.sqrt(cap / m.staticCapacity);
  let nx = c.fx / cap;
  let ny = c.fy / cap;
  const n = Math.sqrt(nx * nx + ny * ny);
  if (n > DOT_MAX) {
    nx *= DOT_MAX / n;
    ny *= DOT_MAX / n;
  }
  out.radius = r;
  out.dotX = nx * r;
  out.dotY = ny * r;
  const over = plant ? slipOverPeak(c, m) : c.gripUse;
  out.past = over > 1;
  out.excess = out.past ? Math.min(1, (over - 1) / EXCESS_SPAN) : 0;
  return out;
}
