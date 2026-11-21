import type { FeatureModule } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import './debug.css';

let stats: import('stats-gl').default | undefined;

/** `?debug=1`: stats-gl panel (07-01 adds the feature list). */
export default {
  id: 'debug',
  requires: ['renderer'],
  phase: 'overlay',
  defaultEnabled: false,
  async init(ctx) {
    const { renderer } = ctx.services.get(RENDER);
    const originalRender = renderer.render;
    // Debug only (?debug=1): stats-gl stays out of the main bundle.
    const { default: Stats } = await import('stats-gl');
    const panel = new Stats({ trackGPU: false });
    stats = panel;
    // stats-gl wraps renderer.render to time it; put the original back on dispose.
    ctx.addDisposer(() => {
      renderer.render = originalRender;
      panel.dom.remove();
      panel.dispose();
      stats = undefined;
    });
    panel.dom.classList.add('sl-debug-stats');
    ctx.dom.overlay.append(panel.dom);
    await panel.init(renderer);
  },
  update() {
    stats?.update();
  },
} satisfies FeatureModule;
