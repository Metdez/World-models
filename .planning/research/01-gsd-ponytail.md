# 01 - GSD workflow + Ponytail: what they are and how to follow them without installing

Researched 2026-11-20. Everything below was read from the real published npm tarballs (extracted and a real headless install was run in a scratch dir), not from memory. Anything unverified is marked.

---------------------------------------------------------------------
## 0. TL;DR

- **GSD = "Get Shit Done"** by TÂCHES (glittercowboy). npm `get-shit-done-cc@1.42.3` (latest dist-tag, MIT, node>=22). A spec-driven, context-engineering workflow of slash commands + subagents for Claude Code. State lives in `.planning/`.
  - CAVEAT: the GitHub repo `gsd-build/get-shit-done` is now an **archived redirect** ("GSD Has Moved") to **`open-gsd/gsd-core`** (npm `@opengsd/gsd-core`, "Git. Ship. Done.", MIT). npm dist-tags: `@opengsd/gsd-core` latest=1.22.0 (modified 2026-11-19); `get-shit-done-cc` latest=1.42.3 (last modified 2026-05-23, canary 1.50.0-canary.2). Note `npm pack @opengsd/gsd-core` returned 1.10.0 despite latest=1.22.0 (unverified why). I documented **get-shit-done-cc 1.42.3** in detail (the canonical, widely-known one); gsd-core is a continuation fork with the same `.planning/` model, 34 agents (adds `gsd-mempalace-curator`), 71 commands, templates moved to `gsd-core/`.
- **Ponytail = "lazy senior dev" skill/plugin** by Dietrich Gebert: `https://github.com/DietrichGebert/ponytail`, npm `@dietrichgebert/ponytail@5.3.3` (MIT). One prompt ("smallest complete change; the best code is the code never written") injected into Claude Code/Codex/Copilot/Cursor/OpenCode/etc. **High confidence (~90%)** this is what the owner means by "ponytail to do all the coding" - it is the only widely-known, actively maintained "ponytail" coding-agent tool (very popular; DEV article claims ~44k stars in <9 days - third-party, unverified). It is a *coding-style discipline*, not an orchestrator.
- Both install **non-interactively** in a headless Linux container (tested; commands in section 3). GSD needs `gsd-sdk` on PATH (global npm install). Ponytail installs via `claude plugin ...` CLI subcommands, or just copy the AGENTS.md/SKILL.md text.

---------------------------------------------------------------------
## 1. GSD (Get Shit Done)

### 1.1 Sources
- npm: https://www.npmjs.com/package/get-shit-done-cc (1.42.3, MIT, author TÂCHES). Tarball inspected: `README.md`, `commands/gsd/*.md` (67), `agents/*.md` (34, 33 installed), `get-shit-done/{workflows,templates,references,bin}`, `hooks/`, `sdk/`.
- Old repo (archived redirect): https://github.com/gsd-build/get-shit-done ; successor: https://github.com/open-gsd/gsd-core (npm `@opengsd/gsd-core`). Stars not retrievable (GitHub API blocked in this session) - unverified.
- License: MIT (LICENSE in tarball) - reusable/adaptable.

### 1.2 Core idea
Fights "context rot": the orchestrator (main chat) stays thin (30-40% context); heavy work is done by **fresh-context subagents** (researcher/planner/checker/executor/verifier), each given only file paths to read. Durable memory = markdown artifacts in `.planning/` committed to git. Workflow: **new-project -> (discuss -> plan -> execute -> verify -> ship) per phase -> complete-milestone**.

