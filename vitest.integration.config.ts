import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/infrastructure/src/**/*.integration.test.ts",
      "apps/*/src/**/*.integration.test.ts"
    ],
    exclude: ["**/*.smoke.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
});
