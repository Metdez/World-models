import type { Clock, Registries, SimHost } from '../contracts/app';
import type { AppBus } from '../contracts/events';
import type { Simulation } from '../contracts/sim';
import type { AppStore } from '../contracts/store';
import type { TelemetryFrame } from '../contracts/telemetry';
import { EPOCH_MS, SIM_DT } from '../contracts/units';

/** Kernel-side sim host: the only code that calls setVehicle/setSuspension/seek (§6.4). */
export interface KernelSimHost extends SimHost {
  readonly current: Simulation;
  frame: TelemetryFrame;
  /** Fixed-step accumulator, s (owned by the loop, reset by seeks). */
  acc: number;
  /** Seeks, resets the accumulator and emits `sim:seek`. */
  seek(lapTime: number): void;
  /** Lap time the shared server clock says everyone is at now (§6.5). */
  liveTarget(): number;
  /** One render frame of live-clock tracking: seek if > 0.5 s off, else slew by at most +/-2 % of dt. */
  liveCorrection(dt: number): void;
  dispose(): void;
}

const SEEK_THRESHOLD_S = 0.5;
const SLEW = 0.02;

export function createSimHost(deps: {
  readonly sim: Simulation;
  readonly store: AppStore;
  readonly bus: AppBus;
  readonly clock: Clock;
  readonly registries: Registries;
  readonly warn: (msg: string) => void;
}): KernelSimHost {
  const { sim, store, bus, clock, registries, warn } = deps;
  const vehicleDef = (id: string) => registries.vehicles.get(id);

  const host: KernelSimHost = {
    current: sim,
    frame: sim.sample(0, store.get().amplification),
    acc: 0,
    seek(lapTime) {
      sim.seek(lapTime);
      host.acc = 0;
      bus.emit('sim:seek', { lapTime: sim.lapTime });
    },
    liveTarget() {
      const d = sim.lapDuration;
      return ((((clock.serverNow() - EPOCH_MS) / 1000) % d) + d) % d;
    },
    liveCorrection(dt) {
      const d = sim.lapDuration;
      const diff = host.liveTarget() - (sim.lapTime + host.acc);
      const err = ((((diff + d / 2) % d) + d) % d) - d / 2; // wrapped to half a lap
      if (Math.abs(err) > SEEK_THRESHOLD_S) host.seek(host.liveTarget());
      else host.acc += Math.max(-SLEW * dt, Math.min(SLEW * dt, err));
    },
    dispose() {
      unlisten();
      bus.off('sim:seek-to', onSeekTo);
    },
  };

  const onSeekTo = ({ lapTime }: { lapTime: number }) => {
    if (store.get().clock !== 'local') store.setKey('clock', 'local');
    host.seek(lapTime);
  };
  bus.on('sim:seek-to', onSeekTo);

  // nanostores queues setKey calls made inside a listener, so reverts/write-backs below re-enter as separate changes.
  const unlisten = store.listen((st, old, key) => {
    switch (key) {
      case 'vehicleId': {
        if (st.vehicleId === sim.vehicle.id) return;
        const def = vehicleDef(st.vehicleId);
        const keep = !def || def.suspensions.includes(st.suspensionId);
        try {
          sim.setVehicle(st.vehicleId, keep ? st.suspensionId : undefined);
        } catch (e) {
          warn(`Cannot switch to vehicle "${st.vehicleId}": ${e instanceof Error ? e.message : String(e)}`);
          store.setKey('vehicleId', old?.vehicleId ?? sim.vehicle.id);
          return;
        }
        host.frame = sim.sample(host.acc / SIM_DT, st.amplification);
        store.setKey('suspensionId', sim.suspension.id);
        bus.emit('sim:vehicle', { vehicleId: sim.vehicle.id, suspensionId: sim.suspension.id });
        return;
      }
      case 'suspensionId': {
        const previous = sim.suspension.id;
        if (st.suspensionId === previous) return;
        const def = vehicleDef(sim.vehicle.id);
        try {
          if (def && !def.suspensions.includes(st.suspensionId)) throw new Error(`not offered for "${def.id}"`);
          sim.setSuspension(st.suspensionId);
        } catch (e) {
          warn(`Rejected suspension "${st.suspensionId}": ${e instanceof Error ? e.message : String(e)}`);
          store.setKey('suspensionId', previous);
          return;
        }
        bus.emit('sim:suspension', { suspensionId: st.suspensionId, previous });
        return;
      }
      case 'paused':
      case 'timeScale':
        if ((st.paused || st.timeScale !== 1) && st.clock !== 'local') store.setKey('clock', 'local');
        return;
      case 'clock':
        if (st.clock === 'live') host.seek(host.liveTarget());
        return;
    }
  });

  return host;
}
