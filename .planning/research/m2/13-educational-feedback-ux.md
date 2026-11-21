# M2 research 13 — Educational feedback UX (making a driver understand vehicle dynamics)

Scope: survey of how racing sims, broadcasts and education surface tyre/suspension physics; extract patterns; recommend <= 6 devices for Suspension Lab's minimal premium aesthetic.
Marking: [S] sourced (link), [E] estimate/opinion. No repo code is lifted here, so no licence applies; every product named below is proprietary, so UI ideas only.
Depth note: this pass was a time-boxed web survey (Tavily). Items not verified are marked UNVERIFIED rather than asserted.

## 1. What existing games actually do

### Forza Motorsport (telemetry pages) [S]
- 7 telemetry panels scrolled with D-pad while driving: General, Tires, Gs, Friction Circle, Suspension, Temps, Damage. Most players never find it (gtmotorsports.org/the-dark-art-of-forza-tuning).
- Friction page: one circle per tyre, a vector line from centre points in the direction of the tyre/road force; the circle is the available grip and visibly GROWS on the loaded outside tyres in a corner and shrinks on the inside ones (youtube.com/watch?v=74IcqCQFzjI). Ring turns red when slip exceeds limit; guidance "keep the line inside the blue circle, peak ~100-120%" (youtube.com/watch?v=t6vRc2nQtAM).
- Suspension page: one bar per corner, full bar = bottomed out, empty = topped out, a centre mark = static ride height. Tuning rule of thumb: bars must not hit max (forzatune.com guide).
- Underlying data is public (Data Out): NormalizedSuspensionTravel 0..1 (0 = max stretch, 1 = max compression), TireCombinedSlip normalised so > 1.0 = loss of grip, SuspensionTravelMeters (support.forza.net Data Out docs). Good precedent for normalising everything to "fraction of limit".
- Lesson: the friction circle with a growing/shrinking radius is the single best-validated tyre-load visual. Its weakness is it is a pause-and-read dashboard page, 4 small glyphs in a corner, designed for tuners not novices.

### Gran Turismo [S partial]
- Driving Line (dotted ideal line) and Braking Indicator are ASSISTS you turn on/off; players report graduating off them (reddit r/GranTurismo7 "Finally turned off racing line": switch off braking zones first, keep apex markers; "you get some brake zone feedback from the gears") (gran-turismo.com GT7 manual, Assistance Settings). Lesson: scaffolded assists that fade are the accepted pattern; line colour (red = brake) teaches speed target in-world without a gauge.
- Licence tests / Driving School: short single-skill challenges with bronze/silver/gold. [E] framing is competition-ish (medals, times); we want the structure (one skill, 30-60 s, instant retry) without the medals.
- Replay: GT's replay and Forza's rewind are standard, but no suspension-aware overlay. UNVERIFIED for GT7 tyre indicator details.

### Assetto Corsa / ACC apps, iRacing, rFactor [S partial]
- Community apps overlay tyre temps/pressures, suspension position, wheel slip, inputs trace (RaceLab, ACC DRIVE, simracingtelemetry.com channel list: suspension position FL/FR/RL/RR, wheel slip, tyre core temp). All designed for racers: dense, always-on, numeric.
- SetupX-style coaching scores 6 categories (braking, accel, line, smoothness, gears, efficiency) with a tip each, plus a post-lap "engineer" voice summary (setupx.es). Lesson: post-lap, one tip per category, spoken like an engineer, is the accepted coaching form. Score 0-100 is racing-game-y; skip the score.
- iRacing / rFactor: [E] same pattern (third-party overlays, telemetry in MoTeC); not verified in this pass.

### BeamNG [S]
- Debug tools exist for modders: aerodynamics debug (drag = red vector, lift/downforce = blue vector, angle of attack), centre of gravity dot (Ctrl+G, red) vs centre of pressure (blue), tyre contact point markers, and Weight Distribution: highlights wheels over 25% load as a background visual, plus kg, N and % per wheel simultaneously (documentation.beamng.com/modding/vehicle/intro_jbeam/debugtools). Slow-motion is explicitly a debug tool.
- Lesson: in-world vectors + a CoG dot are accepted and readable; showing the same quantity three ways at once (colour, N, %) is clutter we should not copy; pick one.

