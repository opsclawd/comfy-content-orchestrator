import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TransitionSoakArtifact, TransitionSoakIteration } from "@cco/contracts";
import { renderTransitionSoakSummary } from "@cco/application";
import {
  writeTransitionSoakArtifacts,
  ArtifactWriterError,
  type WriteTransitionSoakArtifactsResult
} from "./transition-artifact-writer.js";

function createSampleTelemetry() {
  return {
    sampleIntervalMs: 200 as const,
    samples: [
      {
        measuredAt: "2026-08-16T19:00:01.000Z",
        phase: "pre_dispatch" as const,
        gpu: { totalVramMb: 24564, usedVramMb: 564, freeVramMb: 23487, reservedVramMb: 513 },
        host: {
          hostRamTotalMb: 31233,
          hostRamAvailableMb: 27400,
          hostRamUsedMb: 3833,
          swapTotalMb: 40960,
          swapUsedMb: 0,
          systemSwapInPages: 0,
          systemSwapOutPages: 0,
          systemMajorPageFaults: 100,
          systemMinorPageFaults: 5000,
          processPid: 69326,
          processStartTimeTicks: 17028742,
          processRssMb: 1200,
          processMajorPageFaults: 10,
          processMinorPageFaults: 500
        }
      },
      {
        measuredAt: "2026-08-16T19:00:10.000Z",
        phase: "sampling" as const,
        gpu: { totalVramMb: 24564, usedVramMb: 23900, freeVramMb: 664, reservedVramMb: 513 },
        host: {
          hostRamTotalMb: 31233,
          hostRamAvailableMb: 2500,
          hostRamUsedMb: 28733,
          swapTotalMb: 40960,
          swapUsedMb: 0,
          systemSwapInPages: 0,
          systemSwapOutPages: 0,
          systemMajorPageFaults: 100,
          systemMinorPageFaults: 6000,
          processPid: 69326,
          processStartTimeTicks: 17028742,
          processRssMb: 26000,
          processMajorPageFaults: 10,
          processMinorPageFaults: 600
        }
      },
      {
        measuredAt: "2026-08-16T19:00:12.000Z",
        phase: "post_unload" as const,
        gpu: { totalVramMb: 24564, usedVramMb: 564, freeVramMb: 23487, reservedVramMb: 513 },
        host: {
          hostRamTotalMb: 31233,
          hostRamAvailableMb: 27400,
          hostRamUsedMb: 3833,
          swapTotalMb: 40960,
          swapUsedMb: 0,
          systemSwapInPages: 0,
          systemSwapOutPages: 0,
          systemMajorPageFaults: 100,
          systemMinorPageFaults: 6100,
          processPid: 69326,
          processStartTimeTicks: 17028742,
          processRssMb: 1970,
          processMajorPageFaults: 10,
          processMinorPageFaults: 610
        }
      }
    ],
    samplingErrors: [],
    peakVramMb: 23900,
    reservedVramMb: 513,
    peakHostRamUsedMb: 28733,
    peakProcessRssMb: 26000,
    swapUsedDeltaMb: 0,
    systemSwapInPageDelta: 0,
    systemSwapOutPageDelta: 0,
    systemMajorPageFaultDelta: 0,
    systemMinorPageFaultDelta: 1100,
    processMajorPageFaultDelta: 0,
    processMinorPageFaultDelta: 110,
    postUnloadUsedVramMb: 564,
    postUnloadFreeVramMb: 23487
  };
}

function createElevenIterations(): TransitionSoakIteration[] {
  const iterations: TransitionSoakIteration[] = [];
  for (let i = 0; i <= 10; i++) {
    const isFlux = i % 2 === 0;
    const family = isFlux ? ("flux" as const) : ("ltx" as const);
    const fromFamily = i === 0 ? null : i % 2 === 1 ? ("flux" as const) : ("ltx" as const);
    const transitionIndex = i === 0 ? null : i;

    iterations.push({
      renderIndex: i,
      transitionIndex,
      fromFamily,
      family,
      render: {
        executionId: `exec-${i}`,
        status: "succeeded" as const,
        outputObjectKeys: [isFlux ? `flux_000${i}.png` : `ltx_000${i}.webp`],
        startedAt: "2026-08-16T19:00:01.000Z",
        completedAt: "2026-08-16T19:00:11.000Z",
        totalDurationMs: isFlux ? 10000 : 45000
      },
      telemetry: createSampleTelemetry(),
      cleanup: {
        startedAt: "2026-08-16T19:00:11.000Z",
        completedAt: "2026-08-16T19:00:12.000Z",
        durationMs: 1000,
        attempts: 2,
        postUnloadFreeVramMb: 23487,
        passed: true
      },
      oomDetected: false,
      comfyUiRestarted: false,
      failure: null
    });
  }
  return iterations;
}

