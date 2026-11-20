/**
 * GLSL for the DB11 body: screen-door x-ray dither (all body finishes), object-space metallic flakes (paint) and the
 * additive fresnel ghost shell shown while x-ray is on (research 10 §1a/§1b, written for WebGLRenderer).
 */
import { AdditiveBlending, Color, FrontSide, ShaderMaterial, type IUniform, type Material } from 'three';

/** Shared x-ray uniform: 0 = solid body, 1 = body fully dithered away. */
export interface XrayUniform {
  readonly uXray: IUniform<number>;
}

const DITHER_HEAD = /* glsl */ `
uniform float uXray;
// Interleaved gradient noise (Jimenez 2014): stable per-pixel threshold, no sorting, keeps depth writes.
float xrayIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const FLAKE_VERT_HEAD = 'varying vec3 vFlakePos;\n';
const FLAKE_FRAG_HEAD = /* glsl */ `
varying vec3 vFlakePos;
vec3 flakeHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453) - 0.5;
}
`;
/** Flake cell size, m (car-frame object space, so flakes stay glued to the paint). */
const FLAKE_CELL = 0.0009;
/** Flakes fade out with view distance (sub-pixel flakes only shimmer). */
const FLAKE_FADE_M = 9;

/**
 * Adds the x-ray dither (and, for the paint, flakes under the clearcoat) to a built-in material. One program per
 * material type: the uniform is shared, so toggling x-ray never recompiles.
 */
export function addBodyShader(material: Material, xray: XrayUniform, flakes: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uXray = xray.uXray;
    shader.fragmentShader = DITHER_HEAD + (flakes ? FLAKE_FRAG_HEAD : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() {\n\tif (xrayIgn(gl_FragCoord.xy) < uXray) discard;');
    if (!flakes) return;
    shader.vertexShader = FLAKE_VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFlakePos = position;');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
\t{
\t\tfloat flakeFade = clamp(1.0 - length(vViewPosition) / ${FLAKE_FADE_M.toFixed(1)}, 0.0, 1.0);
\t\tnormal = normalize(normal + 0.22 * flakeFade * flakeHash(floor(vFlakePos / ${FLAKE_CELL})));
\t}`,
    );
  };
  material.customProgramCacheKey = () => (flakes ? 'db11-body-flakes' : 'db11-body');
}

/** Additive fresnel rim shell: bright at grazing angles, almost nothing face-on; never writes depth. */
export function createGhostMaterial(xray: XrayUniform): ShaderMaterial {
  return new ShaderMaterial({
    name: 'db11-ghost',
    uniforms: { uXray: xray.uXray, uColor: { value: new Color(0x7fd8ff) }, uPower: { value: 2.2 }, uBase: { value: 0.012 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uXray;
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uBase;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
        float rim = pow(1.0 - ndv, uPower);
        gl_FragColor = vec4(uColor * (rim * 0.75 + uBase) * uXray, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
  });
}
