/**
 * 11-04 ghost runs (ARCHITECTURE-M2 §7.14, §13.3): "same line, different suspension".
 * Visitor drives are scripted: a gamepad-like driver on the steering pad and through the slalom (annex stations), and
 * the 11-03 keyboard driver on the loop. Asserted: the course is the visitor's exact run; A/A determinism; the
 * identical-tables control is identical; the ghost with the visitor's suspension repeats the visitor within the stated
 * tolerance (the noise floor); another suspension differs above it; the refusals; no allocation per ghost step.
 * The measured numbers are printed ([11-04] lines) for the SUMMARY.
 */
import { describe, expect, it } from "vitest";
import {
  CONTROL_TICKS,
  type DecodedReplay,
  type DriveIntent,
} from "../../src/contracts/drive";
import type { SimCatalog, Simulation } from "../../src/contracts/sim";
import type { SuspensionDefinition } from "../../src/contracts/suspension";
import { SIM_DT } from "../../src/contracts/units";
import { gtCoupe } from "../../src/sim-core/content/gt-coupe";
import { provingGround } from "../../src/sim-core/content/proving-ground";
import { provingLoop } from "../../src/sim-core/content/proving-loop";
import type { DriveHost } from "../../src/sim-core/drive/control";
import { compareRuns, type Comparison } from "../../src/sim-core/ghost/compare";
import {
  buildCourse,
  CHANNELS,
  createGhost,
  createGhostDriver,
  GHOST_DS,
  runGhost,
  type GhostCourse,
  type GhostRun,
  type SimFactory,
} from "../../src/sim-core/ghost/ghost";
import { createDriveCommand } from "../../src/sim-core/drive/types";
import { createSimulation } from "../../src/sim-core/index";
import { plantOf } from "../../src/sim-core/simulation";
import { SUSPENSIONS } from "../fixtures/08-02-drive";
import { scriptedDriver } from "../fixtures/11-03-replay";

const COPY_ID = "macpherson-copy";
const suspensions: Record<string, SuspensionDefinition> = {
  ...SUSPENSIONS,
  [COPY_ID]: { ...SUSPENSIONS.macpherson, id: COPY_ID },
};
const catalog: SimCatalog = {
  track: (id) => (id === provingLoop.id ? provingLoop : undefined),
  vehicle: (id) =>
    id === gtCoupe.id
      ? { ...gtCoupe, suspensions: [...gtCoupe.suspensions, COPY_ID] }
      : undefined,
  suspension: (id) => suspensions[id],
  world: (trackId) =>
    trackId === provingGround.trackId ? provingGround : undefined,
};
const makeSim: SimFactory = (suspensionId) =>
  createSimulation({
    catalog,
    trackId: provingLoop.id,
    vehicleId: gtCoupe.id,
    suspensionId,
    lapTime: 10,
  });
const host = (sim: Simulation) => sim.drive as DriveHost;
const DEG = 180 / Math.PI;

/** A gamepad-like visitor: pure pursuit on a target path y(x) or a circle, speed PI to `speed`. */
function analogVisitor(
  sim: Simulation,
  target: (
    x: number,
    y: number,
    yaw: number,
    out: { tx: number; ty: number },
  ) => void,
  speed: number,
  seconds: number,
) {
  const p = plantOf(sim)!;
  const intent: DriveIntent = {
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: 0,
    digital: false,
    source: "gamepad",
  };
  const t = { tx: 0, ty: 0 };
  const n = Math.round(seconds / SIM_DT);
  for (let k = 0; k < n; k++) {
    if (k % CONTROL_TICKS === 0) {
      const v = p.view;
      const yaw = Math.atan2(v.sinYaw, v.cosYaw);
      target(v.x, v.y, yaw, t);
      const dx = t.tx - v.x;
      const dy = t.ty - v.y;
      const ld = Math.hypot(dx, dy);
      const alpha = Math.atan2(dy, dx) - yaw;
      const delta = Math.atan2(2 * v.wheelbase * Math.sin(alpha), ld) * 1.15;
      intent.steer = Math.max(-1, Math.min(1, delta / v.maxSteer));
      const ev = speed - v.u;
      intent.throttle = Math.max(0, Math.min(1, 0.3 + 0.4 * ev));
      intent.brake = Math.max(0, Math.min(1, -0.3 * ev - 0.3));
      sim.drive!.setIntent(intent);
    }
    sim.step(SIM_DT);
  }
}

