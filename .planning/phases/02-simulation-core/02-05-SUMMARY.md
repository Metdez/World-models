# 02-05 — simulation fixes: SUMMARY

## 1. seek() divergence: root cause and fix
- **Symptom:** a fresh `sim.seek(0.4 * lap)` (33.487 s, pavé) returned heave ≈ 7.5e8 m. A 400-point scan also found
  32.440 s (MP, ML) and 38.510 s (MP).
- **Root cause:** `ride7dof.reset()` (static equilibrium) ran 20 full Newton steps from q = 0, with no convergence check.
  On the pavé the start guess has a wheel off the ground. The force balance is piecewise linear (tyre lift-off,
  stops), so full steps overshoot without bound. The loop then ran out of iterations and **returned the diverged
  state without throwing**, so car-model's flat-plane fallback (which catches throws) never ran. Every later pre-roll
  step started from garbage. Continuous stepping through the same section was always fine.
- **Fix (`src/sim-core/ride/ride7dof.ts`):** start the solve with every hub on its road input and the body on the plane
  through them, so all tyres start at static deflection. Add a backtracking line search on the residual (max-norm)
  and up to 60 iterations. Throw if it still does not converge, so a diverged state is never returned. No clamps.
  Goldens did not change: equilibria that converged before converge to the same point.
- **New `tests/sim-core/seek-stability.test.ts`:** 200 evenly spaced seeks plus the 0.4-lap time, for each of the three
  types. It asserts |heave|, |roll|, |pitch| and |travel| < 0.1, and that seek equals continuous stepping. Worst
  differences (now, after the geometry change):
  - MP: heave 0.15 mm, roll 0.04 mrad, pitch 0.06 mrad, travel 0.19 mm;
  - DW: 0.23 mm, 0.03, 0.06, 0.23 mm;
  - ML: 0.22 mm, 0.09, 0.05, 0.22 mm.

  Tolerances: 1 mm heave, 1.5 mm travel, 2 mrad roll, 1 mrad pitch.
- **For 03-03 / the orchestrator:** the divergence skip in `tests/features/vehicle-view.test.ts` (`blownUp`) can be
  removed. Nothing diverges any more (not edited: not my file).

## 2. Hardpoints vs the real DB11 wheel
**Measurement.** I measured the wheel's cross-section from the GLB vertices in the hub frame:
- inboard face at −0.145 m axial, r 0.263–0.342;
- tyre shoulder r 0.342–0.382;
- barrel inner radius ≈ 0.278–0.29.

Each 03-04 capsule was checked against this solid of revolution in the real hub frame (the db11 `hub:*` node), over
48–96 seeks per type. The 03-03 vertex test under-reports, because the barrel has vertices only at its ends.

**Bug found in a file I do not own (`src/features/linkage-parts/corner.ts`):** the hub axle annotation uses
`+sin(camber)` for the vertical component. Sim-core (`spatial.ts` axle0 = −sin(camber)) and the db11 hub
(`wheelRotation`) both tilt the top inboard for negative camber. As a result, the linkage visual's disc, caliper and
`inspect().wheel.axis` are tilted 2 × camber (3° front, 2.4° rear) the wrong way, relative to the real wheel. This also
skews the tyre/rim proxy in `tests/features/linkage-parts.test.ts`. It needs a fix by the owner: `-Math.sin(o.camber)`.

**What moved (AXLE frame, left, m):**
- **MacPherson:**
  - strutLower y 0.665 → 0.632 (front and rear);
  - strutTop y 0.64 → 0.61 and z 0.86 → 0.90. The top mount is 40 mm higher to hold KPI under the 14° gate;
    the owners of the body/bonnet visuals should check it;
  - lbj y 0.8 → 0.792;
  - tie-rod inners re-placed: F [-0.16, 0.3411, 0.2743], R [-0.16, 0.3214, 0.271].
- **Double wishbone:** rear springSeat/springTop x 0.07/0.08 → 0 (as 03-04 suggested). Nothing else moved.
- **Multi-link front:**
  - lowerRear (trailing): inner [-0.4, 0.62, 0.156] → [-0.19, 0.47, 0.145] and outer [-0.04, 0.79, 0.15] →
    [-0.013, 0.765, 0.1502]. The link is swung inboard through the same virtual lower pivot (≈ x 0.019, y 0.818),
    so KPI and scrub hold;
  - lowerFront raised: inner z 0.1284 → 0.152, outer z 0.145 → 0.172 (damper eye clears the rim lip);
  - spring at 0.75 of the link (was 0.8);
  - springTop [-0.035, 0.62, 0.75] → [-0.04, 0.54, 0.75];
  - upper outer joints moved 35 mm inboard along their own link lines: [0.0158, 0.645, 0.6678] and
    [-0.0933, 0.645, 0.6624];
  - arbPickup kept on its link; tie rod [-0.15, 0.4509, 0.212].
