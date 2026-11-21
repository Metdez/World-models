/**
 * Rule-based Race Engineer answer (no model): used when the model fails, times out, is over quota or quotes a
 * number that is not in the telemetry, and by the browser when the endpoint is unreachable or busy.
 * DUPLICATED VERBATIM in src/features/engineer/rules.ts (layering forbids a shared import between worker/ and
 * features/); tests/worker/engineer-fallback.test.ts asserts the two files are identical. Import-free on purpose.
 * Every number it prints is a telemetry value; every claim agrees with the measured simulation (02-02, 02-04).
 */

export interface RuleCorner {
  readonly camber_deg: number;
  readonly travel_mm: number;
}

export interface RuleTelemetry {
  readonly vehicle_class: string;
  readonly suspension: string;
  readonly section_name: string;
  readonly speed_kmh: number;
  readonly lat_g: number;
  readonly long_g: number;
  readonly roll_deg: number;
  readonly pitch_deg: number;
  readonly corners: { readonly [corner: string]: RuleCorner | undefined };
  /** Present while the visitor drives (EngineerDrive). */
  readonly drive?: RuleDrive;
}

export interface RuleDrive {
  readonly mode: string;
  readonly detected: string;
  readonly steer_deg: number;
  readonly throttle_pct: number;
  readonly brake_pct: number;
  readonly sideslip_deg: number;
  readonly yaw_rate_dps: number;
  readonly gear: number;
  readonly surface: string;
  readonly aids_active: readonly string[];
}

const n = (v: number, d = 2): string => String(Number(Math.abs(v).toFixed(d)));
/** roll > 0 lifts the left side, i.e. the body leans to the right. */
const side = (roll: number): string => (roll > 0 ? 'to the right' : 'to the left');
const CORNER_NAMES: Readonly<Record<string, string>> = { fl: 'front-left', fr: 'front-right', rl: 'rear-left', rr: 'rear-right', f: 'front', r: 'rear' };

/** How each car suspension type answers body roll (agrees with the 02-04 difference report). */
const ROLL_CLAUSE: Readonly<Record<string, string>> = {
  macpherson: 'A strut adds little negative camber as it compresses, so the outside wheels lean with the body; at the rear it gives up the most camber of the three types.',
  'double-wishbone': 'The shorter upper arm pulls the top of the outside wheel inward as it compresses, so the tyre stays the flattest of the three types.',
  multilink: 'Its links add a moderate amount of negative camber in bump, between the strut and the double wishbone.',
};

const GENERIC_ROLL = 'How much the outside wheel leans with the body depends on how much camber the linkage adds in bump.';

/** Outside front corner in a turn: lat_g < 0 is a right-hander, so the left side is outside. */
function outsideFront(t: RuleTelemetry): string | undefined {
  const id = t.lat_g < 0 ? 'fl' : 'fr';
  return t.corners[id] ? id : undefined;
}

function mostTravel(t: RuleTelemetry): string | undefined {
  let best: string | undefined;
  for (const [id, c] of Object.entries(t.corners)) if (c && (!best || Math.abs(c.travel_mm) > Math.abs(t.corners[best]!.travel_mm))) best = id;
  return best;
}

function corner(t: RuleTelemetry): string {
  const id = outsideFront(t);
  const c = id ? t.corners[id] : undefined;
  if (!id || !c || t.vehicle_class !== 'car') return '';
  return ` The outside ${CORNER_NAMES[id]} wheel sits at ${c.camber_deg > 0 ? 'plus ' : 'minus '}${n(c.camber_deg)} degrees of camber to the road.`;
}

function rollAnswer(t: RuleTelemetry, lead: string): string {
  if (t.vehicle_class !== 'car') return `${lead} the bike leans ${n(t.roll_deg)} degrees so that gravity balances the cornering force.`;
  return `${lead} the body rolls ${n(t.roll_deg)} degrees toward the outside and the outside tyres carry the extra load.${corner(t)} ${ROLL_CLAUSE[t.suspension] ?? GENERIC_ROLL}`;
}

