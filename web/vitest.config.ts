import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Same manifest choice as vite.config.ts. Component tests (.test.tsx) render to static markup; esbuild's JSX needs no plugin.
const MANIFEST = path.resolve(__dirname, '..', process.env.VIGIL_MANIFEST ?? 'deployments/robinhood-testnet-46630.json');

export default defineConfig({
  resolve: { alias: { '@manifest': MANIFEST } },
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
});
