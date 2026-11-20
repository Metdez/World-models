# 21 - Explainer prior art: visual and interaction devices for Suspension Lab

Research only. Verification key: [V] = page opened and read this session; [U] = unverified (from general knowledge or search snippet only). Video explainers (YouTube) could not be watched here, so their devices are [U] and described from general familiarity.

## 1. Prior art findings

### 1.1 Bartosz Ciechanowski (ciechanow.ski) [V: archive page, Bicycle, ICE articles]
Archive lists (verified): Gears (2020-02), Cameras and Lenses, Lights and Shadows (2020), Internal Combustion Engine (2021-04), Naval Architecture (2021-07), Mechanical Watch (2022-05), Bicycle (2023-03), Airfoil, Moon (2024). No tyre article. Bicycle article does NOT cover suspension, but is the best template for statics/forces on a vehicle.

Staging patterns observed:
- Sliders are the main control; many sliders scrub TIME of a pre-computed event (lean demo "controlled by time progress"), so the user is a scrubber, not a driver. Others set a physical parameter (slip angle, pedal force).
- Drag-to-orbit on the very first demo ("drag the view around"), teaching the interaction before anything else. Drag a grey handle on the part to apply a force (rim pull demo): direct manipulation of the cause.
- Colour = semantic role: force arrows red/blue/green/white, arrow length = magnitude, bold coloured prose labels match the arrow colour so text and visual are linked; stress as brightness; air blue turning yellow when mixed with fuel; one-piece crankshaft tinted per section to separate its functions; black dots on gears to make 2:1 ratio countable.
- Cutaways: semi-transparent tyre/rim, hatched cross-section planes, "hide the rest of the engine" to isolate the head, a slider that moves a virtual slice through a beam, corner inset for cross-section.
- Slow motion is announced in text ("all demonstrations run at very slow speeds", ICE) and contact-patch behaviour shown "up close and in slow motion".
- Honest exaggeration labelling: lean demo is "vastly exaggerated... actual rotation is very tiny"; "not to scale" for oil gap; "magical world" (no friction); "this analysis is simplified". Always in prose adjacent to the demo.
- Global pause for animations (accessibility/power).
- Text volume: long-form, a demo every few paragraphs, few equations. For a live-event display this must shrink to a one-line caption per beat.

### 1.2 Engineering suspension-geometry tools
- Jack Foster double-wishbone simulator, jrfoster09.github.io/portfolio/projects/suspension.html [V]: wheel-travel slider drives live readouts (camber, roll-centre height, instant-centre distance); camber-vs-travel curve plot; sliders for arm lengths and chassis mount heights; presets (F1, Road car, Rally, Reset); "?" buttons per parameter. No licence/source stated: inspiration only.
- speed-wiz.com A-arm simulation [V]: front-view schematic; drag chassis to heave and roll; toggleable dotted overlays (red = instant centres, white = roll centre, grey = static tyre/kingpin/chassis ghost); blue chassis outline; live data list (roll angle, camber per side, scrub radius, kingpin angle); zoom because construction lines run far outside the car. Static-position ghost is the key idea.
- Performance Trends Roll Center Calculator (desktop) [search snippet, U]: instant centres, roll centre, wheel rate, scrub radius, camber gain; tables/graphs of roll-centre migration vs dive and roll.
- vsusp.com, Racing Aspirations, SusProg3D, Lotus SHARK, OptimumKinematics: [U] not opened (search did not surface vsusp). Industry-standard conventions known generally: front view with wishbone lines extended to instant centre, line from tyre contact patch through IC to the centreline gives roll centre; table plus plots of camber, toe (bump steer), RC height, track change vs bump/roll; side view for anti-dive/caster. Tools use a ghost of the static pose and colour per link set.
- Caveat language seen in Metalcloak calculator: "Theoretical: roll centre calculations are simplified models" [search snippet]. Good honest-label precedent.

