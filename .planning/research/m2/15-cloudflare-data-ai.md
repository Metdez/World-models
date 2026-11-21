# 15 - Cloudflare storage, data and AI for Manual Drive (as of 2026-11-21)

Method: every limit/price below was read from developers.cloudflare.com on 2026-11-21 [S = sourced from the named docs page; E = my estimate]. No repos involved, so no licence table. Account: Free plan, Workers + Static Assets, DO (SQLite), Workers AI, Analytics Engine, KV, D1; R2 NOT enabled.

## 0. Free-plan budget cheat-sheet (all resets 00:00 UTC)
| Product | Free limit | Paid (Workers Paid, $5/mo min) | Source |
|---|---|---|---|
| Workers requests | 100k/day; CPU 10 ms/req; 5 cron triggers; 50 subrequests | - | workers/platform/limits [S] |
| KV | 100k reads, 1k writes, 1k deletes, 1k lists /day; 1 GB; value 25 MiB; 1 write/s/key; TTL supported | $0.50/M reads, $5/M writes, $0.50/GB-mo | kv/platform/pricing, /limits [S] |
| D1 | 5M rows read, 100k rows written /day; 5 GB total (500 MB per DB); row/blob max 2 MB; 50 queries/invocation | $0.001/M read, $1/M write, $0.75/GB-mo | d1/platform/pricing, /limits [S] |
| DO (SQLite) | 100k req/day, 13k GB-s/day, 5M rows read, 100k rows written /day, 5 GB | $0.15/M req, $12.50/M GB-s, $1/M rows written, $0.20/GB-mo | durable-objects/platform/pricing [S] |
| Workers AI | 10,000 neurons/day | $0.011 / 1k neurons | workers-ai/platform/pricing [S] |
| Analytics Engine | 100k data points written/day, 10k SQL queries/day; 3-month retention; 250 points/invocation; 20 blobs+20 doubles+1 index (96 B), blobs <=16 KB | 10M written + 1M reads /mo, then $0.25/M and $1/M ("billing not active yet") | analytics-engine/limits, /pricing [S] |
| AI Gateway | caching + rate limiting + analytics free on all plans; legacy logs 100k total on Free (accounts whose first gateway is >= 2026-09-24 use Workers Logs rules); Guardrails billed as Workers AI (Llama Guard) tokens | - | ai-gateway/reference/pricing [S] |
| Vectorize | 30M queried dims/mo, 5M stored dims, 100 indexes | 50M q-dims, 10M stored incl. | vectorize/platform/pricing [S] |
| AI Search | 1k semantic + 1k FTS queries/mo, 5M ingest tokens, 10 GB; billing starts 2026-12-01; built-in storage so R2 optional; 500 crawl pages/day | $0.75/1k semantic queries | ai-search/platform/limits-pricing [S] |
| Turnstile | free, 20 widgets, unlimited verifications, 10 hostnames/widget, 7-day analytics | - | turnstile/plans [S] |
| Rate Limiting binding | config `ratelimits` + `simple{limit,period}`; period only 10 or 60 s; per-location, approximate, eventually consistent; plan availability not stated on page | - | workers/runtime-apis/bindings/rate-limit [S] |
| WAF rate-limit rule | Free: 1 rule, 10 s window, IP only, 10 s timeout | - | waf/rate-limiting-rules [S] |
| Workflows | 100k exec/day, 10 ms compute/step, 100 MB state, 3-day retention | 30 s/step, 7-day retention | workflows/reference/limits [S] |
| Queues | 10k ops/day, 24 h retention (3 ops/message => ~3.3k msgs/day) | 1M ops/mo, $0.40/M | queues/platform/pricing [S] |
| Pipelines (Basin) | Paid only; sinks go to R2/Iceberg | - | pipelines overview [S] |

Key take-away: our scale (event demo, tens to low hundreds of drivers) is orders of magnitude below every free limit EXCEPT the 1k KV writes/day and the 10 ms CPU cap. Paid ($5/mo) removes both and is cheap insurance for a live event.

## 1. Saving / sharing a run as a replay

