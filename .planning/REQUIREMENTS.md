# Requirements: Suspension Lab

**Defined:** 2026-11-20   **Core Value:** Show, don't tell: on the same lap and the same bump, the visitor sees that
suspension geometry changes what the wheel does. Every visible difference is computed, never animated or invented.

Conventions: IDs are `CATEGORY-NN`. Each requirement is user-observable or mechanically checkable. "Stretch" items are
in v1 scope but may be cut at a phase boundary without breaking the product (see ROADMAP.md).

## v1 Requirements

### Architecture (ARCH)
- [ ] **ARCH-01**: Every feature lives in `src/features/<id>/` as a `FeatureModule` and is registered by exactly one line in `src/app/features.ts`; booting with `?features=-<id>` for any feature except `renderer` produces no console errors.
- [ ] **ARCH-02**: Layering is enforced by `npm run lint:deps` (dependency-cruiser): sim-core imports no npm packages and no client contracts; features never import other features; kernel never imports features; worker never imports kernel/features/ui.
- [ ] **ARCH-03**: Simulation advances in fixed 240 Hz steps with render interpolation; behaviour is independent of display frame rate (tested with random frame dts).
- [ ] **ARCH-04**: Suspensions, vehicles, tracks and their visuals are registry contributions; no code outside content files branches on a content id (grep test).
- [ ] **ARCH-05**: URL flags (`features, vehicle, suspension, view, quality, t, paused, amp, clock, attract, room, screen, debug, e2e`) configure the app at boot.
- [ ] **ARCH-06**: In `?e2e=1` or `?debug=1`, `window.__app` exposes ready state, store access, telemetry snapshot, render stats, feature list and errors for automated tests.

### Simulation core (SIM)
- [ ] **SIM-01**: The proving loop (12 sections, ~1.5 km) is built from line/clothoid/arc primitives and closes to < 1 mm in position and < 1e-6 rad in heading.
- [ ] **SIM-02**: One analytic `roadHeight(s, l)` is the single source for both physics and the track mesh, including bank, swell, ISO 8608 roughness and the features: chirp washboard, one-sided bump, pothole, kerb strike, pave, humps, crest/dip.
- [ ] **SIM-03**: A friction-limited forward/backward speed profile drives the car; it is identical for every suspension type of a vehicle; car lap time is 65-85 s.
- [ ] **SIM-04**: `stateAt(lapTime)` is a pure function, so every device shows the car at the same track position for the same server time.
- [ ] **SIM-05**: sim-core is deterministic: no `Math.random`, `Date`, `performance`, DOM or three imports; a golden hash of 10 s of simulation is stable.

### Kinematics (KIN)
- [ ] **KIN-01**: A generic Levenberg-Marquardt rigid-upright solver driven by declarative link constraints reproduces the Chrono-derived reference values (ARCHITECTURE.md §7.3) within tolerance.
- [ ] **KIN-02**: The solver derives camber, toe, contact patch, track change, motion ratio, instant centre, roll-centre height, KPI, caster, scrub, trail and anti-dive/anti-squat, and precomputes a travel x rack lookup table used at runtime.
- [ ] **KIN-03**: Three car suspension definitions (MacPherson, double wishbone, multi-link), seeded from Project Chrono (BSD-3) sets and fitted to the GT car, pass the tuning gates in ARCHITECTURE.md §7.4 (roll-centre and camber-gain orderings, bump steer, scrub, KPI).
- [ ] **KIN-04**: All three car types share the vehicle's spring/damper/anti-roll-bar targets; only geometry and declared extras (damper friction, unsprung mass delta) differ.