### 1.3 Command surface (main loop; all are `/gsd:<name>` in command files, shown as `/gsd-<name>` skills in README)
| Command | Does |
|---|---|
| `/gsd-map-codebase` | (brownfield) spawn 4 mappers -> `.planning/codebase/*.md` |
| `/gsd-new-project [--auto]` | questions -> optional 4x parallel research -> requirements -> roadmap. Creates PROJECT.md, config.json, research/, REQUIREMENTS.md, ROADMAP.md, STATE.md |
| `/gsd-discuss-phase N` | capture user's implementation decisions for the phase -> `NN-CONTEXT.md` (+ `NN-DISCUSSION-LOG.md`) |
| `/gsd-plan-phase N` | research (phase-researcher) -> plan (planner) -> verify (plan-checker), loop max 3 revisions -> `NN-MM-PLAN.md` files (+ `NN-RESEARCH.md`, `NN-VALIDATION.md`) |
| `/gsd-execute-phase N` | group plans into waves, spawn executors per plan, atomic commit per task, SUMMARY per plan, then verifier -> `NN-VERIFICATION.md` |
| `/gsd-verify-work N` | manual UAT with user -> `NN-UAT.md`; failures -> debug agents -> gap-closure plans (re-execute) |
| `/gsd-ship N` | create PR from verified phase |
| `/gsd-progress --next` | auto-detect & run the next step |
| `/gsd-autonomous [--from N --to N --only N]` | all remaining phases: discuss->plan->execute; then milestone audit/complete/cleanup |
| `/gsd-quick "task"` | ad-hoc: planner(quick)+executor, skips research/checker/verifier; writes `.planning/quick/` |
| `/gsd-complete-milestone`, `/gsd-new-milestone` | archive+tag (`.planning/milestones/vX.Y-*`), start next |
Other (67 total): `add-phase`, `insert-phase` (decimal e.g. 2.1), `remove-phase`, `code-review`, `debug`, `audit-milestone`, `audit-uat`, `secure-phase`, `ui-phase`/`ui-review`, `validate-phase`, `pause-work`/`resume-work`, `health`, `settings`, `undo`, `pr-branch`, `spike`/`sketch`, `forensics`, `thread`, `workstreams`, `update`, `surface` (enable/disable skill clusters).

### 1.4 `.planning/` layout (verbatim from workflows)
```
.planning/
  PROJECT.md            # vision/core value/requirements/constraints/decisions (living)
  REQUIREMENTS.md       # checkable REQ-IDs, v1/v2/out-of-scope, traceability to phases
  ROADMAP.md            # phases, goals, success criteria, plan list, progress table
  STATE.md              # current position, metrics, decisions, blockers, session continuity (short-term memory)
  config.json           # workflow prefs (mode, models, gates, parallelization)
  MILESTONES.md         # milestone history
  research/             # STACK.md FEATURES.md ARCHITECTURE.md PITFALLS.md SUMMARY.md (project-level, from new-project)
  codebase/             # brownfield: STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS (.md)
  phases/
    01-foundation/                       # NN-slug, decimal inserts 02.1-...
      01-CONTEXT.md                      # discuss output (decisions D-01...)
      01-DISCUSSION-LOG.md
      01-RESEARCH.md                     # phase-researcher output
      01-VALIDATION.md                   # Nyquist test/validation strategy
      01-01-PLAN.md  01-02-PLAN.md       # {phase}-{plan}-PLAN.md
      01-01-SUMMARY.md 01-02-SUMMARY.md  # written by executor
      01-VERIFICATION.md                 # goal-backward verifier report
      01-UAT.md                          # verify-work session
      (REVIEW.md, SECURITY.md, UI-SPEC.md, AI-SPEC.md, FALLOW.json optional)
  quick/  todos/{pending,completed}/  milestones/  debug/  spikes/  sketches/  seeds/  notes/  threads/  workstreams/  reports/  HANDOFF.json/.continue-here*.md
```

### 1.5 File templates (from `get-shit-done/templates/`)

**PROJECT.md**
```markdown
# [Project Name]
## What This Is
[2-3 sentences, user's own words; update when reality drifts]
## Core Value
[ONE thing that matters most; drives tradeoffs]
## Requirements
### Validated   (shipped+confirmed; format "- ✓ [Req] — [version/phase]")
(None yet — ship to validate)
### Active      (- [ ] current scope; hypotheses until shipped)
### Out of Scope (- [Exclusion] — [why])
## Context       (tech env, prior work, feedback, known issues)
## Constraints   (- **[Type]**: [What] — [Why]; types: Tech stack, Timeline, Budget, Dependencies, Compatibility, Performance, Security)
## Key Decisions
| Decision | Rationale | Outcome |   (Outcome: ✓ Good / ⚠️ Revisit / — Pending)
---
*Last updated: [date] after [trigger]*
```
Evolution rules: after each phase transition move invalidated reqs to Out of Scope, validated ones to Validated (with phase ref), add new Active reqs, log decisions, re-check "What This Is". After each milestone full review + Core Value check.

**REQUIREMENTS.md**
```markdown
# Requirements: [Project Name]
**Defined:** [date]   **Core Value:** [from PROJECT.md]
## v1 Requirements
### [Category e.g. Authentication]
- [ ] **AUTH-01**: User can sign up with email and password      # ID = CATEGORY-NN; user-centric, testable, atomic
## v2 Requirements   (deferred; no checkbox)
## Out of Scope  | Feature | Reason |
## Traceability  | Requirement | Phase | Status |   + Coverage: v1 total / mapped / unmapped ⚠️
---
*Requirements defined: [date]*  *Last updated: [date] after [trigger]*
```