### Input-log vs snapshot
- Our sim is a pure function: fixed 240 Hz step, no physics engine, `sim-core` deterministic. A manual run = initial condition (car, suspension type, road seed, start state) + per-tick driver inputs. Store inputs at 60 Hz (control rate) and apply zero-order hold over 4 sim ticks.
- Size [E]: throttle, brake, steer as 3x uint8/int16 = 4-6 B/sample => 240-360 B/s => 14-22 KB/min raw. Delta + RLE (inputs are piecewise smooth/constant) => ~2-5 KB/min; gzip/`CompressionStream('gzip')` another 2-3x. A 3-minute run ~ 5-15 KB, base64url-able only if tiny; otherwise store server-side.
- State snapshot (7-DOF + wheel + pose ~ 40 floats = 160 B) at 10 Hz = 1.6 KB/s = ~96 KB/min raw; 20-40x larger and lossy to interpolate. Reject as primary format.
- Recommended: hybrid. Input log as truth + a keyframe snapshot every ~5 s (160 B each, ~2 KB/min). Keyframes give (a) seek/scrub without re-simulating from t=0, (b) a drift guard: replayer compares to keyframe and snaps if error > epsilon.
- Determinism risk (real): IEEE +,-,*,/,sqrt are bit-exact across JS engines, but `Math.sin/cos/tan/exp/pow/atan2` are implementation-approximated and can differ between V8/JSC/SpiderMonkey and CPU. Replay on a different browser can diverge slowly (chaotic only near grip limit). Mitigations: keyframes (above); or use table/polynomial sin/cos inside sim-core; add a CI test that hashes state after N ticks and run it in Chromium + WebKit + Firefox. Also: replay must run the fixed-step loop, never variable dt, and must pin a `simVersion` in the file (reject/ warn on mismatch; keep old sim-core builds out of scope, show "recorded with v3, approximate replay").
- Honesty: label a replay "re-simulated from your inputs", not a measurement.

### Where to store (R2 not available)
| Option | Fit | Verdict |
|---|---|---|
| KV | value<=25 MiB, native `expirationTtl`, global read cache, cheap reads. Free: only 1,000 writes/day, eventually consistent (up to ~60 s) so "share link opens instantly in same colo" is OK but not guaranteed elsewhere. | BEST for immutable share blobs on Paid; on Free the 1k writes/day is the cap (fine for a demo day, ~1 write per saved run). |
| D1 | row max 2 MB (a run fits), SQL listing/moderation/count queries, 100k rows written/day free, no native TTL (needs cron delete). Strongly consistent at primary. | Good as the INDEX (run id, created, car, suspension, size, hash, flags) even if blob lives in KV; or put the blob as a BLOB column (<=2 MB) and skip KV entirely. |
| DO SQLite | per-run or per-room object; real-time consistency, alarms for TTL (`setAlarm`). Overkill for write-once blobs; useful only for live "watch me drive" or leaderboard coordination. | Skip for storage; keep for rate-limit coordinator if needed. |
| R2 | not enabled | n/a; do not enable just for this (blobs are KBs). |

Recommendation: **D1 only** for v1 (index + gzip blob BLOB column, 2 MB cap enforced server-side at 64 KB per run [E: abuse cap]). One system, strong consistency, trivially queryable for moderation, deletable by TTL via cron. Add KV as a read-through cache of `GET /r/:id` only if D1 read latency matters (it will not at this scale; D1 free allows 5M rows read/day). Choose KV-primary only if you want native TTL and zero cron.

### Share links
- `suspensionlab.<domain>/r/<id>`; id = 10-12 char base32 from `crypto.getRandomValues` (60 bits => unguessable, no auth needed; unlisted not secret). Store `sha256(blob)` to dedupe.
- Alternative zero-backend: put a <=2 KB compressed log in the URL fragment (`#r=...`); no storage, no abuse surface, survives forever. Works for runs < ~40-60 s with RLE. Offer both: fragment when it fits, server when not. Strongest "adopt" for a demo-safe path.
- Social preview: Worker can return OG tags + a Static-Asset poster; skip dynamic image generation.

### Abuse and TTL
- Server validates before storing: schema version, max length (e.g. 10 min => 150 KB cap [E]), input ranges, `simVersion` allowlist, optional deterministic re-sim to confirm it ends without NaN (CPU: a 3-min run at 240 Hz = 43k ticks; sim-core is cheap, but free-plan CPU cap is 10 ms, so do NOT re-sim in the Worker on Free; validate structurally only).
- TTL: 30 days default (KV `expirationTtl`, or D1 `expires_at` + cron). Extend-on-view optional.
- Writes gated by Turnstile + rate limit (section 6).
- No PII stored: no IP, no user agent in the row.

