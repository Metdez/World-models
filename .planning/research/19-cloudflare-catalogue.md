# 19 - Cloudflare catalogue (as of 2026-11-20) and verdicts for Suspension Lab

Sources (opened this session): developers.cloudflare.com/products/ (full catalogue), per-product pricing pages (Workers, DO, KV, R2, D1, Queues, Workflows, Workers AI, AI Gateway, Vectorize, Containers, Browser Run, Realtime SFU, Email Service, Images, Stream, Hyperdrive, Turnstile, Analytics Engine, Rate Limiting binding, Static assets, Speed Brain, Cache Reserve, Workers Logs), blog.cloudflare.com/birthday-week-2026-wrap-up/ (Sep 28-Oct 2 2026, 46 launches), blog.cloudflare.com/agents-week-in-review (Apr 2026). Items marked (unverified) come from prior knowledge or secondary sources and were not confirmed on a primary page today. There was NO "Developer Week 2026"; the 2026 launch events were Agents Week (Apr 12-17) and Birthday Week (Sep 28-Oct 2).

## 0. Naming changes to know (the catalogue has been renamed a lot)
- Browser Rendering is now **Browser Run** (Agents Week). Cloudflare One Client = formerly WARP client.
- Pipelines / R2 Data Catalog / R2 SQL are now **Basin Pipelines / Basin Catalog / Basin SQL** (umbrella "Basin", GA Oct 1 2026; billing on since Aug 3).
- Privacy Gateway is now OHTTP Relay. Pages is still available on all plans but docs say "start new projects on Workers" (migration guide to Workers static assets); no sunset date.
- Constellation and Pub/Sub are absent from the 2026 product list (treat as retired/folded into Workers AI; unverified). Do not plan on them.

## 1. Plan summary: Free vs Workers Paid ($5/mo)
Free (hard caps, reset 00:00 UTC; failures not overage): Workers 100k req/day, 10 ms CPU/invocation; Static Assets free and unlimited on all plans; DO (SQLite-backed only) 100k req/day, 13k GB-s, 5M rows read, 100k rows written, 5 GB; KV 100k reads/1k writes per day, 1 GB; R2 10 GB, 1M Class A, 10M Class B, zero egress; D1 5M rows read/100k written per day, 5 GB, 10 DBs; Queues 10k ops/day, 24 h retention; Workflows 3,000 steps/day, 3-day retention, CPU 10 ms; Workers AI 10,000 neurons/day; AI Gateway core features free on all plans (legacy log cap 100k); Vectorize 5M stored / 30M queried dims; Hyperdrive 100k queries/day; Workers Logs 200k events/day, 3 d retention; Analytics Engine 100k datapoints/day writes, 10k read queries/day (not currently billed); Browser Run 10 min/day, 3 concurrent; Images transformations of external/R2 images 5,000 unique/month free (storage in Images is paid); Turnstile free (20 widgets); Email Routing free and unlimited; Email Service sending only to verified destinations on free; Realtime SFU/TURN 1,000 GB/month free egress (shared); Speed Brain on by default on Free; Pages 500 deploys/month.
Workers Paid ONLY: Containers and Sandboxes (Sandbox SDK), Email Service sending to arbitrary recipients (3,000/mo incl.), Cache Reserve, Stream (prepaid storage, delivered $1/1000 min; plan tier not stated on page; assume paid), larger DO/KV/D1/Queues/AI quotas (AI over 10k neurons/day), Workers CPU up to 5 min, some big Workers AI models (Kimi K2.6, GLM-5.2, DeepSeek V4 Pro need Paid or AI Gateway credits), Workers Logs 7-day retention, Workflows 500k steps/mo (step billing from Aug 10 2026), Dynamic Workers/Artifacts/Flagship (plan not stated on docs, verify).
Bottom line: a complete, impressive demo fits on FREE except the Containers/Sandbox/Email-send ideas. $5 Paid is cheap insurance for a live event (removes daily hard caps: a hard-cap 429 mid-keynote is the real risk). Recommendation: subscribe to Paid before the event day, even if everything fits free.

## 2. Catalogue with verdicts

Legend: USE NOW (core), STRETCH (optional/nice, only if time), N/R (not relevant). Plan: F = works on free, P = needs Workers Paid.

