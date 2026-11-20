import { Hono } from 'hono';
import { buildEngineerTools, ENGINEER_MAX_ACTIONS, type EngineerAction, type EngineerRequest, type EngineerResponse } from '../../src/contracts/engineer';
import { API } from '../../src/contracts/net';
import { CAR_CORNERS, MOTO_CORNERS } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { ruleAnswer } from '../engineer/fallback';
import { cleanText, runEngineerModel } from '../engineer/model';
import { ungroundedNumbers } from '../engineer/numbers';
import { buildMessages } from '../engineer/prompt';
import { engineerRequestSchema, parseAction, type ActionIds } from '../schemas/engineer';

/** Request body cap: a full request (question, telemetry, 6 history turns) is well under this. */
export const ENGINEER_MAX_BYTES = 8192;
// Motorcycle preset ids (ARCHITECTURE §7.1); the content arrives with phase 5.
const MOTO_SUSPENSIONS = ['moto-classic', 'moto-modern', 'moto-telelever'];
const SECTION_IDS = provingLoop.segments.map((s) => s.id);

function idsFor(vehicleClass: 'car' | 'motorcycle'): ActionIds {
  return vehicleClass === 'car'
    ? { suspensions: gtCoupe.suspensions, sections: SECTION_IDS, corners: CAR_CORNERS }
    : { suspensions: MOTO_SUSPENSIONS, sections: SECTION_IDS, corners: MOTO_CORNERS };
}

export type EngineerOutcome = 'model' | 'no-model' | 'model-error' | 'empty' | 'ungrounded';

/** Pure post-processing of one request: model call (if any) -> clean text, validated actions, number check. */
export async function answer(req: EngineerRequest, ai: Ai | undefined): Promise<{ body: EngineerResponse; outcome: EngineerOutcome; detail?: string }> {
  const t = req.telemetry;
  const section = provingLoop.segments.find((s) => s.id === t.section);
  const fallback = (actions: EngineerAction[] = []): EngineerResponse => ({ text: ruleAnswer(req.question, section?.phenomenon, t), actions, source: 'fallback' });
  if (!ai) return { body: fallback(), outcome: 'no-model' };
  const ids = idsFor(t.vehicle_class);
  let run;
  try {
    run = await runEngineerModel(ai, buildMessages(req, section), buildEngineerTools(ids));
  } catch (e) {
    return { body: fallback(), outcome: 'model-error', detail: e instanceof Error ? e.message : String(e) };
  }
  const actions: EngineerAction[] = [];
  for (const call of run.reply.toolCalls) {
    const a = parseAction(call.name, call.args, ids);
    if (a && actions.length < ENGINEER_MAX_ACTIONS && !actions.some((b) => JSON.stringify(b) === JSON.stringify(a))) actions.push(a);
  }
  const text = cleanText(run.reply.text);
  if (!text) return { body: fallback(actions), outcome: 'empty', detail: run.model };
  const bad = ungroundedNumbers(text, t);
  if (bad.length > 0) return { body: fallback(actions), outcome: 'ungrounded', detail: `${run.model}: ${bad.join(',')}` };
  return { body: { text, actions, source: 'model' }, outcome: 'model', detail: run.model };
}

const r = new Hono<{ Bindings: Env }>();

r.post(API.engineer, async (c) => {
  const noStore = { 'Cache-Control': 'no-store' };
  if (Number(c.req.header('content-length') ?? 0) > ENGINEER_MAX_BYTES) return c.json({ error: 'too_big' }, 413, noStore);
  const raw = await c.req.text();
  if (raw.length > ENGINEER_MAX_BYTES) return c.json({ error: 'too_big' }, 413, noStore);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: 'bad_request' }, 400, noStore);
  }
  const parsed = engineerRequestSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400, noStore);

  // Keyed by the anonymous client id so a venue behind one NAT is not throttled as one visitor.
  // shortcut: a client can rotate ids; the account's Workers AI daily allocation is the hard backstop.
  const clientId = c.req.header('x-client-id');
  const key = clientId && /^[\w-]{8,64}$/.test(clientId) ? `c:${clientId}` : `ip:${c.req.header('cf-connecting-ip') ?? 'anon'}`;
  if (c.env.RL_ENGINEER && !(await c.env.RL_ENGINEER.limit({ key })).success) return c.json({ error: 'busy' }, 429, noStore);

  // Cast only for exactOptionalPropertyTypes: zod types optional corners as `X | undefined` (absent at runtime).
  const req = parsed.data as EngineerRequest;
  c.env.STATS?.writeDataPoint({ indexes: ['engineer-asked'], blobs: ['engineer-asked', req.telemetry.suspension, ''], doubles: [1] });
  const started = Date.now();
  const { body, outcome, detail } = await answer(req, c.env.AI);
  // Never log the question text: outcome, model and timing only.
  console.log(JSON.stringify({ engineer: outcome, detail, ms: Date.now() - started, actions: body.actions.length }));
  return c.json(body, 200, noStore);
});

export default r;
