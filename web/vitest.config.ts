import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Same manifest choice as vite.config.ts; the tests are plain TypeScript and need no React plugin.
const MANIFEST = path.resolve(__dirname, '..', process.env.VIGIL_MANIFEST ?? 'deployments/robinhood-testnet-46630.json');

export default defineConfig({
  resolve: { alias: { '@manifest': MANIFEST } },
  test: { include: ['test/**/*.test.ts'] },
});
