# 22 — Similar products UX teardown: Auto <-> Manual ("watch" vs "drive")

Method note: Firecrawl was not used; Tavily search/extract only (no WebFetch needed). Primary pages were read for Slow Roads
(community controls guide + changelog), Bruno Simon (case study + live control tables), BeamNG docs, Forza Horizon 6 accessibility/press,
PapaCAD kinematics calculator. NOT verified from primary sources (marked [E]/unverified): Gran Turismo attract mode, Art of Rally,
Tesla/Porsche/Polestar/Rivian/Lucid configurators, museum exhibits, most Awwwards sites. Numbers: [S] sourced, [E] estimate.

## 1. Teardowns

### Slow Roads (slowroads.io) — the closest analogue (auto + manual same car)
- Takeover: autodrive toggled with `F` (touch: an "AUTO" button top-right). "hands control back the moment you touch W, S, A or D";
  a guard fires only on a fresh press so a held F cannot flicker the state. [S] https://slowxroads.com/blog/slow-roads-controls (third-party guide that read the binding table; unofficial)
- Changelog: separate "autosteer" and "autospeed" modes inside autodrive; "smoothed autodrive steering"; "fixed hard braking when enabling speed
  control at high speed" (i.e. engaging auto mid-motion had a bumpy handover bug — design for it); autodrive sound reduced. [S] https://slowroads.io (changelog)
- Onboarding: control list hidden behind hover on a keyboard icon on the splash screen (7 hints); no tutorial. [S] same guide.
- Mode indicator: tiny AUTO icon; boost icon stuck enabled during autodrive was a bug -> HUD must reflect real mode. [S] changelog
- Reset: `R` puts car on nearest road node facing the right way. [S]
- Camera: `C` cycles; speed-relative FoV on chase cam; far chase + `U` (hide UI) = screensaver, "how a good number of people use it". [S]
- Steering authority scaled down with speed (speed-relative steer limiter, now a setting). [S]
- Mobile: on-screen steer pads left, throttle/brake right, CAM/AUTO/UI buttons top-right; removed backdrop blur for perf. [S]
- Premium vs gamey: very premium — near-zero chrome, calm. Lesson: "watch mode" is a first-class use case, not a cheat.

### Bruno Simon folio-2025 (drive-to-explore)
- First 10 s: welcome text in-world ("Please drive around…"), a start button exists only because browsers block audio until click/tap. Original
  2019 case study: only instruction was painted on the ground; car placed so bumping the title teaches that things move. [S] https://medium.com/@bruno_simon/bruno-simon-portfolio-case-study-960402cc259b , https://bruno-simon.com
- Learned the hard way: users didn't discover Shift=jump -> added instructions but "not visible directly in the intro to prevent information flood". [S]
- Controls table lives in a menu, with separate keyboard / touch (one finger = drive, two fingers = camera/zoom, tap car = jump) / gamepad tables;
  Options has "I'm stuck!" and "Reset", `R` respawn, gamepad Select = reset. [S] bruno-simon.com
- Mobile: simple buttons + steering joystick; removed blur, clamped pixel ratio, disabled matrix auto-update; he admits "I said no interface but…". [S]
- Camera: eased follow so you "feel the speed"; scripted tween to top-down when entering a section (camera takes over for readability). [S]
- Repo: https://github.com/brunosimon/folio-2025, ~1.9k stars, MIT [S] (copyable code; Rapier physics, game-loop ordering Time -> Inputs -> Player pre-physics -> Physics ...). No auto mode.
- Gamey (deliberately): achievements, leaderboard, whispers. Skip those; keep in-world affordances and the "I'm stuck" escape.

### Forza Horizon 6 (and Motorsport)
- Auto Drive: via Anna satnav menu (D-pad) -> "Enable Auto Drive"; HUD shows "Enable Auto Drive"/message; left bumper -> cinematic mode where UI disappears. Slower than the player. [S] https://gameaccess.info/forza-horizon-6-motor-accessibility , https://www.windowscentral.com/gaming/forza/four-new-features-i-found-in-the-forza-horizon-6-preview-that-will-change-how-you-play-the-game
- Rewind (Y button): reverse time "a couple of seconds"; repeat to go further; players complain they can't hold-to-scrub or pick a fine amount ("let me hold the button and continue when I stop"). [S] gameaccess page; https://steamcommunity.com/app/2483190/discussions/0/653730014598197366
- Takeaways: separate "auto" from "cinematic" (UI-hide) — two orthogonal toggles; rewind should be scrub-while-held, release = resume. Drivatar/Rewind data-poisoning rule is irrelevant to us.

