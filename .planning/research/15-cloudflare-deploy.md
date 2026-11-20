# 15 - Cloudflare deployment research (Vite SPA + Three.js + Worker API)

Researched 2026-11-20 against developers.cloudflare.com (served as `<page>/index.md` markdown; `https://developers.cloudflare.com/workers/llms.txt` is the index) and the npm registry. Anything not directly confirmed is tagged **(unverified)**.

## 0. TL;DR decisions

| Question | Answer (Nov 2026) |
|---|---|
| Pages or Workers? | **Workers with Static Assets.** Pages docs landing page says "Start new projects with Workers" and calls Workers "Cloudflare's primary platform"; Pages is not formally deprecated, but there is an official "Migrate from Pages to Workers" guide. |
| Tooling | `wrangler` **4.165.0** (latest, Node >= 22.12) + `@cloudflare/vite-plugin` **1.70.1** (peer: vite ^6.1 \|\| ^7 \|\| ^8, wrangler ^4.164). Vite latest is 8.3.8. |
| Config file | `wrangler.jsonc` (still the stable, documented path). |
| New things to know | (a) `cf` CLI 1.0.0-rc.2 + `cloudflare.config.ts` is a **release candidate** that will eventually replace wrangler.jsonc; don't adopt yet, `cf migrate` exists for later. (b) `@cloudflare/vite-plugin` **2.0.0-rc.2** (tag `beta`/`rc`) exists; v1 is the documented stable. (c) New **Previews** (`wrangler preview`, needs Wrangler >= 4.135.0) replace "preview URLs"; old ones are now called **Version URLs**. (d) Docs now push "Vite+" as a toolchain; optional, ignore. |
| Per-file asset limit | **25 MiB** per file (Free and Paid). Files/version: **20,000 Free / 100,000 Paid**. |
| Big GLB/HDR > 25 MiB | Put in **R2** (egress free), serve via Worker binding or R2 custom domain. Keep everything < 25 MiB where possible (meshopt + KTX2). |
| Router | **Hono 4.13.19** (npm latest, 2026-11-16). Cloudflare's own `vite-react-template` and docs use Hono for the Worker API. Recommended; plain `fetch` also fine for tiny APIs. |
| Free plan viable? | Yes for dev/demo: static asset requests are free and unlimited; only Worker (API) requests count against 100k/day. |

## 1. Workers Static Assets vs Pages

Sources: https://developers.cloudflare.com/pages/ , https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/index.md

- Pages landing page (verified quote): "Start new projects with Workers"; Workers "supports most Pages use cases and offers a broader feature set." No "maintenance mode" wording found.
- Workers gives: Durable Objects, Cron Triggers, Workers Logs/observability, Previews, gradual deployments, versions. Pages Functions are billed like Workers anyway.
- Static asset requests: **free and unlimited**; no storage charge (billing page). Only requests that invoke the Worker are billed.
- Asset-first routing is the default: if a path matches an asset it is served without invoking the Worker; otherwise `fetch()` runs.

