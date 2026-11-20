# 14 - UI/UX design research: premium minimal overlay for Suspension Lab

Verification status legend: [V] verified this session (npm registry / page opened); [K] from general knowledge of the products (live configurators are JS-heavy and were not scrape-verifiable; treat as pattern synthesis, not measurement); [U] unverified.

Verified facts this session: npm licences/versions (Section C table), Ciechanowski archive list (ciechanow.ski/archives: Bicycle Mar 2023, Internal Combustion Engine, Gears, Mechanical Watch, Airfoil, Naval Architecture, Moon, etc.), Porsche configurator write-ups (deep blacks/greys + one red accent; "options condensed to icons and menus on one screen so the car stays centred" - rondesignlab.com case, Figma community file). No Ciechanowski article on suspension/tyres exists; Bicycle is the closest mechanical one.

---------------------------------------------------------------------
## A. What makes premium configurators / HUDs feel premium

### A1. Shared traits [K]
1. The object is the UI. 90-100% of the viewport is the render; chrome occupies <15% and is hairline-thin. Porsche, Polestar, Lucid, Rivian, Aston Martin all park the car dead-centre on a near-black or soft-gradient studio, with controls pushed to edges.
2. One accent colour, everything else neutral. Porsche: black/grey + signature red (verified in case study). Polestar: white/black + a single "Polestar orange/gold" for state. Lucid: warm greys. Rivian: dark slate + a single teal/yellow. Accent is reserved for the currently-selected thing and one primary action.
3. Few words, large type for the one thing that matters (car name / selected option), tiny uppercase tracking-wide labels for everything else (10-11 px, +0.08em to +0.14em letter-spacing).
4. Slow, damped motion. Camera and panel transitions 400-700 ms with ease-out-expo-like curves; never bouncy. Content fades+translates 8-12 px. Nothing pops instantly except hover state (120 ms).
5. Material restraint: glass panels are rare (1-2 on screen), 6-14 px backdrop blur, 1 px inner border at ~8-12% white, no drop-shadow glow, radius 10-14 px.
6. Camera is a UI element: pre-authored camera "stations" (front 3/4, side, wheel close-up) with eased fly-to, rather than free-orbit only. Configurators almost all have a bottom row of view presets.
7. Numeric data in tabular monospace, so values do not jitter while changing.

### A2. Per-product notes [K]
- **Porsche configurator**: top thin bar (model + price), left/bottom icon rail for categories, option swatches as small rounded squares with thin selected ring. Dark neutral, red accent. Transitions are quick crossfades, car re-render keeps framing stable (no layout shift). Lesson: segmented/rail navigation with icon + 1 word.
- **Aston Martin**: very large wordmark-style type, wide letter-spaced caps, lots of negative space, pale-grey on black, gold/green only in brand moments. Lesson: typography does the luxury; use generous tracking and low weight (300-400).
- **Polestar**: Scandinavian minimal; light theme option; thin sans (Polestar uses a custom grotesque), sliders replaced by stepped chips, price/range as hero numerals. Lesson: stats as big numerals with tiny unit/label.
- **Lucid**: soft gradients, warm-grey glass, bottom-centre pill control, very slow camera easing. Lesson: bottom-centre pill for the primary mode switch.
- **Rivian**: playful-but-clean, adventure photography; card-based options with state tick. Lesson: selected state = accent outline + check, not a colour fill.
- **Bugatti / McLaren**: black, thin condensed caps, spec readouts framed like instrument clusters (e.g. "0-100 km/h 2.4 s"), fine hairlines and corner brackets. Lesson: instrument-cluster aesthetic for engineering data: hairline rules, tick marks, no filled bars.
- **Gran Turismo 7 / Forza**: telemetry HUD = corner-anchored clusters; tyre-temp/load as four small per-corner squares laid out in car plan view; throttle/brake as thin vertical bars; g-force as a small circle with a dot (g-g). Menus: large cards, strong hover scale (1.03), blur backdrop. Lesson: per-corner 2x2 layout mirrors the car and needs no legend.
- **Apple product pages**: scroll-driven choreography, SF Pro Display light/semibold contrast at large sizes, 980 px text measure, near-zero chrome, annotation callouts with hairline leader lines to hardware parts, spec text appears only when its part is in focus. Lesson: contextual one-line captions tied to the camera station.
- **Ciechanowski (Bicycle, Gears, ICE, Mechanical Watch)**: white page, inline canvases, sliders and drag-to-rotate directly on the object, labels in-world, colour-coded parts (single hue per concept), instant response, every control changes the 3D live. Lesson: direct manipulation + show the force/vector as arrows on the object; no separate chart window. [K - article text not re-read this session]
- **NYT / Pudding 3D explainers**: scroll-triggered camera moves + 1-sentence captions; annotation uses small dot + hairline + 12-13 px text. Lesson: caption lives next to the thing, max ~12 words.

