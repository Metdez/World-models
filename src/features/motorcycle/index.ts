import type { FeatureModule } from '../../contracts/app';
import { cafeRacer } from '../../sim-core/content/cafe-racer';
import { motoClassic } from '../../sim-core/content/moto-classic';
import { motoModern } from '../../sim-core/content/moto-modern';
import { motoTelelever } from '../../sim-core/content/moto-telelever';
import { motoPlanarVisual } from './parts/moto-planar';
import { cafeRacerVisual } from './visual/cafe-racer';

/** Contributes the cafe racer, its three suspension presets (05-01) and both procedural visuals (05-02). */
export default {
  id: 'motorcycle',
  requires: [],
  contribute(r) {
    r.vehicles.register(cafeRacer);
    for (const s of [motoClassic, motoModern, motoTelelever]) r.suspensions.register(s);
    r.vehicleVisuals.register(cafeRacerVisual);
    r.suspensionVisuals.register(motoPlanarVisual);
  },
} satisfies FeatureModule;
