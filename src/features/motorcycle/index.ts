import type { FeatureModule } from '../../contracts/app';
import type { VehicleVisualDefinition } from '../../contracts/services';
import { cafeRacer } from '../../sim-core/content/cafe-racer';
import { motoClassic } from '../../sim-core/content/moto-classic';
import { motoModern } from '../../sim-core/content/moto-modern';
import { motoTelelever } from '../../sim-core/content/moto-telelever';
import { motoPlanarVisual } from './parts/moto-planar';

/**
 * Contributes the cafe racer, its three suspension presets (05-01) and both procedural visuals (05-02).
 * The body visual is loaded on first use (its own chunk): a car-only session never downloads it.
 */
const lazyCafeRacerVisual: VehicleVisualDefinition = {
  id: cafeRacer.visualKey,
  load: (vehicle, ctx) => import('./visual/cafe-racer').then((m) => m.cafeRacerVisual.load(vehicle, ctx)),
};

export default {
  id: 'motorcycle',
  requires: [],
  contribute(r) {
    r.vehicles.register(cafeRacer);
    for (const s of [motoClassic, motoModern, motoTelelever]) r.suspensions.register(s);
    r.vehicleVisuals.register(lazyCafeRacerVisual);
    r.suspensionVisuals.register(motoPlanarVisual);
  },
} satisfies FeatureModule;
