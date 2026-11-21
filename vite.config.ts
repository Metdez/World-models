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
        rollupOptions: {
          input: { main: 'index.html', remote: 'remote.html' },
          // three.js + its post/camera libraries change far less often than app code: their own chunk stays cached
          // across deploys and downloads in parallel with main. Only the main page imports it (remote stays three-free).
          output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/](three|postprocessing|camera-controls)[\\/]/ }] } },
        },
      },
    },
    // Worker environment is named after wrangler "name" with '-' -> '_'.
    suspension_lab: { build: { sourcemap: true } },
  },
});
