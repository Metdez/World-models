/**
 * Same line, different suspension (plan 11-04; ARCHITECTURE-M2 §7.14, §13.3; MD-44). "Compare" (G, or the chip in
 * the drive feature's action row) takes the last stretch of the visitor's manual drive; a disclosed driver model
 * (sim-core ghost/) drives it again headless with the visitor's suspension (the A/A control: how closely the model
 * repeats the visitor) and with another; the visitor's run is then replayed with the other suspension as a translucent
 * ghost in lockstep, and the panel shows distance-aligned traces with one honest sentence. Differences count only
 * above the A/A repeat error; if the model cannot repeat the visitor, the panel says so and draws no conclusion. The
 * driver-model caption is visible whenever the ghost or the traces are. Cleared by a reset, a vehicle or suspension
 * swap, a hand-back or another replay.
 */
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import type { DecodedReplay } from '../../contracts/drive';
import { RENDER, type VehicleVisual } from '../../contracts/services';
import type { SimCatalog } from '../../contracts/sim';
import { SIM_DT } from '../../contracts/units';
import type { DriveHost } from '../../sim-core/drive/control';
import { compareRuns, type Comparison } from '../../sim-core/ghost/compare';
import {
  buildCourse,
  createGhost,
  GHOST_DS,
  MIN_WINDOW_S,
  runGhost,
  type Ghost,
  type GhostCourse,
  type GhostRun,
  type SimFactory,
} from '../../sim-core/ghost/ghost';
import { createSimulation } from '../../sim-core/index';
import { h, mount } from '../../ui/dom';
import { drawChart, drawCursor, layer, readPalette, type ChartPalette } from './chart';
import { COPY, disclosure, sentence } from './copy';
import './ghost-lab.css';
import { drawCalls, prepareGhost } from './visual';

let frameHandler: ((frame: FrameInfo) => void) | undefined;

/** The newest stretch offered for comparison, s (the recorder rounds down to whole seconds: 29 gives <= 30 s). */
const SPAN_S = 29;
/** Recorded driving needed before the chip is offered, s. */
const MIN_RECORDED_S = MIN_WINDOW_S + 1;
/** Target id of the control run (the visitor's own suspension). */
export const CONTROL = 'same';
const CHART_W = 292;

const ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 11.5c2.5 0 3.5-7 6-7s3.5 7 6 7"/><path d="M2 13.5c2.5 0 3.5-7 6-7s3.5 7 6 7" stroke-dasharray="1.6 2" opacity="0.7"/></svg>';

/** The span tick of the last reset or suspension swap inside it (0 = none): replays apply them as cuts / swaps. */
export function lastBreak(span: DecodedReplay): number {
  let t = 0;
  for (const e of span.events) if (e.tick > 0 && (e.kind === 'reset' || e.kind === 'suspension')) t = Math.max(t, e.tick);
  return t;
}

/** The other suspension offered first: the next one in the vehicle's list (no ranking). */
export function defaultTarget(ids: readonly string[], current: string): string {
  const i = ids.indexOf(current);
  return ids.length > 1 ? ids[(i + 1) % ids.length]! : CONTROL;
}

