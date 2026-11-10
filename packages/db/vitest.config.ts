import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Testcontainers pulls and starts Postgres; give it room on a cold machine.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
