import { createApp } from '../kernel/app';
import { h } from '../ui/dom';
import * as FEATURES from './features';

const RELOADED = 'sl:preload-reload';

// A deploy replaced the hashed chunks this page still references: reload once to get the new index.html.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(RELOADED)) return; // already retried: let the error surface
    sessionStorage.setItem(RELOADED, '1');
  } catch {
    return; // no storage, no loop guard: do not risk a reload loop
  }
  event.preventDefault();
  location.reload();
});

createApp({ features: Object.values(FEATURES) })
  .start()
  .then(
    () => {
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        // storage unavailable: nothing to clear
      }
    },
    (error: unknown) => {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      document.getElementById('overlay')?.append(
        h(
          'div',
          {
            role: 'alert',
            style:
              'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;background:var(--bg-0);color:var(--text-1)',
          },
          h('p', {}, message),
        ),
      );
    },
  );
