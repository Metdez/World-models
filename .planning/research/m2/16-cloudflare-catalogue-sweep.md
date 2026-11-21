# 16 - Cloudflare catalogue sweep for Suspension Lab (Manual Drive)

Date of sweep: 2026-11-21. Method: WebFetch of developers.cloudflare.com pages. Firecrawl returned 503 for every call; Tavily was not used. The blog tag page was stale (it only showed Developer Week 2025), so "new since mid-2026" flags come from the changelog (only 17-20 Nov 2026 was visible) and from pricing pages that name 2026 dates.
Tags: [S] = read on the cited docs page this session (developers.cloudflare.com/<product>/...). [E] = estimate or prior knowledge, verify before relying on it.
Free-tier numbers apply to Workers Free unless noted. The lab is a static three.js app on Workers Static Assets, so almost every product is optional.

## Product table

| Product | What it is now | Free-tier limits | Verdict for this product |
|---|---|---|---|
| Workers | Serverless JS/TS/Wasm runtime. | 100k req/day, 10 ms CPU/req, 128 MB, 50 subrequests, 100 Workers [S workers/platform/limits] | ADOPT (already live). Keep API routes tiny. |
| Static Assets | Asset hosting inside a Worker. `run_worker_first` accepts path patterns such as `["/api/*"]` [S]. | 20,000 files/version, 25 MiB per file, 100 `_headers` rules [S] | ADOPT (already live). Use `_headers` for immutable-cache of hashed JS/glb/KTX2 and the right wasm MIME type. A 25 MiB per-file cap rules out one huge asset. |
| Pages | Older static host. The docs now say Workers and Pages keep versions for 30 days (changelog 19 Nov 2026) [S]. | n/a | SKIP. Workers Static Assets is the path forward [E]. |
| Durable Objects | Stateful single-instance compute with SQLite storage and hibernating WebSockets. | 100k req/day (WS messages count), 13k GB-s/day, 5M rows read, 100k rows written, 5 GB; SQLite backend only [S durable-objects/platform/pricing] | MAYBE. Use as a "presenter room" that relays tuning-panel and camera state from the presenter to audience screens. Free WS message budget is tight, so relay at 5-10 Hz, not 60. Improved reliability during runtime updates (19 Nov 2026) is a recent change. |
| D1 | Serverless SQLite. | 5M rows read/day, 100k rows written/day, 5 GB, 10 DBs [S d1/platform/pricing] | MAYBE. Use for a lap-time or "best smoothness" leaderboard. Writes are ample for a demo. |
| KV | Global eventually-consistent key-value store. | 100k reads/day, 1k writes/day, 1 GB [S kv/platform/pricing] | MAYBE. Use for read-mostly config such as presets or feature flags. Writes are too scarce for telemetry. |
| R2 | S3-compatible object storage, no egress fees. | 10 GB-month, 1M Class A, 10M Class B per month, egress free [S r2/pricing] | MAYBE. Use for large car and road assets, recorded run files and share images. A Workers binding in front of it adds cache control. |
| Hyperdrive | Connection pooling and caching for external Postgres/MySQL. Changelog 18 Nov 2026 adds PlanetScale and Workers VPC mTLS [S]. | not read | SKIP. There is no external SQL. |
| Queues | Message queue. | 10k operations/day, 24 h retention [S queues/platform/pricing] | SKIP. Nothing to queue. |
| Workflows | Durable multi-step execution. | 100 concurrent instances, 100k executions/day, 3-day state retention [S workflows/reference/limits] | SKIP. Only worth a look for a batch share-card pipeline, and that is better done inline. |
| Pipelines | Streaming ingest into R2/Iceberg with SQL transforms. | Workers Paid only; 50 GB/month included [S pipelines/platform/pricing] | SKIP. Overkill for telemetry. |
| Analytics Engine | Time-series store with SQL queries. | Limits: 250 data points per invocation, 3-month retention [S analytics-engine/limits]. Free-tier size not stated on the page. | MAYBE. Use for anonymous "demo telemetry": fps buckets, GPU class, Manual vs Auto time. This tells us whether 60 fps holds on real devices. |
| Workers AI | Serverless inference. | 10,000 Neurons/day [S workers-ai/platform/pricing]. Newest large models are paid-only. | MAYBE. Use an optional "explain this run" caption from the telemetry summary. It must be labelled as AI commentary, not engineering data, which fits the honesty rule. Not core. |
| AI Gateway | Proxy for LLM calls with caching, rate limits and analytics. Core features are free [S ai-gateway/reference/pricing]. Gateways first created on or after 24 Sep 2026 use Workers Logs pricing. This is a recent change. | Legacy logs: 100k total on Free [S] | SKIP unless Workers AI or an LLM call is adopted. |
| Vectorize | Vector database. | 5M stored dims, 30M queried dims/month [S vectorize/platform/pricing] | SKIP. |
| AI Search (AutoRAG) | Managed RAG. Usage-based billing begins 1 Dec 2026, and 17 Nov 2026 added file summaries during indexing [S ai-search/platform/limits-pricing]. | 1,000 semantic queries/month, 5M ingestion tokens, 10 GB [S] | SKIP. A possible later add-on is a docs chatbot over the engineering notes. |
| Agents SDK | An agent is a Durable Object with state, scheduler, voice and MCP client. | no free-plan statement on the page [S agents/] | SKIP. No agent use case. |
| Browser Run (formerly Browser Rendering) | Headless Chrome. Quick Actions: screenshot, PDF, snapshot, markdown. Sessions via Puppeteer or Playwright. 19-20 Nov 2026 changelog added `/snapshot` and `/script` [S browser-run/]. | 10 min/day, 3 concurrent, 1 Quick Action per 10 s, 1 new browser per 20 s [S browser-run/limits] | ADOPT, with a caveat. Use for share-card images (see rec 3). The Quick Action rate limit makes it fine for a demo but not for bursts. WebGL in a headless GPU-less Chrome is unverified [E], so prefer client-side canvas capture and use this only as a fallback or for the OG image of a page. |
| Containers | Linux containers controlled from Workers. | Not on Free; Workers Paid $5/mo with 25 GiB-h, 375 vCPU-min [S containers/pricing]. Inbound TCP and gRPC in public beta, 19 Nov 2026 [S changelog]. | SKIP. |
| Sandboxes | Isolated untrusted-code runtime (Containers or Dynamic Workers). Workers Paid [S sandbox/]. | Paid | SKIP. |
| Realtime SFU / TURN | WebRTC SFU and TURN. | 1,000 GB/month shared, then $0.05/GB [S realtime/sfu/pricing]. RealtimeKit was not covered on the page. | MAYBE. Use to stream the presenter's WebGL canvas to a remote audience with ~sub-second latency, instead of screen-sharing. Needs `captureStream`, then WHIP/SFU. Medium effort and only matters for remote events. |
| Stream | Video storage, encoding and delivery. Low-latency HLS B-frame detection added 19 Nov 2026 [S changelog]. | No free tier. Storage $5 per 1,000 min, delivery $1 per 1,000 min [S stream/pricing] | MAYBE. Use for recorded replays of Manual runs. A cheaper alternative is a client `MediaRecorder` webm uploaded to R2. |
| Images | Transformations, storage and delivery. 19-20 Nov 2026 added sharpening and delivery analytics [S changelog]. | 5,000 unique transformations/month on Free [S images/pricing] | MAYBE. Use for resizing share-card thumbnails and OG images stored in R2. |
| Email (Email Routing / Email Service) | Inbound routing, outbound send from Workers [E]. | not read | SKIP. |
| Turnstile | Free, privacy-friendly CAPTCHA. | 20 widgets, 10 hostnames, unlimited challenges, 7-day analytics [S turnstile/plans] | ADOPT only if a public write endpoint exists, such as a leaderboard POST. Otherwise SKIP. |
| Web Analytics | Cookieless RUM and page analytics. | Free [E] | ADOPT. It gives Core Web Vitals and visit counts with no cookie banner, and needs no code beyond a beacon or auto-injection. |
| Zaraz | Server-side third-party tag manager. | Free tier [E] | SKIP. |
| Observability (Workers Logs, Tail Workers, Traces) | Logs with a Logpush or OTel export. | 200k log events/day, 3-day retention [S workers/observability/logs/workers-logs] | ADOPT. Set `observability.enabled = true` for the API routes. Tail Workers are not needed. |
| Secrets Store | Account-level secret storage [E]. | not read | SKIP. |
| Workers for Platforms | Multi-tenant dispatch namespaces. Changelog 20 Nov 2026: namespaces can no longer be renamed [S]. | Paid [E] | SKIP. |
| Smart Placement | Runs the Worker near its backend instead of the user. | Free [E] | SKIP. There is no backend latency to cut. |
| Cache / Cache Reserve | Edge caching. Cache Reserve is paid. | n/a | ADOPT the basic cache, via `_headers` or Cache-Control on the R2 or asset route. SKIP Cache Reserve. |
| Speculation Rules / Early Hints | Prefetch and 103 hints. Early Hints is a zone feature [E]. | Free | MAYBE. A `<link rel=preload>` for the main JS and the car glb is enough. Early Hints needs a custom domain zone and was not verified [E]. |
| Snippets | Small edge request-rewrite code. | Free-plan availability not verified [E] | SKIP. Workers already cover it. |
| Waiting Room | Queues visitors during traffic spikes. | Business or Enterprise only [S waiting-room/] | SKIP. A static asset app scales without it. For an event spike, the Workers free quota of 100k req/day is the real limit. |
| Access / Zero Trust | Identity-gated access to apps. | Seat limit on Free was not confirmed this session (roughly 50 users [E]). | ADOPT for the presenter page only, if one exists. Put Access on `/presenter` or `/remote`, with a one-time-PIN or Google login. Roughly 30 minutes of effort. |
| Custom domains | Attach a hostname to a Worker. | Free | ADOPT if a vanity URL is wanted. It also enables Cache, Early Hints and Access policies. |
| Cloudflare CLI `cf` | Unified CLI, 1.0 release candidate on 17 Nov 2026 [S changelog]. | n/a | MAYBE. Dev-tooling only. Wrangler still works. |
| Workers VPC | Private connectivity to other clouds [S]. | n/a | SKIP. |

