# Research synthesis — orchestrator decisions

23 research files (01–23) in this folder. This file records the decisions taken from them.
Where research files disagree, THIS file wins. Numbers tagged [E]/[U] in research are estimates:
the sim must compute what it displays; never present estimates as engineering data.

## Product shape
- Suspension Lab: self-driving car on a purpose-built ~1.5 km test loop; orbit / follow / suspension close-up
  views; one-click swap between MacPherson strut, double wishbone, multi-link; second vehicle class: cafe-racer
  motorcycle with 3 suspension presets. Attract mode (auto-director) so it is satisfying untouched.
- Cloudflare blend ("only possible on the edge"): Live Lab (everyone sees the same lap via server-time sync,
  live distribution of what the crowd is running), Presenter remote (phone controls the big screen via room
  code/QR), AI Race Engineer grounded in live telemetry, anonymous crowd stats.

## Stack (pinned)
- Vite 8 + TypeScript (strict), three@0.187.x, **WebGLRenderer + GLSL** (not WebGPU/TSL: lets us use
  pmndrs `postprocessing` 6.39.x + `n8ao`, and is testable in headless Chromium here). Custom shaders via
  ShaderMaterial / onBeforeCompile.
- `camera-controls` 3.x, `nanostores` (discrete state) + `mitt` (events), vanilla DOM/CSS UI (no React).
- Fonts via Fontsource: Geist Sans + Geist Mono. Palette from 14-ui-design.md (bg #07080A, mint accent
  #7CF0D4, amber #FFB454 for limits).
- Tests: vitest for sim-core; Playwright smoke test (headless WebGL works here).
- Cloudflare: Workers + Static Assets (`@cloudflare/vite-plugin`, wrangler 4, `wrangler.jsonc`), Hono API.

## Simulation (from 02, 03, 05, 11)
- No physics engine. Pure `sim-core` (no three imports, deterministic, unit-tested):
  1. Track = line/clothoid/arc primitives (curvature-continuous), the 12-segment 1508 m loop in 11; analytic
     `roadHeight(s, lateral)` (macro elevation + bumps/washboard/pavé/kerbs) — no raycasts.
  2. Speed profile = forward/backward friction-limited pass over curvature (own implementation; OpenLAP/TUM are
     GPL/LGPL — algorithm only).
  3. Vehicle state is a pure function of time along the lap where possible (enables server-time sync);
     ride dynamics = 7-DOF sprung/unsprung model, fixed step **240 Hz**, semi-implicit Euler, render interpolation.
  4. Kinematics = own Newton solver over 6 pose DOF with link-length constraints (03). Hardpoints start from
     Project Chrono (BSD-3) sets, rescaled to a DB11-sized sports car. Solver output (camber, toe, roll-centre
     height, motion ratio, track change vs travel) is precomputed into per-type lookup curves that feed the ride
     model (roll-centre → geometric load transfer; motion ratio → wheel rate; camber → grip indicator).
  5. Same springs/dampers/ARB targets (ride frequency) across types so differences come from GEOMETRY, plus
     honest per-type extras (strut stiction, unsprung mass). No type is universally best; the tradeoff table in
     04 must be reflected (strut: cost/packaging/simplicity; DW: camber control; ML: toe/compliance tuning).
- AGPL open-kinematics is NOT to be copied or vendored.
- Motorcycle (08): 4-DOF in-plane model + lean = f(v²κ/g); presets: conventional fork + twin shock (T120
  numbers), USD fork + linkage monoshock, Telelever + single-sided swingarm. Verify fork pro-dive sign in tests.

## Visuals (06, 07, 09, 10, 12, 13, 21, 22)
- Car: Aston Martin DB11 by Black Snow, CC BY 4.0 — `assets-src/car/aston-martin-db11.glb` (meshopt-compressed,
  ~113k tris, 53 flat materials, per-corner wheel/tyre/disc/caliper nodes are siblings under RootNode → regroup
  into hub groups at load; its own stand-in suspension meshes get hidden). Re-material in code (clearcoat paint,
  glass, rubber). Attribution must appear in an in-app credits panel and in CREDITS.md.
- Suspension parts: fully procedural from solver hardpoints (22): tubes between points, A-arms, convex upright,
  telescoping damper, constant-wire-radius spring shader, disc/caliper, ARB, tie rod. Colour convention kept
  identical across all types. AxleLab (MIT) helpers may be adapted with attribution.
- Motorcycle: procedural Thruxton-style cafe racer (no licensed downloadable Triumph exists).
- Environment: Poly Haven CC0 HDRIs in `assets-src/hdri` (derelict_airfield_01 = default track, evening_road_01
  alt, ferndale_studio_03 = inspection), CC0 textures in `assets-src/textures`. Kerbs/cones/markings procedural.
- Teaching devices (21): x-ray body, colour-coded links, ghost static pose, live roll-centre/instant-centre
  construction lines, camber trace with moving dot, per-corner load/travel HUD, contextual one-line insights
  tied to track sections, slow-mo. Any visual amplification is labelled on screen, readouts show true values,
  one tap returns to true scale.
- Cameras (13): chase w/ look-ahead, free orbit on the moving car (camera-controls), suspension close-up,
  auto-director for attract mode; pose blending between modes.
- Post: N8AO (half res) → bloom/vignette/tone map (AgX or Neutral) → SMAA; adaptive DPR.

## Cloudflare (15–19) — account facts verified by orchestrator
- Token works for Workers scripts, D1, KV, Workers AI. **R2 is NOT enabled on the account** → do not use R2;
  all assets stay < 25 MiB in Workers Static Assets with immutable `_headers`.
- workers.dev subdomain: `zh-a16`. Worker name: `suspension-lab`.
- USE: Workers + Static Assets, Hono API, Durable Objects (SQLite, WebSocket hibernation) for rooms
  (presence + presenter remote + poll), Workers AI `@cf/google/gemma-4-26b-a4b-it` (verified responding;
  `chat_template_kwargs.enable_thinking=false`) for the Race Engineer with curated fact cards + client
  telemetry + client-executed tools, Rate Limiting binding on AI/room endpoints, Analytics Engine for
  anonymous picks, KV for global counters/config only if needed, `/api/time` for clock sync.
- SKIP: R2, D1 (share links are URL params), Vectorize/AI Search, Browser Run, Stream, Queues, Workflows,
  Turnstile (unless abuse appears), Agents SDK.
- An ungrounded test answer from the model about strut camber was mechanically wrong → grounding via fact
  cards is mandatory; AI must quote only numbers present in the telemetry payload.

## Process
- GSD structure (01): PROJECT/REQUIREMENTS/ROADMAP/STATE, per-phase PLAN → execute → SUMMARY → verify,
  atomic commits. Planning = Opus, coding = Opus executors, research = Sonnet.
- Ponytail coding discipline (01, verbatim ruleset there) is included in every executor prompt: smallest
  complete change, no speculative abstraction — while honouring the module boundaries in 23.
- Architecture (23): `sim-core` → `kernel` → `features/*`; features never import each other; registries for
  suspension/vehicle/track; URL feature flags; every module init/update/dispose.
