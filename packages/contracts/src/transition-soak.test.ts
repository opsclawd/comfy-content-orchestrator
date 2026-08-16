import { describe, expect, it } from "vitest";
import {
  TransitionSoakArtifactSchema,
  type TransitionSoakArtifact,
  type TransitionSoakIteration
} from "./transition-soak.js";

describe("TransitionSoakArtifactSchema", () => {
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
            hostRamAvailableMb: 27500,
            hostRamUsedMb: 3733,
            swapTotalMb: 40960,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 100,
            systemMinorPageFaults: 5000,
            processPid: 69326,
            processStartTimeTicks: 17028742,
            processRssMb: 1967,
            processMajorPageFaults: 10,
            processMinorPageFaults: 500
          }
        },
        {
          measuredAt: "2026-08-16T19:00:10.000Z",
          phase: "sampling" as const,
          gpu: { totalVramMb: 24564, usedVramMb: 23900, freeVramMb: 151, reservedVramMb: 513 },
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

  const validPassedArtifactFixture: TransitionSoakArtifact = {
    version: 1,
    runId: "trinidad-rtx4090-dynamicvram-v1",
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

  it("accepts complete evidence for ten strict family switches", () => {
    const parsed = TransitionSoakArtifactSchema.parse(validPassedArtifactFixture);
    expect(parsed.iterations.length).toBe(11);
    expect(parsed.iterations[0]?.family).toBe("flux");
    expect(parsed.iterations[0]?.transitionIndex).toBeNull();
    expect(parsed.iterations[1]?.family).toBe("ltx");
    expect(parsed.iterations[1]?.transitionIndex).toBe(1);
    expect(parsed.iterations[10]?.family).toBe("flux");
    expect(parsed.iterations[10]?.transitionIndex).toBe(10);
    expect(parsed.status).toBe("passed");
    expect(parsed.selectedRunnerProfile).toBe("dynamicvram-offload-v1");
  });

  it("rejects a passed artifact with missing transitions or metrics", () => {
    // Fewer iterations than requested (e.g. 5 instead of 11)
    const withFewerIterations = {
      ...validPassedArtifactFixture,
      completedTransitionCount: 4,
      iterations: validPassedArtifactFixture.iterations.slice(0, 5)
    };
    expect(TransitionSoakArtifactSchema.safeParse(withFewerIterations).success).toBe(false);

    // Missing metric on an iteration (telemetry.peakVramMb is null)
    const withNullMetric = {
      ...validPassedArtifactFixture,
      iterations: validPassedArtifactFixture.iterations.map((it, idx) =>
        idx === 2
          ? {
              ...it,
              telemetry: {
                ...it.telemetry,
                peakVramMb: null
              }
            }
          : it
      )
    };
    expect(TransitionSoakArtifactSchema.safeParse(withNullMetric).success).toBe(false);

    // Missing aggregate metric
    const withNullAggregate = {
      ...validPassedArtifactFixture,
      aggregates: {
        ...validPassedArtifactFixture.aggregates,
        peakVramMb: null
      }
    };
    expect(TransitionSoakArtifactSchema.safeParse(withNullAggregate).success).toBe(false);

    // Gate failed but status passed
    const withFailedGate = {
      ...validPassedArtifactFixture,
      gate: {
        ...validPassedArtifactFixture.gate,
        passed: false
      }
    };
    expect(TransitionSoakArtifactSchema.safeParse(withFailedGate).success).toBe(false);

    // Selected runner profile missing on pass
    const withoutRunnerProfile = {
      ...validPassedArtifactFixture,
      selectedRunnerProfile: null
    };
    expect(TransitionSoakArtifactSchema.safeParse(withoutRunnerProfile).success).toBe(false);

    // Selected runner profile mismatched with runnerProfile on pass
    const withMismatchedRunnerProfile = {
      ...validPassedArtifactFixture,
      selectedRunnerProfile: "other-profile-v1"
    };
    expect(TransitionSoakArtifactSchema.safeParse(withMismatchedRunnerProfile).success).toBe(false);

    // Non-zero failures on pass
    const withOom = {
      ...validPassedArtifactFixture,
      aggregates: {
        ...validPassedArtifactFixture.aggregates,
        oomCount: 1
      }
    };
    expect(TransitionSoakArtifactSchema.safeParse(withOom).success).toBe(false);
  });

  it("supports alternative runnerProfile names when certified", () => {
    const alternativeProfileArtifact = {
      ...validPassedArtifactFixture,
      runnerProfile: "highvram-offload-v1",
      selectedRunnerProfile: "highvram-offload-v1"
    };
    const parsed = TransitionSoakArtifactSchema.parse(alternativeProfileArtifact);
    expect(parsed.runnerProfile).toBe("highvram-offload-v1");
    expect(parsed.selectedRunnerProfile).toBe("highvram-offload-v1");

    expect(
      TransitionSoakArtifactSchema.safeParse({
        ...validPassedArtifactFixture,
        runnerProfile: "",
        selectedRunnerProfile: ""
      }).success
    ).toBe(false);
  });

  it("accepts failed partial evidence without fabricating missing values", () => {
    const iter0 = validPassedArtifactFixture.iterations[0]!;
    const iter1 = validPassedArtifactFixture.iterations[1]!;

    const failedPartialArtifact: TransitionSoakArtifact = {
      version: 1,
      runId: "trinidad-rtx4090-dynamicvram-v1",
      generatedAt: "2026-08-16T19:02:00.000Z",
      status: "failed",
      runnerProfile: "dynamicvram-offload-v1",
      requestedTransitionCount: 10,
      completedTransitionCount: 2,
      thresholds: validPassedArtifactFixture.thresholds,
      baselines: validPassedArtifactFixture.baselines,
      identities: validPassedArtifactFixture.identities,
      environment: validPassedArtifactFixture.environment,
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
            sampleIntervalMs: 200,
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

    const parsed = TransitionSoakArtifactSchema.parse(failedPartialArtifact);
    expect(parsed.status).toBe("failed");
    expect(parsed.iterations.length).toBe(3);
    expect(parsed.iterations[2]?.oomDetected).toBe(true);
    expect(parsed.selectedRunnerProfile).toBeNull();
    expect(parsed.failure).not.toBeNull();
  });
});
