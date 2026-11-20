/** QR code as one SVG path (uqr, MIT). Colours come from CSS (`.sl-qr` fill), so no markup strings are injected. */
import { encode } from 'uqr';

const SVG = 'http://www.w3.org/2000/svg';

/** Path data with one `h1v1h-1z` square per dark module, merged into horizontal runs. */
export function qrPath(text: string): { d: string; size: number } {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  for (let y = 0; y < size; y++) {
    const row = data[y]!;
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (x + run < size && row[x + run]) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return { d, size };
}

export function qrSvg(text: string, label: string): SVGSVGElement {
  const { d, size } = qrPath(text);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'sl-qr');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('class', 'sl-qr-bg');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(bg, path);
  return svg;
}
