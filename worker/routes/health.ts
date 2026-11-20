import { Hono } from 'hono';
import { API, type HealthResponse } from '../../src/contracts/net';

const r = new Hono<{ Bindings: Env }>();
r.get(API.health, (c) => {
  const body: HealthResponse = { ok: true, version: c.env.APP_VERSION, time: Date.now() };
  return c.json(body, 200, { 'Cache-Control': 'no-store' });
});

export default r;
