# 14 — Cloudflare for real-time shared driving (research, 2026-11-21)

Scope: can the existing Durable Object (DO) room relay 10–20 Hz car state for 20–300 drivers; what it costs; client smoothing;
PartyKit/Agents; Realtime SFU/TURN/DataChannels; WebTransport; placement; clock sync; three product ideas.
Marking: [S] sourced (link), [E] my estimate/arithmetic. Docs were fetched 2026-11-21; Cloudflare renames things, re-check before building.

## 1. Facts from current docs

| Fact | Value | Src |
|---|---|---|
| DO request price | Paid: 1M/month included, then $0.15/M. Free: 100,000/day | [S] https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| What counts as a request | HTTP, RPC session, WebSocket message, alarm invocation; WS connect = 1 request | [S] same |
| Incoming WS message billing | "20:1 ratio" on incoming messages (100 msgs = 5 requests). Outgoing messages and protocol pings are NOT charged. Billing only; metrics still show raw count | [S] same |
| Duration | Paid 400,000 GB-s/month incl, then $12.50/M GB-s. Free 13,000 GB-s/day. Billed on a fixed 128 MB (0.125 GB) per active object regardless of use | [S] same |
| Hibernation | Idle + hibernation-eligible DOs are not billed for duration. `accept()` (non-hibernation API) bills for whole connected time. Auto-response (`setWebSocketAutoResponse`) does not wake the DO and is not wall-clock billed | [S] pricing + https://developers.cloudflare.com/durable-objects/api/state/ |
| What blocks hibernation | Alarms, in-flight requests, `setTimeout`/`setInterval`, outbound WebSockets (kept alive up to 15 min) | [S] https://developers.cloudflare.com/durable-objects/best-practices/websockets/ |
| Per-DO throughput | "soft limit of 1,000 requests per second" per object; beyond queue -> overloaded error | [S] https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Connections per DO | Hibernation API max 32,768 sockets/DO; CPU/memory may lower the practical figure. A community post suggests 500–1k for broadcast-heavy rooms (anecdotal, unverified, possibly stale) | [S] state API page; community: https://www.answeroverflow.com/m/1343929116189130762 |
| Attachment size | `serializeAttachment` max 16,384 B; survives hibernation | [S] websockets best-practices |
| Auto-response | One request/response pair for the whole DO, each <= 2,048 chars | [S] state API page |
| Batching advice | "Pack 10–100 logical messages per frame; batch every 50–100 ms" | [S] websockets best-practices |
| Inbound msg size | 32 MiB max | [S] limits page |
| Workers Paid | $5/mo; 10M req incl then $0.30/M; no egress/bandwidth charge | [S] https://developers.cloudflare.com/workers/platform/pricing/ |
| Free plan CPU | 10 ms CPU per Worker invocation; DO CPU timing is per request/message (30 s default budget, resets each message) | [S] Workers pricing + limits |
| SQLite storage billing | Started Jan 2026: Free 100k rows written/day; Paid 50M rows written incl then $1/M | [S] pricing page |
| WebTransport | NOT listed among Workers runtime APIs (TCP sockets, WebSocket, fetch, EventSource); search found no announcement | [S] https://developers.cloudflare.com/workers/runtime-apis/ (absence) |
| Realtime products | Realtime SFU (custom WebRTC), RealtimeKit (A/V call SDK), Cloudflare TURN, Stream Live; DataChannels documented under SFU | [S] https://developers.cloudflare.com/realtime/ |
| DataChannels | Publish/subscribe named channels via SFU. Aug 13 2026 changelog added unordered + `maxRetransmits`/`maxPacketLifeTime` (so `ordered:false, maxRetransmits:0` is now supported). Backend makes authenticated API calls; every subscriber must mirror policy; no stated message-size/throughput quotas; release stage not stated | [S] https://developers.cloudflare.com/changelog/post/2026-08-13-datachannels-reliability-ordering/ , https://developers.cloudflare.com/realtime/sfu/datachannels/ |
| SFU limits | 50 API req/s per session; <=64 tracks per API request; no bandwidth cap listed | [S] https://developers.cloudflare.com/realtime/sfu/limits/ |
| SFU/TURN price | $0.05/GB egress, first 1,000 GB/month free (shared), ingress free | [S] https://developers.cloudflare.com/realtime/sfu/pricing/ |
| TURN | Anycast, TURN-over-TLS ok, no RFC 6062 TCP relay, IPv4 relays only, creds up to 48 h, ~50–100 Mbps per-client drop threshold; STUN free | [S] https://developers.cloudflare.com/realtime/turn/faq/ |
| Location hints | `wnam enam sam weur eeur apac apac-ne apac-se oc afr me`; best effort; only first `get()` respects it; `sam/afr/me` don't spawn locally; objects never move after creation; default = near first caller | [S] https://developers.cloudflare.com/durable-objects/reference/data-location/ |
| PartyKit for Workers | github.com/cloudflare/partykit: partyserver, partysocket, y-partyserver, hono-party, partysub, partysync, partywhen; ~1.3k stars; **ISC**; "work in progress" | [S] https://github.com/cloudflare/partykit |
| Agents SDK | `agents` package: each agent is a DO with SQL, WebSockets, scheduling; aimed at AI agents; docs don't describe rooms or partyserver link | [S] https://developers.cloudflare.com/agents/ |

