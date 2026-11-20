import { z } from 'zod';
import type { AnalyticsEvent } from '../../src/contracts/net';

/** Registry ids / quality tiers only: kebab-case, short. Rejects free text by construction. */
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

export const analyticsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('suspension-picked'), vehicle: id, suspension: id }).readonly(),
  z.strictObject({ type: z.literal('view-changed'), view: z.enum(['follow', 'explore', 'closeup']) }).readonly(),
  z.strictObject({ type: z.literal('engineer-asked'), suspension: id }).readonly(),
  z.strictObject({ type: z.literal('session'), quality: id, fps: z.number().finite().min(0).max(1000) }).readonly(),
]);

/** Max events per request (the client batches up to this many). */
export const EVENT_BATCH_MAX = 8;

/** One event (the contract shape) or a sendBeacon batch of them. */
export const eventBodySchema = z.union([
  analyticsEventSchema.transform((e) => [e]),
  z.array(analyticsEventSchema).min(1).max(EVENT_BATCH_MAX),
]);

// Compile-time check that the schema matches the frozen contract both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemaMatchesContract: Same<z.infer<typeof analyticsEventSchema>, AnalyticsEvent> = true;
void schemaMatchesContract;
