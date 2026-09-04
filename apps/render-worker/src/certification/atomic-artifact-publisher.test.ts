import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  publishArtifactPair,
  ArtifactWriterError,
  type PublishedArtifactPairResult
} from "./atomic-artifact-publisher.js";
import {
  writeCertificationArtifacts,
  type WriteCertificationArtifactsResult
} from "./artifact-writer.js";
import type { LtxCertificationArtifact } from "@cco/contracts";

function createLtxFixture(runId = "trinidad-rtx4090-dynamicvram-v1"): LtxCertificationArtifact {
  return {
    version: 1,
    runId,
    generatedAt: "2026-08-15T20:00:00.000Z",
    status: "passed",
    runnerMode: "dynamicvram",
    identity: {
      profileId: "ltx-25-720p-97f",
      renderProfileKey: "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      engine: "ltx_25",
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      workflowSha256: "a".repeat(64),
      modelSha256: {
        checkpoint: "b".repeat(64),
        textEncoder: "c".repeat(64),
        vae: "d".repeat(64)
      },
      comfyUiCommit: "e".repeat(40),
      customNodes: [
        {
          name: "ComfyUI-LTXVideo",
          commit: "f".repeat(40),
          status: "tracked"
        }
      ]
    },
    environment: {
      nodeVersion: "v24.0.0",
      platform: "linux",
      arch: "x64",
      osRelease: "6.8.0-40-generic",
      osVersion: "#40-Ubuntu SMP PREEMPT_DYNAMIC",
      cpuModel: "AMD Ryzen 9 7950X",
      cpuCount: 32,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      gpuDriverVersion: "550.54.14",
      gpuTotalMemoryMb: 24564,
      cudaVersion: "12.4",
      comfyUiPid: 12345,
      comfyUiArgs: ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
    },
    render: {
      executionId: "exec-123",
      status: "succeeded",
      outputObjectKeys: ["renders/scene-1/output.mp4"],
      startedAt: "2026-08-15T20:00:01.000Z",
      completedAt: "2026-08-15T20:00:47.000Z",
      totalDurationMs: 46000
    },
    telemetry: {
      sampleIntervalMs: 200,
      samples: [
        {
          measuredAt: "2026-08-15T20:00:01.000Z",
          phase: "pre_dispatch",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 1024,
            freeVramMb: 23540,
            reservedVramMb: 0
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 50000,
            hostRamUsedMb: 14000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 100,
            systemMinorPageFaults: 5000,
            processPid: 12345,
            processStartTimeTicks: 100000,
            processRssMb: 1200,
            processMajorPageFaults: 10,
            processMinorPageFaults: 500
          }
        },
        {
          measuredAt: "2026-08-15T20:00:52.000Z",
          phase: "post_unload",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 1024,
            freeVramMb: 23540,
            reservedVramMb: 0
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 49500,
            hostRamUsedMb: 14500,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 106,
            systemMinorPageFaults: 6200,
            processPid: 12345,
            processStartTimeTicks: 100000,
            processRssMb: 1300,
            processMajorPageFaults: 12,
            processMinorPageFaults: 1300
          }
        }
      ],
      samplingErrors: [],
      peakVramMb: 24028,
      reservedVramMb: 0,
      peakHostRamUsedMb: 19000,
      peakProcessRssMb: 4500,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 6,
      systemMinorPageFaultDelta: 1200,
      processMajorPageFaultDelta: 2,
      processMinorPageFaultDelta: 800,
      postUnloadUsedVramMb: 1024,
      postUnloadFreeVramMb: 23540
    },
    gate: {
      passed: true,
      maxDurationMs: 55000,
      checks: {
        renderSuccess: true,
        noOom: true,
        durationWithinLimit: true,
        telemetryComplete: true,
        postUnloadHeadroomObserved: true
      }
    },
    failure: null
  };
}

