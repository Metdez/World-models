# 19 - Driving VFX that communicate vehicle dynamics (three.js / WebGLRenderer / GLSL)

Scope: tyre marks, smoke/dust/spray, brake glow, lights, wheel blur, force arrows and friction rings, ghost car, subtle speed cues.
Method note: Firecrawl not used (503 reported); Tavily search + direct `raw.githubusercontent.com` fetches. Code quoted below was read from source.
Marking: [S] sourced, [E] estimate/engineering judgement. Licence column is what the repo's LICENSE file / GitHub header shows.

## 1. Sources reviewed (what we can steal)

| Repo | URL | Stars (approx) | Licence | Usable? |
|---|---|---|---|---|
| pmndrs/racing-game | https://github.com/pmndrs/racing-game (`src/effects/Skid.tsx`, `Dust.tsx`) | ~2.2k [S] | MIT (LICENSE.md, "Copyright 2021 pmdrs, contributors"); assets CC0 [S] | Yes, but code is naive (see 2.1) - copy ideas, not code |
| brunosimon/folio-2025 | https://github.com/brunosimon/folio-2025 (`sources/Game/Tracks.js`) | ~1.9k [S] | MIT (license.md, (c) 2025 Bruno Simon) | Yes. Architecture is excellent; code is WebGPU/TSL so re-express in GLSL |
| brunosimon/folio-2019 | https://github.com/brunosimon/folio-2019 | ~4.7k [S] | MIT shown by GitHub (license.md) | Yes; older, WebGL, cannon-based; little tyre VFX of interest |
| Alchemist0823/three.quarks | https://github.com/Alchemist0823/three.quarks (v0.18.0 on npm) | ~1.2k [S] | MIT (LICENSE, (c) 2019 Forrest Sun) | Yes as a dependency or reference for `TrailBatch` ribbon shader. Overkill for us; see section 7 |
| mrdoob/three.js | https://github.com/mrdoob/three.js | huge | MIT | Yes: `DecalGeometry`, `InstancedMesh`, `webgl_buffergeometry_drawrange`, `webgl_buffergeometry_instancing_billboards` |
| three-nebula (creativelifeform) | https://github.com/creativelifeform/three-nebula | not verified | Repo LICENSE path 404 on `master`; npm says MIT from memory [E]. Verify before any use | Skip (CPU particle engine, allocation-heavy) |

Folio-2025 note: bruno-simon.com now runs the WebGPU build (`three/webgpu`, TSL). Suspension Lab is WebGLRenderer + GLSL, so lift the data layout and idea, not the node code.

## 2. Skid marks / tyre trails

### 2.1 What pmndrs does (MIT) - and why not to copy it
`src/effects/Skid.tsx`: an `InstancedMesh` of 500 black `planeGeometry(0.4, 0.8)` quads, `meshBasicMaterial color black transparent opacity 0.5 depthWrite false`. Each frame while `brake && speed > 10` it stamps one quad per rear wheel at the wheel world position with the chassis rotation, ring-indexed (`index++; if (index === count) index = 0`), and sets `instanceMatrix.needsUpdate = true`.
Core:
```ts
setItemAt(ref.current!, e, wheels[2].current, index++)
setItemAt(ref.current!, e, wheels[3].current, index++)
if (index === count) index = 0
// setItemAt: o.position.copy(wheel.getWorldPosition(v)); o.rotation.copy(rotation); o.scale.setScalar(1); o.updateMatrix(); instances.setMatrixAt(index, o.matrix)
```
Weaknesses for us [E]: triggered by brake key and speed, not by slip (the thing we want to teach); stamps per frame so spacing depends on frame rate/speed (gaps at speed, overdraw when slow); quads oriented by chassis not by wheel velocity (a drift mark would point the wrong way); no fade; flat quads z-fight/float on a bumpy `roadHeight`; uploads the whole instance matrix buffer every frame.
`Dust.tsx` (same repo) is the same pattern with 200 sphere instances (10x10 segments, opacity 0.1), `intensity = lerp(intensity, (sliding||brake) * speed / 40, delta*8)`, spawn throttled to every 0.02 s, and a CPU loop over all instances every frame doing `getMatrixAt/decompose/setMatrixAt` to shrink scale by 0.005. That O(N) matrix decompose per frame is exactly what to avoid; do the shrink in the vertex shader from a per-instance birth time instead (section 3).

