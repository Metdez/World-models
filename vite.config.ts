import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  // remoteBindings off: dev/preview/e2e must boot without Cloudflare credentials (AI calls then fail locally; tests fake it).
  plugins: [cloudflare({ remoteBindings: false })],
  build: { target: 'es2022', sourcemap: true },
  environments: {
    client: {
      build: {
        chunkSizeWarningLimit: 1500,
        rollupOptions: { input: { main: 'index.html', remote: 'remote.html' } },
      },
    },
    // Worker environment is named after wrangler "name" with '-' -> '_'.
    suspension_lab: { build: { sourcemap: true } },
  },
});
