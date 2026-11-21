# M2 research 07: input controls for browser driving

Scope: keyboard smoothing, speed-sensitive steering, Gamepad API (2026), wheels, touch, pointer lock, accessibility, Auto<->Manual "take control" UX, and a proposed input abstraction layer.
Marks: [S] sourced (link), [E] estimate / author's judgement, [S-weak] only a secondary/marketing source, verify before relying.
Date of research: 2026-11-21.

## 1. Keyboard (WASD / arrows): digital -> analog

### 1.1 Why it needs work
A key is 0 or 1. Raw 0/1 steering into a lateral model gives twitchy response at speed and no part-lock. Every game that is pleasant on keyboard does the same three things: (a) ramp the axis toward the target at a finite rate, (b) ramp back to zero at a different (usually faster) rate on release, (c) reduce the reachable lock as speed rises.

### 1.2 Reference implementation A: VDrift (GPL-3.0, IDEAS ONLY, do not copy)
Repo: https://github.com/VDrift/vdrift , file `src/carcontrolmap.cpp`. Header of the file states GPL v3 or later [S]. Stars approx 700-1000, still maintained [E]. Treat the code below as a description of an algorithm, re-derive it ourselves.

Ramp for button inputs (verbatim structure, simplified): value moves toward the target at `button_ramp * dt * sign`. Defaults in the upstream menu: `control.button_ramp` off(0 = instant) / long 5.0 / medium 7.5 / short 10.0 units/s [S: http://wiki.vdrift.net/index.php?title=Configuring_the_controls]. A community patch made release faster than press (press sign 0.3, release sign -1.2, i.e. release is 4x faster) [S: http://vdrift.net/Forum/showthread.php?tid=1140]. Lesson: **asymmetric ramps** (slow press, fast release) are the known-good feel.

Post-ramp rate limit for non-wheel devices: `steerstep = 5*dt` per tick, i.e. 5 full-lock units per second (0 -> 1 in 0.2 s) [S: carcontrolmap.cpp ProcessSteering].

Speed sensitivity (current upstream, arctan form), carmph = speed in mph, `speedsens` in 0..1:
```
ssco  = speedsens * (1 - val^2)            // val = requested steer in [-1,1]
coeff = ratio*45 * (1 - atan(carmph*80*ssco) * 0.6366198)   // 0.6366 = 2/pi ; ratio = 20 ; clamp coeff <= 1
val   = val * coeff
```
Key insight from the thread (author fudje, adopted by maintainer): scaling the damping by `(1 - val^2)` makes small inputs damped but **full lock always reachable** so the player can still countersteer in a slide. Maintainer: "Most of the steering range is still pretty linear, but at the ends of the range it gets exponential so you can still countersteer effectively." [S: vdrift forum thread above]. Failure mode reported: a fixed global curve "killed the F1 car", so per-vehicle config is needed (mirrors our two vehicles: car and motorcycle).

### 1.3 Reference implementation B: Mars Rally Championship (browser game, closed/unknown licence, data only)
"full lock narrows from 49 deg below about 13 km/h to about 20 deg above about 27 km/h" (analog touch steering track) [S: https://marsrallychampionship.com/blog/mobile-browser-racing-games, a developer's own marketing post, [S-weak]]. Useful as a sanity range: ratio of low-speed to high-speed lock about 2.5:1 over a narrow speed band; for our 1.65 km loop (speeds higher) the band will be wider.

### 1.4 Reference implementation C: Unity legacy Input Manager (proprietary, concept only)
Axis fields: `Sensitivity` = "speed in units per second that the axis will move toward the target value (digital devices only)"; `Gravity` = "speed in units per second that the axis falls toward neutral when no input"; `Snap` = reset to zero when the opposite key is pressed; `Dead` = analog deadzone [S: https://docs.unity3d.com/6000.2/Documentation/Manual/class-InputManager.html]. Shipped defaults for Horizontal are gravity 3, sensitivity 3, dead 0.001, snap on [E: from memory of the default InputManager asset, not re-verified]. A community 2-line equivalent (MoveTowards with separate accel/decel, 6 / 5 per s) is in https://discussions.unity.com/t/axis-gravity-smoothing/802656 [S, forum snippet, licence unspecified, trivial].

### 1.5 What we should implement (original code, no licence issue)
Per-tick, fixed `dt`, one axis:
```ts
// target in {-1,0,1}; returns new value
function approachAxis(v: number, target: number, dt: number, p: {rise: number; fall: number; snap?: boolean}) {
  if (p.snap && target !== 0 && Math.sign(target) !== Math.sign(v)) v = 0;       // instant reversal
  const rate = target === 0 ? p.fall
             : Math.abs(target) > Math.abs(v) && Math.sign(target) === Math.sign(v) || v === 0 ? p.rise
             : p.fall;                                                          // moving back toward centre
  const step = rate * dt;
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
```
Starting parameters [E, informed by the sourced ranges above; tune by feel]:
- steering: rise 2.5-5 /s (0.2-0.4 s to full lock), fall 6-8 /s (about 0.15 s back to centre), snap on.
- throttle: rise 3 /s, fall 6 /s. Brake: rise 6 /s, fall 10 /s (brake should bite quickly, but not step-function, to avoid pitch shock on our 7-DOF model).
- Speed-sensitive lock: `maxSteerNorm(v) = lerp(1, k_hi, smoothstep(v0, v1, speed))`, with k_hi about 0.35-0.5 for the car, v0 about 8 m/s, v1 about 35 m/s [E]; **do not clamp the countersteer range**: apply VDrift's `(1-|val|^2)` trick (or equivalent: apply the reduction mostly to |val|<0.6 and blend to 1 at |val|=1) [idea S, numbers E].
- Better physical alternative worth considering: limit by **lateral-acceleration target** rather than angle: steer_cmd -> desired lateral accel a_y = steer * a_y_max(speed); then delta = f(a_y, speed, wheelbase) via bicycle model. This is how "approachable but physically grounded" cars (and many assists) behave, and it makes keyboard, pad and touch all feel equivalent. [E]
- Opposing keys (A+D): cancel to 0 (do not "last key wins" for steering, but do for the accel/reverse pair, see 7.3).

### 1.6 Keyboard plumbing gotchas [E unless noted]
- Use `KeyboardEvent.code` (physical position: KeyW/KeyA/KeyS/KeyD) not `.key`, so AZERTY/Dvorak work with the same defaults. Track a `Set<string>` of held codes.
- Clear the set on `window blur`, `visibilitychange` (hidden), and `contextmenu`, else keys stick when focus is lost (very common live-demo bug).
- `event.repeat` must be ignored for state; use keydown/keyup for set membership only.
- `preventDefault()` on arrows/space only while driving (they scroll the page). Do not trap Tab or Escape.
- Keyboard rollover/ghosting: some cheap keyboards drop W+A+Space; offer an alternative handbrake key (Shift or Space, user-remappable).
- Sample input in the fixed-step sim tick (240 Hz sim, frame input at 60 Hz): store the latest normalised input snapshot, let the sim read it; deterministic replay needs the snapshot logged per tick.

## 2. Gamepad API (2026 state)

### 2.1 Standard mapping, reading, polling
- Standard mapping: buttons 0-3 face, 4/5 bumpers, **6/7 = left/right trigger with analog `.value` 0..1**, 12-15 d-pad, axes 0/1 left stick, 2/3 right stick; `mapping === "standard"` is set when the browser recognises the pad [S: https://w3c.github.io/gamepad , https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/mapping]. `mapping` has been Baseline since March 2017 [S: MDN].
- It is a **polling** API: call `navigator.getGamepads()` each frame and compare `gamepad.timestamp` to detect fresh data [S: MDN Using the Gamepad API]. Chromium polls hardware every 4 ms ("~250 Hz") internally [S: chromium device/gamepad/gamepad_provider.cc via https://controlchecker.com/browser-compatibility]. Our 60 Hz frame read adds up to about 16 ms of quantisation; fine for driving.
- `getGamepads()` returns snapshots in some engines: re-fetch every frame, never cache the object [E, long-standing behaviour].
- A gamepad is hidden from the page until the user presses a button/moves a stick (fingerprinting protection); `gamepadconnected` fires then. Chromium additionally withholds an axis's value until it has seen the axis near rest once, so a drifting stick reads 0 until moved [S-weak: https://www.freecodecamp.org/news/gamepad-api-javascript-guide]. Consequence: show a "press any button on your controller" hint instead of auto-assuming none.
- Hot-plug: listen to `gamepadconnected` / `gamepaddisconnected`, key the active pad by `gamepad.index` + `id`, on disconnect fall back to keyboard and show a toast; never throw if `getGamepads()[i]` is null [S: MDN; practice E].

### 2.2 Dead zones and response curves
Browsers do **not** apply deadzones; raw rest noise and drift must be handled by the app [S-weak: https://simplified.media/guides/gamepad-api , which recommends a scaled radial deadzone of 0.10-0.25 for sticks].
For steering we only need one axis (left stick X), so use a **scaled axial deadzone** on that axis (radial is for 2D sticks):
```ts
// ours, original
const dz = (x: number, d = 0.12) => Math.abs(x) < d ? 0 : Math.sign(x) * (Math.abs(x) - d) / (1 - d);
const curve = (x: number, e = 1.6) => Math.sign(x) * Math.pow(Math.abs(x), e);   // e>1 = finer centre
```
Reference (MIT, Godot engine, `core/input/input.cpp` as quoted on https://forum.godotengine.org/t/how-is-the-deadzone-from-input-map-supposed-to-work/70685 ; Godot is MIT [S]):
```cpp
// Circular length limiting and deadzone.
float length = vector.length();
if (length <= p_deadzone) { return Vector2(); }
else if (length > 1.0f) { return vector / length; }
else { // Inverse lerp length to map (p_deadzone, 1) to (0, 1).
  return vector * (Math::inverse_lerp(p_deadzone, 1.0f, length) / length); }
```
Godot's own issue tracker notes a purely circular deadzone makes holding "straight" drift sideways: "unlike get_axis(), get_vector() does not have a deadzone along both axis" [S: https://github.com/godotengine/godot-docs/issues/5378]. Hence for a 1-D steering axis use the axial form above. VDrift's equivalent (GPL, idea only): `(val - copysign(dz,val)) * 1/(1-dz)`, and separate gain/exponent stages [S: carcontrolmap.cpp ApplyDeadzone/ApplyGain/ApplyExponent].
Defaults [E]: stick deadzone 0.10-0.15 (expose slider to 0.30 for worn pads), exponent 1.5-2.0, trigger deadzone 0.03-0.05 (triggers rest at 0 but can float), trigger exponent 1.0-1.3.
Pads with `mapping === ""` (non-standard) must go through a user "calibrate/assign axis" screen or be ignored; do not guess indices. A widely repeated claim that Firefox exposes an extra axis for XInput pads and shifts indices is [S-weak: https://progamepadtester.com/gamepad-api-tutorial], not verified; rely on `mapping === "standard"` and test on Firefox before shipping.

### 2.3 Triggers as pedals
RT = throttle, LT = brake, both analog 0..1 via `buttons[7].value` / `buttons[6].value` [S spec]. Note `.pressed` is a thresholded boolean, always read `.value`. Reverse intent from pad: LT held while stopped (see 7.3), or a button (Y/West) toggle. Accessibility: also accept A = throttle, B = brake digital fallback ("if a player is using analog triggers for gas, the game should work properly if remapped to a digital control like A" [S: https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107]).

### 2.4 Rumble in 2026 browsers
- API: `gamepad.vibrationActuator.playEffect("dual-rumble" | "trigger-rumble", {startDelay, duration, weakMagnitude, strongMagnitude, leftTrigger, rightTrigger})`, magnitudes 0..1; a new `playEffect` pre-empts the previous (promise resolves "preempted"); `vibrationActuator.effects` lists supported types [S: https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator/playEffect , https://web.dev/articles/gamepad].
- Support matrix [S: https://controlchecker.com/browser-compatibility, citing MDN browser-compat-data 8.1.6 of 2026-10-15; https://gpadtester.net/guides/...]:
  - Chrome/Edge desktop: dual-rumble yes (Chrome 89+ listed by a secondary source); **trigger-rumble since 126**, on Windows only for pads on Chromium's trigger-rumble list (Xbox One/Series pads in practice).
  - Chrome Android: dual-rumble since 68, trigger-rumble not registered.
  - Firefox: **no `vibrationActuator`** (no rumble at all).
  - Safari/WebKit: dual-rumble for pads that support it; trigger-rumble behind a WebKit setting that is off by default.
- `GamepadHapticActuator` is flagged "Limited availability / not Baseline" on MDN [S].
- Design: feature-detect `effects.includes(...)`; treat haptics as optional garnish with a user toggle ("Include toggle/slider for any haptics" [S: https://gameaccessibilityguidelines.com/full-list]). Our sim already has the signals: map high-frequency road roughness (washboard/pavé) to `weakMagnitude` and kerb strikes / big suspension bump-stop hits to short `strongMagnitude` pulses; map tyre slip proximity to a throttle-trigger rumble when `trigger-rumble` exists. Throttle updates every 50-100 ms with short `duration` (about 60-120 ms), not continuous playEffect calls per frame. [E]
- Haptics requires a user gesture/focus on some engines; stop (`reset()`) on blur/disconnect/switch to Auto. [E]

## 3. Racing wheels

- A wheel (Logitech G29/G923, Thrustmaster T150, Fanatec) shows up in the Gamepad API as a **non-standard** pad (`mapping === ""`, vendor-specific axis order, pedals possibly combined on one axis on older Logitech firmware) [S: Chad Austin's spec critique https://chadaustin.me/2014/10/the-gamepad-api notes the spec forces "4 axes, up to 17 buttons" and cannot expose wheel-specific structure; S: https://jamesiv.es/blog/driving-a-website-with-a-game-controller says unrecognised pads report `mapping ""` and buttons "can be anywhere"]. There is no standard wheel mapping in the W3C spec [S].
- Practical stance: **support wheels only through a generic "assign axis" learner** (user turns wheel / presses each pedal; record which axis index moved most; store axis min/max/centre, optional invert). No hard-coded per-model tables. [E]
- **WebHID** (Chrome/Edge only, needs `navigator.hid.requestDevice` user prompt) can read the raw reports and send FFB output reports; precedent: reverse-engineering the Stadia controller to reach buttons the Gamepad API hides [S: https://developer.chrome.com/blog/talking-to-the-stadia-controller-with-webhid]. Force feedback over WebHID would require per-vendor reverse-engineered report formats and is a large, untestable-without-hardware effort. **Skip for M2**; leave the device-adapter seam open.
- Wheel UX points [E]: steering input is absolute angle -> map directly with (lock-to-lock angle)/(car's steering ratio), no keyboard-style smoothing, no speed-sensitive reduction (VDrift: "should be turned off for wheel users", cf. Steam forum https://steamcommunity.com/app/211500/discussions/ [S-weak]); pedals analog with calibration.

## 4. Touch (phones / tablets)

### 4.1 Libraries
- **nipplejs**: https://github.com/yoannmoinet/nipplejs , licence **MIT** (SPDX MIT, (c) 2025 Yoann Moinet) [S: raw LICENSE + GitHub API], approx 1,955 stars, 197 forks, TypeScript, dependency-free, last push 2026-05-26 [S: api.github.com]. Gives a virtual joystick with `dir`/`force`/`angle` events and static/semi/dynamic modes. For driving we only need 1 axis (steer) so a joystick is overkill and a steering **slider** is better. Adopt only if we want a left-thumb stick; otherwise write ~60 lines of Pointer Events ourselves (no dependency, full control over multi-touch capture). [E]
- Do not use libraries that scrape `touchstart` with `preventDefault` globally; use Pointer Events with `setPointerCapture` and `touch-action: none` on the control surfaces. [E]

### 4.2 Scheme comparison
| Scheme | Pros | Cons | Source |
|---|---|---|---|
| Analog steering track/slider (left thumb) + GAS/BRAKE pads (right thumb) | Part-lock follows thumb, accurate, no permission prompts | Needs landscape, thumbs occlude screen | Mars Rally Championship uses exactly this: GAS, BRAKE, HANDBRAKE, analog steering track, landscape only [S-weak: marsrallychampionship.com blog] |
| Left/right buttons | Trivial | Only full-left/straight/full-right (PolyTrack, Moto X3M) | [S-weak: same blog] |
| Tilt (DeviceOrientation) | Wheel feel | Needs iOS permission prompt, "about 0.1 s" perceived lag, less usable angle than a touch track, makes the screen tilt | [S-weak: YouTube review of Assoluto Racing, https://www.youtube.com/watch?v=4mvpwiGi-DU]; iOS `DeviceOrientationEvent.requestPermission()` [E] |
| Swipe pedals (vertical drag = pedal level) | Analog pedals on glass | Needs a visible track | Touch Racer app: swipe on right half for gas, left half for brake [S-weak: https://touchracer.com] |

Recommendation for touch: landscape, **left = horizontal steering slider with spring-back**, **right = two vertically-stacked pads (GAS above BRAKE/REVERSE)** or a vertical throttle track; apply the same speed-sensitive lock as keyboard; optional tilt as a toggle in settings, off by default. Pad size >= 44-48 CSS px and well spaced ("Ensure virtual controls are large and well spaced" [S: gameaccessibilityguidelines.com/full-list]). Provide a "swap sides" option (PolyTrack ships this [S-weak]). Haptic `navigator.vibrate` works on Android Chrome only (not iOS Safari) [E]; do not rely on it.
Cloudflare angle: none needed here; all local.

## 5. Mouse and pointer lock
- `element.requestPointerLock({ unadjustedMovement: true })` needs transient user activation (a click); Esc always exits; calling again immediately after a user-initiated exit fails; `unadjustedMovement` is Chrome/Edge, others fall back to OS-adjusted deltas; handle `NotSupportedError` by retrying without options [S: https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock , https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API].
- Driving use: horizontal `movementX` integrated into a virtual wheel angle with a recentring spring (angle += k*dx; angle *= exp(-dt/tau) when idle). It is a poor primary scheme (no pedals, Esc conflicts with our UI, trapped cursor ruins the live-demo flow where the presenter needs the cursor). **Do not ship pointer-lock steering in M2.** Keep pointer lock for the orbit/free-camera only if wanted. Plain `pointermove` mouse steering without lock (screen-centre offset = steer) is a cheap optional accessibility alternative. [E]

## 6. Accessibility
- **Remapping**: "one of the best value accessibility features"; in-game remap lets prompts reflect the current mapping [S: https://gameaccessibilityguidelines.com/allow-controls-to-be-remapped-reconfigured]. Remap **actions**, not keys; store bindings by `KeyboardEvent.code` / gamepad button index in localStorage (wrapped in try/catch) and ship the binding as JSON so it can be exported. [E]
- **Duration/fatigue**: holding RT for a whole lap is itself a barrier even when remapped [S: Xbox Accessibility Guideline 107 https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107]. Provide a **throttle mode** option: "Hold" (default), "Toggle cruise" (tap to set/unset a target speed, brake or tap to cancel), and use the existing Auto system as a natural "assist" (user steers, system sets speed; or reverse). One-handed play: all of steer/throttle/brake/reverse reachable on arrow keys + one modifier cluster (e.g. Left/Right = steer, Up = throttle, Down = brake/reverse, Space = handbrake, all remappable), plus a "steering assist" slider. [E]
- **Sensitivity/assist sliders** ("Include an option to adjust the sensitivity of controls" [S: GAG full list]): steering rate, speed-sensitivity amount, deadzone, haptics intensity, plus self-steer-assist (counter-steer helper, stability assist). Be honest in UI: assists are labelled as assists; the physics readouts remain the model's.
- **Reduced motion**: respect `prefers-reduced-motion` (CSS media query / `matchMedia`) to disable camera shake, FOV-by-speed widening, screen-space motion blur, and swap smooth camera lag for a shorter filter; also offer an in-app toggle. Make Auto<->Manual transitions a short fade/instant rather than animated sweep. [E]
- **Pause/focus**: auto-pause (or hand back to Auto) on tab blur; also helpful for photosensitivity/safety.
- Do not rely on colour alone for "you are in control" state; use text + icon.

## 7. "Take control" UX: Auto <-> Manual

### 7.1 Evidence from adjacent products
- **Automotive human-factors**: a handoff must transfer state as well as control, with lead time; the "cliff-edge handoff" (system drops out with no warning/state) is the anti-pattern [S: https://www.aiuxdesign.guide/patterns/graceful-handoff]. Re-engagement should be progressive, since the driver "is not in driving mode" after an automated stretch [S: https://medium.com/@usiskin/the-handoff-was-never-designed-0e605644504c, opinion]. Level-2 systems (Tesla-style) accept driver override by steering torque / pedal input, and require hands on wheel with escalating warnings [S: ETSC https://etsc.eu/risks-of-hands-off-driving-...; S-weak: https://www.theturnsignalblog.com/...]. Our product is a demo, not a safety system, but the same principles apply: no jolt, no lost state, no ambiguity about who is driving.
- **Forza Horizon 6** (2026): Photo Mode entered with D-pad up / `P` on PC, quick-shot then exit and "continue your driving"; **auto-drive via the satnav** that "will take over and get you safely to your destination, albeit significantly slower than you'd get there yourself", plus a cinematic mode where UI disappears [S: https://www.windowscentral.com/gaming/forza/four-new-features-i-found-in-the-forza-horizon-6-preview-... ; https://www.youtube.com/watch?v=BsCxaUBI-H8]. Pattern: the auto mode is a *chosen* mode with the player able to take back any time.
- Arcade attract modes: demo plays itself, **any input** wakes into play (this is general industry convention; no single source retrieved) [E].

### 7.2 Proposed behaviour (Suspension Lab)
- States: `AUTO` (default, today's behaviour), `ARMING` (manual input detected, short), `MANUAL`, `RESUMING` (optional, handing back to Auto). 
- **Take over by intent, with a gate against accidental takeover**: any steer/throttle/brake input *above a threshold held for >= 150-250 ms* or an explicit key (e.g. `Enter`, a "Take control" button, gamepad `A`/`Start`) switches to MANUAL. A single stray key or mouse jiggle must not. Pointer movement alone never takes over. [E]
- **Continuity**: `stateAt(t)` gives position, speed, yaw, 7-DOF state; seed the manual integrator with exactly that vehicle state at the switch tick (no teleport, no velocity reset). Start with the pedal/steer axes **initialised to the Auto controller's current commanded steer/throttle** (bumpless transfer), then ramp them toward the user's input over about 0.3-0.5 s, so there is no step. [E]
- **Show who is driving**: persistent, small, unambiguous HUD chip "AUTO" / "MANUAL" with one-line hint ("Press any driving key to take over" / "Press Esc / R to return to Auto"). Changing mode plays a very short non-animated cue (chip flips + a soft tick). [E]
- **Hand back**: explicit key/button ("Resume Auto") or auto-resume offer after N s idle (idle = no input and speed decaying). Auto must **re-join the reference path**: if the car is off-path, either (a) blend to the lap's `stateAt(t')` at the nearest path point with a smooth merge over about 1-2 s, or (b) run a path-following controller back onto the line, and show "Rejoining..." in the chip. Never snap. (This belongs to the vehicle/controller research files; flag the dependency.) [E]
- **Safety nets that suit a live event**: a one-key "Reset to Auto at nearest path point" (R); idle timeout returning to Auto so an abandoned booth is not stuck on a parked car; per-session inactivity reset. [E]
- Honesty: label manual-drive handling as "approximate model", keep Auto telemetry numbers distinct from derived manual ones (project rule).

## 8. Input abstraction layer

### 8.1 Shape
```ts
// sim-core boundary (pure TS, no DOM): produced per sim tick by the input layer
export interface DriveInput {
  steer: number;        // -1..1, +1 = right, already deadzoned/smoothed/speed-limited? NO: see below
  throttle: number;     // 0..1
  brake: number;        // 0..1
  handbrake: number;    // 0..1
  reverseIntent: boolean; // "I want to go backwards": see 8.3
  source: 'keyboard' | 'gamepad' | 'touch' | 'wheel' | 'auto';
  timestamp: number;
}
```
Split the pipeline into three layers so each is swappable and testable:
1. **Device adapters** (DOM side, `input/devices/*.ts`): keyboard, gamepad, touch, wheel(learned axes). Each emits a *raw intent* `{steerRaw, throttleRaw, brakeRaw, handbrakeRaw, reverseBtn}` and exposes `connected`, `label`, `activeAt` (last activity time). No smoothing here except deadzone/calibration.
2. **Conditioning** (pure, in sim-core or a shared module, unit-tested, deterministic): per-device profile `{rise, fall, snap, deadzone, exponent, speedSens}` -> `approachAxis` (digital sources only), response curves, speed-sensitive lock `steerLimit(speed, vehicleProfile)`, optional steer-assist. Takes `dt` and current `speed`; **sim-core owns this** so replays are deterministic and vehicle-specific params (car vs motorcycle) live with the vehicle.
3. **Arbiter**: selects the active device by most-recent significant activity (hysteresis about 1 s), implements the Auto/Manual state machine of 7.2, and outputs one `DriveInput` per tick.

Keep `steer` in the *DriveInput* as a **normalised pre-limit demand** (-1..1) and let the vehicle model map demand -> road-wheel angle / lean (motorcycle steers differently); do not bake wheel angles into the input layer. [E]

### 8.2 Bindings model
`Binding = { action: 'steerLeft'|'steerRight'|'throttle'|'brake'|'handbrake'|'reverse'|'toggleAuto'|'reset'|'camera'; inputs: {device:'key'|'padButton'|'padAxis'|'touch', code: string|number, invert?: boolean}[] }[]`. Defaults: Keyboard W/Up throttle, S/Down brake+reverse, A/Left & D/Right steer, Space handbrake, Shift handbrake alt, R reset, Enter / "T" toggle control; Gamepad RT/LT/left-stick-X/A or X handbrake/Y reverse toggle; Touch as in section 4. JSON-serialisable, versioned. [E]

### 8.3 Reverse intent (the awkward one)
Two-pedal logic used by most arcade-leaning games [E]: if `brake` is pressed while `speed < ~0.5 m/s` (and `throttle` not pressed) for >= ~150 ms, enter reverse and treat brake input as throttle in reverse; pressing `throttle` while in reverse and `speed > -0.5` flips to forward. Above the threshold, "S/LT" is brake, never reverse (prevents accidentally selecting reverse at speed). Show an "R" gear indicator and a reverse-light cue. A dedicated reverse toggle (pad Y, key `X`) overrides. For the motorcycle, reverse is less natural: either disable it ("push back" is not a realistic motorcycle action) or auto-limit to walking pace, to be decided with the vehicle research files.

### 8.4 Test plan (sim-core, vitest) [E]
Pure-function tests for: `approachAxis` (symmetry, snap, no overshoot), deadzone/curve monotonicity and endpoint, `steerLimit` (full lock always reachable), reverse state machine (hysteresis), arbiter source switching; property test that conditioned steer never exceeds [-1,1] and is rate-bounded by `rise`.

## 9. Licence summary
| Item | URL | Licence | Use |
|---|---|---|---|
| nipplejs | https://github.com/yoannmoinet/nipplejs | MIT [S] | May use/copy |
| Godot engine (input deadzone code) | https://github.com/godotengine/godot | MIT [S: widely stated; engine is MIT per https://leadiq.com page and project] | Pattern may be copied; we use our own anyway |
| VDrift (speed sensitivity, ramp) | https://github.com/VDrift/vdrift | GPL-3.0-or-later [S: file header] | **Ideas only, do not copy** |
| Unity Input Manager docs/behaviour | docs.unity3d.com | Proprietary | Concepts only |
| cannon-es raycast_vehicle demo | https://github.com/pmndrs/cannon-es | MIT [E, not re-verified] | Not needed |
| Stack Overflow / forum snippets | various | CC BY-SA (SO) / unspecified | Do not copy verbatim; trivial patterns re-written |
| Mars Rally Championship numbers | marsrallychampionship.com | Not open source | Data points only, cite as [S-weak] |

## Recommendation for Suspension Lab
- Build a three-stage input pipeline: device adapters (DOM) -> conditioning (pure TS in `sim-core`, deterministic, unit-tested) -> arbiter + Auto/Manual state machine; output one `DriveInput {steer, throttle, brake, handbrake, reverseIntent, source}` per sim tick, logged for replay.
- Keyboard: use `KeyboardEvent.code`, a held-key set cleared on blur/visibility change, and asymmetric ramps (steer rise 2.5-5/s, fall 6-8/s, snap on opposite key) [E, shape sourced from VDrift/Unity]; write it ourselves (VDrift is GPL-3.0, ideas only).
- Speed-sensitive steering: reduce lock with speed but keep full lock reachable at |demand|->1 (the `(1 - val^2)` damping idea), per-vehicle parameters (the F1 failure report is the warning); consider a lateral-acceleration-demand formulation as the physical-grounded upgrade.
- Gamepad: require `mapping === "standard"`, read `buttons[7].value`/`[6].value` as throttle/brake, scaled axial deadzone about 0.12 and exponent about 1.6 on stick X, re-read `getGamepads()` every frame, handle connect/disconnect and "press a button to detect".
- Rumble is optional garnish: feature-detect `vibrationActuator.effects`; Firefox has none, trigger-rumble only Chromium >= 126 on Windows with supported Xbox pads; drive weak motor from road roughness, strong motor from bump-stop/kerb hits; provide an off/intensity setting.
- Wheels: generic learn-an-axis support through the Gamepad API only; defer WebHID/FFB (per-vendor, untestable without hardware, Chromium-only).
- Touch: landscape, left analog steering slider with spring-back + right GAS/BRAKE pads via Pointer Events; tilt as an off-by-default option; nipplejs (MIT, about 2k stars, maintained) only if a stick is wanted, otherwise a 60-line custom control.
- Skip pointer-lock steering for M2 (no pedals, Esc conflict, hostile to a presenter needing the cursor); keep `pointermove` offset steering only as an optional accessibility fallback.
- Accessibility baseline: remappable actions stored as JSON by `code`, sensitivity/assist sliders, a toggle-cruise / assist-uses-Auto option to remove sustained-hold fatigue, one-handed default layout, `prefers-reduced-motion` honoured (no shake, no speed-FOV, no motion blur).
- Take-control UX: take over by sustained intentional input (>= about 150-250 ms above threshold) or explicit key/button, never by a stray mouse move; seed manual state from `stateAt(t)` exactly and start axes at the Auto controller's current commands then ramp over about 0.3-0.5 s (bumpless transfer).
- Always show a persistent AUTO/MANUAL chip with a one-line hint; provide R = reset to nearest path point and an idle timeout back to Auto for the live-event booth case.
- Hand-back to Auto must re-join the path smoothly (blend or path-follower), never snap; this couples to the vehicle-dynamics/path research files, flag as an open dependency.
- Reverse: brake-at-standstill (speed < ~0.5 m/s, held ~150 ms) enters reverse, explicit reverse toggle available, never reverse at speed; decide motorcycle reverse policy with the vehicle file.
- Risks: keyboard ghosting on cheap keyboards (offer alt handbrake), browser gamepad quirks (Firefox axis/rumble differences unverified here, test on real hardware), 60 fps frame input vs 240 Hz sim (sample the latest snapshot per tick, log for determinism), and numbers in this file marked [E] are starting values that need hands-on tuning.
