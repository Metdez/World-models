import { DurableObject } from 'cloudflare:workers';
import { NET_LIMITS, WS_PREFIX, type PresenceSnapshot, type PresenterState, type ServerMessage } from '../src/contracts/net';
import {
  alarmToSet,
  CLOSE,
  decideJoin,
  expireOnAlarm,
  frameLimit,
  frameTooBig,
  INITIAL_CTL,
  laneOf,
  newBucket,
  nextCueSeq,
  presenceOf,
  reduceMessage,
  ROOM_LIMITS,
  samePresence,
  takeToken,
  tally,
  type Attachment,
  type Bucket,
  type Effect,
  type Lane,
  type PollRecord,
  type VoteCount,
} from './room-logic';
import { parseClientMessage, parseUpgradeQuery } from './schemas/room';

const OPEN = 1;

/**
 * One room = one Durable Object (ARCHITECTURE §12.4): hibernating WebSockets, presence, presenter state, poll,
 * and the phone-driver relay (ARCHITECTURE-M2 §12.2). I/O glue only; every decision is in room-logic.ts.
 * In-memory fields are caches that are rebuilt after hibernation (storage + socket attachments + the role tag
 * each socket was accepted with are the truth). The drive path adds no timers and no storage writes.
 */
export class Room extends DurableObject<Env> {
  private hostKey: string | null = null;
  private driverKey: string | null = null;
  private ctl: PresenterState = INITIAL_CTL;
  private poll: PollRecord | null = null;
  private alarmAt: number | null = null;
  private cueSeq = 0;
  private votesReady = false;
  private lastPresence: PresenceSnapshot | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private tallyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly buckets = new Map<WebSocket, Partial<Record<Lane, Bucket>>>();
  /** Saves a structured-clone deserializeAttachment() per frame on the 30-60 Hz driver path. */
  private readonly atts = new WeakMap<WebSocket, Attachment>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.hostKey = (await ctx.storage.get<string>('hostKey')) ?? null;
      this.driverKey = (await ctx.storage.get<string>('driverKey')) ?? null;
      this.ctl = (await ctx.storage.get<PresenterState>('ctl')) ?? INITIAL_CTL;
      this.poll = (await ctx.storage.get<PollRecord>('poll')) ?? null;
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  /** RPC from POST /api/rooms. False if the code is already taken (caller draws another). */
  async init(hostKey: string, driverKey?: string): Promise<boolean> {
    if (this.hostKey !== null) return false;
    this.hostKey = hostKey;
    this.driverKey = driverKey ?? null;
    await this.ctx.storage.put('hostKey', hostKey);
    if (driverKey !== undefined) await this.ctx.storage.put('driverKey', driverKey);
    await this.touch();
    return true;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'upgrade_required' }, { status: 426 });
    }
    const url = new URL(request.url);
    const decision = decideJoin({
      code: decodeURIComponent(url.pathname.slice(WS_PREFIX.length)),
      query: parseUpgradeQuery(url.searchParams),
      hostKey: this.hostKey,
      driverKey: this.driverKey,
      connections: this.sockets().length,
    });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!decision.ok) {
      // Accept-then-close so the browser sees the application close code (it cannot read an HTTP error body).
      server.accept();
      server.close(decision.close, decision.reason);
      return new Response(null, { status: 101, webSocket: client });
    }
    // The role tag lets the relay find screens / the driver without scanning every socket (survives hibernation).
    this.ctx.acceptWebSocket(server, [decision.attachment.role]);
    server.serializeAttachment(decision.attachment);
    this.atts.set(server, decision.attachment);
    // A host or driver is welcomed after its `auth` frame.
    if (!decision.attachment.pending) this.join(server, decision.attachment);
    await this.touch();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Separated from fetch() so it can be unit-tested without a WebSocketPair. Private: not an RPC method. */
  private join(ws: WebSocket, attachment: Attachment): void {
    const presence = this.lastPresence ?? this.presence();
    send(ws, {
      t: 'welcome',
      id: attachment.id,
      role: attachment.role,
      serverNow: Date.now(),
      presence,
      ctl: this.ctl,
      poll: this.poll ? this.tallyNow(this.poll) : null,
    });
    this.markPresence();
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return send(ws, { t: 'err', code: 'bad-message' });
    const att = this.attachment(ws);
    if (!att) return ws.close(CLOSE.badRequest, 'no-session');
    if (frameTooBig(raw, frameLimit(att.role))) {
      send(ws, { t: 'err', code: 'too-big' });
      return ws.close(CLOSE.tooBig, 'too-big');
    }
    const now = Date.now();
    const msg = parseClientMessage(raw);
    const lane = laneOf(att.role, msg?.t ?? null);
    let lanes = this.buckets.get(ws);
    if (!lanes) this.buckets.set(ws, (lanes = {}));
    const bucket = (lanes[lane] ??= newBucket(now, lane));
    const verdict = takeToken(bucket, now, lane);
    if (verdict === 'close') return ws.close(CLOSE.policy, 'rate');
    if (verdict === 'drop') return bucket.strikes === 1 ? send(ws, { t: 'err', code: 'rate' }) : undefined;
    if (!msg) return send(ws, { t: 'err', code: 'bad-message' });

    const effects = reduceMessage(att, msg, {
      hostKey: this.hostKey,
      driverKey: this.driverKey,
      ctl: this.ctl,
      poll: this.poll,
      now,
      newPollId: () => crypto.randomUUID(),
    });
    for (const effect of effects) await this.apply(ws, effect, now);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.buckets.delete(ws);
    try {
      // Complete the close handshake (no-op if the runtime already auto-replied).
      ws.close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000, reason);
    } catch {
      /* already closed */
    }
    this.markPresence();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.buckets.delete(ws);
    this.markPresence();
  }

  override async alarm(): Promise<void> {
    if (!expireOnAlarm(this.sockets().length)) {
      this.alarmAt = Date.now() + NET_LIMITS.roomIdleTtlMs;
      await this.ctx.storage.setAlarm(this.alarmAt);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.hostKey = null;
    this.driverKey = null;
    this.ctl = INITIAL_CTL;
    this.poll = null;
    this.alarmAt = null;
    this.votesReady = false;
    this.lastPresence = null;
  }

  // ---------------------------------------------------------------- effects

  private async apply(ws: WebSocket, effect: Effect, now: number): Promise<void> {
    switch (effect.k) {
      case 'reply':
        return send(ws, effect.msg);
      case 'attach':
        ws.serializeAttachment(effect.attachment);
        this.atts.set(ws, effect.attachment);
        return this.markPresence();
      case 'to-screens':
        return this.sendTo('screen', effect.msg);
      case 'to-driver':
        return this.sendTo('driver', effect.msg);
      case 'replace-driver':
        for (const other of this.tagged('driver')) {
          if (other !== ws && !this.attachment(other)?.pending) other.close(CLOSE.replaced, 'replaced');
        }
        return this.markPresence();
      case 'ctl':
        this.ctl = effect.state;
        await this.ctx.storage.put('ctl', effect.state);
        this.broadcast({ t: 'ctl', state: effect.state });
        return this.touch();
      case 'cue':
        this.cueSeq = nextCueSeq(this.cueSeq, now);
        return this.broadcast({ t: 'cue', seq: this.cueSeq, cue: effect.cue });
      case 'poll': {
        const previous = this.poll;
        this.poll = effect.poll;
        if (effect.poll) await this.ctx.storage.put('poll', effect.poll);
        else await this.ctx.storage.delete('poll');
        // A new poll replaces the old one: its votes are no longer needed.
        if (effect.poll && effect.poll.id !== previous?.id) this.sql('DELETE FROM votes WHERE poll_id != ?', effect.poll.id);
        this.broadcast({ t: 'poll', poll: effect.poll ? this.tallyNow(effect.poll) : null });
        return this.touch();
      }
      case 'welcome':
        return this.join(ws, ws.deserializeAttachment() as Attachment);
      case 'close':
        return ws.close(effect.code, effect.reason);
      case 'vote':
        this.sql('INSERT OR REPLACE INTO votes (poll_id, voter_id, choice) VALUES (?, ?, ?)', effect.pollId, effect.voterId, effect.choice);
        return this.markTally();
    }
  }

  // ---------------------------------------------------------------- presence + tally (coalesced; timers only while dirty)

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === OPEN);
  }

  private tagged(role: 'screen' | 'driver'): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => ws.readyState === OPEN);
  }

  private attachment(ws: WebSocket): Attachment | null {
    let att = this.atts.get(ws);
    if (!att) {
      att = (ws.deserializeAttachment() as Attachment | null) ?? undefined;
      if (att) this.atts.set(ws, att);
    }
    return att ?? null;
  }

  /** Point-to-point relay: screens get `in`, the authenticated driver gets `tel`; nobody else ever sees them. */
  private sendTo(role: 'screen' | 'driver', msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of this.tagged(role)) {
      if (this.attachment(ws)?.pending) continue;
      try {
        ws.send(text);
      } catch {
        /* closing socket */
      }
    }
  }

  private presence(): PresenceSnapshot {
    return presenceOf(this.sockets().map((ws) => ws.deserializeAttachment() as Attachment | null));
  }

  private markPresence(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.flushPresence();
    }, NET_LIMITS.presenceFlushMs);
  }

  /** Broadcast only when the aggregate actually changed. */
  private flushPresence(): void {
    const presence = this.presence();
    if (samePresence(this.lastPresence, presence)) return;
    this.lastPresence = presence;
    this.broadcast({ t: 'presence', ...presence });
  }

  private markTally(): void {
    if (this.tallyTimer) return;
    this.tallyTimer = setTimeout(() => {
      this.tallyTimer = null;
      if (this.poll) this.broadcast({ t: 'poll', poll: this.tallyNow(this.poll) });
    }, ROOM_LIMITS.tallyFlushMs);
  }

  private tallyNow(poll: PollRecord) {
    const rows = this.sql('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY choice', poll.id);
    return tally(poll, rows.map((row): VoteCount => ({ choice: Number(row.choice), n: Number(row.n) })));
  }

  private sql(query: string, ...bindings: (string | number)[]): Record<string, SqlStorageValue>[] {
    if (!this.votesReady) {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS votes (poll_id TEXT, voter_id TEXT, choice INTEGER, PRIMARY KEY (poll_id, voter_id))');
      this.votesReady = true;
    }
    return this.ctx.storage.sql.exec(query, ...bindings).toArray();
  }

  private broadcast(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const ws of this.sockets()) {
      try {
        ws.send(text);
      } catch {
        /* closing socket */
      }
    }
  }

  /** Re-arm the idle-expiry alarm (lazily: at most one storage write per hour of activity). */
  private async touch(): Promise<void> {
    const at = alarmToSet(this.alarmAt, Date.now());
    if (at === null) return;
    this.alarmAt = at;
    await this.ctx.storage.setAlarm(at);
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closing socket */
  }
}
