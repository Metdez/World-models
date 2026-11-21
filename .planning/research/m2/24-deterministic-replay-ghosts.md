# M2 research 24: deterministic replays and ghost cars across browsers/devices

Date 2026-11-21. Tags: [S] = read this session (link). [E] = estimate / recollection, not verified.
Tooling note: Firecrawl and the GitHub API were not used; everything is from Tavily search/extract and WebFetch of raw files. Not read: JavaScriptCore source (I could not fetch WebKit's `MathObject.cpp`), the Trackmania/Quake binary specs in depth, Hoffmann's Stanley paper itself (formula taken from secondary pages), MacAdam 1981 (abstract level only).

## (a) Cross-engine floating-point determinism in JS (2026)

### What is exact and what is not
- ECMAScript explicitly does NOT specify results of `acos, acosh, asin, asinh, atan, atanh, atan2, cbrt, cos, cosh, exp, expm1, hypot, log, log1p, log2, log10, pow, random, sin, sinh, sqrt?, tan, tanh` beyond boundary cases (quote from ECMA-262 10th ed. s20.2.2, reproduced at https://macwright.com/2020/02/14/math-keeps-changing [S]). The spec calls them "implementation-approximated".
- Safe, bit-identical across engines (basic IEEE-754 binary64 semantics, round-to-nearest-even, no x87 extended precision, no FMA contraction in JS) [E, but this is the language's arithmetic definition]: `+ - * /`, `%`, `Math.sqrt` (all engines lower it to the hardware correctly-rounded sqrt [E]; the Wasm analogue is confirmed correctly rounded by IEEE in https://phasm.app/blog/deterministic-cross-platform-math-wasm [S]), `Math.fround`, `abs, floor, ceil, trunc, round, min, max, sign, imul, clz32`, `Math.f16round` (if used), and `Float64Array`/`DataView` bit access. `** `with small integer exponents is NOT safe (it routes to pow).
- Avoid: `sin cos tan atan atan2 exp log pow hypot cbrt sinh/cosh/tanh asin acos`. `Math.hypot` visibly differs: Chrome `56.1124478168614` vs Firefox `56.11244781686139` for (-24.42, -50.519999999999925) https://stackoverflow.com/questions/62931950 [S, 2020 data; Firefox returned sqrt(x*x+y*y), V8 uses a scaled algorithm]. Replace with `Math.sqrt(x*x+y*y)`.

### Per-engine facts (evidence)
| Engine | What it does | Evidence |
|---|---|---|
| V8 (Chrome, Node, Edge) | `src/base/ieee754.cc` was "adapted from fdlibm ... modified significantly by Google" (2016). On current `main` the `sin/cos/exp/atan2/pow` wrappers now call `LIBC_NAMESPACE::shared::<fn>` i.e. LLVM-libc's shared math (the `legacy::pow` also forwards there). So V8's results changed or are changing between Chrome versions. | raw file https://raw.githubusercontent.com/v8/v8/main/src/base/ieee754.cc fetched 2026-11-21 [S]. I did not find which Chrome milestone first ships it [E: unknown]. |
| SpiderMonkey (Firefox) | fdlibm for most functions; pref `javascript.options.use_fdlibm_for_sin_cos_tan` added for cross-platform consistency (a Mozilla fingerprinting concern). BUT `pow` uses libc `std::pow` (not fdlibm) because fdlibm pow was slower (bug 933257); std::pow is claimed to be within 1 ULP, so `Math.pow` varies with OS/libc. | https://bugzilla.mozilla.org/show_bug.cgi?id=1775254 comments 22-23 [S] |
| JavaScriptCore (Safari, all iOS browsers) | uses the platform C math library ("cmath") for most functions, as of the 2020 writeup | macwright [S, dated 2020; I could not re-verify 2026 source, treat as [E] for current] |

LLVM-libc point: its double-precision transcendentals aim at correct rounding, but a 2024 accuracy survey found "all LLVM functions except cos, sin, tan seem to be correctly rounded" https://inria.hal.science/hal-03141101v8/document [S, snippet]. So even a V8 that adopts LLVM-libc is not guaranteed bit-identical to JSC's libm for sin/cos. Conclusion: in 2026 there is NO guarantee, and the engines are changing underneath you. Do not gate replay validity on `Math.sin`.

Measured disagreement magnitudes: ~1-3 ULP between engines on sin/cos is claimed with an example `sin(1.7)` giving ...BE10 (V8, JSC) vs ...BE0F (SpiderMonkey) https://phasm.app/blog/deterministic-cross-platform-math-wasm [S, blog; specific hex values unverified, treat as illustrative]. Native glibc vs WASM libm differed in the last bit of `sin` in 3.104% of 44.65 M evaluations https://anankelabs.io/blog/one-sine-wave-four-runtimes-portable-topology-determinism [S, other libs but same phenomenon]. Node regressions across versions: `Math.tanh(0.1)` Node 4 vs 6, `Math.pow(1/3,3)` Node 10 vs 12 differ in the last digits (macwright [S]).

Why it matters for us: a 1 ULP error in a yaw/tyre `sin/atan` feeds an unstable-ish loop (lateral position is an integral of heading); two devices will drift apart after seconds to minutes [E]. Ghost drift becomes visible long before it is numerically large, because track-boundary / kerb / bump events are discontinuous.

### Deterministic alternatives, ranked for this project
1. DEFAULT: design the stepped core to use only exact ops (+,-,*,/,sqrt,abs,min,max,floor). Rotation by integration of a unit 2-vector or quaternion with `sqrt` renormalisation instead of `sin/cos` per step; speed from `sqrt`; tyre saturation via a rational function (e.g. `x/sqrt(1+x*x)` or `x/(1+|x|)`) instead of `atan/tanh`; `Math.pow(x, n)` with integer n replaced by explicit multiplies. Cost: zero (these are faster than libm). Risk: need to retune tyre curves; changes physics, so do it once, before the replay format ships.
2. Where a true transcendental is unavoidable (road clothoid sin/cos, Pacejka atan): own pure-arithmetic polynomial implementation (fdlibm kernels). Evaluates with only `* + -`, so it is bit-identical everywhere. Cost [E]: a polynomial sin/cos on [-pi/4, pi/4] is ~13 mul/add, i.e. comparable to native; full argument reduction adds a branch. 240 Hz x a few calls = negligible.
3. Lookup table + linear interpolation (exact ops only, tables generated at build time and checked in as literals or Float64Array in a file): fine for road geometry and tyre curves; cost is accuracy (needs ~4096 entries for 1e-7 rel error on sin [E]); table must be generated on ONE machine and shipped as data (do not generate tables at runtime with `Math.sin`!).
4. Fixed-point / integer (Q16.16 etc.): bit-exact by construction and trivially hashable, but a rewrite of a 7-DOF float model with stiff suspension is large and loses range; not recommended.
5. WASM build of a libm (Rust `libm`): deterministic for WASM arithmetic (NaN payload aside), adds a build step and a JS<->WASM call per function; only worth it if you already ship WASM. Rapier/Bevy/Avian take this route in Rust (`enhanced-determinism` routes sin/cos to nalgebra/libm) https://rapier.rs/docs/user_guides/rust/determinism [S].

### Libraries and licences
| Item | URL | Licence | Notes |
|---|---|---|---|
| stdlib-js `@stdlib/math/base/special/{sin,cos,tan,atan2,exp,pow,...}` | https://github.com/stdlib-js/stdlib (also per-function npm packages, e.g. `@stdlib/math-base-special-sin`) | File header `@license Apache-2.0` AND repo LICENSE contains both Apache-2.0 and Boost-1.0 texts [S, raw files]; embedded fdlibm portions carry Sun's permissive notice ("Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved") [S] | Pure JS, "uses arithmetic alone" (macwright). sin = kernelSin/kernelCos + `rempio2` (Payne-Hanek-like reduction using high-word bit tricks). Copyable with notice. ~5M weekly downloads for the modular packages (pkgpulse, secondary [S]). Last activity not checked [E: active]. |
| fdlibm (netlib) | http://www.netlib.org/fdlibm | Sun permissive notice (BSD-like) | Original C; V8 and SpiderMonkey derive from it; stdlib's JS is the practical copy source. |
| Rust `libm` (musl port) | https://github.com/rust-lang/libm (638 stars, 816 commits, archived 2025-04-28, merged into `compiler-builtins`) | MIT (README); contributions MIT OR Apache-2.0 [S] | Only relevant if shipping WASM. |
| mathjs | https://mathjs.org | Apache-2.0 [E] | Delegates `sin` to `Math.sin` (StackOverflow 79944374 [S snippet]) - NOT deterministic; do not use. |

Quotable code (Apache-2.0 + Sun notice, stdlib `kernel-sin/lib/main.js`) [S, verified by fetch]:
```js
var S1 = -1.66666666666666324348e-01; // 0xBFC55555, 0x55555549
var S2 = 8.33333333332248946124e-03;  // 0x3F811111, 0x1110F8A6
var S3 = -1.98412698298579493134e-04; // 0xBF2A01A0, 0x19C161D5
var S4 = 2.75573137070700676789e-06;  // 0x3EC71DE3, 0x57B1FE7D
var S5 = -2.50507602534068634195e-08; // 0xBE5AE5E6, 0x8A2B9CEB
var S6 = 1.58969099521155010221e-10;  // 0x3DE5D93A, 0x5ACFD57C
function kernelSin( x, y ) { // x in [-pi/4,pi/4], y = tail of reduced arg (0 if none)
  var z = x * x, w = z * z;
  var r = S2 + (z * (S3 + (z*S4))) + (z * w * (S5 + (z*S6)));
  var v = z * x;
  if ( y === 0.0 ) return x + (v * (S1 + (z*r)));
  return x - (((z*((0.5*y) - (v*r))) - y) - (v*S1));
}
```
and `kernelCos`: `z=x*x; w=z*z; r=z*polyval13(z); r+=w*w*polyval46(z); hz=0.5*z; w=1.0-hz; return w+(((1.0-w)-hz)+((z*r)-(x*y)));` (C1..C6 values live in `polyval_c13/c46.js`, not fetched; fdlibm values from memory C1=4.16666666666666019037e-02, C2=-1.38888888888741095749e-03, C3=2.48015872894767294178e-05, C4=-2.75573143513906633035e-07, C5=2.08757232129817482790e-09, C6=-1.13596475577881948265e-11 [E - verify against the stdlib file before copying]). Top-level `sin(x)` dispatch: `ix = highword(x) & 0x7fffffff; if ix <= 0x3fe921fb return kernelSin(x,0); if ix >= 0x7ff00000 return NaN; n = rempio2(x,Y); switch(n&3){0:kSin(Y0,Y1);1:kCos;2:-kSin;3:-kCos}`.
Shortcut for a vehicle sim: if all angles are kept wrapped to [-pi, pi], a 3-step Cody-Waite reduction (x - k*pi/2 with pi/2 split into hi/mid/lo parts where k*hi is exact) suffices; skip `rempio2`. Note: Cody-Waite exactness depends on `hi` having trailing zero bits, which is pure arithmetic and therefore portable.
Critical JS gotcha: engines may NOT contract `a*b+c` into FMA (spec) [E], so polynomial code is stable; do NOT use `Math.fma`-like WASM `f64.fma` paths. Also avoid `Math.pow(x, 2)`.

Test harness: a CI test that runs the sim for N laps on Node (V8), plus Playwright Firefox and WebKit, and compares the 64-bit hash of the full state every 1 s. This is the only trustworthy proof; budget it.

## (b) Replay formats in games: what to copy

| Game | What is stored | Notes / evidence |
|---|---|---|
| Doom (.LMP) | Per-tic player input only, small header; "playback is a live game" | Needs the same game version: "a demo recorded using Doom II v1.9 cannot be replayed using v1.666"; some missing inputs cause desync https://classicdoom.com/lmpintro.htm [S] |
| Quake (.DEM) | Full state/message stream, not just inputs: "the full movement (of all objects) is stored", robust to editing; inputs-only (Doom) breaks if a single action is changed | https://www.gamers.org/dEngine/quake/Qdem/dem-1.0.2-3.html [S] |
| Trackmania | Inputs stored as events in the replay (`CInputEventsStore`), re-simulated on a fully deterministic physics engine; in-game validation uses them. TM2020 ghosts/replays hide raw inputs (encrypted), ghost samples show gas/brake/steer with steer 0-255 range and 20-50 Hz | https://donadigo.com/tmx1 [S]; https://github.com/BigBang1112/gbx-net/issues/25 [S]. Internal steer range -65536..65536. |
| Factorio | Deterministic lockstep; clients send inputs; a CRC "heuristic" test compares server and local CRC at a tick; on mismatch state goes DesyncedWaitingForMap and the client re-downloads the whole map; a desync report diffs the state | https://factorio.com/blog/post/fff-188 [S]; log excerpt in https://github.com/ptitSeb/box64/issues/211 [S] |
| GGPO / rollback | Save/load state per frame; exchange state checksums every N frames; stop with a message on mismatch; hashing input buffers alongside state tells you whether input delivery or simulation diverged | https://bugnet.io/blog/how-to-debug-desync-in-deterministic-lockstep-games [S]; cps2recomp issue [S, weak] |
| Casual ghosts (Unity forum pattern) | Position/rotation samples at 10-60 Hz, interpolated; 2 min at 60 Hz ~500 KB; no determinism needed | https://discussions.unity.com/t/record-ghost-in-car-racing-game/38322 [S] |

Lessons for Suspension Lab:
1. Quantise at the source and let the sim consume the quantised value. Record `steer` as int16 (or int10), `throttle` and `brake` as uint8 (0-255), at the control rate (60 Hz); feed exactly these integers (converted by a table or `/255`) into `step()` in live play too. Otherwise the live run and the replay differ by the quantisation and the "same inputs" claim is false from tick 0. Trackmania's 0-255 ghost steer vs +-65536 internal values shows the cost of losing this [S].
2. Encoding: per channel, delta vs previous sample, zig-zag, LEB128 varint; or bitmap-flag "unchanged" runs. Then `deflate-raw`. My synthetic test (60 s, smoothed steer with noise, slewed pedals, Node 22 zlib level 9) [E - synthetic driver, real human gamepad noise will be worse, keyboard input better]: raw 3 B x 60 Hz = 10.8 KB/min; delta-varint alone = 10.8 KB (no gain for 8-bit channels; varint only wins with wide range); gzip(delta-varint) = 1.25 KB/min with 8-bit steer, 2.83 KB/min with 10-bit steer; explicit zero-run RLE was worse than plain deflate (1.42 / 3.08 KB/min). So "delta + deflate" is the whole recipe; skip hand RLE. Halving to 30 Hz roughly halves it again [E].
3. Keyframes: every K = 5 s store (tick, CRC32 of quantised state). State to hash: position x,y,z mm, yaw, speed, 4 wheel omegas, 7 ride DOFs, as `Math.round(v*1000)|0` integers, never raw floats (avoids -0 vs 0, NaN payload and last-bit noise while still catching real divergence if you hash at a lower resolution than the divergence you care about; but near-ties at a rounding boundary can flip, so hash at 1e-3 and also store the float32 snapshot for resync). Cost of snapshot: ~40 floats x 4 B = 160 B; every 5 s = ~2 KB/min raw. Ship snapshots OPTIONAL (only in server-stored replays, not URL-shared).
4. Playback policy on mismatch (from Factorio/GGPO): (i) detect at first keyframe with bad CRC, (ii) if the replay has a snapshot at that tick, snap the ghost to it (state resync) and flag "approximate from t=..", (iii) else mark the remainder "device-approximate" in UI. Never silently continue.
5. Versioning: header = `{magic, formatVer, simVer, paramsHash, carId, suspensionType, roadSeed, tickRate, inputRate}`. `paramsHash` = hash of the lookup tables/constants actually used. If `simVer` differs: refuse and either (a) load the archived sim bundle `sim-core@vN` (Workers static assets keep old builds at `/sim/vN/` - cheap) or (b) fall back to a state-snapshot stream (Quake-style) if one was stored. Doom's lesson is that inputs-only replays are tied to the exact build [S].
6. Determinism hazards beyond Math: `Date.now()`/`performance.now()` in the step, `Math.random()` (use own PRNG e.g. mulberry32 with integer ops), `Array.sort` stability and iteration order of Map/objects (stable in spec), variable `dt` (use fixed 1/240 with integer tick counter), frame-rate dependent sub-stepping, and Float32Array stores (rounding is exact, so fine, but be consistent). Auto to Manual handover state must be recorded as the replay's initial condition (full float64 snapshot, 8 B each), not recomputed.

## (c) Compact encodings for URL-fragment sharing

- Fragment (`#...`) is never sent to the server, so Cloudflare URL limits do not apply; browsers accept very long fragments, chat/social apps truncate or mangle long links [E; I did not test per-app limits]. Practical budget: <= ~2,000 chars survives almost everywhere, <= ~8,000 mostly [E].
- Byte to text: `Uint8Array.prototype.toBase64({alphabet:'base64url', omitPadding:true})` and `Uint8Array.fromBase64(s,{alphabet:'base64url'})`: Baseline 2025 (newly available since Sept 2025) https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64 [S]. Polyfills: `core-js` (MIT [E]), `es-arraybuffer-base64` (es-shims, MIT [E]). Fallback: `btoa(String.fromCharCode(...))` then `+ / =` to `- _ ''`. Overhead 4/3.
- Compression: `new CompressionStream('deflate-raw')` + `DecompressionStream`: Baseline widely available since May 2023, available in Workers https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream [S]. Formats `gzip`, `deflate`, `deflate-raw` (per the spec as relayed by the fetch; MDN page did not list them) [E]. Use `deflate-raw` (no 18 B gzip header/trailer). Async: wrap with `new Response(stream).arrayBuffer()`. Zstd is not in the platform API [E].
- Size per minute, text length [E, synthetic, see (b)]: 8-bit steer ~1.25 KB -> ~1.7k chars; 10-bit steer ~2.8 KB -> ~3.8k chars. So a 1-minute run fits in a URL comfortably, 2-3 minutes with 8-bit steer at 30 Hz is ~2.5-4k chars. Above that, store server-side (KV is write-limited on Free: 1k/day; see file 15) and put only an id in the URL.
- Always include a 4-byte truncated checksum of the payload and the header fields from (b) so a mangled link fails loudly.
- Self-describing packing sketch (original code, project-owned):
```ts
function zz(v:number){return (v<<1)^(v>>31)}                // zig-zag
function putVar(out:number[], v:number){v=zz(v)>>>0;while(v>0x7f){out.push((v&0x7f)|0x80);v>>>=7}out.push(v)}
// per 60 Hz sample: steer (int10), thr (u8), brk (u8) as deltas vs previous; then deflate-raw -> base64url
```

## (d) "Same inputs, different suspension" A/B ghost

### Why open-loop replay diverges (and how fast)
Heading integrates yaw rate and position integrates heading, so the path error of an open-loop input replay grows without bound even for a yaw-stable vehicle: a 0.01 rad heading difference at 20 m/s is ~2 m of lateral error after 10 s [E, kinematic estimate]. Different suspension changes roll stiffness distribution, camber gain and tyre loads, which changes yaw gain and understeer gradient by a few %, enough to make the ghost cut or miss corners within one lap [E]. This is the same reason pre-programmed steering "robots" are closed-loop in proving grounds: AB Dynamics' Path Following uses GNSS/INS feedback to correct steering along a predefined path, "guiding it along a desired path, even at high speeds and high lateral acceleration" https://www.abdynamics.com/track-testing/software/path-following [S].

### Candidate comparisons
| Option | What differs honestly | Failure mode | Cost |
|---|---|---|---|
| A. Open-loop same-input replay | Pure plant difference ("same driver input to both cars") - the physically purest, standard in open-loop test manoeuvres (step steer, sine sweep) | Diverges; after a few seconds you compare different places on the road | Lowest |
| B. Closed-loop ghost: driver model tracks the user's recorded PATH (and speed trace); both cars run the SAME driver model with the same gains | Same line, same speed target by construction; differences appear as steering effort, slip angles, tracking error, roll/pitch/heave, load transfer, camber/toe excursions, wheel-hop | Driver model is a confound (its gains, preview and lag shape the result); if grip is exceeded the car understeers wide and "loses" the line, which is itself informative | Medium: a steering law + speed PI loop |
| C. Time-shifted overlay (delta-T) | Lap time/gap only; standard in telemetry: delta = comparison minus reference lap after aligning on normalised lap position, linearly interpolating between samples https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2026.2005550/full [S] | Says nothing about why; with a shared speed trace the delta is ~0 | Low |
| D. Split screen | Side-by-side same-time views | Halves resolution; two scenes, two sims; viewers cannot attend to both | High GPU; an inset/picture-in-picture is cheaper |
| E. Branching counterfactual: at each segment start (corner entry), reset the ghost to the user's state and replay the user's inputs for 3-5 s, then compare | Open-loop purity over a window short enough not to diverge | Discrete jumps; needs state-copy and per-segment UI | Medium |

### Closed-loop driver models worth lifting
- Pure pursuit (rear-axle reference, look-ahead point): `Lf = k*v + Lfc` (k=0.1, Lfc=2.0 m, WB=2.9 m in the demo); `alpha = atan2(ty - rear_y, tx - rear_x) - yaw`; `delta = atan2(2*WB*sin(alpha)/Lf, 1)`; clip to max steer. PythonRobotics `PathTracking/pure_pursuit/pure_pursuit.py`, MIT https://github.com/AtsushiSakai/PythonRobotics (LICENSE "The MIT License (MIT) Copyright (c) 2016 - now Atsushi Sakai") [S, fetched; raw lines quoted above]. Smooth, forgiving, cuts corners at high speed.
- Stanley (front axle reference): `delta = theta_e + atan(K_e * e / v)`; one gain; dividing by v makes it aggressive at low speed and heading-dominated at high speed; performed well on the DARPA Grand Challenge https://existentialrobotics.org/RobotProvingGrounds/algorithms/control/content/stanley [S]. Hoffmann et al. 2007 original not read [E]; PythonRobotics has `stanley_controller.py` (same MIT licence) but the raw URL I tried returned 404, so I did not read its code.
- Preview-optimal driver (MacAdam 1981): driver as optimal preview controller with neuromuscular delay minimising a quadratic cost on lateral path error over a preview window; "one of the most verified" https://scispace.com/pdf/an-adaptive-lateral-preview-driver-model-4tgy1e7ckx.pdf [S]; Application of optimal-preview control for the simulation of closed-loop automobile driving, IEEE SMC 11, 393-399 (1981). MacAdam's UMTRI-2001-43 covers near-limit handling [S citation list]. Heavy; for teaching vehicle dynamics this is the canonical "driver as part of the system" model. Use as inspiration (preview + lag), not as a port.
- Speed: PI on the recorded speed vs distance; because speed is the shared target, longitudinal differences show up as brake/throttle effort and wheel slip, not as lap-time.
- Why a driver-model parameter set must be IDENTICAL for A and B, and printed on screen ("driver: preview 0.6 s, lag 0.15 s").

### Recommended comparison (most honest AND legible)
Primary: B, closed-loop path-and-speed-trace ghost, with a tiny visible disclosure ("Both cars are steered by the same autopilot following your line and speed; what differs is how hard the autopilot has to work and how the body moves"). Display the differences as distance-aligned traces (borrow the delta-T plotting convention of C, but plot STEER ANGLE, slip angle, roll angle, lateral tracking error, min tyre load), not as lap time. Rendering: the ghost is a translucent second car on the same screen at the same distance-along-path, plus a small strip chart; avoid split-screen.
Secondary (advanced toggle): E (branching 4 s windows) for a pure "same inputs" view, labelled "open-loop, 4 s".
Skip: C as a primary (almost no information when speed is shared), D (cost), long-horizon A (diverges).
Note: the existing Auto mode is already a kinematic path-follower with a friction-limited speed profile (brief). Feeding it the user's recorded path+speed trace gives a ghost for free, but the lateral track is kinematic so by construction handling/grip differences will NOT appear, only ride/roll/pitch and kinematics; if that is the first cut, say so in the UI ("ride and body comparison, not grip"). The lateral closed loop needs the manual-drive dynamic model.

## Recommendation for Suspension Lab
1. Treat `Math.sin/cos/atan/atan2/exp/log/pow/hypot` as non-deterministic across Chrome/Firefox/Safari in 2026; V8 main now forwards sin/cos/exp/atan2/pow to LLVM-libc [S], SpiderMonkey keeps fdlibm for trig but libc for pow [S], JSC uses platform libm [E-2020].
2. In the 240 Hz stepped core, allow only `+ - * / sqrt abs min max floor fround`; design out transcendentals (renormalised 2-vectors for heading, rational tyre saturation, explicit multiplies for powers). Do this BEFORE shipping any replay format.
3. For unavoidable trig, vendor a small fdlibm-style `sin/cos/atan2` kernel from stdlib-js (Apache-2.0 + Sun notice; keep headers, add NOTICE), skipping `rempio2` by wrapping angles to [-pi, pi] with Cody-Waite reduction; verify coefficients against the stdlib files.
4. Lookup tables are fine if generated at build time and checked in as data; never generate them with `Math.sin` at runtime.
5. Quantise inputs at record time (steer int10/16, throttle/brake u8, 60 Hz) and make live play consume the same quantised values. Zero-order hold across 4 sim ticks.
6. Format: header {magic, formatVer, simVer, paramsHash, car, suspension, roadSeed}, then per-channel delta+zig-zag varint, then `deflate-raw`, then base64url. Expect ~1.3-3 KB/min [E synthetic], i.e. a 1-minute run is ~1.7-3.8k URL chars; longer runs go server-side.
7. Add a CRC32 keyframe every 5 s over integer-rounded state; on mismatch, resync from an optional float snapshot and flag "approximate". Never continue silently.
8. Version by archiving old `sim-core` bundles under `/sim/vN/` on Workers assets; refuse or route replays whose `simVer`/`paramsHash` differ (Doom lesson).
9. Add a CI job running one fixed replay in Node, Firefox and WebKit (Playwright) and comparing state hashes each second; that is the real determinism guarantee.
10. A/B ghost: ship option B (same autopilot following the user's path and speed trace) as the default, labelled honestly, shown as a translucent ghost plus distance-aligned steer/slip/roll/tracking-error strips.
11. Offer branching 4 s open-loop windows (E) as the "same inputs" mode; avoid long open-loop replays and split-screen.
12. Lift pure-pursuit/Stanley formulas from PythonRobotics (MIT, keep copyright line); treat Hoffmann and MacAdam as ideas only (papers).
13. Use `CompressionStream` and `Uint8Array.toBase64` with feature detection and a small polyfill/fallback; both are Baseline (2023 / Sept 2025).
14. Risks: tyre-model retune when removing atan/pow; V8's math churn means even a "same engine" guarantee expires with Chrome updates; the driver model is a confound in B and must be disclosed; URL length differs per messenger app (untested).
