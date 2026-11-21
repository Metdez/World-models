# Milestone 2 (Manual Drive) — research synthesis and orchestrator decisions

24 research files (01–24) in this folder. Where they disagree, THIS file wins. Numbers tagged [E] in the
research are estimates: the sim computes what it displays; estimates are never shown as engineering data.
Known corrections: file 23 supersedes 05 on compliance magnitudes (05 overstated ~10×); file 21 supersedes
16 on billing (static assets free; DO incoming WebSocket messages bill 20:1).

## Product shape
- **Auto Drive stays exactly as today** (`stateAt(t)` pure function of lap time, server-time synced "live lap",
  attract mode, presenter remote). It is the idle default. Nothing in M1 regresses.
- **Manual Drive** = the user drives the SAME car through a new dynamic plant. Take control with one key/click
  or simply by pressing a driving key (edge-triggered, Slow Roads pattern); hand back with one key, or
  automatically after idle (cancellable). Persistent AUTO / MANUAL pill. Hint fades out. R = reset to nearest
  road point facing forward. H hides UI (exists).
- **Car first.** Motorcycle manual riding is v1.5 (lean-target input + internal PD roll controller; Jolt MIT
  lean formula as reference) and only after the car feels right. In M2 the bike stays Auto-only and the UI says so.
- **Experiments, not competition:** no lap times, scores, progression. Stations framed as "try this".
- **Signature teaching device:** "same line, different suspension" closed-loop ghost — a disclosed driver model
  tracks the user's recorded path + speed with another suspension; differences shown as steer/slip/roll traces.
  (Open-loop input replay diverges; offered only as short branching windows, stretch.)

## Simulation decisions (files 02, 03, 04, 05, 06, 09, 12, 20, 23)
- **No physics engine** (Rapier/Jolt/cannon/ammo all use one vertical spring per wheel — suspension types would
  be identical; +0.7–1.2 MB). Extend `sim-core`. Lift constants/logic from Jolt (MIT): friction-curve shape,
  auto-shift state machine, LSD ratio, ARB form.
- **Plant:** 14-DOF = existing 7-DOF ride (heave/roll/pitch + 4 unsprung) + planar x, y, yaw + 4 wheel spins.
  ISO 8855 signs as today. Tyre forces applied at ground; roll-centre height → geometric load transfer + jacking;
  anti-dive/anti-squat from existing kinematic tables. Suspension type therefore changes the driven car through
  the SAME tables Auto uses — no per-type tuned handling numbers.
- **Tyre:** per-wheel simplified Magic Formula (4 coefficients) with load sensitivity (μ and Cα fall with Fz),
  equivalent slip angle `α + toe + (Cγ/Cα)·γ` plus peak loss with camber, normalised combined slip, deflection-state
  relaxation (non-singular at v→0), bristle/Coulomb hold below ~1.5 m/s. Coefficient set: start from Project
  Chrono PAC02 data (BSD-3) rescaled; sports-tyre values are [E] and labelled "representative".
- **Compliance (elastokinematics):** include, small and honest. Linear compliance matrix per corner derived from
  OUR hardpoints + ONE shared role-based bushing table for all three types (K = Σ kᵢ wᵢ wᵢᵀ, inverted) → toe and
  camber change per kN of Fy/Fx/Mz. Show sensitivity (±2× bushing band) in docs; never hand-pick per-type
  coefficients. Expect ~0.05–0.4 deg/g contributions; braking toe is the notable design-intent difference.
- **Numerics:** main thread, fixed 240 Hz, semi-implicit Euler; **implicit wheel-spin update** (explicit is
  unstable < ~20 m/s); relaxation via contact-patch deflection state; one finite-check per step with last-good
  ring buffer and auto-recover; zero allocation in the step. No Worker/SAB/WASM.
- **Determinism:** no `Math.sin/cos/atan2/exp/pow` inside the manual plant hot loop → own deterministic kernels
  (stdlib-js fdlibm kernels, Apache-2.0, or polynomials) in `sim-core/math`. CI hash test in Chromium + Firefox +
  WebKit (Playwright has all three? verify; else Chromium + Node and document the gap).