Ambiguity to test: the docs say requests/sec soft limit is per object but don't say whether each inbound WS message counts toward the 1,000/s figure. Treat it as yes until a load test proves otherwise [E].

## 2. Can one DO relay 10–20 Hz car state?

Inbound rate = drivers x send Hz. Billed requests = inbound/20. Outbound free.

| Drivers | Send Hz | Inbound msg/s | vs 1,000/s soft limit | Billed req/hour | Paid $/hour over allowance* |
|---|---|---|---|---|---|
| 20 | 20 | 400 | ok | 72k | ~$0.011 |
| 50 | 10 | 500 | ok | 90k | ~$0.014 |
| 100 | 10 | 1,000 | at limit | 180k | ~$0.027 |
| 300 | 10 | 3,000 | 3x over -> shard | 540k | ~$0.081 |
| 300 | 5 | 1,500 | 1.5x over -> shard | 270k | ~$0.041 |

*[E] billed req/hr x $0.15/M; first 1M/month free; per-message cost = $0.0075 per million messages (0.15/20). Duration: one active (non-hibernating) room = 0.125 GB x 3,600 s = 450 GB-s/hour, so ~890 room-hours fit inside the 400k GB-s allowance; overage 450 GB-s = $0.006/h [E]. A 4-hour event with 300 phones at 10 Hz is therefore well under $1 total [E].

Free plan [E]: 100k requests/day = 2M inbound messages/day. 20 drivers at 10 Hz (200/s) lasts ~2.8 h; 300 drivers at 10 Hz (3,000/s) lasts ~11 min. Past the cap requests fail, so Free suits <=20 drivers or rehearsals only. Also Free has 10 ms CPU per Worker invocation, so a 300-socket fan-out loop should run on Paid.

