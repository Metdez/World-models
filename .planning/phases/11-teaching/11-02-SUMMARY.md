# 11-02 SUMMARY — Drive events, coach, audio

**Status:** complete, no deploy. Commits: `70f9a41` (plan), `d53145d` (detectors), `ded2cbc` (coach + insights
gate), `56fe34b` (audio), `7878cbf` (e2e).

## Built
- **Detectors** (`src/sim-core/drive/events.ts`): `createDriveDetectors(vehicle?)` keeps the §7.1 shape
  `step(dt, view, input, out, moments?)`. `frameDetectorInput(frame, input)` fills the input from a sampled frame. The
  timing runs on the detector's own clock (sum of dt), so the results do not depend on the step rate (240 Hz steps
  and 60 Hz samples give the same events, tested). Only `+ − × ÷`, sqrt, abs, min and max are used. Nothing is
  retained per step (tripwire as in the plant test).

  | detector | condition | sustain |
  |---|---|---|
  | slide (front / rear axle) | mean of \|tan α\| / tan α_peak(load) > 1.05 at u > 3 m/s. tan α_peak = peakSlip · capacity / C_α(load), the lateral peak of the plant's own tyre curve | 0.15 s |
  | `lift` flag on a slide | at the event: throttle < 0.05, throttle was > 0.3 within the last 0.5 s, and no traction-assist cut in that time | — |
  | lockup (per wheel) | slip ratio < −0.8 (Rω < 0.2 v), u > 3 m/s, brake > 0.3 | 0.1 s |
  | wheelspin (per wheel) | slip ratio > 0.25, slip speed > 2 m/s, throttle > 0.3, u > 3 m/s | 0.2 s |
  | aid (ABS / traction / stability) | rising edge of the active flag | — |
  | strike (per wheel) *(moment)* | travel rate ≥ 0.6 m/s with the wheel ≥ 20 mm above its lagged travel (τ 0.2 s), u > 3 m/s, not on cobbles; `kerb` if the patch is on a kerb | — |
  | hard stop *(moment)* | braking began at ≥ 8 m/s and ended below 0.5 m/s, mean deceleration ≥ 0.6 g | — |

  All channels (kind × axle/wheel/aid): re-arm only after the condition has been false for 0.5 s, and at most one
  event per 0.3 s. A wheel going light and a bump-stop hit use the existing M1 SimEvents (`liftoff`, `bump-stop`).
- **Coach** (`src/features/coach/{rules,index}.ts`, `coach.css`):
  - Rules (pure `CoachEngine`): a line waits 0.8 s after its moment and is dropped once it is 4 s old. At most one
    line per 12 s. Each kind speaks at most 3 times, and the spacing grows (30 s × the times it has already spoken).
    A higher-priority moment replaces a waiting one. Moments in the first 1 s after a takeover or reset are ignored.
  - Station card on zone entry: "<name>: <what to try>", plus "Tyre grip, not suspension" for tyre-grip stations. The
    nearest station of a shared zone is chosen. Each station's card shows once per 90 s, never within 2 s of a reset
    (the drive hint already names the station there).
  - Template values are captured at the moment through `ui/format`.
  - Look: the insights caption's place and styling. One polite announcement of the sentence (the number chip stays
    silent, 07-03 rule). Also emits `insight:shown` with id `coach:<template>`.
  - The coach runs the sim-core detectors on each rendered Manual frame (`shortcut:`, see Hook below). It stops
    offering its own copy of a kind once a detector kind arrives on the bus.
- **Insights** are quiet outside Auto: `onSection` is Auto-only and `event()` returns null outside Auto. A caption on
  screen leaves on the takeover. A swap made while driving gets no delta (the coach acknowledges it).
