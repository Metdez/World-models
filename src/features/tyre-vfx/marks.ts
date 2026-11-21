/**
 * Skid marks: laid ONLY while a tyre is past its limit, along the path its contact patch actually travels (so a locked
 * wheel draws straight, a sliding axle draws its arc). The pattern is folio-2025's `Tracks.js` (MIT, (c) 2025 Bruno
 * Simon: a fixed ring of samples, distance-throttled, faded by age) re-expressed for WebGLRenderer + GLSL with
 * CPU-written vertex attributes instead of a data texture: ONE shared ring of quads for every tyre, ONE draw call.
 * Zero allocation per frame: preallocated arrays, two preallocated update ranges per attribute, the oldest quads fade out
 * just before the ring overwrites them. Each quad shares its start edge with the previous quad's end edge (seamless
 * streaks); a streak breaks when the tyre comes back within the limit or the patch jumps (reset, teleport).
 */
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, ShaderMaterial } from 'three';

/** Quads in the shared ring (~600 m of single-tyre mark at the sample spacing). */
export const MARK_SEGMENTS = 4096;
/** Patch travel between samples, m. */
export const MARK_SPACING = 0.15;
/** A jump longer than this between samples (reset, station spawn) starts a new streak, m. */
const MARK_JUMP = 3;
/** Lift above the contact patch, m (plus polygon offset). */
const MARK_LIFT = 0.004;
const VERTS = 6;
const POS = VERTS * 3;
const ATT = VERTS * 3;

const vertexShader = /* glsl */ `
attribute vec3 aMark; // across -1..1, intensity 0..1, sequence number
uniform vec2 uFade;
varying vec3 vMark;
varying float vFade;
void main() {
  vMark = aMark;
  vFade = 1.0 - smoothstep(uFade.x, uFade.y, distance(position, cameraPosition));
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uRubber;
uniform vec3 uRim;
uniform float uSeq;     // next sequence number
uniform float uMinSeq;  // first sequence number since the last clear
uniform float uCount;   // MARK_SEGMENTS
varying vec3 vMark;
varying float vFade;
void main() {
  float seq = vMark.z;
  float age = (uSeq - seq) / uCount;
  if (seq < uMinSeq || age > 1.0) discard;
  float edge = 1.0 - abs(vMark.x);
  float body = smoothstep(0.0, 0.3, edge);
  float rim = smoothstep(0.0, 0.08, edge) * (1.0 - smoothstep(0.1, 0.22, edge));
  float k = vMark.y * vFade * (1.0 - smoothstep(0.8, 1.0, age));
  float a = body * (0.5 + 0.3 * vMark.y) * k;
  // rubber, with a faint warm rim that keeps the streak legible on dark tarmac
  vec3 col = uRim * rim * 0.22 * k;
  gl_FragColor = vec4(col + uRubber * a, a);
  if (gl_FragColor.a < 0.004) discard;
  #include <colorspace_fragment>
}
`;

interface Streak {
  active: boolean;
  hasEdge: boolean;
  /** Last sample, sim frame. */
  x: number;
  y: number;
  z: number;
  /** Start edge (left, right) of the next quad, three frame, and its intensity. */
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  intensity: number;
}

const streak = (): Streak => ({ active: false, hasEdge: false, x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, intensity: 0 });

export interface Marks {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly positions: Float32Array;
  readonly attributes: Float32Array;
  /** Quads written since creation. */
  readonly written: number;
  /** Next ring slot. */
  readonly head: number;
  /**
   * One tyre this frame: contact patch (sim frame), whether it is past the limit, intensity 0..1 and half width (m).
   * Not past = the streak ends.
   */
  feed(tyre: number, x: number, y: number, z: number, past: boolean, intensity: number, halfWidth: number): void;
  /** Ends every streak (mode change, reset) without clearing the marks. */
  breakAll(): void;
  /** Removes every mark (reset, cut, vehicle swap, seek). */
  clear(): void;
  /** Uploads this frame's quads (call once per frame after feed()). */
  flush(): void;
  dispose(): void;
}