### A3. Layout patterns to adopt
1. **Bottom-centre segmented control** (primary: suspension type). Pill, 3 segments, sliding highlight.
2. **Top-left wordmark + vehicle name** (tiny), **top-right** one icon cluster (view menu / fullscreen / sound optional).
3. **Corner HUD, bottom-left**: telemetry micro-widgets (collapsed to a single g-g + 4 corner gauges).
4. **In-world labels** anchored to parts (CSS2D), appear only in Inspect/X-ray modes.
5. **Insight caption**: single line, bottom-centre above the segmented control, auto-fades after 6 s; contextual to what the sim is doing right now.
6. Floating glass panel is used ONLY for the telemetry card and the insight caption. No sidebars, no modals.

### A4. Motion tokens [K, synthesised from common practice; tune by eye]
| token | value | use |
|---|---|---|
| --t-hover | 120 ms | hover/press feedback |
| --t-ui | 240 ms | segmented thumb slide, toggle |
| --t-panel | 480 ms | panel/caption enter |
| --t-camera | 1100-1600 ms | fly-to between stations |
| ease-out | cubic-bezier(.22,1,.36,1) (easeOutQuint-like) | all enter/slide |
| ease-in-out | cubic-bezier(.65,0,.35,1) | camera, thumb |
| exit | 0.6x of enter duration, ease-in cubic-bezier(.5,0,.75,0) | |
Number readouts: do not animate digits; update at 15-20 Hz (not every frame) with tabular-nums and low-pass smoothing, or they are unreadable.
Reduced motion: replace camera fly with 150 ms crossfade/cut, drop translate, keep opacity.

### A5. Iconography
Hairline 1.25-1.5 px stroke, 20 px grid, round caps; 8-10 icons total. Use inline SVG (own drawn) or **Lucide** (ISC licence) / **Phosphor** (MIT) [K - licence not opened this session; both are widely documented as ISC/MIT]. Prefer text labels over icons for the 3 suspension options and 3 view modes (clarity beats minimalism there).

### A6. Onboarding hints in <5 words
One-shot ghost hints, shown once (localStorage flag try/catch), fade after first interaction or 5 s:
- "Drag to orbit" (with subtle cursor-drag animation hint)
- "Scroll to zoom" (desktop) / "Pinch to zoom" (touch)
- "Press X for x-ray" (desktop only)
- "Pick a suspension"
Never a tutorial overlay or coach marks.

### A7. Presenting comparisons (honest tradeoffs, minimal)
1. **Live swap, not table**: switch suspension in place; the car's behaviour changes on the same track position (same lap, same seed). The user sees the difference.
2. **Delta chips, not a spec sheet**: after a switch, a 4-second readout "Camber in roll: -0.3 deg -> -1.9 deg" (previous value struck/greyed, new value accent).
3. **Ghost trace**: keep the previous option's sparkline as a 25%-opacity line behind the live one in the same widget for ~1 lap (A/B overlay).
4. **Tradeoff as three tiny bars, bipolar, not scores**: Cost/Packaging/Grip rendered as 3 hairline ticks with a dot (no star ratings). Keep claim honest: word each as a tendency ("typically").
5. Do not rank options as good/bad.

---------------------------------------------------------------------
## B. Telemetry widgets