- **Multi-link rear:**
  - lowerFront (leading): [0.4, 0.62, 0.161]/[0.04, 0.79, 0.15] → [0.1416, 0.47, 0.147]/[-0.0294, 0.755, 0.15],
    through the same virtual pivot;
  - lowerRear raised: z 0.1302 → 0.148 inner, 0.145 → 0.172 outer;
  - spring at 0.7 of the link (was 0.8);
  - springTop [-0.1, 0.62, 0.72] → [-0.06, 0.56, 0.72];
  - upper outer joints moved inboard along their lines: [0.0413, 0.655, 0.67] and [-0.0567, 0.655, 0.6646];
  - arbPickup [-0.105, 0.5825, 0.16] (visual only);
  - toe link [-0.17, 0.4605, 0.2321].
- `susp-multilink.ts` `axle()` now takes the spring fraction per axle.

**Result:**

| check | before | after |
|---|---|---|
| real-wheel vertex test (`vehicle-view.test.ts`) | 24 clashes, 4–23 mm | none (> 2 mm) |
| hub-frame envelope, lap | MP −11.6 mm (seat), ML down to −47 mm | MP ≥ +1.2 mm (front seat), DW clear, ML ≥ +2.3 mm |
| `linkage-parts` part-vs-part | 5 allow-listed conflicts (DW 15 mm, ML 4–21 mm) | 0 conflicts. Min part clearance: MP 18.5, DW 0.4, ML 1.7 mm |

The `HARDPOINT_CONFLICTS` allow-list in `tests/features/linkage-parts.test.ts` is now unused (its owner can empty it).

**Remaining (full-travel extreme poses only, never reached on the lap):**
- lower arms/links pass the rim lip at full lock plus 80 % bump: MP lower arm ≈ 10–19 mm, DW ≈ 17–22 mm, ML
  trailing link ≈ 9–16 mm (proxy, wrong-camber visual axis);
- DW and MP rear lower arm at full 70 mm bump: ≈ 5 mm.

These are the same order as before. I did not change any lower-arm geometry for them.

**02-02 gates: all pass.** Before → after (F = front, R = rear):

| metric | MP F | MP R | DW F | DW R | ML F | ML R |
|---|---|---|---|---|---|---|
| camber gain deg/10mm | −0.130 → −0.113 | −0.126 → −0.109 | −0.437 = | −0.406 = | −0.308 → −0.314 | −0.361 → −0.357 |
| roll camber deg/deg | 0.82 → 0.85 | 0.83 → 0.86 | 0.32 = | 0.37 = | 0.51 → 0.49 | 0.43 = |
| RC mm | 107.1 → 104.8 | 101.0 → 98.6 | 73.7 = | 76.8 = | 35.6 → 42.7 | 54.1 → 49.2 |
| RC lateral @2° roll mm | 337 → 354 | 354 → 374 | 98 = | 112 = | **291 → 37** | **218 → 55** |
| bump steer deg/10mm | 0.004 = | 0.005 → 0.006 | = | = | 0.002 = | −0.018 → −0.016 |
| toe @−70 mm deg | 0.008 → 0.006 | 0.014 → 0.010 | = | = | 0.006 → −0.002 | −0.048 → −0.200 |
| KPI deg | 12.84 → 13.78 | 12.79 → 13.73 | 6.81 = | 6.79 = | 7.76 → 8.19 | 10.98 → 11.72 |
| caster deg | 6.80 → 6.44 | 0.80 → 0.76 | 5.97 = | 0.00 = | 4.71 → 4.94 | −8.43 → −8.88 |
| scrub mm | 20.8 → 26.0 | 19.9 → 25.2 | 21.8 = | 21.0 = | 18.3 → 12.9 | −26.0 → −35.7 |
| trail mm | 16.8 → 15.5 | 2.0 → 1.8 | 17.0 = | −0.0 = | 30.7 → 33.6 | −105.5 → −111.0 |
| motion ratio | 0.943 → 0.944 | 0.958 → 0.957 | 0.710 = | 0.717 → 0.711 | **0.770 → 0.710** | **0.772 → 0.671** |
| anti-dive/squat % | 30.1 → 29.1 | 18.9 → 18.3 | 23.7 = | 11.4 = | 16.9 → 13.0 | 20.1 → 20.5 |

