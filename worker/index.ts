import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import engineer from './routes/engineer';
import event from './routes/event';
import health from './routes/health';
import insight from './routes/insight';
import replays from './routes/replays';
import rooms from './routes/rooms';
import time from './routes/time';

export { Limiter } from './limiter';
export { Room } from './room';

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', secureHeaders());
// Every API answer is per request (errors and 404s included): never cached by a browser or an edge.
app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
});
app.route('/', health);
app.route('/', time);
app.route('/', rooms);
app.route('/', engineer);
app.route('/', event);
app.route('/', replays);
app.route('/', insight);
app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default app;
