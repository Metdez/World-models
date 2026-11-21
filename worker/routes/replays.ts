import { Hono } from 'hono';
import { API, type ErrorResponse } from '../../src/contracts/net';

/** Skeleton (12-01 task 1): the full route lands in task 2. */
const r = new Hono<{ Bindings: Env }>();
r.all(`${API.replays}/*`, (c) => c.json({ error: 'not_configured' } satisfies ErrorResponse, 503));
r.all(API.replays, (c) => c.json({ error: 'not_configured' } satisfies ErrorResponse, 503));

export default r;