### B1. Which quantities and how (smallest elegant form)
| quantity | widget | notes |
|---|---|---|
| lateral g (and long. g) | **g-g diagram**: 64-80 px circle, 1 g ring + 0.5 g ring, dot, 1.5 s fading trail (canvas) | convention: plot accel felt by occupants or by vehicle consistently; state it. Trail alpha decay 0.9/frame |
| camber (per wheel) | 4 corner **arc gauges**, +/-4 deg span (extend if needed), tick at static value, needle/dot moves | per-corner 2x2 layout mirrors car plan view (FL FR / RL RR) |
| suspension travel | 4 **vertical hairline bars** with bump/droop stops marked, filled from static ride height | |
| body roll | **single horizon-style arc** (roll angle) next to g-g, or number "2.4 deg" | roll in deg, tabular |
| tyre load | 4 small **squares whose fill/opacity = Fz/Fz_static** (GT7 style), or ring thickness | normalise to static load so values are comparable across cars |
| time history | **sparkline** 4-6 s rolling window, 120x28 px, last-value dot, optional ghost line | one metric at a time (switch via small tabs) |
| roll centre height | **in-world**: dot on the front/rear axle cross-section + a line to CoG (Inspect mode) | this is the signature educational visual |
Show at most 6 numbers at once. Everything else is on-demand (hover a corner = 1 tooltip with exact values).

### B2. Colour for data
Single neutral line (text-2) for traces; accent for "current option"; ghost = same hue at 25%. Avoid red/green semantics. Compression vs droop = accent vs neutral. Dots 3 px. Use `dataviz` guidelines: no gridlines except 1 reference line.

### B3. Liftable open-source code
| item | URL | licence [V npm] | note |
|---|---|---|---|
| uPlot | https://github.com/leeoniya/uPlot (npm uplot 1.6.32) | MIT [V] | ~50 KB min, fast canvas time series; overkill for 4 sparklines but good if a full chart view is ever added |
| Smoothie Charts | https://github.com/joewalnes/smoothie (npm smoothie 1.36.1) | MIT [V] | streaming canvas line charts, tiny; usable for sparklines; styling is dated, needs config |
| three CSS2DRenderer | three/examples/jsm/renderers/CSS2DRenderer.js (three 0.187.0) | MIT [V] | CSS2DObject anchors DOM to a 3D object; the right tool for in-world labels |
| drei `<Html>` | https://github.com/pmndrs/drei (npm 10.7.9) | MIT [V] | only if React-Three-Fiber is chosen; otherwise use CSS2DRenderer |
Recommendation: **write own 40-line canvas sparkline + arc gauge** (below) rather than add a charting lib; it is trivial, brand-matched, zero deps. Use uPlot only if a full-screen "lap analysis" view is added later. (My snippets below are original; no licence concern.)

#### Canvas sparkline (ring buffer, HiDPI, ghost line)
```js
export function createSparkline(canvas, {min=-1,max=1,color='#E8E8EA',ghost='rgba(232,232,234,.25)',n=240}={}) {
  const dpr = Math.min(devicePixelRatio||1, 2), ctx = canvas.getContext('2d');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w*dpr; canvas.height = h*dpr; ctx.scale(dpr,dpr);
  const buf = new Float32Array(n).fill(NaN), ghostBuf = new Float32Array(n).fill(NaN);
  let head = 0;
  const y = v => h - 2 - ((v-min)/(max-min))*(h-4);
  const path = (b, stroke) => {
    ctx.beginPath(); let pen=false;
    for (let i=0;i<n;i++){ const v=b[(head+i)%n]; if(v!==v){pen=false;continue;}
      const x=i/(n-1)*w; pen?ctx.lineTo(x,y(v)):ctx.moveTo(x,y(v)); pen=true; }
    ctx.strokeStyle=stroke; ctx.lineWidth=1.25; ctx.stroke();
  };
  return {
    push(v){ ghostBuf[head]=buf[head]; buf[head]=v; head=(head+1)%n; },   // ghost = previous value in slot
    clearGhost(){ ghostBuf.fill(NaN); },
    snapshotGhost(){ ghostBuf.set(buf); },                                  // call on suspension switch
    draw(){ ctx.clearRect(0,0,w,h);
      ctx.strokeStyle='rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(0,y(0)); ctx.lineTo(w,y(0)); ctx.stroke();
      path(ghostBuf, ghost); path(buf, color);
      const last=buf[(head+n-1)%n]; if(last===last){ctx.fillStyle=color;ctx.beginPath();ctx.arc(w-1.5,y(last),2,0,6.283);ctx.fill();} }
  };
}
```
Push at 30 Hz from sim, draw at 30 Hz via the UI ticker (not each sim substep).