The orderings asserted by the gates still hold: RC MP > DW > ML, |gain| DW > ML > MP, roll camber MP > ML > DW.

**Honesty notes:**
- Every move removes an interpenetration. Where a move shifted a metric, I compensated it back towards its old value,
  never towards an ordering.
- Two character changes are unavoidable packaging consequences, and copy must not hide them:
  - **ML RC lateral migration** fell from 291/218 mm to 37/55 mm. With more transverse lower links, ML now migrates
    the least of the three (DW 98/112);
  - **ML motion ratio** fell to 0.71/0.67, because the spring moved inboard on its link.
- Side effect, not targeted: carousel outer-front camber is now MP −0.72° / DW −0.97° / ML −0.81° (was
  −0.76 / −0.97 / −0.76). The ROADMAP order MP-loses-most, then ML, then DW now holds at true scale, by 0.09° between
  MP and ML. That is still below the 0.3° visibility threshold.

**Other simulation-differences changes:**
- RC front 106/74/34 → 103/74/43 mm;
- outer rear camber MP −0.16 → −0.12°;
- roll −1.26 / −1.30 / −1.35°;
- roll gradient MP 1.023 → 1.029 deg/g, ML 1.174 → 1.169 deg/g;
- brake pitch 1.18 / 1.23 / 1.30°.

**Goldens updated** (geometry change):

| type | before | after |
|---|---|---|
| MP | `483f16ac` | `53e95141` |
| DW | `30a29468` | `a8a25413` |
| ML | `3b374690` | `64d2ddf9` |

**Other test edits:**
- `kinematics-table.test.ts`: the smoothness check's relative scale now has a floor of 1e-3. ML front toe is nulled to
  ±0.006°, so the relative second difference was noise (0.021 vs 0.02).
- `simulation.test.ts`: as the orchestrator requested, it no longer expects the phase-5 stub error. The fake bike
  must throw, and the car keeps running.

## 3. Grip use > 1 (documented, not changed)
Over a lap, the speed profile's vehicle-level friction ellipse peaks at 1.005, so path and limits are consistent.
Grip use goes above 1 only on the driven rear tyres under 0.5 g traction (8.5 kN on two tyres). On smooth road the
steady state is about 0.86. It exceeds 1 (up to 1.27 at the carousel exit) where road roughness or crests unload a
rear tyre, for example rl at 2.0 kN, while the path keeps demanding the same traction.

The cause is a model shortcut: demand comes from the path, and there is no wheel-slip or tyre-force saturation. The
fix would be a tyre-force model, which is outside this plan. `gt-coupe.ts` (limits) is not mine. The indicator stays
labelled "model".

## For other executors
- `worker/engineer/facts.ts` claims that are now false (not edited):
  - line 36: "DW roll centre … moves sideways the least". ML now moves least (37 mm vs DW 98 mm);
  - line 41: "multi-link … roll centre still moves a long way sideways". It is now 37/55 mm.
- Still true: line 30 (MP outside front "close to the multi-link", 0.09° apart), line 29, line 32 (MP most anti-dive)
  and line 13 (roll MP least, ML most).
- Numbers that copy may quote: RC heights (front 105/74/43 mm), MP KPI 13.8° and scrub 26 mm, ML motion ratio
  0.71/0.67, MP strut top now at 0.90 m.
- linkage-parts camber-sign bug (above).
- The vehicle-view divergence skip can go.

## Verification (real output)
```
$ npx vitest run tests/features/vehicle-view.test.ts tests/features/linkage-parts.test.ts
macpherson: min part clearance 18.5 mm ... double-wishbone: 0.4 mm ... multilink: 1.7 mm
  suspension parts inside the real wheel mesh (> 2 mm, lap at true scale):
    none
 Test Files  2 passed (2)      Tests  46 passed (46)
$ npm run check
✔ no dependency violations found (204 modules, 631 dependencies cruised)
 Test Files  55 passed | 1 skipped (56)
      Tests  621 passed | 11 skipped (632)
```
I did not run Playwright and did not deploy. Scratch harnesses live outside the repo; `tests/sim-core/_scratch` was
removed. Part of this plan's work was swept into WIP snapshot commits (5ffa35b and earlier). My own commits are
2fb7ab6 and 57de082, plus this summary.
