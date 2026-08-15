import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/infrastructure/src/comfyui/render-engine-adapter.smoke.integration.test.ts"
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000
  }
});