### 1.3 Video explainers [U]
Devices commonly used by Engineering Explained, Learn Engineering, Animagraffs, Donut, Driver61: colour-coded links with others greyed, ghosted/transparent body, exaggerated travel, side-by-side split screen (type A vs type B moving through the same bump), freeze-frame with angle arcs and labels, instant-centre construction lines drawn as animated strokes, cutaway/exploded reveal, contact-patch/pressure overlays. These are linear, so the interactive version should make each of these a toggle or a scrubber.

### 1.4 Games / sims
- BeamNG.drive debug views [V via search]: node/beam skeleton, beams coloured by type, live beam length, stress as blue-to-red flash, force vectors, a wheel-camera that hides body to watch suspension. Lesson: a "skeleton" view of just pivots and links, with stress/force colour, is instantly legible to gamers.
- Assetto Corsa apps [V via search]: Camber Extravaganza (instant + peak camber + short history graph), Live Telemetry (suspension height mm, travel %), Suspension Dev App. Lesson: small HUD numeric + 5-10 s rolling trace is familiar and cheap.
- Gran Turismo 7 tuning screens, Forza telemetry, Automation: [U] not opened. Known pattern: sliders for ride height / camber / spring with a car silhouette and bar gauges.

### 1.5 Existing web/3D suspension demos
- No reusable open-source three.js double-wishbone/MacPherson explainer found in this pass (web search + developer index). Closest: Jack Foster tool (2D, unlicensed), speed-wiz (2D, proprietary), 4x4Builder (theshanergy/4x4builder, three.js + R3F vehicle configurator; licence NOT checked, suspension not modelled) [search snippet, U]. MDPI 2025 paper "Double Wishbone Suspension: A Computational Framework..." (Mathematica Manipulate) useful for equations only [V snippet].
- Sketchfab: CC-BY items found (leaf spring, military suspension, spring animation GLB) but no MacPherson/double-wishbone CC-BY animated model confirmed; CGTrader items are royalty-free not CC-BY. Conclusion: build linkages procedurally from the kinematic solver; do not rely on found models.
- Implication: this is a gap in the market; the differentiator is a 3D, in-context (car on track), switchable architecture.

### 1.6 Science-communication guidance
- Bret Victor, Explorable Explanations (worrydream.com) [search snippet]: active reader, author guides attention to specific phenomena; contrasts with free widgets.
- Nicky Case "4 more design patterns" [V]: Puzzle It Out, Place Your Bets (predict before reveal), Role Play, Sandbox Mode (often at the end). Critique [snippet]: pure sandbox = "figure it out yourself", not an explanation.
- Distill "Communicating with Interactive Articles" [V]: progressive disclosure (overview first, zoom/filter, details on demand), reduce context switching (hover previews, tooltips in situ), direct manipulation, guided vs reader-driven narrative (scrollytelling vs non-linear), segment into bite-sized parts with play/pause/scrub, multiple linked representations.
- Notice -> wonder -> explain loop [general pedagogy, U as a citation]: show a surprising behaviour, let the viewer ask why, then reveal the mechanism.
- Exaggeration policy (synthesised from Ciechanowski practice): acceptable when (a) the true effect is below perception (camber change of 1-3 degrees, roll 1-3 degrees), (b) the amplification is a single global factor, (c) it is labelled on screen persistently ("Motion amplified x2.5"), (d) numeric readouts always show TRUE values, (e) a one-tap "true scale" toggle exists, (f) amplify angles/displacements of bodies about their pivots, never link lengths (to avoid visually breaking kinematic closure).

## 2. Ranked devices to adopt (15)

