# 02-06 — follow-ups to the simulation fixes: SUMMARY

## 1. Race Engineer facts vs the current simulation
New `tests/worker/engineer-facts.test.ts`. Every comparative claim in the fact cards and the rule-based answers is
pinned twice: to its wording (regex on the card text) and to the ordering that sim-core computes. Its inputs are the
kinematics summaries of both axles and a live seek to the carousel apex and through the brake zone. If either side
changes, the test fails.

Measured values (front / rear where it matters; MP = MacPherson, DW = double wishbone, ML = multi-link):

| | MP | DW | ML |
|---|---|---|---|
| RC height mm | 105 / 99 | 74 / 77 | 43 / 49 |
| RC sideways @2° roll mm | 354 / 374 | 98 / 112 | 37 / 55 |
| track change @+30 mm, mm | 2.4 / 2.2 | 1.9 / 2.0 | 1.0 / 1.2 |
| carousel roll ° | 1.26 | 1.30 | 1.35 |
| carousel outside front camber ° | −0.72 | −0.97 | −0.81 |
| carousel outside rear camber ° | −0.12 | −0.77 | −0.66 |
| brake pitch ° | 1.18 | 1.23 | 1.30 |
| front caster ° / anti-dive % | 6.4 / 29 | 6.0 / 24 | 4.9 / 13 |

**False claims fixed in `worker/engineer/facts.ts`:**
- **DW, roll-centre movement.** The card said the DW roll centre "moves sideways the least". It now says it "moves
  sideways much less than the strut's, but more than the multi-link's".
- **ML, roll-centre movement.** The card said the ML roll centre "still moves a long way sideways". It now says it
  "moves sideways the least of the three … because its lower links sit close to horizontal across the car".
- **DW, tyre scrub (newly found).** "Costs: … more sideways scrub of the tyre over bumps" was false: the strut has the
  most track change. The card now says: "Over bumps its tyre scrubs sideways more than the multi-link's, though less
  than the strut's here." The awkward truth is kept as a cost.

**Re-verified, still true:**
- RC ordering on both axles;
- camber gain and roll camber orderings on both axles;
- the strut rolls least and the ML most;
- the strut has the most caster and the outside front ends up "close to the multi-link" (0.09°);
- the DW front gain is small at true scale, and the rear is the clearest gap;
- the strut has the most anti-dive, and brake pitch differs tinily;
- bump steer is almost zero on every type;
- the strut has the largest scrub radius;
- grip use differs tinily.

The rule-based answers needed no change (the strut gives up the most rear camber, DW is flattest, ML is between, brake
dive differs tinily, a higher RC rolls less, no type is best). `fallback.ts` and `rules.ts` are untouched and still
byte-identical.

## 2. Hub axle sign (`src/features/linkage-parts/corner.ts`)
- The axle is now `(sin toe cos camber, side cos toe cos camber, −sin camber)`, the same as sim-core's `axle0`.
- New regression test: at 4 lap times × 4 corners × 3 types, `inspect().wheel.axis` is compared against the live sim's
  `wheelRotation` spin axis. The worst error is below 0.1°. With the old sign the test fails at 3.0°, which is 2 × the
  1.5° front camber.
- The `HARDPOINT_CONFLICTS` allow-list is gone, and both clearance tests assert zero conflicts. Minimum part
  clearances: MP 18.5 mm, DW 0.3 mm, ML 1.7 mm.
- Still reported, not asserted: the tyre/rim **proxy** overlaps in extreme poses (full bump, bump plus lock), up to
  12.6 mm for MP, 17.6 mm for DW and 12.4 mm for ML. These poses are never reached on the lap. They are the
  "remaining" items 02-05 listed, now measured with the correct axle.

## 3. vehicle-view
- The divergence skip is gone: every one of the 40 seeks, including the 0.4 lap, must return |heave| < 1.
- The real-wheel clearance report is now `expect(report).toEqual([])`. It passes and prints "none".

## 4. Docs (prose only)
- **ROADMAP:**
  - Phase-2 success criterion 4 (the only "MacPherson loses most front camber" wording) now gives the measured, small
    front ordering DW > ML > MP (−0.97/−0.81/−0.72°, under the visibility threshold) and the clear rear difference.
  - 05-03 lean sign: right turn → bike leans right → roll > 0.
- **ARCHITECTURE §7.3:**
  - Chrono DW scrub/trail are now +5.26/+10.93 mm (were 6.2/10), and MP scrub/trail +103.0/+41.9 mm are added. These
    are the values `kinematics-reference.test.ts` asserts.
  - A note explains why the research digits were wrong. It also gives the current shipped-definition front scrub/trail
    from the 02-05 table: scrub 26.0/21.8/12.9 mm, trail 15.5/17.0/33.6 mm. §7.3 holds regression references, not
    shipped values, so the shipped numbers sit in the note rather than replacing the references.
- **Not edited, for the orchestrator:** the `COMPONENT_COLORS` doc comment ("Linear-sRGB hex for THREE.Color") is
  inside the byte-compared contract block (§5 / `src/contracts`). It should say the values are **sRGB** hex, which
  THREE.Color converts. This change needs the contract file and the ARCHITECTURE block to change together.

## Not changed
- `tests/fixtures/06-02-telemetry-carousel.json` still holds the 02-04 MacPherson carousel values: camber −0.76,
  RC 106/86 mm. The current values are −0.72 and 105/99 mm. Only the grounding tests use it, so no claim depends on it.
  It is not in my owned list.

## Verification (real output)
```
$ npx vitest run            (whole suite)
 Test Files  56 passed | 1 skipped (57)
      Tests  640 passed | 11 skipped (651)
$ npm run lint:deps
✔ no dependency violations found (204 modules, 637 dependencies cruised)
$ npm run typecheck
tests/e2e/04-05-layout.spec.ts(159,48): error TS2353 ... 'clip' does not exist in type 'LocatorScreenshotOptions'.
tests/features/telemetry-panel.test.ts(129,30): error TS2345 ... Property 'range' is missing ... 'CornerGlyph'.
```
The typecheck errors are only in files other executors own (04-05 layout, telemetry-panel), which are mid-work, so
`npm run check` stops at typecheck. My files typecheck clean. I did not run Playwright and did not deploy.

Commits:
- f4487ba: facts and test;
- 4ed237d: hub axle, test and plan;
- 5e127dc: vehicle-view;
- 2022af3: docs;
- plus this summary.