- **Audio** (`mix.ts` pure + `index.ts`):
  - Outside Auto, the engine follows `engineRpm` (idle..redline of the car's powertrain) and the applied throttle.
  - The tyre cue `squealTone` starts at grip use 0.75, is full at 1, and its pitch rises into the slide. `tyreUse`
    counts slip clearly past the peak (|κ| > 0.2, |tan α| > 0.15) as over the limit.
  - New road-noise bed (all modes): looped white noise (synthesised once, no asset) → band-pass → gain.
    - The level follows the mean |travel rate|. The frame-to-frame level carries the washboard's beat.
    - Each surface has its own colour.
    - Cobbles and kerbs add amplitude modulation at speed / stone spacing (0.15 m) or speed / stripe spacing (0.5 m).
  - Still muted by default. Every change goes through `ramp` (setTargetAtTime). All sources start at gain 0.
  - **Not listened to**: there is no audio output here. The mapping is tuned on paper and checked by unit tests only.

## Coach templates (no digits; `{…}` filled at the moment)
| id | text | chip |
|---|---|---|
| slide-rear-lift | Lifting off mid-corner moved load onto the front tyres; the lighter rear lost grip and the car rotated. | Speed {speed} |
| slide-rear | The rear tyres went past their grip and the tail stepped out. Ease the throttle and steer where you want to go. | Speed {speed} |
| slide-front | The front tyres went past their grip, so the car ran wide instead of turning. Less steering and less speed give it back. | Speed {speed} |
| lockup | The {wheel} wheel locked under braking, and a sliding tyre cannot steer. Ease the brake until it turns again. | Speed {speed} |
| wheelspin | The {wheel} wheel spun up: more drive than its grip could take. Squeeze the throttle in gradually. | Speed {speed} |
| hard-stop | A hard stop: braking moved load onto the front tyres and the nose dived. | From {from} |
| strike-kerb | The {wheel} wheel hit the kerb: its spring took the hit and the damper settled it. | Travel {corner} {travel} |
| strike-bump | The {wheel} wheel hit a bump: one corner moves, the body stays calmer. | Travel {corner} {travel} |
| wheel-lift | The {wheel} wheel went light: with almost no load it has almost no grip. | Load {corner} {load} |
| bump-stop | The {wheel} wheel used up its travel and touched the bump stop. | Travel {corner} {travel} |
| aid-abs / aid-traction / aid-stability | Anti-lock assist eased the brakes so the wheels kept turning and the car could still steer. / Traction assist trimmed the engine as the driven wheels began to spin. / Stability assist braked one wheel to keep the car pointing where you steer. | Assist · simplified model |
| swap | Now on {suspension}. Drive the same corner the same way: notice how much steering it needs and how the rear settles. | — |
| swap-same (MacPherson ↔ double wishbone, below notice per 09-04) | Now on {suspension}. In this model it drives almost like {previous}: the linkage moves differently, the feel hardly changes. | — |

## Hook needed (not my files)
- `drive/plant.ts` (no owner in phase 11) should call the detectors once per fixed step and push into `driveEvents`.
  This needs a `DetectorInput` filled from the tyre IO and `view.u`, and `createDriveDetectors(vehicle)` at plant
  creation. Until then the slide / lockup / wheelspin / aid kinds never reach the bus, so 12-03 (engineer) only sees
  them if it runs the same detectors.
- The moments `strike` and `hard-stop` have no `DriveEvent` kind. Forwarding them on the bus needs a contract change
  (`src/contracts/drive.ts`, frozen).

## Verification (real output)
- `npx vitest run tests/sim-core/drive-events.test.ts`: 15 passed. Cases:
  - Lift-off (R 40 m, 18 m/s, release at 1.2 s): rear slide with `lift` at 1.23 s.
  - Understeer push: front slide, no lift.
  - Lock-up only with ABS off; ABS on gives one `aid abs`.
  - Wheelspin only with TCS off, on the rear wheels.
  - Hard stop yes; gentle stop no.
  - Bump strikes on FL, RL; `kerb` flag on a kerb surface.
  - Hysteresis; 240 vs 60 Hz equal; deterministic.
  - Allocation: "heap churn 80 B/step, retained −1496 B".
  - Autopilot lap at Auto speeds, all three suspensions: 0 slide / lock-up / wheelspin / hard stop, 21–23 aid edges.
    Strikes only on launch, bump-strip (incl. two kerb strikes) and the pave section's humps.
- `tests/features/coach.test.ts` 13, `insights.test.ts` 15, `audio.test.ts` 10: all passed. Goldens and
  `world-zones` passed when run alone.
- `npm run check`: stopped at `tsc -p tsconfig.node.json`, on errors only in `tests/e2e/11-01-vfx.spec.ts` (11-01, in
  progress). The remaining steps, run by hand:
  - app and worker tsc: clean.
  - depcruise: `✔ no dependency violations found (267 modules, 933 dependencies cruised)`.
  - vitest: `2 failed | 981 passed | 11 skipped`. Neither failure is mine:
    - `arch/purity`: `window` in `src/sim-core/drive/control.ts` and `src/sim-core/replay/recorder.ts` (11-03).
    - `world-zones` "sample does not allocate": 5 s timeout under the full parallel suite; passes alone.
- e2e (private build `main-N0eyt51u`, programmatic preview on port 4302, `--trace off`, `?quality=low`):
  `2 passed (1.7m)`.
  - Slide line: "The front tyres went past their grip, so the car ran wide instead of turning. Less steering and less
    speed give it back." · "Speed 64 km/h".
  - Kerb line: "The front-right wheel hit the kerb: its spring took the hit and the damper settled it." ·
    "Travel FR +41 mm".
  - `.wrangler/deploy/config.json` was restored to `dist/` after the preview came up.
- Screenshots (looked at):
  - `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/11-02-slide.png`:
    the line sits above the 11-01 "Grip rings" chip and the pill, with an amber chip.
  - `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/11-02-kerb.png`:
    the line sits above the drive hint row, with an accent chip.
  - In both, the caption covers the lower part of the car body (the insights caption sits in the same place).

## Deviations / notes
- Wheelspin has an extra 2 m/s slip-speed gate. Without it, the traction assist's own launch slip (κ ≈ 0.25 at
  4 m/s) read as wheelspin.
- Strikes use a rise-above-lagged-travel rule, not a rate alone: on the pavé and roughness-C sections the rate alone
  fired dozens of times per lap.
- The 11-02 detectors' allocation churn (~80 B/step in vitest, nothing retained) is at the same runtime-noise level
  the plant test accepts.
- Audio: there is no washboard-specific voice. The washboard is heard through the travel-rate-driven bed. Pavé and
  kerb spacings are constants that match the content.
