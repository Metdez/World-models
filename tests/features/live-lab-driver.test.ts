import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomConnection } from '../../src/features/live-lab/room-service';

/** A socket that never connects (the room service only needs to open one). */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 3;
  }
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const clock = { serverNow: () => Date.now(), setOffset: () => undefined, synced: false };
const deps = { origin: 'http://localhost:4391', clientId: 'test', clock, pick: () => ({ vehicleId: 'gt-coupe', suspensionId: 'multilink' }), onStatus: () => undefined };

afterEach(() => vi.unstubAllGlobals());

describe('live-lab driver key (12-04)', () => {
  it('a screen keeps the driverKey from POST /api/rooms, exposes it on ROOM and remembers it with the room', async () => {
    const session = memoryStorage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('WebSocket', FakeSocket);
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/rooms' ? Response.json({ code: 'AB2CD', hostKey: 'h'.repeat(32), driverKey: 'd'.repeat(32) }) : new Response('', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = createRoomConnection(deps);
    await a.start('create-screen-room');
    expect([a.service.code, a.service.role, a.service.hostKey, a.service.driverKey]).toEqual(['AB2CD', 'screen', 'h'.repeat(32), 'd'.repeat(32)]);
    expect(JSON.parse(session.getItem('sl-live-lab-screen-room')!)).toMatchObject({ code: 'AB2CD', driverKey: 'd'.repeat(32) });
    a.dispose();

    // a reload reuses the remembered room (no second POST) and still knows the driver key
    fetchMock.mockClear();
    const b = createRoomConnection(deps);
    await b.start('create-screen-room');
    expect(b.service.driverKey).toBe('d'.repeat(32));
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/rooms')).toBe(false);
    b.dispose();
  });

  it('servers older than protocol 3 (no driverKey) and non-screen roles leave it null', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', async (url: string) => (url === '/api/rooms' ? Response.json({ code: 'AB2CD', hostKey: 'h'.repeat(32) }) : new Response('', { status: 503 })));
    const a = createRoomConnection(deps);
    await a.start('create-screen-room');
    expect(a.service.driverKey).toBeNull();
    a.dispose();
    const v = createRoomConnection(deps);
    await v.start({ code: 'LIVE', role: 'viewer', hostKey: null });
    expect(v.service.driverKey).toBeNull();
    v.dispose();
  });
});
