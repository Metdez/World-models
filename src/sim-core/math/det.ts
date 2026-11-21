/**
 * Deterministic transcendental kernels (ARCHITECTURE-M2 §7.12): only + - * / and Math.sqrt/abs/floor/round, so every
 * engine produces the same bits. Ports of the fdlibm family (the algorithms V8 and SpiderMonkey also derive from), so
 * results agree with the engines' Math.* to within 1 ulp (tests/sim-core/det-math.test.ts).
 *
 * Lifted code (verify at lift time: done 2026-11-21 from the npm tarballs):
 * - dsin/dcos/dtan kernels and the medium (Cody–Waite) argument reduction: stdlib-js
 *   `@stdlib/math-base-special-{kernel-sin,kernel-cos,kernel-tan,rempio2}`; kernelSin/kernelCos use the original
 *   fdlibm 5.3 k_sin.c/k_cos.c evaluation (as V8 does), so dsin/dcos equal V8's Math.sin/cos bit for bit (09-03);
 *   https://github.com/stdlib-js/stdlib, Copyright (c) 2018 The Stdlib Authors, SPDX-License-Identifier: Apache-2.0.
 * - dlog: stdlib-js `@stdlib/math-base-special-ln` (Apache-2.0); dexp: `@stdlib/math-base-special-exp` (Apache-2.0,
 *   from Go's math/exp.go, Copyright (c) 2009 The Go Authors, BSD-3-Clause); expm1 (inside dtanh):
 *   `@stdlib/math-base-special-expm1` (Apache-2.0).
 * - datan, datan2, dasin, dacos, dtanh: FreeBSD msun s_atan.c, e_atan2.c, e_asin.c, e_acos.c, s_tanh.c (fdlibm).
 * All fdlibm-derived parts carry this notice:
 *   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *   Developed at SunPro, a Sun Microsystems, Inc. business.
 *   Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice
 *   is preserved.
 *
 * - the pow core: stdlib-js `@stdlib/math-base-special-pow` 0.3.1 (Apache-2.0; fdlibm e_pow.c).
 * Modified (Apache-2.0 §4(b)): translated from JavaScript into TypeScript and merged into this module; kernelSin/
 * kernelCos use the fdlibm 5.3 evaluation order; the pow core omits stdlib's y = 3/4 shortcuts; expm1 runs through a
 * scratch slot; dsincos (13-01) returns sin and cos together. Licence, NOTICE and attributions: CREDITS.md and the
 * in-app credits panel.
 *
 * dpow (x > 0): integer |y| <= 16 by repeated squaring, otherwise the fdlibm pow core.
 * Arguments of dsin/dcos/dtan must satisfy |x| < 2^20 * pi/2 (the medium reduction; the plant never passes more).
 */

// ---- IEEE-754 word access (typed arrays share one buffer; the high word index follows the platform byte order)
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;
function highWord(x: number): number {
  F64[0] = x;
  return U32[HI]! | 0;
}
function lowWord(x: number): number {
  F64[0] = x;
  return U32[LO]! >>> 0;
}
function withLowWord(x: number, lo: number): number {
  F64[0] = x;
  U32[LO] = lo >>> 0;
  return F64[0]!;
}
function fromWords(hi: number, lo: number): number {
  U32[HI] = hi >>> 0;
  U32[LO] = lo >>> 0;
  return F64[0]!;
}

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;