#### Arc gauge (camber, +/- range)
```js
export function drawArc(ctx, cx, cy, r, v, range, accent='#7CF0D4') {
  const a0 = Math.PI*0.75, a1 = Math.PI*2.25, t = Math.max(-1, Math.min(1, v/range));
  const mid = (a0+a1)/2, a = mid + t*(a1-a0)/2;
  ctx.lineWidth=2; ctx.lineCap='round';
  ctx.strokeStyle='rgba(255,255,255,.14)'; ctx.beginPath(); ctx.arc(cx,cy,r,a0,a1); ctx.stroke();
  ctx.strokeStyle=accent; ctx.beginPath(); ctx.arc(cx,cy,r,Math.min(mid,a),Math.max(mid,a)); ctx.stroke(); // fill from zero
}
```

### B4. In-world labels (CSS2DRenderer) + leader lines
```js
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
const lr = new CSS2DRenderer(); lr.setSize(innerWidth, innerHeight);
Object.assign(lr.domElement.style,{position:'absolute',inset:0,pointerEvents:'none'});
overlay.appendChild(lr.domElement);
function addLabel(part /*Object3D*/, text, offset=[0.25,0.2,0]) {
  const el = document.createElement('div'); el.className='tag';
  el.innerHTML = `<i class="dot"></i><span class="line"></span><b>${text}</b>`;
  const o = new CSS2DObject(el); o.position.set(...offset); part.add(o); return o;
}
// loop: renderer.render(scene,camera); lr.render(scene,camera);
// CSS: .tag{pointer-events:none;font:500 11px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-1)}
// .line{display:inline-block;width:28px;height:1px;background:var(--hair);vertical-align:middle;margin:0 6px}
```
Notes: set label `layers` or toggle `.visible` per view mode; fade via CSS opacity transition (CSS2DObject visibility toggling `display`, so use own class + opacity); occlusion: CSS2D has none, so only show labels in Inspect/X-ray where the part is exposed, or fade by dot(product) of camera-to-part vs part-normal (a 3-line check). Leader lines drawn by CSS (line sits in the element) are cheap; for a long anchored leader, use a single full-screen SVG/canvas drawn from projected positions (`vec.project(camera)`), max ~6 labels.

---------------------------------------------------------------------
## C. Tech choice and state

### C1. Library sizes/licences [V via npm registry 2026-11-20]
| lib | version | licence |
|---|---|---|
| nanostores | 1.5.5 | MIT |
| mitt | 3.0.1 | MIT |
| @preact/signals-core | 1.14.5 | MIT |
| preact | 11.2.0 | MIT |
| lit | 3.3.3 | BSD-3-Clause |
| solid-js | 2.0.3 | MIT |
| uplot | 1.6.32 | MIT |
| smoothie | 1.36.1 | MIT |
(Sizes not measured this session [U]; from memory mitt ~200 B, nanostores <1 KB core, preact ~4-5 KB gz, lit ~6 KB gz, solid ~7 KB gz; verify with bundlephobia/size-limit before locking.)

### C2. Decision
The overlay is ~6 components, one segmented control, one telemetry canvas group, one caption. Updating at 15-30 Hz from a sim is the real constraint, not component count.

| option | verdict |
|---|---|
| **Vanilla DOM + CSS (+ tiny store)** | **Recommended.** Zero framework cost, trivially swappable modules, direct canvas/DOM writes in a single UI ticker avoid VDOM churn at 30 Hz, no hydration, nothing to fight the Three loop. ~300-500 lines. |
| Lit | Good if components must be reusable/encapsulated (Shadow DOM, custom elements `<sl-segmented>`); adds Shadow DOM styling friction with global tokens (CSS vars pierce fine). Reasonable runner-up if the team wants declarative templates. |
| Preact + signals | Fine, tiny; but you gain little for 6 components and need a build/JSX step. |
| Solid | Excellent fine-grained perf, but adds compiler dependency; overkill. |
| React (+R3F/drei) | Only if the whole 3D scene is R3F. Otherwise the heaviest and VDOM-reconciling a 30 Hz stream is unnecessary. Not recommended. |

