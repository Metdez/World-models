import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import engineer from './routes/engineer';
import event from './routes/event';
import health from './routes/health';
import rooms from './routes/rooms';
import time from './routes/time';

export { Room } from './room';

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', secureHeaders());
app.route('/', health);
app.route('/', time);
app.route('/', rooms);
app.route('/', engineer);
app.route('/', event);
app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default app;