const PHENOMENON: Readonly<Record<string, (t: RuleTelemetry) => string>> = {
  'ride-resonance': (t) =>
    `The washboard ripples get shorter along the straight, so at ${n(t.speed_kmh, 0)} km/h they first rock the body and then make the wheels hop on their tyres. Springs and dampers are the same for every suspension type here, so this looks almost the same on all of them.`,
  'brake-dive': (t) =>
    `Braking at ${n(t.long_g)} g moves load onto the front tyres, so the nose dips ${n(t.pitch_deg)} degrees. The linkage's side-view geometry resists part of that dive, but the difference between the types is tiny in this simulation.`,
  'steering-lock': (t) =>
    `At full lock the tilt of the steering axis adds negative camber to the outside front wheel, so the steering geometry matters as much as the linkage here.${corner(t)}`,
  'single-wheel-bump': (t) => {
    const id = mostTravel(t);
    const c = id ? t.corners[id] : undefined;
    const lead = id && c ? `The ${CORNER_NAMES[id] ?? id} wheel ${c.travel_mm >= 0 ? 'rose' : 'dropped'} ${n(c.travel_mm, 0)} mm while the body stayed calm.` : 'Each wheel meets the bump on its own while the body stays calm.';
    return `${lead} Independent suspension lets one wheel move without dragging the others, and bump steer is tuned to almost nothing, so the wheel keeps pointing straight.`;
  },
  'sustained-roll': (t) => rollAnswer(t, `In this long fast bend at ${n(t.lat_g)} g`),
  'steady-state-roll': (t) => rollAnswer(t, `Around the carousel at ${n(t.lat_g)} g`),
  'off-camber': (t) => rollAnswer(t, `The road falls away from this bend, so at ${n(t.lat_g)} g`),
  harshness: (t) =>
    `Cobbles and humps push the wheels up quickly at ${n(t.speed_kmh, 0)} km/h, and the dampers decide how much of that reaches the body. A strut has a little more friction from side load, which makes small bumps slightly harsher, but in this simulation the difference is small.`,
  'roll-reversal': (t) =>
    `Through the chicane the load swaps from one side to the other, so the body rolls one way and then the other; right now it leans ${n(t.roll_deg)} degrees ${side(t.roll_deg)}. The dampers set how quickly the roll can change direction.`,
  heave: (t) =>
    `Over the crest the car goes light and the springs extend; in the dip they compress as the car is pressed down. Right now the nose is ${n(t.pitch_deg)} degrees ${t.pitch_deg >= 0 ? 'down' : 'up'}.`,
  'lane-change': (t) =>
    `A double lane change at ${n(t.speed_kmh, 0)} km/h throws the load from side to side, so the body rolls first one way and then back. Right now it leans ${n(t.roll_deg)} degrees ${side(t.roll_deg)}.`,
  settle: (t) => `On the run-in the car is almost straight and steady at ${n(t.speed_kmh, 0)} km/h, so the suspension settles back to its static ride height.`,
};

/** Short glossary answers for common questions, matched by keyword (checked before the section rule). */
const GLOSSARY: readonly (readonly [RegExp, string])[] = [
  [/^(?=.*\b(what|explain|mean))(?=.*roll cent(re|er))/i, 'The roll centre is the imaginary point the linkage lets the body pivot about in a corner; the higher it is, the more cornering load goes through the links instead of the springs, so the body rolls a little less.'],
  [/\bbest\b|\bbetter\b|which (one|suspension)/i, 'None is best overall: a strut is the cheapest and most compact, a double wishbone controls camber best, and a multi-link gives the most freedom to tune at the cost of complexity.'],
  [/^(?=.*\b(what|explain|mean))(?=.*camber)/i, 'Camber is how far the top of the wheel leans in or out; negative camber means the top leans toward the car, which keeps the outside tyre flatter on the road in a corner.'],
];

// ---------------------------------------------------------------- Manual Drive (12-03)

