import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FastH3OmniPreparationService } from "./fasth3-omni-preparation-service.js";
import type { FastH3OmniFilesystemPort } from "../ports/fasth3-omni-experiment-ports.js";

class TestFastH3OmniFilesystem implements FastH3OmniFilesystemPort {
  assertSafeContainment(targetPath: string, allowedRoot: string): void {
    const resolvedRoot = resolve(allowedRoot);
    const resolvedTarget = resolve(targetPath);
    const rel = relative(resolvedRoot, resolvedTarget);

    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `Path containment violation: path "${targetPath}" resolves outside allowed root "${allowedRoot}"`
      );
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const s = await stat(filePath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const s = await stat(dirPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  async computeFileSha256(filePath: string): Promise<string> {
    const buffer = await readFile(filePath);
    return createHash("sha256").update(buffer).digest("hex");
  }

  async stageInputFile(
    sourcePath: string,
    targetPath: string,
    expectedSha256: string
  ): Promise<void> {
    const sourceExists = await this.fileExists(sourcePath);
    if (!sourceExists) {
      throw new Error(`Source asset file not found at "${sourcePath}" for staging`);
    }

    const sourceHash = await this.computeFileSha256(sourcePath);
    if (sourceHash !== expectedSha256) {
      throw new Error(
        `Source asset hash mismatch for "${sourcePath}": expected ${expectedSha256}, got ${sourceHash}`
      );
    }

    const tmpPath = `${targetPath}.tmp.${Date.now()}`;
    await copyFile(sourcePath, tmpPath);

    const stagedHash = await this.computeFileSha256(tmpPath);
    if (stagedHash !== expectedSha256) {
      await unlink(tmpPath).catch(() => {});
      throw new Error(
        `Staged asset verification failed for "${targetPath}": expected ${expectedSha256}, got ${stagedHash}`
      );
    }

    await rename(tmpPath, targetPath);
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
  }

  async readJson<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  }

  async writeText(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, filePath);
  }

  async readText(filePath: string): Promise<string> {
    return readFile(filePath, "utf8");
  }
}