### Ride dynamics (RIDE)
- [ ] **RIDE-01**: A 7-DOF ride model (heave, roll, pitch, four wheel hops) with asymmetric dampers, bump/rebound stops and tyre lift-off runs at 240 Hz with semi-implicit Euler.
- [ ] **RIDE-02**: Lateral and longitudinal load transfer split into geometric (via the active suspension's roll-centre heights and anti-pitch) and elastic parts; steady-state load sums match the closed-form check within 2 %.
- [ ] **RIDE-03**: Per-wheel load and a model grip-use estimate (simplified Magic Formula with load sensitivity and camber) are available every frame; body and wheel-hop modal frequencies fall in the documented ranges.
- [ ] **RIDE-04**: Switching suspension takes effect within one fixed step while the car keeps driving; path position is continuous.

### World and car visuals (VIS)
- [ ] **VIS-01**: The track mesh (asphalt, kerbs, markings, runoff, terrain, DLC cones, start line) is generated from the built track and its `roadHeight`, so wheels sit on what is drawn.
- [ ] **VIS-02**: Image-based lighting from CC0 HDRIs, a car-following sun shadow, contact shadow, fog, tone mapping and a restrained post stack (N8AO half-res, bloom, vignette, SMAA) give a premium look at the `high` tier.
- [ ] **VIS-03**: The DB11 (CC BY 4.0) is loaded with per-corner hub groups, re-materialed (clearcoat paint, glass, rubber), badges and stock suspension meshes hidden, and its wheels spin, steer and travel from telemetry.
- [ ] **VIS-04**: Suspension parts are generated procedurally from solver points every frame: arms, links, upright, telescoping damper, constant-wire-radius spring, disc and caliper, anti-roll bar, tie rod; the role colour is identical across all types.
- [ ] **VIS-05**: X-ray ghosts the body with one key or tap so the linkage is readable through it; the transition is smooth (no shader hitch).

### Cameras (CAM)
- [ ] **CAM-01**: Three views — Follow (chase with look-ahead), Explore (free orbit around the moving car), Close-up (one corner, x-ray on) — with blended transitions <= 1.4 s and frame-rate-independent damping.
- [ ] **CAM-02**: The camera service plays scripted director shots (chase, orbit, close-up, trackside, overhead, front-view) used by attract mode and presenter cues.

### Interface (UI)
- [ ] **UI-01**: The HUD has exactly: vehicle tag, suspension segmented control (one click to swap), view control, vehicle-class toggle, fullscreen; keyboard: 1/2/3 suspension, F/E/C view, X x-ray, V vehicle class, Space pause, S slow motion, A amplification, H hide HUD, ? shortcuts.
- [ ] **UI-02**: A telemetry panel shows a g-g diagram, per-corner camber/travel/load gauges (4 for car, 2 for motorcycle) and one sparkline with the previous suspension as a ghost trace.
- [ ] **UI-03**: A loading overlay shows weighted progress and hides only after shaders are compiled and the first frame is rendered.
- [ ] **UI-04**: The design system (tokens from research 14: bg #07080A, accent #7CF0D4, warn #FFB454; Geist Sans + Geist Mono self-hosted) is used by every UI module.

### Teaching (EDU)
- [ ] **EDU-01**: Contextual one-line insights tied to track sections and sim events quote live values, are rate-limited (max one per 8 s) and never overlap camera transitions.
- [ ] **EDU-02**: After a suspension switch a delta chip shows a relevant metric old -> new, both values measured live.
- [ ] **EDU-03**: The engineer overlay shows live roll-centre and instant-centre construction lines, the ghost rest pose, a camber-vs-travel trace with a moving dot (previous type faint) and per-wheel load arrows/contact patches.
- [ ] **EDU-04**: Display amplification is one global factor (x2.5) with a persistent on-screen label; readouts always show true values; one tap/key returns to true scale.
- [ ] **EDU-05**: Pause and slow motion (0.25x) are one key/tap away; slow motion leaves the shared clock and "Live" rejoins it.
- [ ] **EDU-06**: Tradeoff bars per suspension: computed metrics (camber control, bump steer, roll-centre stability) plus qualitative tendencies (cost, packaging) with no numeric scores.
- [ ] **EDU-07**: In close-up, part labels (dot + leader + two words) appear for the visible corner on demand, max 8.

### Attract mode (ATR)
- [ ] **ATR-01**: After 30 s without input (or `?attract=1`) an auto-director loops a ~60 s storyboard (hero chase, x-ray dolly, slow-mo roll, construction lines, suspension swap, motorcycle if enabled); any input exits with a fade.

### Motorcycle (MOTO)
- [ ] **MOTO-01**: A 4-DOF in-plane ride model plus lean from curvature (with tyre-crown correction) and an inverse countersteer steering animation drive the bike on the same path machinery.
- [ ] **MOTO-02**: Planar kinematics cover telescopic forks (RSU/USD), Telelever, swingarm with direct shocks and swingarm with rising-rate linkage; telescopic pro-dive vs Telelever anti-dive sign is unit-tested.
- [ ] **MOTO-03**: Three presets ship: Classic (RSU fork + twin shock), Modern sport (USD fork + linkage monoshock), Telelever + single-sided swingarm.
- [ ] **MOTO-04**: A procedural cafe-racer (no licensed model) with fork, swingarm, shocks and linkage parts in the shared colour language.
- [ ] **MOTO-05**: The vehicle-class toggle swaps car <-> motorcycle in one click; HUD, insights, overlays and cameras work for two corners.

### Cloudflare edge (EDGE)
- [ ] **EDGE-01**: Live Lab: every visitor joins the public room; the HUD shows how many people are watching and the live distribution of suspension picks; the lap clock is synchronised to server time.
- [ ] **EDGE-02**: Presenter remote: `/?screen=1` creates a private room and shows its code and a QR; a phone with the host key controls vehicle, suspension, view, x-ray, slow motion, amplification, section jump and attract on the big screen.
- [ ] **EDGE-03**: Audience poll: the host opens a poll (<= 4 options); audience phones vote via `/r/<CODE>`; the screen shows live bars; one vote per client per poll.
- [ ] **EDGE-04**: All API and socket inputs are validated and rate-limited (message size, messages/s, room creation, engineer requests).

### AI Race Engineer (AI)
- [ ] **AI-01**: A minimal panel lets the visitor ask a question (or "Why did it do that?"); the answer (1-3 sentences) is grounded in live telemetry plus curated fact cards and produced by Workers AI `@cf/google/gemma-4-26b-a4b-it`.
- [ ] **AI-02**: The model can trigger at most two whitelisted, validated client-side actions (switch suspension, set view, slow motion, highlight component, jump to section).
- [ ] **AI-03**: Any number in the answer that is not present in the telemetry payload causes the rule-based fallback answer instead.
- [ ] **AI-04**: Over-quota, timeout or model errors produce the rule-based fallback, marked as such in the UI.

### Observability (OBS)
- [ ] **OBS-01**: Anonymous events (suspension picked, view changed, engineer asked, session fps/quality) are written to Analytics Engine; no identifiers or IPs are stored.

### Deployment (DEP)
- [ ] **DEP-01**: The app is deployed as Worker `suspension-lab` with Static Assets at https://suspension-lab.zh-a16.workers.dev via `wrangler deploy` using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`; `/api/health` and `/api/time` respond.
- [ ] **DEP-02**: Every phase ends with a deploy and a passing live smoke test (`npm run smoke:live`).
- [ ] **DEP-03**: Content-hashed assets are served `immutable`; security headers and CSP are set (Report-Only until phase 7, then enforced).
- [ ] **DEP-04**: Every shipped file is < 24 MiB; initial download (JS + car + HDRI + textures) stays under 12 MB.

### Performance (PERF)
- [ ] **PERF-01**: >= 60 fps at 1440p on a recent discrete GPU at `high`; >= 45 fps on a recent integrated GPU at `medium` (adaptive pixel ratio allowed).
- [ ] **PERF-02**: <= 250 draw calls in any view; `step()` and `sample()` allocate nothing (tested).
- [ ] **PERF-03**: Quality tiers low/medium/high with an adaptive pixel-ratio governor; `?quality=` overrides.
- [ ] **PERF-04**: All programs are compiled behind the loading overlay; the first suspension swap, x-ray toggle and vehicle switch cause no frame > 50 ms on the reference desktop.

### Honesty (HON)
- [ ] **HON-01**: Every number displayed comes from the running simulation; content copy contains no digits (test).
- [ ] **HON-02**: Vehicles are named generically ("GT coupe", "Cafe racer") with "Representative parameters"; no manufacturer performance claims; badges hidden.
- [ ] **HON-03**: Research estimates are used only as model parameters and are never presented as measured data.

### Credits (CRED)
- [ ] **CRED-01**: An in-app credits panel generated from the asset manifest attributions plus code/data credits, mirrored in `CREDITS.md`, includes the exact CC BY text for the DB11 and the Project Chrono BSD-3 notice; the build fails if any asset lacks an attribution.

### Accessibility (A11Y)
- [ ] **A11Y-01**: All controls are keyboard operable with visible focus; segmented controls are radio groups; captions go to an `aria-live` region; `prefers-reduced-motion` removes camera fly-throughs and trails; text contrast >= 4.5:1 on glass.

### Event readiness (DEMO)
- [ ] **DEMO-01**: After initial load the solo experience needs no network; an event runbook covers kiosk fullscreen, presenter setup, offline fallback and the Workers Paid decision; a 300-socket room load test passes.

## v2 Requirements (deferred)
- Split-screen A/B of two suspensions on the same bump (wipe divider).
- Time-scrub replay of the last 10 s; predict-then-reveal prompts; guided six-beat tour.
- Crowd all-time statistics (Analytics Engine SQL read with a secret token, cached).
- Share cards / OG images; saved setups.
- Room sharding beyond ~1,500 concurrent viewers.
- KTX2/Basis textures, progressive LOD car, HDR gainmaps.
- Voice for the Race Engineer (speechSynthesis / aura).
- Additional tracks, rain/wet surface mode, more vehicle classes.
- Mobile-optimised 3D experience.
- Engine/tyre audio with RPM crossfade (if not delivered as phase 7 stretch).

## Out of Scope
| Feature | Reason |
|---|---|
| Free driving / physics engine | Breaks determinism, shared-clock sync and the controlled comparison |
| WebGPU / TSL pipeline | Loses postprocessing/N8AO and headless testability; not needed for the look |
| React / UI framework | Six components at 30 Hz; vanilla is smaller and faster |
| R2, D1, KV, Vectorize, AI Search, Browser Run, Queues, Workflows, Agents SDK | No genuine benefit here; R2 not enabled on the account |
| Turnstile | Only if abuse appears; rate limits + quota fallback first |
| Hardpoint editing / tuning sliders | Invites unvalidated claims; core value is the honest comparison |
| User accounts, leaderboards, persistence | Not needed for the core value |
| Licensed manufacturer models/data, brand claims | Licensing and honesty |
| Shared cursors / annotations | Moderation risk on a public screen; DO fan-out cost |
| GPL/LGPL/AGPL code reuse | Licence; algorithms are reimplemented |

## Traceability
| Requirement | Phase | Status |
|---|---|---|
| ARCH-01 | 1 | Pending |
| ARCH-02 | 1 | Pending |
| ARCH-03 | 1 | Pending |
| ARCH-04 | 2 | Pending |
| ARCH-05 | 1 | Pending |
| ARCH-06 | 1 | Pending |
| SIM-01 | 2 | Pending |
| SIM-02 | 2 | Pending |
| SIM-03 | 2 | Pending |
| SIM-04 | 2 | Pending |
| SIM-05 | 2 | Pending |
| KIN-01 | 2 | Pending |
| KIN-02 | 2 | Pending |
| KIN-03 | 2 | Pending |
| KIN-04 | 2 | Pending |
| RIDE-01 | 2 | Pending |
| RIDE-02 | 2 | Pending |
| RIDE-03 | 2 | Pending |
| RIDE-04 | 2 | Pending |
| VIS-01 | 3 | Pending |
| VIS-02 | 3 | Pending |
| VIS-03 | 3 | Pending |
| VIS-04 | 3 | Pending |
| VIS-05 | 3 | Pending |
| CAM-01 | 4 | Pending |
| CAM-02 | 4 | Pending |
| UI-01 | 4 | Pending |
| UI-02 | 4 | Pending |
| UI-03 | 4 | Pending |
| UI-04 | 1 (tokens), 4 | Pending |
| EDU-01 | 4 | Pending |
| EDU-02 | 4 | Pending |
| EDU-03 | 4 | Pending |
| EDU-04 | 4 | Pending |
| EDU-05 | 4 | Pending |
| EDU-06 | 4 | Pending |
| EDU-07 | 4 | Pending |
| ATR-01 | 4 | Pending |
| MOTO-01 | 5 | Pending |
| MOTO-02 | 5 | Pending |
| MOTO-03 | 5 | Pending |
| MOTO-04 | 5 | Pending |
| MOTO-05 | 5 | Pending |
| EDGE-01 | 6 | Pending |
| EDGE-02 | 6 | Pending |
| EDGE-03 | 6 | Pending |
| EDGE-04 | 6 | Pending |
| AI-01 | 6 | Pending |
| AI-02 | 6 | Pending |
| AI-03 | 6 | Pending |
| AI-04 | 6 | Pending |
| OBS-01 | 6 | Pending |
| DEP-01 | 1 | Pending |
| DEP-02 | 1-7 (every phase) | Pending |
| DEP-03 | 1, 7 | Pending |
| DEP-04 | 1, 7 | Pending |
| PERF-01 | 7 | Pending |
| PERF-02 | 2 (sim), 7 (render) | Pending |
| PERF-03 | 3, 7 | Pending |
| PERF-04 | 7 | Pending |
| HON-01 | 2, 4 | Pending |
| HON-02 | 2, 3 | Pending |
| HON-03 | 4, 7 | Pending |
| CRED-01 | 1 (manifest), 4 (panel), 7 (audit) | Pending |
| A11Y-01 | 4, 7 | Pending |
| DEMO-01 | 7 | Pending |

**Coverage:** v1 total 66 requirements; mapped 66; unmapped 0.

---
*Requirements defined: 2026-11-20*  *Last updated: 2026-11-20 after roadmap creation*
