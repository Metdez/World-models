# Suspension Lab

## What This Is
A premium, cinematic, interactive 3D web experience in which a GT car drives itself continuously around a
purpose-built ~1.5 km proving loop. The visitor follows it, orbits it freely, or drops into a suspension
close-up with an x-ray body, and swaps in one click between MacPherson strut, double wishbone and multi-link.
Each is a real linkage solved from hardpoints, so the wheel and body visibly behave differently for honest,
physical reasons. A cafe-racer motorcycle with three suspension presets is the second vehicle class. It runs
live on Cloudflare, where a shared clock puts every visitor on the same lap, a phone can drive the big screen
at a live event, the audience can vote, and an AI Race Engineer explains what just happened using live telemetry.

## Core Value
**Show, don't tell: the visitor sees, on the same lap and the same bump, that suspension geometry changes what
the wheel does. Every visible difference is computed, never animated or invented.**
If a tradeoff has to be made, this sentence wins: kinematic honesty and visual clarity come before feature count.

## Requirements

### Validated
(None yet. Ship to validate.)

### Active
Full list with IDs in `.planning/REQUIREMENTS.md`. Headlines:
- [ ] Walking skeleton deployed on Cloudflare from phase 1 (DEP-01..04)
- [ ] Pure, deterministic, unit-tested sim-core: track, speed profile, kinematics solver, 7-DOF ride (SIM, KIN, RIDE)
- [ ] Cinematic world and car: proving loop, HDRI lighting, DB11 with procedural, solver-driven suspension, x-ray (VIS)
- [ ] Follow / explore / close-up cameras, minimal HUD, telemetry, insights, teaching overlays, attract mode (CAM, UI, EDU, ATR)
- [ ] Motorcycle class with three presets (MOTO)
- [ ] Edge features: Live Lab presence + server-time sync, presenter remote, audience poll, AI Race Engineer, anonymous analytics (EDGE, AI, OBS)
- [ ] Performance, honesty, accessibility, credits, event readiness (PERF, HON, A11Y, CRED, DEMO)

### Out of Scope
- Free driving / physics engine (Rapier, cannon) — the car is kinematic on a path by design; determinism and server-time sync depend on it.
- WebGPU / TSL renderer — WebGLRenderer + GLSL keeps pmndrs postprocessing + N8AO and headless-Chromium testability.
- React / any UI framework — ~6 DOM components updated at 30 Hz; vanilla DOM is smaller and faster.
- R2, D1, Vectorize/AI Search, Browser Run, Stream, Queues, Workflows, Agents SDK, Turnstile (unless abuse appears) — they do not improve this experience (SUMMARY.md).
- Share links with server storage / OG images — URL params are enough for v1.
- User accounts, persistence, leaderboards — not needed to show the core value.
- Hardpoint-editing UI / tuning sliders — invites claims we cannot validate; v2 at the earliest.
- Licensed manufacturer data or branding claims — parameters are representative; no endorsement implied.
- Copying GPL/LGPL/AGPL code (OpenLAP, TUMFTM, open-kinematics) — algorithms only, reimplemented.
- Mobile-optimised 3D experience — desktop-first; phones get the remote page and a best-effort low tier.

## Context
- Repository starts empty except `.planning/research/` (23 research files + SUMMARY.md) and `assets-src/`
  (DB11 GLB CC BY 4.0, three Poly Haven CC0 HDRIs, four CC0 texture sets, four audio loops).
- Process: GSD (PROJECT/REQUIREMENTS/ROADMAP/STATE, per-phase PLAN -> execute -> SUMMARY -> verify) with
  Ponytail coding discipline (smallest complete change) in every executor prompt. Planning on Opus, coding by
  parallel Opus executors, so the architecture contract (`.planning/ARCHITECTURE.md`) is binding and frozen
  after phase 1.
