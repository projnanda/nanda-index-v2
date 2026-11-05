import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // Mirrors tsconfig's "@/*" → "./src/*" so tests import modules the way the app does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
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
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Let jsdom provide browser storage instead of Node's file-backed globals.
    // Older supported Node versions do not recognize this flag.
    execArgv: process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
      ? ["--no-experimental-webstorage"]
      : [],
  },
});
