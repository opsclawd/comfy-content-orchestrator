import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { LtxCertificationArtifact } from "@cco/contracts";
import { renderCertificationSummary } from "@cco/application";
import {
  writeCertificationArtifacts,
  ArtifactWriterError,
  type WriteCertificationArtifactsResult
} from "./artifact-writer.js";

function createValidPassedFixture(
  runId = "trinidad-rtx4090-dynamicvram-v1"
): LtxCertificationArtifact {
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
          measuredAt: "2026-08-15T20:00:20.000Z",
          phase: "sampling",
          gpu: {
            totalVramMb: 24564,
            usedVramMb: 24028,
            freeVramMb: 536,
            reservedVramMb: 0
          },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 45000,
            hostRamUsedMb: 19000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 105,
            systemMinorPageFaults: 6000,
            processPid: 12345,
            processStartTimeTicks: 100000,
            processRssMb: 4500,
            processMajorPageFaults: 12,
            processMinorPageFaults: 1200
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

describe("artifact-writer", () => {
  let tempTestDir: string;

  beforeEach(async () => {
    tempTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-writer-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  // Behavioral invariant: same-result-two-formats
  it("writes JSON and Markdown from the same validated artifact", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "ltx-25");
    const artifact = createValidPassedFixture("run-001");

    const result: WriteCertificationArtifactsResult = await writeCertificationArtifacts({
      outputRoot,
      artifact,
      repoRoot: tempTestDir
    });

    const expectedDir = path.join(outputRoot, "run-001");
    const expectedJsonPath = path.join(expectedDir, "result.json");
    const expectedMdPath = path.join(expectedDir, "summary.md");

    expect(result.runId).toBe("run-001");
    expect(result.outputDirectory).toBe(expectedDir);
    expect(result.resultJsonPath).toBe(expectedJsonPath);
    expect(result.summaryMdPath).toBe(expectedMdPath);
    expect(result.relativeOutputDirectory).toBe(path.relative(tempTestDir, expectedDir));
    expect(result.relativeResultJsonPath).toBe(path.relative(tempTestDir, expectedJsonPath));
    expect(result.relativeSummaryMdPath).toBe(path.relative(tempTestDir, expectedMdPath));
    expect(result.artifact).toEqual(artifact);

    // Read result.json
    const rawJson = await fs.readFile(expectedJsonPath, "utf8");
    expect(rawJson.endsWith("\n")).toBe(true);
    const parsedJson = JSON.parse(rawJson);
    expect(parsedJson).toEqual(artifact);

    // Two-space JSON formatting check
    expect(rawJson).toBe(JSON.stringify(artifact, null, 2) + "\n");

    // Read summary.md
    const rawMd = await fs.readFile(expectedMdPath, "utf8");
    expect(rawMd.endsWith("\n")).toBe(true);
    const expectedMd = renderCertificationSummary(artifact);
    expect(rawMd).toBe(expectedMd.endsWith("\n") ? expectedMd : expectedMd + "\n");
  });

  // Behavioral invariant: run-id-cannot-escape-root
  it("rejects unsafe certification run IDs", async () => {
    const outputRoot = path.join(tempTestDir, "certification");
    const unsafeRunIds = [
      "",
      "   ",
      "../escape",
      "../../escape",
      "foo/bar",
      "foo\\bar",
      "foo/../bar",
      "foo..bar",
      ".hidden",
      "-flag",
      "_underscore",
      "UPPERCASE",
      "run with spaces",
      "run\0null",
      "run\nnewline",
      "run@special",
      "run#hash",
      "run$dollar"
    ];

    for (const unsafeId of unsafeRunIds) {
      const artifact = {
        ...createValidPassedFixture(),
        runId: unsafeId
      };

      await expect(
        writeCertificationArtifacts({
          outputRoot,
          artifact,
          repoRoot: tempTestDir
        })
      ).rejects.toThrow();
    }

    // Verify nothing was written under outputRoot
    try {
      const entries = await fs.readdir(outputRoot);
      expect(entries).toEqual([]);
    } catch (err: unknown) {
      // If outputRoot was not created, that is also completely fine and safe
      expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  });

  // Behavioral invariant: existing-result-is-immutable
  it("refuses to overwrite an existing certification run", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "ltx-25");
    const runId = "existing-run-001";
    const existingDir = path.join(outputRoot, runId);

    // Create the existing run directory and a canary file
    await fs.mkdir(existingDir, { recursive: true });
    const canaryFile = path.join(existingDir, "canary.txt");
    await fs.writeFile(canaryFile, "precious-evidence-do-not-delete", "utf8");

    const artifact = createValidPassedFixture(runId);

    await expect(
      writeCertificationArtifacts({
        outputRoot,
        artifact,
        repoRoot: tempTestDir
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify existing directory and canary file are completely untouched
    const canaryContent = await fs.readFile(canaryFile, "utf8");
    expect(canaryContent).toBe("precious-evidence-do-not-delete");

    // Verify no temporary files remain in outputRoot
    const entries = await fs.readdir(outputRoot);
    expect(entries).toEqual([runId]);
  });

  // Behavioral invariant: partial-publication-is-hidden
  it("does not expose a partial final artifact directory on write failure", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "ltx-25");
    const artifact = createValidPassedFixture("failed-write-run");
    const finalDir = path.join(outputRoot, "failed-write-run");

    // Case 1: writeFile fails for summary.md
    const failingWriteFile = vi.fn(
      async (filePath: string, data: string | Uint8Array, options?: unknown) => {
        if (typeof filePath === "string" && filePath.endsWith("summary.md")) {
          throw new Error("Disk write error during summary.md publication");
        }
        await fs.writeFile(filePath, data, options as BufferEncoding);
      }
    );

    await expect(
      writeCertificationArtifacts({
        outputRoot,
        artifact,
        repoRoot: tempTestDir,
        dependencies: {
          writeFile: failingWriteFile as unknown as typeof fs.writeFile
        }
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify final directory was NEVER created
    await expect(fs.stat(finalDir)).rejects.toThrow();

    // Verify no temporary directory left in outputRoot
    const outputEntries1 = await fs.readdir(outputRoot);
    expect(outputEntries1).toEqual([]);

    // Case 2: rename fails
    const failingRename = vi.fn(async () => {
      throw new Error("Rename failed due to cross-device link or locked directory");
    });

    await expect(
      writeCertificationArtifacts({
        outputRoot,
        artifact,
        repoRoot: tempTestDir,
        dependencies: {
          rename: failingRename as unknown as typeof fs.rename
        }
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify final directory was NEVER created
    await expect(fs.stat(finalDir)).rejects.toThrow();

    // Verify no temporary directory left in outputRoot
    const outputEntries2 = await fs.readdir(outputRoot);
    expect(outputEntries2).toEqual([]);
  });

  it("publishes a failed certification artifact with failure details", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "ltx-25");
    const failedArtifact: LtxCertificationArtifact = {
      ...createValidPassedFixture("failed-run-001"),
      status: "failed",
      render: {
        executionId: "exec-999",
        status: "failed",
        outputObjectKeys: [],
        startedAt: "2026-08-15T20:00:01.000Z",
        completedAt: "2026-08-15T20:00:25.000Z",
        totalDurationMs: 24000
      },
      telemetry: {
        ...createValidPassedFixture().telemetry,
        postUnloadUsedVramMb: null,
        postUnloadFreeVramMb: null
      },
      gate: {
        passed: false,
        maxDurationMs: 55000,
        checks: {
          renderSuccess: false,
          noOom: true,
          durationWithinLimit: true,
          telemetryComplete: false,
          postUnloadHeadroomObserved: false
        }
      },
      failure: {
        phase: "rendering",
        code: "render_failed",
        message: "ComfyUI execution failed on node 5"
      }
    };

    const result = await writeCertificationArtifacts({
      outputRoot,
      artifact: failedArtifact,
      repoRoot: tempTestDir
    });

    expect(result.runId).toBe("failed-run-001");
    const rawJson = await fs.readFile(result.resultJsonPath, "utf8");
    expect(JSON.parse(rawJson)).toEqual(failedArtifact);

    const rawMd = await fs.readFile(result.summaryMdPath, "utf8");
    expect(rawMd).toContain("FAILED");
    expect(rawMd).toContain("ComfyUI execution failed on node 5");
  });

  it("rejects an invalid artifact schema before performing any filesystem operations", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "ltx-25");
    // Invalid artifact: passed status but failure is non-null
    const invalidArtifact = {
      ...createValidPassedFixture("invalid-run"),
      failure: {
        phase: "rendering",
        code: "some_code",
        message: "some message"
      }
    };

    await expect(
      writeCertificationArtifacts({
        outputRoot,
        artifact: invalidArtifact,
        repoRoot: tempTestDir
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify output root was not created
    await expect(fs.stat(outputRoot)).rejects.toThrow();
  });
});
