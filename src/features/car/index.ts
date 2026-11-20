import type { FeatureModule } from '../../contracts/app';
import { gtCoupe } from '../../sim-core/content/gt-coupe';
import { doubleWishbone } from '../../sim-core/content/susp-double-wishbone';
import { macpherson } from '../../sim-core/content/susp-macpherson';
import { multilink } from '../../sim-core/content/susp-multilink';
import { DB11_VISUAL_ID, loadDb11 } from './db11/visual';

/** Contributes the GT coupe, its three suspensions (02-04) and the `db11` vehicle visual (03-03). */
export default {
  id: 'car',
  requires: [],
  contribute(r) {
    r.vehicles.register(gtCoupe);
    for (const s of [macpherson, doubleWishbone, multilink]) r.suspensions.register(s);
    r.vehicleVisuals.register({ id: DB11_VISUAL_ID, load: loadDb11 });
  },
} satisfies FeatureModule;
