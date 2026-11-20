import { describe, expect, it, vi } from 'vitest';
import { ROOM_CODE_ALPHABET, type CreateRoomResponse } from '../../src/contracts/net';
import app from '../../worker/index';

function fakeEnv(opts: { allow?: boolean; initResults?: boolean[] } = {}) {
  const results = [...(opts.initResults ?? [true])];
  const names: string[] = [];
  const forwarded: Request[] = [];
  const limit = vi.fn(async () => ({ success: opts.allow ?? true }));
  const env = {
    RL_ROOMS: { limit },
    ROOM: {
      getByName(name: string) {
        names.push(name);
        return {
          init: async () => results.shift() ?? false,
          fetch: async (req: Request) => {
            forwarded.push(req);
            return new Response('forwarded', { status: 200 });
          },
        };
      },
    },
  } as unknown as Env;
  return { env, names, forwarded, limit };
}

const upgrade = { headers: { Upgrade: 'websocket' } };

describe('POST /api/rooms', () => {
  it('creates a private room and returns code + host key, uncached', async () => {
    const { env, names, limit } = fakeEnv();
    const res = await app.request('/api/rooms', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.7' } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as CreateRoomResponse;
    expect(body.code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{5}$`));
    expect(body.hostKey).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(names).toEqual([body.code]);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
  });

  it('retries taken codes up to 3 times, then 503', async () => {
    const retry = fakeEnv({ initResults: [false, false, true] });
    expect((await app.request('/api/rooms', { method: 'POST' }, retry.env)).status).toBe(200);
    expect(retry.names).toHaveLength(3);
    const fail = fakeEnv({ initResults: [false, false, false] });
    expect((await app.request('/api/rooms', { method: 'POST' }, fail.env)).status).toBe(503);
  });

  it('is rate limited (429) and POST-only', async () => {
    const { env, names } = fakeEnv({ allow: false });
    const res = await app.request('/api/rooms', { method: 'POST' }, env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'busy' });
    expect(names).toEqual([]);
    expect((await app.request('/api/rooms', {}, env)).status).toBe(405);
  });
});

describe('GET /ws/:code', () => {
  it('forwards upgrades for LIVE and private codes to the room object', async () => {
    const { env, names, forwarded } = fakeEnv();
    expect((await app.request('/ws/LIVE?id=a&role=viewer&pv=1', upgrade, env)).status).toBe(200);
    expect((await app.request('/ws/AB2CD', upgrade, env)).status).toBe(200);
    expect(names).toEqual(['LIVE', 'AB2CD']);
    expect(new URL(forwarded[0]!.url).search).toBe('?id=a&role=viewer&pv=1');
  });

  it('rejects malformed codes (404) and non-upgrade requests (426)', async () => {
    const { env, names } = fakeEnv();
    for (const code of ['live', 'ABCD', 'ABCDEF', 'AB1CD', 'ab2cd']) {
      expect((await app.request(`/ws/${code}`, upgrade, env)).status, code).toBe(404);
    }
    expect((await app.request('/ws/LIVE', {}, env)).status).toBe(426);
    expect(names).toEqual([]);
  });
});

describe('GET /r/:code', () => {
  it('redirects the short audience link to the remote page', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/r/ab2cd', {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/remote.html?room=AB2CD');
    expect((await app.request('/r/LIVE', {}, env)).status).toBe(404);
  });
});
