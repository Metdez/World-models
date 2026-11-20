# 22 - Rendering working suspension mechanisms in Three.js

Date: 2026-11-20. Research only. Verified = I opened the page / fetched the raw file. Everything else is marked unverified.
Environment notes: `gh api` was blocked for non-attached repos, so repo stats (stars/dates) come from `gh search repos` JSON only. Sketchfab/Poly Pizza/Wikimedia were not usable for downloads (login / Cloudflare challenge / rate limit). Nothing was downloaded into `scratchpad/assets/suspension-parts/` because nothing qualified (see A).

---------------------------------------------------------------------------------------------------

## A. Assets (CC models of suspension parts)

### Verdict
No directly downloadable, properly licensed GLB/STEP/STL set of suspension assemblies was found. Procedural generation (section B) is the primary path, and it is the better fit anyway: hardpoints move per frame, so parts must be built from hardpoints and not baked.

### Candidates found (none downloadable headless -> NOT fetched)
| Item | Licence (verified on page) | Why not usable now |
|---|---|---|
| Sketchfab "MACHPERSON SUSPENSION (STRUD)" by VR DESIGNER, https://sketchfab.com/3d-models/machperson-suspension-strud-bd202ee134454402bf398ca906c8e2f5 | CC BY 4.0, 97.7k tris, 390 downloads | Sketchfab archive download needs a signed-in user (Alexandria `get_model` explicitly says "Never a download link: archives need a signed-in Sketchfab user"). One static assembly: not hardpoint-driven. Possible later as a hero "static reference" if a human downloads it and credits the author. |
| Sketchfab "Double Wishbone and Live Axle Suspension" by _BlackWAVE_, https://sketchfab.com/3d-models/5cf0120b9bca4fd6a20c9357f7e5efaf | CC Attribution | 2.53M faces - far too heavy; login needed. |
| Same author's collection "SUSPENSION" (7 models): https://sketchfab.com/vr.designer_09/collections/suspension-d9990118f76940c9a61604d25d0802f6 | CC BY (the one page I opened) - check each | login needed. Also has "BRAKE CALLIPER" https://sketchfab.com/3d-models/brake-calliper-b18ea04df4504172a70a4b32d72818a2 (licence unverified). |
| Sketchfab CC0 search for "suspension" (downloadable) | only unrelated results (pottery jar, bell) | nothing relevant is CC0. |
| CGTrader suspension/brake models | Royalty Free / "Custom License" (paid) | NOT usable (not CC). |
| CadCrowd "Double Wishbone Suspension" | CC BY-NC-ND (per search snippet) | NOT usable. |
| GrabCAD FSAE parts | per-file, mostly "GrabCAD license"/unspecified; login required | NOT usable without per-file check; login needed. |
| github.com/FS-AI/FS-AI_ADS-DV_CAD | no LICENSE file found; for IMechE teams only | NOT usable (unclear). |
| github.com/byui-formula-hybrid/legacy-CAD-Models | licence section in README, not verified | unclear, skip. |
| github.com/simscape/Formula-Student-Vehicle-Simscape | BSD-3-Clause (MathWorks, LICENSE.md verified) | Simulink models; not web-ready geometry. Useful only as a reference for FS suspension hardpoint sets. |
| Poly Pizza | Cloudflare challenge ("Just a moment") | not checked; its catalogue is low-poly props, unlikely to have suspension parts. |
| Wikimedia Commons API | rate limited (429) | not checked. |
| Khronos glTF-Sample-Assets | (from memory, unverified) no suspension parts | skip. |

Recommendation: spend zero effort on asset hunting for linkages. If a "hero" brake caliper/disc is wanted later, procedural (below) is good enough; or a human can fetch a CC0/CC-BY caliper from Sketchfab manually.

