import type { FeatureModule } from '../../contracts/app';
import { gtCoupe } from '../../sim-core/content/gt-coupe';
import { doubleWishbone } from '../../sim-core/content/susp-double-wishbone';
import { macpherson } from '../../sim-core/content/susp-macpherson';
import { multilink } from '../../sim-core/content/susp-multilink';

/** Contributes the GT coupe and its three suspensions (02-04). The `db11` vehicle visual arrives with plan 03-03. */
export default {
  id: 'car',
  requires: [],
  contribute(r) {
    r.vehicles.register(gtCoupe);
    for (const s of [macpherson, doubleWishbone, multilink]) r.suspensions.register(s);
  },
} satisfies FeatureModule;
