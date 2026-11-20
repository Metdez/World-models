# 06-03 SUMMARY — Anonymous analytics

**Status:** complete (not deployed — ships with the phase gate) · commits `05a9efa` (plan), `c23c898` (route +
schema + worker tests), `339fe44` (client feature + tests), this summary.

## Built
- **`worker/schemas/event.ts`** — zod discriminated union of the frozen `AnalyticsEvent` (net.ts): strict objects
  (extra keys rejected, so no ids can be smuggled), every string field is a kebab id `^[a-z0-9][a-z0-9-]{0,39}$`
  (free text impossible), `view` enum, `fps` finite 0–1000. Compile-time check that `z.infer` and the contract are
  mutually assignable. `eventBodySchema` accepts one event or a batch of 1–8 (`EVENT_BATCH_MAX`).
- **`worker/routes/event.ts`** — `POST /api/event`: `content-length` and actual body > 2048 B → 413; per-isolate
  fixed-window limit of 120 requests / 60 s per `cf-connecting-ip` → 429 `{error:'busy'}` (address kept in memory
  for one window only, never written or logged; map pruned above 10 k entries); body parsed as JSON whatever the
  content type (sendBeacon sends `text/plain`); invalid → 400 `{error:'bad_request'}`, nothing written; valid →
  one `STATS.writeDataPoint` per event, then 204. Missing `STATS` binding → 204 no-op. Data point layout (§12.3):
  `indexes:[type]`, `blobs:[type, a, b]`, `doubles:[n]`:

  | type | blob2 | blob3 | double1 |
  |---|---|---|---|
  | suspension-picked | vehicle | suspension | 1 |
  | view-changed | view | '' | 1 |
  | engineer-asked | suspension | '' | 1 |
  | session | quality tier | '' | fps (1 decimal) |

- **`src/features/analytics/`** — `privacy.ts` (DNT `"1"`/`"yes"` on navigator or legacy window, or GPC → off),
  `batcher.ts` (queue; flush at 8 events, after 10 s, on page hide and dispose; send errors swallowed),
  `tracker.ts` (store → events: suspension/vehicle pick after 2 s dwell, only the final choice of a click-through;
  view change immediately; one `session` event after 60 s with `store.quality` and `RENDER.stats().fps`, skipped
  without a renderer; the boot state, attract mode and a presenter big screen (`room.role === 'screen'`) are never
  counted), `index.ts` (off with `?e2e=1` and DNT/GPC; `?features=-analytics` is handled by the kernel; sends with
  `navigator.sendBeacon(API.event, json)`, falling back to `fetch(..., {keepalive:true})` with the rejection swallowed).
  No cookies, storage, ids, user agent or URLs are sent.

## Deviations / known gaps
1. **`engineer-asked` is never emitted by the client.** There is no bus event or store field for "a question was
   asked" (`engineerOpen` only means the panel is open; counting it would mislabel data), and features may not import
   each other. The route accepts and records the event. Options for the orchestrator: (a) R4 — add an
   `'engineer:asked': { suspensionId: string }` event to `contracts/events.ts` that 06-02 emits and analytics listens
   to (two lines), or (b) 06-02 records it server-side in `worker/routes/engineer.ts` with
   `env.STATS.writeDataPoint({ indexes:['engineer-asked'], blobs:['engineer-asked', suspension, ''], doubles:[1] })`
   — no contract change, same data. (b) is simpler.
2. **No "section dwell" event**: the frozen `AnalyticsEvent` union has none, so it was not added (vehicle selection is
   carried by `suspension-picked.vehicle`).
3. **Batching**: the contract body is one `AnalyticsEvent`; the route also accepts an array of ≤ 8 (superset, the
   type is unchanged).
4. **Rate limiting** is per isolate (no rate-limit binding exists for this route and `wrangler.jsonc` is frozen), so it
   bounds abuse per edge isolate rather than globally. Adequate for a write-only, schema-locked, anonymous endpoint.
5. Not deployed; the live check ("Analytics Engine receives events") belongs to the phase gate.

## SQL — "what did the crowd pick" (Analytics Engine SQL API)
Dataset `suspension_lab_events` (created on first write). Data retained 3 months. Always weight by
`_sample_interval` (Analytics Engine samples at high volume). Needs an API token with **Account Analytics: Read**.

```bash
q() { curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --data "$1"; }
```

Suspension picks per vehicle (last 7 days):
```sql
SELECT blob2 AS vehicle, blob3 AS suspension, SUM(_sample_interval) AS picks
FROM suspension_lab_events
WHERE blob1 = 'suspension-picked' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY vehicle, suspension
ORDER BY vehicle, picks DESC
FORMAT JSON
```

Picks per day (event-day trend):
```sql
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob3 AS suspension, SUM(_sample_interval) AS picks
FROM suspension_lab_events
WHERE blob1 = 'suspension-picked' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, suspension
ORDER BY day, picks DESC
```

Which views people open:
```sql
SELECT blob2 AS view, SUM(_sample_interval) AS changes
FROM suspension_lab_events
WHERE blob1 = 'view-changed' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY view ORDER BY changes DESC
```

Race Engineer questions per active suspension (once gap 1 is closed):
```sql
SELECT blob2 AS suspension, SUM(_sample_interval) AS questions
FROM suspension_lab_events
WHERE blob1 = 'engineer-asked' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY suspension ORDER BY questions DESC
```

Device reality — sessions per quality tier and their mean fps:
```sql
SELECT blob2 AS tier, SUM(_sample_interval) AS sessions,
       SUM(_sample_interval * double1) / SUM(_sample_interval) AS mean_fps
FROM suspension_lab_events
WHERE blob1 = 'session' AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY tier ORDER BY sessions DESC
```
Shares (e.g. % multilink) are `picks / sum(picks)` per vehicle, computed from the first query's output.

## Verification (real output)
```
$ npx vitest run tests/worker/event.test.ts tests/features/analytics.test.ts tests/features/vehicle-view.test.ts
 Test Files  3 passed (3)
      Tests  42 passed (42)        # event: 18, analytics: 11, vehicle-view: 13
$ npx tsc -p tsconfig.app.json && echo APP_OK; npx tsc -p tsconfig.node.json && echo NODE_OK
APP_OK
NODE_OK
$ npm run lint:deps
✔ no dependency violations found (137 modules, 379 dependencies cruised)
$ npm run build
dist/suspension_lab/index.js       244.92 kB │ gzip: 58.32 kB │ map: 646.76 kB
✓ built in 185ms
✓ built in 1.33s
```
Final run (all files of this plan committed):
```
$ npm run check
worker/engineer/model.ts(70,64): error TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number | null'.
```
That single error is in 06-02's in-progress `worker/engineer/model.ts` (not owned here; persisted over several
minutes, so reported rather than touched). The remaining check steps, run individually at the same time:
```
$ npx tsc -p tsconfig.app.json && npx tsc -p tsconfig.node.json     → clean
$ npm run lint:deps   ✔ no dependency violations found (138 modules, 383 dependencies cruised)
$ npm test            Test Files  35 passed (35) · Tests  384 passed (384)
$ npm run build       ✓ built in 112ms · ✓ built in 768ms
```
(One earlier full `npm test` run timed out `vehicle-view.test.ts` "REAL wheel mesh" at 5 s under parallel load from
other executors; it passes on re-run and in isolation — 03-03's file.)
