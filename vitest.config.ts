import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["packages/**/src/**/*.test.ts", "packages/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Every test file that touches the db package shares one live Postgres
    // database (hoosradar_test) with no per-test transaction isolation yet.
    // Vitest's default file-level parallelism turns "independent" test files
    // into genuine races on shared tables — observed directly while building
    // this: claimNextRun() from one file claiming a row another file had
    // just enqueued, and two files' seed() calls interleaving deletes and
    // inserts against the same source. Serializing files is the correct,
    // honestly-scoped fix at this size; the real fix (each test running in
    // its own rolled-back transaction) is worth doing once the suite is
    // large enough for sequential runtime to matter.
    fileParallelism: false,
  },
});
