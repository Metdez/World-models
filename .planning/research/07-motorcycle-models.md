# 07 - Motorcycle 3D models (glTF/GLB): what is actually downloadable and licensed

Date: 2026-11-20. Scratch dir: `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/assets/bikes/<name>/`.
Inspector (parses GLB/glTF JSON only, executes nothing): `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/tools-bikes/inspect.js` (usage `node inspect.js <file> [maxNodeLines]`); downloader `.../tools-bikes/fetch.sh`.

## Bottom line (plain)
- **No downloadable model is both premium-looking AND cleanly rigged (separate wheel/fork/swingarm nodes).** Nothing Triumph / Thruxton / Bonneville exists as a downloadable, mirrored, CC model.
  Sketchfab has CC-BY Triumph models (Bonneville Cafe Racer by "louis", 2.3M faces; Bonneville Bobber 53k faces by joshuaseaver; Street Triple etc.), but the Sketchfab archive needs a signed-in OAuth token and I found no GitHub mirror of them. Unverified: whether any mirror exists (GitHub code search is rate-limited and many repos return no access).
- **Only clean rig found: Kenney `vehicle-motorcycle.glb` (CC0)**, but it is 960 triangles, flat-shaded colormap, not premium.
- **Recommendation: build a procedural Triumph-Thruxton-style bike** (dimensions below), optionally using the Kenney GLB as a structural/proportion reference only. Use a CC-BY Sketchfab-sourced scan as a non-animated "hero" only if you accept the heavy payload and manual mesh splitting.
- Poly Pizza motorcycle search (43 results) is mostly paid/low-poly packs or Poly-by-Google CC-BY low-poly; Smithsonian 3D search for "motorcycle" returned no results; Khronos sample assets have no motorcycle (the GitHub contents API listing matched no bike names). Quaternius / Kenney: only the Kenney racing-kit bike found.

## Candidates downloaded and inspected

| # | Local path | Source | Author | Licence | Tris | Rig / PBR | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | `.../bikes/kenney-racing/vehicle-motorcycle.glb` (97,172 B, valid GLB v2, magic `glTF`) | https://github.com/KenneyNL/Starter-Kit-Racing/blob/main/models/vehicle-motorcycle.glb (repo MIT; README: models CC0) | Kenney (kenney.nl) | **CC0** (assets), MIT (repo code) | 960 | Nodes: `motorcycle > wheel-back, wheel-front, body > fork`. Single colormap texture, no PBR maps. Size 1.09 x 1.27 x 2.44 m, origin at ground. | **#1 usable now (rig-friendly, safe licence), but low fidelity** |
| 2 | `.../bikes/ducati-1098r/scene.gltf` + `scene.bin` (46.6 MB) + 46 PNG textures (97 MB total) | https://sketchfab.com/3d-models/2008-ducati-1098r-41b7b593d8444730b1256660a236cb3d (mirror: github.com/jsamonte/Wide-Area-AT-Attempt-4, `Assets/Props/Other Folders/2008_ducati_1098r`) | Gratisphile | CC-BY-4.0 | 224,249 | Real PBR (baseColor+MR+normal+clearcoat), 21 meshes split by material (both rims merged in one mesh, fork/swingarm not separate). Sportbike, not cafe racer. Size 2.14 x 1.10 x 0.78. | Good looking, too heavy (97 MB), needs mesh splitting; sportbike |
| 3 | `.../bikes/honda-cb500f-scrambler/scene.gltf` + `scene.bin` (16 MB) + 2 textures | https://sketchfab.com/3d-models/honda-cb500f-scrambler-custom-a50d882468854f05bd559fe878914d54 (mirror: github.com/Anujkulal/demobike3dmodel, `static/models/Duck/honda`) | DenisM | CC-BY-4.0 | 371,151 | 65 meshes / 65 flat-colour materials, hierarchy flat under one FBX node (no wheel/fork groups, wheels split by material). Naked/scrambler style, closest to the brief aesthetically. Size 2.06 x 1.26 x 0.84 (Y-offset origin). | Closest style; no PBR maps, high poly, needs manual regrouping by position |
| 4 | `.../bikes/motorcycle-chenchanchong/scene.gltf` + bin + 3 PBR textures | https://sketchfab.com/3d-models/motorcycle-d3077af5fcf8464c884c6c1d611ff69b (mirror: raimieltan/pang-daily-desktop `reference-assets/motorcycle`) | Chenchanchong | CC-BY-4.0 | 95,325 | 2 meshes, 1 material (atlas, PBR MR+normal). Not splittable without remeshing. | Static prop only |
| 5 | `.../bikes/toon-motorbike/scene.gltf` + bin + texture | https://sketchfab.com/3d-models/toon-motorbike-0e7b8d0074a949419d97cac221780ee3 (mirror: hasan-bro-coder/OnTheRun) | Zeppelin | CC-BY-4.0 | 15,972 | 1 mesh, 1 material, toon. Scale in cm (741 units long). | Not suitable (stylised, one mesh) |

