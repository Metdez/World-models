/**
 * GT coupe geometry MEASURED from the hero mesh (assets-src/car/aston-martin-db11.glb) by
 * tests/sim-core/db11-fit.test.ts (tyre-mesh bounding boxes; must match within 5 mm). The mesh is used for its
 * shape only: these are the dimensions of the 3D model, not manufacturer data.
 */
export const GT_GEOMETRY = {
  /** Front to rear wheel-centre distance, m. */
  wheelbase: 2.919,
  /** Height of the wheel centres above the ground plane in the model (statically loaded tyre), m. */
  wheelCentreHeight: 0.376,
  front: {
    /** Wheel-centre to wheel-centre (tyre mid-planes), m. */
    track: 1.694,
    /** Unloaded tyre radius (half the tyre mesh height), m. */
    tyreRadius: 0.382,
  },
  rear: {
    track: 1.694,
    tyreRadius: 0.382,
  },
} as const;