**ROADMAP.md**
```markdown
# Roadmap: [Project Name]
## Overview  [one paragraph]
## Phases
- [ ] **Phase 1: [Name]** - [one line]       # integer = planned; decimal 2.1 = urgent insertion (INSERTED)
## Phase Details
### Phase 1: [Name]
**Goal**: ...   **Depends on**: Nothing (first phase)   **Requirements**: [REQ-01, REQ-02]
**Success Criteria** (what must be TRUE):
  1. [Observable behaviour from user perspective]
**Plans**: N plans / TBD
Plans:
- [ ] 01-01: [description]
## Progress
| Phase | Plans Complete | Status | Completed |
```
Phase count by granularity: coarse 3-5, standard 5-8, fine 8-12.

**STATE.md**
```markdown
# Project State
## Project Reference   See: .planning/PROJECT.md (updated [date]) / **Core value:** / **Current focus:**
## Current Position    Phase: X of Y (name) / Plan: A of B / Status: [Ready to plan|Planning|Ready to execute|In progress|Phase complete] / Last activity: [date] — [what] / Progress: [░░░░░░░░░░] 0%
## Performance Metrics Velocity (plans completed, avg duration, total hours), By Phase table, Recent Trend
## Accumulated Context ### Decisions (recent, pointing to PROJECT.md Key Decisions) ### Pending Todos ### Blockers/Concerns
## Deferred Items  | Category | Item | Status | Deferred At |
## Session Continuity  Last session: / Stopped at: / Resume file: [.continue-here*.md or None]
```

**NN-CONTEXT.md** (discuss output; sections emerge per phase)
```markdown
# Phase [X]: [Name] - Context
**Gathered:** [date]  **Status:** Ready for planning
<domain>## Phase Boundary  (scope anchor from ROADMAP)</domain>
<decisions>## Implementation Decisions
### [Area discussed]  - **D-01:** [decision]  ...
### Claude's Discretion  [areas user said "you decide"]</decisions>
<specifics>## Specific Ideas</specifics>
<canonical_refs>## Canonical References  (every spec/ADR path downstream agents MUST read)</canonical_refs>
<code_context>## Existing Code Insights: Reusable Assets / Established Patterns / Integration Points</code_context>
<deferred>## Deferred Ideas</deferred>
```

**NN-MM-PLAN.md** (planner output; markdown + YAML frontmatter + task XML)
```markdown
---
phase: 01-foundation
plan: 01
type: execute            # or tdd
wave: 1                  # PRE-COMPUTED at plan time; execute-phase groups by this
depends_on: []           # e.g. ["01-01"]
files_modified: []
autonomous: true         # false if has checkpoints
requirements: []         # REQUIRED, non-empty, IDs from ROADMAP; every roadmap req must appear in >=1 plan
user_setup: []           # human-only setup (external services)
must_haves:              # goal-backward verification
  truths: []             # observable behaviours that must be true
  artifacts: []          # files that must exist with real implementation
  key_links: []          # critical wiring between artifacts
---
<objective>What / Purpose / Output</objective>
<execution_context>@.../workflows/execute-plan.md  @.../templates/summary.md [@checkpoints.md if checkpoints]</execution_context>
<context>@.planning/PROJECT.md @.planning/ROADMAP.md @.planning/STATE.md  [@relevant src files; prior SUMMARYs only if truly needed]</context>
<tasks>
<task type="auto">
  <name>Task 1: [action-oriented]</name>
  <files>path/a.ext, path/b.ext</files>
  <read_first>files to read before editing / sources of truth</read_first>
  <action>Specific implementation with CONCRETE values (exact identifiers, params, paths, commands); what to avoid and why</action>
  <verify>command/check proving it worked</verify>
  <acceptance_criteria>- grep-verifiable: "file contains 'exact string'"</acceptance_criteria>
  <done>measurable criteria</done>
</task>
<task type="checkpoint:decision" gate="blocking"><decision/><context/><options><option id=".."><name/><pros/><cons/></option></options><resume-signal/></task>
<task type="checkpoint:human-verify" gate="blocking"><what-built/><how-to-verify>visual checks only</how-to-verify><resume-signal>Type "approved" or describe issues</resume-signal></task>
</tasks>
<verification>- [ ] test cmd - [ ] build/typecheck - [ ] behaviour</verification>
<success_criteria>...</success_criteria>
<output>After completion create .planning/phases/XX-name/{phase}-{plan}-SUMMARY.md</output>
```
Sizing rules (agents/gsd-planner.md): **2-3 tasks per plan, single concern, plans sized to ~50% of a context window** ("more plans, smaller scope"); TDD gets its own plan (RED->GREEN->REFACTOR); plans in the same wave must have no `files_modified` overlap (orchestrator re-checks and falls back to sequential if overlap found); goal-backward: derive `must_haves` from the phase goal first, then tasks.