### Developer platform
| Product | What it is | Verdict | Reason / feature idea | Plan |
|---|---|---|---|---|
| Workers | V8-isolate serverless compute at 300+ POPs | USE NOW | Thin API (share, stats, AI, WS routing) | F (100k req/day) |
| Static Assets (Workers) | Asset hosting inside a Worker; static requests free/unlimited, auto edge cache | USE NOW | Ship the Vite/Three.js bundle, textures, GLB/KTX2/Draco models; use immutable hashed filenames + `Cache-Control: immutable`. Range requests return full 200 unless routed via Worker (matters for large video). | F |
| Pages | Git-connected static+Functions hosting | N/R | Superseded by Workers static assets for new projects | F |
| Workers for Platforms / Cloudflare for Platforms | Multi-tenant: run customer code per tenant | N/R | No tenant code | P |
| Cloudflare for SaaS | Custom hostnames for customers | N/R | Single product | - |
| Durable Objects (SQLite) | Single-threaded stateful actors with WebSockets, hibernation, storage | USE NOW | "Live lab room": one DO per room code holds suspension selection, track position/time, shared camera, presenter state; WS Hibernation means idle rooms cost nothing; incoming messages billed 20:1. Also a strict global counter for crowd stats. | F (SQLite only) |
| KV (and KV Instant, sub-2ms p99 reads, Oct 2026) | Global key-value, eventually consistent | USE NOW (light) | Config/feature switches, cached "top setups" snapshot, short-link lookup for shares. KV writes cap on free is 1k/day, so do not write per user action. | F (limited) |
| R2 | S3-compatible object store, zero egress | USE NOW | Store heavy assets (GLB, KTX2 textures, HDR env maps, hero video) and generated share-card PNGs. Public custom domain gets CDN cache. | F (10 GB) |
| D1 | Serverless SQLite | STRETCH | Persist shared setups + aggregate stats history. Could instead use DO SQLite; D1 gives query/inspect convenience and read replication. Pick one: prefer D1 for shareable-setup records, DO for live state. | F |
| Queues | Message queue, no egress fees | STRETCH | Async: render share-card, batch-flush stats. Only if rendering is slow; otherwise `ctx.waitUntil`. Adds a moving part. | F (10k ops/day) |
| Workflows | Durable multi-step execution (50k concurrency after Apr 2026 control-plane rewrite) | N/R | No long-running pipeline. Possible "post-event report" job; not worth it. | F (3k steps/day) |
| Hyperdrive | Pooled/cached access to external Postgres/MySQL (PlanetScale integration new) | N/R | No external DB | F |
| Vectorize | Vector DB | N/R | No semantic search. (Only if "ask the lab" RAG over a physics corpus; use AI Search instead.) | F |
| Workers AI | Serverless GPU inference (LLMs gpt-oss-20b, Llama 3.1 8B, Flux, Whisper, Deepgram Aura/Nova, MeloTTS) | USE NOW | "AI race engineer": send compact telemetry (camber, roll, bump-steer values, selected suspension) and get a 2-3 sentence plain-language explanation of why the car behaves that way; optional TTS voice (MeloTTS ~19 neurons/min, very cheap). Always pre-generate/cached text fallbacks. | F 10k neurons/day (a 150-token reply on llama-3.1-8b is roughly 5-6k neurons per M output tokens ~ <10 neurons per reply; fine), P for more |
| AI Gateway | Proxy/observability/caching/rate-limit for model calls; Auto Router, User Insights (Sep 2026) | USE NOW | Put in front of Workers AI: cache identical (setup, event) prompts so 1,000 audience members cost one inference; rate-limit; log. Free core features. | F |
| AI Search (ex AutoRAG; GA Oct 2026) | Managed RAG over files in R2 | STRETCH | Index a small curated suspension-theory markdown corpus so the race engineer cites facts instead of hallucinating. Real value for accuracy ("honest tradeoffs"); but a static 2-3 KB system prompt per suspension type achieves 90% of it. | "All plans" (limits unverified) |
| Agents SDK (Project Think preview, Apr 2026) | Agent = Durable Object with state, WS, scheduler | STRETCH | Race-engineer as an Agent holding conversation state per session; Agent class gives sync state + WS free. Think is preview; API churn risk (docs say Pi harness experimental). Use plain DO + Workers AI first. | F/P |
| Agent Memory, Agent Lee, AI Crawl Control, Web Search API, Cloudflare OS, Clef | Agent/AI platform items | N/R | | - |
| Browser Run (ex Browser Rendering; Quick Actions /screenshot, Puppeteer/Playwright, Live View, Kitesurf) | Headless Chrome as a service | STRETCH | Server-render a real 3D share-card? Headless WebGL in a cloud browser is slow/flaky (software GL) and burns browser-hours (Free 10 min/day). Prefer client-side canvas capture uploaded to R2 or an SVG/satori-based card in the Worker. Test before committing. | F (10 min/day), P (10 h/mo) |
| Containers | Docker containers orchestrated by DO, rebuilt Sep 30 2026 | N/R | The physics sim runs client-side; no server workload | P |
| Sandboxes / Sandbox SDK / Dynamic Workers | Isolated code exec for agents | N/R | We run no untrusted code. (A "write your own damper curve" playground could use Dynamic Workers; out of scope.) | P |
| Realtime SFU / TURN / RealtimeKit (Calls) | WebRTC infrastructure | N/R (STRETCH for voice presenter) | Presenter voice/video is better done via the event's own AV. Data sync is WebSocket over DO. | F (1,000 GB/mo) |
| Stream / MoQ | Video storage, encode, delivery, live | STRETCH | Only if we ship pre-recorded hero/b-roll video; otherwise a small MP4 in R2 is enough. Stream gives adaptive bitrate for a big cinematic loop; costs $5/1000 stored min. | P (assumed) |
| Images / Media Transformations | Resize, format-convert, transform | STRETCH | On-the-fly AVIF/WebP variants of share-card/hero stills from R2 (5,000 unique free). Lets one source JPG serve every viewport. | F (transform), P (storage) |
| Workers Analytics Engine | High-cardinality time series write from Worker, SQL read | USE NOW | Anonymous aggregate stats: one datapoint per "suspension chosen / track corner / vehicle" with blobs; powers "what the crowd picked" bars and an ops dashboard via SQL API. Not billed currently. | F |
| Web Analytics | Cookieless RUM | USE NOW (free, one toggle) | Core Web Vitals/load times by country; verifies the heavy-asset experience at the event | F |
| Observability: Workers Logs, Traces (Oct 2026), Issues (Sep 2026), Tail Workers, Logpush, Log Explorer | Logs/traces/error grouping | USE NOW (Logs + Issues), N/R rest | Turn on `observability.enabled`; 200k events/day free: sample at 10-20% if expecting a crowd. Workers Logs pricing moves to Cloudflare Observability pricing Dec 1 2026 (verify). | F (3 d), P (7 d) |
| Basin (Pipelines, Catalog, SQL), K2 event streams | Event ingest to Iceberg on R2, query with SQL | N/R | Analytics Engine is simpler for our scale | billed since Aug 3 2026 |
| Secrets Store | Account-level shared secrets | N/R | Plain Worker secrets suffice (we hold maybe one key) | F (beta/limits unverified) |
| Email Routing / Email Workers / Email Service | Inbound routing (free); transactional send (public beta since Apr 2026) | N/R (STRETCH) | "Email me this setup" is a nice-to-have, adds spam/abuse and deliverability burden; sends to arbitrary recipients need Paid. Skip. | Routing F; send P |
| Flagship | Edge feature flags (binding + OpenFeature) | STRETCH | Kill-switch/live toggle (disable AI, enable stats, swap hero) during the demo without redeploy. KV does the same; use KV first. | unverified |
| Artifacts | Git-compatible storage for agents | N/R | | - |
| Workers VPC / Mesh / Tunnel | Private networking | N/R | | - |
| Cloudflare CLI (`cf`) / Wrangler / Terraform / Pulumi | Tooling | USE NOW (Wrangler only) | `wrangler deploy`, preview URLs for staging; keep a rollback version ready | F |
| Rate Limiting binding | `env.RL.limit({key})`, 10 s or 60 s windows, per-location, eventually consistent | USE NOW | Guard AI endpoint and share creation per session key. Approximate per colo; fine for abuse control. Not visible in dashboard; log 429s. | plan unstated; GA, assume F |
| Turnstile | Invisible CAPTCHA | STRETCH | Only on share-creation/AI endpoints if bots appear. Invisible mode, free, no PII. Avoid UI friction at a live demo. | F |
| Constellation, Pub/Sub | Retired/absent | N/R | | - |
| Web3 gateways, OHTTP, Wallets, Monetization Gateway, Pay Per Use | | N/R | | - |

