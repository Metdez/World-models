/**
 * Pure helpers for the Race Engineer panel: a preallocated telemetry ring (filled at 10 Hz without allocation),
 * the plain-language event label, the request payload (display units, rounded) and section-dependent chips.
 */
import type { EngineerTelemetry } from '../../contracts/engineer';
import type { AxleKinematicsSummary, VehicleClass } from '../../contracts/suspension';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { Phenomenon } from '../../contracts/track';
import { G, RAD_TO_DEG } from '../../contracts/units';

export interface SnapCorner {
  camber: number;
  toe: number;
  travel: number;
  travelRate: number;
  load: number;
  gripUse: number;
}

export interface Snap {
  time: number;
  sectionIndex: number;
  speed: number;
  ax: number;
  ay: number;
  roll: number;
  pitch: number;
  rcFront: number;
  rcRear: number;
  readonly corners: SnapCorner[];
}

const corner = (): SnapCorner => ({ camber: 0, toe: 0, travel: 0, travelRate: 0, load: 0, gripUse: 0 });

/** Fixed-size ring of telemetry snapshots. `push` copies TRUE fields only and never allocates. */
export class SnapshotRing {
  private readonly slots: Snap[];
  private next = 0;
  private count = 0;

  constructor(
    size: number,
    readonly cornerIds: readonly string[],
  ) {
    this.slots = Array.from({ length: size }, () => ({
      time: 0, sectionIndex: 0, speed: 0, ax: 0, ay: 0, roll: 0, pitch: 0, rcFront: Number.NaN, rcRear: Number.NaN,
      corners: cornerIds.map(corner),
    }));
  }

  push(t: TelemetryFrame, time: number): void {
    const s = this.slots[this.next]!;
    s.time = time;
    s.sectionIndex = t.sectionIndex;
    s.speed = t.speed;
    s.ax = t.ax;
    s.ay = t.ay;
    s.roll = t.roll;
    s.pitch = t.pitch;
    s.rcFront = t.axles[0]?.rollCentreHeight ?? Number.NaN;
    s.rcRear = t.axles[1]?.rollCentreHeight ?? Number.NaN;
    for (let i = 0; i < s.corners.length; i++) {
      const c = t.corners[i];
      const o = s.corners[i]!;
      if (!c) continue;
      o.camber = c.camber;
      o.toe = c.toe;
      o.travel = c.travel;
      o.travelRate = c.travelRate;
      o.load = c.load;
      o.gripUse = c.gripUse;
    }
    this.next = (this.next + 1) % this.slots.length;
    this.count = Math.min(this.count + 1, this.slots.length);
  }

  latest(): Snap | undefined {
    return this.count === 0 ? undefined : this.slots[(this.next - 1 + this.slots.length) % this.slots.length];
  }

  /** The most eventful snapshot newer than `since` ("Why did it do that?" looks at the last second). */
  peak(since: number): Snap | undefined {
    let best: Snap | undefined;
    let bestScore = -1;
    for (let i = 0; i < this.count; i++) {
      const s = this.slots[i]!;
      if (s.time < since) continue;
      const score = activity(s);
      if (score > bestScore) [best, bestScore] = [s, score];
    }
    return best ?? this.latest();
  }
}

/** Acceleration in g plus wheel speed (m/s): a bump at half a metre per second weighs like a third of a g. */
function activity(s: Snap): number {
  let rate = 0;
  for (const c of s.corners) rate = Math.max(rate, Math.abs(c.travelRate));
  return Math.hypot(s.ax, s.ay) / G + 0.7 * rate;
}

const CORNER_NAMES: Readonly<Record<string, string>> = { fl: 'front-left', fr: 'front-right', rl: 'rear-left', rr: 'rear-right', f: 'front', r: 'rear' };

/** Plain-language label of what the vehicle is doing in this snapshot. */
export function eventLabel(s: Snap, cornerIds: readonly string[], vehicleClass: VehicleClass): string {
  const parts: string[] = [];
  const latG = s.ay / G;
  const longG = s.ax / G;
  // A single wheel bump twists the body's wheel plane (warp); heave, roll and pitch do not.
  if (vehicleClass === 'car' && s.corners.length === 4) {
    const [fl, fr, rl, rr] = s.corners.map((c) => c.travel) as [number, number, number, number];
    if (Math.abs(fl - fr - rl + rr) > 0.02) {
      const mean = (fl + fr + rl + rr) / 4;
      let lone = 0;
      s.corners.forEach((c, i) => {
        if (Math.abs(c.travel - mean) > Math.abs(s.corners[lone]!.travel - mean)) lone = i;
      });
      const up = s.corners[lone]!.travel > mean;
      parts.push(`${CORNER_NAMES[cornerIds[lone] ?? ''] ?? 'one'} wheel ${up ? 'rising over a bump' : 'dropping into a dip'}`);
    }
  }
  if (longG < -0.3) parts.push('hard braking, nose loaded');
  else if (longG > 0.2) parts.push('accelerating, rear squatting');
  if (Math.abs(latG) > 0.2) {
    const right = latG < 0;
    parts.push(
      vehicleClass === 'car'
        ? `mid-corner, ${right ? 'right' : 'left'}-hander, outside (${right ? 'left' : 'right'}) wheels loaded`
        : `leaning into a ${right ? 'right' : 'left'}-hander`,
    );
  } else parts.push(parts.length === 0 ? 'straight and steady' : 'on a straight');
  return parts.join(', ');
}

