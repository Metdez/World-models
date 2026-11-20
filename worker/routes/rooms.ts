import { Hono } from 'hono';
import { API, REMOTE_PAGE, REMOTE_PREFIX, WS_PREFIX, type CreateRoomResponse, type ErrorResponse } from '../../src/contracts/net';
import { generateHostKey, generateRoomCode, isPrivateCode, isRoomCode } from '../room-logic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const CODE_ATTEMPTS = 3;
/** Room creations per address per minute, counted globally in the `rooms` Limiter Durable Object. */
export const ROOM_CREATES_PER_MINUTE = 10;

const r = new Hono<{ Bindings: Env }>();

/** Big screen creates a private room; the host key is only ever shown on that screen (QR fragment). */
r.post(API.rooms, async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const verdict = await c.env.LIMITER.getByName('rooms').admit({ rules: [{ key: ip, limit: ROOM_CREATES_PER_MINUTE }], windowMs: 60_000 });
  if (verdict === 'busy') return c.json({ error: 'busy' } satisfies ErrorResponse, 429, NO_STORE);
  const hostKey = generateHostKey();
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = generateRoomCode();
    if (await c.env.ROOM.getByName(code).init(hostKey)) {
      return c.json({ code, hostKey } satisfies CreateRoomResponse, 200, NO_STORE);
    }
  }
  return c.json({ error: 'no_code' } satisfies ErrorResponse, 503, NO_STORE);
});
r.all(API.rooms, (c) => c.json({ error: 'method_not_allowed' } satisfies ErrorResponse, 405));

r.get(`${WS_PREFIX}:code`, (c) => {
  const code = c.req.param('code');
  if (!isRoomCode(code)) return c.json({ error: 'bad_room' } satisfies ErrorResponse, 404);
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'upgrade_required' } satisfies ErrorResponse, 426);
  }
  return c.env.ROOM.getByName(code).fetch(c.req.raw);
});

/** Short audience link printed under the QR code. */
r.get(`${REMOTE_PREFIX}:code`, (c) => {
  const code = c.req.param('code').toUpperCase();
  if (!isPrivateCode(code)) return c.json({ error: 'bad_room' } satisfies ErrorResponse, 404);
  return c.redirect(`${REMOTE_PAGE}?room=${code}`, 302);
});

export default r;
