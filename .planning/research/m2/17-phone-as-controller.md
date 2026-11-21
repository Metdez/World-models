# 17 - Phone as steering controller (tilt-to-steer over the existing Durable Object room)

Scope: phone -> Cloudflare edge -> `Room` Durable Object -> big screen, steering a car in Manual Drive.
Tags: [S] sourced (link), [E] estimate / engineering judgement, [U] could not verify.
Research limits: GitHub API was blocked in this session (licences come from repo page text); no controlled DO-vs-WebRTC latency benchmark exists in public sources (see 4).

## 0. What we already have (read from the repo, not the web)

- `worker/room.ts`: one hibernating-WebSocket DO per room; `setWebSocketAutoResponse('ping','pong')`; roles viewer/screen/host/audience (`src/contracts/net.ts`); a NTP-style `sync` probe already exists.
- Hard blockers for driving, all in current code:
  1. `NET_LIMITS.wsMessagesPerSecond = 5`, `wsBurst = 10` (token bucket in `worker/room-logic.ts`, `takeToken`): a 30-60 Hz input stream would be dropped, then closed after `rateStrikes`.
  2. `wsMessageBytes = 1024` is fine; but `webSocketMessage` does zod parse + `ws.deserializeAttachment()` (structured clone) on every frame. OK at 60 Hz, wasteful; cache role in an in-memory `WeakMap<WebSocket, ...>` (rebuilt after hibernation).
  3. `broadcast()` sends to ALL sockets. Drive frames must be sent only to `screen` sockets (audience phones must never receive 60 Hz traffic).
  4. No "driver" role: only a host (has hostKey) may mutate state. Driving needs its own role with a pairing secret so an audience member cannot grab the wheel.

## 1. DeviceOrientation / DeviceMotion in 2026

- iOS Safari: `DeviceOrientationEvent.requestPermission()` (and `DeviceMotionEvent.requestPermission()`) returns a Promise of `"granted"|"denied"`; needs a secure context and transient user activation, otherwise rejects `NotAllowedError`; passing `true` adds the magnetometer. Feature-detect with `typeof DeviceOrientationEvent.requestPermission === 'function'`. [S] https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
  - Call it synchronously inside the tap handler, BEFORE any `await` (a prior await can consume the activation) [E].
  - Safari logs "No device motion or orientation events will be fired until permission has been requested and granted" if not. [S] https://stackoverflow.com/questions/56514116/how-do-i-get-deviceorientationevent-and-devicemotionevent-to-work-on-safari
  - One grant covers both orientation and motion events in Safari [E]. The user can disable "Motion & Orientation Access" in Safari settings; permission is re-asked on reload [E] -> keep a big "Tap to enable steering" button and handle `denied` by falling to the touch slider.
  - In-app browsers (Instagram, WhatsApp, camera-QR webviews) sometimes block sensors [E]: the join page should detect no events within ~1 s of "granted" and show "Open in Safari/Chrome".