### Performance, security, network
| Product | Verdict | Note |
|---|---|---|
| Cache / CDN (automatic, Cache API, Cache Rules) | USE NOW | Heavy assets cached at edge with `immutable`; custom domain required for R2 public caching. Free. |
| Tiered Cache (Smart Tiered Cache) | USE NOW (if on a zone) | Free-plan available per prior knowledge (unverified today); reduces R2/origin misses worldwide. Requires a zone on custom domain, not `*.workers.dev`. |
| Cache Reserve | N/R | Paid; unnecessary, R2/Static Assets are the origin already |
| Argo Smart Routing | N/R | Paid per-GB; sim is mostly static |
| Early Hints (103) | STRETCH | Free; preload hints for the main JS/GLB; browser support Chromium-only reliable; test with Lighthouse |
| Speed Brain / Speculation Rules | N/R (low) | Prefetches next navigation; our app is a single page. Default-on on Free anyway; harmless |
| Smart Shield, Health Checks, Load Balancing | N/R | No origin |
| WAF (managed rules, custom rules), Bots/Bot Management, DDoS | USE NOW (defaults only) | Free managed DDoS + Free WAF default ruleset on a zone; do not hand-tune. Bot Fight Mode: DISABLE or test carefully; it can challenge legitimate demo traffic and headless QA |
| Rate limiting rules (zone) | STRETCH | Alternative to the binding for a coarse safety net |
| API Shield, Fraud Detection, Leaked credentials, Client-side security, Page Shield | N/R | |
| Zaraz | N/R | No third-party tags |
| Waiting Room | STRETCH (only if a ticketed-scale audience) | Meant for ecommerce spikes; our static content absorbs spikes better |
| Access / Zero Trust / Gateway / Browser Isolation | STRETCH (one thing only) | Put the preview/staging deployment and the `/presenter` admin route behind Access (free up to 50 users) |
| Tunnel / Protected Quick Tunnels | STRETCH (dev) | `cloudflared tunnel --url` to show a localhost build on a phone; useful in rehearsals |
| DNS, SSL/TLS, Registrar (+ new Registrar API) | USE NOW | Custom domain on the Worker; Registrar at-cost for a short memorable domain (QR code on stage) |
| Snippets | N/R | Workers do everything |
| Radar, Network Error Logging, Spectrum, Magic*, WAN, BYOIP, China Network, DLS, CASB, DLP, Email security, DMARC | N/R | Enterprise/network |
| Images -> covered above | | |

