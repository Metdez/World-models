# Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-20)
**Core value:** Show, don't tell: on the same lap and the same bump, the visitor sees that suspension geometry changes what the wheel does; every visible difference is computed.
**Current focus:** Milestone 2 (Manual Drive) closed by 13-01 on 2026-11-21: deployed, audited; real-hardware checks open.
**Binding contract:** .planning/ARCHITECTURE.md + .planning/ARCHITECTURE-M2.md (contract blocks verbatim; §17 reality notes)

## Current Position
M1: phases 1–7 built and deployed; plan 07-04 (matrix, runbook, final verification) was never executed as such — its
matrix and runbook were delivered by 13-01 (`tests/e2e/13-01-matrix.spec.ts`, `docs/EVENT-RUNBOOK.md`).
M2: phases 8–13 complete (25 plans incl. 08-05 and 11-05; stretch 12-06 and 12-07 deliberately not built).
Status: production at https://suspension-lab.zh-a16.workers.dev runs the 13-01 final HEAD (see `/api/health`).
Last activity: 2026-11-21 — 13-01 matrix, audits, runbook, final deploy (per-requirement table in
`.planning/phases/13-audit/13-01-AUDIT.md`).

## Performance Metrics
Velocity: plans completed 0; average duration —; total —
| Phase | Plans | Completed | Avg duration |
|---|---|---|---|
| 1 | 4 | 0 | — |
| 2 | 4 | 0 | — |
| 3 | 4 | 0 | — |
| 4 | 4 | 0 | — |
| 5 | 3 | 0 | — |
| 6 | 4 | 0 | — |
| 7 | 4 | 0 | — |
Recent trend: —

## Accumulated Context

### Decisions (full table in PROJECT.md Key Decisions; contract in ARCHITECTURE.md)
- Kinematic car on a precomputed path + 7-DOF ride model; no physics engine.
- Generic LM solver with declarative constraints; Chrono BSD-3 seeds; tuning gates ARCHITECTURE §7.4.
- One suspension selection applies to both axles; springs/dampers/ARB shared across types.
- Kernel + FeatureModule (`contribute`/`init`/`update`/`dispose`) + registries; nanostores + mitt; preallocated TelemetryFrame.
- All 21 features stubbed and registered in phase 1; `src/app/features.ts` never edited afterwards.
- Sim frame Z-up (ISO 8855); three.js Y-up; single mapping `simToThree`.
- Amplification applied in `sim.sample()` to POSE fields only.
- All Cloudflare bindings declared in phase 1 `wrangler.jsonc`; all npm deps installed in phase 1.
- AI engineer non-streaming + server-side number check + rule-based fallback; no AI SDK/agents package.
- Analytics Engine write-only; crowd distribution from the room DO; public room `LIVE`.
- v1 textures ship as 1k JPG (no `toktx`); typescript ~5.9 (not 7.x).

### Pending Todos
- Owner: confirm Workers Paid plan before the live event (Free plan hard caps: 100k Worker requests/day, 10k AI neurons/day, DO 100k rows written/day).
- Owner (optional): custom domain for production (enables zone features); not required for v1.