**NN-MM-SUMMARY.md** (executor output; frontmatter): `phase, plan, subsystem, tags, requires[{phase,provides}], provides[], affects[], tech-stack{added,patterns}, key-files{created,modified}, key-decisions[], patterns-established[], requirements-completed[] (REQUIRED, copy of plan's requirements), duration, completed`. Body: `# Phase X: Name Summary`, substantive one-liner, Performance (duration/start/end/tasks/files), Accomplishments, **Task Commits** (each with hash + type), Files Created/Modified, Decisions Made, Deviations from Plan (`[Rule N - Type] ...`), Issues, Next phase readiness. Variants: summary-minimal/standard/complex.

**NN-VERIFICATION.md**: frontmatter `phase, verified (ISO), status: passed|gaps_found|human_needed, score: N/M must-haves`; sections Goal Achievement -> Observable Truths table (✓ VERIFIED / ✗ FAILED / ? UNCERTAIN + evidence), Required Artifacts (EXISTS+SUBSTANTIVE / STUB), Key Link Verification (WIRED / NOT WIRED), Requirements Coverage, gaps. **NN-UAT.md**: frontmatter `status: testing|partial|complete|diagnosed`, `Current Test`, `Tests` (`expected:` / `result: pass|issue|skipped|blocked`, `severity`), `Summary` counts, `Gaps`.

**Project research files (`.planning/research/`)**, written by 4 parallel `gsd-project-researcher`s then merged by `gsd-research-synthesizer` into SUMMARY.md:
- `STACK.md`: header `Domain / Researched / Confidence`; tables Core Technologies (tech, version, purpose, why), Supporting Libraries, Dev Tools, Installation, Alternatives, **What NOT to use and why**; versions verified via Context7/official docs not training data; confidence per recommendation.
- `FEATURES.md`: Table stakes / Differentiators / Anti-features, complexity per feature, dependencies.
- `ARCHITECTURE.md`: typical component structure, boundaries, data flow, build order.
- `PITFALLS.md`: known failure modes.
- `SUMMARY.md`: synthesis feeding roadmap.
Phase-level `NN-RESEARCH.md` template at `templates/research.md` (consumed by planner).

**config.json** (defaults, `templates/config.json`):
```json
{"mode":"interactive","granularity":"standard",
 "workflow":{"research":true,"plan_check":true,"verifier":true,"auto_advance":false,"nyquist_validation":true,"security_enforcement":true,"discuss_mode":"discuss", "plan_bounce":false,"cross_ai_execution":false},
 "planning":{"commit_docs":true,"search_gitignored":false,"sub_repos":[]},
 "git":{"create_tag":true},
 "parallelization":{"enabled":true,"plan_level":true,"task_level":false,"skip_checkpoints":true,"max_concurrent_agents":3,"min_plans_for_parallel":2},
 "gates":{"confirm_project":true,"confirm_phases":true,"confirm_roadmap":true,"confirm_breakdown":true,"confirm_plan":true,"execute_next_plan":true,"issues_review":true,"confirm_transition":true},
 "safety":{"always_confirm_destructive":true,"always_confirm_external_services":true},
 "hooks":{"context_warnings":true},"model_profile":"balanced"}
```
`mode`: `interactive` or `yolo`. (`model_profile`, `models`, `model_overrides` keys per 1.7.)

### 1.6 Roles (who spawns whom)
Orchestrator = the slash command's workflow (`workflows/*.md`) running in the main session: it only parses args, runs `gsd-sdk query ...` for state, spawns agents (`Agent(subagent_type="gsd-...", model=...)`), handles returns/gates, commits docs, updates STATE/ROADMAP. It does not write code.