const r = (v: number, d: number): number => {
  const p = 10 ** d;
  const x = Math.round(v * p) / p;
  return x === 0 ? 0 : x; // no "-0" in the payload
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface PayloadContext {
  readonly vehicleClass: VehicleClass;
  readonly vehicleId: string;
  readonly suspensionId: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly summaries: { readonly front: AxleKinematicsSummary; readonly rear: AxleKinematicsSummary } | undefined;
}

/** Request telemetry in display units. Every number here is a TRUE sim value (honesty rule §14). */
export function buildTelemetry(s: Snap, cornerIds: readonly string[], ctx: PayloadContext): EngineerTelemetry {
  const corners: Record<string, EngineerTelemetry['corners'][keyof EngineerTelemetry['corners']]> = {};
  s.corners.forEach((c, i) => {
    corners[cornerIds[i] ?? `c${i}`] = {
      camber_deg: r(clamp(c.camber * RAD_TO_DEG, -30, 30), 2),
      toe_deg: r(clamp(c.toe * RAD_TO_DEG, -30, 30), 2),
      travel_mm: r(clamp(c.travel * 1000, -500, 500), 0),
      load_n: r(clamp(c.load, 0, 60000), 0),
      grip_use: r(clamp(c.gripUse, 0, 5), 2),
    };
  });
  const derived: Record<string, number> = {};
  const put = (key: string, v: number, d: number) => {
    if (Number.isFinite(v)) derived[key] = r(v, d);
  };
  put('roll_centre_front_mm', s.rcFront * 1000, 0);
  put('roll_centre_rear_mm', s.rcRear * 1000, 0);
  if (ctx.summaries) {
    const { front, rear } = ctx.summaries;
    put('camber_gain_front_deg_per_cm', front.camberGain * RAD_TO_DEG * 0.01, 2);
    put('camber_gain_rear_deg_per_cm', rear.camberGain * RAD_TO_DEG * 0.01, 2);
    put('roll_camber_front', front.rollCamber, 2);
    put('roll_camber_rear', rear.rollCamber, 2);
    put('anti_dive_front_pct', front.antiPitch * 100, 0);
    put('anti_squat_rear_pct', rear.antiPitch * 100, 0);
  }
  return {
    vehicle_class: ctx.vehicleClass,
    vehicle: ctx.vehicleId,
    suspension: ctx.suspensionId,
    section: ctx.sectionId,
    section_name: ctx.sectionName.replace(/[^\p{L}\p{N} ,.()'/-]/gu, '').slice(0, 40),
    event: eventLabel(s, cornerIds, ctx.vehicleClass),
    speed_kmh: r(clamp(s.speed * 3.6, 0, 500), 0),
    lat_g: r(clamp(s.ay / G, -5, 5), 2),
    long_g: r(clamp(s.ax / G, -5, 5), 2),
    roll_deg: r(clamp(s.roll * RAD_TO_DEG, -90, 90), 2),
    pitch_deg: r(clamp(s.pitch * RAD_TO_DEG, -45, 45), 2),
    corners: corners as EngineerTelemetry['corners'],
    derived,
  };
}

/** Three suggested questions per section phenomenon (no digits: numbers come from the sim). */
export const CHIPS: Readonly<Record<Phenomenon, readonly [string, string, string]>> = {
  'ride-resonance': ['Why does the car shake on the ripples?', 'What is wheel hop?', 'Do the dampers matter here?'],
  'brake-dive': ['Why does the nose dip?', 'What is anti-dive?', 'Which suspension dives least?'],
  'steering-lock': ['Why do the front wheels tilt?', 'What is caster?', 'Show me the front-left wheel'],
  'single-wheel-bump': ['How does one wheel move alone?', 'What is bump steer?', 'Show me the bump in slow motion'],
  'sustained-roll': ['Why does the outside wheel lean?', 'What is camber gain?', 'Which suspension is best?'],
  harshness: ['Why does this feel harsh?', 'Does the strut add friction?', 'Show me a damper'],
  'roll-reversal': ['Why does the body rock side to side?', 'What do the dampers do here?', 'Show me in slow motion'],
  heave: ['Why does the car go light?', 'What happens in the dip?', 'Show me the springs'],
  'steady-state-roll': ['Why does it lean more here?', 'What is a roll centre?', 'Compare it with a double wishbone'],
  'lane-change': ['Why does the body sway?', 'How fast can roll change?', 'Show me in slow motion'],
  'off-camber': ['Why does this bend feel different?', 'Which wheel works hardest?', 'What is a roll centre?'],
  settle: ['What is the suspension doing now?', 'What is a roll centre?', 'Which suspension is best?'],
};
