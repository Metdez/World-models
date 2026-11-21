# Requirements — Milestone 2: Manual Drive

**Defined:** 2026-11-21. **Extends:** `.planning/REQUIREMENTS.md` (M1, all still binding). **Decisions:** `.planning/research/m2/SUMMARY.md`.
**Contract:** `.planning/ARCHITECTURE-M2.md`. **Plans:** `.planning/ROADMAP-M2.md`.

**Milestone value:** the visitor takes the wheel of *the exact car they were watching*. The same vehicle definition, the
same suspension kinematics tables, the same 7-DOF ride model and the same tyre peak-grip function now respond to their
hands, so MacPherson, double wishbone and multi-link change how the car drives for computed reasons, with no universal
winner and nothing exaggerated. Auto Drive stays exactly as it is.

Conventions as in M1: IDs `MD-NN`; each item is user-observable or mechanically checkable (the check is named);
**[S]** = stretch (may be cut at its phase gate without breaking the product; record the cut in STATE.md).
Numeric thresholds below are the binding acceptance values; constants they test are defined in ARCHITECTURE-M2.md.

## v1 Requirements

### Auto stays Auto (AUTO)
- [ ] **MD-01**: With no driving input the app is M1: `tests/sim-core/golden.test.ts` hashes are unchanged, the live lap,
  attract mode, presenter remote, Live Lab and Race Engineer behave as before, and the M1 e2e suite passes unchanged.
- [ ] **MD-02**: Auto is the boot default; Manual is entered only by the visitor (or `?drive=manual` for tests/events).
- [ ] **MD-03**: The motorcycle stays Auto-only; with the bike selected the drive pill reads "Auto only for this vehicle"
  and driving keys do nothing beyond M1 shortcuts.

### Mode and handoff (MODE)
- [ ] **MD-04**: Take the wheel: a fresh press of ↑, W, ←, →, ↓, Enter, a gamepad stick/trigger beyond its dead zone, a touch
  pedal, or a click on the AUTO pill switches to Manual at the next fixed step (≤ 1 frame later). A and S keep their M1
  meanings (amplification, slow motion) while in Auto; Space stays Pause in every mode.
- [ ] **MD-05**: Auto→Manual continuity: switching at 20 random lap times changes body position, speed, yaw rate, mean
  road-wheel steer, wheel spin rate and every ride state by no more than one fixed step's physical increment
  (thresholds in ARCHITECTURE-M2 §11, `tests/sim-core/handoff.test.ts`); the camera does not cut.
- [ ] **MD-06**: Hand back: Enter, the pill, or idle (cue after 9 s, hand-back at 12 s; ×2.5 on `?screen=1`; any input
  cancels) starts **Returning**: the autopilot drives the same plant back to the driving line on a detached lap clock and
  latches to Auto when |lateral error| < 0.05 m, |heading error| < 0.5° and speed within 5 % + 0.2 m/s of the profile for
  1 s. From 500 seeded random starts within 12 m of the line it latches within 20 s, never leaves a 30 m corridor and
  never produces NaN; from 50 starts on the annex it latches within 60 s.
- [ ] **MD-07**: Rejoin live: after any manual excursion the car is on a detached clock (pill shows "Off the live lap");
  "Rejoin live" (pill or the M1 Live chip) or 20 s of idle in Auto re-syncs to the shared lap behind a ≤ 0.4 s fade
  that is announced as a cut.
- [ ] **MD-08**: A persistent AUTO | MANUAL | RETURNING | REPLAY pill shows the simulation's real mode (store mirror
  written only by the kernel); a one-line hint ("Press ↑ or W to drive") appears after 4 s of Auto, fades after the
  first takeover or 8 s, and its dismissal persists (localStorage, try/catch).
- [ ] **MD-09**: R (Manual only) places the car at rest on the nearest driving-line point facing along the line, or at
  the chosen station, behind a short fade; the ride state settles at static equilibrium there.
- [ ] **MD-10**: Other controls stay safe while driving: vehicle switch, attract start, presenter section jumps release
  Manual immediately (a cut) or are ignored (`sim:seek-to` is ignored outside Auto, with a console warning); a
  suspension swap (1/2/3 or the HUD) while driving keeps pose, velocities and ride state and changes only tables and
  per-type extras.

### Plant and physics (PHYS)
- [ ] **MD-11**: Same car: Manual reads the same `CarDefinition`, the same `prepareCarSuspension` tables, the same
  `createRideModel` and the same `peakMu()` as Auto; content has no per-suspension handling constants
  (`tests/arch/no-type-tuning.test.ts` greps `src/sim-core/drive` and handling content for suspension ids).
