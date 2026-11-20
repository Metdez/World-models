import { describe, expect, it } from 'vitest';
import type { HealthResponse, TimeResponse } from '../../src/contracts/net';
import app from '../../worker/index';

const env = { APP_VERSION: 'abc1234' } as unknown as Env;

describe('GET /api/health', () => {
  it('reports ok with the version from env, uncached', async () => {
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.version).toBe('abc1234');
    expect(Math.abs(body.time - Date.now())).toBeLessThan(5000);
  });
});

describe('GET /api/time', () => {
  it('returns the server clock, uncached', async () => {
    const before = Date.now();
    const res = await app.request('/api/time', {}, env);
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { t } = (await res.json()) as TimeResponse;
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('only answers GET', async () => {
    const res = await app.request('/api/time', { method: 'POST' }, env);
    expect(res.status).toBe(404);
  });
});