/** A detected drive moment (the DriveEvent kinds plus the M1 wheel-lift / bump-stop and a swap while driving). */
export type DriveMoment =
  | { readonly kind: 'slide'; readonly axle: 'front' | 'rear'; readonly lift: boolean }
  | { readonly kind: 'lockup' | 'wheelspin' | 'wheel-lift' | 'bump-stop'; readonly corner: number }
  | { readonly kind: 'aid'; readonly aid: 'abs' | 'traction' | 'stability' }
  | { readonly kind: 'strike'; readonly corner: number; readonly kerb: boolean }
  | { readonly kind: 'hard-stop' }
  | { readonly kind: 'swap'; readonly previous: string; readonly next: string };

const WHEEL = ['front-left', 'front-right', 'rear-left', 'rear-right'];
const WHEEL_RE = '(front-left|front-right|rear-left|rear-right)';
export const SUSPENSION_NAMES: Readonly<Record<string, string>> = { macpherson: 'MacPherson strut', 'double-wishbone': 'double wishbone', multilink: 'multi-link' };
const NAME_RE = '(MacPherson strut|double wishbone|multi-link)';
const idOfName = (name: string): string => Object.keys(SUSPENSION_NAMES).find((k) => SUSPENSION_NAMES[k] === name) ?? name;

/** Plain-language label of a moment (EngineerDrive.detected): no digits, words and light punctuation only. */
export function driveLabel(m: DriveMoment): string {
  const w = 'corner' in m ? (WHEEL[m.corner] ?? 'one') : '';
  switch (m.kind) {
    case 'slide':
      return m.axle === 'front' ? 'front slide, the car ran wide (understeer)' : m.lift ? 'rear slide after lifting off the throttle (lift-off oversteer)' : 'rear slide, the tail stepped out (oversteer)';
    case 'lockup':
      return `${w} wheel locked under braking`;
    case 'wheelspin':
      return `${w} wheel spun under power`;
    case 'wheel-lift':
      return `${w} wheel went light`;
    case 'bump-stop':
      return `${w} wheel reached its bump stop`;
    case 'aid':
      return m.aid === 'abs' ? 'anti-lock assist eased the brakes' : m.aid === 'traction' ? 'traction assist trimmed the engine' : 'stability assist braked one wheel';
    case 'strike':
      return `${w} wheel hit a ${m.kerb ? 'kerb' : 'bump'}`;
    case 'hard-stop':
      return 'hard stop from speed';
    case 'swap':
      return `suspension switched from ${SUSPENSION_NAMES[m.previous] ?? m.previous} to ${SUSPENSION_NAMES[m.next] ?? m.next}`;
  }
}

/** Label -> moment kind key and its wheel / suspension names (inverse of driveLabel for the primary event). */
function parseLabel(label: string): { key: string; wheel: string; previous: string; next: string } | undefined {
  const primary = label.split('; also ')[0] ?? '';
  const table: readonly (readonly [string, RegExp])[] = [
    ['slide-front', /^front slide/],
    ['slide-rear-lift', /^rear slide after lifting off/],
    ['slide-rear', /^rear slide/],
    ['lockup', new RegExp(`^${WHEEL_RE} wheel locked`)],
    ['wheelspin', new RegExp(`^${WHEEL_RE} wheel spun`)],
    ['wheel-lift', new RegExp(`^${WHEEL_RE} wheel went light`)],
    ['bump-stop', new RegExp(`^${WHEEL_RE} wheel reached its bump stop`)],
    ['strike-kerb', new RegExp(`^${WHEEL_RE} wheel hit a kerb`)],
    ['strike-bump', new RegExp(`^${WHEEL_RE} wheel hit a bump`)],
    ['aid-abs', /^anti-lock assist/],
    ['aid-traction', /^traction assist/],
    ['aid-stability', /^stability assist/],
    ['hard-stop', /^hard stop/],
    ['swap', new RegExp(`^suspension switched from ${NAME_RE} to ${NAME_RE}`)],
  ];
  for (const [key, re] of table) {
    const m = re.exec(primary);
    if (!m) continue;
    const swap = key === 'swap';
    return { key, wheel: swap ? '' : (m[1] ?? ''), previous: swap ? idOfName(m[1] ?? '') : '', next: swap ? idOfName(m[2] ?? '') : '' };
  }
  return undefined;
}

