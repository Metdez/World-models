# 07-03 SUMMARY — Accessibility, reduced motion, audio

**Status:** complete, no deploy. Commits: `6adcdf7` (plan), `96e8bcd` (audio), `99378cd` (debug-stats hunk); the
rest of the a11y CSS/TS edits and the e2e spec were swept into the orchestrator's WIP snapshots (`ad02f6b`,
`7b64b8d`) before I could commit them by path. Their content is what was tested.

## Built
**Audio** (`src/features/audio/`, now default-on as a feature, sound itself muted by default):
- `mix.ts`, pure and unit-tested: engine loop rate from pseudo gears per class (car 7 bands, bike higher revving),
  gain from throttle (`ax`), quieter overrun, silent when paused, lower pitch in slow motion; tyre noise from the
  highest `gripUse` (nothing below 0.8, full by 1.05, needs speed); thump gain from travel-rate spikes (kerbs,
  bumps, hysteresis per corner, 140 ms cooldown) and bump-stop events; every param change through
  `setTargetAtTime` (τ 60 ms), tiny changes skipped. All outputs clamped (rate 0.5–2.2, gains ≤ 0.5/0.32/0.6).
- `index.ts`: no AudioContext before a gesture (click, M, or the first pointer/key press if the visitor left sound
  on); nothing downloaded until sound is first switched on; graph built once (car + bike loops crossfaded by
  class, skid loop, master); one-shots only on events (impact, synthesised 30 ms UI tick on suspension swap);
  `update()` allocates nothing. Muted → master ramps to 0 and the context suspends; hidden tab suspends. Attract
  mode is silent unless `?screen=1` (presenter) has sound on. Toggle: a `Sound` button (`aria-pressed`, speaker
  icon with ×/waves) inside the HUD Display group (own pill if `controls` is off), key M, `localStorage sl-audio`.
  Help card lists "M · Sound on / off".
- **Not listened to** — no audio output here; verified by unit tests and an AudioContext-count e2e only.

**Accessibility**
- Contrast measured (text made transparent, 95th-percentile backdrop pixel per text run): was 2.6:1 over the sky
  (top-left tag, top-right groups). Now `--glass` 0.62→0.8, `--text-2` #a3a8b0→#b1b6be, `--text-3`
  #6b7079→#9ba1a9: min 5.53 (follow), 5.62 (explore), 4.81 (help card, 60 runs).
- `prefers-contrast: more` token set (denser glass, brighter text/hairlines, white focus ring `--focus-ring`).
- Touch: every `#overlay button` gets a ≥ 44 px hit area on coarse pointers (`::after`, layout unchanged).
- Tablet 1024×768: suspension control uses short labels 721–1100 px (was overlapping the telemetry card); the
  amplification chip leaves the top row below 1320 px and at 1600–1680 px (the top-right row with the sound
  toggle reached it), under the view control at ≤ 1200 px, under debug stats when present.
- Insight caption: a separate visually-hidden polite region announces each caption once; live chip numbers no
  longer re-announce (was `aria-atomic` over a 15 Hz chip).
- `#stage` is `role="img"` with a label naming view, vehicle and suspension (updated on change).
- Reduced motion: attract no longer idle-starts (unless `?attract=1`; presenter still can); loading fade instant.
  Camera cuts, zero-duration tokens and the g-g trail were already in place.
- Keyboard: already complete (roving radiogroups, focus ring); the spec proves it.

## Deviations
- `tests/e2e/04-03-hud.spec.ts` line 57: asserted `aria-live` on `.sl-insights`; now asserts it on
  `.sl-insights-announce` (behaviour change above).
- `src/features/controls/controls.css` references `.sl-debug-stats` and the audio feature inserts into the
  controls' Display group by DOM query (no imports; same pattern as 04-05's `:has()` layout rules).
- `src/remote/**` not edited: measured, every remote target is already ≥ 44 px.
- `tests/features/audio.test.ts` added (not listed in the ROADMAP row).

## Verification
VERIFICATION_PLACEHOLDER

Screenshots (inspected): scratchpad `shots/07-03-focus-suspension.png`, `07-03-mute-toggle.png`,
`07-03-tablet-1024x768.png`.

## Known gaps
- Pinch zoom on tablets is camera-controls' default two-finger dolly; only one-finger orbit is e2e-tested.
- Engine sound is a single Kenney loop per class pitched by playback rate; it is a placeholder-quality sound.
- Contrast is measured on the default HDRI/time; other sky states were not sampled.