/** Manual at a station (one step), then the visitor's drive; returns the last <= 30 s. */
function stationSpan(
  spawn: string,
  suspensionId: string,
  drive: (sim: Simulation) => void,
): { sim: Simulation; span: DecodedReplay } {
  const sim = makeSim(suspensionId);
  sim.drive!.request("manual");
  sim.drive!.reset(spawn);
  sim.step(SIM_DT);
  drive(sim);
  return { sim, span: host(sim).last(29)! };
}

/** Steering pad: circle centre (-170, 335), radius 40, counter-clockwise from the east spawn. */
const padDrive = (speed: number) => (sim: Simulation) =>
  analogVisitor(
    sim,
    (x, y, _yaw, out) => {
      const a = Math.atan2(y - 335, x + 170) + 0.35; // look ahead ~14 m along the circle
      out.tx = -170 + 40 * Math.cos(a);
      out.ty = 335 + 40 * Math.sin(a);
    },
    speed,
    22,
  );
/** Slalom: cones on y 280 at x -90 ... 60 every 25 m; weave +-2.6 m around them from the spawn at x -170. */
const slalomY = (x: number) =>
  x < -102.5 ? 280 : 280 + 2.6 * Math.sin((Math.PI * (x + 102.5)) / 25);
const slalomDrive = (speed: number) => (sim: Simulation) =>
  analogVisitor(
    sim,
    (x, _y, _yaw, out) => {
      out.tx = x + 9;
      out.ty = slalomY(x + 9);
    },
    speed,
    17,
  );

interface Result {
  course: GhostCourse;
  a: GhostRun;
  b: GhostRun;
  cmp: Comparison;
}
function compare(span: DecodedReplay, other: string): Result {
  const course = buildCourse(span, makeSim);
  if (typeof course === "string") throw new Error(`course refused: ${course}`);
  const a = runGhost(course, makeSim, course.suspensionId);
  const b = runGhost(course, makeSim, other);
  return { course, a, b, cmp: compareRuns(course.visitor, a, b) };
}
function print(label: string, r: Result): void {
  const ch = r.cmp.channels;
  const fmt = (c: (typeof CHANNELS)[number]) => {
    const k = c === "offset" ? 1 : DEG;
    const u = c === "offset" ? "m" : "°";
    return `${c} floor ${(ch[c].floor * k).toFixed(3)}${u} A' ${(ch[c].aPeak * k).toFixed(2)} B ${(ch[c].bPeak * k).toFixed(2)} Δ ${(ch[c].peakDiff * k).toFixed(3)}${ch[c].significant ? " *" : ""}`;
  };
  console.log(
    `[11-04] ${label}: window ${(r.course.ticks * SIM_DT).toFixed(1)} s / ${(r.course.n * GHOST_DS).toFixed(0)} m from tick ${r.course.offset}; ` +
      `A/A max offset ${(r.cmp.aaOffset * 100).toFixed(1)} cm (${r.a.status}), B ${r.b.suspensionId} max offset ${(r.cmp.bOffset * 100).toFixed(1)} cm (${r.b.status}); ` +
      `steer effort ${(r.cmp.steerEffort * 100).toFixed(1)} %; verdict ${r.cmp.verdict} [${r.cmp.order.join(", ")}]\n  ` +
      CHANNELS.map(fmt).join("\n  "),
  );
}