## 2. "Same inputs, different suspension" A/B
- Core selling feature: replay one input log on strut vs wishbone vs multi-link and overlay. This is **client-side, trivially**: sim-core is pure TS, stateAt-style stepping at 240 Hz; three replays in parallel = 3x cost of one sim tick set, well under 1 ms/frame [E]. Run in a Web Worker if frame budget matters.
- Do NOT compute in a Worker: Free CPU 10 ms/request cannot run minutes of sim; Paid permits 30 s CPU default but you pay latency + per-request cost for something the client does for free and offline. A Worker adds nothing except if you want *cached public comparison results* for a shared run (then precompute once, cache in KV; still unnecessary).
- Caveat to display: same inputs, different suspension means the car takes a different path (steer-input replay is open loop); trajectories diverge. Say so in UI, and offer "same path" (closed-loop path-follow with the existing auto driver) as the fair comparison. That is an honest A/B; open-loop is the "what my hands would have done" view.

## 3. Workers AI "race engineer"
### Models available now (from pricing + catalog pages, 2026-11-21)
| Model | Context | Tools | JSON | $/M in / out | Neurons/M in / out |
|---|---|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | 256k | yes (parallel) | `response_format` param (details not documented) | 0.10 / 0.30 | 9,091 / 27,273 |
| `@cf/openai/gpt-oss-20b` | 128k | yes; reasoning effort low/med/high | `response_format` param | 0.20 / 0.30 | 18,182 / 27,273 |
| `@cf/openai/gpt-oss-120b` | not stated | - | - | 0.35 / 0.75 | 31,818 / 68,182 |
| `@cf/qwen/qwen3-30b-a3b-fp8` | not stated | - | - | 0.051 / 0.335 | 4,625 / 30,475 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | not stated (historically 24k) | - | documented JSON mode model | 0.293 / 2.253 | 26,668 / 204,805 |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | not stated | - | JSON mode (non-fp8 listed) | 0.152 / 0.287 | 13,778 / 26,128 |
| `glm-4.7-flash` | 131k | multi-turn tools | - | n/a here | n/a |
| `glm-5.3` / `kimi-k2.6` | 1M / 262k | yes | yes | not on pricing page | - |
Caveats: the JSON-mode doc page still lists only Llama 3.x/Hermes/DeepSeek-R1-distill; JSON mode **cannot stream** and can error "JSON Mode couldn't be met" [S json-mode]. Newer models expose `response_format`/tools in their model pages but not a formal guarantee: treat as best-effort and always parse + validate + fall back. Verify the exact model IDs/prefixes in the dashboard before coding (catalog page gave short names).

### Neuron costs for this use (E)
Prompt per call: system (400 tok) + fact cards for a 5-10 s telemetry window (600-1000 tok) + user question => ~1.5k in, ~150 out.
- gemma-4-26b-a4b: 1.5k*9,091/1M = 13.6 + 150*27,273/1M = 4.1 => ~18 neurons/call => **~550 calls/day on the free 10k allowance**.
- gpt-oss-20b (reasoning low): ~27 + 4 + reasoning tokens (~300 out => 8) ~ 40 neurons => ~250 calls/day.
- llama-3.3-70b-fast: 40 + 31 = ~71 neurons => ~140 calls/day.
Paid overage: gemma 18 neurons = $0.0002/call (5,000 calls/dollar-ish). Cost is a non-issue; the **free 10k/day cap is the only constraint at a live event**, so adopt a budget guard (below) and Paid plan for the event day.
Latency [E, not published; measure]: small MoE (gemma-4-26b-a4b, 4B active) first token ~0.5-1.5 s, 150 tokens in 2-4 s with streaming; 70B several seconds. Use streaming (SSE) for text; do not use JSON mode where you want streaming. Use ONE call with structured output only for the non-streamed "tags".

### What changes when the USER drives (vs self-driving fact cards)
- Self-drive: telemetry is deterministic, the narrative is about the road/suspension. Fact cards computed from stateAt(t) are always correct and the LLM only verbalises.
- Manual: the cause of an event is partly the driver. Needs new fact types computed in sim-core (not by the LLM): driver-input facts (brake pressure peak/time, steer rate, throttle lift mid-corner), event detectors with timestamps (understeer: yaw-rate gap vs neutral-steer model; oversteer; wheel lift/unloaded tyre; bottoming/ bump-stop hit; slip-limit saturation; ABS-like lock), and a **counterfactual card** ("at the same input the multi-link reference path would have ...") computed client-side by section 2 replay. The LLM must never infer causes from raw numbers; it only selects/explains detected events. This is the grounding guarantee: "every sentence cites a card id".
- Trigger model: event-driven (an event detector fires, or user taps "Ask engineer"), NOT continuous. Windowed context of last ~8 s, downsampled (10 Hz, key channels) => <=1k tokens.
- Output contract: `{headline, cause_card_ids[], advice}` validated; reject any claim citing a card id not in the window; fall back to a template string. A template-only "engineer" (no LLM) for common events should be the default path with the LLM as enhancement: zero cost, zero latency, honest.
- Safety/honesty: system prompt states this is a simplified model; no claims about real-vehicle absolute performance; tone "approximate".
- Function calling: not needed. Pre-computed fact cards in the prompt beat tool calls (one round-trip, lower latency). Only use tools if you want the LLM to *request* a counterfactual replay; skip for v1.

