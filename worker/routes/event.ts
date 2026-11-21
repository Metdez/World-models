import { Hono } from 'hono';
import type { AnalyticsEvent } from '../../src/contracts/net';
import { API } from '../../src/contracts/net';
import { eventBodySchema } from '../schemas/event';

/** Request body cap (a full batch of 8 is ~600 bytes). */
export const EVENT_MAX_BYTES = 2048;
/** Requests per client address per window, per isolate. Generous: venues put many viewers behind one NAT. */
export const EVENT_RATE_LIMIT = 120;
const WINDOW_MS = 60_000;

// Fixed-window counters. The address lives only here, in memory, for at most one window; it is never written to
// Analytics Engine or logged. No binding is configured for this route (wrangler.jsonc is frozen), so per-isolate it is.
const windows = new Map<string, { start: number; count: number }>();

function allow(key: string, now: number): boolean {
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
  }
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  return ++w.count <= EVENT_RATE_LIMIT;
}

/** One data point per event: index = event type (sampling key), blobs = [type, a, b], doubles = [n]. */
function toDataPoint(e: AnalyticsEvent): AnalyticsEngineDataPoint {
  switch (e.type) {
    case 'suspension-picked':
      return { indexes: [e.type], blobs: [e.type, e.vehicle, e.suspension], doubles: [1] };
    case 'view-changed':
      return { indexes: [e.type], blobs: [e.type, e.view, ''], doubles: [1] };
    case 'engineer-asked':
      return { indexes: [e.type], blobs: [e.type, e.suspension, ''], doubles: [1] };
    case 'session':
      return { indexes: [e.type], blobs: [e.type, e.quality, ''], doubles: [e.fps] };
    case 'drive-session':
      return { indexes: [e.type], blobs: [e.type, e.vehicle, e.suspension], doubles: [e.seconds] };
    case 'station-visit':
      return { indexes: [e.type], blobs: [e.type, e.station, e.suspension], doubles: [e.speed] };
  }
}

const r = new Hono<{ Bindings: Env }>();

// sendBeacon posts text/plain or application/json; the body is parsed as JSON whatever the content type.
r.post(API.event, async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > EVENT_MAX_BYTES) return c.json({ error: 'too_large' }, 413);
  if (!allow(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) return c.json({ error: 'busy' }, 429);

  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > EVENT_MAX_BYTES) return c.json({ error: 'too_large' }, 413);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return c.json({ error: 'bad_request' }, 400);
  }
  const parsed = eventBodySchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const stats = c.env?.STATS as AnalyticsEngineDataset | undefined;
  if (stats) for (const e of parsed.data) stats.writeDataPoint(toDataPoint(e));
  return c.body(null, 204);
});

export default r;
