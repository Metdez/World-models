import { Hono } from 'hono';
import { API, REMOTE_PREFIX, WS_PREFIX } from '../../src/contracts/net';

/** STUB — owner: plan 06-01. Replace the handlers; keep the default export shape. */
const r = new Hono<{ Bindings: Env }>();
r.all(API.rooms, (c) => c.json({ error: 'not_implemented' }, 501));
r.all(`${WS_PREFIX}:code`, (c) => c.json({ error: 'not_implemented' }, 501));
r.all(`${REMOTE_PREFIX}:code`, (c) => c.json({ error: 'not_implemented' }, 501));

export default r;
