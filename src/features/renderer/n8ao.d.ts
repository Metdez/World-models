// n8ao 2.1.0 ships no type declarations; only the surface the renderer uses (checked against node_modules/n8ao/src).
declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    readonly configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
