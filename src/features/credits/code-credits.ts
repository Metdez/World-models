/**
 * Code, data and font credits (ARCHITECTURE §15). Mirrored in CREDITS.md (tests/features/credits.test.ts checks
 * the mirror). Copyright lines are copied from each package's LICENSE file.
 */

export interface CodeCredit {
  readonly name: string;
  /** What we use it for. */
  readonly use: string;
  readonly license: string;
  readonly copyright: string;
  readonly url: string;
}

/** Licence texts we must reproduce, keyed by CodeCredit.license. */
export const LICENSE_TEXTS: Readonly<Record<string, string>> = {
  'BSD-3-Clause': `Copyright (c) 2016, Project Chrono Development Team
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

 - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 - Neither the name of the nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
};

export const CODE_CREDITS: readonly CodeCredit[] = [
  {
    name: 'Project Chrono',
    use: 'Starting suspension hardpoint sets and joint topology (rescaled)',
    license: 'BSD-3-Clause',
    copyright: 'Copyright (c) 2016, Project Chrono Development Team',
    url: 'https://github.com/projectchrono/chrono',
  },
  {
    name: 'AxleLab',
    use: 'Helper ideas adapted for tube placement, boot profile and part palette',
    license: 'MIT',
    copyright: 'Copyright (c) 2026 KRoshanK',
    url: 'https://github.com/KRoshanK/AxleLab',
  },
  { name: 'three.js', use: 'Rendering', license: 'MIT', copyright: 'Copyright © 2010-2026 three.js authors', url: 'https://github.com/mrdoob/three.js' },
  { name: 'meshoptimizer decoder', use: 'Mesh decompression (via three.js addons)', license: 'MIT', copyright: 'Copyright (C) 2016-2026, by Arseny Kapoulkine', url: 'https://github.com/zeux/meshoptimizer' },
  { name: 'postprocessing', use: 'Post-processing effects', license: 'Zlib', copyright: 'Copyright © 2015 Raoul van Rüschen', url: 'https://github.com/pmndrs/postprocessing' },
  { name: 'n8ao', use: 'Ambient occlusion', license: 'ISC', copyright: 'N8python (package licence ISC; repository LICENSE file CC0 1.0)', url: 'https://github.com/N8python/n8ao' },
  { name: 'camera-controls', use: 'Orbit camera', license: 'MIT', copyright: 'Copyright (c) 2017 @yomotsu', url: 'https://github.com/yomotsu/camera-controls' },
  { name: 'nanostores', use: 'App state', license: 'MIT', copyright: 'Copyright 2020 Andrey Sitnik', url: 'https://github.com/nanostores/nanostores' },
  { name: 'mitt', use: 'Events', license: 'MIT', copyright: 'Copyright (c) 2021 Jason Miller', url: 'https://github.com/developit/mitt' },
  { name: 'Hono', use: 'Edge API', license: 'MIT', copyright: 'Copyright (c) 2021 - present, Yusuke Wada and Hono contributors', url: 'https://github.com/honojs/hono' },
  { name: 'Zod', use: 'Validation', license: 'MIT', copyright: 'Copyright (c) 2025 Colin McDonnell', url: 'https://github.com/colinhacks/zod' },
  { name: 'PartySocket', use: 'Live room connection', license: 'MIT', copyright: 'Copyright (c) 2010-2012, Joe Walnes', url: 'https://github.com/partykit/partykit' },
  { name: 'uqr', use: 'QR codes', license: 'MIT', copyright: 'Copyright (c) Project Nayuki; Copyright (c) 2023 Anthony Fu', url: 'https://github.com/unjs/uqr' },
  { name: 'stats-gl', use: 'Debug statistics', license: 'MIT', copyright: 'Renaud Rohlinger', url: 'https://github.com/RenaudRohlinger/stats-gl' },
  {
    name: 'Geist Sans and Geist Mono',
    use: 'Typefaces (self-hosted via Fontsource)',
    license: 'OFL-1.1',
    copyright: '(C) 2023 Vercel, made in collaboration with basement.studio',
    url: 'https://github.com/vercel/geist-font',
  },
];