describe("atomic-artifact-publisher", () => {
  let tempTestDir: string;

  beforeEach(async () => {
    tempTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "publisher-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  it("publishes JSON and Markdown from one validated artifact without overwrite", async () => {
    const outputRoot = path.join(tempTestDir, "artifacts");
    const runId = "test-run-001";
    const jsonContent = JSON.stringify({ hello: "world" }, null, 2) + "\n";
    const markdownContent = "# Test Summary\n";

    const result: PublishedArtifactPairResult = await publishArtifactPair({
      outputRoot,
      runId,
      jsonContent,
      markdownContent,
      repoRoot: tempTestDir
    });

    const expectedDir = path.join(outputRoot, runId);
    const expectedJsonPath = path.join(expectedDir, "result.json");
    const expectedMdPath = path.join(expectedDir, "summary.md");

    expect(result.runId).toBe(runId);
    expect(result.outputDirectory).toBe(expectedDir);
    expect(result.resultJsonPath).toBe(expectedJsonPath);
    expect(result.summaryMdPath).toBe(expectedMdPath);
    expect(result.relativeOutputDirectory).toBe(path.relative(tempTestDir, expectedDir));
    expect(result.relativeResultJsonPath).toBe(path.relative(tempTestDir, expectedJsonPath));
    expect(result.relativeSummaryMdPath).toBe(path.relative(tempTestDir, expectedMdPath));

    const readJson = await fs.readFile(expectedJsonPath, "utf8");
    const readMd = await fs.readFile(expectedMdPath, "utf8");

    expect(readJson).toBe(jsonContent);
    expect(readMd).toBe(markdownContent);
  });

  it("publishes approved-provenance.json alongside result.json and summary.md when approvedProvenanceContent is provided", async () => {
    const outputRoot = path.join(tempTestDir, "artifacts");
    const runId = "test-run-provenance";
    const jsonContent = JSON.stringify({ hello: "world" }, null, 2) + "\n";
    const markdownContent = "# Test Summary\n";
    const approvedProvenanceContent =
      JSON.stringify({ version: 1, profileId: "ltx-25-720p-97f" }, null, 2) + "\n";

    const result: PublishedArtifactPairResult = await publishArtifactPair({
      outputRoot,
      runId,
      jsonContent,
      markdownContent,
      approvedProvenanceContent,
      repoRoot: tempTestDir
    });

    const expectedDir = path.join(outputRoot, runId);
    const expectedProvPath = path.join(expectedDir, "approved-provenance.json");

    expect(result.approvedProvenancePath).toBe(expectedProvPath);
    expect(result.relativeApprovedProvenancePath).toBe(
      path.relative(tempTestDir, expectedProvPath)
    );

    const readProv = await fs.readFile(expectedProvPath, "utf8");
    expect(readProv).toBe(approvedProvenanceContent);
  });

  it("removes only its owned temp directory after a write or rename failure", async () => {
    const outputRoot = path.join(tempTestDir, "artifacts");
    const runId = "cleanup-test-run";
    const finalDir = path.join(outputRoot, runId);

    // Existing unrelated directory that must NOT be removed
    const existingNeighborDir = path.join(outputRoot, "unrelated-neighbor");
    await fs.mkdir(existingNeighborDir, { recursive: true });
    const canaryFile = path.join(existingNeighborDir, "neighbor.txt");
    await fs.writeFile(canaryFile, "neighbor-content", "utf8");

    // Case 1: write error on summary.md
    const failingWriteFile = vi.fn(
      async (filePath: string, data: string | Uint8Array, options?: unknown) => {
        if (typeof filePath === "string" && filePath.endsWith("summary.md")) {
          throw new Error("Disk write error during summary.md publication");
        }
        await fs.writeFile(filePath, data, options as BufferEncoding);
      }
    );

    await expect(
      publishArtifactPair({
        outputRoot,
        runId,
        jsonContent: "{}",
        markdownContent: "# Fail",
        repoRoot: tempTestDir,
        dependencies: {
          writeFile: failingWriteFile as unknown as typeof fs.writeFile
        }
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify finalDir was never created
    await expect(fs.stat(finalDir)).rejects.toThrow();

    // Verify neighbor directory is completely intact
    const canaryContent = await fs.readFile(canaryFile, "utf8");
    expect(canaryContent).toBe("neighbor-content");

    // Verify no temporary directories exist in outputRoot
    const entries = await fs.readdir(outputRoot);
    expect(entries).toEqual(["unrelated-neighbor"]);

    // Case 2: rename failure
    const failingRename = vi.fn(async () => {
      throw new Error("Rename error");
    });

    await expect(
      publishArtifactPair({
        outputRoot,
        runId,
        jsonContent: "{}",
        markdownContent: "# Fail",
        repoRoot: tempTestDir,
        dependencies: {
          rename: failingRename as unknown as typeof fs.rename
        }
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify only neighbor remains
    const entriesAfter = await fs.readdir(outputRoot);
    expect(entriesAfter).toEqual(["unrelated-neighbor"]);
  });

  it("rejects unsafe run IDs before filesystem operations", async () => {
    const outputRoot = path.join(tempTestDir, "artifacts");
    const unsafeRunIds = [
      "",
      "   ",
      "../escape",
      "../../escape",
      "foo/bar",
      "foo\\bar",
      "foo..bar",
      ".hidden",
      "-flag",
      "_underscore",
      "UPPERCASE",
      "run with spaces"
    ];

    for (const unsafeId of unsafeRunIds) {
      await expect(
        publishArtifactPair({
          outputRoot,
          runId: unsafeId,
          jsonContent: "{}",
          markdownContent: "# Test",
          repoRoot: tempTestDir
        })
      ).rejects.toThrow(ArtifactWriterError);
    }
  });

  it("refuses to overwrite an existing directory", async () => {
    const outputRoot = path.join(tempTestDir, "artifacts");
    const runId = "existing-run-001";
    const existingDir = path.join(outputRoot, runId);

    await fs.mkdir(existingDir, { recursive: true });
    const canaryFile = path.join(existingDir, "canary.txt");
    await fs.writeFile(canaryFile, "precious-evidence", "utf8");

    await expect(
      publishArtifactPair({
        outputRoot,
        runId,
        jsonContent: "{}",
        markdownContent: "# Overwrite attempt",
        repoRoot: tempTestDir
      })
    ).rejects.toThrow(ArtifactWriterError);

    const canary = await fs.readFile(canaryFile, "utf8");
    expect(canary).toBe("precious-evidence");
  });

  it("retains existing LTX artifact writer behavior through the shared publisher", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "ltx-25");
    const artifact = createLtxFixture("run-ltx-shared-01");

    const result: WriteCertificationArtifactsResult = await writeCertificationArtifacts({
      outputRoot,
      artifact,
      repoRoot: tempTestDir
    });

    expect(result.runId).toBe("run-ltx-shared-01");
    expect(result.artifact).toEqual(artifact);

    const rawJson = await fs.readFile(result.resultJsonPath, "utf8");
    expect(rawJson.endsWith("\n")).toBe(true);
    expect(JSON.parse(rawJson)).toEqual(artifact);

    const rawMd = await fs.readFile(result.summaryMdPath, "utf8");
    expect(rawMd.endsWith("\n")).toBe(true);
    expect(rawMd).toContain("run-ltx-shared-01");
  });
});