Discarded after download: `2016 Ducati XDiavel S` (1.37M tris, tiny-scale units) and `2020 Suzuki SV650` (1.0M tris photoscan, unlit, 55 MB) - unusable; a "Triumph TR6" found by name is a car, not a bike. Note one mirror repo (all3n2601/Riders-Paradise) has a licence.txt ("Classic Motorcycle", Mora) that did NOT match its scene.gltf (XDiavel by everhard) - mirrors can be mislabelled; verify `asset.extras` in the file against licence.txt.

Other mirrored CC-BY Sketchfab motorcycles seen (licence.txt verified, NOT downloaded/inspected): Low Poly Motorcycle 001 (tedpermana, JahirWH/Tron_Game_portafolio), Honda CB175 scan (David Antalek, Hike-12/AR), Motorcycle (animanyarty; carlcapu9; eriklys), Low poly motorcycle (matisosanimation), 2021 Ducati Panigale V4 SP (Gratisphile). All come as flat Sketchfab conversions.

Not usable licences: Triumph 3HW 1942 (jhepic) is CC-BY-NC; ripped-game models (e.g. Generals ZH, Road Rash) excluded.

## Attribution text (copy-paste)
- Kenney (CC0, none required, optional): "Motorcycle by Kenney (www.kenney.nl), CC0 1.0."
- Ducati 1098R: `"2008 Ducati 1098R" (https://sketchfab.com/3d-models/2008-ducati-1098r-41b7b593d8444730b1256660a236cb3d) by Gratisphile (https://sketchfab.com/brainlesszombie5) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`
- Honda CB500f Scrambler: `"Honda CB500f Scrambler (Custom)" (https://sketchfab.com/3d-models/honda-cb500f-scrambler-custom-a50d882468854f05bd559fe878914d54) by DenisM (https://sketchfab.com/Denis_M) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`

## Fallback: procedural Thruxton-style cafe racer (key dimensions)
Approximate Triumph Thruxton / Thruxton R (1200, 2016+) figures from memory of manufacturer specs - **unverified in this session**, treat as +/-5%:
- Wheelbase ~1415 mm (Thruxton R ~1415; Bonneville T120 ~1450; Speed Twin 1200 ~1435).
- Rake ~22.8 deg (Thruxton R ~22.8; Bonneville ~25.5), trail ~92 mm (Thruxton R ~92).
- Wheels: 17 in front and rear (Thruxton/R), tyres ~120/70 front, 160/60 rear (Bonneville T120: 18 in front / 17 in rear, 100/90-18 and 150/70-17). Outer tyre diameter 17 in rim ~ 590-620 mm front, ~ 620 rear.
- Seat height ~810 mm (Thruxton R 810; Speed Twin ~807; Bonneville T120 ~790). Clip-on bars (Thruxton) set low, ~ 100-150 mm below top triple clamp... visually: seat-to-bar drop ~200 mm.
- Fork: 43 mm USD Showa (R) / conventional telescopic (Bonneville/Speed Twin 41 mm), travel ~120 mm; rear twin shocks (Bonneville: preload-adjustable, ~120 mm travel; Thruxton R: Ohlins-style piggyback, ~120 mm).
- Length ~2100 mm, width at bars ~ 750-800 mm, ground clearance ~ 135 mm, dry mass ~ 200 kg; engine 1200 parallel twin, 270-degree crank, ~ 100 kW. Tank ~ 14.5 L, bar-end mirrors, round headlight, 2-into-2 upswept silencers.
- Rig hierarchy to build: `bike > frame(+tank, seat, engine) > [steering-head > fork-upper(tubes) > fork-lower(sliders) > front-wheel], [swingarm > rear-wheel], [shocks left/right]`. Fork compression = translate lower slider along rake axis; swingarm = rotate about pivot (pivot ~ 120 mm above ground ahead of rear wheel by ~ 560 mm, swingarm length ~ 570 mm).

Use Kenney's node naming (`wheel-front`, `wheel-back`, `fork`, `body`) for compatibility if you want to swap the placeholder for the procedural bike later.

## Recommendations for Suspension Lab
1. **Procedural cafe racer from primitives (LatheGeometry wheels/tyres, TubeGeometry frame, extruded tank, cylinder fork tubes)** as the shipping bike; PBR via MeshPhysicalMaterial. Dimension table above. This is the only path that gives separate animatable fork/swingarm/shocks with full control.
2. **Kenney CC0 `vehicle-motorcycle.glb`** as immediate placeholder/blockout (valid, 97 KB, nodes already separate); credit optional.
3. If a hero visual is wanted, use **Honda CB500f Scrambler (CC-BY)** or **Ducati 1098R (CC-BY)** as a static display model only; must (a) compress with gltf-transform (Draco/meshopt + KTX2), (b) regroup meshes by position to extract wheels, (c) show attribution. Expect 15-100 MB raw; not suitable for web without optimisation.
4. If a Sketchfab account/token becomes available, the best on-brief downloads are "Triumph Bonneville Bobber 1200cc" (joshuaseaver, 53k faces, CC-BY, https://sketchfab.com/3d-models/e82585ac4eab493185556f51c810894c) and "Cafe Racer motorcycle" (oscarherry3d, 398k faces, 17 textures, CC-BY, https://sketchfab.com/3d-models/dddd830af69a486fbf5e79c8e6515b4f...; id truncated in search output, verify). Neither was downloaded.
