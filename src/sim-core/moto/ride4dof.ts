/**
 * 4-DOF in-plane motorcycle ride model (ARCHITECTURE §7.7, research 08 §5.4): body heave z (+ up), pitch θ (+ nose
 * down), front/rear wheel-centre heights zu (+ up), all from static, in the plane of the leaned bike.
 *
 * Coupling (virtual work with the travels w_i = zu_i − z + x_i·θ, x_f = a, x_r = −b): each end transmits to the body
 *   E_i = S_i(w, ẇ) − G_i,   G_i = Fx_i·kx_i(w)  [+ rear drive: Fx_r·(R/r_sprocket)·chi(w)]
 * where S is the suspension force at the wheel (spring · MR + damper · MR² + stiction · MR + stops) and kx the brake
 * coupling of the end (dx/dw of the tyre's lowest point, fixed in the wheel carrier). A telescopic fork has kx = −tan ε,
 * so a braking force (Fx < 0) ADDS compression: pro-dive. Equations:
 *   m_s·z̈ = E_f + E_r − m_s·g_eff
 *   I·θ̈  = −x_f·E_f − x_r·E_r − h·(Fx_f + Fx_r)
 *   m_u·z̈u_i = N_i − E_i − m_u·g_eff,   N_i = max(0, k_t·(δ0 + road − zu) + c_t·(ṙoad − żu))
 * Quasi-statically this gives the textbook anti-dive / anti-squat fractions AD = β_f·kx_f·L/h and
 * AS = −(kx_r + (R/r)·chi)·L/h (research 08 §4.4). shortcut: the unsprung masses' longitudinal inertia is not modelled.
 * Semi-implicit Euler with SUBSTEPS per step; reset() is a closed-form equilibrium (bisection per end) that never throws.
 */
import type { DamperSpec, SpringSpec } from '../../contracts/suspension';
import { LEN, MR, KX, CHI, type EndTable } from './planar';

const SUBSTEPS = 4;
/** Fork/shock stiction regularisation speed (tanh), m/s at the wheel. */
const STICTION_V = 0.02;
/** Stop engagement: full (stop = 1) at this compression of the bump stop / top-out, m. */
export const STOP_FULL = 0.01;
/** Bump-stop and top-out rate relative to the static wheel rate. */
const STOP_RATE = 10;

/** Spring force along its axis (N, + compression) at compression x from full extension (x >= 0). */
export function springForce(spec: SpringSpec, x: number, xMax: number): number {
  const c = x > 0 ? x : 0;
  let elastic = spec.rate * c;
  const dual = spec.dualRate;
  if (dual && c > dual.crossover) elastic = spec.rate * dual.crossover + dual.rate * (c - dual.crossover);
  const r = c / xMax;
  return spec.preload + elastic * (1 + spec.progression * r * r);
}

export interface EndSpec {
  readonly table: EndTable;
  /** Axle x in the vehicle frame (front a, rear −b). */
  readonly x: number;
  readonly unsprungMass: number;
  readonly tyreRate: number;
  readonly tyreDamping: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  /** Breakaway friction along the spring axis, N (telescopic fork sliders; 0 elsewhere). */
  readonly stiction: number;
  /** Static suspension force at the wheel, N (sprung load share at 1 g). */
  readonly staticForce: number;
}

/** Derived per-end constants: sag from the spring curve, travel limits, wheel rate. */
export interface EndParams extends EndSpec {
  /** Spring length at full extension, m. */
  readonly lExt: number;
  /** Spring compression at full bump, m. */
  readonly xMax: number;
  /** Static sag (wheel travel from full extension to static), m; also the droop limit. */
  readonly droop: number;
  /** Remaining bump travel from static, m. */
  readonly bump: number;
  /** dS/dw at static, N/m (incl. progression and linkage). */
  readonly wheelRate: number;
  readonly stopRate: number;
  /** Static tyre deflection, m. */
  readonly tyreDeflection: number;
}

const row = new Float64Array(64);