- [ ] **MD-12**: 14-DOF plant at 240 Hz: planar x, y, yaw + the unchanged 7-DOF ride + 4 wheel spins; tyre forces act at
  the ground; roll-centre lines give geometric transfer and jacking per wheel; anti-dive/anti-squat come from the
  tables; compliance toe/camber from hardpoint-derived matrices (one shared bushing table).
- [ ] **MD-13**: Tyre: simplified Magic Formula per wheel with load-sensitive stiffness and the M1 peak-μ (load and
  camber loss), camber as equivalent slip, toe through the wheel heading, normalised combined slip, contact-patch
  deflection relaxation, stable through standstill: at rest with the brake held on a 5 % slope it does not creep
  (< 1 mm in 10 s); on flat ground with no input it does not drift; coasting to a stop decelerates monotonically.
- [ ] **MD-14**: Powertrain without gear management: torque curve, 8-speed automatic with throttle-dependent shifts,
  shift torque cut, engine braking, limited-slip differential, reverse selected by holding brake at standstill
  (≥ 0.25 s, |u| < 0.5 m/s), reverse speed cap.
- [ ] **MD-15**: Aids ABS, Traction, Stability and Steering are ON by default, each a visible toggle, each with a lamp
  while intervening, all labelled "Assist: simplified model".
- [ ] **MD-16**: Validation bands pass (`tests/sim-core/handling-*.test.ts`, matrix in ARCHITECTURE-M2 §11): linear
  bicycle identities ≤ 1 %; skidpad 0.90–1.10 g; 100–0 km/h with ABS 34–42 m; 0–100 km/h 3.6–4.8 s; understeer gradient
  0.5–3.5 °/g at 0.3 g and rising to ≥ 1.5× by 85 % of peak lateral acceleration; ISO 7401 step steer at 100 km/h
  yaw response time 0.10–0.25 s, overshoot ≤ 50 %; left/right mirror symmetry; 240 vs 480 Hz within 2 %.
- [ ] **MD-17**: No universal winner: the per-suspension handling report (roll gradient, understeer gradient, skidpad,
  braking distance, ISO 3888-2 pass speed, ride-street vertical acceleration RMS) is printed by a test; identical tables
  give identical results (control), and the report is reproduced in the 09-04 SUMMARY. If one type wins every metric
  the executor reports it instead of tuning (honesty over narrative).
- [ ] **MD-18**: Safety: one finite check per step; last-good ring buffer (8 × 0.1 s) with automatic restore; a "Reset to
  road" toast after 3 restores in 2 s; a 200 000-step fuzz (random intents, random suspension swaps) stays finite.
- [ ] **MD-19**: Determinism: no transcendental `Math.*` and no non-integer `**` anywhere in `src/sim-core`
  (`tests/arch/det-math.test.ts`); a scripted 60 s drive hashes identically in Node and in Chromium
  (`tests/e2e/09-03-determinism.spec.ts`); Auto goldens unchanged.
- [ ] **MD-20**: Cost: plant step median ≤ 25 µs in Node (printed); no per-step allocation (heap tripwire as M1);
  ≤ 250 draw calls at `high` with every M2 visual on.

### Driving experience (EXP)
- [ ] **MD-21**: Inputs: keyboard by `KeyboardEvent.code` with the held set cleared on blur/visibility change; gamepad
  (standard mapping, triggers as pedals, axial dead zone 0.12, curve exponent 1.6, A = take/return, X = handbrake,
  Y = reset); touch (coarse pointer: left steering slider with spring return, right GAS/BRAKE pads ≥ 48 px). The most
  recently active device wins (1 s hysteresis). Ramps, speed-sensitive steering and reverse logic live in sim-core.
- [ ] **MD-22**: Approachable steering: digital ramps (steer 0→full 0.33 s, back 0.14 s), speed-sensitive lock limited
  to the grip-limited Ackermann angle plus peak slip, but full lock always available when countersteering; optional
  countersteer help fades below 5 m/s. Holding ← at 100 km/h on dry asphalt does not spin the car with aids on.
- [ ] **MD-23**: Driving camera: chase target predicted from velocity direction, yaw rate and commanded steer; world-up;
  stays behind in reverse; 0.8 s target cross-fade on mode change; hard cut only on reset or a cut; no shake; eye kept
  ≥ 0.7 m above the GroundWorld; reduced motion turns blends into cuts.
- [ ] **MD-24**: HUD: speed and gear in the drive pill; the telemetry card shows its M1 content in every mode and records
  its history only in Auto; an "approximate" badge appears while the plant is outside its validated domain.