function createValidPassedTransitionFixture(
  runId = "trinidad-rtx4090-dynamicvram-v1"
): TransitionSoakArtifact {
  return {
    version: 1,
    runId,
    generatedAt: "2026-08-16T19:05:00.000Z",
    status: "passed",
    runnerProfile: "dynamicvram-offload-v1",
    requestedTransitionCount: 10,
    completedTransitionCount: 10,
    thresholds: {
      minPostUnloadFreeVramMb: 23000,
      minHostAvailableMb: 1024,
      maxVramGrowthMb: 256,
      maxHostGrowthMb: 256,
      maxLatencyDegradationPercent: 20,
      cleanupTimeoutMs: 30000,
      cleanupPollIntervalMs: 500
    },
    baselines: {
      flux: {
        profileId: "flux-schnell-draft",
        baselineDurationMs: 11020,
        peakVramMb: 23938,
        peakHostRamUsedMb: 29087,
        peakProcessRssMb: 26874,
        postUnloadFreeVramMb: 23487
      },
      ltx: {
        profileId: "ltx-25-720p-97f",
        baselineDurationMs: 46874,
        peakVramMb: 24028,
        peakHostRamUsedMb: 29325,
        peakProcessRssMb: 27364,
        postUnloadFreeVramMb: 23487
      }
    },
    identities: {
      flux: {
        profileId: "flux-schnell-draft",
        engine: "flux_schnell",
        renderProfileKey: null,
        renderProfileVersion: null,
        width: 1024,
        height: 1024,
        frames: 1,
        steps: 4,
        workflowSha256: "a".repeat(64),
        modelSha256: {
          "models/diffusion_models/flux1-schnell.safetensors": "b".repeat(64)
        },
        comfyUiCommit: "c".repeat(40),
        customNodes: [],
        measuredDiskFootprintGb: 35.2,
        minFreeDiskGb: 0
      },
      ltx: {
        profileId: "ltx-25-720p-97f",
        engine: "ltx_25",
        renderProfileKey: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        width: 1280,
        height: 720,
        frames: 97,
        steps: 8,
        workflowSha256: "d".repeat(64),
        modelSha256: {
          "models/diffusion_models/ltx-2.5-22b.safetensors": "e".repeat(64)
        },
        comfyUiCommit: "c".repeat(40),
        customNodes: [],
        measuredDiskFootprintGb: 68.8,
        minFreeDiskGb: 100
      }
    },
    environment: {
      nodeVersion: "v24.19.0",
      platform: "linux",
      arch: "x64",
      osRelease: "6.8.0-117-generic",
      osVersion: "#117-Ubuntu SMP PREEMPT_DYNAMIC",
      cpuModel: "AMD Ryzen 7 7700X 8-Core Processor",
      cpuCount: 16,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuUuid: "GPU-89a53488-359c-4942-75ae-47ee8aa89f53",
      gpuDriverVersion: "595.58.03",
      gpuTotalMemoryMb: 24564,
      cudaVersion: "13.2",
      comfyUiPid: 69326,
      comfyUiArgs: ["/path/to/python", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
    },
    iterations: createElevenIterations(),
    aggregates: {
      peakVramMb: 24028,
      peakHostRamUsedMb: 29325,
      peakProcessRssMb: 27364,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 0,
      systemMinorPageFaultDelta: 1100,
      processMajorPageFaultDelta: 0,
      processMinorPageFaultDelta: 110,
      renderFailureCount: 0,
      cleanupFailureCount: 0,
      samplingErrorCount: 0,
      oomCount: 0,
      unexpectedRestartCount: 0,
      sameFamilyPeakVramGrowthMb: { flux: 0, ltx: 0 },
      sameFamilyPeakHostRamGrowthMb: { flux: 0, ltx: 0 },
      sameFamilyPeakProcessRssGrowthMb: { flux: 0, ltx: 0 },
      postUnloadUsedVramGrowthMb: 0,
      postUnloadHostRamGrowthMb: 0,
      postUnloadProcessRssGrowthMb: 0,
      latencyDegradationPercent: { flux: 1.2, ltx: 1.5 }
    },
    gate: {
      passed: true,
      checks: {
        completedRequiredTransitions: true,
        allRendersSuccessful: true,
        allCleanupsSuccessful: true,
        noOom: true,
        noUnexpectedRestarts: true,
        noSamplingErrors: true,
        noSwapActivity: true,
        postUnloadVramHeadroomMet: true,
        hostMemoryHeadroomMet: true,
        vramGrowthWithinTolerance: true,
        hostGrowthWithinTolerance: true,
        latencyWithinTolerance: true
      }
    },
    hostRamDecision: "support_32gb",
    selectedRunnerProfile: "dynamicvram-offload-v1",
    failure: null
  };
}

function createFailedPartialTransitionFixture(
  runId = "failed-transition-run-001"
): TransitionSoakArtifact {
  const base = createValidPassedTransitionFixture(runId);
  const iter0 = base.iterations[0]!;
  const iter1 = base.iterations[1]!;

  return {
    ...base,
    status: "failed",
    completedTransitionCount: 2,
    iterations: [
      iter0,
      iter1,
      {
        renderIndex: 2,
        transitionIndex: 2,
        fromFamily: "ltx",
        family: "flux",
        render: {
          executionId: "exec-2",
          status: "failed",
          outputObjectKeys: [],
          startedAt: "2026-08-16T19:01:30.000Z",
          completedAt: "2026-08-16T19:01:35.000Z",
          totalDurationMs: 5000
        },
        telemetry: {
          sampleIntervalMs: 200 as const,
          samples: [],
          samplingErrors: [{ measuredAt: "2026-08-16T19:01:35.000Z", message: "OOM killed" }],
          peakVramMb: null,
          reservedVramMb: null,
          peakHostRamUsedMb: null,
          peakProcessRssMb: null,
          swapUsedDeltaMb: null,
          systemSwapInPageDelta: null,
          systemSwapOutPageDelta: null,
          systemMajorPageFaultDelta: null,
          systemMinorPageFaultDelta: null,
          processMajorPageFaultDelta: null,
          processMinorPageFaultDelta: null,
          postUnloadUsedVramMb: null,
          postUnloadFreeVramMb: null
        },
        cleanup: {
          startedAt: "2026-08-16T19:01:35.000Z",
          completedAt: "2026-08-16T19:01:36.000Z",
          durationMs: 1000,
          attempts: 1,
          postUnloadFreeVramMb: null,
          passed: false
        },
        oomDetected: true,
        comfyUiRestarted: false,
        failure: {
          phase: "rendering",
          code: "CUDA_OUT_OF_MEMORY",
          message: "CUDA out of memory during diffusion step"
        }
      }
    ],
    aggregates: {
      peakVramMb: 24028,
      peakHostRamUsedMb: 29325,
      peakProcessRssMb: 27364,
      swapUsedDeltaMb: null,
      systemSwapInPageDelta: null,
      systemSwapOutPageDelta: null,
      systemMajorPageFaultDelta: null,
      systemMinorPageFaultDelta: null,
      processMajorPageFaultDelta: null,
      processMinorPageFaultDelta: null,
      renderFailureCount: 1,
      cleanupFailureCount: 1,
      samplingErrorCount: 1,
      oomCount: 1,
      unexpectedRestartCount: 0,
      sameFamilyPeakVramGrowthMb: { flux: null, ltx: null },
      sameFamilyPeakHostRamGrowthMb: { flux: null, ltx: null },
      sameFamilyPeakProcessRssGrowthMb: { flux: null, ltx: null },
      postUnloadUsedVramGrowthMb: null,
      postUnloadHostRamGrowthMb: null,
      postUnloadProcessRssGrowthMb: null,
      latencyDegradationPercent: { flux: null, ltx: null }
    },
    gate: {
      passed: false,
      checks: {
        completedRequiredTransitions: false,
        allRendersSuccessful: false,
        allCleanupsSuccessful: false,
        noOom: false,
        noUnexpectedRestarts: true,
        noSamplingErrors: false,
        noSwapActivity: true,
        postUnloadVramHeadroomMet: false,
        hostMemoryHeadroomMet: true,
        vramGrowthWithinTolerance: false,
        hostGrowthWithinTolerance: false,
        latencyWithinTolerance: false
      }
    },
    hostRamDecision: "require_64gb",
    selectedRunnerProfile: null,
    failure: {
      phase: "rendering",
      code: "CUDA_OUT_OF_MEMORY",
      message: "CUDA out of memory in iteration 2"
    }
  };
}

describe("transition-artifact-writer", () => {
  let tempTestDir: string;

  beforeEach(async () => {
    tempTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "transition-writer-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  });

  // Behavioral invariant: validate-before-write
  it("validates transition evidence before filesystem writes", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "transition-soak");
    // Invalid artifact: missing required fields
    const invalidArtifact = {
      version: 1,
      runId: "invalid-soak-run",
      status: "passed"
    };

    await expect(
      writeTransitionSoakArtifacts({
        outputRoot,
        artifact: invalidArtifact,
        repoRoot: tempTestDir
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Verify output root was not created
    await expect(fs.stat(outputRoot)).rejects.toThrow();
  });

  // Behavioral invariant: atomic-pair-publication
  it("publishes JSON and Markdown from one validated artifact without overwrite", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "transition-soak");
    const artifact = createValidPassedTransitionFixture("transition-run-001");

    const result: WriteTransitionSoakArtifactsResult = await writeTransitionSoakArtifacts({
      outputRoot,
      artifact,
      repoRoot: tempTestDir
    });

    const expectedDir = path.join(outputRoot, "transition-run-001");
    const expectedJsonPath = path.join(expectedDir, "result.json");
    const expectedMdPath = path.join(expectedDir, "summary.md");

    expect(result.runId).toBe("transition-run-001");
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
    const expectedMd = renderTransitionSoakSummary(artifact);
    expect(rawMd).toBe(expectedMd.endsWith("\n") ? expectedMd : expectedMd + "\n");
  });

  // Behavioral invariant: failed-evidence-is-publishable
  it("publishes failed partial evidence truthfully", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "transition-soak");
    const failedArtifact = createFailedPartialTransitionFixture("failed-soak-run-001");

    const result = await writeTransitionSoakArtifacts({
      outputRoot,
      artifact: failedArtifact,
      repoRoot: tempTestDir
    });

    expect(result.runId).toBe("failed-soak-run-001");
    expect(result.artifact).toEqual(failedArtifact);

    const rawJson = await fs.readFile(result.resultJsonPath, "utf8");
    expect(JSON.parse(rawJson)).toEqual(failedArtifact);

    const rawMd = await fs.readFile(result.summaryMdPath, "utf8");
    expect(rawMd).toContain("FAILED");
    expect(rawMd).toContain("CUDA out of memory");
    expect(rawMd).toContain("require_64gb");
  });

  // Behavioral invariant: owned-temp-cleanup-only
  it("removes only its owned temp directory after a write or rename failure", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "transition-soak");
    const artifact = createValidPassedTransitionFixture("failed-write-run");
    const finalDir = path.join(outputRoot, "failed-write-run");

    // Existing sibling directory that should never be affected
    const siblingDir = path.join(outputRoot, "existing-valid-run");
    await fs.mkdir(siblingDir, { recursive: true });
    const canary = path.join(siblingDir, "canary.txt");
    await fs.writeFile(canary, "sibling-preserved", "utf8");

    // Mock writeFile failure on summary.md
    const failingWriteFile = vi.fn(
      async (filePath: string, data: string | Uint8Array, options?: unknown) => {
        if (typeof filePath === "string" && filePath.endsWith("summary.md")) {
          throw new Error("Disk error on summary.md");
        }
        await fs.writeFile(filePath, data, options as BufferEncoding);
      }
    );

    await expect(
      writeTransitionSoakArtifacts({
        outputRoot,
        artifact,
        repoRoot: tempTestDir,
        dependencies: {
          writeFile: failingWriteFile as unknown as typeof fs.writeFile
        }
      })
    ).rejects.toThrow(ArtifactWriterError);

    // Final dir was never created
    await expect(fs.stat(finalDir)).rejects.toThrow();

    // Sibling directory was preserved
    const canaryRead = await fs.readFile(canary, "utf8");
    expect(canaryRead).toBe("sibling-preserved");

    // Only sibling remains in outputRoot (no lingering temp dirs)
    const entries = await fs.readdir(outputRoot);
    expect(entries).toEqual(["existing-valid-run"]);
  });

  it("supports (outputRoot, artifact) argument overload", async () => {
    const outputRoot = path.join(tempTestDir, "certification", "transition-soak");
    const artifact = createValidPassedTransitionFixture("overload-run-001");

    const result = await writeTransitionSoakArtifacts(outputRoot, artifact);

    expect(result.runId).toBe("overload-run-001");
    expect(result.artifact).toEqual(artifact);

    const rawJson = await fs.readFile(result.resultJsonPath, "utf8");
    expect(JSON.parse(rawJson)).toEqual(artifact);
  });
});
