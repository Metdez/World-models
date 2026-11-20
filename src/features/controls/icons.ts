/** Hairline icons (own drawing, 20 px grid, 1.5 px stroke, round caps; research 14 A5). Static markup only. */
const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  pause: svg('<path d="M7 5v10M13 5v10"/>'),
  play: svg('<path d="M7 4.5v11l9-5.5z"/>'),
  slow: svg('<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>'),
  enterFullscreen: svg('<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>'),
  exitFullscreen: svg('<path d="M8 4v4H4M12 4v4h4M8 16v-4H4M12 16v-4h4"/>'),
  swap: svg('<path d="M4 7h11l-3-3M16 13H5l3 3"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
} as const;

/** Sets an icon on a button (trusted static markup from ICONS). */
export function setIcon(el: Element, icon: keyof typeof ICONS): void {
  if (el.getAttribute('data-icon') === icon) return;
  el.setAttribute('data-icon', icon);
  el.innerHTML = ICONS[icon];
}
