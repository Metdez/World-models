# 01-01 SUMMARY — Scaffold, toolchain, contracts, stubs

**Status:** complete · commits `8aa69cd` (toolchain), `97e242e` (contracts/UI/entries), `704c91b` (stubs/rules/tests)

## Built
- **Toolchain**: every §1 dependency installed and pinned exactly (lockfile committed):
  three 0.187.0, @types/three 0.187.0, postprocessing 6.39.6 (peer `three >=0.168 <0.188`: OK), n8ao 2.1.0,
  camera-controls 3.1.2, nanostores 1.5.5, mitt 3.0.1, @fontsource/geist-sans + geist-mono 5.3.0, hono 4.13.19,
  zod 4.6.7, partysocket 1.3.0, uqr 0.1.3 (MIT, verified), stats-gl 4.2.3; dev: typescript 5.9.3, vite 8.3.8,
  @cloudflare/vite-plugin 1.70.1, wrangler 4.165.0, @gltf-transform/{core,functions,extensions} 4.5.1,
  meshoptimizer 1.3.0, vitest 5.1.1, @playwright/test 1.63.0, dependency-cruiser 18.8.0, @types/node 22.20.5.
  No peer conflicts; nothing had to be downgraded.
- **Scripts**: dev, assets, build (`build-assets` + `vite build`), preview, typecheck (app/worker/node), lint:deps,
  test, check, e2e (`build` + `playwright test --trace off`), typegen (`wrangler types --strict-vars=false`),
  deploy (with `APP_VERSION` = git short sha), smoke:live.
- **Configs**: tsconfig solution + app (DOM, vite/client) / worker (workers runtime types; worker/**, sim-core,
  tests/worker) / node (scripts, tests except tests/worker, *.config.ts). Vite: `cloudflare({ remoteBindings: false })`,
  client inputs index.html + remote.html (scoped to the `client` environment), worker sourcemaps. Vitest: node env,
  `tests/**/*.test.ts`, forks pool with `--expose-gc` (for the 02-04 no-alloc test), alias `cloudflare:workers` →
  `tests/fixtures/01-01-cloudflare-workers.ts`. Playwright: chromium + SwiftShader flags, trace off, webServer
  `vite preview :4173` unless `PLAYWRIGHT_BASE_URL` is set.
- **wrangler.jsonc** verbatim §12.1 (DO Room SQLite, AI, Analytics Engine, 2 rate limits, no R2);
  `worker-configuration.d.ts` generated (`ROOM: DurableObjectNamespace<Room>`, `APP_VERSION: string`).
- **Contracts** `src/contracts/*.ts` (12 files) extracted programmatically from §5, unchanged; compile under the
  real three/nanostores/mitt typings.
- **features.ts** verbatim §9.1 + 21 stubs (id / requires / phase / `defaultEnabled: false` for audio and debug, per §9.2).
- **Worker**: index.ts verbatim §12.2; route stubs (501 `not_implemented`) for health, time, rooms (+ `/ws/:code`,
  `/r/:code`), engineer, event; Room DO stub.
- **UI**: tokens.css (research 14 D2–D4 + D8 motion, reduced-motion zeroes durations), base.css (self-hosted Geist
  Latin 400/500/600 + Mono 400, full-viewport `#stage`/`#overlay`, overlay pointer-events pass-through), dom.ts
  (`h()`, `mount()` returning a remover), format.ts (`deg/mm/kmh/kN/gUnits` conversions + `fmt()` readout formatter).
  base.css is linked from index.html/remote.html (so main.ts need not import CSS).
- index.html (`#stage`, `#overlay`), remote.html, favicon.svg, `_headers` (security headers, CSP **Report-Only**,
  `/assets/*` immutable, manifest/html revalidate), CREDITS.md skeleton (DB11 exact CC BY text, Poly Haven, code).
- `.dependency-cruiser.cjs` implementing §2 rules 1–5 (+ remote layer rule, unresolvable-import rule).
  Verified with deliberate violations: sim-core→three/nanostores/fs/contracts/store, contracts→three (value),
  feature→feature, feature→kernel, kernel→feature, worker→contracts/app.ts and a cycle were all reported.
- Arch tests: `purity.test.ts` (forbidden tokens in sim-core, with a self-check), `contracts-verbatim.test.ts`
  (byte-compares the 12 contracts + features.ts + wrangler.jsonc + worker/index.ts against ARCHITECTURE.md; asserts
  21 registered features each pointing at a stub with the same id).

## Deviations
1. **`@playwright/test` 1.63.0** (not ^1.65 as in §1) per orchestrator: matches the pre-installed browsers
   (`/opt/pw-browsers/chromium-1243`, Chromium 157 launched OK). `playwright install` was NOT run.
2. **`@types/node` 22** added (dev): needed by tsconfig.node and vitest; not in §1.
3. **`worker/dom-types.d.ts`** (new, owned here): `worker → contracts/net.ts → store.ts → app.ts` names
   `HTMLElement`, which workers types lack; an opaque `interface HTMLElement {}` lets the frozen contracts type-check
   in the worker program.
4. **Placeholder `src/app/main.ts`** (`export {}`) so `vite build` has an entry; 01-02 owns and replaces it.
5. `index.html` has no asset preload hint yet (an unused preload would warn in the console); 07-02 may add one.
6. `.gitignore` also ignores `blob-report/`, `.dev.vars*`, `.env*`, `*.tsbuildinfo`.

## Notes for later plans
- Workers Static Assets redirect `/remote.html` → `/remote` (307, default `html_handling`); `/r/:code` → 
  `/remote.html?room=` still lands on the page. 06-01/06-04 should test with the query preserved.
- `vite preview` runs the Worker in workerd with local bindings (remoteBindings off); AI calls only work deployed.
- Worker tests go in `tests/worker/**` (type-checked by tsconfig.worker.json; `Env` available, `cloudflare:workers`
  shimmed at runtime). Checked with a throwaway test: Hono `app.request` + secureHeaders + 404 handler work.
- The shim's `DurableObject` stores `ctx`/`env` only; 06-01 may need to extend it (fixture owned by 01-01 → R4 or
  add a new fixture + alias change, which is frozen config).

## Verification (real output)
```
$ npm run check
> tsc -p tsconfig.app.json && tsc -p tsconfig.worker.json && tsc -p tsconfig.node.json
✔ no dependency violations found (52 modules, 100 dependencies cruised)
 Test Files  2 passed (2)
      Tests  19 passed (19)
$ grep -c "export { default as" src/app/features.ts
21
$ npm run build
build-assets (stub): wrote public/asset-manifest.json with 0 assets
dist/suspension_lab/index.js       71.35 kB │ gzip: 19.36 kB
dist/client/assets/base-DUQ6HJz-.js                             0.67 kB │ gzip: 0.38 kB
✓ built in 82ms
$ npx wrangler deploy --dry-run
env.ROOM (Room) Durable Object · env.STATS Analytics Engine Dataset · env.AI AI · env.RL_ENGINEER (6 requests/60s)
env.RL_ROOMS (10 requests/60s) · env.ASSETS · env.APP_VERSION ("dev")
--dry-run: exiting now.
$ vite preview (manual curl): / 200 · /api/health 501 · /api/nope 404 (json) · /r/ABCDE 501 · /asset-manifest.json 200
```
Not deployed (per plan).