### Config knobs (all verified)
- `assets.directory`: not needed with the Vite plugin (it auto-fills from the client build output into generated `dist/<worker>/wrangler.json`).
- `assets.binding`: `"ASSETS"` exposes `env.ASSETS.fetch(request)`.
- `assets.not_found_handling`: `"single-page-application"` (serve `/index.html` with 200) or `"404-page"`.
- `assets.run_worker_first`: `true`, or array of globs with `!` negation, e.g. `["/api/*", "!/api/docs/*"]`; max 100 entries; negative patterns win.
- `assets.html_handling`: exists (not on the pages I read; unverified details).
- `.assetsignore` (gitignore syntax) in the assets dir to keep files (e.g. `_worker.js`) from being uploaded.
- With compat date >= 2025-04-01 (or `assets_navigation_prefers_asset_serving`), **navigation requests** (`Sec-Fetch-Mode: navigate`) never invoke the Worker in SPA mode. Consequence: typing `/api/foo` in the browser URL bar returns index.html, while `fetch('/api/foo')` hits the Worker. Using `run_worker_first: ["/api/*"]` makes /api/* always hit the Worker (also for navigations) and keeps SPA fallback for everything else. Recommended.
- **Free-plan gotcha**: with `run_worker_first` patterns, once the 100k/day free quota is exhausted, matching requests get **429** (no fallback to assets). Negative patterns still serve assets.
- **Range requests are not supported for assets**: `Range` returns 200 + full file, no `Accept-Ranges`/`Content-Range`. Irrelevant for GLB/HDR fetches, relevant for video. Work-around: `run_worker_first` + `env.ASSETS.fetch` + build 206 yourself.
- **Version skew** (https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/index.md): each Worker version has its own asset manifest; during propagation (seconds) or gradual deployments, HTML from version B may request a hashed file only in version B from a location still on A (and old open tabs request A's hashed chunks after B ships). In SPA mode a missing path falls back to index.html (200) -> "Unexpected token <" JS errors. Mitigations: Vite hashed filenames (default), do not rely on version affinity, add a `vite:preloadError` handler that reloads the page once, avoid gradual deployments for the SPA unless affinity is configured.

## 2. Limits (Workers Free vs Paid) - https://developers.cloudflare.com/workers/platform/limits/

| Limit | Free | Paid ($5/mo min) |
|---|---|---|
| Static asset files per version | 20,000 | 100,000 |
| Single static asset size | **25 MiB** | **25 MiB** |
| Worker invocations | 100,000/day (reset 00:00 UTC) | 10M/mo incl., +$0.30/M |
| CPU time / request | 10 ms | 30 s default, up to 5 min; 30M CPU-ms/mo incl., +$0.02/M |
| Subrequests / invocation | 50 | 10,000 |
| Worker size (uncompressed) | 64 MiB | 64 MiB |
| Memory / isolate | 128 MB | 128 MB |
| Static asset requests | free, unlimited | free, unlimited |

Related products (verified from pricing pages):
- **Durable Objects**: available on Free **only with SQLite backend** (use `new_sqlite_classes`). Free: 100k requests/day, 13,000 GB-s/day duration, 5M rows read/day, 100k rows written/day, 5 GB stored. Exceeding a free limit makes further ops of that type error until 00:00 UTC. Paid: 1M req/mo + $0.15/M; 400k GB-s/mo; 25B rows read, 50M rows written/mo; $0.20/GB-mo storage. WebSocket incoming messages billed 20:1. Use the Hibernation API for sockets.
- **Workers AI**: 10,000 neurons/day free (Free and Paid), then $0.011/1,000 neurons (Paid only; Free is hard-capped).
- **R2**: free 10 GB-month storage, 1M Class A, 10M Class B per month; egress always free; $0.015/GB-mo after.
- **KV**: Free 100k reads/day, 1k writes/day, 1 GB.
- **D1**: Free 5M rows read/day, 100k written/day, 5 GB total, 10 databases.
- **Vectorize**: Free 30M queried dims/mo, 5M stored dims.
- **Analytics Engine**: Free 100k data points/day, 10k read queries/day; Paid 10M points/mo; 3-month retention; max 250 `writeDataPoint` per invocation, 20 blobs + 20 doubles + 1 index (96 B) per point, 16 KB blobs/point.

## 3. Vite plugin (`@cloudflare/vite-plugin`) 

Sources: https://developers.cloudflare.com/workers/vite-plugin/get-started/index.md , .../reference/api/index.md , .../reference/static-assets/index.md , https://developers.cloudflare.com/workers/local-development/index.md

- Install: `npm i -D vite @cloudflare/vite-plugin wrangler`. Uses the Vite **Environment API**; Worker runs in **workerd** during `vite dev` (real runtime, not Node), same code path in `vite preview`.
- Plugin options (`PluginConfig`): `configPath`, `config` (programmatic override fn/object), `viteEnvironment: {name, childEnvironments}`, `persistState` (default `.wrangler/state`), `inspectorPort` (default 9229), `tunnel` (new: expose dev server via Cloudflare Tunnel; `t + Enter`), `auxiliaryWorkers`, `remoteBindings` (default **true**).
- Client assets are detected automatically (index.html at root / non-empty `public/` etc.); `vite build` outputs client to `dist/client` and Worker to `dist/<worker_name_with_underscores>`, plus a generated `dist/<worker>/wrangler.json` and a `.wrangler/deploy/config.json` redirect, so plain `wrangler deploy` after `vite build` deploys the built output (no `assets.directory` needed).
- Local dev bindings: simulated locally by default (KV/R2/D1/DO state in `.wrangler/state`). Per-binding `"remote": true` in wrangler.jsonc connects to the real resource while code still runs locally. **Workers AI always runs remotely** (needs `wrangler login` / token with Workers AI). Disable all remote with `wrangler dev --local` (for Vite set `remoteBindings: false`).
- Security note from docs: Miniflare/workerd is not a hardened sandbox; run dev in a VM/container (relevant: our headless container is fine).
- Worker env name: with a Hono Worker + SPA, `cloudflare()` with no args works; the entry Worker env is auto-named from `name`. (The "get-started" snippet sets `viteEnvironment: {name:"worker"}` only to attach sourcemap config.)
- Source maps: set `"upload_source_maps": true` in wrangler.jsonc AND `environments.<worker>.build.sourcemap: true` in vite config, or stack traces in Workers Logs are minified.
- Vite 8 (Rolldown-based) is supported by plugin 1.70.1 per peerDependencies. v2.0.0-rc.2 peers: vite ^7 \|\| ^8 only.

## 4. Wrangler / config conventions

- Current: **wrangler 4.165.0** (`wrangler@latest`; `legacy` tag is 3.114.17). Install per-project as devDependency (docs warn `npx wrangler` without a local install fetches latest). Requires Node >= 22.12.0.
- Format: `wrangler.jsonc` with `"$schema": "./node_modules/wrangler/config-schema.json"`. Required keys: `name`, `main` (for Workers with code), `compatibility_date`.
- `compatibility_date`: docs now literally say "Set this to today's date" and examples use `2026-11-20`. Convention: set at project creation/each deliberate upgrade; don't use a future date; `@cloudflare/workers-types` latest = 5.20261120.1 but prefer `wrangler types` (generates `worker-configuration.d.ts` with `Env`). `nodejs_compat` flag only if you import Node built-ins.
- `workers_dev`: defaults true when no `routes`; set `false` if you serve only on a custom domain. `preview_urls` controls Version URLs / workers.dev previews (default follows `workers_dev`).
- Other useful keys: `keep_vars`, `upload_source_maps`, `placement`, `observability`, `account_id` (or env `CLOUDFLARE_ACCOUNT_ID`), `routes: [{pattern, custom_domain: true}]`.
- Key bindings syntax (verified in config docs): `durable_objects.bindings[{name,class_name}]` + `migrations[{tag, new_sqlite_classes:[...]}]`; `ai:{binding:"AI"}`; `r2_buckets[{binding,bucket_name}]`; `kv_namespaces[{binding,id}]`; `d1_databases[{binding,database_name,database_id}]`; `vectorize[{binding,index_name}]`; `analytics_engine_datasets[{binding,dataset}]`.
- Observability: `"observability": {"enabled": true, "head_sampling_rate": 1}` (new Workers have it on by default; need Wrangler >= 3.78.6); `"observability.issues.enabled": true` (Wrangler >= 4.134.0) groups failures; `invocation_logs: false` to cut noise; lower `head_sampling_rate` (e.g. 0.1) to stay inside free log quotas.

## 5. Caching, headers, compression, protocols

### Default static-asset behaviour (verified, https://developers.cloudflare.com/workers/static-assets/headers/index.md)
- `Content-Type` from file extension (wrangler detects MIME on upload).
- `Cache-Control: public, max-age=0, must-revalidate` + `ETag` (content hash) when no Authorization/Range header. So hashed assets are **not immutable by default**: add `_headers`.
- `CF-Cache-Status` is only "probabilistic".
- `_headers` is supported (put it in `public/_headers` so Vite copies it to `dist/client/_headers`): max **100 rules**, **2,000 chars/line**; multiple matching rules are merged (comma-joined, which makes `Cache-Control` conflict!). To override a header for a specific path use detach: put the narrower rule AFTER the broad rule and `! Cache-Control` before re-setting it. `_headers` applies only to asset responses, **not** to Worker-generated responses (so set headers in Hono for /api/*). `_redirects` also supported (redirects beat headers).
- `:splat` and `:placeholder` supported; absolute-URL rules work (can target workers.dev to add `X-Robots-Tag: noindex`).

### Compression (https://developers.cloudflare.com/speed/optimization/content/compression/)
- Cloudflare edge compresses with gzip/**brotli**/**zstd** (browser-negotiated) only for the listed MIME types. Includes: html, css, js, json, svg, xml, fonts (ttf/otf/woff), `application/wasm`, `application/manifest+json`, `application/geo+json`, etc.
- **NOT in the list**: `model/gltf-binary` (.glb), `model/gltf+json`(unlisted), `application/octet-stream`, `image/vnd.radiance` (.hdr), `image/ktx2`, `.bin`. Only 200s are compressed; min size ~50 bytes. Compression Rules (zone-level, custom-domain zones) can add types; I could not confirm they apply to `workers.dev` or whether Workers static assets share the exact same pipeline (docs for static assets don't describe compression: **unverified**; measure with `curl -sI -H 'accept-encoding: br' ...` after first deploy).
- Practical consequence for us: **compress the assets themselves**: GLB with Draco/meshopt (`gltf-transform optimize --compress meshopt`), textures to KTX2/Basis (UASTC/ETC1S), HDR -> use RGBM/PMREM-preprocessed `.ktx2` or `.exr`->compressed, or smaller 1k-2k `.hdr`. Don't rely on edge brotli for .glb/.hdr. Wasm (draco/basis transcoders) IS compressed.

### Immutable caching for hashed assets
`public/_headers`:
```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/models/*
  Cache-Control: public, max-age=31536000, immutable
/draco/*
  Cache-Control: public, max-age=31536000, immutable
/basis/*
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: public, max-age=0, must-revalidate
```
(Non-hashed `/models/*.glb`: either filename-hash them or use `max-age=86400` + ETag revalidation. Immutable only if names are content-hashed.) Remember `/*` global rules would be merged with these; keep `Cache-Control` out of any `/*` block.

### Protocols
- **HTTP/3 (QUIC)**: available on all plans incl. Free, user<->Cloudflare leg (verified); it's on by default for proxied zones (dashboard toggle under Speed > Protocol Optimization). Assumed on for `*.workers.dev` too: **unverified**.
- **Early Hints (103)**: zone setting (Speed > Content Optimization > Early Hints). Cloudflare caches `Link: <...>; rel=preload/preconnect` headers from HTML responses and emits 103. Docs example (`/workers/examples/103-early-hints`) shows a Worker returning `Link` headers. Whether `_headers`-supplied `Link` on a static `index.html` triggers 103 on Workers assets: **unverified**; zone setting needs a custom domain zone (not workers.dev). Low priority for a Three.js SPA (the heavy cost is GLB/HDR fetch, not HTML); better to `<link rel="preload" as="fetch" crossorigin>` the main GLB in index.html.
- **Smart Placement** (`placement.mode = "smart"`): only affects `fetch` handlers; static assets are always served nearest the user; takes ~15 min to analyze; docs warn it's poorly suited combined with `run_worker_first`. Useful only when the Worker does many round trips to a single distant backend (e.g., a D1/DB in one region). **Skip** for our app; D1/DO have their own locality. (Placement `region`/`host` options also exist.)

## 6. Versions, previews, domains

- Every upload = a **version**; a **deployment** points traffic at 1 or 2 versions. Versions are retained 30 days, plus the latest 100 and any deployed ones. `wrangler deploy` = create version + 100% deployment. Decouple with `wrangler versions upload` then `wrangler versions deploy` (gradual: split %; min Wrangler 3.40). `wrangler rollback` for rollbacks.
- **Previews** (new, Sep 2026; Wrangler >= 4.135.0): `npx wrangler preview` creates/updates an isolated per-branch Preview under the same Worker, with its own vars/secrets/bindings (`previews` block in wrangler.jsonc), own URL `<preview-name>-<worker>.<subdomain>.workers.dev` + immutable deployment URL; workers.dev preview URLs carry `X-Robots-Tag: noindex`; Preview URLs are public unless protected by Cloudflare Access. Limits: 100 Previews/Worker Free, 500 Paid. New DO namespace per Preview; KV/D1/R2 shared unless bound to separate resources; service bindings/routes/crons hit production. `wrangler preview delete --name <n>`.
- **Version URLs** (old "preview URLs"): `<version-prefix>-<worker>.<subdomain>.workers.dev`; `wrangler versions upload [--preview-alias staging]`; run against **production resources**; deleted with the version.
- **workers.dev vs custom domain**: workers.dev default when no routes (`https://<worker>.<account-subdomain>.workers.dev`). For production use a **Custom Domain** (`"routes": [{"pattern":"suspension.example.com","custom_domain":true}]`) on a zone in the account; that enables zone features (Compression Rules, Early Hints, WAF, cache rules, Access). Token then needs Zone > Workers Routes > Write on the zone (see section 8). Set `workers_dev: false` if you want only the custom domain.

## 7. CI / headless deployment

Docs: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/index.md , https://developers.cloudflare.com/workers/wrangler/system-environment-variables/index.md

- Wrangler is non-interactive when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` env vars are set. No `wrangler login`. Also set `CI=1` (suppresses prompts) and optionally `WRANGLER_SEND_METRICS=false`.
- Commands: `npm ci && npm run build && npx wrangler deploy` (or `npx wrangler deploy --dry-run` for validation; `npx wrangler versions upload` for a non-live version).
- GitHub Actions (official): `uses: cloudflare/wrangler-action@v4` with `apiToken`, `accountId`, checkout `@v6` (as of docs).
- Secrets: `npx wrangler secret put NAME` (stdin pipe works headless), or `wrangler secret bulk file.json`; Editor access on the Worker required.
- First deploy of a **new** Worker needs product-level Admin on Workers (per-Worker Editor cannot create).
- Alternative: Workers Builds (git-connected builds in dashboard) — not needed for headless.
- The `cf` CLI (rc) also reads `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, uses `cf build`, `cf deploy`, `cf dev`, but reads `cloudflare.config.ts` not wrangler.jsonc. Not recommended yet.

### Token permissions (https://developers.cloudflare.com/fundamentals/api/reference/permissions/ and /workers/authorization/workers/)
Create an **Account API token** (Dashboard > Manage Account > Account API tokens; template "Edit Cloudflare Workers" is a starting point) scoped to the single account. Needed (account scope unless noted):

| Product | Permission (token UI name) | Notes |
|---|---|---|
| Workers deploy/versions/secrets | **Workers Scripts : Edit** (legacy) / Workers role **Editor** per-Worker or **Admin** at product scope (new) | Admin needed to create a *new* Worker. Bindings need no separate resource perms to deploy. |
| Workers R2 | **Workers R2 Storage : Edit** | create buckets, upload objects via wrangler r2 |
| Workers KV | **Workers KV Storage : Edit** | create namespaces |
| D1 | **D1 : Edit** | create DB, migrations |
| Vectorize | **Vectorize : Edit** | create index |
| Workers AI | **Workers AI : Read** (Edit if managing) | the `AI` binding at runtime needs no token; token needed for `wrangler dev` remote AI and REST |
| Analytics Engine | **Account Analytics : Read** | only to *query* via SQL API; writing from a Worker needs nothing extra. Dataset auto-created on first write |
| Durable Objects | **no separate permission** | governed by the Worker's role (Editor/Admin); DOs data studio needs Editor |
| Custom domain / routes | **Zone : Workers Routes : Edit/Write** on that zone, plus **Zone : Read** (unverified for Read) | only if using routes/custom_domain |
| Tail logs | Workers Tail Read (or Metadata Read-Only role) | optional |
| Containers / Cloudchamber | Containers Edit | not needed |

Docs warn: product-level Workers roles do **not** grant R2/D1/KV/Queues/Vectorize/Hyperdrive access - they need their own permissions. API tokens do not support "platform-level Developer Platform" permissions. Legacy names above still work ("no deprecation date").

### Verify a token and see what it can do
```bash
# 1. is it valid/active? (user-owned token)
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# account-owned tokens use the account-scoped verify (from CF API knowledge; unverified in this session):
curl -s https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# (verify returns id + status only; it does NOT list policies. Listing policies needs GET /user/tokens/{id} or /accounts/{id}/tokens/{id} with an "API Tokens Read" permission: unverified.)
# 2. Practical capability probes (HTTP 200 + success:true vs 403 code 10000/9109):
A=https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID
for p in workers/scripts r2/buckets storage/kv/namespaces d1/database vectorize/v2/indexes ai/models/search workers/subdomain; do
  printf '%-28s ' $p; curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$A/$p"
done
```
(Endpoint paths from memory of the CF v4 API; if one 404s check the API reference. Durable Objects: `workers/durable_objects/namespaces`. Analytics Engine: POST `$A/analytics_engine/sql` with a SQL body.) Also `npx wrangler whoami` shows the account (token path) and `npx wrangler deploy --dry-run` validates config without network side effects.

Account ID: `wrangler whoami` or dash URL; `workers.dev` subdomain needs registering once per account (`GET $A/workers/subdomain`; Dashboard > Workers > Subdomain).

## 8. Security headers / CSP for a Three.js app (wasm + workers)

Where to set: `public/_headers` for the HTML/asset responses; **Hono `secureHeaders()`** (or manual) for /api/* because `_headers` is not applied to Worker responses. Since `run_worker_first: ["/api/*"]` only the API goes through the Worker.

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(self), gyroscope=(self), xr-spatial-tracking=(self)
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```
Reasoning (CSP semantics from MDN/Three.js behaviour; not browser-tested here, **unverified in practice**):
- `'wasm-unsafe-eval'` allows `WebAssembly.instantiate/compile` (Draco, Basis/KTX2 transcoder, any physics WASM) without enabling JS `eval`. If a library needs `eval`/`new Function` you would need `'unsafe-eval'`; three.js core doesn't.
- `worker-src 'self' blob:`: Vite bundles workers as same-origin files; Three's `DRACOLoader`/`KTX2Loader` create workers from **Blob URLs** (needs `blob:`). Fallback `script-src` falls back to `worker-src` -> `child-src` -> `script-src` if worker-src absent, so `worker-src` must be explicit.
- `connect-src 'self' blob: data:`: GLTFLoader/RGBELoader/KTX2/fetch of assets, and loaders that `fetch(blobURL)`; add the R2 custom-domain origin (e.g. `https://assets.example.com`) to `connect-src` and `img-src` if models are served from R2.
- `img-src data: blob:`: textures via `ImageBitmapLoader`/object URLs, embedded GLB textures.
- Self-host Draco/Basis decoders (`/draco/`, `/basis/` copied from `three/examples/jsm/libs/` or `three/examples/jsm/libs/draco/gltf/`) rather than the default gstatic CDN: `dracoLoader.setDecoderPath('/draco/')`, `ktx2Loader.setTranscoderPath('/basis/')`. This avoids opening `script-src`/`connect-src` to `www.gstatic.com`.
- Vite production build emits no inline scripts (unless you add them), so no `'unsafe-inline'` for scripts; keep `style-src 'unsafe-inline'` if UI libs inject style tags (or use nonces/hashes if you go stricter).
- Do **not** set COOP+COEP (`require-corp`) unless you need `SharedArrayBuffer` (threaded wasm); COEP would then require CORP/CORS headers on every cross-origin asset. If needed later: `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Resource-Policy: same-origin` on assets.
- Test with `Content-Security-Policy-Report-Only` first, then enforce.

For API CORS (same-origin serving => none needed). If a Preview/other origin must call the API, handle in Hono `cors()`.

## 9. Complete working example (target layout)

```
suspension-lab/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  wrangler.jsonc
  public/_headers
  public/draco/…  public/basis/…  public/models/…  (<25 MiB each)
  src/            (client: three.js app, modular features)
  worker/index.ts (Hono API)
```

### package.json
```json
{
  "name": "suspension-lab",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "npm run build && vite preview",
    "typegen": "wrangler types",
    "check": "tsc -b --noEmit && vite build && wrangler deploy --dry-run",
    "deploy": "npm run build && wrangler deploy",
    "versions:upload": "npm run build && wrangler versions upload",
    "preview:branch": "npm run build && wrangler preview",
    "tail": "wrangler tail",
    "whoami": "wrangler whoami"
  },
  "dependencies": {
    "hono": "^4.13.19",
    "three": "^0.187.0"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.70.1",
    "@types/three": "latest",
    "typescript": "^5.9.3",
    "vite": "^8.3.8",
    "wrangler": "^4.165.0"
  }
}
```
(`three` 0.187.0 and Vite 8.3.8 are the registry-latest I saw; pin exact versions in the lockfile. If any Vite 8 incompatibility shows up with a plugin, Vite ^7 is also supported by the Cloudflare plugin.)

### wrangler.jsonc
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "suspension-lab",
  "main": "./worker/index.ts",
  // Set to the date you create/upgrade the project; never a future date.
  "compatibility_date": "2026-11-20",
  // "compatibility_flags": ["nodejs_compat"],   // only if you import node:* modules
  "upload_source_maps": true,

  // true while testing; set false and use a custom domain in production
  "workers_dev": true,
  // "routes": [{ "pattern": "suspension.example.com", "custom_domain": true }],

  "assets": {
    // directory is injected by @cloudflare/vite-plugin (dist/client); add it only when deploying without the plugin
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    // API goes to the Worker first; everything else is asset-first (free, unlimited)
    "run_worker_first": ["/api/*"]
  },

  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "issues": { "enabled": true }
  }

  // ---- Optional bindings, add only when the feature module needs them ----
  // "durable_objects": { "bindings": [{ "name": "SESSIONS", "class_name": "SessionDO" }] },
  // "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SessionDO"] }],   // SQLite backend: the only kind on Free
  // "r2_buckets": [{ "binding": "ASSETS_BUCKET", "bucket_name": "suspension-lab-assets" }],
  // "kv_namespaces": [{ "binding": "CONFIG", "id": "<id>" }],
  // "d1_databases": [{ "binding": "DB", "database_name": "suspension-lab", "database_id": "<id>" }],
  // "ai": { "binding": "AI" },
  // "vectorize": [{ "binding": "VEC", "index_name": "suspension-docs" }],
  // "analytics_engine_datasets": [{ "binding": "METRICS", "dataset": "suspension_lab" }],
  // "placement": { "mode": "smart" }   // not recommended with run_worker_first / no distant backend
}
```
(Note the trailing optional block is comments only, so the JSONC stays valid; remove the comma issue: `observability` is the last real key.)

### vite.config.ts
```ts
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],               // reads ./wrangler.jsonc; client build auto-detected from index.html
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,         // three.js is big; split below
    sourcemap: true,
    // keep three in its own long-cached chunk (works with Rolldown in Vite 8 and Rollup in Vite 6/7)
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes("node_modules/three/") ? "three" : undefined) },
    },
  },
  worker: { format: "es" },              // web workers (physics/procedural) as ES modules
  assetsInclude: ["**/*.glb", "**/*.gltf", "**/*.hdr", "**/*.ktx2"],
  // Worker (server) environment is named after wrangler "name" with '-' -> '_' => "suspension_lab"
  environments: { suspension_lab: { build: { sourcemap: true } } },
});
```
(If Vite 8's Rolldown prefers `build.rolldownOptions.output.advancedChunks`, switch; `manualChunks` is retained for compatibility **(unverified for 8.3)**. Large GLB/HDR should live in `public/` (copied verbatim, no hashing, no inlining) and be referenced by URL, not imported.)

### worker/index.ts (Hono)
```ts
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

// `Env` comes from `npm run typegen` (wrangler types -> worker-configuration.d.ts)
const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", secureHeaders({ crossOriginResourcePolicy: "same-origin" }));
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// Example: telemetry sink once METRICS binding is enabled (no await needed; fire-and-forget)
// app.post("/api/metrics", async (c) => {
//   const { scene, fps } = await c.req.json<{ scene: string; fps: number }>();
//   c.env.METRICS.writeDataPoint({ blobs: [scene], doubles: [fps], indexes: [scene] });
//   return c.body(null, 204);
// });

app.notFound((c) => c.json({ error: "not_found" }, 404)); // only reached for /api/* (run_worker_first)

export default app;               // Hono's default export has a fetch() => valid Worker entry
```
Plain-fetch equivalent: `export default { async fetch(req, env, ctx) { const u = new URL(req.url); if (u.pathname === "/api/health") return Response.json({ ok: true }); return env.ASSETS.fetch(req); } } satisfies ExportedHandler<Env>;`

### public/_headers
Use the security-header block from section 8 plus the immutable-cache block from section 5 (remember: max 100 rules, avoid `Cache-Control` in `/*`).

### tsconfig essentials
`"types": ["vite/client", "./worker-configuration.d.ts"]`, `"lib": ["ES2022","DOM","DOM.Iterable","WebWorker"]` (split client/worker tsconfigs as the Cloudflare `vite-react-template` does).

### GitHub Actions (headless/CI)
```yaml
name: Deploy
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run check
      - if: github.ref == 'refs/heads/main'
        run: npx wrangler deploy        # build output already produced by `check`; or `npm run deploy`
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - if: github.event_name == 'pull_request'
        run: npx wrangler preview        # branch Preview (Wrangler >= 4.135)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
Headless container one-liner: `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… CI=1 npm run deploy`. (The `cloudflare/wrangler-action@v4` is the official alternative.)

## 10. Gotchas checklist
1. 25 MiB per-asset cap; >25 MiB GLB/HDR -> R2 (stream via Worker `env.BUCKET.get(key)` with `Cache-Control` + `ETag`, or public R2 custom domain; both skip asset 25 MiB limit; R2 egress free). R2 `.glb`/`.hdr` also not auto-compressed.
2. `_headers` never touches Worker responses; static `_headers` has 100-rule cap.
3. Free plan: `run_worker_first` API paths return 429 after 100k/day; asset paths still fine.
4. Hashed files aren't immutable unless you add `_headers`.
5. SPA fallback returns index.html for missing JS chunks (version skew) - add `vite:preloadError` reload.
6. Range requests unsupported on assets.
7. `wrangler types` after every binding change; commit `worker-configuration.d.ts` or generate in CI.
8. Don't `wrangler login` in headless; use the two env vars; first deploy of a new Worker needs Admin.
9. DOs on Free must be SQLite (`new_sqlite_classes`); migrations tags must be unique and are append-only.
10. Workers AI is always remote in dev (needs creds) and counts neurons even in dev.

## Recommendations for Suspension Lab
- **Deploy as one Worker with Static Assets** (not Pages): Vite SPA in `dist/client`, Hono API at `/api/*` via `run_worker_first: ["/api/*"]`, SPA fallback on. Use `wrangler.jsonc` + `@cloudflare/vite-plugin@^1.70` + `wrangler@^4.165`; skip `cf`/`cloudflare.config.ts` and plugin v2 rc for now (revisit when `cf` 1.0 is stable).
- **Asset strategy**: pre-optimize every GLB (meshopt/Draco) and texture (KTX2); keep each file < 25 MiB so everything ships as free static assets. Self-host Draco/Basis wasm under `/draco/`, `/basis/` (wasm is brotli-compressed by the edge; GLB/HDR are not). Anything bigger (cinematic HDR, high-poly car) goes to R2 behind a Worker route or a custom domain, with `Cache-Control: immutable` and content-hashed names.
- **Headers**: ship the `_headers` block (CSP with `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self' blob: data:`, immutable caching for hashed assets) and Hono `secureHeaders()` for the API; start with CSP Report-Only and test Draco + KTX2 + Vite workers in a real browser before enforcing.
- **Which Cloudflare products genuinely help** (module-by-module, each behind a binding that can be omitted): R2 (big assets), Analytics Engine (anonymous perf/FPS/suspension-toggle telemetry), KV or D1 (saved tuning presets / share links), Durable Object (SQLite, optional shared "garage" sessions), Workers AI (optional explainer chat; 10k neurons/day free), Vectorize only if doing RAG over docs (probably skip). Smart Placement: skip.
- **Plan**: Free plan is enough for development and a demo (assets free/unlimited; API 100k req/day; DO SQLite on free). Move to Paid ($5/mo) before public launch if using Workers AI beyond 10k neurons/day, DO at volume, or needing >20k files / CPU > 10 ms.
- **Domains/previews**: dev on `*.workers.dev`; production on a Custom Domain (enables Compression Rules for .glb/.hdr if ever needed, Early Hints, WAF); PR branches via `wrangler preview` (noindex on workers.dev). Avoid gradual deployments for the SPA unless version affinity is understood (version skew).
- **CI token**: one Account API token limited to the single account with: Workers Scripts Edit (+ Admin role for first deploy), Workers R2 Storage Edit, Workers KV Storage Edit, D1 Edit, Vectorize Edit (if used), Workers AI Read, Account Analytics Read (only for reading AE), and Zone Workers Routes Edit for the custom-domain zone. Validate with `/user/tokens/verify` (or account-scoped verify) + the per-product list probes in section 7 before the first `wrangler deploy`.
- **Open verification items** (do on first deploy): confirm `br` on `.wasm` and absence on `.glb`/`.hdr` via `curl -sI -H 'accept-encoding: br, zstd'`; confirm HTTP/3 (`curl --http3 -I`) on workers.dev vs custom domain; confirm 103 Early Hints behavior; confirm Vite 8 `manualChunks`; confirm exact API paths in the token probe list.
