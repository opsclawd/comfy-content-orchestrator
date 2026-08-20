import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { cruise } from "dependency-cruiser";
import type { ICruiseResult, IViolation } from "dependency-cruiser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

describe("apps/web Architectural Boundaries", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const configPath = path.resolve(repoRoot, ".dependency-cruiser.cjs");
  const config = require(configPath);

  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-web-boundary-test-"));
    fs.copyFileSync(
      path.resolve(repoRoot, "tsconfig.base.json"),
      path.join(tempDir, "tsconfig.base.json")
    );
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeFixture(relPath: string, content: string): void {
    const fullPath = path.join(tempDir, relPath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
  }

  async function getViolations(files: string[]): Promise<IViolation[]> {
    const result = await cruise(files, {
      ...config.options,
      baseDir: tempDir,
      ruleSet: config,
      validate: true
    });
    const cruiseResult = result.output as ICruiseResult;
    return cruiseResult.summary.violations;
  }

  it("should reject apps/web -> application imports", async () => {
    writeFixture("packages/application/src/index.ts", "export const useCase = 1;\n");
    writeFixture(
      "apps/web/src/violating-app.ts",
      "import '../../../packages/application/src/index.js';\n"
    );

    const violations = await getViolations(["apps/web/src/violating-app.ts"]);
    const violationNames = violations.map((v) => v.rule.name);

    expect(violationNames).toContain("web-no-server-packages");
  });

  it("should reject apps/web -> infrastructure imports", async () => {
    writeFixture("packages/infrastructure/src/index.ts", "export const infra = 1;\n");
    writeFixture(
      "apps/web/src/violating-infra.ts",
      "import '../../../packages/infrastructure/src/index.js';\n"
    );

    const violations = await getViolations(["apps/web/src/violating-infra.ts"]);
    const violationNames = violations.map((v) => v.rule.name);

    expect(violationNames).toContain("web-no-server-packages");
  });

  it("should allow apps/web -> contracts and shared imports", async () => {
    writeFixture("packages/contracts/src/index.ts", "export const schema = 1;\n");
    writeFixture("packages/shared/src/index.ts", "export const util = 1;\n");
    writeFixture(
      "apps/web/src/valid-imports.ts",
      "import '../../../packages/contracts/src/index.js';\nimport '../../../packages/shared/src/index.js';\n"
    );

    const violations = await getViolations(["apps/web/src/valid-imports.ts"]);
    const webViolations = violations.filter((v) => v.rule.name === "web-no-server-packages");

    expect(webViolations).toHaveLength(0);
  });
});