1. Ghost static pose + live pose (speed-wiz, Ciechanowski transparency). User sees: faint outline of wheel/links/body at rest overlaid on the moving ones. Teaches: how far everything actually moved; camber/track change become visible. Cheap in three.js (second instanced mesh, unlit, 15% alpha).
2. Instant-centre and roll-centre construction lines, animated live (speed-wiz, SusProg-style engineering views). Front-view overlay: wishbone lines extended in dotted red to the IC, line from contact patch through IC, white dot where it crosses the centreline = roll centre, which visibly migrates. Teaches: roll centre is geometry, differs by architecture. Toggle in "Engineer" layer.
3. Colour-coded links with semantic palette (Ciechanowski, video explainers). Upper arm / lower arm / strut / toe link / knuckle / spring-damper each one fixed hue, consistent across all three architectures and the bikes; everything else desaturated grey in x-ray. Teaches: "same job, different layout" by matching colours across types.
4. X-ray / dissolve the body (BeamNG wheel camera, Ciechanowski semi-transparent parts). Body goes to fresnel wireframe shader with suspension hot; camera auto-dollies to wheel arch. Teaches: where the parts sit relative to the car.
5. Camber-vs-travel live trace with moving dot (Foster tool, AC Camber Extravaganza). Small corner plot: curve drawn once for current architecture, dot rides it as the wheel moves; previous architecture's curve left as a faint comparison. Teaches: the camber curve is the signature of a linkage, and shows the tradeoff numerically.
6. Split-screen A/B on the same bump (video explainers). Two viewports or two cars side by side, identical input, e.g. MacPherson vs double wishbone through the same chicane, synchronised cameras. Teaches differences without memory. Use for the type-switch moment as a wipe/slider (drag a divider).
7. Scrub-the-event slider with slow motion (Ciechanowski time-scrub, "run at very slow speeds"). A time bar under the view: pause, 1x, 0.25x, scrub back through the last 10 s of track. Teaches cause and effect; lets attendees catch the moment. Requires a replay buffer of kinematic state.
8. Amplification with honest label (Ciechanowski "vastly exaggerated"). HUD chip "Roll shown x2.5 / true values in readout" with tap to set x1. Teaches honestly; avoids misleading. See policy in 1.6.
9. Force/load arrows on contact patch and spring (Ciechanowski arrows, BeamNG force view). Tyre vertical load arrow scales with load transfer in corners; red/blue left/right; spring-damper compression colour (blue extend, red compress). Teaches weight transfer, why outer wheel works harder.
10. Skeleton / pivot-only view (BeamNG debug). Strip to pivot spheres and link lines, bushes as dots, with live link-length labels staying constant (rigid) vs spring-damper length changing. Teaches "it is just rigid bars and a spring" and the linkage closure.
11. Predict-then-reveal micro-prompt (Nicky Case "Place Your Bets"). Before a bump: "Which tyre keeps better contact?" two buttons, answer shown by contact-patch glow after the bump. One tap, no text entry. Teaches by commitment; optional in guided tour only.
12. Contact-patch glow / grip heat (tyre pressure map idea from video explainers [U]). Patch under each tyre rendered as ellipse whose size/brightness encodes load and camber (inner-edge-brighter when cambered wrong). Teaches why camber control matters.
13. Roll-axis / pitch overlay on the body: translucent plane through the roll axis with a horizon line and angle arc with number (freeze-frame angle arcs from video explainers). Teaches body roll amount in degrees, compares architectures.
14. Detail-on-demand hotspots (Distill progressive disclosure). Small pulsing dots on parts; hover/tap shows a 6-word label plus a single "why" sentence and highlights that part's colour in all other parts' context. Teaches vocabulary only when asked. Max 8 hotspots per view.
15. Tradeoff radar/bars that update on type switch (GT7/Forza-style gauges [U]). Five bars: camber control, packaging/cost, ride comfort, bump steer, roll-centre stability; from real computed metrics, not fixed art. Teaches honest tradeoffs; animate bars on switch.

Cross-cutting rules: layers (Clean / X-ray / Engineer) as progressive disclosure; one idea per screen; captions 12 words max in tour; true numbers always shown; global pause (Ciechanowski); all overlays toggleable; no overlay needs reading to be understood.

## 3. 60-second attract-mode storyboard (unattended, no input, silent-safe)

