/**
 * AI Race Engineer panel (ARCHITECTURE §12.5, plan 06-02): a small "Ask the engineer" affordance with three
 * section-dependent question chips and "Why did it do that?". Sends a compact telemetry snapshot to
 * POST /api/engineer, shows the answer as a caption card (textContent only) and executes whitelisted actions
 * through the store and bus. Offline / busy / error -> the local rule-based answer, labelled as such.
 */
import type { FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { EngineerAction, EngineerResponse, EngineerTurn } from '../../contracts/engineer';
import { API, NET_LIMITS } from '../../contracts/net';
import type { CornerId } from '../../contracts/units';
import { h, mount } from '../../ui/dom';
import './engineer.css';
import { ruleAnswer } from './rules';
import { buildTelemetry, CHIPS, SnapshotRing, type Snap } from './snapshot';

const SAMPLE_S = 0.1;
const RING = 20; // 2 s at 10 Hz
const WHY_WINDOW_S = 1;
const REQUEST_TIMEOUT_MS = 12_000;
const HIGHLIGHT_MS = 4000;
const WHY = 'Why did it do that?';

let ctx: FeatureContext | undefined;
let ring: SnapshotRing | undefined;
let lastSample = -Infinity;
let shownSection = -1;
let chipRow: HTMLElement | undefined;
let pending: AbortController | undefined;
const history: EngineerTurn[] = [];

function clientId(): string {
  const key = 'sl-client-id';
  try {
    const id = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function resetRing(c: FeatureContext): void {
  ring = new SnapshotRing(RING, c.sim.frame.corners.map((k) => k.id));
  lastSample = -Infinity;
}

function sectionOf(c: FeatureContext, index: number) {
  return c.sim.current.track.sections[index];
}

function payload(c: FeatureContext, snap: Snap) {
  const sim = c.sim.current;
  const section = sectionOf(c, snap.sectionIndex);
  const k = sim.kinematics();
  return buildTelemetry(snap, ring!.cornerIds, {
    vehicleClass: sim.vehicle.class,
    vehicleId: sim.vehicle.id,
    suspensionId: sim.suspension.id,
    sectionId: section?.id ?? 'unknown',
    sectionName: section?.def.name ?? 'Track',
    summaries: { front: k.front.summary, rear: k.rear.summary },
  });
}

/** Whitelisted dispatcher: only store keys and contract events; every argument re-checked against live content. */
function execute(c: FeatureContext, a: EngineerAction): void {
  const corners = c.sim.frame.corners.map((k) => k.id);
  const okCorner = (k: CornerId | 'all' | undefined): k is CornerId => k !== undefined && k !== 'all' && corners.includes(k);
  switch (a.tool) {
    case 'switch_suspension':
      if (c.sim.current.vehicle.suspensions.includes(a.args.id)) c.store.setKey('suspensionId', a.args.id);
      break;
    case 'set_view':
      c.store.setKey('view', a.args.view);
      if (okCorner(a.args.corner)) {
        c.store.setKey('focusCorner', a.args.corner);
        c.bus.emit('camera:focus', { corner: a.args.corner });
      }
      break;
    case 'set_slow_motion':
      c.store.setKey('timeScale', Math.min(1, Math.max(0.1, a.args.scale)));
      break;
    case 'highlight_component':
      if (a.args.corner === 'all' || okCorner(a.args.corner)) c.bus.emit('highlight', { role: a.args.component, corner: a.args.corner, durationMs: HIGHLIGHT_MS });
      break;
    case 'jump_to_section': {
      const s = c.sim.current.track.sections.find((x) => x.id === a.args.section);
      if (s) c.bus.emit('sim:seek-to', { lapTime: c.sim.current.lapTimeAt(s.s0) });
      break;
    }
  }
}

function isResponse(v: unknown): v is EngineerResponse {
  const r = v as EngineerResponse | null;
  return typeof r?.text === 'string' && Array.isArray(r.actions) && (r.source === 'model' || r.source === 'fallback');
}

const engineer: FeatureModule = {
  id: 'engineer',
  requires: [],
  phase: 'overlay',

  init(c) {
    ctx = c;
    resetRing(c);
    c.on('sim:vehicle', () => resetRing(c));
    const id = clientId();

    const text = h('p', { class: 'sl-engineer-text' });
    const badge = h('span', { class: 'sl-engineer-badge sl-label', hidden: true });
    const answer = h('div', { class: 'sl-engineer-answer', 'aria-live': 'polite', hidden: true }, text, badge);
    chipRow = h('div', { class: 'sl-engineer-chips' });
    const input = h('input', { class: 'sl-engineer-input', type: 'text', maxlength: NET_LIMITS.engineerQuestionChars, placeholder: 'Ask about the suspension…', 'aria-label': 'Question for the race engineer' });
    const send = h('button', { class: 'sl-engineer-send', type: 'submit', 'aria-label': 'Ask' }, '↵');
    const form = h('form', { class: 'sl-engineer-form' }, input, send);
    const why = h('button', { class: 'sl-engineer-why', type: 'button' }, WHY);
    const panel = h('section', { class: 'sl-engineer-panel', id: 'sl-engineer-panel', 'aria-label': 'Race engineer', hidden: true }, answer, why, chipRow, form);
    const toggle = h('button', { class: 'sl-engineer-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sl-engineer-panel' }, 'Ask the engineer');
    const root = h('div', { class: 'sl-engineer' }, panel, toggle);
    c.addDisposer(mount(c.dom.overlay, root));

    const show = (msg: string, label: string | null, busy = false) => {
      answer.hidden = false;
      answer.classList.toggle('is-busy', busy);
      text.textContent = msg;
      badge.hidden = label === null;
      badge.textContent = label ?? '';
    };

    async function ask(question: string, snap: Snap | undefined): Promise<void> {
      if (!snap) return;
      const telemetry = payload(c, snap);
      const phenomenon = sectionOf(c, snap.sectionIndex)?.def.phenomenon;
      const local = (label: string) => show(ruleAnswer(question, phenomenon, telemetry), label);
      pending?.abort();
      const ctl = new AbortController();
      pending = ctl;
      const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
      show('Thinking…', null, true);
      try {
        const res = await fetch(API.engineer, {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-client-id': id },
          body: JSON.stringify({ question, telemetry, history: history.slice(-NET_LIMITS.engineerHistoryMax) }),
        });
        const body: unknown = res.ok ? await res.json() : undefined;
        if (pending !== ctl) return;
        if (res.status === 429) return local('Engineer busy · rule-based answer');
        if (!isResponse(body)) return local('Offline · rule-based answer');
        show(body.text, body.source === 'fallback' ? 'Rule-based answer' : null);
        history.push({ role: 'user', content: question }, { role: 'assistant', content: body.text.slice(0, NET_LIMITS.engineerHistoryChars) });
        history.splice(0, Math.max(0, history.length - NET_LIMITS.engineerHistoryMax));
        for (const a of body.actions.slice(0, 2)) execute(c, a);
      } catch {
        if (pending === ctl) local('Offline · rule-based answer');
      } finally {
        clearTimeout(timer);
        if (pending === ctl) pending = undefined;
      }
    }

    const askNow = (q: string) => void ask(q, ring?.latest());
    why.addEventListener('click', () => {
      const now = performance.now() / 1000;
      void ask(WHY, ring?.peak(now - WHY_WINDOW_S));
    });
    chipRow.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('button');
      if (chip?.textContent) askNow(chip.textContent);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) askNow(q);
      input.value = '';
    });
    toggle.addEventListener('click', () => c.store.setKey('engineerOpen', !c.store.get().engineerOpen));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        c.store.setKey('engineerOpen', false);
        toggle.focus();
      }
    });
    c.watch((s) => {
      panel.hidden = !s.engineerOpen;
      toggle.setAttribute('aria-expanded', String(s.engineerOpen));
      root.classList.toggle('is-open', s.engineerOpen);
      root.hidden = !s.hudVisible || s.attract; // H and attract mode hide it with the rest of the HUD
    });
    c.addDisposer(() => {
      pending?.abort();
      ctx = undefined;
      ring = undefined;
      chipRow = undefined;
      shownSection = -1;
      history.length = 0;
    });
  },

  update(frame: FrameInfo) {
    if (!ctx || !ring) return;
    if (frame.time - lastSample >= SAMPLE_S) {
      lastSample = frame.time;
      ring.push(frame.t, frame.time);
    }
    if (chipRow && frame.t.sectionIndex !== shownSection) {
      shownSection = frame.t.sectionIndex;
      const phenomenon = sectionOf(ctx, shownSection)?.def.phenomenon;
      chipRow.replaceChildren(...(phenomenon ? CHIPS[phenomenon] : []).map((q) => h('button', { class: 'sl-engineer-chip', type: 'button' }, q)));
    }
  },
};

export default engineer;