/** Solves the static sag on the spring curve and the travel limits. */
export function prepareEnd(spec: EndSpec, g: number): EndParams {
  const t = spec.table;
  t.sample(0, row);
  const l0 = row[LEN]!;
  const mr0 = row[MR]!;
  const lengthAt = (w: number): number => t.sample(w, row)[LEN]!;
  // Spring compression at static: F(x) = static force per shock along the axis (xMax only shapes progression; first
  // pass with the full stroke, second with the solved one).
  const need = spec.staticForce / (t.shocks * mr0);
  let xMax = lengthAt(-t.travel / 2) - lengthAt(t.travel / 2);
  let xs = 0;
  let droop = 0;
  for (let pass = 0; pass < 2; pass++) {
    let lo = 0;
    let hi = 1;
    if (springForce(spec.spring, 0, xMax) >= need) hi = 0;
    for (let k = 0; k < 80 && hi > 0; k++) {
      const mid = (lo + hi) / 2;
      if (springForce(spec.spring, mid, xMax) < need) lo = mid;
      else hi = mid;
    }
    xs = (lo + hi) / 2;
    // Droop: the travel at which the spring is fully extended (length l0 + xs).
    let a = -t.travel;
    let b = 0;
    for (let k = 0; k < 80; k++) {
      const mid = (a + b) / 2;
      if (lengthAt(mid) > l0 + xs) a = mid;
      else b = mid;
    }
    droop = -(a + b) / 2;
    xMax = l0 + xs - lengthAt(t.travel - droop);
  }
  const bump = t.travel - droop;
  const base = { ...spec, lExt: l0 + xs, xMax, droop, bump, tyreDeflection: (spec.staticForce + spec.unsprungMass * g) / spec.tyreRate };
  const probe: EndParams = { ...base, wheelRate: 0, stopRate: 0 };
  const h = 1e-4;
  const wheelRate = (suspensionForce(probe, h, 0, row) - suspensionForce(probe, -h, 0, row)) / (2 * h);
  return { ...base, wheelRate, stopRate: STOP_RATE * wheelRate };
}

/**
 * Suspension force at the wheel (N, + pushes the wheel down / body up) at travel w and rate wd. Writes into `out`
 * the table row at w followed by [springForce per shock, damperForce per shock, stop 0..1] at out[stride..].
 */
export function suspensionForce(p: EndParams, w: number, wd: number, out: Float64Array): number {
  const t = p.table;
  t.sample(w, out);
  const mr = out[MR]!;
  const n = t.shocks;
  const x = p.lExt - out[LEN]!;
  const fs = springForce(p.spring, x, p.xMax);
  const v = mr * wd;
  const fd = (v > 0 ? p.damper.bump : p.damper.rebound) * v;
  let s = n * (fs + fd) * mr + p.stiction * mr * Math.tanh(wd / STICTION_V);
  let stop = 0;
  const eb = w - p.bump;
  if (eb > 0) {
    s += p.stopRate * eb * (1 + eb / STOP_FULL);
    stop = eb / STOP_FULL;
  }
  const et = -p.droop - w;
  if (et > 0) {
    s -= p.stopRate * et * (1 + et / STOP_FULL);
    stop = et / STOP_FULL;
  }
  const k = t.stride;
  out[k] = fs;
  out[k + 1] = fd;
  out[k + 2] = stop > 1 ? 1 : stop;
  return s;
}

export interface Ride4Params {
  readonly sprungMass: number;
  readonly cgHeight: number;
  readonly inertiaPitch: number;
  readonly front: EndParams;
  readonly rear: EndParams;
  /** Rear tyre radius / rear sprocket radius (chain tension per unit drive force). */
  readonly sprocketRatio: number;
}

export interface Ride4Input {
  /** Longitudinal tyre forces, N (+ forward on the bike): brake < 0, drive > 0. */
  readonly fx: Float64Array;
  /** 1 while the rear force is chain drive, 0 while braking. */
  drive: number;
  /** Specific force normal to the road in the plane of the bike, m/s² (g at rest on the flat). */
  geff: number;
  /** Road deviation under each tyre (m) and its rate (m/s), front then rear. */
  readonly road: Float64Array;
  readonly roadRate: Float64Array;
}

/** State layout: positions then rates. */
export const Z = 0;
export const TH = 1;
export const ZF = 2;
export const ZR = 3;
const NQ = 4;

