# 06 - Car 3D models (glTF/GLB): licence-checked, downloaded, inspected

Date: 2026-11-20. All files below were downloaded with curl, magic bytes `glTF` verified (GLB v2), and parsed with a JSON-chunk-only Node script (no execution of any content):
`/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/tools/inspect-glb.mjs <file.glb>` (also `nodexf.mjs` for node transforms). Per-model dumps: `.../scratchpad/tools/<name>.txt`.
Scratch root: `S=/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad`

## #1 RECOMMENDATION: Aston Martin DB11 by "Black Snow" (CC-BY 4.0)

- Local file: `$S/assets/cars/aston-db11/aston-martin-db11.glb` (1,108,192 bytes; sha256 4d5641e5...e8b0)
- Original: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7 (author https://sketchfab.com/BlackSnow02). Sketchfab public API confirms: licence "CC Attribution", isDownloadable true, 218,007 faces original.
- Direct (no-token) host: GitHub mirror https://raw.githubusercontent.com/nutricionistaalmeidavh-spec/assetscarros3d/HEAD/assets/aston-martin-db11.glb (mirror of github.com/pedrosoandre/carros; repo is MIT for code, models keep individual CC-BY licences; its CREDITS.md and cars.json list this model as CC Attribution, author Black Snow). The embedded `asset.extras` in the GLB itself carries author/licence/source. A second independent GitHub project (Tanish2207/AstonMartin-Redesigned, `src/components/Aston.jsx`, gltfjsx header) also states "Author: Black Snow, License: CC-BY-4.0, Source: sketchfab ...0ce56f01...".
- Caveat: the file is a third-party re-encode (glTF-Transform v4.4.2, meshopt, decimated to 112,610 tris). Redistribution is allowed under CC-BY (with attribution, and "changes indicated"), but the provenance chain is a mirror, not the author. Acceptable; if wanted, re-download the original at build time with a Sketchfab token.
- Required attribution (put in credits / footer / about):
  `"Aston Martin db11" by Black Snow (https://sketchfab.com/BlackSnow02) is licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7. Modified: optimised/compressed (meshopt) and decimated.`
  Aston Martin trademarks/logos: do not imply endorsement (badge meshes exist; consider removing `amdb11_badging*`, `amdb11_amr` materials).
- Structure (from parsed JSON):
  - 320 nodes, 242 meshes, 112,610 tris, 53 materials (flat PBR colour factors, ZERO textures/images, so tiny and easy to re-material), no animations/skins.
  - Extensions: `EXT_meshopt_compression` (required), `KHR_mesh_quantization` (required), `KHR_materials_specular`, `KHR_materials_emissive_strength`. NOT draco, NOT KTX2. Three.js: `loader.setMeshoptDecoder(MeshoptDecoder)` (from `three/addons/libs/meshopt_decoder.module.js`) is mandatory.
  - Scale: root `db11.fbx` node has scale 0.01 and child nodes scale 100 -> net world units are metres (accessor min/max are quantized so a naive bbox shows ~1e4; use `new THREE.Box3().setFromObject()` after load). Wheel centres in metres: front x = +/-0.96..0.97, y = 0.376, z = +1.30; rear z = -1.62 (so wheelbase ~2.92 m). Root has -90deg X rotation on `Sketchfab_model` and +90deg on `db11.fbx` (net identity, Y up).
  - WHEELS ARE SEPARATE, one set per corner, as sibling nodes under `RootNode` (not grouped under a hub): `amdb11_wheel_03`, `amdb11_wheel_03.001/.002/.003` (rim; 2 sub-meshes mirror+black_ext), tyre = `Object_4.003`, `Object_4.001`, `Object_4.002`, `Object_4` (6,742 tris each, single mesh `..._Scene_-_Root_0`), calipers `amdb11_caliper_FR`, `.001-.003`, discs `amdb11_brakedisc_FR`, `.001-.003` (+ `amdb11_brakedisc_RR`). Each has its own pivot at the wheel centre with rotation baked per side (left side wheels rotated ~180deg about Y). Practical: at load, create a hub Group per corner at the wheel-centre world position and `attach()` rim+tyre+disc (spin) and caliper (steer only, not spin).
  - BONUS, highly relevant to Suspension Lab: the model ships real suspension hardware as separate nodes: `amdb11_strut_F`, `amdb11_spring_R`, `amdb11_shock_R`, `amdb11_lowerarm_F_a`, `amdb11_lowerarm_F_b`, `amdb11_lowerarm_R`, `amdb11_upperarm_R`, `amdb11_hub_F`, `amdb11_hub_R`, `amdb11_tierod_F/_R`, `amdb11_swaybar_F/_R`, `amdb11_subframe_F/_R`, `amdb11_steeringbox`, `amdb11_halfshaft_R`, `amdb11_diff`, `amdb11_strutbrace`, plus engines `amdb11_engine_v8/_v12`, `amdb11_engbaycrap`, radiator, intake, interior (seats, door panels, pedals, `amdb11_steer`), `amdb11_hood`, `amdb11_trunk`, `amdb11_bumper_F/_R`, `amdb11_body`, glass, lights, mirrors, `amdb11_exhtips`. Caveat: suspension parts are single-sided (one instance each, mostly of one side, single mesh per part, material `etkc`), and the front is strut-style while rear is multi-link/wishbone-ish. They are a reference/decor for an x-ray view; the true 3-config linkage should be generated procedurally (own kinematics) and could reuse these meshes only as visual stand-ins or be mirrored/duplicated by `scale.x=-1`. Individually named + separate => hood/trunk/doors-style x-ray fade is easy.
  - Visual quality: sharp, exact DB11 body, detailed interior/engine bay, but only simple colour materials (clearcoat/env-map needs to be added via `MeshPhysicalMaterial` on `amdb11_body_amdb11_0`/paint material `amdb11`). Body paint is material `amdb11` (and `amdb11_grey`). Glass `amdb11_glass`, `amdb11_glass_tint`, `amdb11_rearglass`.
  - Weak points: no baked AO/normal maps (looks "CG flat" until given an HDRI + physical material and our own AO/contact shadows); interior door mesh names are verbose; no L/R in wheel names (identify by sign of world X, Z).

## Other Aston Martin options (all verified CC-BY and "downloadable" via the public Sketchfab API; source files NOT obtainable without a Sketchfab token unless mirrored)
Searched with `https://api.sketchfab.com/v3/search?type=models&q=aston+martin&downloadable=true&license=by`. No CC0 Aston found. Notable (uid | name | author | faces):
- 0ce56f01b1ff40b3a4e36bc56873dbc7 | db11 | Black Snow | 218k (**#1, mirrored, downloaded**)
- cdef8d1f68084797a717f8942a901497 | V12 Vantage | Mona x Supercars | 404k
- 3df2bb2b7c464b0c807613632647f54d | V12 Vantage 2022 | kevin | 992k
- 01d98cc3ffa64ba698d602bde312ea64 | Valhalla 2023 | Flamestroke | 1.59M (too heavy raw); SABLE "Valhalla Frost Sky" 0eff8198... 154k CC-BY
- 1ffd7998ae1f4b8ba5a74d8a74b598e2 / 62925942... | Valkyrie | chiwei / Jojoking0611 | 270k / 255k
- 24de747640094583b0287d1c8adaca4e | DB5 | jpo1703 | 1.37M; bf1fe23e... DB5 AngryBearr 52k
- 30a1e7c374174c5cada4cbbb3e7e98a4 | DB9 | Javier Martin Hidalgo | 349k
- NOT usable: "Fortnite - 007's Aston Martin DB5" (game rip, despite CC label); DBR9 and V8 Vantage V600 are NC; F1 cars irrelevant.
- Hunt for mirrors: GitHub code search for these uids found only the assetscarros3d / pedrosoandre mirror (DB11, Vantage Roadster, Valour, F1 AMR23 only). No mirror of Valkyrie/Valhalla/DB5/V12 Vantage found in public repos checked. If we later get a Sketchfab API token (free account), `GET /v3/models/{uid}/download` returns glTF/GLB links; recommend then upgrading to the Valhalla Frost Sky or Mona's V12 Vantage if separate wheels exist (unverified).

## Candidates downloaded & inspected (ranked)

| Rank | Model | Path | Licence | Tris | Wheels separate? | Ext | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Aston Martin DB11 (Black Snow) | `$S/assets/cars/aston-db11/aston-martin-db11.glb` (1.1 MB) | CC-BY 4.0 | 112,610 | YES (rim/tyre/disc/caliper per corner + suspension parts) | meshopt, quantization | USE |
| 2 | Khronos CarConcept | `$S/assets/cars/carconcept/CarConcept.glb` (11.8 MB) | CC-BY 4.0 (Eric Chadwick / Darmstadt Graphics Group, Khronos; logos excluded). Original body from CC0 "Free Concept Car 004" by Guido Odendahl (Unity Fan) | 213,347 | YES: groups `WheelFrontL/R`, `WheelRearL/R` each = `...Rim` (12,176 tris, tyre included) + `...BrakePad` + `...BrakeDisc` | clearcoat, iridescence, transmission, emissive_strength, KHR_materials_variants, texture_transform; no draco/meshopt/KTX2; 15 PNG textures, 29 materials, Paint variants | Best PBR quality and cleanest structure/names (also door pivots, wipers); generic concept car, not a GT/Aston. Great fallback and for material reference |
| 3 | three.js Ferrari 458 Italia | `$S/assets/cars/ferrari/ferrari.glb` (1.68 MB) | UNVERIFIED: three.js example credits "Ferrari 458 Italia model by vicent091036" (sketchfab 57bf6cc56931426e87494f554df1dab6; Sketchfab API now returns 404 so licence cannot be confirmed; three.js repo does not state it in its models readme). Treat as NOT cleared | 358,788 | YES (`wheel_fl/fr/rl/rr` groups with tire/rim/brake/nuts; `steering_wheel`) | KHR_draco_mesh_compression (needs DRACOLoader), 0 textures, 17 materials | Good reference for how three.js demos rig it (`body`,`glass` names); do not ship until licence verified |
| 4 | Khronos ToyCar | `$S/assets/cars/toycar/ToyCar.glb` (5.4 MB) | CC0 (Guido Odendahl; Eric Chadwick) | 108,936 | No wheel nodes (3 meshes) | clearcoat, transmission, sheen | Not a sports car, 7 cm scale; skip |
| rejected | Aston Martin Vantage Roadster (vecarz) | `$S/assets/cars/aston-vantage/aston-martin-vantage.glb` | CC-BY 4.0 | 112,109 | NO (material-merged meshes Base/Paint/Carbon...) | meshopt | Cannot animate wheels |
| rejected | Aston Martin Valour 2024 (vecarz) | `$S/assets/cars/aston-valour/aston-martin-valour.glb` | CC-BY 4.0 | 86,569 | not clean (3,236 nodes, 801 meshes) | meshopt, 35 textures | Messy hierarchy; Valour is a 110-unit limited car; skip |

Not pursued / not found: pmndrs/market & drei-assets (no Aston/sports-car GLB identified in the time spent; not verified), Kenney/Quaternius car kits (CC0 but low-poly; wrong aesthetic for "premium"), Poly Pizza, polyhaven (no cars), CGTrader/free3d/RenderHub (Aston items are paid/royalty-free/editorial-only, not CC-BY - not usable). Game rips (Forza/GT/NFS/Fortnite) excluded.

## Gotchas for the Three.js implementation
- DB11 and the mirror's siblings need `MeshoptDecoder`; CarConcept needs nothing; Ferrari needs DRACOLoader.
- DB11 has zero textures: add `MeshPhysicalMaterial` (clearcoat 1, clearcoatRoughness 0.03) to the paint material, environment map (HDRI), and bake/fake AO; keep tyre `Object_4*` rubber (roughness ~0.85).
- Identify wheel corners by world position sign: +X = one side; z>0 front. Reparent into `hub` groups using `Object3D.attach()` to keep world transform. Brake discs/calipers: calipers follow steer but not roll.
- Check the wheel radius from the tyre world bbox (~0.35 m) so rolling spin = v/r.
- Licence compliance: CC-BY requires credit page text above; keep GLB `asset.extras` metadata intact.

## Recommendations for Suspension Lab
1. Ship `aston-martin-db11.glb` (CC-BY 4.0, Black Snow) as the hero car, with the attribution string in the footer/credits. Wheels, discs, calipers and tyres are separate nodes; reparent per corner into hub groups for spin/steer/suspension travel.
2. Use its separate `strut/lowerarm/upperarm/spring/shock/hub/tierod/swaybar/subframe` meshes only as visual stand-ins in the x-ray view; drive the three selectable suspension types (MacPherson, double wishbone, multi-link) from our own procedural linkage kinematics, and hide/replace the stock parts.
3. Keep `CarConcept.glb` (CC-BY 4.0) as a fallback/material-quality reference (clean `WheelFrontL` etc. groups, ready PBR with clearcoat); it is a valid plan B if the DB11 materials look too flat.
4. Do not ship the three.js Ferrari until its Sketchfab licence is confirmed; do not use Vantage/Valour (no separable wheels).
5. Optional upgrade path: obtain a free Sketchfab API token and fetch a higher-detail CC-BY Aston (Valhalla Frost Sky 154k, V12 Vantage 404k) after inspecting with the same script; verify wheel separation first.
6. Motorcycles: not searched in this task.
