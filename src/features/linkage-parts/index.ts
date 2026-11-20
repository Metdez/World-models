import type { FeatureModule } from '../../contracts/app';
import { buildSpatialLinkage, VISUAL_ID } from './visual';

/** Contributes the procedural car suspension visual; `vehicle-view` builds, shows and updates it. */
export default {
  id: 'linkage-parts',
  requires: [],
  contribute(registries) {
    registries.suspensionVisuals.register({ id: VISUAL_ID, build: (suspension, vehicle) => buildSpatialLinkage(suspension, vehicle) });
  },
} satisfies FeatureModule;
