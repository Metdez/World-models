/**
 * Live Lab (ARCHITECTURE §9.2, §12.4): the ROOM service, server-time sync for the shared lap clock, and a small
 * presence readout ("N in the lab" + which suspension people are running). Only picks travel over the wire,
 * never positions: everyone computes the same car position from the synced clock.
 * Offline, blocked or `?e2e=1`: the service exists with `connected: false` and the readout stays hidden.
 */
import type { FeatureContext, FeatureModule } from '../../contracts/app';
import { PUBLIC_ROOM, type PresenceSnapshot } from '../../contracts/net';
import { ROOM } from '../../contracts/services';
import type { RoomStatus } from '../../contracts/store';
import { mount } from '../../ui/dom';
import './live-lab.css';
import { segments } from './presence';
import { createRoomConnection, type RoomTarget } from './room-service';
import { createPresenceView } from './view';

const CLIENT_ID_KEY = 'sl-client-id';

function clientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const OFFLINE: RoomStatus = { code: null, role: null, connected: false, viewers: 0, dist: {} };

function init(ctx: FeatureContext): void {
  const { store } = ctx;
  const view = createPresenceView();
  const setRoom = (patch: Partial<RoomStatus>) => store.setKey('room', { ...store.get().room, ...patch });
  const connection = createRoomConnection({
    origin: location.origin,
    clientId: ctx.flags.e2e ? 'e2e' : clientId(),
    clock: ctx.clock,
    pick: () => ({ vehicleId: store.get().vehicleId, suspensionId: store.get().suspensionId }),
    onStatus: (connected) => {
      setRoom({ code: connection.service.code, role: connection.service.role, connected });
      if (!connected) view.hide();
    },
  });
  ctx.services.provide(ROOM, connection.service);
  ctx.addDisposer(() => connection.dispose());
  store.setKey('room', OFFLINE);
  if (ctx.flags.e2e) return; // deterministic tests: no network room (§6.6)

  ctx.addDisposer(mount(ctx.dom.overlay, view.root));

  const labelOf = (suspensionId: string) => ctx.registries.suspensions.get(suspensionId)?.copy.short ?? suspensionId;
  const showPresence = (p: PresenceSnapshot) => {
    setRoom({ viewers: p.viewers, dist: p.dist });
    const { vehicleId, suspensionId } = store.get();
    view.render(p.viewers, segments(p.dist, `${vehicleId}:${suspensionId}`, labelOf));
  };
  ctx.addDisposer(connection.service.on('welcome', (m) => showPresence(m.presence)));
  ctx.addDisposer(connection.service.on('presence', (m) => showPresence(m)));

  // Picks follow actual simulation swaps (the kernel may reject an invalid store write).
  ctx.on('sim:suspension', () => connection.schedulePick());
  ctx.on('sim:vehicle', () => connection.schedulePick());

  const onVisible = () => document.visibilityState === 'visible' && connection.resync();
  document.addEventListener('visibilitychange', onVisible);
  ctx.addDisposer(() => document.removeEventListener('visibilitychange', onVisible));

  const target: RoomTarget | 'create-screen-room' =
    ctx.flags.screen && !ctx.flags.room
      ? 'create-screen-room'
      : { code: ctx.flags.room ?? PUBLIC_ROOM, role: ctx.flags.screen ? 'screen' : 'viewer', hostKey: null };
  // Not awaited: the app never waits for the network.
  void connection.start(target);
}

export default { id: 'live-lab', requires: [], phase: 'overlay', init } satisfies FeatureModule;
