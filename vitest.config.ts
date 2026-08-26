import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  test: {
    include: [
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
      "apps/*/src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.{ts,tsx,js,mjs}"
    ],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node"
  }
});