Outbound bandwidth is free but CPU is not unlimited. Naive "every client gets every car": 300 cars x ~20 B = 6 KB/snapshot; x300 clients x10 Hz = ~18 MB/s (~144 Mbps) from one isolate [E]. Do not do that. Patterns:
1. Aggregate on a tick (50–100 ms, matches Cloudflare's batching advice): latest-state-per-car map; one binary frame per client per tick. Same `ArrayBuffer` for all recipients when content is identical (presenter/ghost "global" frames).
2. Interest management: per client send only nearest K=24–32 cars at 10 Hz, rest at 2–5 Hz => ~600 B/client/tick, ~1.9 MB/s at 300x10 Hz [E].
3. Shard ingest: 300 drivers -> 4 "lane" DOs (hash of driverId) each <=75 sockets/750 msg/s; one "hub" DO (or each lane DO) exchanges compact lane summaries by RPC. Keeps each object under the soft limit and keeps broadcast fan-out <=~100–500 sockets (matches the community caution) [E].
4. Send state not events: lost/late messages are superseded; no queues grow. Backpressure = drop-old. Clients throttle by `ws.bufferedAmount` (skip a send if >16 KB). The server can broadcast a `rate` control message (10 -> 5 -> 2 Hz) when socket count or event-loop lag rises. Server-side `bufferedAmount` isn't exposed on Workers sockets as far as I found [E], so shed load by rate, not by watching buffers.
5. Ticking uses `setInterval`, which prevents hibernation: fine while drivers are active; clear it when no driver messages arrive for ~10 s so the room can hibernate (idle presence-only rooms stay cheap). Presence/heartbeat via `setWebSocketAutoResponse("ping","pong")` never wakes the DO.
6. Keep per-connection driver id/slot in `serializeAttachment` (<=16 KB); keep volatile car state in memory only (do not write 10 Hz to SQLite: 36k rows/h/driver would spend the 50M row-write allowance quickly; persist only lap results/ghost traces on lap end).

Verdict: 20–100 drivers in one DO is comfortable. 300 needs sharding or a 5 Hz send rate. Fan-out of one stream to hundreds of spectators is easy because spectators send nothing.

## 3. Transports

- **WebSockets via DO (recommended).** TCP head-of-line blocking hurts only on lossy links; at 10 Hz with a 150–300 ms render delay (below) a stalled packet is absorbed. Already built, hibernation-aware, cheap.
- **WebTransport:** not supported on Workers/DO as of the runtime-API list (absence-based) [S]. Do not plan on it.
- **Realtime SFU DataChannels:** now can do unreliable/unordered (`{ordered:false, maxRetransmits:0}`) [S]. Catch: each publisher owns a named channel and each subscriber must create a corresponding remote channel per publisher (API calls, 64 tracks per request, 50 API req/s per session) [S]. For N-to-N state that is N^2 channels: impractical at 300. It also needs a WebRTC peer on the server side of fan-out; a DO/Worker cannot be one [E]. Plausible niche: <=8 drivers where sub-50 ms matters, or one "presenter -> everyone" channel. Cost would be trivial ($0.05/GB beyond 1,000 GB free). Not worth the signalling complexity for a ghost/spectator product.
- **Cloudflare TURN:** only needed for direct P2P DataChannels; P2P mesh doesn't scale beyond ~10 players and needs a signalling DO anyway. Skip. (TURN docs themselves say 1:1 links are TURN's job, SFU for fan-out [S].)
- **RealtimeKit:** A/V calls SDK. Only relevant if we add voice/video at events; unrelated to car state.

## 4. PartyKit / partyserver / Agents SDK

- partyserver (ISC, cloudflare/partykit, ~1.3k stars) wraps a DO with `onConnect/onMessage/onClose`, `broadcast`, hibernation option, rooms by name; partysocket (ISC) is a reconnecting WebSocket client with message buffering. These are license-clean (ISC) and could be copied or used [S].
- We already have a bespoke DO room (SQLite, hibernation, presence, remote, poll). Rewriting onto partyserver gains little; the one worthwhile import is **partysocket** semantics (reconnect with backoff, queue-while-connecting) if our client lacks them [E].
- Agents SDK: built for AI agents (scheduling, tool calls, MCP). No benefit for car state; skip [S for purpose, E for verdict].

## 5. Client smoothing (the part that decides feel)