const pad = stationSpan("steering-pad", "macpherson", padDrive(15));
const slalom = stationSpan("slalom", "macpherson", slalomDrive(14));
const D = Math.PI / 180;

describe("ghost runs (11-04)", () => {
  it(
    "steering pad: A/A repeats the visitor; multi-link needs more steering above the floor; double wishbone the same",
    { timeout: 60_000 },
    () => {
      const ml = compare(pad.span, "multilink");
      const dw = compare(pad.span, "double-wishbone");
      print("steering pad 15 m/s macpherson -> multilink", ml);
      print("steering pad 15 m/s macpherson -> double-wishbone", dw);
      expect(ml.course.ticks * SIM_DT).toBeGreaterThan(15);
      expect(ml.a.status).toBe("finished");
      expect(ml.cmp.aaOffset).toBeLessThan(0.05);
      expect(ml.cmp.channels.steer.floor).toBeLessThan(0.1 * D);
      expect(ml.cmp.channels.roll.floor).toBeLessThan(0.05 * D);
      expect(ml.cmp.verdict).toBe("different");
      expect(ml.cmp.channels.steer.significant).toBe(true);
      expect(ml.cmp.steerEffort).toBeGreaterThan(0.03);
      expect(dw.cmp.verdict).toBe("same");
    },
  );

  it(
    "slalom: A/A repeats the visitor; multi-link differs, double wishbone the same",
    { timeout: 60_000 },
    () => {
      const ml = compare(slalom.span, "multilink");
      const dw = compare(slalom.span, "double-wishbone");
      print("slalom 14 m/s macpherson -> multilink", ml);
      print("slalom 14 m/s macpherson -> double-wishbone", dw);
      expect(ml.a.status).toBe("finished");
      expect(ml.cmp.aaOffset).toBeLessThan(0.1);
      expect(ml.cmp.verdict).toBe("different");
      expect(dw.cmp.verdict).toBe("same");
    },
  );

  it(
    "A/A runs are identical; the identical-tables control is identical",
    { timeout: 60_000 },
    () => {
      const course = buildCourse(pad.span, makeSim) as GhostCourse;
      const a1 = runGhost(course, makeSim, "macpherson");
      const a2 = runGhost(course, makeSim, "macpherson");
      const copy = runGhost(course, makeSim, COPY_ID);
      for (const c of CHANNELS) {
        expect(Array.from(a2.trace.ch[c])).toEqual(Array.from(a1.trace.ch[c]));
        expect(Array.from(copy.trace.ch[c])).toEqual(
          Array.from(a1.trace.ch[c]),
        );
      }
      const cmp = compareRuns(course.visitor, a1, copy);
      expect(cmp.verdict).toBe("same");
      for (const c of CHANNELS) expect(cmp.channels[c].peakDiff).toBe(0);
    },
  );

  it(
    "the live (trace-free) ghost steps exactly like the headless run; the driver does not allocate",
    { timeout: 60_000 },
    () => {
      const course = buildCourse(pad.span, makeSim) as GhostCourse;
      const headless = createGhost(makeSim("multilink"), course, true);
      const live = createGhost(makeSim("multilink"), course, false);
      for (let k = 0; k < 600; k++) {
        headless.step();
        live.step();
      }
      expect(live.s).toBe(headless.s);
      expect(live.offset).toBe(headless.offset);
      expect(live.pose(0.5, 1).bodyPosition.x).toBe(
        headless.pose(0.5, 1).bodyPosition.x,
      );
      const gc = (globalThis as { gc?: () => void }).gc;
      expect(gc, "vitest must run with --expose-gc").toBeTypeOf("function");
      // The driver (projection + command) after JIT warm-up: allocation-free. (The plant's own step and sample are
      // covered by plant-no-alloc; a sampling heap profile of a whole ghost step shows only plant/world sites.)
      const driver = createGhostDriver(course, gtCoupe.wheelbase);
      const view = plantOf(makeSim("multilink"))!.view;
      const cmd = createDriveCommand();
      const block = (n: number) => {
        for (let k = 0; k < n; k++) {
          driver.project(view);
          driver.command(SIM_DT, view, cmd);
        }
      };
      block(100_000);
      let churn = Infinity;
      for (let r = 0; r < 3; r++) {
        gc!();
        const before = process.memoryUsage().heapUsed;
        block(50_000);
        churn = Math.min(
          churn,
          (process.memoryUsage().heapUsed - before) / 50_000,
        );
      }
      console.log(
        `[11-04] ghost driver heap churn per step: ${churn.toFixed(2)} B`,
      );
      expect(churn).toBeLessThan(16);
    },
  );

  it(
    "keyboard drive on the loop: the ghost repeats a clumsy keyboard drive",
    { timeout: 60_000 },
    () => {
      const sim = makeSim("double-wishbone");
      sim.drive!.request("manual");
      sim.step(SIM_DT);
      scriptedDriver(7, false)(sim, 30);
      const r = compare(host(sim).last(29)!, "multilink");
      print("loop keyboard double-wishbone -> multilink", r);
      expect(r.cmp.verdict).not.toBe("refused");
    },
  );

  it("refuses a span too short to compare", () => {
    const { span } = stationSpan("slalom", "macpherson", (sim) =>
      analogVisitor(
        sim,
        (x, _y, _yaw, out) => ((out.tx = x + 9), (out.ty = 280)),
        10,
        3,
      ),
    );
    expect(buildCourse(span, makeSim)).toBe("short");
  });

  it("comparison: refuses when A/A cannot repeat the line, reports a lost B, otherwise holds differences to the floor", () => {
    const trace = (n: number, f: (k: number) => number) => {
      const t = {
        n,
        ch: Object.fromEntries(
          CHANNELS.map((c) => [
            c,
            Float64Array.from({ length: n }, (_, k) => f(k)),
          ]),
        ),
      } as unknown as GhostRun["trace"];
      return t;
    };
    const run = (
      t: GhostRun["trace"],
      maxOffset: number,
      status: GhostRun["status"] = "finished",
    ): GhostRun => ({
      suspensionId: "x",
      status,
      maxOffset,
      steps: 1,
      trace: t,
    });
    const v = trace(100, (k) => 0.05 * Math.sin(k / 10));
    const near = trace(100, (k) => 0.05 * Math.sin(k / 10) + 0.0001);
    expect(compareRuns(v, run(near, 0.3), run(near, 0.01)).verdict).toBe(
      "refused",
    );
    expect(compareRuns(v, run(near, 0.02), run(near, 1.0)).verdict).toBe(
      "lost",
    );
    expect(
      compareRuns(
        v,
        run(near, 0.02),
        run(
          trace(50, () => 0),
          0.1,
        ),
      ).verdict,
    ).toBe("lost");
    expect(compareRuns(v, run(near, 0.02), run(near, 0.02)).verdict).toBe(
      "same",
    );
    // 0.3 deg more steer everywhere: above the perceptual floor (0.25 deg) and 3 x the A/A floor
    const more = trace(
      100,
      (k) => 0.05 * Math.sin(k / 10) + 0.0001 + (k > 0 ? 0.3 * D : 0),
    );
    const cmp = compareRuns(v, run(near, 0.02), run(more, 0.02));
    expect(cmp.verdict).toBe("different");
    expect(cmp.order).toContain("steer");
    // the same difference against a noisy A/A (floor 0.2 deg) is not significant
    const noisy = trace(
      100,
      (k) => 0.05 * Math.sin(k / 10) + (k === 50 ? 0.2 * D : 0),
    );
    expect(
      compareRuns(v, run(noisy, 0.02), run(more, 0.02)).channels.steer
        .significant,
    ).toBe(false);
  });
});