### C3. Decoupling pattern (sim <-> UI)
Two channels, because discrete UI state and high-rate telemetry have different needs:
1. **Discrete state: nanostores atoms** (or a 20-line own store) - `$suspension`, `$viewMode`, `$insightsOn`, `$caption`. UI writes, sim modules subscribe. No UI import in sim code; sim imports only the store module.
2. **High-rate telemetry: plain shared mutable object + one UI ticker**, NOT reactive. Sim writes `telemetry.fl.camber = x` each step into a preallocated struct; UI reads it in its own `requestAnimationFrame`/33 ms timer and draws canvases. No allocation, no events per frame.
3. **Events: mitt** for one-offs (`insight:show`, `camera:goto`, `track:event {type:'chicane', t}`); the sim's "event detector" emits, the caption module listens.
```js
// store.js
import { atom } from 'nanostores';
export const $suspension = atom('wishbone');   // 'macpherson'|'wishbone'|'multilink'
export const $view = atom('drive');            // 'drive'|'inspect'|'xray'
// telemetry.js - zero-alloc struct
export const T = { gLat:0, gLong:0, roll:0, pitch:0,
  w:[0,1,2,3].map(()=>({camber:0, travel:0, load:0})) };   // FL FR RL RR
// ui.js - one ticker
setInterval(() => { gg.draw(T); corners.draw(T); spark.push(T.gLat); spark.draw(); }, 33);
```
Module contract: each UI module exports `mount(root, {stores, bus, telemetry}) -> unmount()`.