Rules from Gaffer On Games (https://gafferongames.com/post/snapshot_interpolation/) [S]:
- Buffer delay ~= 3x snapshot interval for 2–5% loss: 300 ms at 10 pps, 150 ms at 30 pps (~85 ms at 60); add ~a frame or two of jitter margin.
- Extrapolation can reclaim delay (350 -> 150 ms with 200 ms extrapolation) but is only reasonable for ~50–250 ms of mostly linear motion and fails under collisions/springs.

For non-colliding visitor cars on a fixed path this is the easy case:
- Because roads are an analytic path, send **path coordinates**, not world xyz: `s` (arc length, float32), lateral offset `n` (int16 cm), heading error, speed (u16 cm/s), yaw rate, steer, throttle/brake bits, lap counter. Interpolate `s` (Hermite using speed) and `n`; the receiving client recomputes position, ride heave/pitch/roll **locally with its own sim-core ride model fed by interpolated speed/accel** (cheap, no need to send suspension DOF). Ghosts then look suspension-correct for free and stay honest (approximate remote state is just visual).
- Interpolate on a timeline `renderT = serverNow - D`, D = 2–3 snapshot intervals (default D=250 ms at 10 Hz, 150 ms at 20 Hz). Pick the two snapshots bracketing renderT; if renderT passes the newest, extrapolate with dead reckoning (`s += v*dt`, `n` and yaw-rate held, clamp to 250 ms then freeze/fade). Adapt D slowly (EMA of arrival jitter, grow fast/shrink slow) to avoid time stretching.
- Fade ghosts' alpha when extrapolating or when stale >500 ms; remove after 3 s.
- Libraries (permissive): @geckos.io/snapshot-interpolation, BSD-3-Clause, ~319 stars, ~109 commits, last-commit date not verified; API `SI.snapshot.add`, `vault`, `calcInterpolation(time,'x y z')`, default buffer 3 server frames [S] https://github.com/geckosio/snapshot-interpolation . It interpolates generic fields but is built around a server-frame clock and linear lerp; for path coordinates, heading wrap and Hermite we should write our own ~80-line interpolator in `sim-core` (pure TS, unit-testable). Use the library only as a reference.
- **Clock sync** (`/api/time`): NTP-style. Client sends t0, server returns ts (server `Date.now()`), client records t1; per sample `offset = ts - (t0+t1)/2`, `rtt = t1-t0`; take 8 samples at start (spaced 100 ms), keep the median offset of the 3 lowest-RTT; re-sync every 30 s and keep a smoothed slew (never jump the render clock; slew <=2%). Better: do it over the WebSocket (no HTTP/TLS overhead): `{t:'sync',c:t0}` -> `{t:'sync',c:t0,s:serverNow}`; handle with auto-response? No, auto-response is static, so this wakes the DO — acceptable (rare). Within a DO, `Date.now()` advances only on I/O in Workers (Spectre mitigation) [E]; fine for ms-level sync. Stamp each client state frame with the client's estimated server time so receivers interpolate on a shared timeline.

## 6. Latency / placement

- A DO instance lives in one colo, chosen near the first `get()` (or by `locationHint`); it never moves [S]. All players of one room round-trip to that colo; the Worker front-door adds no hop after the WS upgrade.
- For an event, create the room with `locationHint` matching the venue (`weur`/`enam`/`wnam`/`apac`/`oc`) and from a request issued at the venue (do not pre-create from CI/laptop elsewhere) [S]. `sam/afr/me` hints fall back to other regions, so Latin America/Africa/Middle-East events inherit a long RTT [S].
- Expected RTT [E]: same-metro DO 10–30 ms; venue wifi + phone radios dominate (20–80 ms, jittery). Global public rooms (visitors from anywhere) get 100–250 ms RTT; hence ghost-style, non-competitive design with 250–300 ms render delay is the right fit; head-to-head racing would not be.

## 7. Product ideas evaluated

### A. Ghost cars of other visitors (non-competitive) — best fit, ship first
- Two flavours:
  1. **Live ghosts** (anyone on the page right now): 10 Hz path-state, interest-managed to ~16 nearest, translucent, no collision, no ranking. 20–100 concurrent is trivial for one DO; ~$0.01–0.03/hour [E].
  2. **Recorded ghosts (async)**: because `sim-core` is deterministic, store only the driver's *inputs* (steer/throttle/brake at 30 Hz, 3 B each = ~8 KB per 90 s lap [E]) plus car/suspension config and replay it with `sim-core`; or store 10 Hz states and interpolate. Put the best/recent N ghosts in the DO's SQLite (1 row per lap, one write per lap, well within row-write allowances) or D1/KV. Costs ~zero live bandwidth, works at any hour, works on Free. Float determinism across browsers/CPUs is generally fine for IEEE double arithmetic but `Math.sin/cos/exp` can differ by a few ULP between engines; replays drift over a lap [E]. Either reuse the same polyfilled/tabulated trig in sim-core or snap to a stored checkpoint every second.
- Honesty note: label ghosts "approximate replay"; remote handling variants (different suspension) are rendered from each ghost's own config, not mixed.

### B. "Follow the presenter's car" spectator mode at events
- One publisher (presenter) -> up to a few hundred spectators. Presenter sends 20 Hz (400 B/s); billed inbound = 72k msgs/h = 3.6k requests/h [E]; spectator outbound is free. Spectators send only auto-response pings. Cost ~ cents.
- Spectators interpolate with D=150 ms and run their own camera (chase/orbit/free), since state is path-based.
- Shard spectators for >500: presenter DO -> relay DOs (<=500 sockets each) via RPC [E].
- In Auto mode the car is a pure function of lap time, so replace the stream with a single `{lapT0, serverTimeAtStart, rate}` message plus clock sync: zero bandwidth and perfectly smooth. Switch to the state stream the moment the presenter goes Manual (this also exercises the Auto<->Manual continuity promise).
- Reuses the existing presenter-remote channel (same DO).

### C. Audience each driving on phones, shown on the big screen — feasible but the riskiest
- Architecture choice matters. Option 1: phones send inputs, the big screen simulates 300 cars at 240 Hz — too heavy for one GPU/CPU tab. Option 2 (recommended): each phone runs its own `sim-core` locally (instant feel, zero input lag) and sends 10 Hz path-state; the big screen is a pure spectator renderer using LOD (full 7-DOF ride only for nearest ~10 cars, others kinematic from interpolated state) and instancing.
- Load: 300 x 10 Hz = 3,000 msg/s inbound: shard into 4 lane DOs (hash of driverId), each <=75 sockets/750 msg/s, and the screen connects to all four as a spectator (or to a hub that aggregates). Billing ~540k requests/h, under $0.10/h [E]. Reduce to 5 Hz if limits bite.
- Real-world risks [E]: 300 phones on one venue wifi (use mobile data/QR with cellular; wifi DTIM and AP limits hurt more than Cloudflare); phone thermal throttling with WebGL; join stampede (300 WS upgrades + 300 /api/time calls within seconds: stagger with jittered retry; the Worker should validate upgrade headers before waking the DO [S best practice]); on-stage moderation (name filter, kick, mute) needed; 30 cars on screen is readable, 300 is soup, so cap visible cars (nearest/most-recently-active 40) and aggregate the rest into a "traffic density" effect.
- Never build ranking/lap-time leaderboards (violates the "no racing-game systems" rule).

## 8. Recommended protocol sketch

Room per event/track: `room:{id}` DO; optional lane DOs `room:{id}:L{0..3}` for >100 drivers. Use binary frames (DataView), little-endian; JSON only for control.

```
Client -> DO (join, JSON):  {t:"hello", name, carId, susp, proto:1}
DO -> Client:               {t:"welcome", slot:u8, serverNow, tickHz:10, lane, ghosts:[...]}
Clock sync (JSON, ~8 samples at connect, then 30 s): {t:"sync",c} -> {t:"sync",c,s}

State (client -> DO, binary, 10 Hz; 20 Hz for presenter):         28 B
  u8  type=1 | u8 slot | u16 seq | u32 tServerMs (client-estimated, wraps ~49 d)
  f32 s (arc length m) | i16 n (lateral cm) | i16 yaw (0.01 deg rel path) |
  u16 speed (cm/s) | i16 yawRate (0.01 deg/s) | i8 steer | u8 flags(brake,reverse,auto,airborne) | u8 throttle | u8 lap

Snapshot (DO -> client, binary, every 100 ms, only K nearest + sparse far set):
  u8 type=2 | u32 tServerMs | u8 count | count x { slot u8, same fields as State minus type/slot } = 20 B per car
  K=24 => ~500 B/frame; unchanged cars omitted (flags bit "stale" if >1 s)

Events (JSON, rare): join/leave/rename/presenter-change/mode {auto|manual}/ghost-lap-saved
Auto mode (presenter spectate): {t:"auto", lapT0Server, rate} instead of State frames
Rate control (DO -> client): {t:"rate", hz:5}   (server load shedding)
Keepalive: setWebSocketAutoResponse("p","q") every 20 s (wakes nothing)
```

Server loop (per room): maintain `Map<slot, lastState>`; `setInterval(100 ms)` builds per-client snapshots by distance bucket (reuse a single buffer for global frames; one `send` per client); drop writes if the room has had no input for 10 s (clear interval -> hibernation). Persist only: lap results, ghost traces on lap end. Validate: clamp `speed`, `s` jumps (speed*dt+margin) to reject garbage; no authority over physics (visitor cars are cosmetic).

Client loop: `renderT = estServerNow - D`; per remote slot keep a 12-snapshot ring; interpolate `s,n,yaw` (Hermite on s using speed; shortest-arc for yaw); dead-reckon <=250 ms past newest; feed interpolated speed/accel to local ride model for visual suspension motion; smooth D (EMA jitter x3, clamp 120–400 ms).

## Recommendation for Suspension Lab

1. Stay on the existing DO WebSocket room (hibernation API); no WebTransport (unsupported), no SFU DataChannels, no TURN for state sync.
2. Send path-space state (`s,n,speed,yawRate,flags`), 28 B at 10 Hz (20 Hz presenter only); remote cars' suspension is re-simulated locally from interpolated speed.
3. Billing is a non-issue: 20:1 inbound ratio => ~$0.0075 per million messages, outbound free; 100 drivers x 10 Hz ~ $0.03/h, 300 drivers ~ $0.08/h [E]. Duration only accrues while the tick loop keeps the DO awake (450 GB-s/h) [S/E].
4. The binding constraint is the 1,000 req/s soft limit per object, not money: shard >100 drivers into lane DOs (or cut to 5 Hz). Load-test with a script of N fake clients before any event (the docs don't say if WS messages count toward the soft limit).
5. Use a 100 ms aggregated broadcast tick with interest management (nearest ~24 cars) instead of echoing every inbound message.
6. Buffer remote cars 250 ms at 10 Hz (3 intervals + jitter), extrapolate <=250 ms, fade when stale; write a small TS interpolator in `sim-core` (BSD geckos snapshot-interpolation is reference only).
7. Clock sync over the WebSocket (NTP-style, median of 3 lowest-RTT of 8 samples, slewed), with `/api/time` as the HTTP fallback.
8. Build ghost cars first: live ghosts for presence plus recorded-input ghosts (deterministic replay, ~8 KB/lap, one SQLite row write per lap); no leaderboard, no collisions.
9. Presenter spectator mode: in Auto send only `{lapT0, rate}` (zero stream); in Manual stream 20 Hz and fan out via relay DOs if >500 spectators.
10. Audience-phones-on-big-screen: phones run local sim-core and send 10 Hz state; big screen is a LOD spectator renderer capped to ~40 visible cars. Treat as stretch; rehearse with 50 real devices on the venue network first.
11. Use `locationHint` matching the venue, created from a venue-originated request; objects never move [S].
12. Keep Free plan only for <=20 drivers/rehearsal (2M inbound msgs/day cap [E]); events go on Paid.
13. Optionally adopt partysocket (ISC) for client reconnect/buffering; skip partyserver rewrite and the Agents SDK.
14. Risks: determinism of replays across browsers (Math.* ULPs), venue wifi, undocumented per-DO broadcast ceiling (community says 500–1k sockets), SFU DataChannels release stage unstated, docs churn (re-verify pricing before launch).
