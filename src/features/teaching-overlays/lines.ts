/**
 * Preallocated fat-line batch (three's LineSegments2): one instanced draw per layer, endpoints written in place.
 * `casing` adds a wider multiply-blended dark halo under the additive colour line so strokes read on sky and asphalt
 * alike; both layers share the position buffer. Colour 0 = invisible (additive), so fades are colour ramps.
 */
import { AdditiveBlending, DynamicDrawUsage, InstancedInterleavedBuffer, InterleavedBufferAttribute, MultiplyBlending, NormalBlending } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

export interface LineBatchOptions {
  readonly capacity: number;
  /** Colour stroke width, CSS px. */
  readonly width: number;
  /** Casing width, CSS px (0 = no casing). */
  readonly casing: number;
  /** Casing darkening at full colour, 0..1. */
  readonly casingStrength?: number;
  /** Normal-blended with this opacity instead of additive (ghost layer). */
  readonly opacity?: number;
  readonly renderOrder: number;
  readonly name: string;
}

export interface LineBatch {
  readonly objects: readonly LineSegments2[];
  /** Segments written since begin(). */
  readonly count: number;
  readonly capacity: number;
  /** Positions of the colour layer (three frame, 6 floats per segment), for tests. */
  readonly positions: Float32Array;
  begin(): void;
  /** One segment from SIM-frame endpoints a → b with per-end colours (linear rgb; additive layers: 0 = invisible). */
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, g0: number, b0: number, r1: number, g1: number, b1: number): void;
  /** Uploads what was written; hides the layer when empty. */
  end(): void;
  setResolution(width: number, height: number): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

function layer(geometry: LineSegmentsGeometry, material: LineMaterial, renderOrder: number, name: string): LineSegments2 {
  const o = new LineSegments2(geometry, material);
  o.name = name;
  o.renderOrder = renderOrder;
  o.frustumCulled = false; // positions change every frame; bounds are never recomputed
  return o;
}

export function createLineBatch(opts: LineBatchOptions): LineBatch {
  const cap = opts.capacity;
  const positions = new Float32Array(cap * 6);
  const colours = new Float32Array(cap * 6);
  const casingColours = new Float32Array(cap * 6);
  const posBuf = new InstancedInterleavedBuffer(positions, 6, 1).setUsage(DynamicDrawUsage);
  const colBuf = new InstancedInterleavedBuffer(colours, 6, 1).setUsage(DynamicDrawUsage);
  const casBuf = new InstancedInterleavedBuffer(casingColours, 6, 1).setUsage(DynamicDrawUsage);

  const geometry = (col: InstancedInterleavedBuffer): LineSegmentsGeometry => {
    const g = new LineSegmentsGeometry();
    g.setAttribute('instanceStart', new InterleavedBufferAttribute(posBuf, 3, 0));
    g.setAttribute('instanceEnd', new InterleavedBufferAttribute(posBuf, 3, 3));
    g.setAttribute('instanceColorStart', new InterleavedBufferAttribute(col, 3, 0));
    g.setAttribute('instanceColorEnd', new InterleavedBufferAttribute(col, 3, 3));
    g.instanceCount = 0;
    return g;
  };

  const common = { vertexColors: true, depthTest: false, depthWrite: false, transparent: true, fog: false } as const;
  const additive = opts.opacity === undefined;
  const colourMat = new LineMaterial({
    ...common,
    linewidth: opts.width,
    ...(additive ? { blending: AdditiveBlending } : { blending: NormalBlending, opacity: opts.opacity }),
  });
  const colourGeo = geometry(colBuf);
  const objects: LineSegments2[] = [];
  let casingGeo: LineSegmentsGeometry | undefined;
  let casingMat: LineMaterial | undefined;
  if (opts.casing > 0) {
    casingGeo = geometry(casBuf);
    casingMat = new LineMaterial({ ...common, linewidth: opts.casing, blending: MultiplyBlending, premultipliedAlpha: true });
    objects.push(layer(casingGeo, casingMat, opts.renderOrder, `${opts.name}:casing`));
  }
  objects.push(layer(colourGeo, colourMat, opts.renderOrder + 1, opts.name));
  const strength = opts.casingStrength ?? 0.6;

  let n = 0;
  const batch: LineBatch = {
    objects,
    get count() {
      return n;
    },
    capacity: cap,
    positions,
    begin() {
      n = 0;
    },
    seg(ax, ay, az, bx, by, bz, r0, g0, b0, r1, g1, b1) {
      if (n >= cap) return;
      // Never let a non-finite value reach the GPU (it would blank the whole instanced draw on some drivers).
      if (!Number.isFinite(ax + ay + az + bx + by + bz)) return;
      const o = n * 6;
      // sim (x, y, z) -> three (x, z, -y), units.ts simToThree
      positions[o] = ax;
      positions[o + 1] = az;
      positions[o + 2] = -ay;
      positions[o + 3] = bx;
      positions[o + 4] = bz;
      positions[o + 5] = -by;
      colours[o] = r0;
      colours[o + 1] = g0;
      colours[o + 2] = b0;
      colours[o + 3] = r1;
      colours[o + 4] = g1;
      colours[o + 5] = b1;
      // Casing darkens in proportion to the colour's presence, so faded colour ends lose their halo too.
      const c0 = 1 - strength * Math.min(1, Math.max(r0, g0, b0));
      const c1 = 1 - strength * Math.min(1, Math.max(r1, g1, b1));
      casingColours[o] = casingColours[o + 1] = casingColours[o + 2] = c0;
      casingColours[o + 3] = casingColours[o + 4] = casingColours[o + 5] = c1;
      n++;
    },
    end() {
      colourGeo.instanceCount = n;
      if (casingGeo) casingGeo.instanceCount = n;
      posBuf.needsUpdate = true;
      colBuf.needsUpdate = true;
      casBuf.needsUpdate = true;
      for (const o of objects) o.visible = n > 0;
    },
    setResolution(w, h) {
      colourMat.resolution.set(w, h);
      casingMat?.resolution.set(w, h);
    },
    setVisible(on) {
      for (const o of objects) o.visible = on && n > 0;
    },
    dispose() {
      colourGeo.dispose();
      colourMat.dispose();
      casingGeo?.dispose();
      casingMat?.dispose();
    },
  };
  return batch;
}