- Cloudflare account facts (verified by orchestrator): token works for Workers scripts, D1, KV, Workers AI;
  R2 is NOT enabled; workers.dev subdomain `zh-a16`; worker name `suspension-lab`;
  `@cf/google/gemma-4-26b-a4b-it` responds with `chat_template_kwargs.enable_thinking=false`.
- An ungrounded model answer about strut camber was mechanically wrong, so the AI is grounded with fact cards
  and may only quote numbers present in the telemetry payload.
- Target use: a live tech event (big screen + phones) and the public web.

## Constraints
- **Tech stack**: Vite 8 + TypeScript strict, three@0.187.x WebGLRenderer + GLSL, camera-controls 3.x, postprocessing 6.39 + n8ao, nanostores + mitt, vanilla DOM/CSS, vitest, Playwright; Cloudflare Workers + Static Assets, Hono, Durable Objects (SQLite), Workers AI, Analytics Engine, Rate Limiting — pinned in ARCHITECTURE.md §1.
- **Modularity**: every feature is a swappable module; features never import each other; variants are registry data — ARCHITECTURE.md §2, §9.
- **Determinism**: sim-core has no three/DOM/time/random imports; fixed 240 Hz step — needed for tests and shared-clock sync.
- **Delivery**: deploy at the end of every phase to https://suspension-lab.zh-a16.workers.dev using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from the environment.
- **Assets**: every file < 25 MiB (Workers Static Assets limit; no R2); every asset has an attribution entry.
- **Performance**: desktop 60 fps target at 1440p on a recent discrete GPU, >= 45 fps on a recent iGPU at the `medium` tier.
- **Honesty**: displayed numbers come from the running sim; amplification labelled; estimates never presented as data.
- **Licences**: only MIT/Apache/BSD/ISC/Zlib/CC0/CC-BY/OFL; attribution in-app and in CREDITS.md.
- **Budget**: Workers Free plan for development; owner decides on Workers Paid ($5/mo) before the live event (removes daily caps).

## Key Decisions
| Decision | Rationale | Outcome |
|---|---|---|
| Kinematic car on a precomputed path + 7-DOF ride model, no physics engine | Deterministic, believable, server-time syncable, testable | — Pending |
| Own Newton/LM solver driven by declarative constraints; Chrono (BSD-3) hardpoint seeds | No permissive solver exists; data-driven layouts; regression values from research 03 | — Pending |
| Same springs/dampers/ARB targets across suspension types | Differences must come from geometry (plus honest extras: strut friction, unsprung delta) | — Pending |
| One suspension selection applies to both axles (one click) | Simplest honest comparison; one segmented control | — Pending |
| Kernel + FeatureModule + registries; nanostores store, mitt bus, preallocated TelemetryFrame | Swappable modules without a framework or ECS | — Pending |
| Every planned feature exists as a stub from phase 1; `src/app/features.ts` written once | Parallel executors never edit a shared file | — Pending |
| Sim frame Z-up (ISO 8855); three.js stays Y-up; one mapping function | Keeps Chrono data and engineering conventions; keeps three addons happy | — Pending |
| Display amplification applied inside sim `sample()` to pose fields only | Kinematic closure stays exact; readouts stay true | — Pending |
| All Cloudflare bindings (DO, AI, AE, Rate Limiting) declared in phase 1 | First deploy validates the account; later plans never touch wrangler.jsonc | — Pending |
| AI Race Engineer non-streaming JSON + server-side number check + rule-based fallback | Tool-call streaming shape is unverified; numbers are the hallucination risk | — Pending |
| Analytics Engine write-only; live crowd distribution from the room Durable Object | No AE read token needed in v1; "crowd" view is live anyway | — Pending |
| Public room `LIVE` for everyone; private 5-char rooms for presenter + poll | Live Lab by default; event control isolated | — Pending |
| Textures ship as 1k JPG (no KTX2) in v1 | `toktx` not available; 1k maps are small; KTX2 is a polish stretch | — Pending |

---
*Last updated: 2026-11-20 after roadmap creation*
