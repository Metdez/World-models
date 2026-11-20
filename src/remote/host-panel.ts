/** Presenter's phone panel: every control writes a `ctl`/`cue`/`poll` message; the big screen applies it. */
import type { ClientMessage, PollState, PresenterControls, PresenterState } from '../contracts/net';
import { initialState } from '../contracts/store';
import { h } from '../ui/dom';
import { AMPLIFY, CAMERA_CUES, SECTIONS, SPEEDS, VEHICLES, VIEWS, suspensionForOption, suspensionPoll, vehicleOf } from './catalogue';
import { card, pollRows, segmented, shares, toggle, votesText } from './widgets';

const START = initialState();

export interface HostPanel {
  readonly el: HTMLElement;
  ctl(state: PresenterState): void;
  poll(poll: PollState | null): void;
}

export function createHostPanel(send: (message: ClientMessage) => void): HostPanel {
  let ctl: PresenterState = { seq: 0 };
  let poll: PollState | null = null;

  const set = (patch: PresenterControls) => {
    ctl = { ...ctl, ...patch }; // optimistic; the room's broadcast confirms with a new seq
    render();
    send({ t: 'ctl', set: patch });
  };

  const vehicle = segmented('Vehicle', VEHICLES, (id) => {
    const v = vehicleOf(id);
    set({ vehicleId: v.id, suspensionId: v.suspensions[0]!.id });
  });
  const suspensionSlot = h('div');
  let suspension = segmented('Suspension', vehicleOf(undefined).suspensions, (id) => set({ suspensionId: id }));
  let suspensionFor = '';
  const view = segmented('View', VIEWS, (id) => set({ view: id }));
  const speed = segmented('Speed', SPEEDS, (id) => set({ timeScale: id }));
  const xray = toggle('X-ray', 'See the linkage', (on) => set({ xray: on }));
  const amplify = toggle('Amplify', `Motion ×${AMPLIFY}, labelled`, (on) => set({ amplification: on ? AMPLIFY : 1 }));
  const attract = toggle('Attract', 'Self-running show', (on) => set({ attract: on }));
  const lines = toggle('Overlays', 'Roll centres, loads', (on) => set({ overlay: on ? 'engineer' : 'clean' }));

  const sectionButtons = SECTIONS.map((s) => {
    const b = h('button', { type: 'button', class: 'rm-chip', 'aria-pressed': 'false' }, h('span', {}, s.label), h('span', { class: 'rm-chip-sub' }, 'Replay'));
    b.addEventListener('click', () => (ctl.section === s.id ? send({ t: 'cue', cue: 'replay-section' }) : set({ section: s.id })));
    return [s.id, b] as const;
  });
  const cueButtons = CAMERA_CUES.map((c) => {
    const b = h('button', { type: 'button', class: 'rm-button' }, c.label);
    b.addEventListener('click', () => send({ t: 'cue', cue: c.id }));
    return b;
  });

  const pollBody = h('div', { class: 'rm-poll-body' });

  const el = h(
    'div',
    { class: 'rm-panel' },
    card('Vehicle', vehicle.el),
    card('Suspension', suspensionSlot),
    card('View', view.el, h('div', { class: 'rm-grid' }, xray.el, lines.el)),
    card('Motion', speed.el, h('div', { class: 'rm-grid' }, amplify.el, attract.el)),
    card('Camera', h('div', { class: 'rm-grid' }, ...cueButtons)),
    card('Track section', h('p', { class: 'rm-note' }, 'Jump the car to a section. Tap it again to replay.'), h('div', { class: 'rm-chips' }, ...sectionButtons.map(([, b]) => b))),
    card('Audience poll', pollBody),
  );

  function renderPoll(): void {
    const ask = () => send({ t: 'poll', poll: suspensionPoll(ctl.vehicleId) });
    const button = (label: string, onClick: () => void, primary = false) => {
      const b = h('button', { type: 'button', class: primary ? 'rm-button rm-primary' : 'rm-button' }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    if (!poll) {
      const preview = suspensionPoll(ctl.vehicleId);
      pollBody.replaceChildren(
        h('p', { class: 'rm-poll-q' }, preview.question),
        h('p', { class: 'rm-note' }, `${preview.options.join(' · ')}. Bars appear live on the big screen.`),
        button('Open poll', ask, true),
      );
      return;
    }
    const s = shares(poll.counts);
    const head = h('p', { class: 'rm-poll-q' }, poll.question);
    const meta = h('p', { class: 'rm-note' }, `${poll.open ? 'Live' : 'Closed'} · ${votesText(s.total)}`);
    const rows = pollRows(poll.options, poll.counts, null, null);
    if (poll.open) {
      pollBody.replaceChildren(head, meta, rows, button('Close poll', () => send({ t: 'poll', poll: null }), true));
      return;
    }
    const winner = s.leader === null ? null : poll.options[s.leader]!;
    const winnerId = winner ? suspensionForOption(ctl.vehicleId, winner) : null;
    pollBody.replaceChildren(
      head,
      meta,
      rows,
      h(
        'div',
        { class: 'rm-grid' },
        winnerId ? button(`Run ${winner}`, () => set({ suspensionId: winnerId }), true) : null,
        button('New poll', ask, !winnerId),
        button('Clear from screen', () => send({ t: 'poll', poll: null }), false),
      ),
    );
  }

  function render(): void {
    // Fields the presenter has not set yet show the app's start state (contracts/store initialState).
    const v = vehicleOf(ctl.vehicleId);
    vehicle.set(v.id);
    if (suspensionFor !== v.id) {
      suspensionFor = v.id;
      suspension = segmented('Suspension', v.suspensions, (id) => set({ suspensionId: id }));
      suspensionSlot.replaceChildren(suspension.el);
    }
    suspension.set(ctl.suspensionId ?? (v.id === START.vehicleId ? START.suspensionId : v.suspensions[0]!.id));
    view.set(ctl.view ?? START.view);
    speed.set(ctl.timeScale ?? START.timeScale);
    xray.set(ctl.xray);
    lines.set(ctl.overlay === 'engineer');
    amplify.set((ctl.amplification ?? 1) > 1);
    attract.set(ctl.attract);
    for (const [id, b] of sectionButtons) b.setAttribute('aria-pressed', String(ctl.section === id));
    renderPoll();
  }

  render();
  return {
    el,
    ctl(state) {
      if (state.seq < ctl.seq) return;
      ctl = state;
      render();
    },
    poll(next) {
      poll = next;
      renderPoll();
    },
  };
}