### AI Gateway and guardrails
- Route via AI Gateway (free): **caching** is valuable for demo (same preset question + same event hash => cached answer; add a quantised event key so identical-ish events collide); **rate limiting** (per-gateway) as second line; analytics free. Legacy logs capped 100k on Free; logs on newly created gateways follow Workers Logs rules.
- Guardrails (Llama Guard) are billed as extra inference on every prompt and response; the prompt is system-controlled with numeric cards, so the injection surface is just the optional free-text question. Skip Guardrails; instead disallow free text in v1 (preset chips: "why did it understeer?", "what changed?"), or cap length 200 chars and strip. Add if free text ships.
- Budget guard: count neurons per day in a DO/D1 row (or Analytics Engine), degrade to template responses when > 80% of 10k.

## 4. Vectorize / AI Search for a vehicle-dynamics knowledge base
Verdict: **skip RAG for v1.** Reasons: (a) corpus is tiny and curated (maybe 30-80 short cards: understeer, load transfer, camber thrust, roll centre ...): fits in 6-10k tokens, i.e. one static system-prompt block inside Gemma's 256k window. At 9,091 neurons/M that is ~90 neurons/call if included in full each call, or use AI Gateway cache / select 3-5 cards by deterministic event-type key => ~0 retrieval cost; (b) retrieval adds latency, a failure mode and an embedding dependency; (c) accuracy/honesty is better with hand-authored cards keyed by detector id than with semantic retrieval; (d) AI Search billing starts 2026-12-01 and Free has only 1,000 queries/month, Vectorize Free is ample (5M dims; 80 cards x 768 dims = 61k) but gains nothing. Revisit only if the KB grows to hundreds of docs or you add free-text Q&A ("ask anything about suspension"); then AI Search with built-in storage (no R2 needed) is the lowest-effort route; mind 1k free queries/mo and $0.75/1k beyond.

## 5. Anonymous aggregate "crowd insight"
- **Analytics Engine: adopt (optional, small).** `env.AE.writeDataPoint({indexes:[suspensionType], blobs:[carId, simVersion], doubles:[entrySpeed, peakLatG, ...]})` from the Worker on a run-end beacon. Free: 100k points/day, 10k SQL queries/day, 3-month retention, no billing yet. Query via SQL API (`POST /accounts/{id}/analytics_engine/sql`, needs API token): histogram with `quantileWeighted` / bucket `intDiv(double1, 2)`, weight by `_sample_interval` because of sampling (docs: use `SUM(_sample_interval * x)`). One data point per lane-change event (not per frame) => well under 250/invocation.
- Architecture: Worker `GET /api/insight?metric=lcEntry` runs the SQL with a server-held token, caches 5-15 min (Cache API or KV 60 s+ TTL), returns precomputed buckets; browser never sees token. Keep SQL queries to ~1 per 5 min per metric => trivial vs 10k/day.
- Honesty: crowd data is of a simplified simulator driven by whoever visited; label "how visitors drove this model", never a real-world statistic. Minimum-n threshold (hide if < 30 samples).
- Privacy: no IP, no ids, bucketed values; only suspension type + car + numbers. No consent banner needed if truly anonymous, but state it.
- **Pipelines: skip.** Paid-only, sinks to R2/Iceberg (R2 not enabled), overkill.
- Alternative: DO SQLite counters per (suspension, bucket) = exact, strongly consistent, no sampling; but costs rows written (100k/day free) and a single-object hot spot; Analytics Engine is the right tool.