## New since mid-2026 (changelog, 17-20 Nov 2026 only)

- Browser Run was renamed from Browser Rendering and gained `/snapshot` (PDFs, links, scraped elements, JSON) and `/script` for custom Playwright, Puppeteer or CDP code over HTTP.
- AI Search billing starts 1 Dec 2026.
- AI Gateway has new log pricing for gateways created on or after 24 Sep 2026.
- Inbound TCP and gRPC for Workers and Containers is in public beta.
- Workers and Pages keep versions for 30 days.
- Hyperdrive works with PlanetScale and Workers VPC mTLS.
- Cloudflare CLI `cf` has a 1.0 release candidate.
- Stream gained B-frame detection for LL-HLS.
- Images gained sharpening and delivery analytics.
- Durable Object reliability during runtime updates improved.

Anything between Aug and Oct 2026 could not be checked: the changelog page only showed 17-20 Nov, and the blog tag listing was stale.

## Top 8 recommendations, ranked by user-visible value per effort

1. **Cache headers for assets (ADOPT, about 1 h).** Hashed, immutable caching for JS, glb and textures through Static Assets `_headers`, plus preload links. This gives the biggest first-load win at an event with many people on one network.
2. **Workers Logs + Web Analytics (ADOPT, about 30 min).** Both are free and need no cookies. They give real device and vitals data and let us see how a demo went.
3. **Share-card image of a run (ADOPT, about 0.5-1 day).** Capture the canvas client-side (`toBlob`) at the end of a Manual run (time, peak lateral g, suspension type), upload it to R2 behind a Worker route, and serve it as the OG image of a share URL. Use Browser Run only for the fallback OG screenshot, because it allows 10 min/day and one Quick Action per 10 s on Free [S].
4. **Access on the presenter remote (ADOPT, about 30 min).** Protect `/presenter` with Access, if the live-event presenter control exists. It stops audience members changing the car mid-demo.
5. **Durable Object presenter room (MAYBE, about 1-2 days).** Mirror the presenter's suspension type, camera and tuning to audience screens. Throttle to 5-10 Hz to stay under 100k requests/day [S].
6. **Analytics Engine demo telemetry (MAYBE, about 0.5 day).** Log anonymous fps bucket, GPU string and Manual versus Auto usage. This tells us where the 60 fps target fails. It needs a consent line in the UI.
7. **D1 leaderboard with Turnstile (MAYBE, about 1 day).** Add it only if a competitive hook is wanted. It adds a public write endpoint, so Turnstile is required. The brief says "no racing-game systems", so it is probably off-brief.
8. **Realtime SFU canvas broadcast (MAYBE, about 2-3 days).** Stream the presenter's canvas to remote viewers via WebRTC, which is better than screen-share for hybrid events. It is a large effort for a niche case.