## 3. Reality checks before committing (do not skip)
1. Worker-served WebSocket concurrency: one DO handles roughly hundreds-to-low-thousands of sockets (single thread). For a big audience, shard rooms (one DO per room code) or fan out presenter state via KV/polling; do not put 1,000 audience sockets in one DO.
2. Free hard caps would take the demo down mid-event: 100k Worker req/day is plenty, but DO 100k req/day with 20:1 message billing and 100k rows written are the likeliest to trip. Go Paid ($5).
3. Server-side 3D rendering (Browser Run) is the shaky claim; prototype it or drop it for client capture.
4. KV Instant, Flagship, Dynamic Workers, Artifacts docs gave no plan/pricing; treat as unverified.
5. Heavy-asset delivery needs a custom domain (zone) to get Tiered Cache, Early Hints and Cache Rules; `*.workers.dev` still gets edge caching of Static Assets but no zone features.

## 4. The 6-9 products that create real value
1. **Workers + Static Assets** - the whole app plus global edge delivery of the bundle and models (F).
2. **Durable Objects (SQLite, WebSocket Hibernation)** - live rooms / presenter remote / synchronized lab state (F).
3. **R2 (+ custom-domain CDN cache)** - heavy GLB/KTX2/HDR/video assets and generated share images, zero egress (F).
4. **Workers AI + AI Gateway** - race engineer commentary with caching and guardrails (F up to 10k neurons/day).
5. **Analytics Engine** - anonymous aggregate "crowd picked" stats + ops view (F).
6. **KV (or D1 for records)** - shareable setup storage/short links and live config toggles (F).
7. **Rate Limiting binding (+ Turnstile only if abused)** - cheap abuse protection for the AI and share endpoints (F).
8. **Web Analytics + Workers Logs/Issues** - verify real-user performance and catch errors live (F).
9. **Cache/Tiered Cache + DNS/Registrar** - zone features and a stage-friendly domain/QR (F; Registrar at cost).
Optional 10th: Images transformations for responsive share/hero images; Access for the staging/presenter route.
Deliberately excluded: Containers, Sandboxes, Workflows, Queues, Vectorize, Hyperdrive, Pipelines/Basin, Stream, Realtime SFU, Browser Run (unless prototype proves out), Email Service, Zaraz, Waiting Room, Cache Reserve, Argo.