- Android Chrome: no prompt; secure context only; events just flow [S] https://blog.openreplay.com/understanding-device-orientation-api. Works in an iframe only if Permissions-Policy allows accelerometer/gyroscope (AirConsole documents the same iframe caveat). [S] https://airconsole.github.io/airconsole-api
- HTTPS: our Workers domain is HTTPS, so satisfied. Local `http://192.168.x.x` dev tests will NOT work on iOS; use `wrangler dev --remote` or a tunnel [E].
- Sampling rate: nobody documents it authoritatively. 2015 WebKit bug says iOS Safari emitted deviceorientation at 20 Hz [S] https://bugs.webkit.org/show_bug.cgi?id=145814 (a patch to raise it was proposed; modern iOS is commonly ~60 Hz [E]). Chrome Android ~60 Hz claimed in a Mozilla bug thread [S, weak] https://bugzilla.mozilla.org/show_bug.cgi?id=1515780. `DeviceMotionEvent.interval` reports the sample interval; quirk: units differ between engines (ms vs seconds) [S/E] https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent. Action: log the measured inter-event dt in the rehearsal build; design for 20-60 Hz and never assume more.
- Coordinates differ between engines (MDN warns Firefox and Chrome disagree on `accelerationIncludingGravity` sign) [S] -> do not hard-code a sign; learn it in calibration (3).
- Do not use Euler `alpha/beta/gamma` for a wheel. Holding a phone landscape-upright like a wheel puts `beta` near +/-90 deg = gimbal-degenerate zone where `alpha`/`gamma` swap meaning [E, from the Euler-angle definition in the W3C spec https://www.w3.org/TR/orientation-event/].
- Rotation-lock trap: turning a portrait/landscape phone ~45 deg makes the OS auto-rotate the UI. `screen.orientation.lock()` works only in fullscreen on Android Chrome and not on iOS Safari [E]. So do not depend on UI orientation: compute steering in the DEVICE frame (below) and make the join/drive UI rotation-agnostic (centred circle, symmetric pedals).

### Recommended steering extraction (steal-ready, ~15 lines)

Use `devicemotion.accelerationIncludingGravity` (gravity vector, no gimbal lock, no UI-rotation dependence):

```ts
// device frame: x right, y up (portrait), z out of screen. Wheel = rotation about z.
const raw = Math.atan2(g.x, g.y) * 180 / Math.PI;          // deg, -180..180, gravity direction in x-y plane
const d = wrap180(raw - neutral);                          // neutral captured at "Centre" tap
const dir = signLearned;                                   // +1/-1, learned in calibration
const a = dir * d;                                         // + = turn right
```
Guard: if `hypot(g.x,g.y) < 3 m/s^2` (phone flat, gravity along z) hold last value and show "hold upright". Gravity is polluted by bumps/hand acceleration; low-pass it. Optional upgrade: complementary filter with `rotationRate.gamma` (z-rate) [E] - skip unless the demo shows jitter.

### Calibration (3 taps, 5 s) [E]
1. "Hold like a wheel, tap Centre" -> `neutral = raw`.
2. "Turn right" -> sign: `dir = sign(wrap180(raw - neutral))` once |d| > 15 deg. This kills the iOS/Android sign difference and left/right-handed holds.
3. (optional) "Turn full lock" -> `maxAngle` clamp 25-45 deg.
Re-centre button always visible; double-tap centre.

### Filtering [E]
- Hand tremor ~8-12 Hz [E]; use a One-Euro filter (Casiez 2012; adaptive low-pass: mincutoff ~1.5 Hz, beta ~0.01 in degree units, dcutoff 1 Hz) on the angle: smooth at rest, fast when turning. ~25 lines, write ourselves (algorithm is published; do not copy unverified reference code). Paper: https://gery.casiez.net/1euro/
- Filter on the phone BEFORE sending (so noise never costs bandwidth); do a second light smoothing on the screen (6).

## 2. Tilt-to-steer UX (mobile racing games) [E unless marked]

- Landscape hold, tilt left/right = wheel; throttle/brake as two big thumb zones (right = gas, left = brake), the de-facto layout in Asphalt/Real Racing-style titles. (No licensed source needed; widely observable.)
- Dead zone 2-3 deg (removes tremor; ~5 deg feels sloppy).
- Full lock at +/-30-40 deg of wheel rotation (comfortable wrist range; beyond ~50 deg users must re-grip).
- Response curve: `steer = sign(a) * ((|a|-dz)/(max-dz))^k`, `k` 1.3-1.6 (fine control near centre, quick at the edges). Expose "Sensitivity" as `max` (25 / 35 / 45 deg) only; no sliders for a live demo.
- Speed-dependent lock: do it on the CAR side (reduce max road-wheel angle with speed, as real power steering/ESP assists do); keeps phone dumb and the latency exposure small. Pairs with the Manual Drive handling model.
- Pedals: analog throttle by vertical position within the thumb zone is hard to hit blind; for a live event offer a mode toggle: "Auto throttle (hold brake to slow)" as default for strangers, "Pedals" for enthusiasts. Throttle/brake ramps (e.g. 0 -> 1 in 150 ms) smooth finger on/off [E].
- Reverse: a small "R" toggle (not a gear lever), shown only when stopped.
- Feedback: vibration pulses on kerb/bump (Android), a screen-side steering-wheel graphic + link-quality dot on both screens. Never silent failure: if input stalls, say so on the big screen.

### Touch-slider fallback (must exist)
- Horizontal "wheel arc" 70% screen width: RELATIVE drag (angle = dx from touch-down / half-width * lock) with spring return to centre on release; no absolute-position precision needed. Same pedals. Same wire protocol (only the producer changes).
- Keyboard (arrow/WASD) already the desktop fallback.

## 3. Haptics and wake lock

- `navigator.vibrate(pattern)`: marked limited availability on MDN (Safari/iOS do not implement it); needs sticky user activation; returns false on bad pattern; new call cancels the old; silent/DND may suppress. [S] https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate . Feature-detect; on iOS: no vibration (a `<input type=checkbox switch>` click-haptic hack exists in recent Safari [U, not verified; do not rely]). Patterns: kerb strike `[12]`, pavé `[8,20,8,20,8]`, limit-grip `[30]`; downlink at most 5 Hz.
- Screen Wake Lock: `navigator.wakeLock.request('screen')`, HTTPS only, auto-released when the page is hidden, so re-request on `visibilitychange`; Baseline 2025. [S] https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API . This is mandatory here: tilting is not a touch, so the OS idle-dim timer will fire mid-demo. Request on the "Start driving" tap; fallback = hidden looping video (NoSleep.js approach, MIT [U-licence not re-checked]).

## 4. Latency budget (phone -> edge -> DO -> screen)

Measured public data is poor. Found: forum reports of ~70 ms Worker<->DO WebSocket round trips vs 2 ms ping to the domain [S, anecdotal] https://www.answeroverflow.com/m/1283803781896863867 ; blog numbers 25 ms US-East->EU for DO WebSocket [S, low quality] https://kubaik.github.io/choose-the-right-real-time-protocol-in-60-seconds/ ; generic WebRTC "30-80 ms same region" [S, unverified claim] https://tech-insider.org/websocket-vs-webrtc-multiplayer-games-2026/ . No controlled DO-vs-DataChannel comparison exists: treat all as indicative, MEASURE ourselves (our `sync` probe is the tool).

Budget, same-region venue [E]:

| Stage | Median | p95 |
|---|---|---|
| Sensor sample -> JS event (20-60 Hz, avg half period) | 8 ms | 25 ms |
| Filter + send tick (30 Hz fixed -> avg half period) | 17 ms | 33 ms |
| Phone radio uplink (Wi-Fi 3-15 ms; 5G/LTE 20-50 ms) | 15 ms | 60 ms |
| Edge -> DO -> screen socket (DO near the screen if created by the screen client; same-city colo) | 10-25 ms | 50 ms |
| Downlink to screen + JS handling | 5-15 ms | 30 ms |
| Next render frame + smoothing lag | 8-16 ms + 40 ms | - |
| Total input-to-visible | ~100-140 ms | ~200-250 ms |

Interpretation: expect 100-150 ms median, with 200+ ms spikes on congested venue Wi-Fi. Car at 25 m/s moves 2.5-3.5 m in that time; the steering must therefore be forgiving (rate-limited, speed-sensitive lock, lane-friendly handling), which the product already wants.

WebSocket-over-TCP vs WebRTC DataChannel:
- TCP head-of-line blocking: one lost packet stalls later frames (sudden hundreds-of-ms freezes on lossy mobile links); unordered/unreliable DataChannel delivers the newest sample and drops the stale one. [S] https://www.videosdk.live/developer-hub/webrtc/websocket-vs-webrtc-datachannel , https://www.sitepoint.com/webrtc-data-channels-vs-websockets-for-browser-games
- P2P WebRTC on the same LAN could be 5-20 ms [E] but: needs signalling (our DO can do it), STUN/TURN, and event Wi-Fi often has client isolation, forcing TURN relay (then no better than WS). Cloudflare Realtime SFU DataChannels exist (publisher -> subscribers, one subscriber may reply with `canReply`, per-channel ordering/retransmit policy; no quotas published) [S] https://developers.cloudflare.com/realtime/sfu/datachannels/ ; it is a heavier API/beta-ish surface [U status].
- Mitigations that make WS good enough: send latest-wins (skip a tick if `ws.bufferedAmount > 0`), small frames (<80 B), 30 Hz, no retransmit-queue growth, phone on cellular or own hotspot (not the congested audience Wi-Fi).

DO platform facts [S]:
- 1,000 requests/s soft limit per DO, single-threaded: https://developers.cloudflare.com/durable-objects/platform/limits/ . One driver = 30-60 in + 30-60 out per s, fine; audience polls share the DO, fine.
- Incoming WS messages billed at 20:1 (outgoing and pings free): 60 Hz x 1 h = 216k msgs = ~10.8k billable requests = ~$0.002 beyond free; duration billing continues while messages keep it awake (128 MB x wall time; 1 h ~ 450 GB-s of 400k included). https://developers.cloudflare.com/durable-objects/platform/pricing/
- Docs advise batching/flushing every 50-100 ms when many small messages overwhelm a DO: https://developers.cloudflare.com/durable-objects/best-practices/websockets/ (not needed at one driver, but do not flush-delay drive frames).
- Placement [E]: a DO is created near its first caller; make the SCREEN create/touch the room (already the case via `POST /api/rooms`) so the DO lands near the venue; `locationHint` can force a region [U, not fetched].

## 5. Wire protocol (proposal; extends `ClientMessage` / `ServerMessage`)

New role `driver` (joins via QR fragment `#d=<driverKey>` shown only on the big screen, same pattern as `#k=` host key; one active driver, claim = first valid key, host can revoke). `PROTOCOL_VERSION` -> 3.

```ts
// phone -> DO (driver only). Integer fixed-point keeps frames ~50 B and parsing trivial.
| { t: 'in'; n: number;            // seq (u32, wraps), screen drops n <= last (reorder/replay guard)
    s: number;                      // steer  -1000..1000 (after dead zone/curve; + = right)
    th: number; br: number;         // 0..1000
    f: number;                      // flags bitfield: 1=reverse, 2=handbrake(unused), 4=touch-fallback, 8=autoThrottle
    c: number }                     // client performance.now() ms (diagnostics only)
| { t: 'drv'; on: boolean }         // driver wants Manual (true) / Auto (false); screen decides, mirrors back
// DO -> screen only (never broadcast to audience):
| { t: 'in'; n; s; th; br; f; c; r: number }   // r = DO Date.now() receive time -> screen estimates link age
// DO/screen -> driver phone:
| { t: 'drv'; state: 'auto'|'manual'|'denied'; link: 'ok'|'slow' }
| { t: 'hap'; p: number[] }                     // vibrate pattern, <= 5/s
| { t: 'tel'; v: number; gear?: string }       // optional speed readout, <= 5 Hz (phone UI only)
```
Server changes [E]: per-role buckets (driver: 90/s, burst 30; others unchanged); text frame cap for driver 128 B; point-to-point relay to `screen` sockets via a `Set` cached from attachments; coalesce: if the screen socket is backpressured keep only the newest frame; no storage writes on the drive path; `touch()` stays lazy.
Cadence: phone sends fixed 30 Hz (60 Hz if measured RTT < 60 ms), plus a 10 Hz keep-alive when idle; send on state change of pedals immediately (edge-triggered) so brake taps are not quantised to the tick.
Heartbeat: existing `ping`/`pong` every 5-10 s for liveness; the `sync` probe at 1 Hz for the on-screen link badge.

### Screen-side handling (smoothing/prediction, under 50-150 ms) [E]
- Treat the stream as a TARGET, not a position: `steerCmd` -> steering-actuator model (first-order lag tau ~ 60-80 ms + slew limit ~ 300-500 deg/s of wheel-equivalent) feeding the 240 Hz ride/handling model. Network jitter is hidden by actuator lag the model already needs for realism.
- Jitter buffer: none (latest-wins). Interpolate target between packets over one packet period only to avoid 30 Hz steps showing at 60 fps render.
- Prediction: at most linear extrapolation of the target for <= 1 packet period (~33 ms) from the last two samples; beyond that hold. Do not extrapolate throttle/brake (edge-triggered).
- Failsafe: no frame > 250 ms -> steering decays to 0 over 300 ms, throttle -> 0; > 1 s -> release to Auto (the existing seamless Auto<->Manual handover is the safety net), banner "Controller lost".
- Link badge: colour from median `now - r` jitter and RTT; amber > 150 ms, red > 250 ms.

## 6. Prior art

- AirConsole - phones as controllers for a browser/TV screen; API is a message-passing relay with `device_motion` interval option, `vibrate()`, `slow_connection` flag. https://github.com/airconsole/airconsole-api (~110 stars, 439 commits) - licence NOT stated on the repo page [U]: treat as ideas only. Developer review notes noticeable lag steering in a racing game (Racing Wars). [S] https://medium.com/@bradndon/airconsole-first-impressions-tips-for-developers-9143d65021c7
- Jackbox-style: 4-letter room code on the shared screen + phone browser. We already do this (5-char unambiguous alphabet, `/r/<CODE>`); nothing to lift.
- Air Jam (vucinatim/air-jam): TypeScript framework, QR-join, websocket server, "AirConsole alternative". https://github.com/vucinatim/air-jam - MIT [S, repo page], ~9 stars, 706 commits, updated Nov 2026 [S] https://github.com/topics/phone-controller . MIT so copyable, but tiny and its transport/input rate are undocumented on the page [U]; read `@air-jam/server` controller input code for ideas before writing ours; do not add as a dependency.
- Smaller: remote-controllers-manager (MIT, docs unwritten) https://github.com/iagobruno/remote-controllers-manager ; wsctrl (MIT, minimal) ; pizza-peers, acthung-webrtc, Couchfriends Controller-API, `remotegamepad` (WebRTC pairing code) - licences not verified [U].
- Do NOT copy: VirtualGamePad (GPL-3.0) https://github.com/kitswas/virtualgamepad ; android-open-mapper (PolyForm Noncommercial). Native Android apps anyway.
- Net: no open-source project gives us tilt-steer code worth lifting; the useful artefacts are the equations in 1-2 and the protocol in 5.

## Recommendation for Suspension Lab

1. Verdict: tilt-steer over the DO WebSocket is good enough for a live demo for ONE driver if the budget in 4 holds (expect ~100-150 ms median). Ship it, but only with the fallback, failsafe and link badge below.
2. Do a 30-minute rehearsal measurement at the venue: log `sync` RTT and drive-frame age (`now - r`) for p50/p95/max on the actual phone + network; promote WebRTC only if p95 > ~150 ms.
3. Keep WebSocket; do not build WebRTC/SFU now. Park a P2P DataChannel spike (DO as signalling, unordered, `maxRetransmits: 0`) as a post-demo optimisation.
4. Add a `driver` role with a QR-fragment pairing key (like `#k=`), single active driver, host can revoke; PROTOCOL_VERSION 3.
5. Raise rate limits per role (driver 90/s burst 30, 128 B frames); relay `in` frames only to screen sockets (never `broadcast`); latest-wins under backpressure; cache role outside `deserializeAttachment`.
6. Protocol: compact fixed-point `in` frame (`n,s,th,br,f,c`), 30 Hz + edge-triggered pedal changes + 10 Hz idle keep-alive; `hap` and `tel` downlinks <= 5 Hz.
7. Steering extraction: gravity vector via `devicemotion` + `atan2(x,y)`, relative to a captured neutral, sign learned in a 2-tap calibration; wrap at 180; hold if phone flat. Not Euler angles.
8. UX constants (tune on device): dead zone 3 deg, full lock 35 deg, curve exponent 1.4, One-Euro filter on phone; speed-sensitive lock and steering-actuator lag (tau ~70 ms, slew-limited) on the car side.
9. Default to "Auto throttle, hold to brake" for stranger drivers; pedal mode as an option.
10. Touch-slider fallback (relative-drag wheel arc + pedals) auto-offered when permission is denied, no events arrive within ~1 s, or the user taps "Use touch".
11. iOS: request permission inside the tap handler before any await; detect in-app browsers and tell the user to open Safari. Android: no prompt, HTTPS only.
12. Request wake lock on "Start driving" and re-acquire on `visibilitychange`; mandatory because tilting never resets the idle timer.
13. Haptics: `navigator.vibrate` on Android only, feature-detected; iOS gets visual/audio cues only (no reliable web haptics).
14. Failsafe: input silent > 250 ms -> decay to neutral; > 1 s -> hand back to Auto via the existing seamless switch; big-screen "Controller lost" banner.
15. Risks: venue Wi-Fi congestion (put the driver phone on cellular/own hotspot); iOS sensor-rate uncertainty (log `interval`); UI auto-rotate when tilting (device-frame math avoids it); DO placement far from the venue (screen creates the room; consider `locationHint`); cost is negligible (~$0.002/h at 60 Hz).