/** Kind key of a label's primary event ('slide-rear-lift', 'aid-abs', 'swap', ...), or undefined for 'none'. */
export const driveKey = (label: string): string | undefined => parseLabel(label)?.key;

const WHEEL_ID: Readonly<Record<string, string>> = { 'front-left': 'fl', 'front-right': 'fr', 'rear-left': 'rl', 'rear-right': 'rr' };
/**
 * Rear compliance steer per type while driving (09-04: the multi-link rear steers about three times as much; strut and
 * wishbone differ below notice). Data, not branching on ids (ARCHITECTURE §2 rule 8); pinned in engineer-drive-facts.
 */
const REAR_COMPLIANCE: Readonly<Record<string, 'small' | 'large'>> = { macpherson: 'small', 'double-wishbone': 'small', multilink: 'large' };

/** What changes between two types while driving (09-04 honesty report; pinned in engineer-drive-facts.test.ts). */
function swapAnswer(previous: string, next: string): string {
  const p = SUSPENSION_NAMES[previous] ?? previous;
  const q = SUSPENSION_NAMES[next] ?? next;
  const from = REAR_COMPLIANCE[previous];
  const to = REAR_COMPLIANCE[next];
  if (from === undefined || to === undefined || from === to)
    return `A ${p} and a ${q} drive almost the same in this model: the steering needed, the response and the grip limit hardly change, even though the linkages move differently. The close-up view shows the geometry difference better than the driving does.`;
  if (to === 'large')
    return 'On the multi-link the car needs a little more steering for the same corner, turns in a little quicker and the rear feels more planted, because its rear bushings steer the rear wheels slightly into the turn. The grip limit and the stopping distance stay almost the same.';
  return `Coming from the multi-link, the ${q} needs a little less steering for the same corner and its rear is a little livelier, because the multi-link's extra rear compliance steer is gone. The grip limit and the stopping distance stay almost the same.`;
}

const COMPARE_ANSWER = 'In this model the strut and the double wishbone drive almost the same; the multi-link needs a little more steering for the same corner and its rear feels more planted. The grip limit and the stopping distance are almost the same for all three, and none is best overall.';

const DRIVE_GLOSSARY: readonly (readonly [RegExp, string])[] = [
  [/^(?=.*\b(what|explain|mean))(?=.*understeer)/i, 'Understeer means the front tyres reach their grip limit first, so the car runs wide and more steering does not help; less speed or less steering gives the grip back.'],
  [/^(?=.*\b(what|explain|mean))(?=.*oversteer)/i, 'Oversteer means the rear tyres reach their grip limit first, so the tail steps out and the car rotates more than you steer; easing the throttle and steering where you want to go catches it.'],
  [/^(?=.*\bwhat (is|does))(?=.*\b(abs|anti-lock)\b)/i, 'The anti-lock assist (a simplified model) eases the brake on a wheel that is about to lock, so the tyre keeps turning and the car can still steer while you brake hard.'],
  [/^(?=.*\bwhat (is|does))(?=.*\btraction\b)/i, 'The traction assist (a simplified model) trims the engine when the driven rear wheels begin to spin, so the rear tyres keep their grip.'],
  [/^(?=.*\bwhat (is|does))(?=.*\bstability\b)/i, 'The stability assist (a simplified model) brakes a single wheel when the car rotates more or less than the steering asks, to pull it back toward where you steer.'],
];

const kmh = (t: RuleTelemetry) => `${n(t.speed_kmh, 0)} km/h`;

