/**
 * PathDriver (ARCHITECTURE-M2 §7.9; research m2/09 §2, §2.6): the autopilot as a Driver of the SAME plant. It takes
 * over from any state (on the grass, spun, reversed, stopped, mid-slide), brings the car back onto a ReferenceLine and
 * then tracks it like the Auto lap does.
 *
 * Steering (TRACK/RESUME): Stanley on the front-axle projection (heading error + atan of the softened cross-track
 * error; structure from PythonRobotics `stanley_control.py`, MIT, (c) 2016 Atsushi Sakai and contributors) plus the
 * curvature feed-forward atan(L kappa), an understeer feed-forward and yaw-rate damping. RECOVER: pure pursuit to a
 * line point ahead (PythonRobotics `pure_pursuit.py`, same licence). Speed: the profile speed with its acceleration
 * feed-forward and a PI loop, derated by the errors; the error feedback never brakes harder than FB_DECEL (no hard
 * braking when taking over at speed), only the BRAKE state (sliding, facing the wrong way, rolling backwards) brakes
 * hard. The loop's 3 % speed margin fades out while the car tracks well, so the latch onto the Auto lap has no speed
 * step. All state in typed arrays (no boxing), det kernels only, allocation-free.
 */
import { G } from '../../contracts/units';
import type { CarDefinition } from '../../contracts/vehicle';
import type { Frenet } from '../../contracts/world';
import { datan, datan2, dsin, dwrapPi } from '../math/det';
import { createRefPoint, type ReferenceLine } from './reference';
import type { DriveCommand, Driver, PlantView } from './types';

export type RecoveryState = 'track' | 'recover' | 'brake' | 'turnaround' | 'resume';

export interface PathDriver extends Driver {
  readonly state: RecoveryState;
  /** Front-axle offset from the line, m (+ left). */
  readonly lateralError: number;
  /** Heading minus line heading, rad (+ left). */
  readonly headingError: number;
  /** Latch thresholds (§7.10 C) held for 1 s. */
  readonly converged: boolean;
  readonly lineS: number;
  /** Line speed at the projection, m/s. */
  readonly lineSpeed: number;
}

export interface PathDriverOptions {
  readonly speedScale: number;
  readonly exactSpeed: boolean;
}

const STATES: readonly RecoveryState[] = ['track', 'recover', 'brake', 'turnaround', 'resume'];
const TRACK = 0;
const RECOVER = 1;
const BRAKE = 2;
const TURNAROUND = 3;
const RESUME = 4;

const DEG = Math.PI / 180;
/** Stanley cross-track gain and softening speed; yaw damping; understeer feed-forward, rad per m/s^2. */
const K_E = 1.2;
const K_SOFT = 1.0;
const K_R = 0.05;
const K_US = 0.0018;
/** Cross-track integral gain (rad per m s) and clamp (m s). */
const K_EI = 0.05;
const E_INT_MAX = 0.6;
/** Slip angle allowed on top of the grip-limited kinematic steer (HumanDriver's steering limit), rad. */
const ALPHA_PEAK = 0.12;
/** Steering slew, rad/s; pedal slew, 1/s. */
const STEER_SLEW = 0.6;
const PEDAL_SLEW = 4;
/** Speed loop: P, I, integral clamp. Feedback deceleration cap outside BRAKE, m/s^2. */
const KP = 1.2;
const KI = 0.2;
const I_MAX = 2;
const FB_DECEL = 4;
/** RECOVER (far off the line or heading well away from it) slows down more firmly, still short of a lock-up, m/s^2. */
const RECOVER_DECEL = 7;
/** Recovery machine thresholds (hysteresis: enter RECOVER beyond, leave it inside). */
const E_IN = 1.0;
const E_OUT = 2.0;
const PSI_IN = 30 * DEG;
const PSI_OUT = 50 * DEG;
const PSI_WRONG = 100 * DEG;
const PSI_TURNED = 80 * DEG;
const BETA_SLIDE = 35 * DEG;
const BRAKE_EXIT_SPEED = 2;
const BRAKE_PEDAL = 0.8;
const BRAKE_STEER = 0.8;
/** RECOVER: look-ahead (m, s), speed caps (m/s; off the road beyond OFFROAD_E). */
const LOOKAHEAD_MIN = 8;
const LOOKAHEAD_T = 0.8;
const LOOKAHEAD_E = 1.5;
const LOOKAHEAD_MAX = 30;
const RECOVER_SPEED = 12;
const OFFROAD_SPEED = 10;
/** Speed away from the line (m/s) beyond which RECOVER brakes straight first (BRAKE). */
const AWAY_SPEED = 10;
/** Stuck: throttle without motion for STUCK_S s -> a K-turn (TURNAROUND); its legs last <= LEG_S s, or end when
 *  stuck for LEG_STUCK_S s. */
