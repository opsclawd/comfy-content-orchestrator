import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { cruise } from "dependency-cruiser";
import type { ICruiseResult, IViolation } from "dependency-cruiser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresReviewEventStore,
  PostgresSceneRepository,
  PostgresSceneReviewQueries,
  PostgresStoryboardCandidateRepository,
  PostgresUnitOfWork
} from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

describe("Architecture Boundaries", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const configPath = path.resolve(repoRoot, ".dependency-cruiser.cjs");
  const config = require(configPath);

  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-arch-test-"));
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

  it("should export postgres review adapters and queries from index", () => {
    expect(PostgresSceneRepository).toBeDefined();
    expect(PostgresStoryboardCandidateRepository).toBeDefined();
    expect(PostgresReviewEventStore).toBeDefined();
    expect(PostgresUnitOfWork).toBeDefined();
    expect(PostgresSceneReviewQueries).toBeDefined();
  });

  it("should reject application -> infrastructure imports", async () => {
    writeFixture("packages/infrastructure/src/index.ts", "export const infra = 1;\n");
    writeFixture(
      "packages/application/src/app-violating.ts",
      "import '../../infrastructure/src/index.js';\n"
    );

    const violations = await getViolations(["packages/application/src/app-violating.ts"]);
    const violationNames = violations.map((v) => v.rule.name);

    expect(violationNames).toContain("application-no-infrastructure");
  });

  it("should reject domain -> application imports", async () => {
    writeFixture("packages/application/src/index.ts", "export const app = 1;\n");
    writeFixture(
      "packages/domain/src/domain-violating.ts",
      "import '../../application/src/index.js';\n"
    );

    const violations = await getViolations(["packages/domain/src/domain-violating.ts"]);
    const violationNames = violations.map((v) => v.rule.name);

    expect(violationNames).toContain("domain-only-shared");
  });

  it("should reject infrastructure -> application use cases imports", async () => {
    writeFixture(
      "packages/application/src/use-cases/dummy-use-case.ts",
      "export class DummyUseCase {}\n"
    );
    writeFixture(
      "packages/infrastructure/src/infra-violating.ts",
      "import '../../application/src/use-cases/dummy-use-case.js';\n"
    );

    const violations = await getViolations(["packages/infrastructure/src/infra-violating.ts"]);
    const violationNames = violations.map((v) => v.rule.name);

    expect(violationNames).toContain("infrastructure-no-application-use-cases");
  });

  it("should detect circular dependencies", async () => {
    writeFixture("packages/application/src/circ-a.ts", "import './circ-b.js';\n");
    writeFixture("packages/application/src/circ-b.ts", "import './circ-a.js';\n");

    const violations = await getViolations([
      "packages/application/src/circ-a.ts",
      "packages/application/src/circ-b.ts"
    ]);
    const violationNames = violations.map((v) => v.rule.name);

    expect(violationNames).toContain("no-circular");
  });

  it("verifies s3-object-storage contains no admission policy branching", () => {
    const s3Path = path.resolve(__dirname, "storage/s3-object-storage.ts");
    const content = fs.readFileSync(s3Path, "utf-8");
    expect(content).not.toContain("evaluateStorageWatermark");
    expect(content).not.toContain("StorageAdmission");
    expect(content).not.toContain("canAdmit");
    expect(content).not.toContain("watermark");
  });
});
