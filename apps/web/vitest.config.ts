import { defineConfig } from "vitest/config";

// Unit tests for pure client-side logic (no DOM needed).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