export function createMarks(rubber: string, rim: string, tyres = 4): Marks {
  const positions = new Float32Array(MARK_SEGMENTS * POS);
  const attributes = new Float32Array(MARK_SEGMENTS * ATT);
  // unwritten slots: sequence far in the past (discarded by age)
  for (let i = 2; i < attributes.length; i += 3) attributes[i] = -1e9;
  const g = new BufferGeometry();
  const pos = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const att = new BufferAttribute(attributes, 3).setUsage(DynamicDrawUsage);
  g.setAttribute('position', pos);
  g.setAttribute('aMark', att);
  const uniforms = {
    uRubber: { value: new Color(rubber) },
    uRim: { value: new Color(rim) },
    uSeq: { value: 0 },
    uMinSeq: { value: 0 },
    uCount: { value: MARK_SEGMENTS },
    uFade: { value: [30, 90] },
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    fog: false,
  });
  const mesh = new Mesh(g, material);
  mesh.name = 'tyre-vfx:marks';
  mesh.frustumCulled = false; // positions are rewritten in place; bounds are never recomputed
  mesh.renderOrder = 5;
  mesh.visible = false;

  const streaks: Streak[] = [];
  for (let i = 0; i < tyres; i++) streaks.push(streak());
  let seq = 0;
  let head = 0;
  // this frame's contiguous slot ranges (at most two: before and after the wrap)
  const ranges = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  // separate objects per attribute: three may merge (mutate) ranges while uploading
  const posRanges = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  const attRanges = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
  let nRanges = 0;

  function noteSlot(slot: number): void {
    const r = nRanges > 0 ? ranges[nRanges - 1]! : undefined;
    if (r && r.start + r.count === slot) {
      r.count++;
      return;
    }
    if (nRanges === 2) {
      // more than one wrap in a frame (never at sample spacing): upload everything
      ranges[0]!.start = 0;
      ranges[0]!.count = MARK_SEGMENTS;
      nRanges = 1;
      return;
    }
    const n = ranges[nRanges++]!;
    n.start = slot;
    n.count = 1;
  }

  function quad(s: Streak, l1x: number, l1y: number, l1z: number, r1x: number, r1y: number, r1z: number, intensity: number): void {
    const slot = head;
    head = (head + 1) % MARK_SEGMENTS;
    const p = slot * POS;
    // (L0, R0, R1), (L0, R1, L1)
    positions[p] = s.lx;
    positions[p + 1] = s.ly;
    positions[p + 2] = s.lz;
    positions[p + 3] = s.rx;
    positions[p + 4] = s.ry;
    positions[p + 5] = s.rz;
    positions[p + 6] = r1x;
    positions[p + 7] = r1y;
    positions[p + 8] = r1z;
    positions[p + 9] = s.lx;
    positions[p + 10] = s.ly;
    positions[p + 11] = s.lz;
    positions[p + 12] = r1x;
    positions[p + 13] = r1y;
    positions[p + 14] = r1z;
    positions[p + 15] = l1x;
    positions[p + 16] = l1y;
    positions[p + 17] = l1z;
    const a = slot * ATT;
    const i0 = s.intensity;
    // across, intensity, seq per vertex: L0 R0 R1 L0 R1 L1
    attributes[a] = -1;
    attributes[a + 1] = i0;
    attributes[a + 3] = 1;
    attributes[a + 4] = i0;
    attributes[a + 6] = 1;
    attributes[a + 7] = intensity;
    attributes[a + 9] = -1;
    attributes[a + 10] = i0;
    attributes[a + 12] = 1;
    attributes[a + 13] = intensity;
    attributes[a + 15] = -1;
    attributes[a + 16] = intensity;
    for (let v = 0; v < VERTS; v++) attributes[a + v * 3 + 2] = seq;
    seq++;
    noteSlot(slot);
  }

  const api: Marks = {
    mesh,
    positions,
    attributes,
    get written() {
      return seq;
    },
    get head() {
      return head;
    },
    feed(tyre, x, y, z, past, intensity, halfWidth) {
      const s = streaks[tyre];
      if (!s) return;
      if (!past || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        s.active = false;
        return;
      }
      if (!s.active) {
        s.active = true;
        s.hasEdge = false;
        s.x = x;
        s.y = y;
        s.z = z;
        s.intensity = intensity;
        return;
      }
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < MARK_SPACING) return;
      if (d > MARK_JUMP) {
        s.hasEdge = false;
        s.x = x;
        s.y = y;
        s.z = z;
        s.intensity = intensity;
        return;
      }
      // edges perpendicular to the patch's direction of travel (sim frame), then sim -> three (x, z, -y)
      const nx = (-dy / d) * halfWidth;
      const ny = (dx / d) * halfWidth;
      if (!s.hasEdge) {
        s.lx = s.x + nx;
        s.ly = s.z + MARK_LIFT;
        s.lz = -(s.y + ny);
        s.rx = s.x - nx;
        s.ry = s.z + MARK_LIFT;
        s.rz = -(s.y - ny);
        s.hasEdge = true;
      }
      const l1x = x + nx;
      const l1z = -(y + ny);
      const r1x = x - nx;
      const r1z = -(y - ny);
      const h = z + MARK_LIFT;
      quad(s, l1x, h, l1z, r1x, h, r1z, intensity);
      s.lx = l1x;
      s.ly = h;
      s.lz = l1z;
      s.rx = r1x;
      s.ry = h;
      s.rz = r1z;
      s.intensity = intensity;
      s.x = x;
      s.y = y;
      s.z = z;
    },
    breakAll() {
      for (const s of streaks) s.active = false;
    },
    clear() {
      api.breakAll();
      uniforms.uMinSeq.value = seq;
      mesh.visible = false;
    },
    flush() {
      uniforms.uSeq.value = seq;
      if (seq > uniforms.uMinSeq.value) mesh.visible = true;
      if (nRanges === 0) return;
      for (let i = 0; i < nRanges; i++) {
        const r = ranges[i]!;
        const pr = posRanges[i]!;
        const ar = attRanges[i]!;
        pr.start = r.start * POS;
        pr.count = r.count * POS;
        ar.start = r.start * ATT;
        ar.count = r.count * ATT;
        // preallocated range objects (addUpdateRange would allocate one per call)
        pos.updateRanges.push(pr);
        att.updateRanges.push(ar);
      }
      pos.needsUpdate = true;
      att.needsUpdate = true;
      nRanges = 0;
    },
    dispose() {
      g.dispose();
      material.dispose();
    },
  };
  return api;
}
