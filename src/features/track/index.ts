import type { FeatureModule } from '../../contracts/app';
import { provingLoop } from '../../sim-core/content/proving-loop';

/** Contributes the proving loop (02-04). The track mesh (ribbon, kerbs, markings, terrain) arrives with plan 03-01. */
export default {
  id: 'track',
  requires: ['renderer'],
  phase: 'scene',
  contribute(r) {
    r.tracks.register(provingLoop);
  },
} satisfies FeatureModule;