### Existing MIT code with a full procedural suspension (best find)
**KRoshanK/AxleLab** - https://github.com/KRoshanK/AxleLab - LICENSE: MIT (verified, (c) 2026 KRoshanK). React 19 + TS + @react-three/fiber + zustand + Vite. Last push 2026-09-21, 1 star (tiny, brand-new, but exactly on-topic and permissively licensed).
Verified raw files (https://raw.githubusercontent.com/KRoshanK/AxleLab/HEAD/src/...):
- `components/suspension/geometry.ts` - `coilSpringGeometry()` (HelixCurve + TubeGeometry), `bootGeometry()` (Lathe sinusoid CV/dust boot), `orientY()` / `between()` (a->b link placement via `setFromUnitVectors`). Liftable as is.
- `components/suspension/KinematicLink.tsx` - per-frame unit-cylinder scaled to link length (`<cylinderGeometry args=[r,r,1]/>` + `scale.y = len`).
- `components/suspension/FrontCorner.tsx` (361 lines), `RearCorner.tsx` (253) - MacPherson front, multi-link rear: hub, bearing, tone ring, drilled-ish disc (two plates + 8 vane boxes), caliper (box + piston cylinder), knuckle (3 boxes), steering arm, CV joint sphere, LCA = two tubes + bushing cylinders + plate, ball joint sphere, strut = damper body + rod + dust boot + bump stop + spring seat. Quality is "educational blocky"; our look needs to be better (see B) but the structure/part list is a good checklist.
- `lib/suspension/colors.ts` - `SCENE_HEX` / `MAT` colour-per-category table (see section C).
- Weakness to avoid: it stretches the helix with `scale.y`, which squashes the wire cross-section (wire becomes elliptical). Use the constant-wire-radius shader below.
- Repo also has `catalog.ts` (part metadata), `alignment.ts`, `forces.ts` (alignment + force overlays) - not read; unverified.

Other repos seen (not opened beyond README head; licences from `gh search`):
- fordayinlife/macpherson_strut_suspension - MIT, 2026-11-13, single-file canvas diagram + half-car sim (2D, not three.js). Idea source only.
- fgrenoville/Async-Physics-Suspension-Kinematics - Apache-2.0, 42 stars, UE5/C++ MacPherson + double-wishbone planar kinematics. Maths reference only.
- robesthude-eng/car-chassis-3d - no licence listed (README Russian: VW PQ35 chassis, MacPherson + subframe) -> unclear, do not lift.
- ajstamps/KinMatKs (no licence), Dendengzel/double-wishbone-kinematics (none) - unclear.
- gkjohnson/closed-chain-ik-js - Apache-2.0 (LICENSE verified), https://github.com/gkjohnson/closed-chain-ik-js, v0.0.7 (package.json verified). Damped-least-squares IK that supports closed chains/parallel mechanisms; `closed-chain-ik/three` exports three.js helpers. Could solve a multi-link/double-wishbone closed loop generically (goal: wheel-centre height + constraints), but a hand-written analytic/Newton solver for 3-5 link spatial mechanisms is likely smaller and deterministic. Note its demo robot models carry their own (varied) licences. Keep as fallback/validation.
- Engine/piston mechanisms in three.js: elvarofficial/teardown `sims/v8-shared/engine.js` (https://github.com/elvarofficial/teardown/blob/a91262ac1109051e014662d42ecb0b7bc1f113b1/sims/v8-shared/engine.js) shows piston + conrod geometry style (cylinder/torus rings, big-end/small-end cylinders) - licence unverified; jalcocert/slider-crank (Python/Dash, not three.js). Not needed beyond inspiration.
- Rapier joint debug draw: not researched in depth (rapier's `world.debugRender()` returns line vertices/colors usable with LineSegments; unverified here) - irrelevant because we use own kinematics.

---------------------------------------------------------------------------------------------------

## B. Procedural approach (primary)

### B0. Architecture principle: only two kinds of per-frame update
1. **Rigid bodies** (upright/knuckle, wishbone arms, subframe, caliper, hub, rocker, swingarm, steering rack): build geometry ONCE in the body's rest frame, then per frame only set `mesh.matrix` from the solved hardpoints. Zero allocation.
2. **Variable-length parts** (tie rods, links, drop links, damper, spring, boots, half-shaft, anti-roll bar): re-place/stretch each frame with the two endpoint positions.

Rigid transform from rest to now using 3 non-collinear hardpoints (frame method), TS:

```ts
import * as THREE from 'three';
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/** Orthonormal frame (as Matrix4, origin at p0) from three hardpoints. */
export function frameFrom3(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, out = new THREE.Matrix4()) {
  _x.subVectors(p1, p0).normalize();
  _z.crossVectors(_x, _y.subVectors(p2, p0)).normalize();
  _y.crossVectors(_z, _x);
  return out.makeBasis(_x, _y, _z).setPosition(p0);
}
/** Call every frame: mesh must have matrixAutoUpdate=false. restInv = frameFrom3(rest...).invert() cached once. */
export function setRigid(mesh: THREE.Object3D, restInv: THREE.Matrix4, now: [THREE.Vector3, THREE.Vector3, THREE.Vector3]) {
  frameFrom3(now[0], now[1], now[2], mesh.matrix).multiply(restInv); // M = F_now * F_rest^-1
  mesh.matrixWorldNeedsUpdate = true;
}
// geometry is authored in WORLD/rest coordinates (the same space the rest hardpoints are in)
```
(Same idea as AxleLab's `KinematicGroup`, but without React; their approach re-derives positions each frame.)

### B1. Links as oriented cylinders/capsules - `tubeBetween`
One shared unit cylinder (radius 1, height 1, along +Y), per-mesh `scale=(r, len, r)`, `quaternion.setFromUnitVectors(Y, dir)`, position = midpoint. Non-uniform scale is safe for normals (three uses the normal matrix). Source pattern: AxleLab `orientY` (MIT) and three.js docs.

```ts
import * as THREE from 'three';
const Y = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false); // shared; bake end caps in if ends are visible

/** Place/stretch an existing mesh between a and b. Returns length. Handles degenerate a==b. */
export function updateTube(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius?: number): number {
  _dir.subVectors(b, a);
  const len = _dir.length();
  if (len < 1e-6) { m.visible = false; return 0; }
  m.visible = true;
  _dir.multiplyScalar(1 / len);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y, _dir);     // handles antiparallel internally in recent three
  m.scale.set(radius ?? m.scale.x, len, radius ?? m.scale.z);
  return len;
}
export function tubeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(UNIT_CYL, mat);
  updateTube(m, a, b, radius);
  return m;
}
```
Capsule look: add a shared `SphereGeometry(1,16,12)` at each end scaled by radius (also acts as the ball joint).
Instancing: only worthwhile for many identical bits (fasteners, disc vanes, bellows ridges). For instance i: `m4.compose(mid, quat, new Vector3(r,len,r)); inst.setMatrixAt(i, m4)`. A car's link count (<80) does not need it; do batch by shared geometry + shared material.
Radius range for a premium look: use slightly exaggerated tubes (rod-end rings, bushing sleeves) - see B2.

### B2. Control arms (A-arm / wishbone / trailing link)
Arm is rigid -> build once in rest frame, move with `setRigid` (B0).
Option 1 (cheap, reads as a real tubular wishbone): two tubes from outer ball joint BJ to inner pivots F and R, plus a cross brace if needed; sphere at BJ (radius ~ 0.03 of car scale); bushing sleeve = cylinder along the pivot axis (F->R direction; sleeve radius 1.6-2x tube radius, rubber colour) at each inner pivot. AxleLab does exactly this.
Option 2 (stamped steel / cast-alloy look): triangular plate:
```ts
// project the 3 hardpoints into the arm plane (u,v) and extrude with bevel
export function armPlateGeometry(F: THREE.Vector3, R: THREE.Vector3, BJ: THREE.Vector3, thick = 0.012, pad = 0.02) {
  const u = new THREE.Vector3().subVectors(R, F).normalize();
  const n = new THREE.Vector3().crossVectors(u, new THREE.Vector3().subVectors(BJ, F)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const P = [F, R, BJ].map(p => new THREE.Vector2(p.clone().sub(F).dot(u), p.clone().sub(F).dot(v)));
  // rounded triangle = hull of circles around corners: sample 10 points per corner
  const pts: THREE.Vector2[] = [];
  P.forEach(c => { for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; pts.push(new THREE.Vector2(c.x + pad * Math.cos(a), c.y + pad * Math.sin(a))); } });
  const hull = hull2D(pts);                                  // monotone chain, ~15 lines, own code
  const shape = new THREE.Shape(hull);
  P.forEach(c => { const h = new THREE.Path(); h.absarc(c.x, c.y, pad * 0.45, 0, Math.PI * 2, true); shape.holes.push(h); }); // lightening/bush holes
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  const basis = new THREE.Matrix4().makeBasis(u, v, n).setPosition(F);   // plane -> world
  return g.applyMatrix4(basis);                                          // geometry is now in the rest (world) frame
}
```
(The same `plate` recipe makes rocker/bell-cranks, dog-bones, steering arms, motorcycle rear-linkage plates: Shape from hull of hardpoint circles + holes at hardpoints.) `Shape/Path/ExtrudeGeometry` docs: https://threejs.org/docs/pages/ExtrudeGeometry.html.
Ball joints/rod ends: sphere + short cylinder "stud" along the link; bushings: `CylinderGeometry` + dark rubber + steel inner sleeve (cylinder of smaller radius, longer).

### B3. Upright / knuckle: convex hull around hardpoints
`ConvexGeometry` is in three addons (verified, source fetched): `import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'`, takes `Vector3[]`, non-indexed, flat face normals, uses `ConvexHull` (O(n log n)). https://github.com/mrdoob/three.js/blob/dev/examples/jsm/geometries/ConvexGeometry.js
Key trick: the hull of raw hardpoints is a thin sliver. Inflate each hardpoint into a small sphere sample so the hull becomes a chunky "sausage-blended" casting; add hub-flange ring points for the wheel end. Build ONCE in rest frame, drive with `setRigid`.

```ts
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

function fibSphere(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = g * i;
    out.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r)); }
  return out;
}
export interface Hardpoint { p: THREE.Vector3; rho: number }  // rho = local thickness (ball joint pad ~0.018, hub ~0.05)
/** Rigid upright from: lower BJ, upper BJ (or strut clamp), tie-rod outer, wheel centre/axle points, trailing-link pickups... */
export function uprightGeometry(hp: Hardpoint[], sphereN = 14, creaseDeg = 35): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [], S = fibSphere(sphereN);
  for (const { p, rho } of hp) for (const s of S) pts.push(p.clone().addScaledVector(s, rho));
  const g = new ConvexGeometry(pts);                    // flat-shaded hull
  return toCreasedNormals(g, THREE.MathUtils.degToRad(creaseDeg)); // soft normals on shallow edges, crisp on sharp ones
}
```
Tips: (1) a pure hull is convex -> add the brake-disc/caliper as separate meshes; a concave strut-clamp "ear" can be a second hull unioned visually (overlapping meshes are fine). (2) Wheel-hub axis: add 2 hardpoints on the spindle axis (inboard/outboard) with rho 0.05 and 0.035. (3) Hull needs >= 4 non-coplanar points. (4) The result is ~100-250 triangles - fine. (5) For a machined look give it `metalness .8 roughness .35` and a subtle clearcoat-less PBR; envMap does the work.
Alternative: lofted shape via `ExtrudeGeometry` with path; hull is quicker and organic.

### B4. Coil spring - helix tube; constant wire radius under length change
**Naive (what AxleLab does)**: rebuild none, `scale.y = len/len0` -> wire is squashed (cross-section ellipse), coil radius ok. Not acceptable for close-ups.

**Math** (axis = local +Y, turns N, coil mean radius R, wire radius r, current length L, omega = 2*pi*N):
- centreline `C(t) = ( R cos th, L t, R sin th )`, `th = omega t`, t in [0,1]  (pitch p = L/N)
- tangent  `T = (-R omega sin th, L, R omega cos th)/m`, `m = sqrt(R^2 omega^2 + L^2)`
- radial `e_r = (cos th, 0, sin th)` is EXACTLY perpendicular to T (their dot is 0), so no Gram-Schmidt needed.
- binormal `b = T x e_r = (L sin th, R omega, -L cos th)/m`  (unit length; verified numerically).
- surface vertex `P = C + r (cos phi e_r + sin phi b)`, normal `n = cos phi e_r + sin phi b`  (phi around the wire in [0, 2pi]).
Because the cross-section is built in the plane normal to T, the wire radius stays r for any L - only pitch changes. Solid height limit: `L >= 2 r N` (+dead coils); clamp so coils never interpenetrate (spring coil-bind = bump-stop feel).
Optional ground/dead end coils: use a piecewise y(turns): first/last `Nd` turns have slope `2r` per turn (touching), the middle `Na` turns slope `(L - 4 r Nd)/Na`; then `dy/dt = slope*Ntot` in the tangent. Same formulas otherwise.

**GPU version** (one geometry shared by all springs, update = 1 uniform; zero CPU rebuild). Geometry has only `aT` (t) and `aPhi` attributes (+dummy `position` so count/bounds exist; set `frustumCulled=false` because the real position lives in the shader - same caveat noted in Codrops GPU-tube article https://tympanus.net/codrops/2026/09/07/drawing-with-light-an-exploration-of-lit-gpu-tubes-with-tsl-and-webgpu/ ). Keep PBR via `onBeforeCompile` on MeshStandardMaterial / MeshPhysicalMaterial (chunk names `beginnormal_vertex`, `begin_vertex` exist in the current WebGL renderer; re-check on three upgrade; Migration guide https://github.com/mrdoob/three.js/wiki/Migration-Guide).

```ts
import * as THREE from 'three';

export interface SpringSpec { turns: number; coilR: number; wireR: number; restLen: number; tubular?: number; radial?: number; }

export function springGeometry(s: SpringSpec): THREE.BufferGeometry {
  const nT = s.tubular ?? Math.ceil(s.turns * 28), nP = s.radial ?? 8;
  const aT: number[] = [], aPhi: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nT; i++) for (let j = 0; j <= nP; j++) { aT.push(i / nT); aPhi.push((j / nP) * Math.PI * 2); }
  for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) {
    const a = i * (nP + 1) + j, b = (i + 1) * (nP + 1) + j, c = b + 1, d = a + 1;
    idx.push(a, d, b, b, d, c);                              // winding verified outward numerically
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(aT.length * 3), 3)); // dummy
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aPhi', new THREE.Float32BufferAttribute(aPhi, 1));
  g.setIndex(idx);
  return g;
}

export function springMaterial(s: SpringSpec, base: THREE.MeshStandardMaterial) {
  const U = { uLen: { value: s.restLen }, uN: { value: s.turns }, uR: { value: s.coilR }, ur: { value: s.wireR } };
  base.userData.springU = U;
  base.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aT; attribute float aPhi;
        uniform float uLen, uN, uR, ur;
        vec3 sp_er, sp_b; 
        void springFrame(float t, out vec3 C, out vec3 er, out vec3 b){
          float w = 6.28318530718 * uN, th = w * t;
          er = vec3(cos(th), 0.0, sin(th));
          float m = sqrt(uR*uR*w*w + uLen*uLen);
          b  = vec3(uLen*sin(th), uR*w, -uLen*cos(th)) / m;
          C  = vec3(uR*er.x, uLen*t, uR*er.z);
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec3 spC, spE, spB; springFrame(aT, spC, spE, spB);
        vec3 objectNormal = cos(aPhi)*spE + sin(aPhi)*spB;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = spC + ur * objectNormal;`);
  };
  return base;
}

const _d = new THREE.Vector3(); const Y = new THREE.Vector3(0, 1, 0);
/** a = lower seat, b = upper seat (world or parent space). Spring mesh origin sits at a, +Y toward b. */
export function updateSpring(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, s: SpringSpec) {
  _d.subVectors(b, a);
  const L = Math.max(_d.length(), 2 * s.wireR * (s.turns + 1)); // coil-bind clamp
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(Y, _d.normalize());
  ((mesh.material as THREE.Material).userData.springU.uLen).value = L;
}
```
Caveats: material uniforms are per-material -> one material instance per spring (4 corners = 4 cheap materials; `material.clone()` does not copy `onBeforeCompile`, so call `springMaterial` per corner) or use a per-mesh `onBeforeRender` to set a shared uniform. Set `mesh.frustumCulled = false`. For shadows, a matching `customDepthMaterial` is needed (the depth pass would otherwise render the dummy zero positions) - or disable cast shadow on springs. `USE_TANGENT` handling is only for normal-map materials; drop if unused. The `sp_er/sp_b` globals in the snippet are unused - delete them.

**CPU alternative** (simplest, fully correct incl. shadows/raycasts): keep one `BufferGeometry`, loop writing `position`/`normal` arrays with the same formulas each frame (e.g. 190x9 ≈ 1.7k verts per spring ≈ 7k verts for 4 corners: negligible), set `needsUpdate = true`, `computeBoundingSphere()` only occasionally. Prefer CPU if shadows matter, GPU if you want to drive many springs/zero JS cost. Both options give identical shape.
Spring-vs-damper placement: coilover spring length = damper length - (seat offset low + seat offset high); lower seat rides on the damper body, upper seat on the rod end.

### B5. Damper / strut: telescoping two-cylinder
Body (outer, bigger radius, fixed length Lb) hangs from the lower end; rod (small radius, chrome, fixed length Lr) from the upper end; the visible rod = how far the body has "extended". Piston overlap implicit.
```ts
export function updateDamper(body: THREE.Mesh, rod: THREE.Mesh, a: THREE.Vector3 /*lower mount*/, b: THREE.Vector3 /*upper mount*/,
                             Lb: number, Lr: number, rb: number, rr: number) {
  const L = a.distanceTo(b);
  const d = new THREE.Vector3().subVectors(b, a).normalize();
  const bodyEnd = a.clone().addScaledVector(d, Math.min(Lb, L));
  const rodStart = b.clone().addScaledVector(d, -Math.min(Lr, L));
  updateTube(body, a, bodyEnd, rb);
  updateTube(rod, rodStart, b, rr);
  // rod always overlaps body as long as L <= Lb+Lr ; clamp L at stroke limits in the kinematics (bump stop / rebound stop)
}
```
Extras: dust boot = lathe bellows (AxleLab `bootGeometry`) scaled in Y between rod top and body top; bump stop = short rubber cylinder that scale-s when compression passes a threshold (AxleLab); top mount = rubber puck + bearing plate; reservoir (remote-reservoir/Ohlins look) = capsule + hose as `TubeGeometry` of a CatmullRom between two points (rebuild at low rate or skip). MacPherson strut = body lower end bolted to upright via clamp ears (two small boxes) - body axis goes from upright clamp hardpoint to top mount hardpoint.
Motorcycle telescopic/USD fork: same function twice: stanchion (inner, gold anodised/chrome, USD: stanchion at the TOP, big slider/"lower leg" at the bottom with axle lug) and slider; travel = overlap change. Twin-shock: two coilover units, rigid swingarm. Monoshock: damper between frame pickup and rocker (a `plate` from B2).

### B6. Brake disc, caliper, hub
Disc (rotor) with drilled holes - ExtrudeGeometry with holes + Lathe hat:
```ts
export function brakeDiscGeometry(Ro = 0.16, Ri = 0.105, t = 0.03, nHoles = 36, holeR = 0.0045, rings = 2) {
  const shape = new THREE.Shape(); shape.absarc(0, 0, Ro, 0, Math.PI * 2, false);
  const hub = new THREE.Path(); hub.absarc(0, 0, Ri, 0, Math.PI * 2, true); shape.holes.push(hub);
  for (let k = 0; k < rings; k++) for (let i = 0; i < nHoles; i++) {
    const a = (i + k * 0.5) / nHoles * Math.PI * 2, rr = Ri + (Ro - Ri) * (0.35 + 0.3 * k);
    const h = new THREE.Path(); h.absarc(Math.cos(a) * rr, Math.sin(a) * rr, holeR, 0, Math.PI * 2, true); shape.holes.push(h);
  }
  const ring = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 32 });
  ring.translate(0, 0, -t / 2);
  // hat/bell: lathe profile (x=radius, y=axial), revolve around Y then rotate to Z axis
  const prof = [[Ri,0],[Ri,0.035],[0.075,0.045],[0.045,0.045],[0.045,0.02],[0.03,0.02],[0.03,0]].map(([x,y]) => new THREE.Vector2(x,y));
  const hat = new THREE.LatheGeometry(prof, 48).rotateX(Math.PI / 2);
  return [ring, hat];   // merge with BufferGeometryUtils.mergeGeometries if same material, then rotateY(PI/2) so axis = wheel X
}
```
Slotted variant: ring holes as thin rotated rectangles (Path with moveTo/lineTo). Vented: 2 plates + instanced vane boxes (AxleLab uses 8 vanes; use ~36 via InstancedMesh).
Caliper: annular-sector extrude that wraps the rim (reads instantly as a caliper), plus pistons as cylinders and a bleed nipple:
```ts
export function caliperGeometry(Rin = 0.145, Rout = 0.185, span = 0.5 /*rad*/, width = 0.07) {
  const s = new THREE.Shape();
  s.absarc(0, 0, Rout, -span, span, false); s.absarc(0, 0, Rin, span, -span, true); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 3, curveSegments: 24 })
    .translate(0, 0, -width / 2);   // wraps the disc rim; rotate so the gap straddles the disc plane
}
```
Colour caliper in a saturated colour (red/yellow/blue = performance cue; see C). RoundedBoxGeometry (`three/addons/geometries/RoundedBoxGeometry.js`) works for the mounting bracket.
Wheel hub: stack of cylinders (flange r 0.055, h 0.02; bearing neck; 5 wheel studs as small cylinders with `InstancedMesh`). Half-shaft: `tubeBetween(innerCV, outerCV)`, CV joints = spheres (tripod housing = cylinder), CV boots = Lathe bellows (AxleLab `bootGeometry(len, rMin, rMax, convolutions)`) oriented/scaled along the shaft by `updateTube`-style placement (scale Y only, radius fixed by x/z scale). Anti-roll bar: below. Steering rack: housing cylinder (long, fixed) + exposed rack bar (cylinder, translated in X by rack travel) + rubber gaiters (lathe, scale X) + tie-rods as `updateTube` between rack end ball and knuckle steering-arm ball. Subframe: boxy tubes (`tubeBetween` or RoundedBox) in dark steel; rigid.

### B7. Anti-roll bar (bent tube) with drop links
Centreline in car frame = torso along Y(car lateral) with two bends to arms:
```ts
export function arbCurve(halfW: number, armLen: number, armAngL: number, armAngR: number, x0 = 0, z0 = 0) {
  const arm = (side: 1 | -1, ang: number) => new THREE.Vector3(x0 - armLen * Math.cos(ang), 0 + armLen * Math.sin(ang), z0 + side * halfW); // pivot about torso axis
  const pts = [arm(-1, armAngL), new THREE.Vector3(x0, 0, z0 - halfW), new THREE.Vector3(x0, 0, z0 + halfW), arm(1, armAngR)];
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);   // add bend points (corner-radius) for nicer elbows
}
// geometry = new THREE.TubeGeometry(arbCurve(...), 64, 0.011, 10, false)  -> rebuild when roll changes (≤30 Hz, dispose old) 
```
Arm angles come from the kinematics: arm end height = drop-link attachment on lower arm/strut, so `angL ≈ asin(dzL/armLen)`. Torsion is visible as differing arm angles. Drop links = `updateTube` between bar arm end and the suspension pickup, with ball-joint spheres. Make the bar `arb` colour (C). Cheaper rigid alternative: torso tube static + 2 arm tubes rotating about the torso axis (no geometry rebuild).

### B8. Coil spring helper tutorials/sources on the web (for completeness)
- hofk (THREEf.js) coil spring example linked from https://discourse.threejs.org/t/create-a-spring/45135 and https://discourse.threejs.org/t/draw-a-mechanical-spring/7309 - licence not stated on those pages (unverified; do not lift; the maths above is trivial to own).
- three.js `TubeGeometry` source (verified): https://github.com/mrdoob/three.js/blob/de6e32e679f4f18bbac26953c44ea98c145be67f/src/geometries/TubeGeometry.js (MIT, three.js).
- Codrops GPU tubes (TSL): tangent-only frame in shader, branchless orthonormal basis (Duff et al.) - useful only if the project moves to WebGPU/TSL; our helix has the exact analytic frame so we do not need it.

---------------------------------------------------------------------------------------------------

## C. Colour-coding, materials, and labelling

### C1. Conventions (sources: AxleLab `colors.ts` MIT, verified; the real-world conventions listed below are general knowledge, not from a standard - unverified)
There is no ISO/SAE standard for suspension part colours. De-facto engineering-illustration/cutaway and aftermarket conventions: coil springs = saturated accent (yellow, red, orange); dampers = blue or gold/yellow bodies with chrome rod; control arms/links = neutral steel/silver; anti-roll bars = red or black; bushings/rubber = dark grey/black; steering parts = orange; brake caliper = red/yellow/blue, disc = dark iron; hub/knuckle = cyan-teal or cast grey; subframe = dark steel; wheel = light silver.
AxleLab palette (MIT, directly liftable; hex + metalness/roughness): spring #e2c114 (m .55 r .32) | damper #2f62b0 (.72/.30) | arm #c5c9d0 (.82/.28) | arb #c43333 (.55/.38) | bushing #2c2f34 (.05/.85) | steering #d4782a (.55/.40) | hub #3ec8d8 (.70/.28) | brake #7a2222 (.45/.45) | subframe #3a3e46 | fastener #8d9198 | chassis #4d5563 | tire #14161a | wheel #b7bcc4 | drivetrain #6e7380 | sensor #c9d4de | rubber #1c1e22.
Force-arrow colours from same file: weight #d0d4dc, vertical #6fa37a, spring #e2c114, damper #5b8fd4, brake #c45c5c, cornering #d4782a, long #9eb0c4, lat #c9a06a.
Our recommendation for a "premium cinematic" look (opinion): keep the palette but desaturate the neutral metals, keep spring/damper/ARB/steering as the 4 accent hues, and give the car body a dark/semi-transparent "x-ray" so accents pop; use emissive (not colour change) for stress/active highlighting (e.g. damper velocity glows, spring colour shifts hotter with compression).

### C2. X-ray / readability techniques
- Suspension meshes: `depthTest: true`, normal; the body shell goes through a fresnel/transparent material (`transparent`, `depthWrite:false`, `renderOrder` lower) or a clipping plane when the camera enters x-ray mode.
- Dark outline-less look: rely on envMap + AO; a thin back-face silhouette (inverted hull, scale 1.03, `side: BackSide`, flat dark) cheaply separates overlapping silver parts.
- Hardpoint markers: small emissive spheres (instanced) at pickup points; instant mechanical readability.
- Motion cues: ghost the rest-position (wireframe/transparent copy), draw instant-centre/roll-centre lines with `Line2`/`LineSegments`.

### C3. Labelling parts
- HTML labels: `CSS2DRenderer` + `CSS2DObject` (three/addons/renderers/CSS2DRenderer.js) parented to the part's mesh at the hardpoint; leader line = `LineSegments` from hardpoint to label anchor (or a CSS pseudo-element). Show on hover/selection or in "labels" mode only; fade by camera distance; cap at ~8 labels; reserve a text-halo/outline for contrast on busy backgrounds.
- Picking: `Raycaster` against the part meshes (each mesh `userData.partId`); AxleLab keeps `Selectable id/category` wrapper with a part catalog (name/function/materials) -> same data model is a good swappable module: `catalog.ts` (id -> {label, function, category}) + `colors.ts` (category -> material).
- Legend: colour-chip legend per category (AxleLab `LEGEND`).

---------------------------------------------------------------------------------------------------

## Recommendations for Suspension Lab
1. Go fully procedural. Rigid parts (arms, upright, subframe, caliper, hub, rockers, swingarm) are generated once in rest frame and moved by a 3-point frame transform each tick; only links, dampers, springs, boots, ARB change shape. Zero heavy geometry rebuilds per frame.
2. Core module `parts/` exports: `tubeBetween/updateTube`, `setRigid`, `uprightGeometry` (ConvexGeometry + spherical padding + `toCreasedNormals`), `armPlateGeometry`/plate helper, `springGeometry/springMaterial/updateSpring`, `updateDamper`, `brakeDiscGeometry`, `caliperGeometry`, `bootGeometry`, `arbCurve`. Swappable per suspension type via a hardpoint config.
3. Springs: use the constant-wire-radius formula (e_r ⟂ T closed form; b=(L sin th, R w, -L cos th)/m). GPU/onBeforeCompile for speed, CPU in-place buffer write if shadows are needed; always clamp L >= 2rN so coils bind visibly.
4. Reuse MIT code from KRoshanK/AxleLab: `geometry.ts` (orientY, bootGeometry, Lathe CV boots), `colors.ts` palette, part-catalog/legend pattern; keep MIT copyright notice in the file header. Fix its squash-scaled spring with B4.
5. Do not spend time on external suspension GLBs: nothing found is both licensed and downloadable; Sketchfab CC-BY candidates (MacPherson strut by VR DESIGNER) need a human login and are static single assemblies. If a hero caliper/disc is wanted, ask a human to fetch a CC0/CC-BY one and attribute it.
6. Kinematics: hand-written solver (analytic for 4-bar-like double wishbone/MacPherson, Newton for multi-link) is simpler than gkjohnson/closed-chain-ik-js (Apache-2.0); keep that library as an optional cross-check or for generic parallel linkages (steering + suspension coupling).
7. Visual language: AxleLab-style category colours (spring yellow, damper blue, arms silver, ARB red, steering orange, hub teal, rubber black) with emissive state cues, ghost rest pose, hardpoint markers, CSS2D labels on demand, x-ray body shell.
8. Verify on first implementation: normal-shading of the GPU spring under `onBeforeCompile` for the pinned three.js version; shadows for shader-driven geometry (customDepthMaterial); winding for ExtrudeGeometry-based discs after rotation.