const STUCK_S = 2;
const LEG_S = 4;
const LEG_STUCK_S = 1;
const OFFROAD_E = 6;
/** TURNAROUND: reverse speed (m/s), stop threshold before a direction change (m/s). */
const REVERSE_SPEED = 2.5;
const STOPPED = 0.3;
/** RESUME ramp, s. */
const RESUME_S = 1.5;
/** Convergence (§7.10 C): |e| (m), |psi_e| (rad), speed (fraction + m/s), hold (s). */
const CONV_E = 0.05;
const CONV_PSI = 1.0 * DEG;
const CONV_FRAC = 0.05;
const CONV_ABS = 0.2;
const CONV_HOLD = 1.0;
/** The speed margin fades in/out (1/s) while |e| < EXACT_E and |psi_e| < EXACT_PSI in TRACK. */
const EXACT_E = 0.3;
const EXACT_PSI = 3 * DEG;
const EXACT_RISE = 0.5;
const EXACT_FALL = 2;

// state slots
const ST = 0; // RecoveryState index
const T_STATE = 1; // time in state
const INTEG = 2;
const STEER = 3;
const THROTTLE = 4;
const BRAKE_P = 5;
const DIR = 6;
const CONV_T = 7;
const RAMP_FROM = 8;
const EXACT_W = 9;
const E = 10;
const PSI = 11;
const LINE_S = 12;
const V_REF = 13;
const INIT = 14;
const PSI_C = 15; // front-axle course error
const E_INT = 16; // integral of the cross-track error (TRACK)
const STUCK_T = 17;
const LEG = 18; // TURNAROUND leg direction (-1 reverse, +1 forward)
const LEG_T = 19;
const LEGS = 20; // 1 until a reverse leg has finished (a K-turn entered because stuck)
const SLOTS = 21;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const slew = (from: number, to: number, max: number): number => from + clamp(to - from, -max, max);

