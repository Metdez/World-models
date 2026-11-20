/**
 * Track materials: MeshStandardMaterial + onBeforeCompile (GLSL, WebGL2). Road-space UV = (l, s) in metres.
 * Asphalt carries the painted markings (anti-aliased with fwidth) and rubbered wheel tracks; kerbs get
 * red/white stripes where `aPaint.y` says so; grass is mapped in world space so ribbon and terrain match.
 */
import { Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector4, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import type { BuiltTrack } from '../../contracts/track';
import type { Surface } from './ribbon';

export interface TrackTextures {
  readonly asphalt: Texture;
  readonly asphaltNormal: Texture;
  readonly cobbles: Texture;
  readonly cobblesNormal: Texture;
  readonly concrete: Texture;
  readonly grass: Texture;
}

/** Texture asset ids (assets-src/textures, CC0 Poly Haven). Roughness/AO maps are skipped to stay in the VRAM budget. */
export const TEXTURE_ASSETS: Readonly<Record<keyof TrackTextures, string>> = {
  asphalt: 'textures/asphalt_track/asphalt_track_diff_1k',
  asphaltNormal: 'textures/asphalt_track/asphalt_track_nor_gl_1k',
  cobbles: 'textures/cobblestone_floor_08/cobblestone_floor_08_diff_1k',
  cobblesNormal: 'textures/cobblestone_floor_08/cobblestone_floor_08_nor_gl_1k',
  concrete: 'textures/concrete_floor_01/concrete_floor_01_diff_1k',
  grass: 'textures/grass_ground/grass_ground_diff_1k',
};

/** Real-world size of one texture tile, m. */
const TILE = { asphalt: 3, cobbles: 1.1, concrete: 2.5, grass: 6 } as const;
/** Painted marking geometry, m. */
const EDGE_INSET = 0.3;
const EDGE_WIDTH = 0.15;
const KERB_PERIOD = 2;
const MAX_BARS = 24;

/** Scales a texture to `tile` metres. Along s the tile is rounded so a whole number fits the lap (no seam at s = L). */
function tileRoad(t: Texture, tile: number, length: number): void {
  t.wrapS = t.wrapT = RepeatWrapping;
  // Negative u: road u = l grows to the LEFT; flipping keeps the image (and its normal map) un-mirrored.
  t.repeat.set(-1 / tile, Math.round(length / tile) / length);
}

/** One painted transverse bar: s centre, half thickness along s, lateral extent [l0, l1]. */
function bar(s: number, half: number, l0: number, l1: number): Vector4 {
  return new Vector4(s, half, l0, l1);
}

/** Feature and section bars painted on the asphalt (yellow = feature extent, white = section start). */
function markings(track: BuiltTrack): { bars: Vector4[]; colours: number[]; pothole: Vector4 } {
  const hw = track.def.width / 2;
  const bars: Vector4[] = [];
  const colours: number[] = [];
  let pothole = new Vector4(0, 0, 0, 0);
  const add = (b: Vector4, yellow: boolean) => {
    if (bars.length >= MAX_BARS) return;
    bars.push(b);
    colours.push(yellow ? 1 : 0);
  };
  for (const sec of track.sections) {
    // Section start: short ticks inboard of both edge lines.
    if (sec.s0 > 0) {
      add(bar(sec.s0, 0.08, hw - EDGE_INSET - 1.2, hw - EDGE_INSET), false);
      add(bar(sec.s0, 0.08, -hw + EDGE_INSET, -hw + EDGE_INSET + 1.2), false);
    }
    for (const f of sec.def.features ?? []) {
      const a = sec.s0 + f.s;
      switch (f.kind) {
        case 'cosine-bump':
          add(bar(a - 0.25, 0.06, f.lateral[0] - 0.1, f.lateral[1] + 0.1), true);
          add(bar(a + f.length + 0.25, 0.06, f.lateral[0] - 0.1, f.lateral[1] + 0.1), true);
          break;
        case 'pothole':
          pothole = new Vector4(a, f.l, f.radius + 0.15, 1);
          break;
        case 'washboard':
        case 'pave':
        case 'humps': {
          const end = f.kind === 'humps' ? a + (f.count - 1) * f.spacing + f.length : a + f.length;
          add(bar(a - 0.6, 0.1, -hw + EDGE_INSET + 0.4, hw - EDGE_INSET - 0.4), true);
          add(bar(end + 0.6, 0.1, -hw + EDGE_INSET + 0.4, hw - EDGE_INSET - 0.4), true);
          break;
        }
        case 'kerb-strike':
        case 'vertical-curve':
          break; // the kerb strike is a striped kerb; crest/dip are seen, not painted
      }
    }
  }
  while (bars.length < MAX_BARS) {
    bars.push(new Vector4(-1e6, 0, 0, 0));
    colours.push(0);
  }
  return { bars, colours, pothole };
}

const VERTEX_ROAD = /* glsl */ `
attribute vec2 aPaint;
varying vec2 vRoad;
varying vec2 vPaint;
`;

/** Anti-aliased 1-D box: 1 inside |x| < half, smooth over one pixel. */
const AA = /* glsl */ `
float aaBox(float x, float hw, float w) { return clamp((hw - abs(x)) / max(w, 1e-5) + 0.5, 0.0, 1.0); }
`;

const ASPHALT_FRAGMENT = /* glsl */ `
uniform float uLength;
uniform float uHalfWidth;
uniform float uStartS;
uniform vec4 uBars[${MAX_BARS}];
uniform float uBarYellow[${MAX_BARS}];
uniform vec4 uPothole;
varying vec2 vRoad;
varying vec2 vPaint;
${AA}
`;

const ASPHALT_PAINT = /* glsl */ `
{
  float l = vRoad.x;
  float s = vRoad.y;
  vec2 w = fwidth(vRoad);
  // Large-scale mottle from a far-scaled copy of the map breaks the tiling.
  float mottle = dot(texture2D(map, vRoad * vec2(0.021, 0.017)).rgb, vec3(0.333));
  diffuseColor.rgb *= 0.85 + 1.5 * mottle;
  diffuseColor.rgb *= 1.0 - 0.22 * vPaint.x;
  float white = aaBox(abs(l) - (uHalfWidth - ${EDGE_INSET.toFixed(2)}), ${(EDGE_WIDTH / 2).toFixed(3)}, w.x);
  float yellow = 0.0;
  for (int i = 0; i < ${MAX_BARS}; i++) {
    vec4 b = uBars[i];
    float m = aaBox(s - b.x, b.y, w.y) * aaBox(l - 0.5 * (b.z + b.w), 0.5 * (b.w - b.z), w.x);
    if (uBarYellow[i] > 0.5) yellow = max(yellow, m); else white = max(white, m);
  }
  // Pothole: a painted ring around it.
  float r = length(vec2(s - uPothole.x, l - uPothole.y));
  yellow = max(yellow, uPothole.w * aaBox(r - uPothole.z, 0.05, length(w)));
  // Start line: a two-row chequer band across the road.
  float ds = mod(s - uStartS + 0.5 * uLength, uLength) - 0.5 * uLength;
  if (abs(ds) < 0.9 && abs(l) < uHalfWidth - ${EDGE_INSET.toFixed(2)}) {
    vec2 cell = floor(vec2(ds, l) / 0.45);
    float chequer = mod(cell.x + cell.y, 2.0);
    float band = aaBox(ds, 0.9, w.y);
    white = max(white, band * chequer);
    diffuseColor.rgb *= 1.0 - 0.6 * band * (1.0 - chequer);
  }
  // Paint wears where the tyres run.
  float wear = 1.0 - 0.45 * vPaint.x;
  paintMask = clamp(max(white, yellow) * wear, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.72), vec3(0.78, 0.52, 0.06), step(white, yellow)), paintMask);
}
`;

const KERB_FRAGMENT = /* glsl */ `
uniform float uKerbPeriod;
varying vec2 vRoad;
varying vec2 vPaint;
`;

const KERB_PAINT = /* glsl */ `
{
  float x = vRoad.y / uKerbPeriod;
  float fw = max(fwidth(x), 1e-5);
  float stripe = clamp((abs(fract(x) - 0.5) - 0.25) / fw + 0.5, 0.0, 1.0);
  float tex = dot(diffuseColor.rgb, vec3(0.333));
  vec3 red = vec3(0.50, 0.035, 0.03);
  vec3 white = vec3(0.70);
  vec3 painted = mix(red, white, stripe) * (0.75 + 1.2 * tex);
  vec3 plain = vec3(0.13) * (0.6 + 1.6 * tex);
  // A crisp start to the painted run (vPaint.y ramps over a row).
  paintMask = step(0.5, vPaint.y);
  diffuseColor.rgb = mix(plain, painted, paintMask);
}
`;

const GRASS_VERTEX = /* glsl */ `
#ifdef USE_MAP
  vMapUv = (mapTransform * vec3((modelMatrix * vec4(transformed, 1.0)).xz * vec2(1.0, -1.0), 1.0)).xy;
#endif
`;

const GRASS_PAINT = /* glsl */ `
{
  // Two far scales of the same map break the tiling over the open field.
  float a = dot(texture2D(map, vMapUv * 0.083).rgb, vec3(0.333));
  float b = dot(texture2D(map, vMapUv * 0.0071 + 0.37).rgb, vec3(0.333));
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
  // The scan is a dry brown lawn: keep its detail, recolour it to a tidy, mown green.
  vec3 green = lum * vec3(0.62, 1.0, 0.36) * 1.25;
  diffuseColor.rgb = mix(diffuseColor.rgb, green, 0.7) * (0.6 + 1.5 * a + 1.0 * (b - 0.25));
}
`;

function patch(material: MeshStandardMaterial, key: string, apply: (shader: WebGLProgramParametersWithUniforms) => void): MeshStandardMaterial {
  material.onBeforeCompile = apply;
  // Every patched material shares one onBeforeCompile source text: give each variant its own program key.
  material.customProgramCacheKey = () => `track-${key}`;
  return material;
}

function roadVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_ROAD}`)
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = uv;\nvPaint = aPaint;');
}

/** Roughness after the paint mask (paint is smoother than its substrate). */
const PAINT_ROUGHNESS = '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, paintMask);';

export type TrackMaterials = Readonly<Record<Surface, MeshStandardMaterial>>;

export function createMaterials(track: BuiltTrack, tex: TrackTextures): TrackMaterials {
  const L = track.length;
  for (const t of [tex.asphalt, tex.cobbles, tex.concrete, tex.grass]) t.colorSpace = SRGBColorSpace;
  tileRoad(tex.asphalt, TILE.asphalt, L);
  tileRoad(tex.asphaltNormal, TILE.asphalt, L);
  tileRoad(tex.cobbles, TILE.cobbles, L);
  tileRoad(tex.cobblesNormal, TILE.cobbles, L);
  tileRoad(tex.concrete, TILE.concrete, L);
  tex.grass.wrapS = tex.grass.wrapT = RepeatWrapping;
  tex.grass.repeat.set(1 / TILE.grass, 1 / TILE.grass);

  const { bars, colours, pothole } = markings(track);
  const startLine = track.props.find((p) => p.kind === 'start-line');
  const asphalt = patch(new MeshStandardMaterial({ map: tex.asphalt, normalMap: tex.asphaltNormal, roughness: 0.88 }), 'asphalt', (shader) => {
    Object.assign(shader.uniforms, {
      uLength: { value: L },
      uHalfWidth: { value: track.def.width / 2 },
      uStartS: { value: startLine ? startLine.s : -1e6 },
      uBars: { value: bars },
      uBarYellow: { value: colours },
      uPothole: { value: pothole },
    });
    roadVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ASPHALT_FRAGMENT}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\nfloat paintMask = 0.0;\n${ASPHALT_PAINT}`)
      .replace('#include <roughnessmap_fragment>', `${PAINT_ROUGHNESS}\nroughnessFactor -= 0.12 * vPaint.x;`);
  });
  asphalt.normalScale.set(0.6, 0.6);

  const kerb = patch(new MeshStandardMaterial({ map: tex.concrete, roughness: 0.75 }), 'kerb', (shader) => {
    shader.uniforms.uKerbPeriod = { value: L / Math.round(L / KERB_PERIOD) };
    roadVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${KERB_FRAGMENT}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\nfloat paintMask = 0.0;\n${KERB_PAINT}`)
      .replace('#include <roughnessmap_fragment>', PAINT_ROUGHNESS);
  });

  const cobbles = new MeshStandardMaterial({ map: tex.cobbles, normalMap: tex.cobblesNormal, roughness: 0.8, color: new Color(0.5, 0.5, 0.52) });
  // Shoulder: the same asphalt, older and lighter.
  const apron = new MeshStandardMaterial({ map: tex.asphalt, roughness: 0.92, color: new Color(2.4, 2.4, 2.35) });
  const grass = patch(new MeshStandardMaterial({ map: tex.grass, roughness: 0.95 }), 'grass', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${GRASS_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${GRASS_PAINT}`);
  });
  return { asphalt, cobbles, kerb, apron, grass };
}

/** Applies the tier's anisotropy to every track texture. */
export function setAnisotropy(tex: TrackTextures, anisotropy: number): void {
  for (const t of Object.values(tex)) {
    if (t.anisotropy === anisotropy) continue;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}
