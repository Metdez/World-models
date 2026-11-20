import { Group, Vector2 } from 'three';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import { mount } from '../../ui/dom';
import { createConstruction } from './construction';
import { createLineBatch } from './lines';
import { createTracePanel, type AxlePlot, type TraceMetric } from './trace';
import './teaching-overlays.css';

const PANEL_DT = 1 / 30;

let tick: ((frame: FrameInfo) => void) | undefined;

/**
 * Engineer layer (store.overlay === 'engineer'; entering close-up switches it on): live front-view construction,
 * ghost rest pose, load arrows and the camber trace. Geometry follows the (possibly amplified) POSE fields; every
 * number shown is a TRUE value from the frame.
 */
export default {
  id: 'teaching-overlays',
  requires: ['renderer'],
  phase: 'scene',
  init(ctx) {
    const render = ctx.services.get(RENDER);
    const main = createLineBatch({ capacity: 1600, width: 2, casing: 5.5, renderOrder: 40, name: 'teaching-overlays:construction' });
    const ghost = createLineBatch({ capacity: 600, width: 1.5, casing: 0, opacity: 0.55, renderOrder: 38, name: 'teaching-overlays:ghost' });
    const group = new Group();
    group.name = 'teaching-overlays';
    group.visible = false;
    group.add(...ghost.objects, ...main.objects);
    ctx.addDisposer(render.add(group));
    ctx.addDisposer(() => {
      main.dispose();
      ghost.dispose();
    });
    const construction = createConstruction(main, ghost);
    const panel = createTracePanel();
    ctx.addDisposer(mount(ctx.dom.overlay, panel.root));

    const metric = (): TraceMetric => (ctx.sim.current.vehicle.class === 'car' ? 'camber' : 'motionRatio');
    const curves = (previous: readonly (AxlePlot | null)[] | null, label: string) =>
      panel.setCurves(ctx.sim.current.kinematics(), metric(), previous, label);
    curves(null, '');
    ctx.on('sim:suspension', ({ previous }) => {
      curves(panel.plots, ctx.registries.suspensions.get(previous)?.copy.label ?? '');
      construction.reset();
    });
    ctx.on('sim:vehicle', () => {
      curves(null, '');
      construction.reset();
    });
    ctx.on('sim:seek', () => construction.reset());

    let active = false;
    let view: string | undefined;
    ctx.watch((s) => {
      // Close-up defaults the engineer layer on (on entering it); the user can switch it off again there.
      if (s.view === 'closeup' && view !== 'closeup' && s.overlay !== 'engineer') {
        view = s.view;
        ctx.store.setKey('overlay', 'engineer');
        return;
      }
      view = s.view;
      const on = s.overlay === 'engineer';
      if (on && !active) construction.reset();
      active = on;
      group.visible = on;
      panel.setVisible(on && s.hudVisible);
    });

    const size = new Vector2();
    let panelClock = PANEL_DT;
    tick = (frame) => {
      if (!active) return;
      render.renderer.getSize(size);
      main.setResolution(size.x, size.y);
      ghost.setResolution(size.x, size.y);
      construction.draw(frame.t, ctx.sim.current, frame.dt);
      panelClock += frame.dt;
      if (panelClock >= PANEL_DT) {
        panelClock = 0;
        panel.draw(frame.t);
      }
    };
    ctx.addDisposer(() => {
      tick = undefined;
    });
  },
  update(frame: FrameInfo) {
    tick?.(frame);
  },
} satisfies FeatureModule;