export default {
  id: 'ghost-lab',
  requires: ['renderer'],
  phase: 'scene',

  init(c) {
    const { store, bus } = c;
    const render = c.services.get(RENDER);
    const drive = () => c.sim.current.drive as DriveHost | undefined;
    const catalog: SimCatalog = {
      track: (id) => c.registries.tracks.get(id),
      vehicle: (id) => c.registries.vehicles.get(id),
      suspension: (id) => c.registries.suspensions.get(id),
      world: (trackId) => c.registries.worlds.list().find((w) => w.trackId === trackId),
    };
    const label = (id: string) => c.registries.suspensions.get(id)?.copy.label ?? id;
    const shortLabel = (id: string) => c.registries.suspensions.get(id)?.copy.short ?? id;

    // --- DOM: the chip (adopted into the drive action row) and the panel (right column)
    const icon = h('span', {
      class: 'sl-ghost-lab-icon',
      'aria-hidden': 'true',
    });
    icon.innerHTML = ICON;
    const chipText = h('span', { class: 'sl-drive-action-label' }, COPY.chip);
    const chip = h(
      'button',
      {
        type: 'button',
        class: 'sl-drive-action sl-ghost-lab-chip',
        title: COPY.chipTitle,
        'aria-label': COPY.chip,
        'aria-keyshortcuts': 'G',
        hidden: true,
      },
      icon,
      chipText,
      h('kbd', { class: 'sl-drive-kbd' }, 'G'),
    );
    c.addDisposer(mount(c.dom.overlay, chip));

    const closeBtn = h(
      'button',
      {
        type: 'button',
        class: 'sl-ghost-lab-close',
        'aria-label': COPY.close,
        title: COPY.close,
      },
      '×',
    );
    const aLabel = h('span');
    const bLabel = h('span');
    const legend = h(
      'div',
      { class: 'sl-ghost-lab-legend' },
      h('span', { class: 'sl-ghost-lab-key is-a' }, h('i', { 'aria-hidden': 'true' }), aLabel),
      h('span', { class: 'sl-ghost-lab-key is-b' }, h('i', { 'aria-hidden': 'true' }), bLabel),
    );
    const targets = h('div', {
      class: 'sl-ghost-lab-targets',
      role: 'radiogroup',
      'aria-label': COPY.against,
    });
    const chartCanvas = h('canvas', {
      class: 'sl-ghost-lab-canvas',
      'aria-hidden': 'true',
    });
    const cursorCanvas = h('canvas', {
      class: 'sl-ghost-lab-cursor',
      'aria-hidden': 'true',
    });
    const chartBox = h('div', { class: 'sl-ghost-lab-chart' }, chartCanvas, cursorCanvas, h('span', { class: 'sl-ghost-lab-axis' }, COPY.axis));
    const sentenceEl = h('p', {
      class: 'sl-ghost-lab-sentence',
      'aria-live': 'polite',
    });
    const disclosureEl = h('p', { class: 'sl-ghost-lab-disclosure' });
    const againBtn = h('button', { type: 'button', class: 'sl-ghost-lab-btn' }, COPY.again);
    const playTag = h('span', { class: 'sl-ghost-lab-tag', hidden: true }, COPY.playing);
    const noteEl = h('p', {
      class: 'sl-ghost-lab-note',
      role: 'status',
      hidden: true,
    });
    const panel = h(
      'section',
      {
        class: 'sl-ghost-lab',
        role: 'region',
        'aria-label': COPY.title,
        hidden: true,
      },
      h('div', { class: 'sl-ghost-lab-head' }, h('span', { class: 'sl-ghost-lab-title' }, COPY.title), playTag, closeBtn),
      legend,
      targets,
      chartBox,
      sentenceEl,
      disclosureEl,
      h('div', { class: 'sl-ghost-lab-actions' }, againBtn),
    );
    c.addDisposer(mount(c.dom.overlay, panel));
    c.addDisposer(mount(c.dom.overlay, noteEl));
    const chartLayer = layer(chartCanvas);
    const cursorLayer = layer(cursorCanvas);
    let palette: ChartPalette | null = null;

    // --- state
    let gen = 0; // bumps on every clear / new comparison (stale async work checks it)
    let computing = false;
    let span: DecodedReplay | null = null;
    let course: GhostCourse | null = null;
    let aRun: GhostRun | null = null;
    let target = CONTROL;
    let cmp: Comparison | null = null;
    let live: Ghost | null = null;
    let expectReplay = false; // we asked for a replay: the next mode 'replay' is ours
    let playing = false;
    let noteS = 0;
    let cursorPx = -2;
    let makeSim: SimFactory | null = null;

    // the ghost car: a second instance of the vehicle's own visual, loaded once per vehicle
    let visual: VehicleVisual | null = null;
    let visualFor = '';
    let removeVisual: (() => void) | null = null;
    const dropVisual = () => {
      removeVisual?.();
      visual?.dispose();
      visual = null;
      removeVisual = null;
      visualFor = '';
    };
    c.addDisposer(dropVisual);
    const loadVisual = () => {
      const v = c.sim.current.vehicle;
      if (visualFor === v.id) return;
      dropVisual();
      visualFor = v.id;
      const def = c.registries.vehicleVisuals.get(v.visualKey);
      if (!def) return;
      void def.load(v, { assets: c.assets, render }).then(
        (vis) => {
          if (visualFor !== v.id) return vis.dispose();
          palette ??= readPalette(panel);
          if (!prepareGhost(vis, palette.b)) {
            // over the draw budget or no shell: traces only (§15 fallback)
            vis.dispose();
            panel.dataset.draws = 'none';
            return;
          }
          panel.dataset.draws = String(drawCalls(vis.root));
          vis.root.visible = false;
          visual = vis;
          removeVisual = render.add(vis.root);
        },
        (e: unknown) => console.error('ghost-lab: ghost visual failed to load', e),
      );
    };

    const showNote = (text: string, seconds = 6) => {
      noteEl.textContent = text;
      noteEl.hidden = false;
      noteS = seconds;
    };
    const hideGhost = () => {
      if (visual) visual.root.visible = false;
      chip.dataset.ghost = 'off';
    };
    /** `reason` is kept on the panel (data-cleared) for tests and debugging. */
    const clear = (reason: string) => {
      gen++;
      panel.dataset.cleared = reason;
      computing = false;
      span = null;
      course = null;
      aRun = null;
      cmp = null;
      live = null;
      expectReplay = false;
      playing = false;
      panel.hidden = true;
      playTag.hidden = true;
      hideGhost();
      delete panel.dataset.verdict;
    };
    c.addDisposer(() => clear('dispose'));

    const buildTargets = () => {
      const v = c.sim.current.vehicle;
      targets.replaceChildren(
        ...[...v.suspensions, CONTROL].map((id) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              class: 'sl-ghost-lab-target',
              'data-target': id,
              title: id === CONTROL ? COPY.controlTitle : label(id),
              'aria-checked': String(id === target),
              tabindex: id === target ? '0' : '-1',
            },
            id === CONTROL ? COPY.control : shortLabel(id),
          ),
        ),
      );
    };
    buildTargets();

    /** B run, comparison and panel for the current target. */
    const runTarget = () => {
      if (!course || !aRun || !makeSim) return;
      const control = target === CONTROL;
      const b = control ? aRun : runGhost(course, makeSim, target);
      cmp = compareRuns(course.visitor, aRun, b);
      const a = label(course.suspensionId);
      for (const btn of targets.children) {
        const el = btn as HTMLElement;
        const own = el.dataset.target === course.suspensionId;
        el.hidden = own;
        el.setAttribute('aria-checked', String(el.dataset.target === target));
        el.tabIndex = el.dataset.target === target ? 0 : -1; // one tab stop per radiogroup (roving tabindex)
      }
      aLabel.textContent = `${a} (${control ? COPY.you : COPY.yours})`;
      bLabel.textContent = `${control ? a : label(target)} (${COPY.ghost})`;
      sentenceEl.textContent = sentence(cmp, a, label(target), control);
      disclosureEl.textContent = disclosure(cmp.aaOffset);
      palette ??= readPalette(panel);
      // control: the visitor's own traces against the autopilot with the same suspension (the noise floor itself)
      drawChart(chartLayer, CHART_W, palette, control ? course.visitor : aRun.trace, b.trace, cmp);
      cursorPx = -2;
      drawCursor(cursorLayer, CHART_W, palette, -1, cmp.n);
      panel.dataset.verdict = cmp.verdict;
      panel.dataset.target = target;
      panel.dataset.result = JSON.stringify({
        verdict: cmp.verdict,
        target,
        own: course.suspensionId,
        seconds: course.ticks * SIM_DT,
        metres: course.n * GHOST_DS,
        aaOffset: cmp.aaOffset,
        bOffset: cmp.bOffset,
        steerEffort: cmp.steerEffort,
        order: cmp.order,
        channels: cmp.channels,
      });
      panel.hidden = false;
    };

    /** Replays the span with the ghost in lockstep. */
    const play = () => {
      const d = drive();
      if (!span || !course || !makeSim || !d) return;
      expectReplay = true;
      bus.emit('drive:play', { replay: span });
      if (d.replay?.replay !== span) {
        expectReplay = false;
        return showNote(COPY.unfit);
      }
      live = createGhost(makeSim(target === CONTROL ? course.suspensionId : target), course, false);
    };

    const compute = (sp: DecodedReplay, g: number) => {
      if (g !== gen) return;
      computing = false;
      const sim = c.sim.current;
      const trackId = sim.track.def.id;
      const vehicleId = sim.vehicle.id;
      makeSim = (suspensionId) => createSimulation({ catalog, trackId, vehicleId, suspensionId });
      const crs = buildCourse(sp, makeSim);
      if (typeof crs === 'string') return showNote(crs === 'short' ? COPY.short : COPY.unfit);
      span = sp;
      course = crs;
      aRun = runGhost(crs, makeSim, crs.suspensionId);
      target = defaultTarget(sim.vehicle.suspensions, crs.suspensionId);
      runTarget();
      play();
    };

    const start = () => {
      const d = drive();
      if (computing || store.get().driveMode !== 'manual' || !d || !d.available || d.recordedTicks < MIN_RECORDED_S / SIM_DT) return;
      let sp = d.last(SPAN_S);
      if (!sp) return;
      // a reset or suspension swap inside: only the part after it (its replay then has no cut or swap)
      const brk = lastBreak(sp);
      if (brk > 0) {
        const seconds = Math.floor((sp.header.ticks - brk) * SIM_DT) - 1;
        sp = seconds >= MIN_WINDOW_S ? d.last(seconds) : null;
        if (!sp || lastBreak(sp) > 0) return showNote(COPY.short);
      }
      clear('new');
      loadVisual();
      computing = true;
      const g = gen;
      const run = sp;
      // let the "Comparing…" state paint before the headless runs (about a second of simulation work)
      requestAnimationFrame(() => setTimeout(() => compute(run, g), 0));
    };
    chip.addEventListener('click', start);
    againBtn.addEventListener('click', play);
    closeBtn.addEventListener('click', () => {
      if (playing) bus.emit('drive:request', { mode: 'manual' });
      clear('closed');
    });
    // radiogroup keys: arrows move the selection with focus among the visible targets
    targets.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation(); // arrows here are not driving input
      const list = [...targets.children].filter((b): b is HTMLElement => b instanceof HTMLElement && !b.hidden);
      const i = list.findIndex((b) => b.dataset.target === target);
      const next = list[(i + dir + list.length) % list.length];
      next?.click();
      next?.focus();
    });
    targets.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-target]');
      const id = el?.dataset.target;
      if (!id || id === target || !course || computing) return;
      target = id;
      runTarget();
      // a new replay of the same span (also straight from a playing one: the simulation restarts it)
      play();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.code === 'KeyG' && store.get().driveMode === 'manual') {
        e.preventDefault();
        start();
      } else if (e.key === 'Escape' && !panel.hidden && !playing) clear('closed');
    };
    window.addEventListener('keydown', onKey);
    c.addDisposer(() => window.removeEventListener('keydown', onKey));

    // --- what clears the comparison
    c.on('drive:mode', ({ mode, previous }) => {
      if (mode === 'replay') {
        if (expectReplay) {
          expectReplay = false;
          playing = true;
          playTag.hidden = false;
        } else clear('replay'); // another replay (moment, link)
        return;
      }
      if (previous === 'replay' && playing) {
        playing = false;
        playTag.hidden = true;
        hideGhost();
        drawCursor(cursorLayer, CHART_W, palette!, -1, cmp?.n ?? 1);
        cursorPx = -2;
      }
      if (mode !== 'manual') clear('hand-back'); // returning / auto
    });
    c.on('drive:event', (e) => {
      // a reset at the span's first tick is part of our own replay (a station spawn), not the visitor's
      if (e.kind === 'reset' && !playing && !expectReplay) clear('reset');
    });
    c.on('sim:suspension', () => {
      if (!expectReplay) clear('suspension');
    });
    c.on('sim:vehicle', () => {
      clear('vehicle');
      dropVisual();
      buildTargets();
    });

    const shown = { chip: false, busy: false };
    frameHandler = ({ dt, alpha, t }) => {
      const st = store.get();
      if (noteS > 0) {
        noteS -= dt;
        if (noteS <= 0) noteEl.hidden = true;
      }
      const d = drive();
      const offer = !st.attract && st.hudVisible && st.driveMode === 'manual' && d !== undefined && d.available && d.recordedTicks >= MIN_RECORDED_S / SIM_DT;
      const chipOn = offer || computing;
      if (chipOn !== shown.chip) chip.hidden = !(shown.chip = chipOn);
      if (computing !== shown.busy) {
        shown.busy = computing;
        chipText.textContent = computing ? COPY.computing : COPY.chip;
        chip.disabled = computing;
      }
      const hud = !st.attract && st.hudVisible;
      if (panel.classList.contains('is-off') === hud) panel.classList.toggle('is-off', !hud);

      // the ghost in lockstep with the replay: as many fixed steps as the replay has played since the window start
      const rs = d?.replay;
      if (!playing || !live || !course || !rs || rs.replay !== span) return;
      const k = rs.tick - course.offset;
      while (live.steps < k && live.status === 'running') live.step();
      // never a ghost without its driver-model caption: hidden with the HUD
      const on = hud && k >= 1 && live.status === 'running' && visual !== null;
      if (visual) {
        if (on) visual.update(live.pose(alpha, t.amplification));
        if (visual.root.visible !== on) {
          visual.root.visible = on;
          chip.dataset.ghost = on ? 'on' : 'off';
        }
      }
      if (cmp && palette) {
        const px = k >= 1 && live.status === 'running' ? Math.round((live.s / GHOST_DS / Math.max(1, cmp.n - 1)) * 200) : -1;
        if (px !== cursorPx) {
          cursorPx = px;
          drawCursor(cursorLayer, CHART_W, palette, px < 0 ? -1 : live.s / GHOST_DS, cmp.n);
        }
      }
    };
    c.addDisposer(() => (frameHandler = undefined));
  },

  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
