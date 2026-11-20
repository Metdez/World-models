/**
 * Presenter (ARCHITECTURE §9.2, §12.4), big screen only (`?screen=1`): shows the room code + QR and applies the host's
 * `ctl` state (seq-ordered, only what changed) and cues. Before the host has taken control the card shows the
 * presenter QR (host key in the `#k=` fragment, never in a query string); after the first host command it flips to
 * the audience QR (`/r/CODE`). The presenter can flip back or collapse the card.
 */
import type { FeatureContext, FeatureModule } from '../../contracts/app';
import type { PresenterState } from '../../contracts/net';
import { ROOM } from '../../contracts/services';
import { h, mount } from '../../ui/dom';
import { ctlStep, cueAction, remoteLinks } from './apply';
import './presenter.css';
import { qrSvg } from './qr';

type Mode = 'host' | 'audience';

function init(ctx: FeatureContext): void {
  if (!ctx.flags.screen || ctx.flags.e2e) return; // e2e: no network room (§6.6)
  const { store, bus, registries } = ctx;
  const room = ctx.services.get(ROOM);
  const offered = (id: string) => registries.vehicles.get(id)?.suspensions;

  // ---------------------------------------------------------------- applying the host's controls
  let last: PresenterState | null = null;
  const seekToSection = (id: string) => {
    const sim = ctx.sim.current;
    const section = sim.track.sections.find((s) => s.id === id);
    if (section) bus.emit('sim:seek-to', { lapTime: sim.lapTimeAt(section.s0) });
  };
  const apply = (state: PresenterState): boolean => {
    const step = ctlStep(last, state, store.get().vehicleId, offered);
    if (!step) return false;
    last = state;
    for (const [key, value] of step.patch) (store.setKey as (k: string, v: unknown) => void)(key, value);
    if (step.section) seekToSection(step.section);
    return true;
  };

  ctx.addDisposer(
    room.on('welcome', (m) => {
      if (last && m.ctl.seq < last.seq) last = null; // the room was recreated: start over
      apply(m.ctl);
      if (m.ctl.seq > 0) setMode('audience'); // a host already drove this room
      show();
    }),
  );
  ctx.addDisposer(
    room.on('ctl', (m) => {
      if (apply(m.state)) setMode('audience');
    }),
  );
  ctx.addDisposer(
    room.on('cue', (m) => {
      const vehicleClass = registries.vehicles.get(store.get().vehicleId)?.class ?? 'car';
      const action = cueAction(m.cue, vehicleClass);
      if (action.kind === 'focus') {
        store.setKey('focusCorner', action.corner);
        bus.emit('camera:focus', { corner: action.corner });
      } else seekToSection(last?.section ?? ctx.sim.frame.sectionId);
      bus.emit('room:cue', { cue: m.cue });
    }),
  );

  // ---------------------------------------------------------------- code + QR card
  const title = h('span', { class: 'sl-presenter-title sl-label' });
  const code = h('span', { class: 'sl-presenter-code' });
  const qr = h('div', { class: 'sl-presenter-qr' });
  const url = h('span', { class: 'sl-presenter-url' });
  const note = h('p', { class: 'sl-presenter-note' });
  const flip = h('button', { class: 'sl-presenter-flip', type: 'button' });
  const fold = h('button', { class: 'sl-presenter-fold', type: 'button', 'aria-expanded': 'true' });
  const root = h(
    'section',
    { class: 'sl-presenter', 'aria-label': 'Room code', hidden: true },
    h('header', { class: 'sl-presenter-head' }, title, fold),
    h('div', { class: 'sl-presenter-body' }, qr, h('div', { class: 'sl-presenter-meta' }, code, url), note, flip),
  );
  ctx.addDisposer(mount(ctx.dom.overlay, root));

  let mode: Mode = 'host'; // falls back to the audience code when this screen has no host key
  let folded = false;
  let shown = false;
  let rendered = '';

  function render(): void {
    const c = room.code;
    if (!c) return;
    const links = remoteLinks(location.origin, c, room.hostKey);
    const m: Mode = mode === 'host' && links.host ? 'host' : 'audience';
    root.dataset['mode'] = m;
    root.toggleAttribute('data-folded', folded);
    fold.setAttribute('aria-expanded', String(!folded));
    fold.setAttribute('aria-label', folded ? 'Show room code' : 'Hide room code');
    fold.textContent = folded ? `Join · ${c}` : 'Hide';
    title.textContent = m === 'host' ? 'Presenter remote' : 'Join the lab';
    code.textContent = c;
    url.textContent = m === 'host' ? 'Presenter only' : links.audience.replace(/^https?:\/\//, '');
    note.textContent = m === 'host' ? 'Scan to take control. The audience code appears once you do.' : 'Scan to vote on what runs next.';
    flip.textContent = m === 'host' ? 'Audience code' : 'Presenter remote';
    flip.hidden = !links.host;
    const target = m === 'host' ? links.host! : links.audience;
    if (target !== rendered) {
      rendered = target;
      qr.replaceChildren(qrSvg(target, m === 'host' ? 'QR code: presenter remote' : `QR code: join room ${c}`));
    }
  }
  function setMode(next: Mode): void {
    if (mode === next) return;
    mode = next;
    render();
  }
  function show(): void {
    shown = true;
    root.hidden = !store.get().hudVisible;
    render();
  }

  flip.addEventListener('click', () => setMode(mode === 'host' ? 'audience' : 'host'));
  fold.addEventListener('click', () => {
    folded = !folded;
    render();
  });
  ctx.watch((st) => {
    if (shown) root.hidden = !st.hudVisible;
  });
}

export default { id: 'presenter', requires: ['live-lab'], phase: 'overlay', init } satisfies FeatureModule;
