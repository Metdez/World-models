import { Hono } from 'hono';
import { API, type TimeResponse } from '../../src/contracts/net';

const r = new Hono<{ Bindings: Env }>();
// Stamped as late as possible: clients estimate offset from the round trip around this value.
r.get(API.time, (c) => c.json({ t: Date.now() } satisfies TimeResponse, 200, { 'Cache-Control': 'no-store' }));

export default r;