export function createPathDriver(vehicle: CarDefinition, line: ReferenceLine, options: PathDriverOptions): PathDriver {
  const L = vehicle.wheelbase;
  const a = vehicle.cgToFront;
  const b = L - a;
  const accelLimit = vehicle.limits.accel;
  const exact = options.exactSpeed;
  const scale = options.speedScale;
  const st = new Float64Array(SLOTS);
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  const rp = createRefPoint();
  const tp = createRefPoint();

  function enter(state: number, u: number): void {
    if (st[ST] === state) return;
    st[ST] = state;
    st[T_STATE] = 0;
    st[RAMP_FROM] = u;
    if (state !== TRACK && state !== RESUME) st[INTEG] = 0;
    st[LEGS] = 0;
  }

  const driver: PathDriver = {
    get state() {
      return STATES[st[ST]!]!;
    },
    get lateralError() {
      return st[E]!;
    },
    get headingError() {
      return st[PSI]!;
    },
    get converged() {
      return st[CONV_T]! >= CONV_HOLD;
    },
    get lineS() {
      return st[LINE_S]!;
    },
    get lineSpeed() {
      return st[V_REF]!;
    },

    engage(view, previous) {
      st.fill(0);
      st[ST] = RECOVER;
      st[INIT] = 1;
      st[STEER] = previous.steer;
      st[THROTTLE] = previous.throttle;
      st[BRAKE_P] = previous.brake;
      st[DIR] = previous.direction;
      st[RAMP_FROM] = view.u;
      st[LINE_S] = NaN;
    },

    step(dt, view, out) {
      const c = view.cosYaw;
      const sn = view.sinYaw;
      const u = view.u;
      const r = view.r;
      const beta = view.beta;
      const yaw = datan2(sn, c);
      // 1. front-axle projection: errors, line curvature, profile speed and acceleration
      line.project(view.x + a * c, view.y + a * sn, st[LINE_S]!, fr);
      const e = fr.l;
      const psi = dwrapPi(yaw - fr.heading);
      const kappa = fr.curvature;
      line.at(fr.s, rp);
      const vRef = rp.speed;
      st[E] = e;
      st[PSI] = psi;
      st[LINE_S] = fr.s;
      st[V_REF] = vRef;
      const ae = Math.abs(e);
      const ap = Math.abs(psi);
      const au = Math.abs(u);

      // 2. recovery machine (hysteresis)
      let s = st[ST]!;
      if (st[INIT]) {
        st[INIT] = 0;
        if (ae < E_IN && ap < PSI_IN) {
          st[ST] = RESUME;
          s = RESUME;
        }
      }
      // moving away from the line, fast and far: braking straight costs the least ground (turning at speed would
      // carve a wide arc); same BRAKE state as a slide
      const away = ae > E_OUT && e * u * dsin(psi) > 0 && Math.abs(u * dsin(psi)) > AWAY_SPEED;
      // stuck (throttle, no speed: e.g. facing up a bank too steep for the grip on grass): turn around in legs
      const stuck = st[THROTTLE]! > 0.4 && au < STOPPED;
      st[STUCK_T] = stuck && s !== BRAKE ? st[STUCK_T]! + dt : 0;
      if (st[STUCK_T]! > STUCK_S && (s === RECOVER || s === RESUME || s === TRACK)) {
        st[STUCK_T] = 0;
        enter(TURNAROUND, u);
        st[LEGS] = 1; // at least one reverse leg before it may end
      }
      if (s === BRAKE) {
        if (au < BRAKE_EXIT_SPEED && u > -0.5) enter(ap > PSI_WRONG ? TURNAROUND : RECOVER, u);
      } else if (s === TURNAROUND) {
        // ends facing within PSI_TURNED of the line: at rest after a reverse leg, or on the move in a forward leg
        if (ap < PSI_TURNED && st[LEGS]! === 0 && (st[LEG]! > 0 || au < STOPPED)) enter(RECOVER, u);
      } else if (ap > PSI_WRONG) enter(au < BRAKE_EXIT_SPEED ? TURNAROUND : BRAKE, u);
      else if ((Math.abs(beta) > BETA_SLIDE && au > BRAKE_EXIT_SPEED) || u < -0.5 || away) enter(BRAKE, u);
      else if (s === TRACK || s === RESUME) {
        if (ae > E_OUT || ap > PSI_OUT) enter(RECOVER, u);
        else if (s === RESUME && st[T_STATE]! >= RESUME_S) enter(TRACK, u);
      } else if (ae < E_IN && ap < PSI_IN) enter(RESUME, u);
      s = st[ST]!;
      st[T_STATE] = st[T_STATE]! + dt;

      // 3. targets per state
      let steer = 0;
      let throttle = 0;
      let brake = 0;
      let dir: 1 | -1 = st[DIR]! < 0 ? -1 : 1;
      if (s === BRAKE) {
        brake = BRAKE_PEDAL;
        // steer into the slide (countersteer) while moving forward
        steer = u > 0 ? BRAKE_STEER * beta : 0;
      } else if (s === TURNAROUND) {
        // K-turn: legs of at most LEG_S (or until stuck for LEG_STUCK_S), reverse with the lock that turns the heading
        // toward the line (yaw rate u tan(delta) / L with u < 0), forward with the opposite lock
        if (st[T_STATE]! <= dt) {
          st[LEG] = -1;
          st[LEG_T] = 0;
        }
        const legDone = st[LEG_T]! > LEG_S || (st[LEG_T]! > 1 && st[STUCK_T]! > LEG_STUCK_S);
        if (legDone) {
          st[LEG] = -st[LEG]!;
          st[LEG_T] = 0;
          st[STUCK_T] = 0;
          if (st[LEG]! > 0) st[LEGS] = 0;
        }
        const want: 1 | -1 = st[LEG]! < 0 ? -1 : 1;
        if (want !== dir) {
          // stop before changing direction
          if (au > STOPPED) brake = 0.5;
          else dir = want;
        }
        if (want === dir) {
          st[LEG_T] = st[LEG_T]! + dt;
          steer = (psi > 0 ? vehicle.maxSteer : -vehicle.maxSteer) * (dir < 0 ? 1 : -1);
          const err = REVERSE_SPEED - au;
          throttle = err > 0 ? clamp(0.5 * err, 0, 1) : 0;
          brake = err < -1 ? 0.3 : 0;
        }
      } else {
        // forward driving states need the forward direction (stop first when it is not)
        if (dir < 0) {
          if (au > STOPPED) brake = 0.5;
          else dir = 1;
        }
        let vt: number;
        let ff = 0;
        if (s === RECOVER) {
          // pure pursuit from the rear axle to the line point ahead
          // the look-ahead grows with the distance from the line: a shallow approach (<= ~35 deg), not straight up a bank
          line.at(fr.s + Math.max(LOOKAHEAD_MIN, LOOKAHEAD_T * au, Math.min(LOOKAHEAD_E * ae, LOOKAHEAD_MAX)), tp);
          const rx = view.x - b * c;
          const ry = view.y - b * sn;
          const dx = tp.x - rx;
          const dy = tp.y - ry;
          const ld = Math.sqrt(dx * dx + dy * dy);
          const alpha = dwrapPi(datan2(dy, dx) - yaw);
          // a target behind the car (|alpha| > 90 deg) asks for full lock toward it
          const sa = alpha > Math.PI / 2 ? 1 : alpha < -Math.PI / 2 ? -1 : dsin(alpha);
          steer = datan2(2 * L * sa, Math.max(ld, 1));
          vt = Math.min(ae > OFFROAD_E ? OFFROAD_SPEED : RECOVER_SPEED, vRef);
        } else {
          // Stanley + curvature feed-forward + understeer feed-forward + yaw-rate damping. The heading term is the
          // front axle's COURSE error (velocity direction - line heading), zero when the front axle tracks the line in
          // a steady corner; the body-heading error there is L kappa minus the rear slip angle, and with the
          // feed-forward on top it would be counted twice (a metre of cross-track error in the hairpin).
          const wc = clamp(au - 1, 0, 2) / 2;
          const pc = psi + (wc > 0 ? wc * datan2(view.v + r * a, au) : 0);
          const apc = Math.abs(pc);
          st[PSI_C] = pc;
          // integral of the cross-track error in TRACK removes the steady offset the feed-forwards leave in long bends
          if (s === TRACK) st[E_INT] = clamp(st[E_INT]! + e * dt, -E_INT_MAX, E_INT_MAX);
          else st[E_INT] = 0;
          steer = -pc - datan((K_E * e) / (K_SOFT + au)) - K_EI * st[E_INT]! + datan(L * kappa) + K_US * u * u * kappa - K_R * (r - u * kappa);
          const w = st[EXACT_W]!;
          st[EXACT_W] = s === TRACK && ae < EXACT_E && apc < EXACT_PSI ? Math.min(1, w + EXACT_RISE * dt) : Math.max(0, w - EXACT_FALL * dt);
          const k = exact ? 1 : (scale + (1 - scale) * st[EXACT_W]!) / (1 + (0.5 * ae) / 4.5 + 1.5 * apc);
          vt = vRef * k;
          if (s === RESUME && vt > st[RAMP_FROM]!) {
            // speeding up: the target ramps from the speed at the hand-over (slowing down follows the profile, with
            // its own braking feed-forward and the capped feedback, as in TRACK)
            const f = Math.min(1, st[T_STATE]! / RESUME_S);
            vt = st[RAMP_FROM]! + (vt - st[RAMP_FROM]!) * f;
          } else ff = rp.accel;
        }
        if (dir > 0) {
          const err = vt - u;
          if (s === TRACK || s === RESUME) st[INTEG] = clamp(st[INTEG]! + err * dt, -I_MAX, I_MAX);
          const acmd = ff + Math.max(s === RECOVER ? -RECOVER_DECEL : -FB_DECEL, KP * err + KI * st[INTEG]!);
          throttle = acmd > 0 ? Math.min(1, acmd / accelLimit) : 0;
          brake = acmd < 0 ? Math.min(1, -acmd / G) : 0;
        }
      }

      // 4. slews and clamps (bumpless from the command in force at the engage). Forward driving states steer within the
      // grip the speed allows (the HumanDriver's steering-limit formula, §7.9): a big heading error at speed must not
      // become a full-lock spin. BRAKE (countersteer) and TURNAROUND (slow) are not limited.
      let lim = vehicle.maxSteer;
      if (s !== BRAKE && s !== TURNAROUND) lim = Math.min(lim, datan((L * view.lateralLimit) / Math.max(u * u, 1)) + ALPHA_PEAK);
      steer = clamp(steer, -lim, lim);
      st[STEER] = clamp(slew(st[STEER]!, steer, STEER_SLEW * dt), -vehicle.maxSteer, vehicle.maxSteer);
      st[THROTTLE] = slew(st[THROTTLE]!, throttle, PEDAL_SLEW * dt);
      st[BRAKE_P] = slew(st[BRAKE_P]!, brake, PEDAL_SLEW * dt);
      st[DIR] = dir;
      out.steer = st[STEER]!;
      out.throttle = st[THROTTLE]!;
      out.brake = st[BRAKE_P]!;
      out.handbrake = 0;
      out.direction = dir;

      // 5. convergence (§7.10 C), held for CONV_HOLD. Measured at the CG — what the latch puts on the line (Auto: the CG
      // on the line, heading = line heading, speed = profile speed) — so the thresholds bound the latch's jump.
      let conv = s === TRACK && ae < 4 * CONV_E && Math.abs(u - vRef) < CONV_FRAC * vRef + CONV_ABS;
      if (conv) {
        line.project(view.x, view.y, fr.s, fr);
        conv = Math.abs(fr.l) < CONV_E && Math.abs(dwrapPi(yaw - fr.heading)) < CONV_PSI;
      }
      st[CONV_T] = conv ? st[CONV_T]! + dt : 0;
    },
  };
  return driver;
}

