# Project State

## Project Reference
See: .planning/PROJECT.md (updated 2026-11-20)
**Core value:** Show, don't tell: on the same lap and the same bump, the visitor sees that suspension geometry changes what the wheel does; every visible difference is computed.
**Current focus:** Phase 1 — Walking skeleton (live)
**Binding contract:** .planning/ARCHITECTURE.md (contracts in §5 are created verbatim by plan 01-01, then frozen)

## Current Position
Phase: 1 of 7 (Walking skeleton (live))
Plan: 0 of 4
Status: Ready to plan
Last activity: 2026-11-20 — roadmap, requirements and architecture contract created
Progress: [░░░░░░░░░░] 0%

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

### Blockers/Concerns
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
