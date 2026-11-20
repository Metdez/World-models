/**
 * Global request limits (one Durable Object instance per limited route, e.g. `LIMITER.getByName('engineer')`).
 * Rate-limit bindings count per location and in-memory counters per isolate, so a burst spread over colos and
 * isolates passed both (06-02 live test). One DO sees every request of its route, wherever it lands.
 */
import { DurableObject } from 'cloudflare:workers';

export interface LimitRule {
  readonly key: string;
  readonly limit: number;
}

export interface AdmitRequest {
  /** Every rule must allow the request; every request counts against every rule (also refused ones). */
  readonly rules: readonly LimitRule[];
  readonly windowMs: number;
  /** Daily model-call budget to spend one unit of; omitted = the request needs no model (e.g. it is invalid). */
  readonly budget?: number;
}

/** busy = over a rate rule (429); rules = within rate but the day's model budget is spent; model = go ahead. */
export type Verdict = 'busy' | 'rules' | 'model';

interface Window {
  start: number;
  count: number;
}

const PRUNE_ABOVE = 10_000;

/** Fixed windows, all rules counted on every hit. Pure apart from the map it owns. */
export class Windows {
  private readonly map = new Map<string, Window>();

  hit(rules: readonly LimitRule[], windowMs: number, now: number): boolean {
    if (this.map.size > PRUNE_ABOVE) for (const [k, w] of this.map) if (now - w.start >= windowMs) this.map.delete(k);
    let ok = true;
    for (const { key, limit } of rules) {
      let w = this.map.get(key);
      if (!w || now - w.start >= windowMs) this.map.set(key, (w = { start: now, count: 0 }));
      if (++w.count > limit) ok = false;
    }
    return ok;
  }
}

/** UTC day: the Workers AI free allocation resets at 00:00 UTC. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

interface Spent {
  readonly day: string;
  readonly used: number;
}

export class Limiter extends DurableObject<Env> {
  // In memory: a restart forgets at most one window. The budget is persisted (it must survive the day).
  private readonly windows = new Windows();

  async admit(req: AdmitRequest): Promise<Verdict> {
    const now = Date.now();
    if (!this.windows.hit(req.rules, req.windowMs, now)) return 'busy';
    if (req.budget === undefined) return 'model';
    const day = utcDay(now);
    const saved = await this.ctx.storage.get<Spent>('spent');
    const used = saved?.day === day ? saved.used : 0;
    if (used >= req.budget) return 'rules';
    await this.ctx.storage.put('spent', { day, used: used + 1 } satisfies Spent);
    return 'model';
  }

  /** Model calls counted today (ops / tests). */
  async spentToday(): Promise<number> {
    const saved = await this.ctx.storage.get<Spent>('spent');
    return saved?.day === utcDay(Date.now()) ? saved.used : 0;
  }
}
