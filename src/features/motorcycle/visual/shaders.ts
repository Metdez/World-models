/**
 * GLSL for the cafe racer body (WebGLRenderer): screen-door x-ray dither shared by every body material through ONE
 * uniform (toggling never recompiles), metallic flakes under the paint's clearcoat (object space, no UVs needed),
 * twin racing stripes painted in object space along the centreline, and the additive fresnel ghost shell shown
 * while x-ray is on (the 03-03 DB11 technique, research 10 §1a/§1b).
 */
import { AdditiveBlending, Color, FrontSide, MeshPhysicalMaterial, ShaderMaterial, type IUniform, type Material } from 'three';

export interface XrayUniform {
  readonly uXray: IUniform<number>;
}

const DITHER_HEAD = /* glsl */ `
uniform float uXray;
float xrayIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
const DITHER_MAIN = 'void main() {\n\tif (xrayIgn(gl_FragCoord.xy) < uXray) discard;';

/** Adds the x-ray dither to a built-in material. */
export function addDither(material: Material, xray: XrayUniform, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uXray = xray.uXray;
    shader.fragmentShader = DITHER_HEAD + shader.fragmentShader.replace('void main() {', DITHER_MAIN);
  };
  material.customProgramCacheKey = () => key;
}

export interface PaintSpec {
  /** Base coat (sRGB). */
  readonly color: number;
  /** Stripe coat (sRGB) and pinstripe (sRGB). */
  readonly stripe: number;
  readonly pinstripe: number;
  /** Stripe half-width and gap from the centreline, m (object space, |z|). */
  readonly stripeWidth: number;
  readonly stripeGap: number;
  /** Stripes only above this height, m (tank top and seat hump). */
  readonly stripeFrom: number;
}

const FLAKE_CELL = 0.0008;
const FLAKE_FADE_M = 3;

/**
 * Deep metallic paint under a hard clearcoat with flakes and twin stripes. The stripes are decided per fragment from
 * the object-space position, so the tank and the seat hump line up without UVs.
 */
export function createPaintMaterial(spec: PaintSpec, xray: XrayUniform): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({ color: new Color(spec.color), metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 });
  m.name = 'moto-paint';
  const uniforms = {
    uStripe: { value: new Color(spec.stripe) },
    uPin: { value: new Color(spec.pinstripe) },
    uStripeGeo: { value: [spec.stripeGap, spec.stripeWidth, spec.stripeFrom] as [number, number, number] },
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uXray = xray.uXray;
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vPaintPos;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPaintPos = position;');
    shader.fragmentShader =
      DITHER_HEAD +
      /* glsl */ `
varying vec3 vPaintPos;
uniform vec3 uStripe;
uniform vec3 uPin;
uniform vec3 uStripeGeo;
vec3 flakeHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453) - 0.5;
}
` +
      shader.fragmentShader
        .replace('void main() {', DITHER_MAIN)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
\t{
\t\tfloat az = abs(vPaintPos.z);
\t\tfloat on = step(uStripeGeo.z, vPaintPos.y);
\t\tfloat aa = fwidth(az) * 1.2;
\t\tfloat band = smoothstep(uStripeGeo.x - aa, uStripeGeo.x + aa, az) * (1.0 - smoothstep(uStripeGeo.x + uStripeGeo.y - aa, uStripeGeo.x + uStripeGeo.y + aa, az));
\t\tfloat pinC = uStripeGeo.x + uStripeGeo.y + 0.006;
\t\tfloat pin = 1.0 - smoothstep(0.0012 - aa, 0.0012 + aa, abs(az - pinC));
\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, uStripe, band * on);
\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, uPin, pin * on);
\t}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
\t{
\t\tfloat flakeFade = clamp(1.0 - length(vViewPosition) / ${FLAKE_FADE_M.toFixed(1)}, 0.0, 1.0);
\t\tnormal = normalize(normal + 0.07 * flakeFade * flakeHash(floor(vPaintPos / ${FLAKE_CELL})));
\t}`,
        );
  };
  m.customProgramCacheKey = () => 'moto-paint';
  return m;
}

/** Additive fresnel rim shell: bright at grazing angles, almost nothing face-on; never writes depth. */
export function createGhostMaterial(xray: XrayUniform): ShaderMaterial {
  return new ShaderMaterial({
    name: 'moto-ghost',
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