### Gran Turismo — unverified
No primary source read. [E] Attract mode loops cinematic replays and any button starts the menu; pattern = "any input exits cinematic". Do not cite as fact.

### BeamNG.drive
- AI take-over via radial menu (E opens sidebar -> AI -> mode), AI Control app; modes Random/Chase/Flee/Follow…; applies per vehicle; traffic mode. [S] https://documentation.beamng.com/tutorials/ai
- Node grabber: hold CTRL to show nodes as spheres, drag with LMB, wheel = grab strength, middle-click pin/attach; on-screen label states what the next click will do. [S] https://documentation.beamng.com/tutorials/features_showcase/nodegrabber (last modified 2025-03-29)
- Takeaway: modal "inspect/poke" tool entered by holding a modifier, with a live label of the pending action — good model for a future "grab the suspension" tool. Chrome is gamey/dense (radial menus, apps); do not copy.

### Art of Rally, Tesla/Apple-style configurators, Porsche/Polestar/Rivian/Lucid — unverified
Searches returned no usable primary content. [E] Pattern knowledge only: configurators use scroll/orbit + cinematic transitions, no "drive". Awwwards "Virtual Car Showroom" (Otherlife, HM Mar 2025, Three.js/Next.js) lists "cinematic car transition", "enter car transition", "HDR environment transition" as its key elements [S] https://www.awwwards.com/sites/virtual-car-showroom ; Toyota Crown WebGL microsite begins with a "scroll or swipe" prompt then an "explore" click [S] https://www.groovejones.com/toyota-crown-webgl-interactive-experience. Premium cue = long eased camera moves and HDR environment shifts, not HUD.

### Suspension explainers
- PapaCAD Suspension Kinematics Calculator (2026-10-07): sliders for wheel travel (heave) and roll, front/side/iso views, "Edit nodes" to drag pivots A–F, every curve updates instantly; validated against Autodesk Inventor model; mm coordinates. [S] https://www.papacad.com/suspension-kinematics-calculator
- OptimumKinematics: Design / Motion / Analysis sections, interactive 3D, validated solver [S] https://optimumg.com/product/optimumkinematics (commercial, ideas only).
- Suspension Secrets: static explainer text per concept (camber, bump steer, FVSA instant centre) [S] https://suspensionsecrets.co.uk/suspension-geometry-explained
- Takeaway: engineering users trust live-updating curves + explicit units + "validated against X" statements. Our honesty rule maps to that.
- Science-museum exhibits: no sources found; skip.

## 2. Cross-cutting patterns (what the good ones share)
1. One-key toggle for auto + ANY driving input silently hands back control (Slow Roads). Zero-modal.
2. Controls hidden until asked (hover/menu); in-world cues beat overlays (Bruno).
3. Reset is always one key and orientation-aware (Slow Roads R; Bruno R + "I'm stuck!").
4. UI-hide/cinematic is a separate toggle from auto (Slow Roads U, Forza bumper).
5. Mobile = minimal pads + the same AUTO/CAM/UI buttons; drop blur/post-FX for perf.
6. Premium = calm, eased camera, few elements, units/validation statements. Gamey = leaderboards, achievements, radial menus, score/rewind-as-gameplay.
7. Known pitfall: handover transients (Slow Roads "hard braking when enabling speed control at high speed").

## 3. Recommended Auto <-> Manual interaction spec

State machine: AUTO (default) -> MANUAL on takeover -> AUTO on explicit key or idle return. Optional transient state HANDBACK (blend).

Takeover
- Key: `Space`/`F` toggles; ANY of W/A/S/D/arrows/gamepad axis beyond deadzone/touch on pad also takes over (explicit toggle needed only to return). One click on the canvas also acceptable but must not steal orbit-drag; use a visible "Take the wheel" pill instead of canvas click.
- Continuity: manual starts from `stateAt(t)` exactly (position, speed, yaw, ride state). Controller inputs initialize to what AUTO was commanding (steer angle, throttle) and blend to user input over ~250 ms [E] to avoid a jerk; if the user presses brake, no blend.
- Do not start a lap-time clock on takeover; AUTO progress simply stops being authoritative.

