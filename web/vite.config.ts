import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

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
  define: {
    __COMMIT__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['test/**/*.test.ts'] },
});
