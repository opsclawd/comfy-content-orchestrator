import { describe, expect, it } from "vitest";
import type {
  TransitionFamilyBaseline,
  TransitionSoakArtifact,
  TransitionSoakIteration,
  TransitionSoakThresholds
} from "@cco/contracts";
import { evaluateTransitionSoak, renderTransitionSoakSummary } from "./transition-soak-analysis.js";

describe("transition-soak-analysis", () => {
  const defaultThresholds: TransitionSoakThresholds = {
    minPostUnloadFreeVramMb: 23000,
    minHostAvailableMb: 1024,
    maxVramGrowthMb: 256,
    maxHostGrowthMb: 256,
    maxLatencyDegradationPercent: 20,
    cleanupTimeoutMs: 30000,
    cleanupPollIntervalMs: 500
  };

  const defaultBaselines: {
    flux: TransitionFamilyBaseline;
    ltx: TransitionFamilyBaseline;
  } = {
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
  };

  function createMockIteration(
    renderIndex: number,
    overrides?: {
      family?: "flux" | "ltx";
      renderDurationMs?: number;
      peakVramMb?: number;
      postUnloadFreeVramMb?: number;
      postUnloadUsedVramMb?: number;
      peakHostRamUsedMb?: number;
      peakProcessRssMb?: number;
      hostRamAvailableMb?: number;
      swapUsedMb?: number;
      swapUsedDeltaMb?: number | null;
      systemSwapInPages?: number;
      systemSwapInPageDelta?: number | null;
      systemSwapOutPages?: number;
      systemSwapOutPageDelta?: number | null;
      cleanupPassed?: boolean;
      renderStatus?: "succeeded" | "failed";
      oomDetected?: boolean;
      comfyUiRestarted?: boolean;
      samplingErrors?: Array<{ measuredAt: string; message: string }>;
      processPid?: number;
      processStartTimeTicks?: number;
    }
  ): TransitionSoakIteration {
    const isFlux = overrides?.family ? overrides.family === "flux" : renderIndex % 2 === 0;
    const family = overrides?.family ?? (isFlux ? "flux" : "ltx");
    const fromFamily = renderIndex === 0 ? null : renderIndex % 2 === 1 ? "flux" : "ltx";
    const transitionIndex = renderIndex === 0 ? null : renderIndex;

    const pid = overrides?.processPid ?? 69326;
    const startTimeTicks = overrides?.processStartTimeTicks ?? 17028742;
    const peakVram = overrides?.peakVramMb ?? (isFlux ? 23900 : 24000);
    const freeVram = overrides?.postUnloadFreeVramMb ?? 23487;
    const usedVram = overrides?.postUnloadUsedVramMb ?? 564;
    const hostUsed = overrides?.peakHostRamUsedMb ?? (isFlux ? 28500 : 29000);
    const hostRss = overrides?.peakProcessRssMb ?? (isFlux ? 26000 : 26500);
    const hostAvailable = overrides?.hostRamAvailableMb ?? 2500;
    const swapUsed = overrides?.swapUsedMb ?? 0;
    const swapDelta = overrides && "swapUsedDeltaMb" in overrides ? overrides.swapUsedDeltaMb! : 0;
    const swapIn = overrides?.systemSwapInPages ?? 0;
    const swapInDelta =
      overrides && "systemSwapInPageDelta" in overrides ? overrides.systemSwapInPageDelta! : 0;
    const swapOut = overrides?.systemSwapOutPages ?? 0;
    const swapOutDelta =
      overrides && "systemSwapOutPageDelta" in overrides ? overrides.systemSwapOutPageDelta! : 0;
    const renderDuration = overrides?.renderDurationMs ?? (isFlux ? 11000 : 46500);
    const renderStatus = overrides?.renderStatus ?? "succeeded";
    const cleanupPassed = overrides?.cleanupPassed ?? true;
    const oomDetected = overrides?.oomDetected ?? false;
    const comfyUiRestarted = overrides?.comfyUiRestarted ?? false;
    const samplingErrors = overrides?.samplingErrors ?? [];

    return {
      renderIndex,
      transitionIndex,
      fromFamily,
      family,
      render: {
        executionId: `exec-${renderIndex}`,
        status: renderStatus,
        outputObjectKeys: [isFlux ? `flux_${renderIndex}.png` : `ltx_${renderIndex}.webp`],
        startedAt: "2026-08-16T19:00:00.000Z",
        completedAt: "2026-08-16T19:00:10.000Z",
        totalDurationMs: renderDuration
      },
      telemetry: {
        sampleIntervalMs: 200,
        samples: [
          {
            measuredAt: "2026-08-16T19:00:00.000Z",
            phase: "pre_dispatch",
            gpu: {
              totalVramMb: 24564,
              usedVramMb: usedVram,
              freeVramMb: freeVram,
              reservedVramMb: 513
            },
            host: {
              hostRamTotalMb: 31233,
              hostRamAvailableMb: hostAvailable,
              hostRamUsedMb: 3700,
              swapTotalMb: 40960,
              swapUsedMb: swapUsed,
              systemSwapInPages: swapIn,
              systemSwapOutPages: swapOut,
              systemMajorPageFaults: 100,
              systemMinorPageFaults: 5000,
              processPid: pid,
              processStartTimeTicks: startTimeTicks,
              processRssMb: 1967,
              processMajorPageFaults: 10,
              processMinorPageFaults: 500
            }
          },
          {
            measuredAt: "2026-08-16T19:00:05.000Z",
            phase: "sampling",
            gpu: {
              totalVramMb: 24564,
              usedVramMb: peakVram,
              freeVramMb: 24564 - 513 - peakVram,
              reservedVramMb: 513
            },
            host: {
              hostRamTotalMb: 31233,
              hostRamAvailableMb: hostAvailable,
              hostRamUsedMb: hostUsed,
              swapTotalMb: 40960,
              swapUsedMb: swapUsed + (swapDelta ?? 0),
              systemSwapInPages: swapIn + (swapInDelta ?? 0),
              systemSwapOutPages: swapOut + (swapOutDelta ?? 0),
              systemMajorPageFaults: 100,
              systemMinorPageFaults: 6000,
              processPid: pid,
              processStartTimeTicks: startTimeTicks,
              processRssMb: hostRss,
              processMajorPageFaults: 10,
              processMinorPageFaults: 600
            }
          },
          {
            measuredAt: "2026-08-16T19:00:10.000Z",
            phase: "post_unload",
            gpu: {
              totalVramMb: 24564,
              usedVramMb: usedVram,
              freeVramMb: freeVram,
              reservedVramMb: 513
            },
            host: {
              hostRamTotalMb: 31233,
              hostRamAvailableMb: hostAvailable,
              hostRamUsedMb: 3750,
              swapTotalMb: 40960,
              swapUsedMb: swapUsed + (swapDelta ?? 0),
              systemSwapInPages: swapIn + (swapInDelta ?? 0),
              systemSwapOutPages: swapOut + (swapOutDelta ?? 0),
              systemMajorPageFaults: 100,
              systemMinorPageFaults: 6100,
              processPid: pid,
              processStartTimeTicks: startTimeTicks,
              processRssMb: 1970,
              processMajorPageFaults: 10,
              processMinorPageFaults: 610
            }
          }
        ],
        samplingErrors,
        peakVramMb: peakVram,
        reservedVramMb: 513,
        peakHostRamUsedMb: hostUsed,
        peakProcessRssMb: hostRss,
        swapUsedDeltaMb: swapDelta,
        systemSwapInPageDelta: swapInDelta,
        systemSwapOutPageDelta: swapOutDelta,
        systemMajorPageFaultDelta: 0,
        systemMinorPageFaultDelta: 1100,
        processMajorPageFaultDelta: 0,
        processMinorPageFaultDelta: 110,
        postUnloadUsedVramMb: usedVram,
        postUnloadFreeVramMb: freeVram
      },
      cleanup: {
        startedAt: "2026-08-16T19:00:10.000Z",
        completedAt: "2026-08-16T19:00:11.000Z",
        durationMs: 1000,
        attempts: 2,
        postUnloadFreeVramMb: cleanupPassed ? freeVram : null,
        passed: cleanupPassed
      },
      oomDetected,
      comfyUiRestarted,
      failure: null
    };
  }

  function createElevenPassingIterations(): TransitionSoakIteration[] {
    const iterations: TransitionSoakIteration[] = [];
    for (let i = 0; i <= 10; i++) {
      iterations.push(createMockIteration(i));
    }
    return iterations;
  }

  it("passes when all eleven records satisfy configured thresholds", () => {
    const iterations = createElevenPassingIterations();
    const result = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(result.status).toBe("passed");
    expect(result.completedTransitionCount).toBe(10);
    expect(result.hostRamDecision).toBe("support_32gb");
    expect(result.selectedRunnerProfile).toBe("dynamicvram-offload-v1");
    expect(result.failure).toBeNull();
    expect(result.gate.passed).toBe(true);

    expect(result.gate.checks.completedRequiredTransitions).toBe(true);
    expect(result.gate.checks.allRendersSuccessful).toBe(true);
    expect(result.gate.checks.allCleanupsSuccessful).toBe(true);
    expect(result.gate.checks.noOom).toBe(true);
    expect(result.gate.checks.noUnexpectedRestarts).toBe(true);
    expect(result.gate.checks.noSamplingErrors).toBe(true);
    expect(result.gate.checks.noSwapActivity).toBe(true);
    expect(result.gate.checks.postUnloadVramHeadroomMet).toBe(true);
    expect(result.gate.checks.hostMemoryHeadroomMet).toBe(true);
    expect(result.gate.checks.vramGrowthWithinTolerance).toBe(true);
    expect(result.gate.checks.hostGrowthWithinTolerance).toBe(true);
    expect(result.gate.checks.latencyWithinTolerance).toBe(true);

    expect(result.aggregates.renderFailureCount).toBe(0);
    expect(result.aggregates.cleanupFailureCount).toBe(0);
    expect(result.aggregates.samplingErrorCount).toBe(0);
    expect(result.aggregates.oomCount).toBe(0);
    expect(result.aggregates.unexpectedRestartCount).toBe(0);
    expect(result.aggregates.swapUsedDeltaMb).toBe(0);
  });

  it("passes the recorded Trinidad profile when swap decays and is not recurrent", () => {
    const trinidadSwapUsedMb = [2, 88, 982, 89, 0, null, 0, 7, 0, 0, 0] as const;
    const trinidadSwapInPages = [0, 3, 818, 2310, 173, 912, 82, 169, 91, 47, 55] as const;
    const trinidadSwapOutPages = [466, 22485, 251657, 23559, 0, 231, 0, 2637, 0, 41, 0] as const;

    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: trinidadSwapUsedMb[index]!,
        systemSwapInPageDelta: trinidadSwapInPages[index]!,
        systemSwapOutPageDelta: trinidadSwapOutPages[index]!
      })
    );

    const result = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(result.status).toBe("passed");
    expect(result.hostRamDecision).toBe("support_32gb");
    expect(result.gate.passed).toBe(true);
    expect(result.gate.checks.noSwapActivity).toBe(true);
    expect(result.failure).toBeNull();
  });

  it("fails when significant swap recurs in more than half of iterations", () => {
    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: index < 6 ? 6 : 0,
        systemSwapInPageDelta: 0,
        systemSwapOutPageDelta: 0
      })
    );

    const result = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(result.status).toBe("failed");
    expect(result.hostRamDecision).toBe("require_64gb");
    expect(result.gate.passed).toBe(false);
    expect(result.gate.checks.noSwapActivity).toBe(false);
  });

  it("fails when later-half swap does not decay", () => {
    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: index === 10 ? 20 : 0,
        systemSwapInPageDelta: 0,
        systemSwapOutPageDelta: 0
      })
    );

    const result = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(result.status).toBe("failed");
    expect(result.hostRamDecision).toBe("require_64gb");
    expect(result.gate.passed).toBe(false);
    expect(result.gate.checks.noSwapActivity).toBe(false);
  });

  it("preserves nullable and nonzero per-iteration swap evidence during evaluation", () => {
    const trinidadSwapUsedMb = [2, 88, 982, 89, 0, null, 0, 7, 0, 0, 0] as const;
    const trinidadSwapInPages = [0, 3, 818, 2310, 173, 912, 82, 169, 91, 47, 55] as const;
    const trinidadSwapOutPages = [466, 22485, 251657, 23559, 0, 231, 0, 2637, 0, 41, 0] as const;

    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: trinidadSwapUsedMb[index]!,
        systemSwapInPageDelta: trinidadSwapInPages[index]!,
        systemSwapOutPageDelta: trinidadSwapOutPages[index]!
      })
    );

    evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(iterations.map((iteration) => iteration.telemetry.swapUsedDeltaMb)).toEqual(
      trinidadSwapUsedMb
    );
    expect(iterations.map((iteration) => iteration.telemetry.systemSwapInPageDelta)).toEqual(
      trinidadSwapInPages
    );
    expect(iterations.map((iteration) => iteration.telemetry.systemSwapOutPageDelta)).toEqual(
      trinidadSwapOutPages
    );
  });

  it("detects family-normalized progressive memory growth", () => {
    const iterations = createElevenPassingIterations();
    // FLUX renders at indices 0, 2, 4, 6, 8, 10
    // LTX renders at indices 1, 3, 5, 7, 9
    // First FLUX peak VRAM: 23,900 MB.
    // Make last FLUX peak VRAM exceed threshold: 23,900 + 300 = 24,200 MB (> maxVramGrowthMb 256)
    iterations[10] = createMockIteration(10, {
      peakVramMb: 24200
    });

    const result = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(result.status).toBe("failed");
    expect(result.gate.passed).toBe(false);
    expect(result.gate.checks.vramGrowthWithinTolerance).toBe(false);
    expect(result.aggregates.sameFamilyPeakVramGrowthMb.flux).toBe(300);
    expect(result.hostRamDecision).toBe("require_64gb");

    // Also test host RAM growth on LTX family
    const iterationsHostGrowth = createElevenPassingIterations();
    // First LTX host peak (index 1): 29,000 MB.
    // Last LTX host peak (index 9): 29,000 + 400 = 29,400 MB (> maxHostGrowthMb 256)
    iterationsHostGrowth[9] = createMockIteration(9, {
      peakHostRamUsedMb: 29400
    });
    const resultHostGrowth = evaluateTransitionSoak(
      iterationsHostGrowth,
      defaultBaselines,
      defaultThresholds
    );
    expect(resultHostGrowth.gate.checks.hostGrowthWithinTolerance).toBe(false);
    expect(resultHostGrowth.aggregates.sameFamilyPeakHostRamGrowthMb.ltx).toBe(400);

    // Verify FLUX vs LTX naturally different footprints do NOT trigger leak detection across families
    // First FLUX is 23,900 MB, first LTX is 24,000 MB (100 MB difference), but within each family growth is 0
    const normalIterations = createElevenPassingIterations();
    const normalResult = evaluateTransitionSoak(
      normalIterations,
      defaultBaselines,
      defaultThresholds
    );
    expect(normalResult.aggregates.sameFamilyPeakVramGrowthMb.flux).toBe(0);
    expect(normalResult.aggregates.sameFamilyPeakVramGrowthMb.ltx).toBe(0);
    expect(normalResult.gate.checks.vramGrowthWithinTolerance).toBe(true);
  });

  it("fails material median latency degradation against either baseline", () => {
    const iterations = createElevenPassingIterations();
    // Default FLUX baseline is 11,020 ms.
    // Degradation threshold is 20% -> max allowed is 11,020 * 1.20 = 13,224 ms.
    // Increase FLUX durations to 15,000 ms (degradation ~36%)
    for (let i = 0; i <= 10; i += 2) {
      iterations[i] = createMockIteration(i, {
        renderDurationMs: 15000
      });
    }

    const result = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);

    expect(result.status).toBe("failed");
    expect(result.gate.passed).toBe(false);
    expect(result.gate.checks.latencyWithinTolerance).toBe(false);
    expect(result.aggregates.latencyDegradationPercent.flux).toBeGreaterThan(20);
    expect(result.hostRamDecision).toBe("require_64gb");
  });

  it("fails incomplete telemetry OOM restart or cleanup evidence", () => {
    // Case 1: Fewer than 10 completed transitions (e.g. only 4 completed)
    const partialIterations = createElevenPassingIterations().slice(0, 5);
    const resultPartial = evaluateTransitionSoak(
      partialIterations,
      defaultBaselines,
      defaultThresholds
    );
    expect(resultPartial.status).toBe("failed");
    expect(resultPartial.gate.checks.completedRequiredTransitions).toBe(false);
    expect(resultPartial.completedTransitionCount).toBe(4);

    // Case 2: OOM detected in one iteration
    const oomIterations = createElevenPassingIterations();
    oomIterations[2] = createMockIteration(2, { oomDetected: true });
    const resultOom = evaluateTransitionSoak(oomIterations, defaultBaselines, defaultThresholds);
    expect(resultOom.status).toBe("failed");
    expect(resultOom.gate.checks.noOom).toBe(false);
    expect(resultOom.aggregates.oomCount).toBe(1);

    // Case 3: ComfyUI restarted (PID changed)
    const restartIterations = createElevenPassingIterations();
    restartIterations[5] = createMockIteration(5, {
      processPid: 99999,
      comfyUiRestarted: true
    });
    const resultRestart = evaluateTransitionSoak(
      restartIterations,
      defaultBaselines,
      defaultThresholds
    );
    expect(resultRestart.status).toBe("failed");
    expect(resultRestart.gate.checks.noUnexpectedRestarts).toBe(false);
    expect(resultRestart.aggregates.unexpectedRestartCount).toBe(1);

    // Case 4: Cleanup failed / post-unload headroom not observed
    const cleanupFailIterations = createElevenPassingIterations();
    cleanupFailIterations[3] = createMockIteration(3, {
      cleanupPassed: false,
      postUnloadFreeVramMb: 15000 // below threshold 23000
    });
    const resultCleanup = evaluateTransitionSoak(
      cleanupFailIterations,
      defaultBaselines,
      defaultThresholds
    );
    expect(resultCleanup.status).toBe("failed");
    expect(resultCleanup.gate.checks.allCleanupsSuccessful).toBe(false);
    expect(resultCleanup.gate.checks.postUnloadVramHeadroomMet).toBe(false);

    // Case 5: Sampling errors present
    const samplingErrorIterations = createElevenPassingIterations();
    samplingErrorIterations[1] = createMockIteration(1, {
      samplingErrors: [{ measuredAt: "2026-08-16T19:00:05.000Z", message: "nvidia-smi timeout" }]
    });
    const resultSamplingError = evaluateTransitionSoak(
      samplingErrorIterations,
      defaultBaselines,
      defaultThresholds
    );
    expect(resultSamplingError.status).toBe("failed");
    expect(resultSamplingError.gate.checks.noSamplingErrors).toBe(false);
    expect(resultSamplingError.aggregates.samplingErrorCount).toBe(1);

    // Case 6: Insufficient host memory headroom
    const hostLowIterations = createElevenPassingIterations();
    hostLowIterations[6] = createMockIteration(6, {
      hostRamAvailableMb: 512 // below threshold 1024
    });
    const resultHostLow = evaluateTransitionSoak(
      hostLowIterations,
      defaultBaselines,
      defaultThresholds
    );
    expect(resultHostLow.status).toBe("failed");
    expect(resultHostLow.gate.checks.hostMemoryHeadroomMet).toBe(false);
  });

  function createArtifact(iterations: TransitionSoakIteration[]): TransitionSoakArtifact {
    const evaluation = evaluateTransitionSoak(iterations, defaultBaselines, defaultThresholds);
    return {
      version: 1,
      runId: "trinidad-rtx4090-dynamicvram-v1",
      generatedAt: "2026-08-16T19:05:00.000Z",
      runnerProfile: "dynamicvram-offload-v1",
      requestedTransitionCount: 10,
      thresholds: defaultThresholds,
      baselines: defaultBaselines,
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
      iterations,
      ...evaluation
    };
  }

  it("renders None (PASS) when no swap is observed", () => {
    const iterations = createElevenPassingIterations();
    const artifact = createArtifact(iterations);

    const summary = renderTransitionSoakSummary(artifact);

    expect(summary).toContain("None (PASS)");
  });

  it("renders Transient (PASS) for the recorded Trinidad swap profile", () => {
    const trinidadSwapUsedMb = [2, 88, 982, 89, 0, null, 0, 7, 0, 0, 0] as const;
    const trinidadSwapInPages = [0, 3, 818, 2310, 173, 912, 82, 169, 91, 47, 55] as const;
    const trinidadSwapOutPages = [466, 22485, 251657, 23559, 0, 231, 0, 2637, 0, 41, 0] as const;

    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: trinidadSwapUsedMb[index]!,
        systemSwapInPageDelta: trinidadSwapInPages[index]!,
        systemSwapOutPageDelta: trinidadSwapOutPages[index]!
      })
    );

    const artifact = createArtifact(iterations);
    const summary = renderTransitionSoakSummary(artifact);

    expect(summary).toContain("Transient (PASS)");
    expect(summary).toContain("982 MB");
    expect(summary).toContain("N/A");
    expect(summary).toContain("in:818/out:251657");
    expect(summary).toContain("in:912/out:231");
  });

  it("renders Sustained (FAIL) when swap recurs or does not decay", () => {
    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: index < 6 ? 6 : 0,
        systemSwapInPageDelta: 0,
        systemSwapOutPageDelta: 0
      })
    );

    const artifact = createArtifact(iterations);
    const summary = renderTransitionSoakSummary(artifact);

    expect(summary).toContain("Sustained (FAIL)");
  });

  it("preserves every outlier in raw iteration evidence and Markdown", () => {
    const iterations = createElevenPassingIterations();
    // Inject a spike outlier in iteration 6 (render 6 has peak VRAM spike of 24,100 MB and duration 12,500 ms)
    iterations[6] = createMockIteration(6, {
      peakVramMb: 24100,
      renderDurationMs: 12500,
      peakHostRamUsedMb: 29150
    });

    const artifact = createArtifact(iterations);
    expect(artifact.status).toBe("passed");

    const summary = renderTransitionSoakSummary(artifact);

    // Markdown must contain the overall status and decision
    expect(summary).toContain("PASSED");
    expect(summary).toContain("support_32gb");
    expect(summary).toContain("trinidad-rtx4090-dynamicvram-v1");

    // Markdown must contain the 11-row sequence table with every iteration visible
    for (let i = 0; i <= 10; i++) {
      expect(summary).toContain(`| ${i} `);
    }

    // Markdown must preserve the specific outlier values of iteration 6
    expect(summary).toContain("24,100");
    expect(summary).toContain("12,500");
    expect(summary).toContain("29,150");

    // Markdown must show all gate checks
    expect(summary).toContain("Completed Required Transitions");
    expect(summary).toContain("Swap Activity");
    expect(summary).toContain("VRAM Growth Within Tolerance");
    expect(summary).toContain("Host Growth Within Tolerance");
    expect(summary).toContain("Latency Within Tolerance");
  });

  it("renders 'no sustained swap activity' in decision rationale when gate passes", () => {
    const iterations = createElevenPassingIterations();
    const artifact = createArtifact(iterations);
    const summary = renderTransitionSoakSummary(artifact);

    expect(summary).toContain("succeeded with no sustained swap activity");
    expect(summary).not.toContain("zero swap activity");
  });

  it("renders Transient (FAIL - Legacy Strict Policy) when historical artifact has noSwapActivity = false despite transient swap", () => {
    const trinidadSwapUsedMb = [2, 88, 982, 89, 0, null, 0, 7, 0, 0, 0] as const;
    const trinidadSwapInPages = [0, 3, 818, 2310, 173, 912, 82, 169, 91, 47, 55] as const;
    const trinidadSwapOutPages = [466, 22485, 251657, 23559, 0, 231, 0, 2637, 0, 41, 0] as const;

    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: trinidadSwapUsedMb[index]!,
        systemSwapInPageDelta: trinidadSwapInPages[index]!,
        systemSwapOutPageDelta: trinidadSwapOutPages[index]!
      })
    );

    const artifact = createArtifact(iterations);
    // Simulate historical artifact state where noSwapActivity was false
    const historicalArtifact: TransitionSoakArtifact = {
      ...artifact,
      status: "failed",
      hostRamDecision: "require_64gb",
      selectedRunnerProfile: null,
      gate: {
        ...artifact.gate,
        passed: false,
        checks: {
          ...artifact.gate.checks,
          noSwapActivity: false
        }
      },
      failure: {
        phase: "transition_soak_gate",
        code: "TRANSITION_SOAK_FAILED",
        message: "Transition soak failed gate checks: noSwapActivity",
        details: {
          failedChecks: ["noSwapActivity"]
        }
      }
    };

    const summary = renderTransitionSoakSummary(historicalArtifact);

    expect(summary).toContain("Transient (FAIL - Legacy Strict Policy)");
    expect(summary).not.toContain("Transient (PASS)");
  });

  it("renders None (FAIL - Legacy Strict Policy) when historical artifact has noSwapActivity = false despite no swap", () => {
    const iterations = createElevenPassingIterations();
    const artifact = createArtifact(iterations);
    const historicalArtifact: TransitionSoakArtifact = {
      ...artifact,
      status: "failed",
      gate: {
        ...artifact.gate,
        passed: false,
        checks: {
          ...artifact.gate.checks,
          noSwapActivity: false
        }
      }
    };

    const summary = renderTransitionSoakSummary(historicalArtifact);

    expect(summary).toContain("None (FAIL - Legacy Strict Policy)");
    expect(summary).not.toContain("None (PASS)");
  });

  it("does not treat missing noSwapActivity in gate checks as legacy failure", () => {
    const iterations = createElevenPassingIterations();
    const artifact = createArtifact(iterations);
    const checksWithoutNoSwap = { ...artifact.gate.checks };
    delete (checksWithoutNoSwap as { noSwapActivity?: boolean }).noSwapActivity;

    const artifactWithoutCheck: TransitionSoakArtifact = {
      ...artifact,
      gate: {
        ...artifact.gate,
        checks: checksWithoutNoSwap
      }
    };

    const summary = renderTransitionSoakSummary(artifactWithoutCheck);
    expect(summary).toContain("None (PASS)");
    expect(summary).not.toContain("Legacy Strict Policy");
  });

  it("renders Sustained (FAIL) when swap is sustained even if gate checks object does not have noSwapActivity = false", () => {
    const iterations = createElevenPassingIterations().map((_, index) =>
      createMockIteration(index, {
        swapUsedDeltaMb: index < 6 ? 6 : 0,
        systemSwapInPageDelta: 0,
        systemSwapOutPageDelta: 0
      })
    );

    const artifact = createArtifact(iterations);
    // Artifact with gate.passed or gate.checks where noSwapActivity is undefined or true
    const checksWithTrueSwap = { ...artifact.gate.checks, noSwapActivity: true };
    const artifactWithTrueCheck: TransitionSoakArtifact = {
      ...artifact,
      gate: {
        ...artifact.gate,
        checks: checksWithTrueSwap
      }
    };

    const summary = renderTransitionSoakSummary(artifactWithTrueCheck);
    expect(summary).toContain("Sustained (FAIL)");
    expect(summary).not.toContain("Sustained (PASS)");
  });
});