### World (WORLD)
- [ ] **MD-30**: One analytic GroundWorld (loop corridor + world zones + terrain) answers height, base plane and surface
  per wheel for physics, and the terrain mesh, zone meshes, markings and wet look are built from the same function
  (node test: rendered vertex heights equal `terrainHeight`/`sample().h` within 1 mm).
- [ ] **MD-31**: Proving-ground annex north of the loop (field x −260…300 m, y 60…440 m) reached by two spurs, with an
  apron, a ride street (washboard, cobbles, sleepers, single-wheel steps, twist, pothole), a dynamics pad (40 m steering
  circle, 25 m slalom, ISO 3888-2 lane) and a braking platform (dry, wet, split-μ, wet ceramic lanes); coordinates in
  ARCHITECTURE-M2 §8.
- [ ] **MD-32**: Stations are experiments ("try this"), never challenges: name, caption and experiment line without
  digits; tyre-grip stations are labelled "tyre grip demonstration, not a suspension lesson".
- [ ] **MD-33**: Soft boundary: grass outside paved areas (lower grip, higher rolling resistance); leaving the drivable
  region for 1.5 s (or by 30 m) fades and resets the car; no hard walls, no collisions.
- [ ] **MD-34**: Station list in the drive pill and `?spawn=<station>` place the car at rest at a station.
- [ ] **MD-35**: Disabling the `proving-ground` feature (`?features=-proving-ground`) removes the annex from physics and
  rendering together; the loop and terrain stay drivable.

### Teaching (TEACH)
- [ ] **MD-40**: Friction rings: one thin ring on the road under each tyre, radius ∝ the model's available force,
  a dot for the force used, the accent colour only past the limit; in Auto it shows the demand estimate; labelled
  "model"; one draw call; off by default in Auto, on in Manual, toggle in the pill.
- [ ] **MD-41**: Skid marks appear only past the friction limit (slip beyond peak), fade with age, reset on cuts;
  ≤ 4 draw calls.
- [ ] **MD-42**: One-line coach on detected events (axle slide with/without lift-off, lock-up, wheelspin, aid
  intervention, station entry): templates without digits, values filled from telemetry, ≤ 1 line per 12 s, the same
  event type at most 3 times per session; M1 insights are quiet outside Auto.
- [ ] **MD-43**: Moment replay: within 10 s after a detected event one key (Q) replays the last 4 s at 0.25× by exact
  re-simulation, then hands control back where it was.
- [ ] **MD-44**: Same line, different suspension: "Compare" (G or pill) takes the last ≤ 30 s of driving, runs the SAME
  disclosed autopilot along the visitor's line and speed with their suspension and with another, replays the visitor's
  run with the other suspension as a translucent ghost, and shows distance-aligned steer, front/rear slip and roll
  traces of the two autopilot runs; the caption names the driver model.
- [ ] **MD-45**: Audio (still muted by default): engine pitch and load from real rpm/throttle in Manual, a tyre cue from
  grip use 0.75 labelled as a model cue; gamepad dual-rumble where supported (feature-detected, toggle, off in Auto).

### Cloudflare (CF)
- [ ] **MD-50**: Share a run: runs ≤ 60 s encode into the URL fragment (`#r=`, deflate-raw + base64url, versioned header,
  CRC keyframes); opening the link replays it; a replay recorded with another model version plays with a visible
  "recorded with an older model" note; a mismatched vehicle/track/world is refused politely.
- [ ] **MD-51**: Longer runs are saved to D1 (`POST /api/replays`, ≤ 64 KB, 30-day expiry, purge on write, Turnstile token,
  5 saves/min per address and 2 000/day in the `Limiter` DO) and opened with `#rid=<id>`.
- [ ] **MD-52**: Phone as controller on a presenter screen: a driver QR (`#d=` key) pairs one phone (newest wins); input
  frames go only to screen sockets with per-role rate buckets; touch slider default, tilt optional with 2-tap
  calibration; failsafe: no frame for 250 ms → inputs decay to neutral over 300 ms, 1 s → Returning, banner on the screen.
- [ ] **MD-53**: Race Engineer for driving: while driving the request carries a `drive` block (inputs, detected event
  label from sim-core); the worker adds driving fact cards, the model explains only the detected event, the number check
  covers the drive values, and the rule-based fallback has a sentence for every detected event kind.
- [ ] **MD-54**: Anonymous analytics gain `drive-session` (whole seconds) and `station-visit`; no identifiers.
- [ ] **MD-55** [S]: Live ghosts of other visitors (10 Hz world-space positions through the room, aggregated, translucent,
  no collisions, no ranking).