describe("FastH3OmniPreparationService", () => {
  let tempDir: string;
  let fsAdapter: FastH3OmniFilesystemPort;
  let service: FastH3OmniPreparationService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "omni-prep-service-test-"));
    fsAdapter = new TestFastH3OmniFilesystem();
    service = new FastH3OmniPreparationService(fsAdapter);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const setupSourceAssets = async () => {
    const assetsDir = `${tempDir}/source-assets`;
    await fsAdapter.ensureDirectory(assetsDir);

    const asset1Path = `${assetsDir}/actor.png`;
    const asset1Bytes = "image-bytes-actor-png";
    const asset1Hash = createHash("sha256").update(asset1Bytes).digest("hex");
    await writeFile(asset1Path, asset1Bytes);

    const asset2Path = `${assetsDir}/wardrobe.png`;
    const asset2Bytes = "image-bytes-wardrobe-png";
    const asset2Hash = createHash("sha256").update(asset2Bytes).digest("hex");
    await writeFile(asset2Path, asset2Bytes);

    const asset3Path = `${assetsDir}/bottle.jpg`;
    const asset3Bytes = "image-bytes-bottle-jpg";
    const asset3Hash = createHash("sha256").update(asset3Bytes).digest("hex");
    await writeFile(asset3Path, asset3Bytes);

    const manifest = {
      campaignId: "11111111-1111-1111-1111-111111111111",
      sceneId: "22222222-2222-2222-2222-222222222222",
      specRevision: 1,
      referenceSetId: "33333333-3333-3333-3333-333333333333",
      exportDigest: "a".repeat(64),
      createdAt: "2026-10-29T10:00:00Z",
      orderedReferences: [
        {
          assetId: "44444444-4444-4444-4444-444444444444",
          contentHashSha256: asset1Hash,
          mimeType: "image/png" as const,
          width: 1024,
          height: 1024,
          semanticPurposes: ["subject_identity" as const],
          localPath: asset1Path
        },
        {
          assetId: "55555555-5555-5555-5555-555555555555",
          contentHashSha256: asset2Hash,
          mimeType: "image/png" as const,
          width: 1024,
          height: 1024,
          semanticPurposes: ["wardrobe" as const],
          localPath: asset2Path
        },
        {
          assetId: "66666666-6666-6666-6666-666666666666",
          contentHashSha256: asset3Hash,
          mimeType: "image/jpeg" as const,
          width: 1024,
          height: 1024,
          semanticPurposes: ["product" as const],
          localPath: asset3Path
        }
      ]
    };

    const manifestPath = `${tempDir}/manifest.json`;
    await fsAdapter.writeJson(manifestPath, manifest);

    return { manifestPath, asset1Hash, asset2Hash, asset3Hash };
  };

  it("prepares and validates an offline experiment run with 3 references", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    const prep = await service.prepareExperiment({
      runId: "run-test-01",
      manifestPath,
      prompt: "Close up of <Picture 1> wearing <Picture 2> holding <Picture 3> in the rain",
      frames: 124,
      seed: 42,
      outputRoot
    });

    expect(prep.ok).toBe(true);
    expect(prep.runDir).toBe(`${outputRoot}/run-test-01`);
    expect(prep.spec.runId).toBe("run-test-01");
    expect(prep.spec.isExecutable).toBe(false);

    // Durable files written
    expect(await fsAdapter.fileExists(`${prep.runDir}/descriptor.json`)).toBe(true);
    expect(await fsAdapter.fileExists(`${prep.runDir}/config.yaml`)).toBe(false);
    expect(await fsAdapter.fileExists(`${prep.runDir}/command.json`)).toBe(false);
    expect(await fsAdapter.fileExists(`${prep.runDir}/blank-report.json`)).toBe(true);
    expect(await fsAdapter.fileExists(`${prep.runDir}/audit-snapshot.json`)).toBe(true);

    // Validate the prepared run
    const validation = await service.validateExperiment(prep.runDir, { outputRoot });
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.isExecutable).toBe(false);
    expect(validation.spec?.runId).toBe("run-test-01");
  });

  it("refuses to overwrite an existing immutable experiment preparation", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    await service.prepareExperiment({
      runId: "run-immutable",
      manifestPath,
      prompt: "Shot of <Picture 1> <Picture 2> <Picture 3>",
      frames: 124,
      seed: 42,
      outputRoot
    });

    await expect(
      service.prepareExperiment({
        runId: "run-immutable",
        manifestPath,
        prompt: "Shot of <Picture 1> <Picture 2> <Picture 3>",
        frames: 124,
        seed: 42,
        outputRoot
      })
    ).rejects.toThrow(/already exists.*Refusing to overwrite/);
  });

  it("detects staged file tampering during validateExperiment", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    const prep = await service.prepareExperiment({
      runId: "run-tamper",
      manifestPath,
      prompt: "Shot of <Picture 1> <Picture 2> <Picture 3>",
      frames: 124,
      seed: 42,
      outputRoot
    });

    // Tamper with first staged image
    const stagedFile = `${prep.runDir}/inputs/ref_0_44444444.png`;
    await writeFile(stagedFile, "tampered-bytes");

    const validation = await service.validateExperiment(prep.runDir, { outputRoot });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Staged asset hash mismatch"))).toBe(true);
  });

  it("detects descriptor digest mismatch during validateExperiment", async () => {
    const { manifestPath } = await setupSourceAssets();
    const outputRoot = `${tempDir}/runs`;

    const prep = await service.prepareExperiment({
      runId: "run-desc-tamper",
      manifestPath,
      prompt: "Shot of <Picture 1> <Picture 2> <Picture 3>",
      frames: 124,
      seed: 42,
      outputRoot
    });

    // Tamper with descriptor (e.g. modify seed without recalculating descriptorDigest)
    const descriptorPath = `${prep.runDir}/descriptor.json`;
    const descriptor = await fsAdapter.readJson<{
      renderParams: { seed: number };
      [key: string]: unknown;
    }>(descriptorPath);
    descriptor.renderParams.seed = 999999;
    await fsAdapter.writeJson(descriptorPath, descriptor);

    const validation = await service.validateExperiment(prep.runDir, { outputRoot });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes("Descriptor digest mismatch"))).toBe(true);
  });
});