### 2.2 What folio-2025 does (MIT) - the pattern to adopt
`Tracks.js` has two classes. Quoted essentials:

Per-wheel `Track`: a 128-texel RGBA float `DataTexture` used as a ring of points (xyz = world position, w = "touching" 0/1 contact alpha).
```js
this.subdivisions = 128
this.dataTexture = new THREE.DataTexture(new Float32Array(this.subdivisions*4), this.subdivisions, 1, THREE.RGBAFormat, THREE.FloatType)
this.trail.geometry = new THREE.PlaneGeometry(1, 1, this.subdivisions, 1)   // ribbon = 128 quads, 1 draw call
// update(): throttle by time (1/30 s) AND distance (0.2 m); then shift data one texel (not a true ring: memmove of 128*4 floats)
for (let i = this.subdivisions - 1; i >= 0; i--) { const i4 = i*4; data[i4]=data[i4-4]; ... data[i4+3]=data[i4-1] }
data[0]=_position.x; data[1]=_position.y; data[2]=_position.z; data[3]=_touching?1:0
this.dataTexture.needsUpdate = true
```
The vertex shader samples the data texture (vertex texture fetch) at the vertex's `uv.x`, takes the direction from the previous texel (`atan(z - zPrev, x - xPrev)`), offsets perpendicular by `thickness`, and the fragment fades by `endAlpha = smoothstep(0.5, 1, uv.x)` inverted (age fade), `startAlpha`, `contactAlpha` (data.w), and a soft edge `1 - |2*(uv.y-0.5)|`.
`Tracks` then renders all trails additively into a 512x512 orthographic top-down `RenderTarget` (40 m window following the focus point, camera at y=5, looking down, R/G/B channel per track kind) and the terrain shader samples that texture to darken/disturb the ground. That is a "decal by render target" approach: no per-mark geometry on the road, works on any road shape and bumps, cost independent of mark count.

### 2.3 Options compared for Suspension Lab [E unless noted]
| Approach | Draw calls | Conforms to bumpy road | Per-frame cost | Verdict |
|---|---|---|---|---|
| Instanced quad stamps (pmndrs) | 1 | No (flat quads) | O(N) upload | Skip |
| `DecalGeometry` per mark (three.js addon, MIT) | 1 per mark | Yes (clips to mesh) | CPU geometry build per mark, allocation heavy [S: docs say it projects onto a mesh and distorts at corners] | Skip for streaming marks; fine for one-off impact marks |
| Ribbon mesh per tyre, CPU-written ring buffer, `drawRange`/index wrap | 1 per tyre (4, or 2) | Yes, if each point's y comes from `roadHeight(s,lat)` + 2 mm | Small `needsUpdate` upload of the touched slice | Good, simplest, no float-texture dependency |
| Folio-2025 data-texture ribbon (GPU builds quad from texel) | 1 per tyre | Yes, y stored in texel | 128x4 floats per tyre upload (2 KB) | Good, trivially zero-alloc |
| Top-down mark render target sampled by road shader | 0 extra on road; 4 ribbons into RT | Yes (it is a texture) | one 512^2 RT pass (cheap) [E ~0.1-0.2 ms] | Best if the road is ONE shader we own; also gives persistent marks and wet/dry |

Recommendation: our road is analytic `roadHeight`, rendered as our own mesh, so (a) ribbon per tyre with ring-buffer vertex attributes is the lowest-risk baseline; (b) top-down RT is an upgrade if we want marks to outlive the 128-point window. Don't do both.

