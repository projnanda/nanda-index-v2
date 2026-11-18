import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These suites are starved rather than slow. 19 of the web test files each
    // build their own jsdom environment, the server's integration tests each
    // stand up Fastify and hit Postgres, and vitest runs one worker per core.
    // The interactions they await — user-event clicks, findBy* queries, HTTP
    // round trips — are wall-clock, so a test waiting for a CPU slice spends
    // its budget without progressing. On a busy machine that crosses vitest's
    // 5s default and the suite fails somewhere different each run.
    //
    // A ceiling is not a delay: a healthy parallel run still finishes in
    // seconds. Measured on a 12-core box with 10 cores held busy, the web
    // suite fails on the default and passes 322/322 at this value.
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['./tests/setup.ts'],
    // registry-server has its own vitest.config.ts and .env — run it separately
    exclude: ['registry-server/**', '**/node_modules/**'],
  },
});