| Role (agent) | Spawned by | Does | Writes |
|---|---|---|---|
| `gsd-project-researcher` x4 (stack/features/architecture/pitfalls) | new-project / new-milestone | domain ecosystem research | `.planning/research/{STACK,FEATURES,ARCHITECTURE,PITFALLS}.md` |
| `gsd-research-synthesizer` | new-project | merge 4 files | `research/SUMMARY.md` |
| `gsd-roadmapper` | new-project | phases, req->phase mapping, success criteria, coverage validation (100% reqs mapped) | ROADMAP.md, STATE.md, REQUIREMENTS traceability |
| `gsd-codebase-mapper` | map-codebase | brownfield analysis | `.planning/codebase/*` |
| `gsd-assumptions-analyzer` / advisor-researcher | discuss-phase | surface gray areas | feeds CONTEXT.md |
| `gsd-phase-researcher` | plan-phase | how to implement this phase (uses CONTEXT.md) | `NN-RESEARCH.md` |
| `gsd-pattern-mapper` (optional) | plan-phase | map analogous existing code | pattern notes |
| `gsd-planner` | plan-phase (and quick, gap closure) | decompose into 2-3-task wave-assigned PLAN.md files with must_haves | `NN-MM-PLAN.md` |
| `gsd-plan-checker` | plan-phase | goal-backward pre-execution review (requirements coverage, context fit, wiring); returns issues -> planner revises, **max 3 iterations** | none (returns verdict) |
| `gsd-executor` | execute-phase (one per plan, parallel within wave) | run tasks, atomic commit per task, deviation rules, checkpoints, SUMMARY, STATE updates | code + SUMMARY.md |
| `gsd-verifier` | execute-phase end | goal-backward check that codebase *delivers* the phase goal (not just tasks done): truths/artifacts/key-links, stubs, wiring | `NN-VERIFICATION.md` |
| `gsd-integration-checker`, `gsd-code-reviewer`/`gsd-code-fixer`, `gsd-security-auditor`, `gsd-nyquist-auditor`, `gsd-ui-*`, `gsd-debugger` | gates / verify-work | cross-phase wiring, review, ASVS security, test-coverage validation, UI contract, root-cause debug -> gap plans | REVIEW.md, SECURITY.md, VALIDATION.md, UI-SPEC.md, DEBUG |

### 1.7 Execution semantics (execute-phase)
1. `gsd-sdk query init.execute-phase N`; discover plans; group by frontmatter `wave` (pre-computed by planner). Waves run **sequentially**, plans **within a wave in parallel** (`parallelization.enabled`, max_concurrent_agents 3, default git worktrees per plan, `workflow.use_worktrees`). Before spawning each wave: files_modified overlap check -> sequential fallback.
2. Executor starts with **fresh 200k context** and only `@` file refs. Per task: implement -> run `<verify>` -> **commit that task atomically** -> next. Commit format `{type}({phase}-{plan}): {task-name}` + bullet body; types feat/fix/test/refactor/perf/chore; pre-commit hooks run (no `--no-verify`). TDD: separate `test(...)` RED commit, then `feat(...)` GREEN, optional `refactor`. Stage files individually (never `git add .`).
3. After all tasks: SUMMARY.md written, then **metadata commit** `docs({phase}-{plan}): complete [plan-name] plan` (PLAN+SUMMARY+STATE+ROADMAP via `gsd-sdk query commit ... --files ...`). Commit-point rule: "Commit outcomes, not process": PLAN/RESEARCH/DISCOVERY files are NOT committed on their own; init commit = `docs: initialize [name] ([N] phases)`.
4. **Deviation rules** (executor): R1 auto-fix bugs; R2 auto-add missing critical functionality (validation, security, error handling); R3 auto-fix blocking issues (not package-manager installs); **R4 STOP and ask on architectural changes** (new table, switching libs, etc.). All deviations documented in SUMMARY. `./CLAUDE.md` directives are hard constraints; they beat plan text.
5. Checkpoints: `checkpoint:human-verify` (visual checks), `checkpoint:decision`, `checkpoint:human-action`; return structured state to orchestrator; plan marked `autonomous:false`.
6. Post-wave gates: heartbeats `[checkpoint] phase N wave a/b ...`, code_review_gate, regression_gate (prior-phase tests), schema_drift_gate, codebase_drift_gate, then `verify_phase_goal` (spawn verifier) -> `update_roadmap` (tick plans/progress, mark phase complete) -> update PROJECT.md -> offer next. Verifier status `gaps_found` -> `/gsd-plan-phase N --gaps` creates gap-closure plans; `human_needed` -> UAT.

