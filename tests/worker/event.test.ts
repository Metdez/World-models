import { describe, expect, it } from 'vitest';
import app from '../../worker/index';
import { EVENT_RATE_LIMIT } from '../../worker/routes/event';

function fakeEnv() {
  const points: AnalyticsEngineDataPoint[] = [];
  const env = { APP_VERSION: 't', STATS: { writeDataPoint: (p?: AnalyticsEngineDataPoint) => p && points.push(p) } };
  return { env: env as unknown as Env, points };
}

let ipSeq = 0;
function post(body: string, env: Env, headers: Record<string, string> = {}) {
  return app.request(
    '/api/event',
    { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8', 'cf-connecting-ip': `10.0.0.${++ipSeq}`, ...headers } },
    env,
  );
}

describe('POST /api/event', () => {
  it('writes one data point per event type with the contract layout', async () => {
    const { env, points } = fakeEnv();
    const events = [
      { type: 'suspension-picked', vehicle: 'gt-coupe', suspension: 'multilink' },
      { type: 'view-changed', view: 'closeup' },
      { type: 'engineer-asked', suspension: 'macpherson' },
      { type: 'session', quality: 'high', fps: 58.5 },
    ];
    for (const e of events) expect((await post(JSON.stringify(e), env)).status).toBe(204);
    expect(points).toEqual([
      { indexes: ['suspension-picked'], blobs: ['suspension-picked', 'gt-coupe', 'multilink'], doubles: [1] },
      { indexes: ['view-changed'], blobs: ['view-changed', 'closeup', ''], doubles: [1] },
      { indexes: ['engineer-asked'], blobs: ['engineer-asked', 'macpherson', ''], doubles: [1] },
      { indexes: ['session'], blobs: ['session', 'high', ''], doubles: [58.5] },
    ]);
  });

  it('accepts a sendBeacon batch', async () => {
    const { env, points } = fakeEnv();
    const batch = [
      { type: 'view-changed', view: 'explore' },
      { type: 'view-changed', view: 'follow' },
    ];
    const res = await post(JSON.stringify(batch), env, { 'content-type': 'application/json' });
    expect(res.status).toBe(204);
    expect(points.map((p) => p.blobs?.[1])).toEqual(['explore', 'follow']);
  });

  it.each([
    ['unknown type', { type: 'page-view', url: '/x' }],
    ['extra key (identifier smuggling)', { type: 'view-changed', view: 'follow', id: 'abc' }],
    ['free text in an id field', { type: 'engineer-asked', suspension: 'why does my car roll so much?' }],
    ['uppercase id', { type: 'engineer-asked', suspension: 'MacPherson' }],
    ['bad view', { type: 'view-changed', view: 'cockpit' }],
    ['non-finite-ish fps', { type: 'session', quality: 'high', fps: 1e6 }],
    ['fps as string', { type: 'session', quality: 'high', fps: '60' }],
    ['empty batch', []],
    ['batch too long', Array.from({ length: 9 }, () => ({ type: 'view-changed', view: 'follow' }))],
    ['one bad event spoils the batch', [{ type: 'view-changed', view: 'follow' }, { type: 'nope' }]],
    ['not an object', 'hello'],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const { env, points } = fakeEnv();
    const res = await post(JSON.stringify(body), env);
    expect(res.status).toBe(400);
    expect(points).toEqual([]);
  });

  it('rejects malformed JSON', async () => {
    const { env, points } = fakeEnv();
    expect((await post('{"type":', env)).status).toBe(400);
    expect(points).toEqual([]);
  });

  it('rejects oversized bodies with 413', async () => {
    const { env, points } = fakeEnv();
    const big = JSON.stringify({ type: 'view-changed', view: 'follow', pad: 'x'.repeat(4000) });
    expect((await post(big, env)).status).toBe(413);
    expect(points).toEqual([]);
  });

  it('is a silent no-op without the STATS binding', async () => {
    const env = { APP_VERSION: 't' } as unknown as Env;
    expect((await post(JSON.stringify({ type: 'view-changed', view: 'follow' }), env)).status).toBe(204);
  });

  it('rate-limits one address per window, independently of others', async () => {
    const { env, points } = fakeEnv();
    const body = JSON.stringify({ type: 'view-changed', view: 'follow' });
    const ip = { 'cf-connecting-ip': '192.0.2.77' };
    for (let i = 0; i < EVENT_RATE_LIMIT; i++) expect((await post(body, env, ip)).status).toBe(204);
    expect((await post(body, env, ip)).status).toBe(429);
    expect(points).toHaveLength(EVENT_RATE_LIMIT);
    expect((await post(body, env)).status).toBe(204);
  });

  it('only answers POST', async () => {
    const { env } = fakeEnv();
    expect((await app.request('/api/event', {}, env)).status).toBe(404);
  });
});