Handback
- `F` again, or idle: no input for ~6 s [E] while speed > 0 shows a 3 s fading "Returning to Auto" cue (cancellable by any input), then resume auto on the nearest path point with a speed/yaw blend over ~1 s [E]. If stopped and idle, wait longer (~15 s) or do not return.
- Handback target: nearest path station s* whose heading is within tolerance; match speed by a limited decel/accel ramp so no hard braking (Slow Roads bug).

Mode indicator
- Small segmented "AUTO | MANUAL" pill, bottom centre or top-right; active segment lit; also the key hint. Never rely on colour alone. Must follow real state (Slow Roads boost-icon bug).

Hints
- First load: Auto runs cinematic. After ~4 s show one line "Press any WASD to take the wheel" near the pill; fade out after takeover or 8 s [E]; never reappear in session (store dismissal in localStorage with try/catch). Full controls in a "?" popover (hover/tap), per Slow Roads/Bruno.
- Do not front-load a controls table (Bruno's "information flood" lesson).

Camera
- AUTO: current cinematic/orbit. On takeover: ease (0.6–0.9 s, ease-in-out) into chase cam with speed-relative FoV; user orbit-drag temporarily offsets and springs back after ~2 s idle. `C` cycles cameras; `U` hides UI (cinematic). On handback ease back to previous auto camera.

Reset / recover
- `R`: place on nearest road point facing travel direction, zero velocity (or keep speed — pick zero), with a quick fade or ghost-flash (200 ms) not a hard cut. Auto-offer "Press R to reset" hint after being stuck/flipped >3 s [E]. Mirrors Slow Roads R and Bruno "I'm stuck!".

Telemetry surfacing
- Default: none beyond speed + mode pill (premium, minimal). Toggle `T`/panel for engineering overlay (per-wheel travel, load, slip) with units and an "approximate model" badge — honest labelling like validated-against statements in PapaCAD/OptimumKinematics. Telemetry must show same values in AUTO and MANUAL.
- Optional later: hold-to-scrub "rewind" (Forza complaint: scrub-while-held), only if replay buffer exists.

Mobile
- Left pad steer (slider/tilt-less), right throttle/brake, top-right AUTO / CAM / UI buttons (Slow Roads layout); touching any pad = takeover; no backdrop blur; clamp pixel ratio (Bruno, Slow Roads).

Premium vs gamey rules: no score, no achievements, no radial menus, no rewind-as-reward; eased camera, calm HUD, small type, units everywhere.

## Recommendation for Suspension Lab
- Adopt Slow Roads' contract: one toggle key + any drive input = instant takeover; explicit key returns; guard against held-key flicker (edge-triggered).
- Add idle return to Auto with a cancellable 3 s cue; blend speed/yaw so there is no hard-brake transient.
- Initialise manual inputs from what Auto was commanding; blend ~250 ms [E].
- AUTO|MANUAL pill bound to real state; never a stale icon.
- Controls hidden behind "?" hover/tap; a single contextual hint line that fades after first takeover (persist dismissal, try/catch).
- Separate UI-hide/cinematic toggle (`U`) from Auto (Slow Roads, Forza).
- Always-available `R` reset, orientation-correct, plus stuck-detection prompt.
- Chase camera with speed-relative FoV, eased transitions both ways; orbit offset springs back.
- Telemetry overlay off by default, same data in both modes, labelled approximate.
- Mobile: Slow Roads layout; drop blur; clamp DPR.
- Steering authority speed-scaled by default (setting) for approachability.
- Skip: leaderboards, achievements, radial menus, Drivatar-style learning, BeamNG-style dense apps. Defer BeamNG-style "grab" tool and hold-to-scrub rewind.
- Risks: handover discontinuity (largest); idle auto-return surprising a user mid-demo (make timeout configurable, disable in event mode); unverified claims about GT/Art of Rally/OEM configurators — do not cite; Slow Roads details come from a third-party guide, spot-check live site before copying exact behaviours.
- Licences: Bruno folio-2025 MIT (copyable); Slow Roads, BeamNG, OptimumKinematics, PapaCAD, Forza = ideas only.
