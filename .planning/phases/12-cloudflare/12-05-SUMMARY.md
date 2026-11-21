# 12-05 SUMMARY — Server-shared replays (client)

**Status:** complete, no deploy. Commits `c338a4c` (modules + unit tests + plan), `020c413` (UI), e2e commit, test-type fix.
**Not done:** a real production save. It needs a person to solve the production Turnstile challenge, and headless
Chromium gets no production token. All saves here used Cloudflare's test keys against the local worker.

## Built (`src/features/replay/**`)
- **`turnstile.ts`**: `SITE_KEY = '0x4AAAAAAGLbvJGTqk052mg6'`. On `localhost`, `127.0.0.1` or `[::1]` only, the test
  site keys are used: `1x…AA` always passes, and `?turnstile=fail` picks `2x…AB`, which always fails. On any other host
  the production key is used whatever the query says. This switch bypasses nothing: the server verifies every token with
  its own secret, and the production secret rejects the dummy tokens.
  - `loadTurnstile()` injects `api.js?render=explicit` on first use only, with a 15 s timeout. After a failure it
    removes the script, so the next attempt loads it again.
  - `challenge()` renders one widget: `action replay-save`, dark theme, `flexible` size, `retry: never`. It settles
    exactly once, with a token or with `challenge` / `unavailable` / `expired`. `dispose()` removes the widget.
