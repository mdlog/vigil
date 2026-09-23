import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';

/** Which deployment the pages show: VIGIL_MANIFEST=deployments/robinhood-mainnet-4663.json npm run build. */
const MANIFEST = path.resolve(__dirname, '..', process.env.VIGIL_MANIFEST ?? 'deployments/robinhood-testnet-46630.json');

function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: '/vigil/',
  plugins: [react()],
  resolve: { alias: { '@manifest': MANIFEST } },
  define: {
    __COMMIT__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // two real HTML files, so GitHub Pages serves /vigil/ and /vigil/dashboard/ without an SPA fallback
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), dashboard: path.resolve(__dirname, 'dashboard/index.html') } },
  },
});
