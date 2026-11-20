# Credits

Suspension Lab is built on the work of others. This file mirrors the in-app credits panel (ARCHITECTURE §15):
asset attributions come from `assets-src/ATTRIBUTION.json` (copied into the asset manifest at build time), code
and data credits from `src/features/credits/code-credits.ts`. `tests/features/credits.test.ts` checks that this
file covers both.

Vehicle meshes are used for their shape only; no manufacturer data is implied. Vehicle parameters are
representative.

## Assets

### Car body mesh — CC BY 4.0

"Aston Martin db11" by Black Snow (https://sketchfab.com/BlackSnow02) is licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Source: https://sketchfab.com/3d-models/aston-martin-db11-0ce56f01b1ff40b3a4e36bc56873dbc7. Modified: optimised/compressed (meshopt), decimated, re-materialed, badges hidden.

### HDRIs — Poly Haven, CC0 1.0 (credited with thanks)

- "Derelict Airfield 01" by Alexander Scholten — https://polyhaven.com/a/derelict_airfield_01
- "Evening Road 01" by Sergej Majboroda — https://polyhaven.com/a/evening_road_01
- "Ferndale Studio 03" by Dimitrios Savva, Greg Zaal — https://polyhaven.com/a/ferndale_studio_03

### Textures — Poly Haven, CC0 1.0 (credited with thanks)

- "Asphalt Track" by Dimitrios Savva — https://polyhaven.com/a/asphalt_track
- "Cobblestone Floor 08" by Rob Tuytel — https://polyhaven.com/a/cobblestone_floor_08
- "Concrete Floor 01" by Rob Tuytel — https://polyhaven.com/a/concrete_floor_01
- "Grass Ground" by Charlotte Baglioni — https://polyhaven.com/a/grass_ground

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

### Sounds — CC0 1.0

- "Starter Kit Racing sounds (engine, motorcycle engine, impact)" by Kenney (https://kenney.nl) —
  https://github.com/KenneyNL/Starter-Kit-Racing/tree/main/audio
- "Skid sound (Starter Kit Racing)" by Landeplage (https://github.com/Landeplage) —
  https://github.com/KenneyNL/Starter-Kit-Racing/tree/main/audio

## Code, data and fonts

| Name | Use | Licence | Copyright |
|---|---|---|---|
| [Project Chrono](https://github.com/projectchrono/chrono) | Starting suspension hardpoint sets and joint topology (rescaled) | BSD-3-Clause | Copyright (c) 2016, Project Chrono Development Team |
| [AxleLab](https://github.com/KRoshanK/AxleLab) | Helper ideas adapted for tube placement, boot profile and part palette | MIT | Copyright (c) 2026 KRoshanK |
| [three.js](https://github.com/mrdoob/three.js) | Rendering | MIT | Copyright © 2010-2026 three.js authors |
| [meshoptimizer decoder](https://github.com/zeux/meshoptimizer) | Mesh decompression (via three.js addons) | MIT | Copyright (C) 2016-2026, by Arseny Kapoulkine |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Post-processing effects | Zlib | Copyright © 2015 Raoul van Rüschen |
| [n8ao](https://github.com/N8python/n8ao) | Ambient occlusion | ISC | N8python (package licence ISC; repository LICENSE file CC0 1.0) |
| [camera-controls](https://github.com/yomotsu/camera-controls) | Orbit camera | MIT | Copyright (c) 2017 @yomotsu |
| [nanostores](https://github.com/nanostores/nanostores) | App state | MIT | Copyright 2020 Andrey Sitnik |
| [mitt](https://github.com/developit/mitt) | Events | MIT | Copyright (c) 2021 Jason Miller |
| [Hono](https://github.com/honojs/hono) | Edge API | MIT | Copyright (c) 2021 - present, Yusuke Wada and Hono contributors |
| [Zod](https://github.com/colinhacks/zod) | Validation | MIT | Copyright (c) 2025 Colin McDonnell |
| [PartySocket](https://github.com/partykit/partykit) | Live room connection | MIT | Copyright (c) 2010-2012, Joe Walnes |
| [uqr](https://github.com/unjs/uqr) | QR codes | MIT | Copyright (c) Project Nayuki; Copyright (c) 2023 Anthony Fu |
| [stats-gl](https://github.com/RenaudRohlinger/stats-gl) | Debug statistics | MIT | Renaud Rohlinger |
| [Geist Sans and Geist Mono](https://github.com/vercel/geist-font) | Typefaces (self-hosted via Fontsource) | OFL-1.1 | (C) 2023 Vercel, made in collaboration with basement.studio |

Geist fonts: SIL Open Font License 1.1 (https://openfontlicense.org). postprocessing: zlib licence.
n8ao: ISC licence.

## Licence notices

### Project Chrono (BSD-3-Clause)

The suspension hardpoint sets in `src/sim-core/content/susp-*.ts` start from Project Chrono data (rescaled).

```
Copyright (c) 2016, Project Chrono Development Team
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

 - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 - Neither the name of the nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### MIT licence

Applies to every entry marked MIT above, each with its own copyright line.

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
