# M2-18 Audio and haptics for manual driving

Scope: browser engine/tyre/road/wind audio, gamepad rumble, phone vibrate, mixing and autoplay. [S] = sourced, [E] = estimate (needs ear/device tuning).

## 0. What we already have (read from repo)

`src/features/audio/mix.ts` + `index.ts` (muted by default, `M` toggle, remembered in `localStorage` key `sl-audio`, no AudioContext before a gesture, assets fetched on first unmute):
- One looped Kenney sample per class, pitched by `playbackRate` from a **pseudo gearbox** driven by speed (`engineRevs(cls, speed)`), gain from forward accel `ax`. Skid is a looped sample gated by `maxGripUse` (silent <0.8, full at 1.05) and speed. Thump one-shots from wheel travel rate (`THUMP_RATE = 0.45 m/s`) with a 140 ms cooldown. All params move through `setTargetAtTime` with tau 60 ms (`ramp`).
- Gaps for Manual Drive: rpm is faked from speed (no clutch/launch/overrun/stall), one sample means pitch-only (sounds like a toy above ~1.5x), no load axis, no surface noise, no wind, no per-wheel skid, no haptics, no master limiter, attract-mode and manual would share the same mapping.
- Licences in repo: Kenney Starter-Kit-Racing sounds CC0, skid by Landeplage CC0; repo itself MIT [S: https://github.com/KenneyNL/Starter-Kit-Racing, ~450 stars, 20 commits, README states assets CC0, skid CC0].

## 1. Engine sound: three architectures

| Approach | Realism | Load/RPM axes | Cost | Assets | Verdict |
|---|---|---|---|---|---|
| A. One loop, `playbackRate` (current) | low; chipmunk above ~1.5x | rpm only | trivial | 1 file | keep as fallback |
| B. Sample crossfade: N loops recorded at fixed rpm (and on/off throttle), constant-power crossfade between the two neighbours, per-clip pitch around its own centre | high if recordings are good | rpm x load | N BufferSources, no worklet | need 4-8 clean loops per engine | best realism per effort, **asset-limited** |
| C. Procedural (physically-informed waveguide/noise; AudioWorklet) | medium, "synthetic but alive", fully continuous, no loop seams | any param | 1 worklet, 3 outputs, ~tens of cylinders of delay lines; JS worklet glitches on weak CPUs (author added a WASM port) | none | good for **demo of "model drives sound"**, risky for premium feel |
| D. Granular (grains analysed from a slow rpm ramp recording, selected by rpm and load) | very high | rpm x load | low per [S] | needs one clean long ramp recording + analysis tool | needs a recording we do not have; skip |

Approach B maths worth lifting (Unity VNS, ATG-Simulator/VehicleNoiseSynthesizer, licence not verified here -> treat as **idea only**): two neighbouring clips crossfaded with constant-power law `gainLo = cos(t*pi/2)`, `gainHi = sin(t*pi/2)` so `cos^2+sin^2=1`; hysteresis on pair selection; per-clip min/max pitch [S: https://github.com/ATG-Simulator/VehicleNoiseSynthesizer]. Trivial to re-implement (our own code, no licence issue):

```ts
// bands[i] = {rpmCentre, buf}; rpm in engine units; load 0..1 picks on/off-throttle layer set
function crossfade(rpm: number, bands: Band[]) {
  let i = bands.findIndex(b => b.rpmCentre > rpm); i = clamp(i, 1, bands.length - 1);
  const lo = bands[i - 1], hi = bands[i];
  const t = clamp((rpm - lo.rpmCentre) / (hi.rpmCentre - lo.rpmCentre), 0, 1);
  lo.gain.setTargetAtTime(Math.cos(t * Math.PI / 2), now, 0.03);
  hi.gain.setTargetAtTime(Math.sin(t * Math.PI / 2), now, 0.03);
  lo.src.playbackRate.setTargetAtTime(rpm / lo.rpmCentre, now, 0.03); // keeps each clip within ~+-25% of its recorded pitch
  hi.src.playbackRate.setTargetAtTime(rpm / hi.rpmCentre, now, 0.03);
}
```
Two layers (on-load, off-load/overrun) = 2x pairs; set layer gain from load (`throttle`) with the same cos/sin law. All other bands gain 0 (stop them or leave looping at gain 0; 8 sources is fine).

### 1a. Open-source procedural engines (licences)

| Repo | Stars (approx) | Licence | Notes |
|---|---|---|---|
| Antonio-R1/engine-sound-generator https://github.com/Antonio-R1/engine-sound-generator | 53, 17 commits, 9 forks | **MIT** [S: repo page + file header "Copyright (c) 2021-2022 Antonio-R1 ... MIT"] | Three.js + Web Audio; AudioWorklet (`engine_sound_generator_worklet.js`, 398 lines) and WASM/Emscripten port; Doppler via DelayNode. Based on Baldan et al. 2015 "Physically informed car engine sound synthesis". Last activity: not confirmed in this session (API blocked), file header says 2021-22 -> **treat as dormant** [E]. |
| DasEtwas/enginesound https://github.com/DasEtwas/enginesound | 386, 138 commits, 25 forks | **MIT** [S] | Rust desktop (conrod/glium, cpal). Not web, but its `.esc` RON presets (`example1..6.esc`) are tuned parameter sets for the same paper and can be rendered **offline** to WAV loops (CLI has `--crossfade` "make seamless loops" and warmup option [S README]). Best route to **generate our own CC0-by-us V12/V8/twin loop set** with MIT tooling. |

Code worth lifting from Antonio-R1 (MIT, keep header): the `process()` skeleton and the per-sample update. Core idea, verbatim from `engine_sound_generator_worklet.js` lines ~340-351:

```js
let intakeNoise = this.intakeNoiseLowPassFilter.getFilteredValue(2.0*Math.random()-1.0);
if (this.rpm < 25.0) intakeNoise = 0;
let crankshaftValue = this.crankshaftLowPassFilter.getFilteredValue(0.25*Math.random());
for (let i=0; i<this.cylinders.length; i++) {
  let x = this.currentRevolution + i*(this.cylindersCountInverse + crankshaftValue);
  this.cylinders[i].update(intakeNoise, this.straightPipe.outputLeft, x%1);
  this.sound[index] += this.cylinders[i].cylinderWaveguide.outputLeft;
}
this.currentRevolution += this.secondsPerSample*this.rpm/120.0;   // 4-stroke: 2 revs per cycle
```
Worklet params: `rpm` and `throttle`, both `a-rate` (read `parameters["rpm"].length > 1 ? [i] : [0]`). Example parameter set (4-cyl): waveguide lengths 100 samples, open reflection 0.01, closed 0.95, `ignitionTime: 0.016`, `mufflerElementsLength: [10,15,20,25]`. Output is 3 channels (intake / block vibration / outlet) each with its own GainNode -> we can drive intake gain from throttle and outlet from load. Caveats: hard-coded `SAMPLING_RATE = 44100` (wrong at 48 kHz unless converted), uses `Math.random()` in the audio thread (non-deterministic; fine for audio), JS version "glitches" per author -> only adopt with a CPU budget test.

**Procedural verdict:** powerful for the story "the physics drives the sound" (rpm, load -> intake/outlet), but unpredictable timbre and tuning cost; for a premium live event, recorded multi-band loops sound better. Use DasEtwas offline to generate loops if no good recordings are found.

### 1b. Loop packs (URLs + licences)

| Asset | Licence | Use |
|---|---|---|
| Kenney Starter-Kit-Racing `audio/` (engine, motorcycle engine, impact) https://github.com/KenneyNL/Starter-Kit-Racing/tree/main/audio | CC0 [S] | already in use; single rpm each |
| Landeplage skid (in same repo) | CC0 [S] | already in use |
| OpenGameArt "racing car engine sound loops" by domasx2 https://opengameart.org/content/racing-car-engine-sound-loops | CC0 label [S], **but** a commenter notes the source was an "sampling+" CC clip so CC0 relicensing is doubtful -> **do not ship** without author confirmation | 6 loops differing in pitch only; gives no new information beyond what pitch-shifting does |
| Freesound V8/engine recordings (e.g. Mercedes G500 rev run-ups, Dodge RAM V8, E-type Jaguar mono rev https://freesound.org/people/Dan_AudioFile/sounds/614700) | licence **not verified** (Freesound is per-file: CC0, CC-BY, CC-BY-NC) -> check each page; BY needs credit in CREDITS.md, NC forbidden | long rev run-ups are the raw material for approach B/D (slice at stable rpm) |
| Pixabay SFX "v12 engine" results https://pixabay.com/sound-effects/search/v12%20engine | Pixabay Content Licence (not CC0/CC-BY; no standalone redistribution) -> **not eligible** under the brief's whitelist |
| Dedicated CC0 V12 or parallel-twin loop packs | **None found.** Searches returned no multi-rpm CC0 set; the OpenGameArt forum thread itself says "hardly any sounds around" [S: https://freesound.org/forum/sample-requests/17825]. |

Conclusion: there is no ready CC0 multi-rpm DB11-V8/V12 or twin pack. Options ranked: (1) keep Kenney loops, add a second "layer" via filtering; (2) author-confirmed Freesound CC0 run-up + manual slicing; (3) render our own with DasEtwas/enginesound (MIT tool, our output) from tuned presets; (4) Antonio-R1 worklet at runtime.

## 2. Tyre, road, suspension, wind

All mappings below are [E] unless cited; they feed from state we already have (per-wheel slip angle/ratio, Fz, grip use, wheel travel rate, speed, surface from `roadHeight`).

**Tyre squeal (teaching cue).** Real tyres sing/howl as slip approaches the peak, before sliding. Drive a band-pass/looped-sample voice per axle (2 voices, not 4) with:
- `u = max(|alpha|/alpha_peak, |kappa|/kappa_peak)` (combined slip use; our existing `maxGripUse` is the proxy). Onset at **0.75**, full at **1.0** (current 0.8/1.05 is already close; moving onset earlier makes it a *warning*). Gain `smoothstep(0.75, 1.0, u)`, pitch `rate = 0.85 + 0.35 * smoothstep(0.75, 1.15, u)` [E]. Past the limit (u > 1.05) add a noisier layer (skid/scrub) and cut the tonal one. Load scales amplitude: `gain *= clamp(Fz / Fz_static, 0.5, 1.5)` [E]. Gate by speed (`smoothstep(2, 6, v)`, as now) so parking never howls.
- Low-pass the squeal 6 kHz fixed; keep peak at -18 dBFS (it is the harshest sound in the mix and the one that fatigues first).
- Honesty: label it a model estimate (already done in `mix.ts` comment "a model estimate"); never show it as measured data.

**Road-surface noise (from `roadHeight` features).** A 2-band noise voice (pink noise through a band-pass at 80-250 Hz for rumble + 1-3 kHz for hiss), gain `0.1 + 0.9 * roughness` with roughness = RMS of wheel travel rate over 100 ms, plus surface-tagged character:
- pavé: periodic ~wheel-passing rate `f = v / pitch_of_setts` (setts ~0.1 m -> 50-100 Hz at 5-10 m/s) amplitude-modulates the rumble (use a gain LFO node, frequency set per frame) [E].
- washboard: pure tone at `v / wavelength` (our model has a wavelength parameter); a sine at that frequency, tied to the physical spatial frequency -> audibly "right" pitch as speed changes [E, mechanically exact].
- kerbs: use the existing thump one-shot but add a short (~120 ms) rumble-strip burst at `v / strip_pitch`; cap with the 140 ms cooldown.

**Suspension thumps.** Keep `thumpGain(travelRate, stop)`; add low-pass cutoff `200 + 1800 * hardness Hz` where hardness = bump-stop engaged, and a second pitch-lowered copy for the body-side thud on compression events >0.9 m/s [E]. Rebound topout: softer tick (gain x0.5).

**Wind.** Looped pink/white noise through a low-pass; gain `~ v^2` (dynamic pressure), normalised: `g = 0.25 * (v / 60)^2` clamped 0..0.25, cutoff `300 + 40 * v` Hz [E]. Keep wind under -24 dBFS; it adds speed cue without raising loudness of the rest. Motorcycle: more wind (rider exposed) x1.6, no cabin low-pass.

**Engine mapping with a load axis.** Replace `engineRevs(speed)` with real rpm from the manual-drive drivetrain (`rpm = v / r_wheel * gear * final * 60/2pi`, clamp idle..redline); keep pseudo-gearbox for attract mode. Throttle -> on-load layer, overrun -> off-load layer, shift events -> 150-250 ms rpm dip plus a short "blip" one-shot (same code path as `thump`).

## 3. Gamepad haptics (support as of 2026)

MDN browser-compat-data (`api/GamepadHapticActuator.json`, fetched 2026-11) [S: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GamepadHapticActuator.json]:

| Feature | Chrome/Edge (desktop + Android) | Firefox | Safari |
|---|---|---|---|
| `playEffect` / `reset` (dual-rumble) | 68 (Edge 15 flag per data) | **not supported** | 16.4 (macOS; iOS false per data) |
| `effects` array (feature-detect trigger-rumble) | 126 | no | no |
| `trigger-rumble` effect, `leftTrigger/rightTrigger` params | **126** | no | no |
| `pulse()` (legacy) | no | 55 (legacy, deprecated) | no |

Notes: trigger-rumble is marked experimental/standard-track [S]. In practice trigger-rumble works only on hardware exposing it via the OS API (Xbox One/Series controllers on Windows in Chromium; PS5 DualSense triggers not exposed as rumble) [E]. Pages must be focused and the pad must have had a button press (Gamepad API gesture requirement) [E]. Firefox only exposes input while focused [S: testmuai summary]. MDN example for the call:

```js
gamepad.vibrationActuator.playEffect("dual-rumble",
  { startDelay: 0, duration: 200, weakMagnitude: 1.0, strongMagnitude: 1.0 });
```
Feature-detect pattern (web.dev, https://web.dev/articles/gamepad):
```js
if (!('vibrationActuator' in gamepad)) return;
if (!('effects' in gamepad.vibrationActuator) || !gamepad.vibrationActuator.effects.includes('trigger-rumble')) return;
gamepad.vibrationActuator.playEffect('trigger-rumble', { duration, startDelay: 0, leftTrigger: ..., rightTrigger: ... });
```

**Mapping (our design, [E]):** send one effect every 50-100 ms of **short duration (~120 ms)**; re-calling `playEffect` replaces the current effect, so no stacking.
- `strong` (low-frequency motor, left): chassis events - kerb strike, bump-stop hit, hard landing; magnitude = `thumpGain` normalised.
- `weak` (high-frequency motor, right): tyre limit - `weak = 0.6 * smoothstep(0.8, 1.05, gripUse)`; plus surface rumble (pavé/washboard) `weak = 0.15 + 0.5*roughness`.
- ABS-like cue under braking when slip ratio exceeds peak: pulse `strong` 40 ms on / 40 ms off. (We have no ABS; do this only if the model has one, otherwise skip.)
- Triggers (when `effects` includes it): right trigger = throttle wheelspin (`kappa > peak`), left = brake lock. Otherwise fall back to dual-rumble.
- Cap overall magnitude at 0.7 and fade to 0 on pause or Auto mode. Haptics default **off for Auto** (no input = no feedback) and an on/off toggle with the sound toggle.

**Phones:** `navigator.vibrate(pattern)` needs sticky user activation [S: MDN], is Chromium/Firefox Android only; iOS Safari has no Vibration API (and no rumble) [E: widely known, re-check]. Use short 15-30 ms pulses on kerb/bump-stop only; never continuous; guard with `'vibrate' in navigator`.

## 4. Mixing, fatigue, autoplay

- **Hierarchy (target levels, [E]):** engine -20 dBFS at idle .. -12 at redline, wind <= -24, road <= -26, squeal peak -18, thumps -14 (transient), UI tick -30. Everything through one master `GainNode` -> `DynamicsCompressorNode` (threshold -14, knee 12, ratio 4, attack 5 ms, release 200 ms) as a safety limiter (current master is 0.7 gain with no limiter; a stack of engine + skid + thump can clip) [E].
- **Anti-fatigue:** low-pass the engine at ~5-7 kHz with an 80 Hz high-pass; duck engine -3 dB when squeal > 0.5; fade all sound to -12 dB after 30 s of steady cruising; no looping idle louder than -26 dBFS in attract mode; pitch glides never faster than the 60 ms tau (already present).
- **Event use:** keep sound **off by default** and let the presenter enable it on the stage machine; attract mode stays silent unless `flags.screen` (already implemented). Offer a master volume slider (0-100%) besides the mute, remembered in the same `sl-audio` key.
- **Autoplay [S: https://developer.chrome.com/blog/autoplay]:** AudioContext may start only after a user gesture (or high MEI on desktop). Pattern already in repo: create context in `ensure()` called from click/key, `resume()` on later gestures, `suspend()` 600 ms after mute. Add: re-`resume()` on `visibilitychange` and on first gamepad `gamepadconnected` + button press (a gamepad press counts as input for Gamepad API but **not** as activation for Web Audio in all browsers [E] -> still require the first click/key). `navigator.vibrate` also needs sticky activation [S].
- **Performance:** keep a single AudioContext; one worklet at most; avoid allocation in `update()` (existing design OK); lazy-fetch loops (current); use OGG/Opus with MP3/WAV fallback if Safari decode fails (current `load()` returns null -> silent voice).

## Recommendation for Suspension Lab

1. Keep the current audio module structure (pure `mix.ts` + WebAudio `index.ts`, muted by default, user-gesture start, ramp helper); extend rather than rewrite.
2. Drive the engine from **real drivetrain rpm and throttle** in Manual mode; keep the speed-based pseudo-gearbox only for Auto/attract.
3. Upgrade the engine voice to **crossfaded multi-band loops with on/off-load layers** (cos/sin constant-power law above, 4-6 bands) as soon as better loops exist; until then pitch-shifting the Kenney loop is acceptable.
4. Do **not** ship a runtime procedural engine for now; if loops are the blocker, render our own with DasEtwas/enginesound (MIT) offline; Antonio-R1/engine-sound-generator (MIT, ~53 stars, apparently dormant) is a code reference for a later AudioWorklet experiment (needs 48 kHz fix and a CPU budget test).
5. Do not add any OpenGameArt/Freesound/Pixabay loop unless the specific file's licence is confirmed CC0/CC-BY and listed in CREDITS.md; domasx2 loops and Pixabay are excluded.
6. Make the skid cue a **teaching warning**: onset at grip-use 0.75, per-axle voices, pitch rises with slip, load-scaled gain, labelled a model estimate.
7. Add surface voices: washboard tone at `v/wavelength`, pavé AM at `v/sett pitch`, one road-roughness noise voice; wind gain ~ v^2 under -24 dBFS.
8. Add a master `DynamicsCompressorNode` limiter and a volume slider; keep engine under -12 dBFS and add a slow auto-fade for long drives.
9. Gamepad haptics: `dual-rumble` everywhere it exists (Chrome/Edge 68+, Safari macOS 16.4+), `trigger-rumble` only if `effects.includes('trigger-rumble')` (Chromium 126+); Firefox gets nothing (silently). Send 120 ms effects at <= 20 Hz; strong = kerb/bump-stop, weak = tyre limit and surface roughness.
10. Haptics are opt-in/obvious: toggle beside Sound, default on only when a gamepad is connected in Manual mode, zero in Auto/paused.
11. `navigator.vibrate` for phones: 15-30 ms pulses on kerb/bump-stop only, behind a user gesture and feature test; do not rely on iOS.
12. Test plan: unit-test the pure mappings in `mix.ts` (bounded, finite, no allocation); manual ear test at event volume with a 10-minute run for fatigue; verify no clipping with a meter on the master.
13. Risks: no CC0 multi-rpm packs found; haptic support is Chromium-first so the demo machine must be Chrome/Edge; trigger-rumble depends on controller/OS; procedural engines can glitch under load; all numeric thresholds above marked [E] require tuning by ear.