## 6. Write-endpoint protection (POST /api/runs, /api/stats, /api/engineer)
Layered:
1. **Turnstile** (free, unlimited): invisible/managed widget before the first write of a session; Worker calls `siteverify` with the token + secret. Tokens are single-use, 300 s validity [E, from memory of docs; verify]. Gate only share-save and engineer (not stats beacon; stats beacon is cheap and rate-limited).
2. **Workers Rate Limiting binding** (code-level, key per IP or per Turnstile-cleared session): `limit:10, period:60` per key for engineer; `limit:5, period:60` for run saves. Note per-location, approximate, 10 or 60 s windows only; the plan availability is not stated on the page, so verify it works on Free in a deploy test before relying on it. For hard global limits (the neuron budget, daily save cap) use a single DO counter or a D1 row.
3. **WAF rate limiting rule** (Free: 1 rule, IP-only, 10 s): needs the Worker on a zone (custom domain). If we are on `*.workers.dev` only, WAF rules do not apply. If a zone exists, use the one free rule on `/api/*` POST as a coarse backstop.
4. Request hygiene: `Content-Length` cap (reject > 64 KB before parsing), strict content-type, CORS to own origin, no cookies.
5. Daily global kill switch: D1/DO counter; when saves > N/day or neurons > 80%, return 503/template mode.

## 7. Workflows / Queues / Cron
- **Cron Triggers: adopt** for cleanup. One daily cron (`0 4 * * *`): `DELETE FROM runs WHERE expires_at < ?` (D1). Free: 5 triggers, 10 ms CPU per invocation: a single DELETE with LIMIT 1000 loop is fine since D1 time is wait, not CPU. Also zero daily counters.
- **Queues: skip** (24 h retention, 10k ops/day free, no consumer need; AE/D1 writes are small and can use `ctx.waitUntil`).
- **Workflows: skip.** Nothing long-running/multi-step; Free caps compute 10 ms/step.
- KV TTL alternative removes even Cron if blobs live in KV.

## Costs summary (event of ~500 drivers, 1 day) [E]
- Saves 500 (D1 ~500 rows written, ~5 MB), Workers requests ~20k, AI ~2,000 calls x 18 neurons = 36k neurons => exceeds free 10k by 26k => $0.29 on Paid (or degrade to templates on Free). AE ~3k points. Total <= $5/mo Workers Paid minimum. On Free it still works if AI is budget-guarded.

## Recommendation for Suspension Lab
1. ADOPT input-log replay (60 Hz inputs, delta+RLE+gzip, ~2-5 KB/min [E]) + keyframe snapshot every ~5 s; version-stamp with `simVersion`; label as re-simulation.
2. ADOPT D1 as the only server store for shared runs (index + <=64 KB gzip BLOB, 30-day `expires_at`); skip R2, skip DO for storage; KV only as optional cache.
3. ADOPT URL-fragment sharing for short runs (zero backend) as the default, server share for longer ones.
4. RISK: cross-browser float determinism of Math.sin/cos/etc; mitigate with keyframes, own trig in sim-core, and a multi-browser hash CI test before promising exact replay.
5. ADOPT client-side A/B (three suspensions replayed in parallel/Web Worker); never compute in a Worker (10 ms CPU free). Show both open-loop ("your inputs") and closed-loop ("same path") and say they differ.
6. ADOPT race engineer as template-first, LLM-enhanced: event detectors + fact cards computed in sim-core; Workers AI `gemma-4-26b-a4b-it` (256k ctx, tools, $0.10/$0.30 per M, ~18 neurons/call => ~550 calls/day free) streamed via AI Gateway with caching; fallback to template on error/budget.
7. Add driver-input facts and counterfactual replay cards; the LLM only explains detected events and must cite card ids (validate output; reject uncited claims).
8. SKIP function calling and JSON mode for v1 (JSON mode cannot stream; only older models documented); use streamed prose plus a small validated header from cards.
9. SKIP Guardrails (extra Llama Guard inference cost) by using preset question chips; revisit if free text ships.
10. SKIP Vectorize/AI Search for now: curated cards (<10k tokens) in prompt, keyed by detector. Revisit at hundreds of docs or free-text Q&A (AI Search bills from 2026-12-01).
11. ADOPT Analytics Engine for crowd insight (one point per event; weight by `_sample_interval`; server-side cached SQL, min-n 30, anonymous). SKIP Pipelines (Paid + R2 sinks).
12. ADOPT Turnstile (free) + Rate Limiting binding on write endpoints, with a DO/D1 global daily cap; verify the binding works on Free; WAF free rule only if a custom zone exists (IP-only, 10 s, 1 rule).
13. ADOPT one daily Cron for D1 TTL cleanup; SKIP Queues and Workflows.
14. Buy Workers Paid ($5/mo) for the live event: removes KV 1k-write cap, 10 ms CPU cap, and 10k-neuron cap; otherwise stay Free with the budget guard.
15. VERIFY before build (docs pages were summarised by a fetch model, some items unconfirmed): exact Workers AI model ID strings, Turnstile token TTL, Rate Limiting binding Free availability, AI Gateway log retention under the post-2026-09-24 rules.