### 2.4 Recommended ribbon implementation (zero-allocation, GLSL, WebGLRenderer)
Design: one `BufferGeometry` per tyre with fixed `N = 256` segments (512 vertices, 2 per sample: left/right edge). Attributes: `position` (Float32, DynamicDrawUsage), `aSlip` (Float32 per vertex, intensity 0..1), `aBirth` (Float32 per vertex, sim time). Index buffer is static (`0,1,2, 1,3,2 ...`), with the ring seam handled by `drawRange`-split into two ranges OR by writing a degenerate segment (alpha 0) at the head so the wrap needs no second draw. Per-frame: when moving >= 0.15 m since the last emitted sample (distance-throttled like folio) AND slip > threshold, write 2 vertices at `head`, `head = (head+1) % N`, and call `attr.addUpdateRange(offset, 6)` (three r160+) + `needsUpdate = true` so only 6 floats upload.
```ts
// module scope, reused every frame (no `new` in the loop)
const _l = new Float32Array(3), _r = new Float32Array(3);
class TyreTrail {
  head = 0; lastX = Infinity; lastZ = Infinity; N = 256;
  constructor(readonly geo: THREE.BufferGeometry, readonly pos: Float32Array, readonly slip: Float32Array, readonly birth: Float32Array) {}
  push(x:number,y:number,z:number, dirX:number,dirZ:number, halfW:number, slip01:number, tNow:number) {
    const dx=x-this.lastX, dz=z-this.lastZ;
    if (dx*dx+dz*dz < 0.0225) return;           // 0.15 m spacing [E]
    this.lastX=x; this.lastZ=z;
    const inv = 1/Math.hypot(dirX,dirZ);        // use CONTACT-PATCH VELOCITY direction, not chassis heading
    const nx = -dirZ*inv*halfW, nz = dirX*inv*halfW;
    const i = this.head*2;                      // 2 verts per sample
    const p = this.pos;
    p[i*3]=x+nx; p[i*3+1]=y+0.002; p[i*3+2]=z+nz;
    p[i*3+3]=x-nx; p[i*3+4]=y+0.002; p[i*3+5]=z-nz;
    this.slip[i]=this.slip[i+1]=slip01; this.birth[i]=this.birth[i+1]=tNow;
    this.head=(this.head+1)%this.N;
    // mark dirty: three r160+ API
    (this.geo.attributes.position as THREE.BufferAttribute).addUpdateRange(i*3, 6);
    ...same for aSlip, aBirth; then needsUpdate = true on each
  }
}
```
Break the ribbon when the tyre is not skidding (write a sample with `aSlip = 0` and make the shader discard `< 0.02`), otherwise a ribbon joins two separate skids. Dirty-range upload is a few dozen bytes per tyre per frame [E].
Fragment (GLSL): fade by age and encode slip so the lesson is visible in the mark itself:
```glsl
uniform float uTime; uniform float uLife; // e.g. 25 s [E]
varying float vSlip, vBirth; varying vec2 vUv;
void main(){
  float age = (uTime - vBirth) / uLife;
  float edge = 1.0 - abs(vUv.y*2.0-1.0);            // soft rubber edges (folio-style)
  float a = smoothstep(0.02,0.25,vSlip) * (1.0-smoothstep(0.6,1.0,age)) * smoothstep(0.0,0.35,edge);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.02), a*0.55);           // premultiplied if using PremultipliedAlpha
}
```
Material: `transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2`, `renderOrder` just after the road. This avoids z-fight without needing a visible y gap on bumps [E].
Intensity by slip: a mark appears only above a slip threshold (e.g. combined slip ratio/angle above ~0.12-0.15 normalised [E]; align with whatever grip-circle utilisation the sim-core already exposes). Darkness ~ utilisation; mark width stays constant. Locked wheel under braking = straight dark mark; understeer = front marks arc outwards; oversteer = rear marks; this is the teaching content.
Cost [E]: 4 draw calls, 4 x 512 vertices, trivial vertex load; CPU ~ a few hundred float writes/frame; no allocations.

## 3. Tyre smoke, dust, gravel, water spray

