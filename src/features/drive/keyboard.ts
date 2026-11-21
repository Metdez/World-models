/**
 * Keyboard intent source (ARCHITECTURE-M2 §10.1, research m2/07 §1.6): a held set of `KeyboardEvent.code`s, repeats
 * ignored, cleared on blur / hidden tab / context menu so nothing sticks; text inputs are never read. Enter and R are
 * commands, handed to `onCommand`. preventDefault only while the visitor drives.
 */
import type { DriveIntent, DriveMode } from '../../contracts/drive';
import type { DriveIntentSource } from '../../contracts/services';
import { capturesCode, isDriving, keyIntent } from './keys';

export type KeyCommand = 'toggle' | 'reset' | 'input';

export function isTextInput(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'));
}

/** Focused controls that use Enter themselves. */
function ownsEnter(t: EventTarget | null): boolean {
  return t instanceof Element && t.matches('button, a[href], summary, [role="button"], [role="radio"], [role="link"]');
}

export interface KeyboardSource extends DriveIntentSource {
  /** Removes the listeners. */
  dispose(): void;
  clear(): void;
}

export function createKeyboardSource(mode: () => DriveMode, onCommand: (command: KeyCommand) => void): KeyboardSource {
  const held = new Set<string>();
  /** A takeover key went down since the last read: a tap shorter than a frame still counts once. */
  let tapped = false;

  const onDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTextInput(e.target)) return;
    const m = mode();
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (e.repeat || ownsEnter(e.target)) return;
      e.preventDefault();
      onCommand('toggle');
      return;
    }
    if (e.code === 'KeyR' && isDriving(m)) {
      if (!e.repeat) onCommand('reset');
      return;
    }
    if (e.defaultPrevented || !capturesCode(e.code, m)) return;
    if (isDriving(m)) e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    tapped = true;
    onCommand('input');
  };
  const onUp = (e: KeyboardEvent) => {
    if (held.delete(e.code) && isDriving(mode())) e.preventDefault();
  };
  const clear = () => {
    held.clear();
    tapped = false;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') clear();
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', clear);
  window.addEventListener('contextmenu', clear);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    id: 'keyboard',
    read(out: DriveIntent) {
      const deliberate = keyIntent(held, out) || tapped;
      tapped = false;
      return deliberate;
    },
    clear,
    dispose() {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
      window.removeEventListener('contextmenu', clear);
      document.removeEventListener('visibilitychange', onVisibility);
      clear();
    },
  };
}