- **`server.ts`**:
  - Links: `#rid=` parsing (case-folded) and an id check (12 characters of `ROOM_CODE_ALPHABET`); `savedUrl` puts the id
    in the fragment.
  - `saveData` = base64url(deflate-raw(`encodeReplay`)), which is exactly what 12-01 stores.
  - `saveSpan`: the whole run when it is ≤ 599 s and ≤ 64 KB compressed. Otherwise the newest 10, 5, 2 or 1 minutes
    that fit (one second is held back because the recorder's span start rounds down).
  - `saveReplay` and `loadSaved` take an injectable fetch and never throw. Results are typed: `offline`, `challenge`
    (403), `busy` (429), `daily_cap`, `storage`, `disabled` (`not_configured`), `too_large` (413 / `bad_replay`),
    `failed`. Loads add `invalid` (never fetched), `missing` (404 = expired or unknown), `damaged`, `newer-format` and
    `unsupported`.
- **`copy.ts`**: save and load copy with no digits ("thirty days", "the last five minutes").
  - Privacy line: "A quick check first, then only your inputs and the start state are kept, for thirty days: no
    account, nothing about you."
  - Each error has its own sentence and a `retry` flag. Retry is off for the daily cap, disabled saving, too large and
    unsupported.
  - Every failure adds what still works: "The link above still shares the whole run / the last minute."
- **UI (`index.ts`, `replay.css`)**: everything stays inside the existing share popover, opened by the link icon in the
  action row.
  - The popover gains one button: "Save a short link" (≤ 60 s), or "Save the whole run" (longer, or too detailed for a
    fragment).
  - Clicking it shows the privacy line and the widget, then "Saving…". On success the same input shows the `#rid=` link
    with Copy (clipboard, with a select fallback) and "Saved: …"; the widget is removed.
  - On failure the specific line is shown and the fragment link stays in the input. "Try again" appears only where it can
    help.
  - Accessibility:
    - the status line is `role=status`;
    - focus moves to Try again, the input or the panel, never to a removed button;
    - Escape closes the popover and removes the widget.
  - While driving, the popover opens leftwards from the chips at the right edge (it no longer overflows the screen).
  - Opening `#rid=` (on load or on `hashchange`) shows "Fetching the shared run…". The run then goes through the same
    `playLink` path, so it shows "Shared run", "Drive it yourself", and the older-model / other-settings / drift labels.
    Errors show as a calm note.

## Verification (real output)
- `npx vitest run tests/features/replay.test.ts`: 14 passed. Seven are new:
  - the site-key switch;
  - `#rid=` parsing and the id check;
  - save then load through a fake server returns the identical replay, and the request body is exactly `{token, data}`;
  - 11 save status cases plus network down and an HTML 502;
  - load failures, including that an invalid id is never fetched;
  - the save span: whole run, last minute, ten minutes at the limit, nothing fits, no compressor;
  - the copy has no digits.
- **e2e** `tests/e2e/12-05-share.spec.ts`, 3 tests, all passed.
  - Setup:
    - a private build `vite build --outDir <scratch>/x1205/dist`;
    - a programmatic preview on port **4405** with its own persisted state, real workerd, local D1
      (`wrangler d1 migrations apply --local --persist-to`), the real Limiter DO, and real siteverify with the
      always-pass test secret in the build's `.dev.vars`;
    - `.wrangler/deploy/config.json` restored after the preview was up; `--trace off`, `?quality=low`.
  - Test 2 (failures) and test 3 (missing links) passed in one run. Test 1 then passed in its own run, after a
    test-only fix to an invalid mock id.
  - Test 1 (long run):
    - A 70.2 s drive. The popover offers the last minute as a `#r=` link and "Save the whole run".
    - **Zero requests to challenges.cloudflare.com, and no script tag, before the click.**
    - The real widget passed and the real POST returned 201, giving `#rid=U5DUNURKN84N` (a 39-character link). Copy
      worked (clipboard read back).
    - A new page opened the link and played "Shared run" to the end with the **identical end-state CRC `abc001c2`**.
      That page loaded no third-party script.
    - The same saved run re-encoded as `simVersion m2.0` plays with the "older model" label.
  - Test 2 (failures): mocked 403, 429, 503 storage, offline (aborted), 503 daily_cap (no retry), and 503
    not_configured (no retry).
    - Each shows its own sentence plus the fallback, the `#r=` link stays, and focus is checked.
    - The always-fail site key gives "The check did not pass" with **no POST sent**.
    - Escape removes the widget frame.
  - Test 3 (links that cannot play): an unknown id (real 404) → "expired or was never saved"; a malformed id →
    "incomplete"; offline → "Could not reach the lab". The page stays in Auto.
  - Regression: `11-03-replay.spec.ts` against the same build, 2 passed (same CRC `171d8485` as in 11-03).
- `npm run check`: typecheck clean; `✔ no dependency violations found (285 modules, 1008 dependencies cruised)`;
  `Test Files 2 failed | 104 passed | 1 skipped (107)`, `Tests 2 failed | 1088 passed | 20 skipped (1110)`. Neither
  failure is in my files:
  - `presenter.test.ts` "parses the remote URL…": the parsed object now has an extra field. This is 12-04's in-progress
    `src/remote/**`, and it fails alone too.
  - `plant-no-alloc` median step under parallel load: it passes alone.
- Screenshots (looked at), in the session scratchpad `shots/`:
  - `12-05-save-challenge.png`: the popover with the privacy line, the widget and "Saving…";
  - `12-05-saved.png`: the `#rid=` link, copied;
  - `12-05-error-daily-cap.png` and `12-05-error-challenge.png` (with Try again);
  - `12-05-open-rid.png`: "Shared run" playing;
  - `12-05-open-rid-older.png`;
  - `12-05-open-missing.png`.

## Deviations / notes
- Saving is always an explicit click, also for runs over 60 s. Share first shows the last-minute fragment link and the
  "Save the whole run" button, so Turnstile never loads without a choice.
- With the test keys the widget shows Cloudflare's own red "For testing only" strip (visible in the screenshot). This
  happens only on localhost.
- Turnstile renders its iframe inside a closed shadow root, so the e2e finds it by frame URL.
- The saved blob is the compressed `SLR1` replay: input log, start state, header (vehicle, suspension, simVersion) and
  keyframe CRCs. The privacy line says "inputs and start state". The header and CRCs are model identifiers, not visitor
  data.
- Lifted code: none.