### 3.1 Techniques
- GPU-instanced billboard particles, state in per-instance attributes, simulated in the vertex shader from `(aBirth, aOrigin, aVel)`: position = origin + vel*age + 0.5*g*age^2, size/alpha from age. CPU only writes spawn records into a ring buffer (`aOrigin`, `aVel`, `aBirth`, `aSeed`) - never touches live particles. This is what pmndrs' O(N) `getMatrixAt/decompose` shrink loop should have been.
- Use `InstancedBufferGeometry` with a quad (three.js example `webgl_buffergeometry_instancing_billboards` [S], MIT) and a custom `ShaderMaterial`; or `THREE.Points` with `gl_PointSize` (simpler, but point size is clamped by hardware, typically ~64-256 px and no rotation; fine for dust, poor for big smoke).
- Soft particles: sample the scene depth texture in the fragment shader and fade by `saturate((sceneDepth - fragDepth) * k)`. Needs a depth texture (extra render of depth or `WebGLRenderTarget.depthTexture`); in WebGL2 this costs a full depth-copy/prepass [E ~0.3-1 ms at 1080p]. For ground-hugging smoke/dust viewed from above-behind, fake it instead: fade alpha by `smoothstep(0, h, worldY - roadY)` using the known road height (we have `roadHeight` analytically). Cheaper and no depth texture. Recommended.
- Tyre smoke drivers: emission rate ~ `max(0, slipUtil - 0.8)` x speed; colour white-grey, size grows 0.4 -> 1.8 m over ~1.2 s, alpha 0.25 peak, drag-decelerated, slight buoyancy [E]. Do NOT emit on every braking event; emit only when the tyre is past its friction limit (this is the signal).
- Dust/gravel: spawn on lateral slip over loose-surface patches; velocity = tyre contact-patch slip velocity direction + noise; tiny 3D-ish sprites, gravity, bounce-off ignored. Two instanced systems of ~256 each is plenty [E].
- Water spray (wet low-grip): a stretched billboard aligned to the velocity (elongated along velocity in the vertex shader), thin and low alpha, emitted from each tyre's rear/outer edge in proportion to speed*wetness; plus a faint fine mist trail behind the car. Keep cheap: 128-256 particles, additive-ish low alpha, no refraction.
- A small texture helps: one 64x64 soft-noise puff in a 4-cell atlas, random cell per particle. Procedural alternative: gaussian * 2-octave value noise in the fragment shader (no texture).
Cost [E]: 3 systems x ~256 instances = 768 quads, overdraw is the real cost (large transparent smoke at 1080p); cap smoke screen size and fade to 0 by 1.2 s; set `depthWrite:false`, sort not needed if additive or low alpha.

### 3.2 Zero-allocation ring spawn
```ts
// one reusable typed-array ring; no objects per particle
spawn(ox,oy,oz, vx,vy,vz, t, seed){
  const i=this.head; this.head=(this.head+1)%this.N;
  this.origin.setXYZ(i,ox,oy,oz); this.vel.setXYZ(i,vx,vy,vz);
  this.birth.setX(i,t); this.seed.setX(i,seed);
  this.dirty = true;          // after all spawns this frame: addUpdateRange for the touched span + needsUpdate once
}
```
Vertex shader reads `uTime - aBirth`; dead particles (`age > uLife`) are collapsed with `gl_Position = vec4(2.,2.,2.,1.)` (outside the clip volume). Spawn counts per frame are small (0-6), so uploads are tiny.
three.quarks (MIT, v0.18.0) already implements GPU-batched particles plus a `TrailBatch` ribbon shader for WebGL (`TrailBatch.ts`, `ShaderMaterial` with `trail_vert.glsl`/`trail_frag.glsl`, additive default) [S]. Use it only if we want an editor/JSON workflow; adding a dependency, its own behaviours/update loop and BatchedRenderer for ~3 effects is more weight than ~120 lines of our own shader [E]. three-nebula: skip.

## 4. Brake-disc glow, brake lights, reverse lights