### Live for Speed [S partial]
- F9 tyre display: four small 2D tyre profiles with numbers and three bars each (temp/wear) (en.lfsmanual.net/wiki/Display). I could NOT verify a built-in "famous force-vector view"; LFS exposes OutSim/OutGauge data and third-party tools draw force vectors. Treat as UNVERIFIED; the underlying idea (force arrow at each tyre) is the same as Forza friction lines.

### F1 broadcast graphics [S]
- AWS F1 Insights: derived metrics rather than raw telemetry; braking graphics (braking point, speed at brake, max g); Tyre Performance per corner computed from speed + longitudinal/lateral accel + gyro, "tyre wear energy = energy of contact patch sliding" (aws.amazon.com/sports/f1; dev.to/aws-builders). Lap Comparison vs safety car / generic road car.
- Lesson: broadcast shows ONE derived, named insight at the moment it matters, appears 3-6 s, then leaves. That is the model for contextual coaching.

### Engineering explainer videos (Engineering Explained, Driver61, Chain Bear) [E]
- Not fetched in this pass. Known pattern from viewing: a single animated free-body or friction-circle diagram overlaid on slow-mo footage, one concept per video, a before/after of the same manoeuvre. This is exactly the A/B-replay idea in section 3.

### Museum/science-centre exhibits [E]
- Not fetched. Pattern: a physical manipulable with one variable and an immediate visible consequence; label is a single question ("what happens if..."). Supports "experiments not competition".

## 2. Research on learning in simulators [S]
- Guidance hypothesis: constant concurrent augmented feedback improves performance during practice but the gain is lost on retention tests; learners become dependent (Salmoni/Schmidt; review at link.springer.com/article/10.3758/s13423-012-0333-8). Terminal feedback (after the attempt) works in any skill-learning situation; concurrent feedback helps mainly when intrinsic feedback is absent or hard to interpret (UBC KIN366 wiki; youtube eWxzmCG3mag). Optimal frequency is < 100%.
- Counterpoint: for complex tasks, concurrent visual feedback can reduce cognitive load and help (PMC8681883 systematic review).
- Implication [E]: vehicle dynamics is exactly the case where intrinsic feedback (inertia, grip limit) is invisible in a screen-only sim with no motion cues, so SOME concurrent feedback is justified, but it should be sparse, fade with competence, and be backed by terminal (replay) feedback.

## 3. Is A/B replay ("same input, different suspension") done anywhere?
- Searched: found only position-based ghost cars (Unreal/gamedev tutorials note recording INPUTS is "more tricky and limiting"; gamedev.stackexchange replay design: deterministic engine + same inputs = same outputs). Automotive/AV industry does closed-loop re-simulation (Applied Intuition: replay a logged drive and alter the sim) but that is engineering tooling, not driver education.
- I found no consumer racing game that replays a driver's recorded inputs through a different suspension and shows both cars side by side. [E] Treat as a genuine differentiator, not a proven pattern. Caveat: re-simulation from inputs diverges (different lateral path), so the ghosts separate; that divergence IS the lesson but must be framed ("same hands, different car").
- Our fit is unusually good: `stateAt(t)` is a pure deterministic function, sim-core is deterministic. Record (t, steer, throttle, brake) at fixed step, re-run through suspension B headless in the same 240 Hz loop, render both. Cost: second ride-model instance per ghost; kinematics tables are lookups so cheap [E]. Caveat: manual-mode path is not a fixed path, so state is integrated, not `stateAt`; the replay must integrate ghost B from t0 with the same input stream. Deterministic fixed-step required.

## 4. Pattern catalogue (what to steal, in priority order)
1. Friction-circle glyph per tyre, radius = available grip (scales with load), vector = demanded force, colour only at limit (Forza).
2. In-world force arrows at contact patches, length ~ force/limit (BeamNG aero vectors; Forza lines).
3. Load-transfer shading on wheels or body: tint by normalised load vs static (BeamNG weight distribution uses the same idea; keep one encoding).
4. Normalised 0..1 suspension travel bar per corner with static mark (Forza).
5. Slow-mo auto-replay at an event, with the relevant overlay appearing only in replay (BeamNG slow-mo; F1 graphics appear on moment).
6. One-line contextual coaching, broadcast-style, rate-limited (AWS F1 insights; SetupX tips).
7. Fading assists (GT driving line off when competent).
8. Experiments framed as "try X at Y" with an observable result, not a time.
9. A/B ghost via input replay (novel).

