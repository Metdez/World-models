/** Segmented control: a radiogroup with roving tabindex, arrow keys and a sliding thumb (research 14 A3/C4). */
import { h } from '../../ui/dom';

export interface SegmentOption {
  readonly id: string;
  readonly label: string;
  /** Narrow-screen label. */
  readonly short?: string;
  /** Keyboard hint shown as a keycap. */
  readonly key: string;
}

export interface Segmented {
  readonly el: HTMLElement;
  /** Rebuilds the segments (e.g. a vehicle with other suspensions). */
  setOptions(options: readonly SegmentOption[]): void;
  setValue(id: string): void;
  /** Re-measures the thumb (resize, font load, zoom). */
  layout(): void;
}

export function createSegmented(name: string, cls: string, onSelect: (id: string) => void): Segmented {
  const thumb = h('span', { class: 'sl-controls-thumb', 'aria-hidden': 'true' });
  const el = h('div', { class: `sl-controls-seg ${cls}`, role: 'radiogroup', 'aria-label': name }, thumb);
  let buttons: HTMLButtonElement[] = [];
  let value = '';

  const layout = () => {
    const b = buttons.find((x) => x.dataset.id === value);
    el.classList.toggle('has-value', b !== undefined);
    if (!b) return;
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  };

  const setValue = (id: string) => {
    value = id;
    for (const b of buttons) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    layout();
  };

  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[role="radio"]');
    if (!b?.dataset.id) return;
    if (e.detail > 0) b.blur(); // pointer click: keep Space free for pause
    onSelect(b.dataset.id);
  });

  el.addEventListener('keydown', (e) => {
    const i = buttons.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    const n = buttons.length;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const b = buttons[next]!;
    b.focus();
    onSelect(b.dataset.id!); // radio semantics: selection follows focus
  });

  return {
    el,
    setOptions(options) {
      for (const b of buttons) b.remove();
      buttons = options.map((o) =>
        h(
          'button',
          { type: 'button', role: 'radio', class: 'sl-controls-segment', 'data-id': o.id, 'aria-keyshortcuts': o.key, 'aria-label': o.label },
          h('span', { class: 'sl-controls-segment-label' }, o.label),
          o.short ? h('span', { class: 'sl-controls-segment-short', 'aria-hidden': 'true' }, o.short) : null,
          h('kbd', { class: 'sl-controls-kbd', 'aria-hidden': 'true' }, o.key.toUpperCase()),
        ),
      );
      el.append(...buttons);
      setValue(value);
    },
    setValue,
    layout,
  };
}
