import { Hono } from 'hono';
import { API } from '../../src/contracts/net';

/** STUB — owner: plan 01-03. Replace the handlers; keep the default export shape. */
const r = new Hono<{ Bindings: Env }>();
r.all(API.health, (c) => c.json({ error: 'not_implemented' }, 501));

export default r;
