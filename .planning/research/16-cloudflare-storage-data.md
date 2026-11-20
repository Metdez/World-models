# 16 - Cloudflare storage / media / data products for Suspension Lab

Research date: 2026-11-20. Primary sources = developers.cloudflare.com pages fetched this session (URLs inline).
"(unverified)" = not confirmed on a docs page this session; "(memory)" = from prior knowledge, re-check before relying on it.
Renames seen in current docs: Browser Rendering is now **Browser Run** (docs at /browser-run/, REST path `/browser-run/...`); Pipelines is now **Basin Pipelines**; R2 Data Catalog is now **Basin Catalog**.

## Verdict table

| Product | Verdict | Use in Suspension Lab |
|---|---|---|
| R2 | **USE** | Hosts the heavy GLB / KTX2 / HDR / track assets behind a Worker route with Range + ETag + immutable cache; also stores shared-setup OG PNGs |
| Workers static assets | **USE** (for app shell, small files) | JS/CSS/HTML and any asset under 25 MiB; but no 206 range support |
| Cache API / Cache Rules | **USE** | Edge-cache R2-served assets and OG images; Cache Rules for custom-domain R2 |
| KV | **MAYBE** | Read-heavy tunables: curated presets, feature flags, short-id -> setup JSON cache. Not needed at start |
| D1 | **USE** (when sharing ships) | Saved/shared setups ("tunes"), votes, leaderboard |
| Durable Objects (SQLite) | **SKIP** for v1 | Only if live multiplayer/"ghost laps" or strict-consistency counters are wanted |
| Hyperdrive | **SKIP** | Only accelerates external Postgres/MySQL; nothing to connect |
| Images (transformations) | **MAYBE** | Resize/format thumbnails of shared-setup PNGs; marginal if you render thumbnails at the right size client-side |
| Stream | **SKIP** | Video hosting; explainer is real-time 3D, not video |
| Browser Run (screenshots) | **SKIP for OG images (WebGL unverified, likely slow/fragile)**; use client-side capture | See section 9 |
| Analytics Engine | **USE** | Anonymous interaction telemetry (suspension choice, dwell time), SQL API |
| Web Analytics | **USE** | Free RUM / visits / Core Web Vitals; zero code if proxied |
| Basin Pipelines / Basin Catalog (R2 Data Catalog) | **SKIP** | Overkill; Analytics Engine covers it |
| Secrets Store | **SKIP** | Open beta; Worker secrets suffice |
| Queues | **SKIP** (maybe later) | No async work in v1 |
| Workflows | **SKIP** | No multi-step durable jobs |

## Global notes

