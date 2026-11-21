import { Hono } from 'hono';
import { API, type ErrorResponse } from '../../src/contracts/net';

/** Crowd insight (12-06, stretch): not built yet. The client shows nothing on 501. */
const r = new Hono<{ Bindings: Env }>();
r.all(API.insight, (c) => c.json({ error: 'not_implemented' } satisfies ErrorResponse, 501));

export default r;