- Disc glow: a flat emissive ring (or just a material swap) visible through the wheel spokes, driven by a lumped thermal estimate, not by instantaneous brake input: `dT/dt = (P_brake)/(m_disc*c) - h*(T-Tamb)`; mapped to emissive colour via a blackbody-ish ramp starting ~ 500-600 C dull red [E]. Honest framing: label as "approximate", never as measured disc temperature. This is a cue that braking is heavy/repeated, not a grip cue; keep it, but subtle and optional (cheap: one uniform per axle).
- Brake lights: on when `brakeInput > 0.05` OR (longitudinal decel `ax < -1.5 m/s^2` in auto mode) so Auto and Manual both light up truthfully; intensity = smooth lerp (~60 ms attack, 150 ms release) of emissive and a bloom-friendly colour (`emissiveIntensity` 0.2 -> 3 [E]). Real regs: brake lamps are steady red, no pulsing; keep it. Drive from sim state, not from key state, so it matches what the car is actually doing.
- Reverse lights: on when selected gear/direction is reverse (state machine in the drive module: `directionIntent === 'reverse'` and `speedAlongForward <= 0.2`), white, steady. Don't derive from pedal alone; derive from the direction state so the lights also explain "the car is going backwards" to the viewer.
- Implementation: swap material instance values (`emissiveIntensity`, shared material uniforms), never create materials at runtime. Bloom: if we already have a bloom pass use it; else use an additive sprite glow quad per lamp (2 draw calls). Don't light the scene from them (no point lights).

## 5. Wheel motion blur
Skip true motion blur and real post-process blur (cost, "heavy" look, conflicts with premium goal). Cheap alternative that reads well: spoke-to-disc crossfade by angular speed. When `|omega| * spokeCount / (2*pi) > ~ 25 Hz` (temporal aliasing starts; at 60 fps a 5-spoke wheel needs 12 Hz to appear stationary, wagon-wheel effect) [E], fade the spoke mesh opacity to 0 and fade in a pre-baked soft translucent disc (a single textured circle with radial streak noise rotating slowly). Alias-safe and nearly free: one extra quad per wheel. The brief's UI is about honesty, so make sure the visible wheel rotation matches the true angular velocity until the cross-fade, otherwise the wagon-wheel illusion will falsely suggest slip.

## 6. In-world force arrows and friction rings under tyres (the teaching layer)