- [ ] **MD-56** [S]: Crowd insight per station from Analytics Engine (min-n 30, labelled "how visitors drove this model").

### Honesty (HON-M2)
- [ ] **MD-60**: Handling inputs are labelled "representative / approximate model" wherever surfaced; no manufacturer
  performance claims; aids, the ghost's driver model and surface grip are disclosed; outside the validated domain the
  "approximate" badge is on.
- [ ] **MD-61**: All new copy (stations, coach templates, pill, captions) passes the extended
  `tests/arch/content-copy.test.ts` (no digits); every number shown comes from the running simulation.
- [ ] **MD-62**: Lifted code carries its copyright/licence header and appears in CREDITS.md and the credits panel
  (stdlib-js fdlibm kernels Apache-2.0 + Sun notice, Jolt MIT, PythonRobotics MIT, icurtis1/raycast-vehicle MIT,
  folio-2025 MIT, GEVP MIT if used; LICENSE re-checked at lift time).

### Event readiness (DEMO-M2)
- [ ] **MD-70**: `?features=-<id>` boots clean for every M2 feature; the event runbook covers Manual Drive at a booth
  (idle return, phone driver, offline fallback: Manual works with the network cut).

## Explicit non-goals (M2)
| Not in M2 | Why |
|---|---|
| Lap timer, scores, medals, leaderboards, progression, racing other cars | Product rule: experiments, not competition |
| Motorcycle Manual Drive | v1.5 after the car feels right (SUMMARY); bike stays Auto-only |
| Physics engine (Rapier/Jolt/cannon/ammo) | One vertical spring per wheel would erase the suspension differences |
| Collisions with barriers, rigid props, damage, rollover | Cones and signs are cosmetic; soft boundary + reset instead |
| Manual gearbox, clutch, launch control, turbo lag, brake fade, tyre temperature/wear, aligning-torque model | Not needed to show suspension; adds unvalidated claims |
| Steering wheels with force feedback / WebHID, pointer-lock steering | Untestable here / hostile to a live demo |
| Weather, traffic, AI opponents, day/night | Out of scope |
| Hill / grade test track | Not suspension-relevant enough for its scope (kept as an open question) |
| Cloudflare Access on presenter pages | Needs a custom zone (not on workers.dev) |
| R2, Stream, Browser Run share images, Vectorize/AI Search, Queues, Workflows, WebRTC/SFU, WebTransport | No genuine benefit (SUMMARY) |
| Open-loop "same inputs" A/B over whole runs | Diverges; only the closed-loop line comparison ships |

## Traceability
| Requirement | Phase / plan |
|---|---|
| MD-01, MD-02 | 08-01, 08-02 (golden), every phase gate |
| MD-03 | 08-03 |
| MD-04, MD-08 | 08-03 (keyboard, pill), 10-04 (gamepad/touch) |
| MD-05 | 08-02, 09-04 |
| MD-06, MD-07 | 10-01 (sim), 10-04 (UX) |
| MD-09, MD-10 | 08-01 (kernel), 08-02, 08-03 |
| MD-11, MD-12 | 08-02, 09-01, 09-04 |
| MD-13 | 09-01, 09-04 |
| MD-14, MD-15 | 09-02, 09-04, 09-05 (toggles/lamps) |
| MD-16, MD-17, MD-18, MD-20 | 09-04 |
| MD-19 | 08-02 (det kernels), 09-03 (sweep, browser hash) |
| MD-21, MD-22 | 08-02 (conditioning), 08-03, 10-04 |
| MD-23 | 08-04 |
| MD-24 | 08-03, 09-05 |
| MD-30, MD-31, MD-32, MD-33, MD-34, MD-35 | 08-02 (loop/terrain ground), 10-02, 10-03, 10-04 |
| MD-40, MD-41 | 11-01 (car-model Auto fields: 08-02) |
| MD-42, MD-45 | 11-02 (rumble: 10-04) |
| MD-43, MD-50 | 11-03 |
| MD-44 | 11-04 |
| MD-51 | 12-01, 12-05 |
| MD-52 | 12-02, 12-04 |
| MD-53, MD-54 | 12-03 |
| MD-55 [S] | 12-07 |
| MD-56 [S] | 12-06 |
| MD-60, MD-61, MD-62, MD-70 | every plan; audited by 13-01 |

**Coverage:** 47 requirements (2 stretch); all mapped.

---
*Defined 2026-11-21 by the M2 planning architect.*