### C4. Accessibility
- Keyboard: `1/2/3` suspension, `V` cycle view (or `D/I/X`), `Space` pause/resume sim, `R` reset camera, `H` toggle HUD, `?` shortcut sheet (a tooltip, not a modal), `Esc` closes. Segmented control = `role="radiogroup"` with `role="radio"` segments, roving tabindex, Left/Right arrows.
- Visible `:focus-visible` ring (2 px accent, 2 px offset). Never remove outlines.
- Canvas telemetry is decorative: give the HUD `aria-hidden` plus a visually-hidden `aria-live="polite"` region that announces only the insight caption and option changes (not per-frame numbers). Offer "H" to hide HUD.
- `prefers-reduced-motion`: cut camera fly-to (jump or 200 ms fade), disable g-g trail, caption without translate; also expose an in-UI "Reduce motion" via keyboard.
- Contrast: text on glass must be >= 4.5:1 (body) / 3:1 (large, 11 px caps labels use text-1 #E8EAED not text-3). Check the glass over bright specular parts of the 3D scene: glass bg alpha >= .55 with blur 14 px, or add a 1 px dark inner scrim. Do not convey state by colour alone (selected = thumb + weight + aria-checked).
- Touch: targets >= 44 px; segmented control full-width pill on mobile; hide corner HUD detail on < 640 px (only g-g + caption).
- Honour `prefers-color-scheme`? The scene is dark-first; offer no light mode (keeps the cinematic look); still define tokens on :root so a light variant is possible.

---------------------------------------------------------------------
## D. Proposed design system ("Lab")

### D1. Fonts (all OFL-1.1 [V via @fontsource npm]; self-host via Fontsource, no Google CDN request)
- **UI + body: Geist Sans** (`@fontsource/geist-sans`, OFL-1.1, v5.3.0). Alternative: Inter Variable (`@fontsource-variable/inter`, OFL-1.1).
- **Numerics/labels: Geist Mono** (`@fontsource/geist-mono`, OFL-1.1) with `font-variant-numeric: tabular-nums`. Alternates: JetBrains Mono, IBM Plex Mono (both OFL-1.1 [V]).
- **Wordmark only (optional): Michroma** (OFL-1.1 [V]) - wide, techno, use for "SUSPENSION LAB" once at 11 px tracking .3em. Space Grotesk / Sora / Manrope also available OFL-1.1 [V] but not needed; keep to two families + optional wordmark.
- Subset to Latin, weights 400/500/600 only; `font-display: swap`; preload Geist 500 + Mono 400. Expected < 60 KB total woff2 [U].

### D2. Colour tokens (dark neutral + one accent)
```css
:root{
  --bg-0:#07080A;          /* page / behind canvas */
  --bg-1:#0D0F12;          /* solid surface */
  --glass:rgba(16,18,22,.62);        /* panel, with backdrop-filter: blur(14px) saturate(1.2) */
  --hair:rgba(255,255,255,.10);      /* 1px borders / hairlines */
  --hair-strong:rgba(255,255,255,.22);
  --text-1:#EDEEF0;        /* primary (contrast vs bg-0 ~16:1) */
  --text-2:#A3A8B0;        /* secondary (~7.9:1) */
  --text-3:#6B7079;        /* tertiary, non-essential only (~3.9:1; large/decor only) */
  --accent:#7CF0D4;        /* single accent: cool mint-cyan; selected, live value, focus */
  --accent-dim:rgba(124,240,212,.25);
  --warn:#FFB454;          /* only for limit/stop contact (bump stop, grip limit) */
  --ease:cubic-bezier(.22,1,.36,1);
}
```
Rationale: cool mint accent reads as "instrument", distinct from the Aston Martin racing-green/silver world and from Porsche red; works against both dark asphalt and a metallic car body. Alt accent if client prefers warmth: #FF6A3D (verify contrast >= 4.5:1 on --bg-0: it is ~7:1 [U, unmeasured]). Computed contrast ratios above are estimates [U]; run a checker before shipping.

### D3. Type scale (px / line-height / tracking)
| token | size | lh | tracking | font | use |
|---|---|---|---|---|---|
| --fs-display | 28 | 1.1 | -0.01em | Geist 500 | vehicle name (top-left) |
| --fs-title | 18 | 1.25 | 0 | Geist 500 | selected option name |
| --fs-body | 14 | 1.45 | 0 | Geist 400 | captions |
| --fs-label | 11 | 1 | +0.10em UPPER | Geist 500 | segment labels, tags |
| --fs-num | 13 | 1 | 0 | Geist Mono 400 tnum | readouts |
| --fs-num-lg | 22 | 1 | -0.01em | Geist Mono 400 tnum | hero value (roll, g) |
Fluid: clamp() on display only.

### D4. Spacing / shape / depth
Spacing scale 4-8-12-16-24-32-48. Screen margin 24 px (16 on mobile). Radius: 10 (chips), 14 (panels), 999 (pill). Border 1 px var(--hair). Shadow: `0 10px 40px rgba(0,0,0,.45)` only on glass panels. No gradients on UI, no glows. Vignette + subtle film grain live in the 3D post-process, not the UI.

### D5. Component list (fewest controls)
1. **SegmentedControl** (x2: Suspension, View) - the only interactive controls besides camera.
2. **VehicleTag** (top-left): wordmark + vehicle name + one-line subtitle.
3. **TelemetryCard** (bottom-left, collapsible with H): g-g, 2x2 corner gauges, 1 sparkline with metric tabs (Camber | Travel | Load).
4. **InsightCaption** (bottom-centre): 1 line + optional delta chip.
5. **PartTag** (in-world CSS2D): dot + leader + 2-word label.
6. **Hint** (ghost onboarding toast).
7. **IconButton** (x2 max): fullscreen, motorcycle/car toggle (vehicle class).
No menus, no settings page, no modals, no sliders. (Optional later: a "Track speed" 3-step chip.)

Layout (desktop 1440x900):
```
[SUSPENSION LAB · Vantage-class]                          [vehicle ⇄] [⤢]
                      (3D canvas fills screen)
[TelemetryCard]        [Insight caption........]
 g-g | FL FR            [ MacPherson | Wishbone | Multi-link ]   [ Drive | Inspect | X-ray ]
```
On mobile: suspension control bottom full-width; view control becomes a compact icon-less 3-dot swipe row above it; TelemetryCard reduced to g-g + one number.

### D6. Exact microcopy

**Suspension (segment label / 1-line descriptor under selection / delta line template)**
1. `MacPherson strut` - "Compact and light. Camber follows body roll." (typical tradeoff: packaging, cost vs. camber control)
2. `Double wishbone` - "Two arms hold the wheel upright through the corner."
3. `Multi-link` - "Five links, tuned independently. Best compromise, most parts."
Short segment labels (mobile): `Strut` / `Wishbone` / `Multi-link`.
Note: keep wording as tendencies; the descriptor must never state a number that the sim does not actually produce.

**View modes**
1. `Drive` - "Follow the car." (chase camera, HUD on)
2. `Inspect` - "Orbit freely." (free orbit, part tags on)
3. `X-ray` - "See the linkage." (body ghosted to 12% opacity, linkage + roll centre shown)
Keyboard hints in tooltips: `Drive 1`... avoid clashing with suspension keys: suspension = 1/2/3, view = D/I/X.

**Motorcycle class (same pattern)**: `Telescopic fork` / `Twin shock` / `Monoshock` (descriptors: "Simple, stiff, familiar." / "Classic. Rear travel is fixed." / "Linkage makes it progressive.") [wording draft; confirm vs final physics].

**Ghost hints**: "Drag to orbit" · "Scroll to zoom" · "Press X for x-ray" · "Pick a suspension".

### D7. Insight caption format
Format: `[verb-led fact, <= 12 words]` + optional chip `[metric  old -> new]`. Triggered by sim events (rate-limited: max 1 per 8 s, 6 s visible, never during a camera fly-to), text-2 on glass, the key noun in text-1. Always tied to a real measured quantity from the sim.
1. Corner entry (roll>threshold): "Body rolls outward. The outside wheel loads up." `Roll 2.4 deg`
2. Camber (multi-link/wishbone vs strut): "Wishbone geometry adds negative camber as the body leans." `Camber -0.3 -> -1.9 deg`
3. Strut: "Strut loses camber in roll. The tyre rolls onto its edge." `Camber +0.4 deg`
4. Bump: "The wheel rises. Travel left: 38 mm." `Travel 62 / 100 mm`
5. Chicane: "Direction flips. Watch the load shift diagonally." `Load FL 3.1 -> 1.2 kN`
6. Bump steer: "Bump steer: the wheel toes as it moves. Multi-link keeps it near zero." `Toe 0.05 deg`
7. Roll centre (X-ray): "Roll centre sits here. Higher means less roll, more jacking." (arrow to dot)
8. Limit: "Inside wheel unloads. Close to lifting." `Load RL 0.2 kN` (accent --warn)
(Insight numbers are placeholders; generate strictly from live sim values. Thresholds tuned to avoid chatter; hysteresis 20%.)

### D8. Timing summary for implementation
- Segmented thumb: transform translateX 240 ms --ease; label colour 120 ms.
- Caption: enter 480 ms (opacity + 8 px up), hold 6 s, exit 300 ms.
- PartTag: dot scales 0->1 220 ms, leader line scaleX 0->1 320 ms (stagger +80), text fade 200 ms.
- Camera station fly: 1400 ms ease-in-out, FOV tween with it (50 -> 35 deg for close-up gives cinematic compression).
- HUD collapse: 360 ms.

---------------------------------------------------------------------
## Recommendations for Suspension Lab
1. **Stack**: vanilla TypeScript + CSS custom properties; **nanostores** (MIT) for discrete state, **mitt** (MIT) for events, a plain preallocated telemetry struct polled by one 30 Hz UI ticker. No framework. Fall back to Lit (BSD-3) only if reusable custom elements are wanted. Skip React unless the scene is R3F.
2. **Fonts**: Geist Sans + Geist Mono via Fontsource (OFL-1.1, self-hosted, Latin subset, 400/500/600). Michroma optional for the wordmark only.
3. **Palette**: bg #07080A, glass rgba(16,18,22,.62)+blur, text #EDEEF0/#A3A8B0, one accent #7CF0D4, amber #FFB454 reserved for limits.
4. **Controls**: exactly two segmented controls (3 suspension, 3 view) + fullscreen + vehicle-class toggle. Everything else is contextual caption, in-world tag, or keyboard.
5. **Widgets**: own ~60 lines of canvas for sparkline/arc/g-g (snippets above); in-world labels via three's CSS2DRenderer (MIT); consider uPlot (MIT) only for an optional lap-analysis view.
6. **Comparison UX**: live swap on the same lap + 25% ghost trace + delta chip; no spec tables, no scores.
7. **Quality bar**: damped motion tokens in A4, tabular numerals, 15-30 Hz readout smoothing, reduced-motion path, keyboard (1/2/3, D/I/X, Space, H), aria-live only for captions.
8. **Open items / unverified**: bundle sizes, contrast ratios (estimates), Lucide/Phosphor licence page not opened, brand-specific details of luxury configurators are from knowledge not scraped measurement; physics-dependent caption numbers must come from the sim.
