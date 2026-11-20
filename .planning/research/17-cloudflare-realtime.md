# 17 - Cloudflare realtime for Suspension Lab (as of 2026-11-20)

Verification legend: [V] = read on the official page / npm registry today; [U] = unverified or from memory.
Note: the GitHub API was blocked in this sandbox (no stars/last-commit dates for most repos); npm registry data and github.com HTML pages were readable.

## 0. TL;DR verdict

Build first, in this order:
1. **Presenter mode (room code / QR remote control)**. Highest wow-per-effort at a live event, tiny scale (1 host + N screens), trivial cost, ~1 day of work. One DO per room, hibernating WebSocket, authoritative state `{vehicle, suspension, camera, bumpSeq, tourStep}`.
2. **Live Lab presence + live distribution bar + one-tap audience poll** (same DO class, same socket; just more message types). Ghost cars are *free* if they are derived (see 4): send only `(viewerId, suspensionId)` changes, never positions.

Do NOT build first: shared cursors/annotations (high chatter, low educational value, moderation risk). Do not use Cloudflare Realtime (SFU/TURN/RealtimeKit): it is media, irrelevant. Pub/Sub: still private beta since 2022; ignore.

Feature (4) synchronised clock needs **no Durable Object at all** if the track "clock" is a pure function of server time (`phase = ((serverNow - EPOCH) mod lapTime)/lapTime`). Only a server-time offset is required (NTP-style, a stateless Worker endpoint or the existing room socket). It is the cheapest feature and makes ghost cars/poll "who handled the chicane" coherent across devices.

## 1. Durable Objects, current facts [V all from developers.cloudflare.com/durable-objects]

