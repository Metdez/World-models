/** zod validation for POST /api/engineer (trust boundary) and for the model's tool calls. */
import { z } from 'zod';
import type { EngineerAction } from '../../src/contracts/engineer';
import { NET_LIMITS } from '../../src/contracts/net';
import { COMPONENT_COLORS, type ComponentRole } from '../../src/contracts/suspension';
import type { CornerId } from '../../src/contracts/units';

const num = (min: number, max: number) => z.number().min(min).max(max);
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
// Labels end up in the prompt: words and light punctuation only.
const label = (max: number) => z.string().max(max).regex(/^[\p{L}\p{N} ,.()'/-]*$/u);

const corner = z.strictObject({
  camber_deg: num(-30, 30),
  toe_deg: num(-30, 30),
  travel_mm: num(-500, 500),
  load_n: num(0, 60000),
  grip_use: num(0, 5),
});

export const engineerRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(NET_LIMITS.engineerQuestionChars),
  telemetry: z.strictObject({
    vehicle_class: z.enum(['car', 'motorcycle']),
    vehicle: id,
    suspension: id,
    section: id,
    section_name: label(40),
    event: label(120),
    speed_kmh: num(0, 500),
    lat_g: num(-5, 5),
    long_g: num(-5, 5),
    roll_deg: num(-90, 90),
    pitch_deg: num(-45, 45),
    corners: z.strictObject({ fl: corner, fr: corner, rl: corner, rr: corner, f: corner, r: corner }).partial(),
    derived: z
      .record(z.string().regex(/^[a-z0-9_]{1,48}$/), num(-1e6, 1e6))
      .refine((r) => Object.keys(r).length <= 16, 'too many derived values'),
  }),
  history: z
    .array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().max(NET_LIMITS.engineerHistoryChars) }))
    .max(NET_LIMITS.engineerHistoryMax),
});

const COMPONENTS = Object.keys(COMPONENT_COLORS) as [ComponentRole, ...ComponentRole[]];
const VIEWS = ['follow', 'explore', 'closeup'] as const;

export interface ActionIds {
  readonly suspensions: readonly string[];
  readonly sections: readonly string[];
  readonly corners: readonly CornerId[];
}

/** One tool call -> EngineerAction, or null. Enums come from the active vehicle's content; scale is clamped. */
export function parseAction(name: string, args: unknown, ids: ActionIds): EngineerAction | null {
  const oneOf = (list: readonly string[]) => z.string().refine((v) => list.includes(v));
  const cornerId = oneOf(ids.corners).transform((v) => v as CornerId);
  const a = typeof args === 'object' && args !== null ? Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null)) : {};
  const schemas = {
    switch_suspension: z.object({ id: oneOf(ids.suspensions) }).transform((x): EngineerAction => ({ tool: 'switch_suspension', args: x })),
    set_view: z
      .object({ view: z.enum(VIEWS), corner: cornerId.optional() })
      .transform((x): EngineerAction => ({ tool: 'set_view', args: x.corner === undefined ? { view: x.view } : { view: x.view, corner: x.corner } })),
    set_slow_motion: z
      .object({ scale: z.number() })
      .transform((x): EngineerAction => ({ tool: 'set_slow_motion', args: { scale: Math.min(1, Math.max(0.1, x.scale)) } })),
    highlight_component: z
      .object({ component: z.enum(COMPONENTS), corner: z.union([cornerId, z.literal('all')]).default('all') })
      .transform((x): EngineerAction => ({ tool: 'highlight_component', args: x })),
    jump_to_section: z.object({ section: oneOf(ids.sections) }).transform((x): EngineerAction => ({ tool: 'jump_to_section', args: x })),
  } as const;
  const schema = Object.hasOwn(schemas, name) ? schemas[name as keyof typeof schemas] : undefined;
  const parsed = schema?.safeParse(a);
  return parsed?.success ? parsed.data : null;
}