/** One answer per detected event kind; every number is a telemetry value captured at the event. */
function driveAnswer(question: string, t: RuleTelemetry, d: RuleDrive): string {
  const ev = parseLabel(d.detected);
  if (!ev) {
    if (/\b(switch|switched|swap|swapped|changed?)\b/i.test(question)) return COMPARE_ANSWER;
    return `No slide, lock-up or other driving event was detected in the last few seconds, so there is no cause to explain yet. Right now the car is at ${kmh(t)} with ${n(t.lat_g)} g of cornering and ${n(d.sideslip_deg, 1)} degrees of sideslip.`;
  }
  const wheel = ev.wheel;
  const c = t.corners[WHEEL_ID[wheel] ?? ''];
  switch (ev.key) {
    case 'slide-rear-lift':
      return `Lifting off the throttle mid-corner moved load onto the front tyres, so the lighter rear tyres lost grip and the car rotated, with ${n(d.sideslip_deg, 1)} degrees of sideslip at ${kmh(t)}. Next time ease off gradually or keep a little throttle through the corner.`;
    case 'slide-rear':
      return `The rear tyres went past their grip, so the tail stepped out (oversteer), with ${n(d.sideslip_deg, 1)} degrees of sideslip at ${kmh(t)}. Throttle, a lift or a sudden steer near the limit takes grip from the rear; ease the throttle and steer where you want to go.`;
    case 'slide-front':
      return `The front tyres went past their grip, so the car ran wide instead of turning (understeer) at ${kmh(t)} with ${n(d.steer_deg, 1)} degrees of steering. More steering does not help once the fronts slide; less speed or less steering gives the grip back.`;
    case 'lockup':
      return `The ${wheel} wheel locked under braking: the brake asked for more than its tyre could take at ${kmh(t)}, and a sliding tyre cannot steer. Ease the pedal until the wheel turns again; the anti-lock assist does that for you when it is on.`;
    case 'wheelspin':
      return `The ${wheel} wheel spun up at ${n(d.throttle_pct, 0)} percent throttle: the engine sent more drive than its tyre could take. Squeeze the throttle in gradually; the traction assist trims the engine for you when it is on.`;
    case 'aid-abs':
      return `The anti-lock assist (a simplified model) eased the brakes on a wheel that was about to lock, so it kept the wheels turning and the car could still steer. You were braking at ${n(d.brake_pct, 0)} percent pedal at ${kmh(t)}.`;
    case 'aid-traction':
      return `The traction assist (a simplified model) trimmed the engine because the driven rear wheels began to spin at ${n(d.throttle_pct, 0)} percent throttle. That keeps the rear tyres gripping, so the tail stays in line.`;
    case 'aid-stability':
      return `The stability assist (a simplified model) braked one wheel because the car was rotating differently from what the steering asked, with ${n(d.sideslip_deg, 1)} degrees of sideslip. It pulls the car back toward where you steer.`;
    case 'strike-kerb':
    case 'strike-bump': {
      const what = ev.key === 'strike-kerb' ? 'kerb' : 'bump';
      const travel = c ? ` and moved ${n(c.travel_mm, 0)} mm` : '';
      return `The ${wheel} wheel hit a ${what}: its spring compressed quickly${travel}, and the damper settled it while the body stayed calmer. Independent suspension lets one wheel move without dragging the others.`;
    }
    case 'hard-stop':
      return 'A hard stop: braking moved load onto the front tyres, so the nose dived and the front tyres did most of the work. The stopping distance is an output of this representative model, not a prediction for any real car.';
    case 'wheel-lift':
      return `The ${wheel} wheel went light: load moved off it, and with almost no load a tyre has almost no grip. Crests, kerbs and hard cornering on the inside wheels do this.`;
    case 'bump-stop':
      return `The ${wheel} wheel used up its suspension travel and touched the bump stop, which stiffens that corner sharply. Big bumps or kerbs at speed do this.`;
    case 'swap':
      return swapAnswer(ev.previous, ev.next);
    default:
      return COMPARE_ANSWER;
  }
}

export function ruleAnswer(question: string, phenomenon: string | undefined, t: RuleTelemetry): string {
  for (const [re, text] of GLOSSARY) if (re.test(question)) return text;
  if (t.drive && t.vehicle_class === 'car') {
    for (const [re, text] of DRIVE_GLOSSARY) if (re.test(question)) return text;
    return driveAnswer(question, t, t.drive);
  }
  const rule = phenomenon === undefined ? undefined : PHENOMENON[phenomenon];
  return rule ? rule(t) : `On the ${t.section_name.toLowerCase()} at ${n(t.speed_kmh, 0)} km/h the suspension is keeping the tyres on the road; ask about the roll, the camber or a wheel to see more.`;
}