- **Powertrain/brakes/aids:** DB11 published data (8 ratios, final drive 2.703, 1875 kg, 51/49, 700 Nm @1600,
  600 hp @6500; CdA back-solved [E]). Automatic gearbox, LSD, brake bias ~69 % F (derived), engine braking, reverse.
  Aids ON by default, each a visible toggle and each labelled when intervening: ABS, traction control, stability
  control. Keyboard helpers (speed-sensitive steering limit/rate, asymmetric ramps, throttle/brake ramps) live in
  input conditioning, not in the plant. Our own filter code (VDrift's is GPL → ideas only).
- **Drivers:** `Driver` interface → `{steer, throttle, brake, handbrake, reverse}` each step. `HumanDriver`
  (conditioned input), `PathDriver` (Stanley + curvature feed-forward + speed-profile tracking + 5-state recovery
  machine; PythonRobotics MIT as reference). Manual→Auto = PathDriver steers back to the line on a detached lap
  clock, then explicit/automatic "rejoin live lap" (seek) behind a brief fade. Auto→Manual = seed plant from
  `stateAt(t)` (planar state, wheel spins, steering angle, ride state is already continuous); steering slew-limited
  blend so there is no jump.
- **World:** pure-TS analytic `GroundWorld` in sim-core: ordered zones (loop projection, rect, disc, ramp) each
  returning height, normal, surface {μ, rolling resistance, roughness}. Renderer reads the same zone table.
  Annex ≤ 600 × 400 m joined to the loop by two spurs: dynamics pad (R40 steering circle, 25 m slalom, ISO 3888-2
  lane change with sourced dimensions), ride street (washboard, pavé, kerb step), braking platform (low-μ and
  split-μ lanes). Annex position must be checked against the real `proving-loop.ts` geometry. Soft boundary:
  grass run-off with lower μ, then fade + reset. Props procedural (no usable CC0 packs found).
- **Validation (file 20):** closed-form bicycle-model identities at 1 % tolerance; ISO-style manoeuvres in bands;
  DB11 published 0–60 mph 3.6–3.95 s, 60–0 mph ≈ 32 m, skidpad 0.94–0.98 g as sanity bands. Understeer must
  emerge from physics, not a tuned constant. Continuity test: plant driven by PathDriver on the loop reproduces
  the Auto lap's body motion within tolerance (same car in both modes).

## Experience decisions (files 07, 08, 13, 18, 19, 22)
- **Input:** device adapters (keyboard, Gamepad API with our dead zones/curves, touch: steering slider + pedals)
  → pure deterministic conditioning in sim-core → arbiter + Auto/Manual state machine. One `DriveInput` per tick.
- **Camera:** one rig; manual chase predicts from velocity direction, yaw rate and steer (no known future path),
  world-up, stays behind in reverse, cross-fade target values ~0.8 s on mode switch, hard cut only on reset.
  Optional wheel inset (scissor viewport) — stretch, must cost < 1 ms.
- **Teaching feedback (≤ 6 devices, sparse, fade with competence):** friction ring under each tyre (radius = μ·Fz,
  dot = force used; red when exceeded), skid marks only past the limit (folio-2025 `Tracks.js` MIT pattern
  re-expressed in GLSL), one-line coach on detected events, slow-mo moment replay, the A/B ghost, existing
  telemetry card extended with speed/gear. No motion blur, shake, vignette.
- **Audio/haptics:** extend existing muted-by-default audio with real rpm/load, tyre squeal onset at ~0.75 grip use
  as a cue; gamepad dual-rumble where supported (feature-detected). No good CC0 V12 loop pack exists → render our
  own loops offline with an MIT tool or keep the Kenney loops pitch-mapped.

## Cloudflare blend (files 14, 15, 16, 17, 21)
- ADOPT: (1) **Shareable replays** — quantised input log + CRC keyframes, deflate + base64url in the URL fragment
  for short runs, **D1** for longer ones (30-day TTL, Cron cleanup, size cap, Turnstile + rate limit on writes).
  (2) **Race Engineer for driving** — sim-core event detectors (slide, lock-up, bump, lift-off) → fact cards → the
  existing Workers AI model explains only detected events; template-first; via AI Gateway if the unified binding
  is available on this account. (3) **Phone as controller** through the existing room DO: new `driver` role with
  QR pairing, per-role rate buckets, compact input frames relayed only to the screen, 1 s-silence failsafe back to
  Auto, touch slider default and tilt optional. (4) **Analytics Engine** crowd insight for stations.
  (5) Cloudflare **Access** on presenter pages — MAYBE (needs a custom zone; workers.dev may not support it).
- STRETCH: live ghost cars of other visitors (path-space state at 5–10 Hz, 100 ms aggregated broadcast,
  interest management, sharded rooms). Free plan covers ~20 drivers for a few hours.
- SKIP: R2 (needs a card), Stream, Browser Run for share images (no WebGL), Vectorize/AI Search, Pipelines, Queues,
  Workflows, Containers, WebRTC/SFU/TURN, WebTransport, Waiting Room.
- Verified facts: static-asset requests are free/unlimited (keep `run_worker_first` narrow); DO incoming WS
  messages bill 20:1, outgoing free; D1 Free 100k writes/day; Turnstile tokens 300 s single-use; several Workers
  AI models were retired 2026-11-20 (ours is still listed).
- Unverified → test on this account before relying: Rate Limiting binding on Free; Access on workers.dev.

## Licences
Copyable: Project Chrono (BSD-3), Jolt (MIT), PythonRobotics (MIT), folio-2025 (MIT), esc5221/drive-game (MIT),
icurtis1/raycast-vehicle (MIT), Godot-Easy-Vehicle-Physics / ArcadeCarPhysics (MIT — verify LICENSE at lift time),
TUMFTM Open-Car-Dynamics (Apache-2.0), stdlib-js (Apache-2.0), nipplejs (MIT). Ideas only: LibreCorsa (AGPL),
VDrift / Speed Dreams (GPL), CommonRoad (licence unconfirmed), Gaffer on Games, AirConsole, book sources.
GitHub API was blocked for the researchers: re-check every LICENSE file at the moment code is lifted and record
it in CREDITS.md.

## Process
GSD as in M1: this synthesis → Opus planning (REQUIREMENTS-M2, ROADMAP-M2, ARCHITECTURE addendum with frozen
contracts) → Opus executors per plan under EXECUTOR.md (Ponytail discipline, modular feature boundaries, explicit
file ownership, private e2e builds) → phase gates with deploys. M1 phase 7 builders finish first; M2 executors
start only on a green tree.
