/**
 * Friction rings: one instanced quad per corner on the car's road plane at the contact patch, drawn by a signed-distance
 * fragment shader (research m2/19 §6). One draw call for all four, plus one faint x-ray draw for the parts the car
 * body hides. Strokes are pixel-constant (fwidth) with a dark
 * casing so they read on dark tarmac, wet tiles and painted lines alike; the whole ring fades with camera distance.
 * Within the limit: neutral ink ring, filled dot, a thin line from the centre to the dot.
 * Past the limit (warn level 1): warn colour, the ring breaks into dashes and the dot opens into a circle: colour is
 * never the only cue.
 */
import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  GreaterDepth,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  ShaderMaterial,
} from 'three';

export const RING_CORNERS = 4;
/** Stride of the per-instance float data (see RingWriter.write). */
const I_STRIDE = 13;

const vertexShader = /* glsl */ `
attribute vec2 corner;
attribute vec3 iCentre;
attribute vec3 iFwd;
attribute vec3 iLeft;
attribute vec4 iRing; // radius (m), dot x, dot y (m, wheel frame), warn 0..1
uniform float uLift;
uniform vec2 uFade;
varying vec2 vP;
varying vec4 vRing;
varying float vFade;
void main() {
  float r = iRing.x;
  float ext = r * 1.4 + 0.09;
  vP = corner * ext;
  vec3 up = normalize(cross(iFwd, iLeft));
  vec3 world = iCentre + iFwd * vP.x + iLeft * vP.y + up * uLift;
  vRing = iRing;
  vFade = (1.0 - smoothstep(uFade.x, uFade.y, distance(world, cameraPosition))) * step(0.001, r);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uWarn;
uniform float uOpacity;
varying vec2 vP;
varying vec4 vRing;
varying float vFade;
float cover(float d, float halfWidth, float px) { return 1.0 - smoothstep(halfWidth - 0.5 * px, halfWidth + 0.5 * px, d); }
float segDist(vec2 p, vec2 b) {
  float l2 = dot(b, b);
  float h = l2 > 0.0 ? clamp(dot(p, b) / l2, 0.0, 1.0) : 0.0;
  return length(p - b * h);
}
void main() {
  if (vFade <= 0.0) discard;
  float r = vRing.x;
  vec2 dotP = vRing.yz;
  float warn = vRing.w;
  float len = length(vP);
  float px = max(fwidth(vP.x), fwidth(vP.y));
  float w = max(0.007, 0.75 * px);          // stroke half width: >= 1.5 px
  // ring, dashed past the limit (10 dashes, 60 % on)
  float dRing = abs(len - r);
  float turns = atan(vP.y, vP.x) * (10.0 / 6.2831853) + 0.25;
  float along = abs(fract(turns) - 0.5) * (6.2831853 * r / 10.0); // m from the dash centre
  float dash = mix(1.0, cover(along, 0.3 * 6.2831853 * r / 10.0, px), warn);
  float ring = cover(dRing, w, px) * dash;
  float ringCase = cover(dRing, w + 1.6 * px, px) * dash;
  // dot: filled within the limit, open past it
  float dd = length(vP - dotP);
  float dotR = max(0.028, 2.2 * px);
  float filled = cover(dd, dotR, px);
  float open = cover(abs(dd - dotR * 1.5), w, px);
  float dotC = mix(filled, open, warn);
  float dotCase = cover(dd, dotR * (1.0 + 0.5 * warn) + w + 1.6 * px, px);
  // line from the centre to the dot
  float dl = segDist(vP, dotP);
  float line = cover(dl, 0.6 * w, px) * 0.75 * step(dotR, length(dotP));
  float lineCase = cover(dl, 0.6 * w + 1.4 * px, px) * step(dotR, length(dotP));
  // faint disc inside the ring: the budget reads as an area
  float fill = (1.0 - smoothstep(r - px, r, len)) * 0.10;
  float stroke = max(max(ring, dotC), line);
  float shade = max(max(max(ringCase, dotCase), lineCase) * 0.55, fill);
  vec3 col = mix(uInk, uWarn, warn);
  float a = stroke + shade * (1.0 - stroke);
  float k = vFade * uOpacity;
  gl_FragColor = vec4(col * stroke * k, a * k); // premultiplied: dark casing under the stroke
  if (gl_FragColor.a < 0.004) discard;
  #include <colorspace_fragment>
}
`;

export interface Rings {
  /** Visible pass (depth tested). */
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** X-ray pass: the parts hidden by the car (or the ground), faint. Shares the geometry. */
  readonly xray: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Per-instance data (I_STRIDE floats per corner), exposed for tests. */
  readonly data: Float32Array;
  /**
   * One corner, three.js frame: centre, unit forward and left axes in the road plane; radius and dot in metres (wheel
   * frame), warn level 0..1.
   */
  write(i: number, cx: number, cy: number, cz: number, fx: number, fy: number, fz: number, lx: number, ly: number, lz: number, radius: number, dotX: number, dotY: number, warn: number): void;
  /** Instances drawn (0 hides the mesh; 4 for a car). */
  setCount(n: number): void;
  dispose(): void;
}

export function createRings(ink: string, warn: string): Rings {
  const g = new InstancedBufferGeometry();
  g.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const data = new Float32Array(RING_CORNERS * I_STRIDE);
  const buf = new InstancedInterleavedBuffer(data, I_STRIDE, 1).setUsage(DynamicDrawUsage);
  g.setAttribute('iCentre', new InterleavedBufferAttribute(buf, 3, 0));
  g.setAttribute('iFwd', new InterleavedBufferAttribute(buf, 3, 3));
  g.setAttribute('iLeft', new InterleavedBufferAttribute(buf, 3, 6));
  g.setAttribute('iRing', new InterleavedBufferAttribute(buf, 4, 9));
  g.instanceCount = 0;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uInk: { value: new Color(ink) },
      uWarn: { value: new Color(warn) },
      uOpacity: { value: 0.92 },
      uLift: { value: 0.004 },
      uFade: { value: [18, 55] },
    },
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
  mesh.name = 'tyre-vfx:rings';
  mesh.frustumCulled = false; // instances move every frame; bounds are never recomputed
  mesh.renderOrder = 6;
  mesh.visible = false;
  // The car body hides most of each ring from the chase camera: draw the hidden parts faintly (one more draw call).
  const xrayMaterial = material.clone();
  xrayMaterial.depthFunc = GreaterDepth;
  xrayMaterial.uniforms.uOpacity!.value = 0.38;
  const xray = new Mesh(g, xrayMaterial);
  xray.name = 'tyre-vfx:rings-xray';
  xray.frustumCulled = false;
  xray.renderOrder = 7;
  xray.visible = false;
  return {
    mesh,
    xray,
    data,
    write(i, cx, cy, cz, fx, fy, fz, lx, ly, lz, radius, dotX, dotY, warnLevel) {
      const o = i * I_STRIDE;
      data[o] = cx;
      data[o + 1] = cy;
      data[o + 2] = cz;
      data[o + 3] = fx;
      data[o + 4] = fy;
      data[o + 5] = fz;
      data[o + 6] = lx;
      data[o + 7] = ly;
      data[o + 8] = lz;
      data[o + 9] = radius;
      data[o + 10] = dotX;
      data[o + 11] = dotY;
      data[o + 12] = warnLevel;
      buf.needsUpdate = true;
    },
    setCount(n) {
      g.instanceCount = n;
      mesh.visible = n > 0;
      xray.visible = n > 0;
    },
    dispose() {
      g.dispose();
      material.dispose();
      xrayMaterial.dispose();
    },
  };
}