## 5. The blended concept: what is possible ONLY because it is on the edge
Principle: the sim itself (physics, Three.js) stays 100% client-side so latency to the car is zero and the demo survives a dead network; Cloudflare adds the *shared, global and intelligent* layer on top.
1. **Globally synchronised live lab (Durable Objects).** A room code (QR on stage) puts every phone/laptop into one DO. The presenter flips MacPherson -> double wishbone -> multi-link and every audience screen crossfades in the same beat; camera preset, "x-ray" toggle, track lap-phase are synced. Each client keeps simulating locally; the DO only broadcasts tiny state messages (setup id + timestamp), so one geographic POP-agnostic coordinator, 20:1 cheap WS billing, hibernates when idle. Only practical because one DO is a single global source of truth near the presenter.
2. **Presenter remote.** `/presenter` route (behind Access or a presenter token) is a phone UI controlling the big-screen instance via the same DO: suspension switch, vehicle (car/motorcycle), track speed, "stress" bump events, reveal annotations. Zero install.
3. **Edge-cached heavy assets.** Car/bike GLB + KTX2 textures + HDRI in R2 behind the zone cache, hashed immutable names; the app shell as Static Assets. A venue full of phones hits the nearest POP; first-load is fast everywhere with no origin to protect. Early Hints/preload for the main model.
4. **AI race engineer (Workers AI via AI Gateway).** Client posts a tiny telemetry digest (suspension type, peak roll angle, camber at apex, bump-steer deg/m, lap phase). Worker builds a prompt from a fixed per-suspension fact sheet (optionally AI Search for citations) and returns 2 sentences + optional TTS audio. AI Gateway caches identical prompts so thousands of viewers on the same setup cost one inference; rate limiting protects the 10k neurons/day free budget. Must degrade to canned text.
5. **Shareable setups with rich previews.** A setup is a ~100-byte URL-safe state (vehicle, suspension, spring/damper/ARB, camera). Worker saves it (KV/D1) to a short id, serves `/s/:id` with correct Open Graph tags (`<meta og:image>`), and an image generated in the Worker (satori/resvg-wasm card, or client canvas capture uploaded to R2, or Browser Run screenshot if the prototype is reliable). Link unfurls in Slack/iMessage with the exact setup; opening it restores state. Only possible with edge-side HTML rewriting (HTMLRewriter) at the request.
6. **Anonymous "what the crowd picked" stats.** Each selection writes one Analytics Engine datapoint (no IDs, no IPs, coarse country optional). A Worker queries the SQL API every few seconds (cached 5-10 s) and the room DO broadcasts "62% prefer double wishbone for the chicane"; same data powers a post-event summary. A privacy-friendly, GDPR-light story: no cookies, no PII.
Why edge-only: a single-region server would add 150-300 ms to every interaction for half the audience, would need CDN + WebSocket server + analytics store separately; here all of it is one `wrangler deploy`, scales to zero, and costs ~$5.

## 6. Recommendations for Suspension Lab
- Build modules per feature as separate Worker routes/DO classes so each is swappable: `room` (DO), `assets` (static+R2), `ai` (Workers AI via Gateway), `stats` (Analytics Engine), `share` (KV/D1 + OG).
- Start on Free for development; move to Paid before event day (removes daily hard caps; $5).
- Single Worker with Static Assets, bindings: `ROOM` (DO), `ASSETS`, `BUCKET` (R2), `AI`, `STATS` (Analytics Engine), `SHARES` (KV), `RL` (rate limit). Custom domain via Cloudflare DNS for zone-level caching.
- AI: pin one cheap model (llama-3.1-8b-instruct-fp8-fast or gpt-oss-20b), route through AI Gateway with caching, canned fallback, and a KV kill-switch.
- Verify before the event: DO connection counts under a load test (e.g., 300 sockets), 429 behaviour, `Cache-Control` headers on R2 custom domain, Bot Fight Mode off for demo, Workers Logs sampling.
- Do not use: Containers, Workflows, Queues, Vectorize, Pipelines/Basin, Stream, Email Service, Zaraz, Waiting Room, Cache Reserve, Argo, Workers for Platforms.
- Open question to prototype: Browser Run vs client canvas for share-card images (prefer client canvas -> R2 first).