// ---- sin / cos / tan kernels on [-pi/4, pi/4] (x + y, y = tail of the reduced argument)
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  const v = z * x;
  if (y === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

// High-word thresholds of fdlibm k_cos.c as plain comparisons on |x| (same branches, no word access on the common path).
const COS_TINY = 7.450580596923828e-9; // 2^-27: ix < 0x3e400000
const COS_SMALL = 0.2999999523162842; // ix < 0x3fd33333 (= fromWords(0x3fd33333, 0))
const COS_BIG = 0.7812504768371582; // ix > 0x3fe90000 (= fromWords(0x3fe90001, 0))
function kernelCos(x: number, y: number): number {
  const ax = Math.abs(x);
  if (ax < COS_TINY) return 1;
  const z = x * x;
  const r = z * (0.0416666666666666 + z * (-0.001388888888887411 + z * (0.00002480158728947673 + z * (-2.7557314351390663e-7 + z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))));
  if (ax < COS_SMALL) return 1 - (0.5 * z - (z * r - x * y));
  // |x| >= 0.3: subtract qx (x/4 cut to its high word, exact) first so 1 - z/2 keeps its low bits.
  const qx = ax >= COS_BIG ? 0.28125 : withLowWord(ax, 0) * 0.25;
  const hz = 0.5 * z - qx;
  return 1 - qx - (hz - (z * r - x * y));
}

const PIO4 = 7.85398163397448278999e-1;
const PIO4LO = 3.06161699786838301793e-17;
const T0 = 3.33333333333334091986e-1;
function kernelTan(xIn: number, yIn: number, k: number): number {
  let x = xIn;
  let y = yIn;
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3fe59428) {
    if (x < 0) {
      x = -x;
      y = -y;
    }
    x = PIO4 - x + (PIO4LO - y);
    y = 0;
  }
  let z = x * x;
  let w = z * z;
  let r =
    0.13333333333320124 +
    w * (0.021869488294859542 + w * (0.0035920791075913124 + w * (0.0005880412408202641 + w * (0.00007817944429395571 + w * -0.000018558637485527546))));
  let v = z * (0.05396825397622605 + w * (0.0088632398235993 + w * (0.0014562094543252903 + w * (0.0002464631348184699 + w * (0.00007140724913826082 + w * 0.00002590730518636337)))));
  let s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T0 * s;
  w = x + r;
  if (ix >= 0x3fe59428) {
    v = k;
    return (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((w * w) / (w + v) - r)));
  }
  if (k === 1) return w;
  z = withLowWord(w, 0);
  v = r - (z - x);
  const a = -1 / w;
  const t = withLowWord(a, 0);
  s = 1 + t * z;
  return t + a * (s + t * v);
}

// ---- argument reduction x = n*pi/2 + (y0 + y1), |x| < 2^20 * pi/2 (Cody–Waite, three-part pi/2)
const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const MEDIUM = 0x413921fb;
const Y = new Float64Array(2);
/** Scratch argument/result of expm1Scratch. */
const EX = new Float64Array(1);
function rempio2(x: number, ix: number): number {
  if (ix >= MEDIUM) throw new Error('det: trigonometric argument beyond 2^20 * pi/2');
  // fdlibm rounds x * 2/pi to nearest (ties to even via the 0x1.8p52 trick); a tie is impossible for finite x here.
  const n = Math.round(x * INVPIO2);
  let r = x - n * PIO2_1;
  let w = n * PIO2_1T;
  const j = ix >> 20;
  Y[0] = r - w;
  let i = j - ((highWord(Y[0]!) >> 20) & 0x7ff);
  if (i > 16) {
    let t = r;
    w = n * PIO2_2;
    r = t - w;
    w = n * PIO2_2T - (t - r - w);
    Y[0] = r - w;
    i = j - ((highWord(Y[0]!) >> 20) & 0x7ff);
    if (i > 49) {
      t = r;
      w = n * PIO2_3;
      r = t - w;
      w = n * PIO2_3T - (t - r - w);
      Y[0] = r - w;
    }
  }
  Y[1] = r - Y[0]! - w;
  return n;
}

export function dsin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return ix < 0x3e500000 ? x : kernelSin(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = rempio2(x, ix) & 3;
  return n === 0 ? kernelSin(Y[0]!, Y[1]!) : n === 1 ? kernelCos(Y[0]!, Y[1]!) : n === 2 ? -kernelSin(Y[0]!, Y[1]!) : -kernelCos(Y[0]!, Y[1]!);
}

export function dcos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return ix < 0x3e46a09e ? 1 : kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = rempio2(x, ix) & 3;
  return n === 0 ? kernelCos(Y[0]!, Y[1]!) : n === 1 ? -kernelSin(Y[0]!, Y[1]!) : n === 2 ? -kernelCos(Y[0]!, Y[1]!) : kernelSin(Y[0]!, Y[1]!);
}

