import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // registry-server has its own vitest.config.ts and .env — run it separately
    exclude: ['registry-server/**', '**/node_modules/**'],
  },
});
