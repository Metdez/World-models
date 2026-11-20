import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import { createVehicleView, type VehicleView } from './runtime';

let view: VehicleView | undefined;

/** Mounts the vehicle visual + pre-built suspension visuals and keeps them posed from the telemetry frame. */
export default {
  id: 'vehicle-view',
  requires: ['renderer'],
  phase: 'scene',
  async init(ctx) {
    const v = createVehicleView(ctx.registries, { assets: ctx.assets, render: ctx.services.get(RENDER) });
    view = v;
    ctx.addDisposer(() => {
      v.dispose();
      if (view === v) view = undefined;
    });
    const load = () => v.load(ctx.sim.current.vehicle, ctx.sim.current.suspension.id, () => ctx.sim.frame);
    ctx.on('sim:vehicle', () => void load().catch((e: unknown) => console.error('vehicle-view: vehicle load failed', e)));
    ctx.on('sim:suspension', ({ suspensionId }) => v.setSuspension(suspensionId));
    ctx.on('highlight', ({ role, corner, durationMs }) => v.highlight(role, corner, durationMs));
    ctx.watch((s) => v.setXray(s.xray, s.reducedMotion));
    await load();
  },
  update(frame: FrameInfo) {
    view?.update(frame.t, frame.dt);
  },
} satisfies FeatureModule;