- Wrangler **automatic provisioning**: add `kv_namespaces`, `d1_databases`, `r2_buckets`, `queues` bindings WITHOUT ids and `wrangler deploy` creates them and writes IDs back to config (docs: /workers/wrangler/configuration/ "Automatic provisioning"). Not listed for `images`, `browser`, `analytics_engine_datasets` (those need no pre-creation anyway: AE datasets are created on first write). CI deploys from dashboard/GitHub don't write IDs back.
- Workers limits (https://developers.cloudflare.com/workers/platform/limits/): **static asset file max 25 MiB** (free and paid); files per version 20,000 free / 100,000 paid; Worker bundle 64 MiB uncompressed; memory 128 MB; CPU 10 ms free / 30 s default paid; subrequests 50 free / 10,000 paid. Request body limit depends on the zone plan (100 MB on Free/Pro).
- Free vs paid: D1, DO-SQLite, KV, Queues, Workflows, Analytics Engine writes work on Workers Free with daily caps; Browser Run is 10 min/day on Free. Realistic plan for a public launch: Workers Paid ($5/mo).

---

## 1. R2

Docs: https://developers.cloudflare.com/r2/ (pricing page fetched).

**Pricing (Standard):** $0.015/GB-month; Class A $4.50/M; Class B $0.36/M; **egress free**. Free tier: 10 GB-month, 1M Class A, 10M Class B per month. Infrequent Access: $0.01/GB, $9/M Class A, $0.90/M Class B, $0.01/GB retrieval, 30-day minimum, no free tier (do not use for hot assets).
Our asset budget (say 150 MB of GLB/KTX2/HDR) fits in free storage; a GET is Class B, so 10M free GETs per month. Cached edge hits do not hit R2 at all.

**Serving options**
1. **Worker binding route (recommended).** Full control of headers, Range, ETag, CORS, and you can put Cache API in front. Cost = Worker request (free plan 100k/day, paid 10M/month included) + R2 Class B on cache miss.
2. **Public bucket on custom domain.** Zero Worker code; Cloudflare CDN caches it; WAF/Cache Rules/Access apply. By default only certain file types are cached (.glb/.ktx2/.hdr are likely NOT in the default list: add a Cache Rule "eligible for cache" - Cache Everything). Smart Tiered Cache supported (single upper tier near bucket). Domain must be a zone on the same account. (https://developers.cloudflare.com/r2/buckets/public-buckets/)
3. **r2.dev subdomain: do NOT use in production.** Rate limited, no WAF/caching/Bot Management, "development and non-production use only".

**Range requests:** The R2 binding supports `range: {offset,length}|{offset}|{suffix}` and `onlyIf` conditionals in `get()`; parse the request `Range` header yourself (or pass `request.headers` via `onlyIf` for conditionals; for range pass `range: request.headers` is supported in the runtime (memory) - safest is to parse manually). Custom domain public bucket serves ranges natively (memory).
**Cache API caveat:** `cache.put()` throws on 206 responses and on `Vary: *`; `cache.match()` DOES honor Range against a cached 200 and returns 206. So: cache the full 200 object, serve ranges via `match` (https://developers.cloudflare.com/workers/runtime-apis/cache/). Cache API is per-colo, only effective on custom domains / Pages (not Playground/dashboard editor); tiered cache not compatible with `put`; no stale-while-revalidate.

**R2 vs Workers static assets for big files**
- Static assets: free + unlimited requests, no extra storage cost, but **25 MiB per file hard cap**, `Range` header returns **200 with full file, no Accept-Ranges** (docs: /workers/static-assets/billing-and-limitations/), default `Cache-Control: public, max-age=0, must-revalidate` (revalidate every time; override via `_headers`, e.g. `/assets/*  Cache-Control: public, max-age=31536000, immutable`), ETag is a content hash. Deploys re-upload only changed files.
- Rule of thumb: anything the browser must fetch with ranges/progressively, anything > ~20 MiB (HDR env maps, high-res track GLB), or anything that changes without redeploying the app -> **R2**. Hashed small chunks (JS, Draco/Meshopt decoder wasm, KTX2 transcoder wasm, <5 MB KTX2 textures, small GLBs) -> static assets (free, simplest, deployed atomically with the code that references them).
- Note: GLB/KTX2 are already compressed; Cloudflare's auto-compression won't help; do Meshopt/Draco + KTX2 at build.

wrangler.jsonc:
```jsonc
{
  "name": "suspension-lab",
  "main": "src/worker.ts",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./dist", "binding": "ASSETS", "run_worker_first": ["/api/*", "/models/*"] },
  "r2_buckets": [{ "binding": "MODELS", "bucket_name": "suspension-lab-assets" }]
}
```
Worker (full + range + ETag + edge cache), TypeScript:
```ts
interface Env { MODELS: R2Bucket; ASSETS: Fetcher }

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/models/")) return env.ASSETS.fetch(req);
    const key = decodeURIComponent(url.pathname.slice("/models/".length));
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname); // no Range, no query

    // Cache API honours Range on a cached 200 and returns 206
    const hit = await cache.match(req.headers.has("range") ? new Request(cacheKey, { headers: { range: req.headers.get("range")! } }) : cacheKey);
    if (hit) return hit;

    const range = parseRange(req.headers.get("range")); // -> {offset,length}|{suffix}|undefined
    const obj = await env.MODELS.get(key, { range, onlyIf: req.headers });
    if (!obj) return new Response("Not found", { status: 404 });

    const h = new Headers();
    obj.writeHttpMetadata(h);
    h.set("etag", obj.httpEtag);
    h.set("accept-ranges", "bytes");
    h.set("cache-control", "public, max-age=31536000, immutable"); // keys are content-hashed
    h.set("access-control-allow-origin", "*");
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
    if (range) { /* set Content-Range from obj.range */ return new Response(obj.body, { status: 206, headers: h }); }
    const res = new Response(obj.body, { headers: h });
    ctx.waitUntil(cache.put(cacheKey, res.clone())); // full 200 only
    return res;
  },
} satisfies ExportedHandler<Env>;
```
(Sketch; parseRange and Content-Range construction are left to implementation. Simpler: skip custom range logic, let a custom-domain public bucket + Cache Rule handle it.)

Create:
```bash
npx wrangler r2 bucket create suspension-lab-assets
npx wrangler r2 object put suspension-lab-assets/models/car.<hash>.glb --file ./car.glb --content-type model/gltf-binary --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 bucket domain add suspension-lab-assets --domain assets.example.com --zone-id <ZONE>   # custom domain (memory: verify flags)
npx wrangler r2 bucket cors set suspension-lab-assets --file cors.json                             # (memory)
# REST (memory): POST /accounts/{id}/r2/buckets  {"name":"suspension-lab-assets","locationHint":"weur"}
```
**Verdict: USE.** Feature: all heavy assets (`car.glb`, `bike.glb`, `track.glb`, `env.hdr`/`.ktx2`) in R2 under content-hashed keys with 1-year immutable; app shell on static assets. Also OG PNG storage. Per-GB egress is free so a viral link doesn't cost bandwidth.

## 2. Cache API & Cache Rules

- Workers Cache API: see above. Use for (a) R2 objects, (b) generated OG images, (c) `GET /api/setups/:id` JSON responses (short TTL).
- Cache Rules (dashboard/API, zone-level, custom domain): needed to make R2 custom-domain assets and `.glb/.ktx2/.hdr` cacheable ("Cache eligibility: eligible", Edge TTL 1 year, Browser TTL 1 year), enable Tiered Cache (Smart) to cut R2 reads. Cache Rules do not apply to `workers.dev` subdomain traffic (memory), so a custom domain is a prerequisite for most of this.
- Workers Cache (`"cache": {"enabled": true}` in wrangler) is mentioned for Images binding to avoid re-transform (docs: /images/transform-images/bindings/).
**Verdict: USE** (free). Requires a custom domain; plan for one from day 1.

## 3. KV

Limits (https://developers.cloudflare.com/kv/platform/limits/): value 25 MiB, key 512 B, **same-key writes 1/s**, 1,000 ops per invocation, min cacheTtl 30 s. Free: 100k reads/day, 1,000 writes/day, 1 GB. Paid: 10M reads/mo then $0.50/M; 1M writes/mo then $5/M; $0.50/GB-month beyond 1 GB.
**Consistency:** eventually consistent; writes can take up to ~60 s to propagate globally; negative lookups also cached (memory, well-known). Not for counters, votes, or anything read-your-writes.
```jsonc
{ "kv_namespaces": [{ "binding": "CONFIG" }] }   // auto-provisioned on deploy
```
```ts
const presets = await env.CONFIG.get<Preset[]>("presets:v1", { type: "json", cacheTtl: 300 });
```
```bash
npx wrangler kv namespace create CONFIG
npx wrangler kv key put --binding CONFIG presets:v1 --path presets.json --remote
# REST (memory): POST /accounts/{id}/storage/kv/namespaces {"title":"CONFIG"}
```
**Verdict: MAYBE.** Honest take: curated presets and car/track metadata are better as static JSON in the build (versioned, atomic, free). KV only earns its keep for runtime-editable feature flags or caching hot shared setups in front of D1. Skip for v1.

## 4. D1

Limits (https://developers.cloudflare.com/d1/platform/limits/): DB 10 GB paid / 500 MB free; row/string/blob 2 MB; 100 bound params; **queries per invocation 1,000 paid / 50 free**; 30 s query; 50 MB result cap (from 2026-11-04); `db.batch()` = one query for the invocation limit; 6 simultaneous connections; Time Travel 30 d paid / 7 d free.
Pricing: rows read 5M/day free, 25B/mo paid then $0.001/M; rows written 100k/day free, 50M/mo paid then $1/M; storage 5 GB free then $0.75/GB-mo. (https://developers.cloudflare.com/d1/platform/pricing/) Index everything you filter on, otherwise a leaderboard scan burns "rows read".
**Read replication:** enable per DB via dashboard Settings or REST `PUT /accounts/{id}/d1/database/{db}` body `{"read_replication":{"mode":"auto"}}` (needs D1:Edit); no extra cost (billed on rows read/written). **Sessions API** only via Worker binding: `env.DB.withSession(bookmark ?? "first-unconstrained")`, return `session.getBookmark()` in a header (e.g. `x-d1-bookmark`) so a user reads their own writes. Docs don't state GA/beta status on that page (unverified). Not needed until traffic is global; single-primary latency from the far side of the world is ~100-300 ms, fine for share links.
```jsonc
{ "d1_databases": [{ "binding": "DB", "database_name": "suspension-lab", "migrations_dir": "migrations" }] }
```
Schema sketch:
```sql
CREATE TABLE setups (id TEXT PRIMARY KEY, vehicle TEXT NOT NULL, suspension TEXT NOT NULL,
  params TEXT NOT NULL CHECK (json_valid(params)), created_at INTEGER NOT NULL, votes INTEGER NOT NULL DEFAULT 0, og_key TEXT);
CREATE INDEX idx_setups_votes ON setups(vehicle, votes DESC);
CREATE TABLE laps (id INTEGER PRIMARY KEY, setup_id TEXT REFERENCES setups(id), ms INTEGER NOT NULL, client_hash TEXT, created_at INTEGER);
CREATE INDEX idx_laps_ms ON laps(ms);
```
```ts
const id = crypto.randomUUID().replace(/-/g,"").slice(0,8);          // or nanoid(8); retry on UNIQUE conflict
await env.DB.prepare("INSERT INTO setups (id,vehicle,suspension,params,created_at) VALUES (?,?,?,?,?)")
  .bind(id, v, s, JSON.stringify(params), Date.now()).run();
```
Create: `npx wrangler d1 create suspension-lab` (then add `--location weur` hint optional); `npx wrangler d1 migrations create suspension-lab init`; `npx wrangler d1 migrations apply suspension-lab --remote`. REST (memory): `POST /accounts/{id}/d1/database {"name":"suspension-lab"}`.
**Verdict: USE** for shareable setups. Caveats: validate and size-cap `params` (reject > ~4 KB, schema-check ranges server-side), rate limit POST (Cloudflare rate limiting rule or a per-IP DO/KV hack), and never trust client lap times for a public leaderboard (cheatable; physics is client-side). Votes: simple `UPDATE ... votes=votes+1` is fine but needs dedupe (cookie/IP hash), otherwise skip votes.

## 5. Durable Objects (SQLite) vs D1

Pricing (https://developers.cloudflare.com/durable-objects/platform/pricing/): SQLite-backed DOs available on Free; rows read/written same rates as D1; storage $0.20/GB-mo; requests 1M/mo then $0.15/M; duration $12.50/M GB-s. (Page says storage billing started Jan 2026.) Each DO = single-threaded, strongly consistent, own SQLite DB up to 10 GB (memory).
Choose D1 for a global relational table with cross-row queries (leaderboard, listing). Choose DO for per-room / per-entity serialized state: live multiplayer ghost, "watch this tune live", exact rate limiters, atomic counters.
**Verdict: SKIP for v1.** The experience is single-player; D1 is simpler. Revisit if "race a friend's ghost live" appears.

## 6. Hyperdrive
Accelerates Workers -> external Postgres/MySQL (https://developers.cloudflare.com/hyperdrive/). We have no external DB. **SKIP.**

## 7. Cloudflare Images
Transformations: 5,000 unique/month free (then 9422 error, no charge on Free) / paid $0.50 per 1,000 unique after 5,000; R2/remote sources billed only as "Images Transformed" (no storage/delivery charge). Hosted storage $5/100k images, delivery $1/100k (paid only). (https://developers.cloudflare.com/images/pricing/)
Binding: `"images": {"binding":"IMAGES"}`; `env.IMAGES.input(stream).transform({width:600}).output({format:"image/webp"})`, input <= 20 MB, text overlay <= 1000 chars (could stamp "Double wishbone / -2.1 deg camber" onto an OG card!). `fetch(url,{cf:{image:{width,fit,format}}})` works on custom-domain zones with transformations enabled.
**Verdict: MAYBE.** Useful for (a) resizing user-captured 1200x630 PNGs to thumbnails for a gallery, (b) compositing a text overlay onto a template for OG cards without a headless browser. Not needed for static marketing images (pre-size at build). Hosted Images storage: SKIP (R2 is cheaper).

## 8. Stream
$5/1,000 min stored, $1/1,000 min delivered, no free tier (https://developers.cloudflare.com/stream/pricing/). The product is real-time rendering. A hero loop `.mp4` as a fallback for low-end/no-WebGL devices could go in R2 or static assets. **SKIP.**

## 9. Browser Run (formerly Browser Rendering) - OG images of a shared setup

Facts (verified): REST `POST https://api.cloudflare.com/client/v4/accounts/<id>/browser-run/screenshot` with `url`, `viewport{width,height,deviceScaleFactor}`, `gotoOptions{waitUntil,timeout}`, `addScriptTag`, `screenshotOptions`; Workers binding with `@cloudflare/puppeteer` (`puppeteer.launch(env.MYBROWSER)`, `"browser": {"binding":"MYBROWSER"}`, Node compat flag required per get-started guide). Limits: Free 10 min browser time/day, 3 concurrent, 1 new browser/20 s, REST 1 req/10 s; Paid 10 h/mo included then $0.09/h, 10 concurrent included then $2 each, 3 new browsers/s, 30 req/s REST. (https://developers.cloudflare.com/browser-run/pricing/, /browser-rendering/platform/limits/)
**WebGL: UNVERIFIED and no official statement.** I searched the docs (llms-full.txt, FAQ, changelog, screenshot and puppeteer pages): the only WebGL mention is that session recording does not capture WebGL. A Cloudflare community thread asks whether Browser Rendering has GPU hardware (couldn't read answers: 403), and an Answer Overflow thread reports a three.js page screenshot with "Error creating WebGL context". Headless Chrome on GPU-less Linux either uses software GL (SwiftShader/llvmpipe, seconds per frame, black-frame races) or fails the context outright (Chromium is removing automatic SwiftShader fallback). Our scene (PBR shaders, shadows, post FX, 100+ MB assets) is exactly the worst case: expect slow, flaky, possibly blank output, with no way to pass Chrome flags that I could confirm. Needs a spike (one-hour test with the REST endpoint on a plain three.js cube, then the real scene) before any design depends on it.
**Better design (recommended): capture client-side.** When the user clicks "Share", the page calls `renderer.domElement.toBlob()` (with `preserveDrawingBuffer` or capture right after a render in the same task) at 1200x630, and POSTs it with the setup JSON; Worker stores PNG in R2 `og/<id>.png` and the setup row stores `og_key`. `og:image` meta is served by the Worker (HTMLRewriter) at `/s/:id`. Zero server GPU, exact pixels the user saw, free. Optionally run through `env.IMAGES` to overlay text/logo.
**Verdict: SKIP** (unless the spike proves WebGL works; then MAYBE as a backfill for links created without a client capture).

## 10. Analytics Engine (telemetry)

Config + write (https://developers.cloudflare.com/analytics/analytics-engine/get-started/):
```jsonc
{ "analytics_engine_datasets": [{ "binding": "TELEMETRY", "dataset": "suspension_events" }] }  // dataset auto-created on first write
```
```ts
env.TELEMETRY.writeDataPoint({
  indexes: [sessionHashOrVehicle],                      // exactly ONE index (more => dropped); sampling key
  blobs: ["suspension_select", "double_wishbone", "car", "track_v2"],   // dims (<=20, total <=16 KB)
  doubles: [dwellMs, 1],                                // numerics (<=20)
});  // no await needed; max 250 data points per invocation
```
Limits: 20 blobs, 20 doubles, 1 index (<=96 B), 3-month retention. Query with SQL API (needs token with Account Analytics Read), mind sampling (`SUM(_sample_interval * double1)`):
```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCT/analytics_engine/sql" -H "Authorization: Bearer $TOKEN" \
 --data "SELECT blob2 AS suspension, SUM(_sample_interval) AS picks, SUM(_sample_interval*double1)/SUM(_sample_interval) AS avg_dwell_ms FROM suspension_events WHERE blob1='suspension_select' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY suspension ORDER BY picks DESC"
```
Pricing is not on the fetched pages (unverified; historically free during beta, then usage-based on writes/reads - check /analytics/analytics-engine/pricing/). Client sends batched events to `POST /api/t` via `navigator.sendBeacon`; Worker validates against an allowlist of event names and writes. No PII; no cookies; hash nothing.
**Verdict: USE.** Questions answered: share of picks per suspension type, which view (x-ray) is opened, dwell per mode, share-link conversion, device/GPU tier distribution (blob from a WebGL renderer string bucket), load-time buckets.

## 11. Web Analytics
Free-for-all-plans RUM (docs say "Available on all plans"; price not stated on fetched page). Proxied sites: automatic injection, on by default (can be set to exclude EU visitors); a `Cache-Control: public, no-transform` header on the origin response prevents auto-injection. Non-proxied/workers.dev: Dashboard > Web Analytics > Add a site, paste the JS beacon (`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"..."}'></script>`) before `</body>`. Programmatic site creation: `POST /accounts/{id}/rum/site_info` (memory, unverified; docs I fetched mention no API).
Gives page views, referrers, Core Web Vitals (LCP/INP/CLS), which matter for a heavy 3D page. It does not track custom events, hence Analytics Engine for the interaction data.
**Verdict: USE.** Turn on with the custom domain; it's free.

## 12. Basin Pipelines / Basin Catalog (R2 Data Catalog)
GA; ingest events (HTTP endpoint or Worker binding), SQL transform, write Iceberg/Parquet/JSON to R2; requires Workers Paid; wrangler entry `npx wrangler basin pipelines setup` (https://developers.cloudflare.com/pipelines/). Pricing not on fetched pages. Catalog = Iceberg REST catalog for Spark/Snowflake/PyIceberg (https://developers.cloudflare.com/r2/data-catalog/). For a few event types with 3-month analysis horizons this is a data-lake for a problem we don't have. **SKIP**; reconsider only if we want to keep raw telemetry beyond 3 months.

## 13. Secrets Store
Open beta (docs): account-level secrets, binding `secrets_store_secrets: [{binding, store_id, secret_name}]`, `await env.X.get()`. Commands: `wrangler secrets-store store list|create <name> --remote`, `wrangler secrets-store secret create <STORE_ID> --name N --scopes workers --remote`. Value: sharing one secret across many Workers. We have one Worker and perhaps an API token. `wrangler secret put` is GA and enough. **SKIP.**

## 14. Queues
Free plan 10,000 ops/day; paid 1M ops/mo then $0.40/M (each message ~3 ops, 64 KB chunks); retention 24 h free, 4 d default/14 d max paid (https://developers.cloudflare.com/queues/platform/pricing/).
```jsonc
{ "queues": { "producers": [{ "binding": "JOBS", "queue": "og-jobs" }], "consumers": [{ "queue": "og-jobs", "max_batch_size": 10 }] } }
```
`npx wrangler queues create og-jobs`; REST (memory): `POST /accounts/{id}/queues {"queue_name":"og-jobs"}`. Use only if OG rendering (Browser Run) or Images compositing becomes async. **SKIP for v1**; fits if the Browser Run backfill exists. Telemetry batching to Analytics Engine does not need it (AE writes are non-blocking).

## 15. Workflows
Free plan: 100k req/day shared, 10 ms CPU, 3,000 steps/day, 3-day state; storage/step billing not before Aug 2026 (now likely active; check). Durable multi-step orchestration (retries, sleeps). Nothing here needs it. **SKIP.**

---

## Recommendations for Suspension Lab

Day-1 stack (minimal, cheap, genuinely useful):
1. **Workers static assets** for the app shell and small hashed files (set `_headers` immutable for `/assets/*`; remember `max-age=0, must-revalidate` is the default and wastes round trips).
2. **R2 + Worker `/models/*` route** (or public bucket on `assets.<domain>` with a Cache Rule) for GLB/KTX2/HDR; content-hashed keys, 1-year immutable, Range + ETag, CORS. This avoids the 25 MiB cap and the broken-Range behaviour of static assets.
3. **Custom domain** from the start (needed for Cache API, Cache Rules, Tiered Cache, Web Analytics auto-injection, R2 custom domain).
4. **Web Analytics** (free) for visits and Core Web Vitals; **Analytics Engine** for interaction telemetry with a strict event allowlist.

Phase 2 (sharing): `POST /api/setups` validates a compact params JSON (schema + clamped ranges, <=4 KB) -> **D1** row with 8-char id -> returns `/s/<id>`. `GET /s/:id` serves the SPA with HTMLRewriter-injected `og:title/og:image` and a `<script>` preloading the setup JSON. OG image: **captured client-side from the canvas and uploaded to R2** (`og/<id>.png`), optionally composited via **Images binding**; **do not rely on Browser Run** until a WebGL spike passes. Add rate limiting on POST. Leaderboards/votes only if anti-abuse is considered (client physics = untrusted times).

Defer/skip: KV (static JSON does it), DO (unless live ghosts), Hyperdrive, Stream, Pipelines/Catalog, Secrets Store, Queues, Workflows.

Starter wrangler.jsonc (phase 2):
```jsonc
{
  "name": "suspension-lab",
  "main": "src/worker.ts",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./dist", "binding": "ASSETS", "run_worker_first": ["/api/*", "/models/*", "/s/*"] },
  "r2_buckets": [{ "binding": "MODELS", "bucket_name": "suspension-lab-assets" }],
  "d1_databases": [{ "binding": "DB", "database_name": "suspension-lab", "migrations_dir": "migrations" }],
  "analytics_engine_datasets": [{ "binding": "TELEMETRY", "dataset": "suspension_events" }],
  "images": { "binding": "IMAGES" },
  "routes": [{ "pattern": "suspensionlab.example.com", "custom_domain": true }]
}
```
Provision: `wrangler r2 bucket create ...`, `wrangler d1 create ...`, `wrangler d1 migrations apply ... --remote`, upload assets with `wrangler r2 object put ... --remote` (or S3-compatible API for bulk), `wrangler deploy`. Everything above is also reachable via the REST API with an API token scoped to the specific products (R2, D1, KV, Workers Scripts edit, Analytics read).

Open items to verify: Browser Run WebGL (spike), Analytics Engine current pricing, D1 read replication GA status, exact `wrangler r2 bucket domain/cors` flags, Web Analytics REST site creation, R2 `range` pass-through of the Range header object in the current runtime.
