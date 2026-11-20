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

export function ruleAnswer(question: string, phenomenon: string | undefined, t: RuleTelemetry): string {
  for (const [re, text] of GLOSSARY) if (re.test(question)) return text;
  const rule = phenomenon === undefined ? undefined : PHENOMENON[phenomenon];
  return rule ? rule(t) : `On the ${t.section_name.toLowerCase()} at ${n(t.speed_kmh, 0)} km/h the suspension is keeping the tyres on the road; ask about the roll, the camber or a wheel to see more.`;
}