This is the part with the best value for "shows where grip was lost". Draw per tyre, ground-projected, in the road plane:
1. Friction circle/ring ("grip ring"): a ring of radius proportional to available force `mu*Fz` (use the sim's per-tyre vertical load), plus a filled dot/arrow showing the current combined force vector `(Fx, Fy)` from that tyre. Colour ramps by utilisation `u = |F|/(mu*Fz)`: green (<0.7) -> amber (0.7-0.95) -> red (>= 1, sliding). A dot on or outside the ring = grip lost. This is exactly the tyre friction ellipse concept, visible live.
2. Optionally a thin "velocity vs heading" line to show slip angle. Do not show both unless uncluttered.
3. Load transfer reads from ring sizes alone (ring grows as Fz grows): nearly free extra insight.

Rendering: one `InstancedMesh` of a unit quad (4 instances, 1 draw call), `ShaderMaterial` with SDF in the fragment shader. Per-instance attributes: `aRadius`, `aForce` (vec2 in tyre local frame), `aUtil`. Per-instance world matrix from the contact patch (position + yaw of the wheel + normal alignment from road slope; or keep flat and add polygonOffset).
```glsl
// fragment: quad uv in [-1,1]^2 scaled so ring radius = 0.8
varying vec2 vP; varying float vUtil; varying vec2 vF; // vF force dir/len normalised by ring radius
float sdRing(vec2 p,float r,float w){ return abs(length(p)-r)-w; }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
void main(){
  float aa = fwidth(length(vP)) ;                       // screen-space AA, no MSAA dependency
  float ring = 1.0 - smoothstep(0., aa*1.5, sdRing(vP, 0.8, 0.02));
  float dotD = length(vP - vF*0.8) - 0.06;               // force point
  float dotM = 1.0 - smoothstep(0., aa*1.5, dotD);
  float seg  = 1.0 - smoothstep(0., aa*1.5, sdSeg(vP, vec2(0.), vF*0.8) - 0.012);
  vec3 col = mix(vec3(.30,.85,.55), mix(vec3(.98,.78,.25), vec3(.95,.25,.20), smoothstep(.95,1.05,vUtil)), smoothstep(.65,.95,vUtil));
  float a = max(ring*0.55, max(dotM, seg*0.8));
  gl_FragColor = vec4(col, a);
}
```
Clamp the drawn force dot to `|vF| <= 1.25` so the dot visibly exits the ring when over the limit.
Force arrows on the body (e.g. CG longitudinal/lateral acceleration or load-transfer arrows): a single 2D "g-ball"/arrow HUD element is cheaper and cleaner than world arrows; keep in-world only the four tyre rings. If world arrows are wanted, use an instanced `ConeGeometry + CylinderGeometry` merged once, with `scale.y` = magnitude; 1 draw call; ignore `ArrowHelper` (allocates a Mesh + Line per instance).
Cost [E]: 1 draw call, 4 instances, ~1-2K fragments per ring; negligible. All inputs come from sim-core's existing per-tyre state; none of this affects physics. Honesty: label the ring "model grip limit"; do not print numbers that imply measured data.

## 7. Ghost car (e.g., Auto car as a reference while driving Manual)
Cheap approach: render the same car group's meshes with a shared override material, `transparent`, `depthWrite: true` on a first depth-only pass to avoid inner-surface double-blending (the classic "see-through" artefact), then colour pass with fresnel:
```glsl
// onBeforeCompile into MeshBasicMaterial, or a small ShaderMaterial
float f = pow(1.0 - saturate(dot(normalize(vNormalW), normalize(vViewDirW))), 2.5);
gl_FragColor = vec4(uColor, uBase + f*uRim);   // uBase ~0.08, uRim ~0.6 [E]
```
Alternatives: dither-discard (screen-door) with `discard` on a Bayer matrix - no sorting, no blending issues, still looks fine for a premium ghost; cost 0 extra passes. Recommended: fresnel + `colorWrite:false` depth pre-pass. Ghost shares geometry (no clones of buffers) and uses the same `stateAt(t)`-driven transforms; skip wheel/suspension detail on the ghost (hide caliper, interior). Draw it after opaque, before particles. Do not simulate a ghost's light/VFX.

## 8. Subtle speed effects that stay premium
No radial blur, no chromatic aberration, no heavy post. Cheap and tasteful [E]:
- FOV bump: +3 to +6 degrees over 0 -> max speed via critically damped smoothing; combine with a slight camera pull-back. Free.
- Subtle roadside streaks: a few dozen very thin, low-alpha world-space line quads (instanced) spawned near the road edge, length proportional to speed, fading in only above ~60% of top speed. 1 draw call.
- Speed-dependent vignette at 4-6% strength max, only in the corners, fade linearly with speed; or skip.
- Tyre noise/engine audio belongs to another doc (audio).
- Skip: radial blur, screen shake tied to speed (conflicts with the suspension lab's actual ride visualisation; we want true body motion to be readable, so do not add fake shake).

## 9. Per-frame cost summary (rough budget, 60 fps, desktop) [E]
| Effect | Draw calls | Extra GPU | CPU/frame | Notes |
|---|---|---|---|---|
| Tyre ribbons x4 | 4 | negligible | ~0.05 ms | dirty-range uploads |
| Smoke + dust + spray | 3 | overdraw dependent, <0.5 ms | ~0.05 ms | cap particle count/size |
| Friction rings | 1 | negligible | ~0.02 ms | 4 instances |
| Brake/reverse lights | 0 | 0 | 0 | uniforms only |
| Ghost car | + ~meshes of car (shared geo) | one depth + one colour pass | 0 | optional |
| Speed streaks | 1 | negligible | ~0.02 ms | optional |
All of this is far below a frame budget of 16.6 ms; the only real risk is transparent overdraw from smoke at close camera.

## 10. Zero-allocation checklist [E]
- Module-level scratch `Vector3/Matrix4/Quaternion`, as pmndrs does (`const v = new Vector3()` etc. at module scope - good habit even if their loops are naive).
- Preallocate all typed arrays at construction; never create `Float32Array`/objects per frame.
- Use `BufferAttribute.addUpdateRange` + `needsUpdate` on only the written slice (three r160+) rather than whole-buffer uploads.
- Throttle writes by distance and time (folio: 1/30 s and 0.2 m).
- Avoid `getMatrixAt/decompose` loops (pmndrs `Dust.tsx` does this every frame).
- Avoid `ArrowHelper` and `DecalGeometry` in hot paths.
- Keep `frustumCulled = false` on ribbon/particle meshes (bounding spheres go stale when positions are rewritten, as folio does `mesh.frustumCulled = false`).
- Drive all VFX from the sim's `stateAt(t)` snapshot (pure function) so Auto and Manual produce identical visuals, and rewinding/scrubbing in Auto must clear or recompute the ring buffers (decide: reset on mode switch or seek).

## Recommendation for Suspension Lab
1. Adopt: friction-ring-per-tyre (instanced SDF quad, section 6) as THE grip-teaching visual. It shows load transfer (ring size) and grip loss (dot outside ring, colour turn) in one glance; 1 draw call.
2. Adopt: slip-driven tyre ribbons (section 2.4), 4 draw calls, ring-buffer vertex attributes, dirty-range upload, distance-throttled like folio-2025 (MIT). Marks appear only past the friction limit, oriented by contact-patch velocity, intensity by utilisation, aged fade.
3. Adopt: tyre smoke/dust/spray from one tiny GPU-instanced particle module (birth-time ring, shader-side simulation), emitted only above the limit; fake soft-particle fade from `roadHeight` instead of a depth texture.
4. Adopt: brake lights driven by sim deceleration/brake state and reverse lights by the direction state machine; steady, no flashing; material uniforms only.
5. Adopt (optional, low cost): fresnel ghost car with depth pre-pass for "Auto car vs your car"; and a subtle FOV/camera speed cue.
6. Adopt (optional): brake-disc glow from a lumped thermal state, labelled approximate; subtle.
7. Skip: pmndrs `Skid.tsx`/`Dust.tsx` code as written (brake-keyed, frame-rate-dependent stamping, O(N) matrix decompose); use only the ring-index idea.
8. Skip: `DecalGeometry` for streaming skids (CPU allocation, distortion on curved/bumpy geometry), three-nebula (unverified licence, CPU particles), full three.quarks dependency (reference its `TrailBatch` shader only, MIT; adopt if an editor workflow is wanted later).
9. Skip: true wheel motion blur/post blur, radial blur, chromatic aberration, fake speed shake. Use spoke-to-disc crossfade only if wagon-wheel aliasing is distracting.
10. Skip: world-space force arrows on the body; use the 2D HUD (g-ball) for CG acceleration, keep in-world only tyre rings.
11. Optional upgrade: top-down mark render target sampled by the road shader (folio-2025 `Tracks`, MIT) when marks must persist beyond a 128-256-sample window; don't build both.
12. Licences: everything we would copy is MIT (pmndrs, folio-2019/2025, three.quarks, three.js). Keep the notices if we copy more than ideas; verify three-nebula before any use (LICENSE path 404 on master).
13. Honesty risks: rings/marks come from a simplified tyre model; label as "model", never display tyre force/temperature numbers as measurements; disc glow is a cue not a reading.
14. Technical risks: z-fighting/ribbon over bumpy `roadHeight` (use polygonOffset + 2 mm lift), ribbon seam on wrap (degenerate/alpha-0 sample), mode-switch/seek must reset ring buffers, overdraw from large smoke at close camera, vertex-texture-fetch variant requires float textures (use plain vertex attributes to avoid it).
15. Build order: rings (1) -> ribbons (2) -> particles (3) -> lights (4) -> optional ghost/FOV; each as a separate VFX module reading the same read-only tyre-state snapshot.