Not worth it: Containers, Sandboxes, Workflows, Pipelines, Queues, Vectorize, AI Search, Agents SDK, Waiting Room (Business plan), Hyperdrive, Workers for Platforms.

## Recommendation for Suspension Lab

- Stay on Workers Static Assets. Do not migrate to Pages [S: Pages and Workers version retention note; Pages direction is [E]].
- Do the free, no-code items first: `_headers` caching, Workers Logs (`observability.enabled`), Web Analytics, a custom domain.
- Keep `sim-core` free of Cloudflare imports. Any Cloudflare use (share, room, telemetry) belongs in swappable feature modules behind an interface, so the app still runs fully offline and on a plain static host.
- Free-tier ceilings that matter at an event: Workers 100k req/day and 10 ms CPU, DO 100k req/day, KV 1k writes/day, Browser Run 10 min/day. Static asset requests are the thing to check. I did not confirm from the docs whether they count against the 100k/day; read "Billing and limitations" before an event [E].
- Prefer client-side capture for share cards and replays (`canvas.toBlob`, `MediaRecorder`) over server-side rendering. A headless Chrome without a GPU is not a safe way to render a WebGL scene [E], and Stream has no free tier [S].
- Any AI-written caption must be labelled as AI commentary and must never present approximate handling as engineering data.
- Do not add a public write endpoint without Turnstile and a rate limit.
- Risks: Firecrawl was down and the Aug-Oct 2026 changelog was not visible, so some mid-2026 launches may be missing. Re-check the table rows tagged [E] (Access seats, Web Analytics, Early Hints, Snippets, Smart Placement) before committing.