Rule: every shot reads without sound; captions at most 8 words; loop seamlessly; any touch/mouse movement exits to interactive with a fade; idle 30 s returns to attract.
- 0-8 s: Hero. Car circulating the track, cinematic chase cam, body opaque, title "SUSPENSION LAB". Caption: "Every bump is a geometry problem."
- 8-16 s: Dolly into front-left wheel arch while body dissolves to x-ray; links light in the colour palette (item 3, 4). Caption: "Six bars and a spring."
- 16-26 s: Chicane in slow motion (0.25x) with ghost pose (1) and roll-axis angle arc (13); HUD chip "Roll x2.5, true: 2.1 deg". Caption: "Roll, made visible."
- 26-38 s: Front-view construction lines appear as strokes (2); roll-centre dot migrates; camber trace dot rides the curve (5). Caption: "Geometry decides the grip."
- 38-50 s: Split-screen wipe (6): MacPherson vs double wishbone through the same bump; divider sweeps left-right; camber curves overlaid; tradeoff bars (15) animate. Caption: "Same bump. Different answer."
- 50-56 s: Quick cut to the motorcycle (fork dive under braking, colour-coded) mirrored into the car language. Caption: "Two wheels. Same physics."
- 56-60 s: Pull back to hero shot, prompt "Touch to explore", then loop.

## 4. Guided tour, 6 beats tied to track sections

Each beat: camera auto-moves, one overlay on, one caption, one optional prediction, a "Next / skip / free explore" control; tour can be exited anytime.
1. Start straight (steady speed): "What does suspension do?" Body X-ray, links coloured, spring compresses on a small bump; ghost pose. Teaches: wheel moves, body stays calm. Overlay: items 3, 4, 1.
2. Bump strip / washboard: Spring and damper. Slow motion plus time scrub (7); skeleton view shows constant link lengths vs changing spring (10). Prediction: "Which part changes length?" (11).
3. Long sweeper / corner entry: Body roll and weight transfer. Load arrows (9), roll angle arc (13), contact-patch glow (12). Teaches: outer tyre works harder.
4. Chicane (left-right): Camber and roll centre. Front-view construction lines with IC and migrating roll centre (2), camber trace (5). Amplification chip active (8). Teaches: geometry keeps the tyre flat as the body leans.
5. Brake zone before hairpin: Pitch/dive and bump steer; toe trace appears. Teaches anti-dive and toe change; show fork dive on bike in picture-in-picture.
6. Final straight / switch point: "Same car, three answers." One-click architecture switch with split-screen A/B (6) and tradeoff bars (15); camber curves overlaid. Ends with sandbox mode (Nicky Case: sandbox last) and the Clean/X-ray/Engineer layer switch.

## 5. Recommendations for Suspension Lab
- Build the roll-centre/instant-centre/camber-trace overlays from the real kinematic solver output, not drawn art; no reusable open-source implementation was found, so write them (small 2D canvas for the trace, three.js Line2 for construction lines).
- Treat Ciechanowski as the interaction bible but cut text 10x: one-line captions, deeper text behind hotspots.
- Implement amplification as a single shared module with a mandatory on-screen label and true-value readouts; default x1.5-2.5 for roll/camber only, never for link lengths.
- Modular: each device (ghost, construction lines, trace, load arrows, split-screen, replay scrub, hotspots, tradeoff bars) is a toggleable layer module registered to a layer preset (Clean / X-ray / Engineer); attract mode and tour are just timelines that switch layers and cameras.
- Licences: nothing found is reusable code (Foster and speed-wiz unlicensed; 4x4Builder licence unchecked; Sketchfab/CGTrader models mostly non-CC-BY). Model all suspension procedurally.
- Open items to verify next: vsusp.com, Racing Aspirations, SusProg3D, Lotus SHARK, OptimumKinematics UI; GT7/Forza screens; actual video explainer devices; 4x4Builder licence; Sketchfab CC-BY MacPherson search by filter.

Sources: ciechanow.ski/archives, /bicycle, /internal-combustion-engine; blog.ncase.me/explorable-explanations-4-more-design-patterns; distill.pub/2020/communicating-with-interactive-articles; worrydream.com/ExplorableExplanations; jrfoster09.github.io/portfolio/projects/suspension.html; speed-wiz.com/calculations/suspension/a-arm-simulation.htm; docs.beamng.com debug tools; github.com/neilser/camber-extravaganza; mdpi.com/2227-7080/13/8/332.