/**
 * sin(x) and cos(x) into SINCOS[0], SINCOS[1]: bit-identical to dsin(x) / dcos(x) (same reduction, same kernels), but
 * returns nothing. A double returned from a call V8 does not inline is boxed (a heap allocation per call); hot paths
 * that need both values (track pose integration, projection) use this to stay allocation-free.
 */
export const SINCOS = new Float64Array(2);
export function dsincos(x: number): void {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    SINCOS[0] = ix < 0x3e500000 ? x : kernelSin(x, 0);
    SINCOS[1] = ix < 0x3e46a09e ? 1 : kernelCos(x, 0);
    return;
  }
  if (ix >= 0x7ff00000) {
    SINCOS[0] = NaN;
    SINCOS[1] = NaN;
    return;
  }
  const n = rempio2(x, ix) & 3;
  const sn = kernelSin(Y[0]!, Y[1]!);
  const cs = kernelCos(Y[0]!, Y[1]!);
  SINCOS[0] = n === 0 ? sn : n === 1 ? cs : n === 2 ? -sn : -cs;
  SINCOS[1] = n === 0 ? cs : n === 1 ? -sn : n === 2 ? -cs : sn;
}

export function dtan(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return ix < 0x3e400000 ? x : kernelTan(x, 0, 1);
  if (ix >= 0x7ff00000) return NaN;
  const n = rempio2(x, ix);
  return kernelTan(Y[0]!, Y[1]!, 1 - ((n & 1) << 1));
}

// ---- atan family (s_atan.c, e_atan2.c, e_asin.c, e_acos.c)
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.5707963267948965580] as const;
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17] as const;
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.1111110405462355788e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.6531572744216915527e-2;
const AT10 = 1.62858201153657823623e-2;

export function datan(xIn: number): number {
  let x = xIn;
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    if (x !== x) return x + x;
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id as 0]! - (x * (s1 + s2) - ATAN_LO[id as 0]! - x);
  return hx < 0 ? -r : r;
}

const TINY = 1e-300;
const PI_O_4 = 7.8539816339744827900e-1;
const PI_O_2 = 1.5707963267948965580;
const PI_LO = 1.2246467991473531772e-16;

export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  const hx = highWord(x);
  const lx = lowWord(x);
  const hy = highWord(y);
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  if (hx === 0x3ff00000 && lx === 0) return datan(y);
  let m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2);
  if (y === 0) return m <= 1 ? y : m === 2 ? PI + TINY : -PI - TINY;
  if (x === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return m === 0 ? PI_O_4 + TINY : m === 1 ? -PI_O_4 - TINY : m === 2 ? 3 * PI_O_4 + TINY : -3 * PI_O_4 - TINY;
    return m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI + TINY : -PI - TINY;
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60) z = 0;
  else z = datan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

const PIO2_HI = 1.57079632679489655800;
const PIO2_LO = 6.12323399573676603587e-17;
const PIO4_HI = 7.85398163397448278999e-1;
const PS0 = 1.66666666666666657415e-1;
const PS1 = -3.25565818622400915405e-1;
const PS2 = 2.01212532134862925881e-1;
const PS3 = -4.00555345006794114027e-2;
const PS4 = 7.91534994289814532176e-4;
const PS5 = 3.47933107596021167570e-5;
const QS1 = -2.40339491173441421878;
const QS2 = 2.02094576023350569471;
const QS3 = -6.88283971605453293030e-1;
const QS4 = 7.70381505559019352791e-2;
const asinP = (t: number): number => t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
const asinQ = (t: number): number => 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));

export function dasin(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lowWord(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) return x;
    const t = x * x;
    return x + x * (asinP(t) / asinQ(t));
  }
  const w = 1 - Math.abs(x);
  let t = w * 0.5;
  let p = asinP(t);
  let q = asinQ(t);
  const s = Math.sqrt(t);
  if (ix >= 0x3fef3333) {
    t = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    const ws = withLowWord(s, 0);
    const c = (t - ws * ws) / (s + ws);
    const r = p / q;
    p = 2 * s * r - (PIO2_LO - 2 * c);
    q = PIO4_HI - 2 * ws;
    t = PIO4_HI - (p - q);
  }
  return hx > 0 ? t : -t;
}

