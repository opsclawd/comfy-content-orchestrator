import { test as base, expect } from "@playwright/test";
import { setupE2ETestEnvironment, type E2ETestEnvironment } from "./index.js";

export interface TestFixtures {
  testEnv: E2ETestEnvironment;
}

export interface WorkerFixtures {
  workerEnv: E2ETestEnvironment;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerEnv: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const env = await setupE2ETestEnvironment();
      await use(env);
      await env.teardown();
    },
    { scope: "worker", auto: true }
  ],
  testEnv: async ({ workerEnv }, use) => {
    await use(workerEnv);
  }
});

export { expect };
