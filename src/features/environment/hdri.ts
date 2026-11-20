import { DataUtils } from 'three';

export type Rgb = [number, number, number];

export interface HdrAnalysis {
  /** Unit vector towards the sun (three.js frame, Y up), from the energy above the clamp. */
  readonly sunDirection: [number, number, number];
  /** Sun colour, max channel 1. */
  readonly sunColor: Rgb;
  /** Irradiance removed by the clamp (luminance · sr, cosine-free); 0 when nothing exceeded it. */
  readonly sunIrradiance: number;
  /** Mean linear colour of the HDRI at the horizon line, where the fogged terrain edge meets the background (fog colour). */
  readonly horizon: Rgb;
}

const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
/**
 * Latitude band for the horizon colour, rad. The far terrain is fully fogged and ends at ~0°, right against the
 * background there: the sky above (2–8°, ~5× brighter on the airfield) drew a light line along the horizon.
 */
const HORIZON_BAND: readonly [number, number] = [-1 * (Math.PI / 180), 2 * (Math.PI / 180)];

/** Direction three.js samples at equirect uv (`equirectUv` in the shader chunks, flipY texture: v = 1 at row 0). */
export function equirectDirection(u: number, v: number, out: [number, number, number]): [number, number, number] {
  const phi = (u - 0.5) * 2 * Math.PI;
  const lat = (v - 0.5) * Math.PI;
  out[0] = Math.cos(lat) * Math.cos(phi);
  out[1] = Math.sin(lat);
  out[2] = Math.cos(lat) * Math.sin(phi);
  return out;
}

/**
 * Clamps an RGBA half-float equirect (HDRLoader output, row 0 = top) in place at `limit` and reports what was
 * removed: a hot sun (derelict_airfield peaks ~3e4) would otherwise speckle the PMREM and blow every highlight.
 * Non-negative halfs order like their bit patterns, so the clamp is an integer compare.
 */
export function clampHdr(data: Uint16Array, width: number, height: number, limit: number): HdrAnalysis {
  const limitBits = DataUtils.toHalfFloat(limit);
  const dir: [number, number, number] = [0, 0, 0];
  const sum: [number, number, number] = [0, 0, 0];
  const sunRgb: Rgb = [0, 0, 0];
  const horizon: Rgb = [0, 0, 0];
  let irradiance = 0;
  let horizonCount = 0;
  let brightest = -1;
  let brightestBits = -1;
  const pixelArea = ((2 * Math.PI) / width) * (Math.PI / height);

  for (let y = 0; y < height; y++) {
    const v = 1 - (y + 0.5) / height;
    const lat = (v - 0.5) * Math.PI;
    const inBand = lat >= HORIZON_BAND[0] && lat <= HORIZON_BAND[1];
    const solidAngle = pixelArea * Math.cos(lat);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (inBand) {
        for (let c = 0; c < 3; c++) horizon[c]! += DataUtils.fromHalfFloat(data[i + c]!);
        horizonCount++;
      }
      const peak = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      if (peak > brightestBits) {
        brightestBits = peak;
        brightest = y * width + x;
      }
      if (peak <= limitBits) continue;
      let excessLum = 0;
      for (let c = 0; c < 3; c++) {
        const excess = Math.max(0, DataUtils.fromHalfFloat(data[i + c]!) - limit);
        sunRgb[c]! += excess * solidAngle;
        excessLum += LUMA[c]! * excess;
        if (data[i + c]! > limitBits) data[i + c] = limitBits;
      }
      const w = excessLum * solidAngle;
      irradiance += w;
      equirectDirection((x + 0.5) / width, v, dir);
      for (let c = 0; c < 3; c++) sum[c]! += dir[c]! * w;
    }
  }

  if (irradiance === 0 && brightest >= 0) {
    // Nothing above the clamp: aim the key light at the brightest pixel.
    equirectDirection(((brightest % width) + 0.5) / width, 1 - (Math.floor(brightest / width) + 0.5) / height, sum);
    const i = brightest * 4;
    for (let c = 0; c < 3; c++) sunRgb[c] = DataUtils.fromHalfFloat(data[i + c]!);
  }
  const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
  const maxRgb = Math.max(sunRgb[0], sunRgb[1], sunRgb[2]) || 1;
  const n = horizonCount || 1;
  return {
    sunDirection: [sum[0] / len, sum[1] / len, sum[2] / len],
    sunColor: [sunRgb[0] / maxRgb, sunRgb[1] / maxRgb, sunRgb[2] / maxRgb],
    sunIrradiance: irradiance,
    horizon: [horizon[0] / n, horizon[1] / n, horizon[2] / n],
  };
}

/**
 * Snaps a light-space centre to whole shadow texels (no edge shimmer while the shadow box follows the car).
 * `right`/`up` span the shadow camera's image plane; the depth component along `forward` is kept.
 */
export function snapToTexel(
  centre: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
  forward: { x: number; y: number; z: number },
  texel: number,
  out: { x: number; y: number; z: number },
): void {
  const a = Math.round((centre.x * right.x + centre.y * right.y + centre.z * right.z) / texel) * texel;
  const b = Math.round((centre.x * up.x + centre.y * up.y + centre.z * up.z) / texel) * texel;
  const d = centre.x * forward.x + centre.y * forward.y + centre.z * forward.z;
  out.x = right.x * a + up.x * b + forward.x * d;
  out.y = right.y * a + up.y * b + forward.y * d;
  out.z = right.z * a + up.z * b + forward.z * d;
}