- **Free plan: yes, SQLite-backed DOs only.** Paid plan: SQLite-backed; KV-backed only for accounts that already had it. New classes must be declared under `migrations[].new_sqlite_classes`.
- **Free limits (daily, reset 00:00 UTC):** 100,000 requests, 13,000 GB-s duration, 5M SQLite rows read, 100k rows written, 5 GB storage. Exceeding = operations fail (so a viral demo day can hard-fail on the free plan; the Workers Paid $5/mo plan removes this).
- **Paid pricing:** requests 1M incl. then $0.15/M; duration 400k GB-s incl. then $12.50/M GB-s; rows read 25B incl. then $0.001/M; rows written 50M incl. then $1.00/M; storage 5 GB-mo incl. then $0.20/GB-mo (storage billing starts Jan 2026). Min $5/mo plan.
- **WebSocket billing:** upgrade = 1 request. Incoming WS messages billed 20:1 (100 msgs = 5 requests). **Outgoing messages free**, incoming protocol pings free. `setWebSocketAutoResponse` replies cost no duration and do not wake the DO. Alarm invocation = 1 request; each `setAlarm()` = 1 row written.
- **Duration:** wall-clock while active, 128 MB billed = 0.125 GB regardless of use. Idle-but-hibernatable objects are not billed. Hibernation API required; plain `ws.accept()` bills the whole connection time. Pending `setTimeout`/`setInterval`, alarms, in-flight requests prevent hibernation. An outgoing WS blocks eviction up to 15 min.
- **Limits:** soft 1,000 req/s per object (then "overloaded" errors); 30 s CPU per invocation (resettable per message; configurable to 5 min); WS received message up to 32 MiB; SQLite 10 GB/object (paid), 100 classes (free) / 500 (paid); row/blob 8 MB; alarm handler 15 min wall. **Max concurrent WebSockets per DO: not documented on the limits page [U]** (community folklore ~tens of thousands; design for <=2-5k per DO and shard).
- **Attachments:** `ws.serializeAttachment(v)` survives hibernation, structured-cloneable, **up to 16,384 bytes** per docs today (older material and PartyServer's `connection.setState` say 2 KB; keep to <2 KB to be safe).
- **Alarms:** one per DO, `setAlarm(epochMs)`, at-least-once, retries exponential from 2 s up to 6, constructor runs before `alarm()` so `getAlarm()` before re-setting.
- **RPC:** public methods on a class `extends DurableObject` (from `cloudflare:workers`) are callable on the stub: `const stub = env.ROOM.getByName(code); await stub.someMethod()`. Each RPC session = 1 request. Use `stub.fetch(request)` to forward a WS upgrade.
- **Hibernation code-update caveat:** hibernation-API sockets survive deploys unless a forced update hits; web-standard sockets drop on any deploy. Batch small messages (50-100 ms) to cut per-message overhead.
- Message ordering/consistency: a DO is single-threaded and the authority; put the truth there, make clients dumb.

## 2. PartyKit / partyserver / partysocket [V]

- **PartyKit-the-company was acquired by Cloudflare (2024)**; the open-source successor is `cloudflare/partykit` (ISC licence, ~1.3k stars [V], 720 commits, README says "Work in Progress", 62 open issues). Packages: `partyserver` (core `Server` class on DOs), `partysocket` (reconnecting client), `y-partyserver` (Yjs), `hono-party`, `partysub` (pubsub at scale across DOs, experimental), `partysync` (experimental state sync), `partywhen` (scheduling), fixtures for `chat`, `globe`, `hono`, `lexical-yjs`, `monaco-yjs`, `partytracks`, `pubsub`, `rpc-sanity`, `tiptap-yjs`, `tldraw`, `todo-sync`, `video-echo`, `alarm-restart-e2e`.
- **npm (today):** `partyserver@0.5.10` (ISC, 2026-08-03), `partysocket@1.3.0` (MIT, 2026-06-23), `y-partyserver@2.2.0`, `hono-party@2.1.0`. Pre-1.0 server package: pin the version.
- **partyserver API [V]:** `class X extends Server { static options = { hibernate: true }; onStart(); onConnect(conn, ctx); onMessage(conn, msg); onClose(conn, code, reason, wasClean); onError(conn, err); onRequest(req); onAlarm(); getConnectionTags(conn, ctx); broadcast(msg, excludeIds[]); getConnections(tag?); getConnection(id); this.name; this.ctx; this.env }`. Do not define `webSocketMessage/alarm` yourself. `connection.state` / `setState()` is ~2 KB. Utilities: `routePartykitRequest(request, env, {prefix='parties', onBeforeConnect, onBeforeRequest, locationHint, jurisdiction})` matches `/parties/:binding-kebab/:room`; `getServerByName(ns, name)`. Wrangler: normal DO binding + `new_sqlite_classes` migration.
- **partysocket [V]:** `import PartySocket, { WebSocket } from "partysocket"`; `new PartySocket({host, room, party?, id?})`; reconnecting `WebSocket(urlOrProvider, protocols, opts)` with `maxRetries(Infinity) minReconnectionDelay(1-5s random) maxReconnectionDelay(10s) reconnectionDelayGrowFactor(1.3) minUptime(5s) connectionTimeout(4s) maxEnqueuedMessages(Infinity) startClosed debug`; URL may be an async function (good for auth tokens). Buffers sends while disconnected. React hook `usePartySocket` exists in `partysocket/react` [U, not on README fetched].
- **Pro of partyserver:** less boilerplate (connections, tags, broadcast, hibernation wiring, retry routing). **Con:** extra dependency, pre-1.0, abstraction hides the hibernation lifecycle. Because the raw DO class below is ~120 lines and fully liftable, **recommend raw DO + partysocket's `WebSocket`** for the module (zero server dependency); keep partyserver as drop-in alternative (section 7).

## 3. Cloudflare Realtime / Pub/Sub / Agents

- **Cloudflare Realtime** [V developers.cloudflare.com/realtime]: umbrella (formerly "Calls") of RealtimeKit (prebuilt audio/video SDK), Realtime SFU (bring-your-own signalling; WS adapters, DataChannels), TURN (anycast NAT relay). Pricing SFU/TURN egress $0.05/GB, first 1,000 GB/month free, shared; ingress free [V]. Page recommends **Stream Live** for few-presenters-many-viewers. **Relevance to Suspension Lab: none/low.** All ideas here are tiny JSON state, not media. Only conceivable use: streaming the presenter's webcam (Stream Live / RealtimeKit), explicitly out of scope. TURN irrelevant (no P2P).
- **Pub/Sub (MQTT)** [V via search]: docs still say private beta (announced May 2022, waitlist, pricing "TBD"). No GA, no deprecation notice found. Skip: a DO is better for rooms.
- **Agents SDK** [V]: `cloudflare/agents`, MIT, ~6.0k stars, `agents@0.34.0` published 2026-11-20 (very active; examples incl. `tictactoe`, `playground`). `class Room extends Agent<Env, State>` with `initialState`, `this.setState(next)` (persisted in SQLite, survives hibernation, broadcast to all connected clients), `validateStateChange(next, source)` (reject client writes), `onStateChanged(state, source)`, readonly connections, `@callable()` RPC methods; client: `useAgent({agent:"Room", name:"ROOMCODE", onStateUpdate})`, `agent.setState`, `agent.stub.method()`. State is a single JSON doc (size limit not documented [U]).
  - **Fit:** presenter mode is exactly "one shared JSON state doc, host writes, everyone renders". Agents gives that in ~30 lines (nicer than hand-rolled) and gives readonly viewers. **Cost:** heavy dependency tree built for LLM agents; whole-state broadcast on every setState (fine at 200 bytes, bad for per-viewer presence maps); less control over coalescing. Use it only if the team likes React-style hooks; otherwise raw DO. For presence/poll keep the raw/partyserver DO.
- **tldraw sync on DO**: `tldraw/tldraw-sync-cloudflare` MIT template (157 stars) but tldraw SDK itself has a separate non-OSS licence (watermark/licence key for production) -> **NOT usable** as a dependency; only read `worker/TldrawDurableObject.ts` for the pattern (one DO per room, SQLite persistence). Not needed here.

## 4. Feature designs

Common architecture: Worker (static assets via Workers Assets + `/ws/:code` route) -> `env.ROOM.getByName(code)` -> `Room` DO (SQLite-backed, hibernating). Same socket carries all feature modules (`presence`, `presenter`, `poll`, `clock`), each a message-type namespace, so features remain swappable (client modules subscribe to `type` prefixes).

### Message schema (JSON, versioned)
Client -> server: `{t:"hello", id, role:"viewer"|"host", hostKey?, suspension, vehicle}`, `{t:"susp", s}`, `{t:"ctl", ...}` (host only: `{suspension, camera, bump:true, vehicle}`), `{t:"vote", pollId, choice}`, `{t:"sync", c0}`, `{t:"cur", x,y,z}` (cursors).
Server -> client: `{t:"welcome", n, dist, ctl, poll, serverNow}`, `{t:"pres", n, dist:{macpherson:123,...}}` (1 Hz coalesced), `{t:"ctl", seq, ...}`, `{t:"poll", id, q, opts, tally}`, `{t:"sync", c0, s1}`, `{t:"err", code}`.

### (1) Live Lab presence / ghost cars / distribution bar
- State is in-memory counts rebuilt on wake from `ctx.getWebSockets()` + attachments (`{id, susp}`); no storage writes needed. Broadcast **aggregate** `{n, dist}` coalesced to <=1/s (timer). Ghost cars: client draws one translucent ghost per suspension type scaled by count (or up to ~20 sampled individual ghosts using `(id, susp)`); their positions are computed locally from the shared clock (feature 4), so no per-viewer position streaming (4 Hz x 1k viewers = 4k msg/s would blow the 1,000 req/s soft limit).
- Rate limit: token bucket 5 msg/s burst 10 per connection; drop silently, close with 1008 on abuse. Cap message size 512 B.
- Failure modes: DO restart loses timers (rebuild on wake, ok); reconnect storm after deploy (partysocket jitter 1-5 s covers it); one DO hot-spot at 100k (shard); counts drift if `webSocketClose` missed (1006) -> recompute from `getWebSockets().length` on each flush, trust that.
- Scaling to 100k: **tree**: viewers hash to shard `room:CODE:s{0..N}` (N = ceil(viewers/1500)); each shard DO sends `{n,dist}` to root `room:CODE` via RPC every 1-2 s; root RPC-pushes global aggregate back to shards, which broadcast to their sockets. (`partysub` is the project-native take on this; unverified maturity.)
- Complexity: **S** (1-2 days) single DO; **M** (+2 days) sharding.

### (2) Presenter mode (host phone/laptop drives the big screen)
- Flow: big screen opens `/?screen` -> client asks Worker `POST /api/room` -> server generates 4-6 char code (unambiguous alphabet) + random `hostKey` (shown only on the screen as QR `https://site/r/CODE#k=HOSTKEY`; fragment never hits logs). Phone scans -> connects with `role:"host"&k=...`; screen and any audience devices are viewers.
- Server validates `hostKey` (constant-time compare against value stored in `ctx.storage.kv`/SQLite at room creation); only host `ctl` messages mutate `ctl` state; each gets monotonic `seq`; state persisted (SQLite) so a reload/reconnect gets the current state; `bump:true` is an event (carries `seq`, not state) - screen plays a bump when `seq` increases, dedupe on seq.
- Failure modes: host disconnect -> screen continues autoplay; two hosts -> last-writer-wins with seq (or allow co-host list); room-code guessing -> 36^5 = 60M and per-IP rate limit on WS upgrade + short expiry (alarm deletes room after 12 h idle); stale hostKey -> 4401 close.
- Cost: negligible at any size (commands ~0.2/s). 100k audience following presenter = broadcast through shard tree, still free outbound.
- Complexity: **S** (1 day with this code).

### (3) Audience live poll rendered in-world
- Host starts poll (`ctl: {poll:{id,q,opts}}`), viewers `vote` once per `viewerId` (anonymous uuid in localStorage; **not** Sybil-proof - say so; optional Turnstile token on WS upgrade to raise cost). Votes: SQLite `votes(poll_id, voter_id, choice, PRIMARY KEY(poll_id,voter_id))` with `INSERT OR REPLACE`; tally = in-memory counters rebuilt via `SELECT choice,count(*)`. Broadcast tally <=2 Hz coalesced; results rendered as 3D bars/hologram over each suspension's car in the scene.
- Cost: 100k votes = ~100-200k rows written ~ $0.10-0.20 (50M rows included on paid). Free plan: 100k rows/day cap -> ~50-100k votes/day max.
- Failure modes: double-count on reconnect (PK handles), shards need cross-shard tally (shard sums to root, same tree), result flicker (coalesce).
- Complexity: **S/M** (1.5 days incl. in-world visuals; the DO side is ~25 lines).

### (4) Synchronised clock / same track position for everyone
- Make the car path a **pure function of time**: `phase = ((serverNow() - EPOCH) % LAP_MS) / LAP_MS`, EPOCH a compile-time constant (e.g. 2026-01-01T00:00:00Z). All devices then see the car at the same track position without any room or DO. Suspension dynamics (body roll/wheel travel) are integrated locally from the track profile starting at lap start (fixed dt integrator seeded per lap so drift is bounded to one lap); do not try to lockstep float physics across devices.
- Offset estimation (Cristian/NTP-style): for k samples (burst of 8 at join, then every 30 s, plus on tab-visibility), `offset = s1 - (c0 + c2)/2`, `rtt = c2 - c0`; keep the **min-RTT** sample (or median of lowest 3); apply slew (clamp +-5 ms/s) to avoid visible jumps. Use `performance.now()` for c0/c2 (monotonic), server stamps `Date.now()`. Expect +-10-50 ms on wifi/4G; fine for car-position (at 60 m/s that is <=3 m... so run the show at moderate speed or accept it; for a big-screen + phone side-by-side demo, nobody notices <50 ms).
- Where: either the room socket (below) or stateless Worker `GET /api/time` returning `Date.now()` (no DO, $0.30/M Worker requests, best for 100k). Note `setWebSocketAutoResponse` cannot carry a timestamp, so WS sync messages do wake a DO; keep burst small.
- Failure modes: client clock steps (use performance.now), backgrounded tabs throttle timers (resync on `visibilitychange`), Cloudflare runtime `Date.now()` only advances on I/O (irrelevant: stamp right before `send`).
- Complexity: **S** (half a day). Highest value-per-line.

### (5) Shared cursors / annotations
- 3D pointer ray hits -> `(x,y,z)` quantised to 16 bit, throttled 10 Hz, only broadcast for host + N sampled viewers, aggregate in 100 ms frames. Raw all-to-all at 1k viewers = 1k*10 = 10k in-msg/s: exceeds 1,000 req/s per DO. Needs sampling/sharding/area-of-interest. Annotations need moderation (public screen!). **Verdict: skip**; at most "host laser pointer" (host-only cursor) which is a trivial `ctl` extension.
- Complexity: **L** for audience-wide, **XS** for host-only.

## 5. Cost summary (one 2-hour live event, paid plan, excluding $5/mo base and Worker static requests)

Assumptions: 0.125 GB x 7,200 s = 900 GB-s per always-awake DO; viewers send ~5 msgs (join/switch/vote) + feature traffic; outgoing free.

| Viewers | Presence + Presenter + Poll | + clock via WS (1 msg/30 s + burst) | Notes |
|---|---|---|---|
| 10 | $0 (free plan fine: <1k req, ~900 GB-s of 13k/day) | $0 | Free plan OK |
| 1,000 | 1k upgrades + ~250 = ~1.3k req; 900 GB-s; ~1k rows. **$0 over base** | +12k req = $0 | 1 DO, 7.2M outbound free |
| 100,000 | 100k upgrades + 25k = 125k req; ~70-100 shard DOs x 900 = ~90k GB-s; ~150k rows written ($0.15). **~$0.2 over base** | +1.24M req = ~$0.2; move clock to stateless Worker instead | Real cost = engineering (sharding) not $ |

Worker-side: each WS upgrade is also a Worker request (10M/mo included on Paid). A 100k event is well under. Free-plan caveat: 100k req/day shared by Worker static assets (assets are free/unmetered on Workers Assets [U]) and DO; poll rows capped.

Cost traps: (a) keeping every DO awake 24/7 with a `setInterval` (a 1-DO always-on = 0.125GB x 2.6M s = 328k GB-s/mo, ~within included) - use timers only while dirty; (b) per-message storage writes; (c) alarm-per-second (1 row write each).

## 6. Liftable code

### wrangler.jsonc
```jsonc
{
  "name": "suspension-lab",
  "main": "src/worker.ts",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
  "durable_objects": {
    "bindings": [{ "name": "ROOM", "class_name": "Room" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["Room"] }
  ],
  "observability": { "enabled": true }
}
```
(Pattern confirmed against partykit `fixtures/chat/wrangler.jsonc`: binding + `new_sqlite_classes` migration.) Changing the class name later needs a `renamed_classes` migration with a new unique tag.

### src/worker.ts
```ts
import { Room } from "./room";
export { Room };

interface Env { ROOM: DurableObjectNamespace<Room>; ASSETS: Fetcher }
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

function newCode(n = 5) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/time")               // stateless clock (no DO)
      return Response.json({ t: Date.now() }, { headers: { "cache-control": "no-store" } });

    if (url.pathname === "/api/room" && req.method === "POST") {
      const code = newCode();
      const hostKey = crypto.randomUUID().replaceAll("-", "");
      await env.ROOM.getByName(code).init(hostKey);   // RPC
      return Response.json({ code, hostKey });
    }

    const m = url.pathname.match(/^\/ws\/([A-Z0-9]{4,8})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected ws", { status: 426 });
      return env.ROOM.getByName(m[1]).fetch(req);     // forward the upgrade
    }
    return env.ASSETS.fetch(req);
  },
};
```

### src/room.ts  (DO: hibernation + broadcast + presence + presenter + poll + clock)
```ts
import { DurableObject } from "cloudflare:workers";

type Att = { id: string; role: "viewer" | "host"; susp: string };
type Ctl = { seq: number; vehicle: string; suspension: string; camera: string; poll?: { id: string; q: string; opts: string[] } | null };

const MAX_MSG = 1024;
const RATE = { burst: 10, perSec: 5 };

export class Room extends DurableObject<Env> {
  private buckets = new Map<WebSocket, { tokens: number; ts: number }>(); // in-memory; resets on wake (acceptable)
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ctl: Ctl = { seq: 0, vehicle: "car", suspension: "wishbone", camera: "orbit", poll: null };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS votes(
        poll_id TEXT, voter_id TEXT, choice INTEGER, PRIMARY KEY(poll_id, voter_id))`);
      this.ctl = (await ctx.storage.get<Ctl>("ctl")) ?? this.ctl;
    });
    // pings answered by the runtime without waking / billing duration
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- RPC (from Worker) ----
  async init(hostKey: string) {
    if (!(await this.ctx.storage.get("hostKey"))) {
      await this.ctx.storage.put("hostKey", hostKey);
      await this.ctx.storage.setAlarm(Date.now() + 12 * 3600_000); // expire idle room
    }
  }

  // ---- WebSocket upgrade ----
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.searchParams.get("k")
      ? (timingSafeEq(url.searchParams.get("k")!, (await this.ctx.storage.get<string>("hostKey")) ?? "") ? "host" : null)
      : "viewer";
    if (!role) return new Response("bad key", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const att: Att = {
      id: (url.searchParams.get("id") ?? crypto.randomUUID()).slice(0, 36),
      role, susp: url.searchParams.get("s") ?? "wishbone",
    };
    this.ctx.acceptWebSocket(server);            // hibernation API
    server.serializeAttachment(att);             // keep < 2 KB
    server.send(JSON.stringify({ t: "welcome", ctl: this.ctl, serverNow: Date.now(), ...this.presence(), poll: this.tally() }));
    this.scheduleFlush();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- hibernation handlers ----
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return ws.close(1009, "too big");
    if (!this.allow(ws)) return;                 // silently drop over-rate
    let m: any; try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment() as Att;

    switch (m.t) {
      case "sync":                                // NTP-style: echo client t0 + server time
        ws.send(JSON.stringify({ t: "sync", c0: m.c0, s1: Date.now() })); return;
      case "susp":                                // presence: viewer changed suspension
        a.susp = String(m.s).slice(0, 24); ws.serializeAttachment(a); this.scheduleFlush(); return;
      case "ctl":                                 // presenter commands (host only)
        if (a.role !== "host") return;
        this.ctl = { ...this.ctl, ...pick(m, ["vehicle", "suspension", "camera"]), seq: this.ctl.seq + 1 };
        if (m.bump) this.broadcast({ t: "bump", seq: this.ctl.seq });
        if (m.poll !== undefined) this.ctl.poll = m.poll;
        await this.ctx.storage.put("ctl", this.ctl);
        this.broadcast({ t: "ctl", ...this.ctl }); return;
      case "vote": {                              // one vote per viewer id per poll
        const p = this.ctl.poll; if (!p || m.pollId !== p.id) return;
        const c = Number(m.choice); if (!(c >= 0 && c < p.opts.length)) return;
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO votes VALUES(?,?,?)", p.id, a.id, c);
        this.scheduleFlush(); return;
      }
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.buckets.delete(ws);
    try { ws.close(code >= 1000 && ![1004,1005,1006,1015].includes(code) ? code : 1000, reason); } catch {}
    this.scheduleFlush();
  }
  async webSocketError(ws: WebSocket) { this.buckets.delete(ws); this.scheduleFlush(); }
  async alarm() { await this.ctx.storage.deleteAll(); }   // 12h idle expiry; closes room data

  // ---- helpers ----
  private presence() {
    const dist: Record<string, number> = {}; let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Att | null; if (!a || a.role === "host") continue;
      dist[a.susp] = (dist[a.susp] ?? 0) + 1; n++;
    }
    return { n, dist };
  }
  private tally() {
    const p = this.ctl.poll; if (!p) return null;
    const counts = new Array(p.opts.length).fill(0);
    for (const r of this.ctx.storage.sql.exec("SELECT choice, COUNT(*) c FROM votes WHERE poll_id=? GROUP BY choice", p.id))
      counts[r.choice as number] = r.c as number;
    return { id: p.id, q: p.q, opts: p.opts, counts };
  }
  /** coalesce presence+tally to <=1 Hz; timer only pending while dirty so DO can still hibernate */
  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.broadcast({ t: "pres", ...this.presence(), poll: this.tally() });
    }, 1000);
  }
  private broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch {} }
  }
  private allow(ws: WebSocket) {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: RATE.burst, ts: now };
    b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.ts) / 1000) * RATE.perSec); b.ts = now;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return false; b.tokens -= 1; return true;
  }
}
const pick = (o: any, ks: string[]) => Object.fromEntries(ks.filter((k) => o[k] != null).map((k) => [k, String(o[k]).slice(0, 32)]));
function timingSafeEq(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
```
Notes: heartbeat pings from the client should be the literal string `"ping"` (auto-responded, no wake, no cost). `getWebSockets()` iterates all live sockets after wake, so no in-memory registry is needed. For tags, `acceptWebSocket(server, ["host"])` + `getWebSockets("host")`.

### Client: reconnecting socket (partysocket, verified API)
```ts
import { WebSocket as ReconnectingWebSocket } from "partysocket";

export function connectRoom(code: string, opts: { id: string; hostKey?: string; susp: string }) {
  const urlProvider = () => {            // re-evaluated on every reconnect
    const u = new URL(`/ws/${code}`, location.href);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("id", opts.id); u.searchParams.set("s", opts.susp);
    if (opts.hostKey) u.searchParams.set("k", opts.hostKey);
    return u.toString();
  };
  const ws = new ReconnectingWebSocket(urlProvider, [], {
    minReconnectionDelay: 500, maxReconnectionDelay: 8000, reconnectionDelayGrowFactor: 1.5,
    connectionTimeout: 4000, maxEnqueuedMessages: 20,   // don't replay a huge backlog of stale ctl
  });
  const ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25_000); // auto-response, free
  ws.addEventListener("close", () => {/* show "reconnecting" chip */});
  return { ws, dispose: () => { clearInterval(ping); ws.close(); } };
}
```
If using partyserver instead: `new PartySocket({ host: location.host, party: "room", room: code, query: {...} })` (party = kebab-case binding name) and `routePartykitRequest(req, env)` in the Worker.

### Client: time-sync (NTP-style, min-RTT, slewed)
```ts
export class ServerClock {
  private offset = 0;            // serverNow = performance.now() + offset + epochPerf
  private best = Infinity;
  private samples: { rtt: number; off: number }[] = [];
  private t0 = performance.timeOrigin;     // maps perf time -> unix ms
  constructor(private send: (m: any) => void) {}