## 5. Recommended feedback devices (<= 6)

1. **Contact-patch friction rings (in-world)**: a thin ring on the road under each tyre; radius scales with available grip (load-dependent), a short line = demanded force; ring warms from neutral to one accent at >= 100%. Teaches: grip is finite, load transfer shifts it, combined braking+cornering borrows from the same budget. Default ON at low opacity, fade after ~N minutes of competent driving [E]. Avoid numbers.
2. **Weight-transfer body tint / dots**: 4 soft dots (or wheel-arch glow) whose size follows normalised vertical load; one CoG marker optional in "lab" view. Teaches: braking loads fronts, roll loads outside, why suspension type changes it. One encoding only (no kg/N/% triples).
3. **Suspension travel ticks**: four slim vertical ticks near each wheel or a single compact diagram in lab view, normalised 0..1 with static mark, bottoming flashes. Teaches: travel, bump-stop, why washboard behaves differently per type. Doubles as the honest-data hook (shows modelled values, labelled "model").
4. **Moment replay with slow-mo**: on a trigger (bump bottoming, grip-limit exceeded, big load transfer) offer a 3-4 s replay at 0.25x with the relevant device enlarged, then returns to driving. Terminal feedback (guidance-hypothesis friendly). One key press, never forced.
5. **A/B ghost ("same hands, other car")**: after any 5-10 s segment, replay recorded inputs through another suspension type side by side or ghosted; show only the divergence (lateral offset, roll, a one-line caption). Teaches the product's core claim that suspension matters. Mark clearly as simulated with the same model.
6. **One-line coach + experiment cards**: single sentence, broadcast-style, max one per ~20 s, e.g. "Front tyres at limit while braking and turning; release a little brake." Plus optional experiment prompts ("lane change at 80 km/h, then swap to double wishbone"). Result shown as a comparison, not a score. Terminal-first: show the sentence after the event unless safety-critical.

## 6. What to avoid
- Always-on telemetry pages, numeric N/kg readouts, 3-way redundant encodings (BeamNG weight view).
- Scores 0-100, medals, leaderboards, lap-time deltas (racing-game systems the brief rules out).
- Permanent concurrent feedback with no fade (guidance hypothesis: dependency, no retention).
- Presenting modelled values as measured: label overlays "model", no decimal precision beyond what the model supports.
- More than 2 overlays visible at once during manual driving [E]; keep the centre of view clean.
- Red/green traffic-light colouring; use one accent and neutral.

## Recommendation for Suspension Lab
- Adopt friction rings + weight-transfer tint as the default in-world layer (devices 1-2); they reuse values the 7-DOF model and friction-limited speed profile already compute.
- Normalise everything to fraction-of-limit (Forza Data Out convention) so bars/rings share one scale.
- Build the replay buffer first (record inputs at fixed step); it unlocks devices 4 and 5 and also helps testing/demo.
- Treat A/B input-replay ghost as the signature feature; I found no prior consumer implementation (not proven absent). Prototype with a 10 s segment before committing UI.
- Require deterministic fixed-step integration for ghosts; test that same inputs + same type reproduce bit-identical state.
- Show suspension travel ticks only in a "Lab" toggle or on replay, to protect the minimal aesthetic.
- Coaching lines: rate-limit, tied to named model events (grip > 1.0, bottoming, load-transfer peak), no scoring.
- Fade assists with competence (rolling window of time spent below limit), mirroring GT assist graduation.
- Frame challenges as experiments with a comparison output ("same lane change, 3 suspensions").
- Skip: per-tyre temperature/wear displays, numeric dashboards, scoring, leaderboards.
- Risk: friction rings need an honest tyre model; if grip limit is approximate, label it and avoid precise percentages.
- Risk: ghost divergence may look like a bug; caption it.
- Risk: concurrent overlays may hurt retention per guidance hypothesis; keep opt-in "Lab" layer and fade defaults.
- Unverified in this pass: LFS force-vector view, GT7 tyre indicators, iRacing/rFactor overlays, engineering-video and museum specifics. Follow up if those matter.