### Blockers/Concerns (planning-time list of 2026-11-20, kept as history: resolved during M1, see the phase summaries; Playwright and Chromium are pre-installed, never `playwright install`)
- Playwright needs `npx playwright install chromium` (network) in 01-01; no browsers are cached in the container today.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` must be present in the executor environment for 01-04 and every phase gate.
- Rate Limiting binding availability on this account/plan is unverified — the first deploy (01-04) tells; fallback is an in-DO/in-memory token bucket.
- Workers AI tool-call response shape for gemma-4 is unverified — 06-02 task 1 records a real response before parsing code is written.
- DB11 dimensions (track looks wide in research 06: wheel centres at ±0.96 m) — measured by `db11-fit.test.ts` in 02-02; suspension fits follow the measured values.
- Provenance of `assets-src/audio/skid.ogg` and `impact.ogg` is undocumented in research — 01-03 must verify or remove them (build fails without attribution).
- three@0.187 + postprocessing 6.39 + n8ao 2.1 compatibility to be confirmed at install (01-01); pin exact versions.

## Deferred Items
| Category | Item | Status | Deferred At |
|---|---|---|---|
| v2 | Split-screen A/B, time-scrub replay, guided tour, predict-then-reveal | Deferred | Roadmap |
| v2 | Crowd all-time stats (AE SQL read), share cards/OG images | Deferred | Roadmap |
| v2 | KTX2 textures, progressive LOD car, HDR gainmaps | Deferred | Roadmap |
| v2 | Room sharding > 1.5k viewers; voice; extra tracks/vehicles; mobile-optimised 3D | Deferred | Roadmap |

## Session Continuity
Last session: 2026-11-20 — roadmapper produced PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, ARCHITECTURE.md
Stopped at: Ready to plan Phase 1 (`/gsd-plan-phase 1`)
Resume file: None

## Milestone 2 — Manual Drive (planned 2026-11-21)
**Docs:** `.planning/REQUIREMENTS-M2.md` (47 requirements, 2 stretch) · `.planning/ARCHITECTURE-M2.md` (binding addendum:
contract blocks C1–C11, F1, W1–W2; plant equations; annex coordinates) · `.planning/ROADMAP-M2.md` (phases 8–13,
25 plans incl. 2 stretch) · decisions in `.planning/research/m2/SUMMARY.md`.
**Position:** Phase 8 ready to plan once M1 phase 7 is complete and `npm run check` is green.
**Start gate:** 08-01 first compares the SHA-256 prefixes of the frozen files listed in ROADMAP-M2 (derived from the
tree at planning time); any difference (e.g. a late 07-02 contract edit) → R4, the architect regenerates the blocks.

| Phase | Plans | Completed |
|---|---|---|
| 8 Walking skeleton (live) | 4 | 0 |
| 9 Honest handling | 5 | 0 |
| 10 Hand-back and the playground | 4 | 0 |
| 11 Teaching layer | 4 | 0 |
| 12 Cloudflare blend | 7 (2 [S]) | 0 |
| 13 Event readiness | 1 | 0 |

### M2 decisions (full list: ARCHITECTURE-M2 §0)
- Auto untouched: M1 goldens must not change in any M2 plan (R4 otherwise).
- Manual = 14-DOF plant inside the car model (planar + unchanged 7-DOF ride + 4 implicit wheel spins), same tables,
  same peak-μ; compliance from hardpoints with one shared bushing table; no per-type handling constants.
- Modes auto/manual/returning/replay in sim-core; kernel mirrors `store.driveMode`; features request on the bus.
- One GroundWorld for physics and rendering; annex north of the real loop (loop bbox y ≤ 0), two spurs.
- Deterministic kernels everywhere in sim-core (09-03 sweep); Node + Chromium hash CI.
- No new npm dependencies; Cloudflare adds D1 (replays) + Turnstile + room `driver` role; Access skipped.

### M2 open questions (ARCHITECTURE-M2 §16)
A/S keys in Auto · brake bias 0.62 kept · widened validation bands · Turnstile widget/secret creation · Workers Paid ·
AE SQL token for crowd insight [S] · idle hand-back timings · Firefox/WebKit determinism gap · motorcycle Manual (v1.5) ·
hill station.

### M2 known gaps to record as they land
- Determinism CI covers Node + Chromium only (no Firefox/WebKit binaries; `playwright install` forbidden).

## Milestone 2 — state at close (13-01, 2026-11-21)
| Phase | Plans | Completed |
|---|---|---|
| 8 Walking skeleton (live) | 5 (incl. 08-05) | 5 |
| 9 Honest handling | 5 | 5 |
| 10 Hand-back and the playground | 4 | 4 |
| 11 Teaching layer | 5 (incl. 11-05) | 5 |
| 12 Cloudflare blend | 7 (2 [S]) | 5 (12-06 [S], 12-07 [S] not built — recorded cut) |
| 13 Event readiness | 1 | 1 |

Requirements: see `13-01-AUDIT.md` (MET / PARTIAL / NOT MET / STRETCH-SKIPPED with evidence).

### Stretch cuts (recorded)
- MD-55 live ghosts (12-07): not built; `live-ghosts` stays a stub with `defaultEnabled: false`.
- MD-56 crowd insight (12-06): not built; `/api/insight` answers 501; no `AE_SQL_TOKEN`.

### Known gaps (honest list; none blocks a booth demo, several need a person with hardware)
- **Determinism** is verified Node vs Chromium only; Firefox/WebKit are not installed here, so their cross-engine
  replay equality is unverified (a drifting replay is labelled "approximate from here").
- **Never tried on real hardware:** gamepad (mapping, dead zones, rumble), phone tilt steering and the iOS motion
  permission, haptics, touch driving (only CDP synthetic touch), audio (never listened to), the phone driver on a venue
  network.
- **Looks and performance** were judged under SwiftShader only (annex, wet lanes, rings, skid marks, ghost, driving
  camera); the phase-13 "≥ 60 fps at 1440p high on a discrete GPU, ≤ 250 draw calls with everything on" is unmeasured on
  real hardware (highest measured: 206 calls at the ride street, high tier, without ghost/rings at the same time).
- **Production replay save** never done end to end (needs a human to solve Turnstile); the per-address 429 of saves is
  not provable from this sandbox (rotating egress).
- **0–100 km/h 4.99 s** is outside its 3.6–4.8 s band (friction-limited; not tuned, tyre μ is shared with Auto).
- **Returning (H2):** 92 % of 500 random starts latch within 40 s; the rest are released with a cut; starts at speed
  pointing away leave the 30 m corridor. From the annex the autopilot drives across the grass, not the spurs.
- **T10** (ISO 3888-2 max pass speed) measures the PathDriver, not the suspension; no meaningful per-suspension table.
- **Allocation:** Manual/Returning steps allocate ~11–14 KB/step of short-lived boxed doubles in V8 (Auto ~3.7);
  the heap tripwires catch retained growth only.
- **Engineer:** ~1 in 5 driving answers hit the 9 s model timeout in the live evaluation (labelled rule answer).
- **Layout:** at 844×390 and 1024×768 the telemetry card can overlap the drive pill's left part in Auto (10-04 note;
  11-05 reshaped the driving layout but did not re-check Auto on those sizes).
- **Off-lap idle re-sync** (20 s, MD-07) is disabled under `?e2e=1` and therefore not covered by any automated test.
- Owner decisions still open: Workers Paid for the event day; custom domain (CSP `connect-src` names the workers.dev
  host; the Turnstile widget lists only that host).