export interface Ride4 {
  readonly params: Ride4Params;
  /** [z, θ, zu_f, zu_r, ż, θ̇, żu_f, żu_r]. */
  readonly q: Float64Array;
  /** Per end (f, r): travel, travel rate, tyre load, suspension force at the wheel, force to the body. */
  readonly w: Float64Array;
  readonly wd: Float64Array;
  readonly load: Float64Array;
  readonly force: Float64Array;
  /** Table row + [spring, damper, stop] of each end at the current state. */
  readonly rows: readonly [Float64Array, Float64Array];
  reset(input: Ride4Input): void;
  step(dt: number, input: Ride4Input): void;
}

export function createRide4(params: Ride4Params): Ride4 {
  const { sprungMass: ms, cgHeight: h, inertiaPitch: iy, front, rear, sprocketRatio } = params;
  const ends = [front, rear] as const;
  const q = new Float64Array(2 * NQ);
  const w = new Float64Array(2);
  const wd = new Float64Array(2);
  const load = new Float64Array(2);
  const force = new Float64Array(2);
  const susp = new Float64Array(2);
  const acc = new Float64Array(NQ);
  const rows = [new Float64Array(front.table.stride + 3), new Float64Array(rear.table.stride + 3)] as const;

  /** Longitudinal coupling G_i at the end's current table row. */
  function coupling(i: number, input: Ride4Input): number {
    const r = rows[i]!;
    let g = input.fx[i]! * r[KX]!;
    if (i === 1 && input.drive) g += input.fx[1]! * sprocketRatio * r[CHI]!;
    return g;
  }

  function forces(input: Ride4Input): void {
    for (let i = 0; i < 2; i++) {
      const p = ends[i]!;
      w[i] = q[ZF + i]! - q[Z]! + p.x * q[TH]!;
      wd[i] = q[NQ + ZF + i]! - q[NQ + Z]! + p.x * q[NQ + TH]!;
      susp[i] = suspensionForce(p, w[i]!, wd[i]!, rows[i]!);
      force[i] = susp[i]! - coupling(i, input);
      const defl = p.tyreDeflection + input.road[i]! - q[ZF + i]!;
      const n = defl > 0 ? p.tyreRate * defl + p.tyreDamping * (input.roadRate[i]! - q[NQ + ZF + i]!) : 0;
      load[i] = n > 0 ? n : 0;
    }
    const g = input.geff;
    acc[Z] = (force[0]! + force[1]!) / ms - g;
    acc[TH] = (-front.x * force[0]! - rear.x * force[1]! - h * (input.fx[0]! + input.fx[1]!)) / iy;
    acc[ZF] = (load[0]! - force[0]!) / front.unsprungMass - g;
    acc[ZR] = (load[1]! - force[1]!) / rear.unsprungMass - g;
  }

  return {
    params,
    q,
    w,
    wd,
    load,
    force,
    rows,

    reset(input) {
      const g = input.geff;
      const fx = input.fx[0]! + input.fx[1]!;
      const L = front.x - rear.x;
      const target0 = (ms * g * -rear.x - h * fx) / L;
      const target1 = ms * g - target0;
      q.fill(0);
      for (let i = 0; i < 2; i++) {
        const p = ends[i]!;
        const target = i === 0 ? target0 : target1;
        const t = p.table;
        let lo = t.w[0]!;
        let hi = t.w[t.w.length - 1]!;
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2;
          const e = suspensionForce(p, mid, 0, rows[i]!) - coupling(i, input);
          if (e < target) lo = mid;
          else hi = mid;
        }
        w[i] = (lo + hi) / 2;
        const n = Math.max(0, target + p.unsprungMass * g);
        q[ZF + i] = p.tyreDeflection + input.road[i]! - n / p.tyreRate;
      }
      // w_f = zu_f − z + a·θ, w_r = zu_r − z − b·θ.
      q[TH] = (q[ZR]! - w[1]! - (q[ZF]! - w[0]!)) / L;
      q[Z] = q[ZF]! - w[0]! + front.x * q[TH]!;
      forces(input);
    },

    step(dt, input) {
      const hdt = dt / SUBSTEPS;
      for (let k = 0; k < SUBSTEPS; k++) {
        forces(input);
        for (let j = 0; j < NQ; j++) {
          q[NQ + j] = q[NQ + j]! + acc[j]! * hdt;
          q[j] = q[j]! + q[NQ + j]! * hdt;
        }
      }
      forces(input);
    },
  };
}
