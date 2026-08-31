import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  test: {
    include: ["packages/infrastructure/src/ffmpeg/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000
  },
  resolve: {
    alias: {
      "@cco/infrastructure/testing": resolve(rootDir, "packages/infrastructure/src/testing.ts"),
      "@cco/infrastructure": resolve(rootDir, "packages/infrastructure/src/index.ts"),
      "@cco/application": resolve(rootDir, "packages/application/src/index.ts"),
      "@cco/domain": resolve(rootDir, "packages/domain/src/index.ts"),
      "@cco/contracts": resolve(rootDir, "packages/contracts/src/index.ts"),
      "@cco/shared": resolve(rootDir, "packages/shared/src/index.ts")
    }
  }
});