### 1.8 Model tiers (`references/model-profiles.md`, `bin/shared/model-catalog.json`)
`model_profile` in config: `quality | balanced (default) | budget | adaptive | inherit`.

| Agent | quality | balanced | budget | adaptive |
|---|---|---|---|---|
| gsd-planner | opus | opus | sonnet | opus |
| gsd-roadmapper | opus | sonnet | sonnet | sonnet |
| gsd-executor | opus | sonnet | sonnet | sonnet |
| gsd-phase-researcher / project-researcher | opus | sonnet | haiku | sonnet |
| gsd-research-synthesizer | sonnet | sonnet | haiku | haiku |
| gsd-debugger | opus | sonnet | sonnet | opus |
| gsd-codebase-mapper | sonnet | haiku | haiku | haiku |
| gsd-verifier | sonnet | sonnet | haiku | sonnet |
| gsd-plan-checker / integration-checker / nyquist-auditor | sonnet | sonnet | haiku | haiku |
Philosophy of balanced: Opus only where architecture decisions happen (planning); Sonnet for execution/research/verification. Override layers (highest first): `model_overrides[agent]` (full IDs) > `models[phase_type]` (planning/discuss/research/execution/verification/completion -> opus/sonnet/haiku/inherit) > profile table > runtime default. Tier->ID map (claude): opus=`claude-opus-4-7`, sonnet=`claude-sonnet-4-6`, haiku=`claude-haiku-4-5` (catalog is stale vs today's models; override via `model_overrides`).

### 1.9 How an orchestrator should emulate GSD faithfully (without installing)
1. Create `.planning/` with PROJECT.md -> (research/*) -> REQUIREMENTS.md (REQ-IDs) -> ROADMAP.md (phases w/ goal + success criteria + req IDs + plan list) -> STATE.md -> config.json; commit `docs: initialize ...`.
2. Per phase N: (a) CONTEXT.md decisions (ask the product owner, or record defaults); (b) one researcher subagent -> RESEARCH.md; (c) one planner subagent -> PLAN.md files (2-3 tasks, ~50% context, `wave`, `depends_on`, `files_modified`, `requirements`, `must_haves`, task XML with concrete `<action>`/`<verify>`/`<acceptance_criteria>`); (d) plan-checker subagent, revise up to 3x until requirements fully covered; (e) executors in waves, parallel only when `files_modified` disjoint; **one git commit per task** `feat(NN-MM): ...`; SUMMARY.md + STATE/ROADMAP update + `docs(NN-MM): complete` commit; (f) verifier subagent -> VERIFICATION.md against must_haves (check stubs/wiring, not just existence); (g) gaps -> gap-closure plans; (h) tick ROADMAP, update PROJECT.md decisions.
3. Keep orchestrator context thin: pass file paths, not contents. Planner = strongest model; others cheaper.

---------------------------------------------------------------------
## 2. Ponytail

### 2.1 Primary candidate (HIGH confidence, ~90%): DietrichGebert/ponytail
- URL: https://github.com/DietrichGebert/ponytail ; npm `@dietrichgebert/ponytail` 5.3.3 (inspected tarball); site ponytail.dev. License: **MIT** (npm + LICENSE). Stars: unverified from primary (DEV article says ~44k in 9 days; third-party). Registry listings show canonical skill synced since 2026-06-16.
- What: "Lazy senior dev mode for AI agents. The best code is the code you never wrote." A single prompt (`skills/ponytail/SKILL.md`; compact `AGENTS.md` for rules-file agents) plus hooks that inject it each session into 20 agents (Claude Code, Codex, Copilot CLI, Cursor, Windsurf, OpenCode, Gemini CLI, Pi, Kimi, Hermes, Qoder, ...). Claims (own benchmark, Opus 5.5, 39 tasks, 5 runs): -53% code, -41% time, -26% cost, -45% tokens, 98% of risky logic ships with a test (68% baseline). A GitHub issue (#126) notes part of the gap is a verbose-baseline artifact.
- Fits "to do all the coding": it governs *how every coding task is done* (always-on), but it is NOT a workflow/orchestrator; it composes naturally with GSD (GSD = process, Ponytail = per-task coding discipline).
- Commands: `/ponytail [lite|full|ultra|off]`, `/ponytail band [on|off|import]` (Claude Code UI band: cost/tokens/reuse%/tests), `/ponytail-review` (review diff like the on-call senior), `/ponytail-audit` (whole repo, ranked), `/ponytail-debt` (collect `shortcut:` comments into ledger), `/ponytail-gain`, `/ponytail-help`. Optional `~/.config/ponytail/config.json` or `PONYTAIL_DEFAULT_MODE` env.
- **Full ruleset (verbatim core, skills/ponytail/SKILL.md; AGENTS.md is the same without frontmatter/levels):**
```
You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.

## Before you write
Read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.

## The smallest complete change  (take the first option that fully works)
1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.
2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.
- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.
- Comment only the why the code cannot show, in one line.
- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Between options of equal size, take the one that is correct on edge cases.
- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.
- A shortcut with a known limit gets a code comment: `shortcut: <the limit>, <when to upgrade>`.
Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.
Levels: lite = build what was asked, name the smaller option; full (default) = rules above; ultra = also push back on any part of the request the need does not justify.
```
- Install/invoke:
  - Claude Code (interactive): `/plugin marketplace add DietrichGebert/ponytail` then (separate prompt) `/plugin install ponytail@ponytail`; new session.
  - Claude Code **headless CLI (tested OK here)**: `claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail`.
  - OpenCode: `opencode plugin add @dietrichgebert/ponytail`; Codex: `codex plugin marketplace add DietrichGebert/ponytail && codex plugin add ponytail@ponytail`; Copilot CLI: `copilot plugin marketplace add ...`; Pi: `pi install git:github.com/DietrichGebert/ponytail`; any other agent: paste `AGENTS.md` into project.
  - Needs `node` on PATH for its 2 hooks (SessionStart `ponytail-activate.js`, UserPromptSubmit `ponytail-mode-tracker.js`, SubagentStart `ponytail-subagent.js` which injects the rules into subagents).
- Security note from author: install only from `DietrichGebert/ponytail` / `@dietrichgebert/ponytail`.

### 2.2 Other candidates (all LOW-MEDIUM; mostly copies)
| Candidate | URL | What | Confidence it is "the" tool |
|---|---|---|---|
| Forks/mirrors: Aimer-zero/ponytail, Adek06/ponytail, mikrammullah/PonyTail (README = Dietrich's, "13/14 agents" = older version), 0xwilliamortiz/ponytail-improved (wiki), sourceforge `ponytail.mirror`, gitee `aphx/ponytail` | github.com/Aimer-zero/ponytail etc. | copies of the same project (older versions); not verified beyond README heads | same tool, prefer upstream |
| `@metalbolicx/opencode-ponytail` 4.8.4 | https://cdn.jsdelivr.net/npm/@metalbolicx/opencode-ponytail@4.8.4/README.md | third-party OpenCode packaging | derivative |
| `ponytail-mcp` (npm, per a search summary) | unverified | MCP server exposing the ruleset as prompt/tool | derivative, unverified |
| Adoptions: TanStack/ai, marmelab/atomic-crm, graphif/project-graph, diegosouzapw/OmniRoute, YoizenSA/dev-ai-workflow (tessl.io registry entries) | tessl.io/registry/skills/github/... | repos vendoring the ponytail skill | evidence of popularity |
No other independent "ponytail" coding agent/harness/MCP found in searches (WebSearch x3). Residual risk (~10%): the owner may mean something unrelated/private (e.g. a person's nickname, or "Ponytail" as a persona for an internal tool). If the owner can confirm "lazy senior dev / smallest change" it is settled.

---------------------------------------------------------------------
## 3. Headless install (tested 2026-11-20, node 22, Linux container)

### GSD
```bash
# Recommended: global so `gsd-sdk` is on PATH (workflows call `gsd-sdk query ...` ~46x in execute-phase; without it they fail "command not found")
npm install -g get-shit-done-cc@1.42.3
get-shit-done-cc --claude --global            # non-interactive (flag selects runtime+scope); add --profile=core|standard to shrink surface
# project-local alternative (tested): 
cd <repo> && npx --yes get-shit-done-cc@1.42.3 --claude --local </dev/null
#   then: export PATH="<npx-cache>/node_modules/.bin:$PATH"  (installer prints it) or use global npm install above
# flags: -g/--global, -l/--local, --claude, --all, -c/--config-dir <path>, --profile=<name>, --minimal, --no-sdk, --uninstall
# run Claude with permissions skipped as the authors intend:  claude --dangerously-skip-permissions
```
Files written (local install tested; global = same tree under `~/.claude/`):
`.claude/commands/gsd/*.md` (67), `.claude/agents/gsd-*.md` (33), `.claude/get-shit-done/{bin,workflows(88),templates(34),references(60),contexts}`, `.claude/hooks/*` (12; update check, context monitor, prompt-injection guard, read-before-edit guard, workflow guard, commit validation etc.), `.claude/settings.json` (hook registrations), `.claude/VERSION`, `gsd-file-manifest.json`, `gsd-install-state.json`, `package.json`. `.planning/` is only created later by `/gsd-new-project`. No network needed at runtime except npm install. Requires node >=22.
Successor: `npx @opengsd/gsd-core@latest` (same installer style; unverified flags).
**Without installing:** the slash commands are just markdown prompts; an orchestrator can follow sections 1.4-1.9 by hand (create the files, spawn subagents via the Agent tool with the role prompts). The exact agent prompts are in the tarball (`npm pack get-shit-done-cc@1.42.3`, `agents/gsd-*.md`, `get-shit-done/workflows/*.md`) if more fidelity is wanted.

### Ponytail
```bash
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail          # tested: "Successfully installed plugin: ponytail@ponytail (scope: user)"; prints "4 userConfig options not yet set" (optional; pass --config KEY=VALUE or ignore)
```
Writes: `~/.claude/settings.json` (`extraKnownMarketplaces.ponytail` = github DietrichGebert/ponytail; `enabledPlugins["ponytail@ponytail"]=true`), `~/.claude/plugins/cache/ponytail/ponytail/5.3.3/` (skills/, hooks/, AGENTS.md), `~/.claude/plugins/installed_plugins.json`, marketplace cache dir. Runtime: `~/.config/ponytail/` (mode/band state, only on use). Active from the next session.
Zero-install alternative (recommended for orchestrated subagents): copy the verbatim rules block above into the project `CLAUDE.md`/`AGENTS.md` and into every executor/subagent prompt (the plugin's SubagentStart hook does this automatically; hand-roll it if not installed). Or `npm i -D @dietrichgebert/ponytail` just to read the files.

---------------------------------------------------------------------
## 4. Recommendations for Suspension Lab

1. Use GSD as the **process skeleton**: PROJECT.md (core value = "physically grounded, visibly different suspension kinematics in a cinematic 3D scene"), REQUIREMENTS.md with IDs per feature module (e.g. KIN-xx kinematics, CAR-xx car/track, UI-xx, MOTO-xx, CF-xx Cloudflare), ROADMAP phases = vertical slices (1 scene+track+driving car, 2 MacPherson kinematics solver+visuals, 3 double wishbone+multi-link, 4 x-ray/orbit UI, 5 motorcycles, 6 Cloudflare deploy+polish). Because the product mandates swappable modules, make **one module = one plan** (2-3 tasks), with `files_modified` kept disjoint so plans in the same wave can run in parallel.
2. Install GSD globally (`npm i -g get-shit-done-cc@1.42.3 && get-shit-done-cc --claude --global`) if the orchestrator is a real Claude Code run (gets hooks, gsd-sdk, slash commands). If instead the orchestrator is a custom agent, copy the artifact templates/rules in section 1 and skip installation.
3. Model tiers: planner on the strongest model, executors/verifier/researchers on sonnet, mappers/checkers on haiku (balanced/adaptive). Override IDs via `model_overrides` since the shipped catalog names (opus-4-7/sonnet-4-6) lag current models.
4. Use Ponytail as the **per-task coding rule** inside executor prompts (also fits the user's "reuse existing code" brief rule: ladder step 2-4 = reuse/stdlib/installed dep). Caveat: for a Three.js shader/physics product, "never cut calibration real hardware needs" + "correct on edge cases" must win over minimal lines in the kinematics solver; keep one small assert-based self-check per solver (camber gain, roll centre, bump steer), which Ponytail itself requires for new non-trivial logic. Use `ultra` sparingly - it pushes back on features the need does not justify, which may fight the cinematic-polish goal.
5. Take GSD's verification philosophy verbatim: verifier checks must_haves **truths/artifacts/key-links** (wired, not stubbed) and human-verify checkpoints for visual results (screenshots/URL) - essential for a visual product.
6. Open questions to confirm with the owner: (a) confirm "ponytail" = DietrichGebert/ponytail; (b) get-shit-done-cc 1.42.3 vs the open-gsd `gsd-core` successor; (c) whether Claude Code is actually the runtime (GSD hooks assume it).