  /** server (unix ms) corresponding to performance.now() */
  now() { return this.t0 + performance.now() + this.offset; }

  probe(n = 8, gap = 120) { for (let i = 0; i < n; i++) setTimeout(() => this.send({ t: "sync", c0: performance.now() }), i * gap); }

  onSync(m: { c0: number; s1: number }) {
    const c2 = performance.now();
    const rtt = c2 - m.c0;
    const off = m.s1 - (this.t0 + m.c0 + rtt / 2);          // s1 - client-unix-at-midpoint
    this.samples.push({ rtt, off });
    if (this.samples.length > 16) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);   // 3 lowest-RTT
    const target = best.reduce((s, x) => s + x.off, 0) / best.length;
    // first fix: jump; later: slew toward target (max 5 ms per call) to avoid visible hitches
    this.offset = this.samples.length <= 3 ? target : this.offset + Math.max(-5, Math.min(5, target - this.offset));
  }
}
// car position, identical on all devices:
// const phase = (((clock.now() - EPOCH_MS) % LAP_MS) + LAP_MS) % LAP_MS / LAP_MS;
// Resync: probe() on open, every 30 s, and on document 'visibilitychange'.
// Stateless alternative (no DO): fetch('/api/time') 5x, same min-RTT formula, using Response timing.
```

## 7. Open-source worth lifting (licences)

| Repo | Stars / activity | Licence | Lift |
|---|---|---|---|
| github.com/cloudflare/workers-chat-demo | ~1.1k [V], 57 commits, hibernation-API version | BSD-3-Clause | `src/chat.mjs`: canonical hibernation + room + rate limiter (`RateLimiter` DO) + presence pattern; compare to code above. Usable (keep notice). |
| github.com/cloudflare/partykit (`partyserver`, `partysocket`, fixtures `chat`, `globe`, `todo-sync`, `hono`, `rpc-sanity`, `pubsub`) | ~1.3k [V]; npm releases through Aug 2026 | ISC (partysocket npm says MIT) | `fixtures/chat/` (server+wrangler.jsonc), `fixtures/globe/` (presence dots on a 3D globe = visual analogue of ghost cars, check `src`), `packages/partysocket`. Usable. |
| github.com/cloudflare/agents | ~6.0k [V], `agents@0.34.0` today | MIT | `examples/tictactoe` (shared state w/ useAgent), `examples/playground`; docs "store-and-sync-state". Usable. |
| github.com/tldraw/tldraw-sync-cloudflare | 157 stars | MIT template, **but tldraw SDK has separate licence** | Pattern only (`worker/TldrawDurableObject.ts`); do not depend on tldraw. |
| Multiplayer-cursor demos (original `partykit/partykit` "cursors" example, `partykit-cursors`) | [U] could not open | [U] (original PartyKit repos were MIT) | Verify before lifting; not needed since feature 5 is deprioritised. |
| partysub / partywhen (in partykit repo) | experimental | ISC | Reference for the shard-tree fan-out; read before building the 100k path. |

## 8. Recommendations for Suspension Lab

1. Ship a `modules/realtime/` package with one Worker route + one `Room` DO (code above) and client modules `clock`, `presence`, `presenter`, `poll`, each subscribing by message `t`. Each feature degrades to local/offline mode if the socket is absent (solo viewing must never need the network).
2. Build **Presenter mode + server-time clock** first (1-2 days total); then **Live Lab presence bar + audience poll** (2-3 days). Ghost cars come free from the clock + `(id, suspension)` presence.
3. Use raw DO + `partysocket`'s reconnecting `WebSocket` (MIT, current 1.3.0); keep `partyserver@0.5.x` as an optional alternative; use Agents SDK `useAgent` only if you want hook-style shared state for presenter mode.
4. Plan the tier: free plan is enough for dev and a small meetup (watch the 100k rows-written/day and 100k requests/day caps; hard-fail, not throttle). Buy Workers Paid ($5) before any public event. A 1k-viewer event costs about $0 over base; 100k needs shard-tree (not $).
5. Hard rules: aggregate server-side (never relay per-viewer positions), coalesce broadcasts to <=1 Hz, ping via auto-response string, rate-limit per socket (5/s), validate sizes, keep host key in URL fragment, expire rooms by alarm.
6. Skip Cloudflare Realtime (media), Pub/Sub (private beta since 2022), and shared annotations (moderation, chatter).
7. Open [U] items to verify during implementation: max concurrent sockets per DO, `partysocket/react` export name, whether `getByName(...).fetch(req)` WS forwarding behaves identically under `wrangler dev` hibernation (use wrangler >= 3.13.2), partykit cursor example licence.
