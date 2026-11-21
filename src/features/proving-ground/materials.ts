/**
 * Annex materials (ARCHITECTURE-M2 §8.4): the track's own texture ids through `ctx.assets` (no new assets). Asphalt and
 * cobbles are MeshStandardMaterial with vertex colours (zone tint, painted ride-street features) and a far-scaled copy
 * of the map that breaks the tiling over the large pads; the wet patches are MeshPhysicalMaterial, clearcoat 1, roughness
 * 0.15, albedo x 0.65: wet asphalt keeps the asphalt map, the wet ceramic tiles are a dark basalt grid with grout lines.
 * Every mesh's uv is world (x, y) in metres, so the texture repeat is 1 / tile.
 */
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import type { AnnexMaterial } from './surface';

export interface AnnexTextures {
  readonly asphalt: Texture;
  readonly asphaltNormal: Texture;
  readonly cobbles: Texture;
  readonly cobblesNormal: Texture;
}

/** The track feature's texture asset ids (CC0 Poly Haven, assets-src/textures). */
export const TEXTURE_ASSETS: Readonly<Record<keyof AnnexTextures, string>> = {
  asphalt: 'textures/asphalt_track/asphalt_track_diff_1k',
  asphaltNormal: 'textures/asphalt_track/asphalt_track_nor_gl_1k',
  cobbles: 'textures/cobblestone_floor_08/cobblestone_floor_08_diff_1k',
  cobblesNormal: 'textures/cobblestone_floor_08/cobblestone_floor_08_nor_gl_1k',
};

const TILE = { asphalt: 3, cobbles: 1.1 } as const;
/** Ceramic tile size and grout width, m. */
const CERAMIC = { tile: 0.6, grout: 0.012 } as const;
const WET_ALBEDO = 0.65;

/** A far-scaled copy of the same map breaks the tiling over the open pads. */
const BREAK_UP = /* glsl */ `
#include <map_fragment>
{
  float b = dot(texture2D(map, vMapUv * 0.043 + 0.21).rgb, vec3(0.333));
  diffuseColor.rgb *= 0.8 + 1.6 * (b - 0.12);
}
`;

/** Ceramic tiles: dark basalt with lighter grout lines, per-tile shade variation (world x, y in metres). */
const TILES_VERTEX = /* glsl */ `
varying vec2 vWorldXY;
`;
const TILES_FRAGMENT = /* glsl */ `
#include <color_fragment>
{
  vec2 t = vWorldXY / ${CERAMIC.tile.toFixed(3)};
  vec2 f = abs(fract(t) - 0.5);
  vec2 fw = max(fwidth(t), vec2(1e-5));
  float half_ = 0.5 - ${(CERAMIC.grout / CERAMIC.tile / 2).toFixed(4)};
  float grout = 1.0 - clamp((half_ - max(f.x, f.y)) / max(fw.x, fw.y) + 0.5, 0.0, 1.0);
  vec2 id = floor(t);
  float shade = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb *= 0.88 + 0.24 * shade;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.33, 0.34), grout);
}
`;

function tile(t: Texture, metres: number): void {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
}

function patch<T extends MeshStandardMaterial>(m: T, key: string, apply: (s: WebGLProgramParametersWithUniforms) => void): T {
  m.onBeforeCompile = apply;
  m.customProgramCacheKey = () => `annex-${key}`;
  return m;
}

const breakUp = (s: WebGLProgramParametersWithUniforms) => {
  s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', BREAK_UP);
};

/** Materials in ANNEX_MATERIALS order. Polygon offset: the link roads overlay the loop ribbon where they join it. */
export function createAnnexMaterials(tex: AnnexTextures): Record<AnnexMaterial, MeshStandardMaterial> {
  for (const t of [tex.asphalt, tex.cobbles]) t.colorSpace = SRGBColorSpace;
  tile(tex.asphalt, TILE.asphalt);
  tile(tex.asphaltNormal, TILE.asphalt);
  tile(tex.cobbles, TILE.cobbles);
  tile(tex.cobblesNormal, TILE.cobbles);
  const ground = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, vertexColors: true } as const;
  const asphalt = patch(new MeshStandardMaterial({ map: tex.asphalt, normalMap: tex.asphaltNormal, roughness: 0.86, ...ground }), 'asphalt', breakUp);
  asphalt.normalScale.set(0.6, 0.6);
  const cobbles = new MeshStandardMaterial({ map: tex.cobbles, normalMap: tex.cobblesNormal, roughness: 0.8, color: new Color(0.55, 0.55, 0.57), ...ground });
  const wet = { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, ...ground } as const;
  const wetAsphalt = patch(
    new MeshPhysicalMaterial({ map: tex.asphalt, normalMap: tex.asphaltNormal, color: new Color(WET_ALBEDO, WET_ALBEDO, WET_ALBEDO), ...wet }),
    'wet-asphalt',
    breakUp,
  );
  wetAsphalt.normalScale.set(0.35, 0.35);
  const basalt = 0.11 * WET_ALBEDO;
  const wetTiles = patch(new MeshPhysicalMaterial({ color: new Color(basalt, basalt * 1.04, basalt * 1.1), ...wet, roughness: 0.12 }), 'wet-tiles', (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${TILES_VERTEX}`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldXY = (modelMatrix * vec4(transformed, 1.0)).xz * vec2(1.0, -1.0);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${TILES_VERTEX}`).replace('#include <color_fragment>', TILES_FRAGMENT);
  });
  return { asphalt, cobbles, wetAsphalt, wetTiles };
}

export function setAnisotropy(tex: AnnexTextures, anisotropy: number): void {
  for (const t of Object.values(tex)) {
    if (t.anisotropy === anisotropy) continue;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}