export function dacos(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lowWord(x)) === 0) return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x;
    const r = asinP(z) / asinQ(z);
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    const z = (1 + x) * 0.5;
    const s = Math.sqrt(z);
    const w = (asinP(z) / asinQ(z)) * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withLowWord(s, 0);
  const c = (z - df * df) / (s + df);
  const w = (asinP(z) / asinQ(z)) * s + c;
  return 2 * (df + w);
}

// ---- exp / log / expm1 / tanh
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const LOG2_E = 1.442695040888963387;
const EXP_OVERFLOW = 7.09782712893383973096e2;
const EXP_UNDERFLOW = -7.45133219101941108420e2;
const NEARZERO = 1 / (1 << 28);

/** x * 2^k without Math.pow (k may push through the subnormal range in two halves). */
function ldexp(x: number, k: number): number {
  if (k > 1023) return ldexp(x * fromWords(0x7fe00000, 0), k - 1023);
  if (k < -1022) return ldexp(x * fromWords(0x00100000, 0), k + 1022);
  return x * fromWords((k + 1023) << 20, 0);
}

export function dexp(x: number): number {
  if (x !== x || x === Infinity) return x;
  if (x === -Infinity) return 0;
  if (x > EXP_OVERFLOW) return Infinity;
  if (x < EXP_UNDERFLOW) return 0;
  if (x > -NEARZERO && x < NEARZERO) return 1 + x;
  const k = Math.trunc(x < 0 ? LOG2_E * x - 0.5 : LOG2_E * x + 0.5);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (0.16666666666666602 + t * (-0.0027777777777015593 + t * (0.00006613756321437934 + t * (-0.0000016533902205465252 + t * 4.1381367970572385e-8))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return ldexp(y, k);
}

const TWO54 = 1.8014398509481984e16;
export function dlog(xIn: number): number {
  let x = xIn;
  if (x === 0) return -Infinity;
  if (x !== x || x < 0) return NaN;
  let hx = highWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    k -= 54;
    x *= TWO54;
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = fromWords(hx | (i ^ 0x3ff00000), lowWord(x));
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : k * LN2_HI - (R - k * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (0.3999999999940942 + w * (0.22222198432149784 + w * 0.15313837699209373));
  const t2 = z * (0.6666666666666735 + w * (0.2857142874366239 + w * (0.1818357216161805 + w * 0.14798198605116586)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + R)) : k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - R) : k * LN2_HI - (s * (f - R) - k * LN2_LO - f);
}

const HALF_LN2 = 0.34657359027997264;
const LN2x56 = 3.88162421113569373274e1;
const LN2_HALFX3 = 1.03972077083991796413;
/** expm1 of EX[0] into EX[0] (fdlibm s_expm1.c). Through a scratch slot: it is too large for V8 to inline, and a double
 * crossing a non-inlined call is boxed (an allocation per dtanh call otherwise). */
function expm1Scratch(): void {
  const xIn = EX[0]!;
  let x = xIn;
  if (x === Infinity || x !== x) {
    EX[0] = x;
    return;
  }
  if (x === -Infinity) {
    EX[0] = -1;
    return;
  }
  if (x === 0) {
    EX[0] = x;
    return;
  }
  const sign = x < 0;
  let y = sign ? -x : x;
  if (y >= LN2x56) {
    if (sign) {
      EX[0] = -1;
      return;
    }
    if (y >= EXP_OVERFLOW) {
      EX[0] = Infinity;
      return;
    }
  }
  const hx = highWord(y);
  let k: number;
  let c = 0;
  if (y > HALF_LN2) {
    let hi: number;
    let lo: number;
    if (y < LN2_HALFX3) {
      if (sign) {
        hi = x + LN2_HI;
        lo = -LN2_LO;
        k = -1;
      } else {
        hi = x - LN2_HI;
        lo = LN2_LO;
        k = 1;
      }
    } else {
      k = (sign ? LOG2_E * x - 0.5 : LOG2_E * x + 0.5) | 0;
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 1016070144) {
    EX[0] = x;
    return;
  } else k = 0;
  const halfX = 0.5 * x;
  const z = x * halfX;
  const r1 = 1 + z * (-0.03333333333333313 + z * (0.0015873015872548146 + z * (-0.0000793650757867488 + z * (0.000004008217827329362 + z * -2.0109921818362437e-7))));
  let t = 3 - r1 * halfX;
  let e = z * ((r1 - t) / (6 - x * t));
  if (k === 0) {
    EX[0] = x - (x * e - z);
    return;
  }
  const twopk = fromWords((1023 + k) << 20, 0);
  e = x * (e - c) - c;
  e -= z;
  if (k === -1) {
    EX[0] = 0.5 * (x - e) - 0.5;
    return;
  }
  if (k === 1) {
    EX[0] = x < -0.25 ? -2 * (e - (x + 0.5)) : 1 + 2 * (x - e);
    return;
  }
  if (k <= -2 || k > 56) {
    y = 1 - (e - x);
    y = k === 1024 ? y * 2 * fromWords(0x7fe00000, 0) : y * twopk;
    EX[0] = y - 1;
    return;
  }
  if (k < 20) {
    t = fromWords(1072693248 - (0x200000 >> k), 0);
    y = t - (e - x);
  } else {
    t = fromWords((1023 - k) << 20, 0);
    y = x - (e + t);
    y += 1;
  }
  EX[0] = y * twopk;
}

export function dtanh(x: number): number {
  const jx = highWord(x);
  const ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) return jx >= 0 ? 1 / x + 1 : 1 / x - 1;
  let z = 1; // |x| >= 22
  if (ix < 0x40360000) {
    if (ix < 0x3c800000) return x * (1 + x);
    if (ix >= 0x3ff00000) {
      EX[0] = 2 * Math.abs(x);
      expm1Scratch();
      const t = EX[0]!;
      z = 1 - 2 / (t + 2);
    } else {
      EX[0] = -2 * Math.abs(x);
      expm1Scratch();
      const t = EX[0]!;
      z = -t / (t + 2);
    }
  }
  return jx >= 0 ? z : -z;
}

// ---- pow core for x > 0 (fdlibm e_pow.c; via stdlib-js `@stdlib/math-base-special-pow` 0.3.1, Apache-2.0, without its
// y = 3 / y = 4 shortcuts so it matches fdlibm bit for bit): log2(x) in extra precision, times y, then 2^(hp + lp).
const POW_L = [0.5999999999999946, 0.4285714285785502, 0.33333332981837743, 0.272728123808534, 0.23066074577556175, 0.20697501780033842] as const;
const CP = 9.61796693925975554329e-1;
const CP_HI = 9.61796700954437255859e-1;
const CP_LO = -7.02846165095275826516e-9;
const DP_HI1 = 5.84962487220764160156e-1;
const DP_LO1 = 1.35003920212974897128e-8;
const INV_LN2 = 1.442695040888963387;
const INV_LN2_HI = 1.44269502162933349609;
const INV_LN2_LO = 1.92596299112661746887e-8;
const LN2 = 6.93147180559945286227e-1;
const POW_LN2_HI = 6.93147182464599609375e-1;
const POW_LN2_LO = -1.90465429995776804525e-9;
const OVT = 8.0085662595372944372e-17;
const TWO53 = 9007199254740992;
function withHighWord(x: number, hi: number): number {
  F64[0] = x;
  U32[HI] = hi >>> 0;
  return F64[0]!;
}
function powPositive(xIn: number, y: number): number {
  if (xIn === 1) return 1;
  if (y === 0.5) return Math.sqrt(xIn);
  let ax = xIn;
  let ahx = highWord(ax);
  const ahy = highWord(y) & 0x7fffffff;
  let t1: number;
  let t2: number;
  if (ahy > 0x41e00000) {
    // |y| > 2^31: over/underflow unless x is within 2^-20 of 1, where log x ~ t - t^2/2 + t^3/3 - t^4/4.
    if (ahy > 0x43f00000 || ahx < 0x3fefffff || ahx > 0x3ff00000) return (ahx < 0x3ff00000) === y < 0 ? Infinity : 0;
    const t = ax - 1;
    const w = t * t * (0.5 - t * (0.3333333333333333 - t * 0.25));
    const u = INV_LN2_HI * t;
    const v = t * INV_LN2_LO - w * INV_LN2;
    t1 = withLowWord(u + v, 0);
    t2 = v - (t1 - u);
  } else {
    let n = 0;
    if (ahx < 0x00100000) {
      ax *= TWO53;
      n -= 53;
      ahx = highWord(ax);
    }
    n += (ahx >> 20) - 0x3ff;
    const j = ahx & 0x000fffff;
    ahx = j | 0x3ff00000;
    let k = 0;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else {
      n += 1;
      ahx -= 0x00100000;
    }
    ax = withHighWord(ax, ahx);
    const bp = k === 0 ? 1 : 1.5;
    let u = ax - bp;
    let v = 1 / (ax + bp);
    const ss = u * v;
    const hs = withLowWord(ss, 0);
    let ht = fromWords(((ahx >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let lt = ax - (ht - bp);
    const ls = v * (u - hs * ht - hs * lt);
    let s2 = ss * ss;
    let r = s2 * s2 * (POW_L[0] + s2 * (POW_L[1] + s2 * (POW_L[2] + s2 * (POW_L[3] + s2 * (POW_L[4] + s2 * POW_L[5])))));
    r += ls * (hs + ss);
    s2 = hs * hs;
    ht = withLowWord(3 + s2 + r, 0);
    lt = r - (ht - 3 - s2);
    u = hs * ht;
    v = ls * ht + lt * ss;
    const hp = withLowWord(u + v, 0);
    const lp = v - (hp - u);
    const hz = CP_HI * hp;
    const dpHi = k === 0 ? 0 : DP_HI1;
    const lz = CP_LO * hp + lp * CP + (k === 0 ? 0 : DP_LO1);
    t1 = withLowWord(hz + lz + dpHi + n, 0);
    t2 = lz - (t1 - n - dpHi - hz);
  }
  // (y1 + y2) * (t1 + t2), y1 = y with a zero low word
  const y1 = withLowWord(y, 0);
  const lp = (y - y1) * t1 + y * t2;
  let hp = y1 * t1;
  let z = lp + hp;
  let j = highWord(z);
  const i = lowWord(z) | 0;
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0 || lp + OVT > z - hp) return Infinity;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - (0xc090cc00 | 0)) | i) !== 0 || lp <= z - hp) return 0;
  }
  // 2^(hp + lp)
  const ia = j & 0x7fffffff;
  let k = (ia >> 20) - 0x3ff;
  let n = 0;
  if (ia > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    hp -= t;
  }
  const t = withLowWord(lp + hp, 0);
  const u = t * POW_LN2_HI;
  const v = (lp - (t - hp)) * LN2 + t * POW_LN2_LO;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const c = z - tt * (0.16666666666666602 + tt * (-0.0027777777777015593 + tt * (0.00006613756321437934 + tt * (-0.0000016533902205465252 + tt * 4.1381367970572385e-8))));
  const r = (z * c) / (c - 2) - (w + z * w);
  z = 1 - (r - z);
  j = highWord(z) + (n << 20);
  return j >> 20 <= 0 ? ldexp(z, n) : withHighWord(z, j);
}

/** x^y for x > 0: integer |y| <= 16 by repeated squaring, otherwise fdlibm's pow (within 1 ulp of V8's Math.pow). */
export function dpow(x: number, y: number): number {
  if (y === Math.trunc(y) && Math.abs(y) <= 16) {
    let n = Math.abs(y);
    let b = x;
    let r = 1;
    while (n > 0) {
      if (n & 1) r *= b;
      b *= b;
      n >>= 1;
    }
    return y < 0 ? 1 / r : r;
  }
  return powPositive(x, y);
}

export const dhypot = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** Angle to (-pi, pi]. */
export function dwrapPi(a: number): number {
  if (a > -PI && a <= PI) return a;
  const r = a - TWO_PI * Math.floor((a + PI) / TWO_PI);
  return r <= -PI ? r + TWO_PI : r > PI ? r - TWO_PI : r;
}
