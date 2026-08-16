import type {
  CertificationEnvironment,
  CertificationTelemetryData,
  CertificationTelemetrySample,
  TransitionFamily,
  TransitionFamilyBaseline,
  TransitionSoakThresholds,
  TransitionWorkloadIdentity
} from "@cco/contracts";
import { TransitionSoakArtifactSchema } from "@cco/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  QueueRenderInput,
  RenderEnginePort,
  RenderQueueReceipt,
  RenderResult
} from "../ports/render-engine-port.js";
import type { TelemetrySamplerControl } from "./run-certification.js";
import { type TransitionSoakPhase, runTransitionSoak } from "./run-transition-soak.js";

function createValidIdentities(): {
  flux: TransitionWorkloadIdentity;
  ltx: TransitionWorkloadIdentity;
} {
  return {
    flux: {
      profileId: "flux-schnell-draft",
      engine: "flux_schnell",
      renderProfileKey: "FLUX_SCHNELL_V1",
      renderProfileVersion: 1,
      width: 1024,
      height: 1024,
      frames: 1,
      steps: 4,
      workflowSha256: "a".repeat(64),
      modelSha256: {
        unet: "b".repeat(64),
        clip: "c".repeat(64),
        vae: "d".repeat(64)
      },
      comfyUiCommit: "e".repeat(40),
      customNodes: [],
      measuredDiskFootprintGb: 24.5,
      minFreeDiskGb: 10.0
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
      workflowSha256: "f".repeat(64),
      modelSha256: {
        checkpoint: "1".repeat(64),
        textEncoder: "2".repeat(64),
        vae: "3".repeat(64)
      },
      comfyUiCommit: "e".repeat(40),
      customNodes: [],
      measuredDiskFootprintGb: 28.2,
      minFreeDiskGb: 10.0
    }
  };
}

function createValidBaselines(): {
  flux: TransitionFamilyBaseline;
  ltx: TransitionFamilyBaseline;
} {
  return {
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
}

function createValidThresholds(): TransitionSoakThresholds {
  return {
    minPostUnloadFreeVramMb: 23000,
    minHostAvailableMb: 1024,
    maxVramGrowthMb: 256,
    maxHostGrowthMb: 256,
    maxLatencyDegradationPercent: 20,
    cleanupTimeoutMs: 30000,
    cleanupPollIntervalMs: 500
  };
}

function createValidEnvironment(): CertificationEnvironment {
  return {
    nodeVersion: "v24.0.0",
    platform: "linux",
    arch: "x64",
    osRelease: "6.8.0-generic",
    osVersion: "#1 SMP PREEMPT_DYNAMIC",
    cpuModel: "AMD Ryzen 9 7950X",
    cpuCount: 32,
    gpuName: "NVIDIA GeForce RTX 4090",
    gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
    gpuDriverVersion: "550.54.14",
    gpuTotalMemoryMb: 24564,
    cudaVersion: "12.4",
    comfyUiPid: 69326,
    comfyUiArgs: ["--port", "8188"]
  };
}

function createMockTelemetrySample(
  phase: "pre_dispatch" | "sampling" | "post_unload" = "sampling",
  overrides?: {
    freeVramMb?: number;
    usedVramMb?: number;
    hostRamAvailableMb?: number;
    processPid?: number;
    processStartTimeTicks?: number;
    swapUsedMb?: number;
    systemSwapInPages?: number;
    systemSwapOutPages?: number;
  }
): CertificationTelemetrySample {
  return {
    measuredAt: new Date().toISOString(),
    phase,
    gpu: {
      totalVramMb: 24564,
      usedVramMb: overrides?.usedVramMb ?? (phase === "post_unload" ? 1024 : 18000),
      freeVramMb: overrides?.freeVramMb ?? (phase === "post_unload" ? 23540 : 6564),
      reservedVramMb: 512
    },
    host: {
      hostRamTotalMb: 64000,
      hostRamAvailableMb: overrides?.hostRamAvailableMb ?? 50000,
      hostRamUsedMb: 14000,
      swapTotalMb: 16000,
      swapUsedMb: overrides?.swapUsedMb ?? 0,
      systemSwapInPages: overrides?.systemSwapInPages ?? 0,
      systemSwapOutPages: overrides?.systemSwapOutPages ?? 0,
      systemMajorPageFaults: 100,
      systemMinorPageFaults: 5000,
      processPid: overrides?.processPid ?? 69326,
      processStartTimeTicks: overrides?.processStartTimeTicks ?? 17028742,
      processRssMb: 1200,
      processMajorPageFaults: 10,
      processMinorPageFaults: 500
    }
  };
}

function createMockTelemetryData(
  samples: CertificationTelemetrySample[] = [
    createMockTelemetrySample("pre_dispatch"),
    createMockTelemetrySample("sampling"),
    createMockTelemetrySample("post_unload")
  ]
): CertificationTelemetryData {
  return {
    sampleIntervalMs: 200,
    samples,
    samplingErrors: [],
    peakVramMb: 23900,
    reservedVramMb: 512,
    peakHostRamUsedMb: 28500,
    peakProcessRssMb: 26000,
    swapUsedDeltaMb: 0,
    systemSwapInPageDelta: 0,
    systemSwapOutPageDelta: 0,
    systemMajorPageFaultDelta: 0,
    systemMinorPageFaultDelta: 10,
    processMajorPageFaultDelta: 0,
    processMinorPageFaultDelta: 5,
    postUnloadUsedVramMb: 1024,
    postUnloadFreeVramMb: 23540
  };
}

interface MockSamplerOptions {
  sampleNowResponses?: CertificationTelemetrySample[];
  telemetryData?: CertificationTelemetryData;
  onSampleNow?: (phase?: "pre_dispatch" | "sampling" | "post_unload") => void;
  onStart?: () => void;
  onStop?: () => void;
}

function createMockSamplerInstance(options?: MockSamplerOptions): TelemetrySamplerControl & {
  startCount: number;
  stopCount: number;
  sampleNowCount: number;
} {
  let sampleIndex = 0;
  const instance = {
    startCount: 0,
    stopCount: 0,
    sampleNowCount: 0,
    start: vi.fn(async () => {
      instance.startCount++;
      options?.onStart?.();
    }),
    sampleNow: vi.fn(async (phase: "pre_dispatch" | "sampling" | "post_unload" = "sampling") => {
      instance.sampleNowCount++;
      options?.onSampleNow?.(phase);
      if (options?.sampleNowResponses && sampleIndex < options.sampleNowResponses.length) {
        const resp = options.sampleNowResponses[sampleIndex]!;
        sampleIndex++;
        return resp;
      }
      return createMockTelemetrySample(phase);
    }),
    stop: vi.fn(async () => {
      instance.stopCount++;
      options?.onStop?.();
      return options?.telemetryData ?? createMockTelemetryData();
    }),
    getTelemetryData: vi.fn(() => options?.telemetryData ?? createMockTelemetryData())
  };
  return instance;
}

describe("runTransitionSoak", () => {
  it("executes one initial FLUX render plus ten strict family switches", async () => {
    const executedRenders: Array<{ renderIndex: number; family: TransitionFamily }> = [];
    const createdSamplers: Array<ReturnType<typeof createMockSamplerInstance>> = [];

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput): Promise<RenderQueueReceipt> => {
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: new Date().toISOString()
        };
      }),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => {
        return {
          executionId,
          status: "succeeded",
          outputObjectKeys: [`out-${executionId}.png`],
          completedAt: new Date().toISOString()
        };
      }),
      unloadModels: vi.fn(async () => {})
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 1000;
      return new Date(currentTime);
    };

    const phaseChanges: TransitionSoakPhase[] = [];

    const artifact = await runTransitionSoak({
      runId: "soak-full-10-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(),
      workflows: {
        flux: { prompt: "flux prompt" },
        ltx: { prompt: "ltx prompt" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: (renderIndex, family) => {
        executedRenders.push({ renderIndex, family });
        const sampler = createMockSamplerInstance({
          telemetryData: createMockTelemetryData([
            createMockTelemetrySample("pre_dispatch"),
            createMockTelemetrySample("sampling"),
            createMockTelemetrySample("post_unload", { freeVramMb: 23500 })
          ])
        });
        createdSamplers.push(sampler);
        return sampler;
      },
      now,
      sleep: async () => {},
      onPhaseChange: (p) => phaseChanges.push(p)
    });

    expect(artifact.status).toBe("passed");
    expect(artifact.completedTransitionCount).toBe(10);
    expect(artifact.requestedTransitionCount).toBe(10);
    expect(artifact.iterations).toHaveLength(11);

    // Verify alternation: 0=FLUX, 1=LTX, 2=FLUX, 3=LTX, ..., 10=FLUX
    const expectedFamilies: TransitionFamily[] = [
      "flux",
      "ltx",
      "flux",
      "ltx",
      "flux",
      "ltx",
      "flux",
      "ltx",
      "flux",
      "ltx",
      "flux"
    ];

    expect(executedRenders.map((r) => r.family)).toEqual(expectedFamilies);
    expect(artifact.iterations.map((i) => i.family)).toEqual(expectedFamilies);

    // Verify initial render has transitionIndex: null, fromFamily: null
    expect(artifact.iterations[0]!.transitionIndex).toBeNull();
    expect(artifact.iterations[0]!.fromFamily).toBeNull();
    expect(artifact.iterations[0]!.family).toBe("flux");

    // Verify transitions 1..10
    for (let i = 1; i <= 10; i++) {
      expect(artifact.iterations[i]!.transitionIndex).toBe(i);
      expect(artifact.iterations[i]!.fromFamily).toBe(expectedFamilies[i - 1]);
      expect(artifact.iterations[i]!.family).toBe(expectedFamilies[i]);
    }

    // Verify schema passes
    const validated = TransitionSoakArtifactSchema.parse(artifact);
    expect(validated.status).toBe("passed");
  });

  it("does not dispatch the next family until unload headroom is observed", async () => {
    const queueCalls: string[] = [];
    let pollCount = 0;

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput): Promise<RenderQueueReceipt> => {
        queueCalls.push(`queue:${input.renderJobId}`);
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: new Date().toISOString()
        };
      }),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => {
        return {
          executionId,
          status: "succeeded",
          outputObjectKeys: ["out.png"],
          completedAt: new Date().toISOString()
        };
      }),
      unloadModels: vi.fn(async () => {
        queueCalls.push("unloadModels");
      })
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 500;
      return new Date(currentTime);
    };

    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
      queueCalls.push(`sleep:${ms}`);
    };

    const artifact = await runTransitionSoak({
      runId: "headroom-check-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(), // minPostUnloadFreeVramMb = 23000
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: (renderIndex) => {
        if (renderIndex === 0) {
          // In render 0, first 2 polls return 20000MB, 3rd poll returns 23500MB
          return createMockSamplerInstance({
            sampleNowResponses: [
              createMockTelemetrySample("post_unload", { freeVramMb: 20000 }),
              createMockTelemetrySample("post_unload", { freeVramMb: 21000 }),
              createMockTelemetrySample("post_unload", { freeVramMb: 23500 })
            ],
            telemetryData: createMockTelemetryData([
              createMockTelemetrySample("pre_dispatch"),
              createMockTelemetrySample("sampling"),
              createMockTelemetrySample("post_unload", { freeVramMb: 23500 })
            ]),
            onSampleNow: () => {
              pollCount++;
              queueCalls.push(`poll:${pollCount}`);
            }
          });
        }
        return createMockSamplerInstance({
          sampleNowResponses: [createMockTelemetrySample("post_unload", { freeVramMb: 23500 })],
          telemetryData: createMockTelemetryData([
            createMockTelemetrySample("pre_dispatch"),
            createMockTelemetrySample("sampling"),
            createMockTelemetrySample("post_unload", { freeVramMb: 23500 })
          ])
        });
      },
      now,
      sleep
    });

    // Check order of events for iteration 0 before iteration 1 queueRender
    const iter0Queue = queueCalls.indexOf("queue:headroom-check-run-0-flux");
    const iter0Unload = queueCalls.indexOf("unloadModels");
    const iter0Poll1 = queueCalls.indexOf("poll:1");
    const iter0Sleep1 = queueCalls.indexOf("sleep:500");
    const iter0Poll2 = queueCalls.indexOf("poll:2");
    const iter0Sleep2 = queueCalls.lastIndexOf("sleep:500");
    const iter0Poll3 = queueCalls.indexOf("poll:3");
    const iter1Queue = queueCalls.indexOf("queue:headroom-check-run-1-ltx");

    expect(iter0Queue).toBeLessThan(iter0Unload);
    expect(iter0Unload).toBeLessThan(iter0Poll1);
    expect(iter0Poll1).toBeLessThan(iter0Sleep1);
    expect(iter0Sleep1).toBeLessThan(iter0Poll2);
    expect(iter0Poll2).toBeLessThan(iter0Sleep2);
    expect(iter0Sleep2).toBeLessThan(iter0Poll3);
    expect(iter0Poll3).toBeLessThan(iter1Queue);

    expect(artifact.iterations[0]!.cleanup.attempts).toBe(3);
    expect(artifact.iterations[0]!.cleanup.passed).toBe(true);
  });

  it("polls cleanup without overlapping samples", async () => {
    let concurrentSampleOperations = 0;
    let maxConcurrentOperations = 0;

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput) => ({
        executionId: `exec-${input.renderJobId}`,
        acceptedAt: new Date().toISOString()
      })),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => ({
        executionId,
        status: "succeeded",
        outputObjectKeys: ["out.png"],
        completedAt: new Date().toISOString()
      })),
      unloadModels: vi.fn(async () => {})
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 200;
      return new Date(currentTime);
    };

    const sleep = async (ms: number) => {
      concurrentSampleOperations++;
      maxConcurrentOperations = Math.max(maxConcurrentOperations, concurrentSampleOperations);
      currentTime += ms;
      concurrentSampleOperations--;
    };

    await runTransitionSoak({
      runId: "no-overlap-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(),
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: () => {
        let sampleIndex = 0;
        return {
          start: vi.fn(async () => {}),
          sampleNow: vi.fn(async (phase = "sampling") => {
            concurrentSampleOperations++;
            maxConcurrentOperations = Math.max(maxConcurrentOperations, concurrentSampleOperations);
            sampleIndex++;
            const freeVramMb = sampleIndex >= 3 ? 23500 : 20000;
            concurrentSampleOperations--;
            return createMockTelemetrySample(phase, { freeVramMb });
          }),
          stop: vi.fn(async () => createMockTelemetryData()),
          getTelemetryData: vi.fn(() => createMockTelemetryData())
        };
      },
      now,
      sleep
    });

    expect(maxConcurrentOperations).toBe(1);
  });

  it("stops before the next dispatch when cleanup headroom times out", async () => {
    let queueRenderCallCount = 0;
    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput) => {
        queueRenderCallCount++;
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: new Date().toISOString()
        };
      }),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => ({
        executionId,
        status: "succeeded",
        outputObjectKeys: ["out.png"],
        completedAt: new Date().toISOString()
      })),
      unloadModels: vi.fn(async () => {})
    };

    let currentTime = 1700000000000;
    const now = () => new Date(currentTime);
    const sleep = async (ms: number) => {
      currentTime += ms;
    };

    const thresholds: TransitionSoakThresholds = {
      ...createValidThresholds(),
      cleanupTimeoutMs: 3000,
      cleanupPollIntervalMs: 1000
    };

    const artifact = await runTransitionSoak({
      runId: "cleanup-timeout-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds,
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: () => {
        return createMockSamplerInstance({
          // Always return insufficient free VRAM (20000 < 23000)
          sampleNowResponses: [
            createMockTelemetrySample("post_unload", { freeVramMb: 20000 }),
            createMockTelemetrySample("post_unload", { freeVramMb: 20000 }),
            createMockTelemetrySample("post_unload", { freeVramMb: 20000 }),
            createMockTelemetrySample("post_unload", { freeVramMb: 20000 })
          ],
          telemetryData: createMockTelemetryData([
            createMockTelemetrySample("pre_dispatch"),
            createMockTelemetrySample("sampling"),
            createMockTelemetrySample("post_unload", { freeVramMb: 20000 })
          ])
        });
      },
      now,
      sleep
    });

    expect(artifact.status).toBe("failed");
    expect(artifact.completedTransitionCount).toBe(0);
    expect(artifact.iterations).toHaveLength(1);
    expect(artifact.iterations[0]!.cleanup.passed).toBe(false);
    expect(artifact.iterations[0]!.failure).not.toBeNull();
    expect(queueRenderCallCount).toBe(1); // Never queued render 1

    const validated = TransitionSoakArtifactSchema.parse(artifact);
    expect(validated.status).toBe("failed");
  });

  it("attempts cleanup and publishes partial evidence after a render failure", async () => {
    let unloadCalled = false;
    let postUnloadSampleCalled = false;
    let samplerStopped = false;

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput) => ({
        executionId: `exec-${input.renderJobId}`,
        acceptedAt: new Date().toISOString()
      })),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => {
        return {
          executionId,
          status: "failed",
          errorCode: "model_load_corrupted",
          outputObjectKeys: [],
          completedAt: new Date().toISOString()
        };
      }),
      unloadModels: vi.fn(async () => {
        unloadCalled = true;
      })
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 500;
      return new Date(currentTime);
    };

    const artifact = await runTransitionSoak({
      runId: "render-failure-cleanup-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(),
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: () => {
        return createMockSamplerInstance({
          onSampleNow: (phase) => {
            if (phase === "post_unload") {
              postUnloadSampleCalled = true;
            }
          },
          onStop: () => {
            samplerStopped = true;
          }
        });
      },
      now,
      sleep: async () => {}
    });

    expect(unloadCalled).toBe(true);
    expect(postUnloadSampleCalled).toBe(true);
    expect(samplerStopped).toBe(true);

    expect(artifact.status).toBe("failed");
    expect(artifact.iterations).toHaveLength(1);
    expect(artifact.iterations[0]!.render.status).toBe("failed");
    expect(artifact.iterations[0]!.failure?.code).toBe("model_load_corrupted");

    const validated = TransitionSoakArtifactSchema.parse(artifact);
    expect(validated.status).toBe("failed");
  });

  it("classifies OOM and never resumes the sequence", async () => {
    let renderCount = 0;

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput) => {
        renderCount++;
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: new Date().toISOString()
        };
      }),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => {
        if (renderCount === 2) {
          // 2nd render (renderIndex 1) throws CUDA OOM
          return {
            executionId,
            status: "failed",
            errorCode: "CUDA out of memory",
            outputObjectKeys: [],
            completedAt: new Date().toISOString()
          };
        }
        return {
          executionId,
          status: "succeeded",
          outputObjectKeys: ["out.png"],
          completedAt: new Date().toISOString()
        };
      }),
      unloadModels: vi.fn(async () => {})
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 500;
      return new Date(currentTime);
    };

    const artifact = await runTransitionSoak({
      runId: "oom-classification-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(),
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: () => createMockSamplerInstance(),
      now,
      sleep: async () => {}
    });

    expect(artifact.status).toBe("failed");
    expect(renderCount).toBe(2);
    expect(artifact.iterations).toHaveLength(2);

    expect(artifact.iterations[0]!.render.status).toBe("succeeded");
    expect(artifact.iterations[0]!.oomDetected).toBe(false);

    expect(artifact.iterations[1]!.render.status).toBe("failed");
    expect(artifact.iterations[1]!.oomDetected).toBe(true);
    expect(artifact.aggregates.oomCount).toBe(1);
    expect(artifact.gate.checks.noOom).toBe(false);

    const validated = TransitionSoakArtifactSchema.parse(artifact);
    expect(validated.status).toBe("failed");
  });

  it("fails when ComfyUI process identity changes", async () => {
    let renderCount = 0;

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput) => {
        renderCount++;
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: new Date().toISOString()
        };
      }),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => {
        return {
          executionId,
          status: "succeeded",
          outputObjectKeys: ["out.png"],
          completedAt: new Date().toISOString()
        };
      }),
      unloadModels: vi.fn(async () => {})
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 500;
      return new Date(currentTime);
    };

    const artifact = await runTransitionSoak({
      runId: "pid-restart-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(),
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: (renderIndex) => {
        if (renderIndex === 1) {
          // PID changed from 69326 to 99999 (unexpected restart)
          return createMockSamplerInstance({
            telemetryData: createMockTelemetryData([
              createMockTelemetrySample("pre_dispatch", { processPid: 99999 }),
              createMockTelemetrySample("sampling", { processPid: 99999 }),
              createMockTelemetrySample("post_unload", { processPid: 99999 })
            ])
          });
        }
        return createMockSamplerInstance({
          telemetryData: createMockTelemetryData([
            createMockTelemetrySample("pre_dispatch", { processPid: 69326 }),
            createMockTelemetrySample("sampling", { processPid: 69326 }),
            createMockTelemetrySample("post_unload", { processPid: 69326 })
          ])
        });
      },
      now,
      sleep: async () => {}
    });

    expect(artifact.status).toBe("failed");
    expect(renderCount).toBe(2);
    expect(artifact.iterations).toHaveLength(2);

    expect(artifact.iterations[0]!.comfyUiRestarted).toBe(false);
    expect(artifact.iterations[1]!.comfyUiRestarted).toBe(true);
    expect(artifact.aggregates.unexpectedRestartCount).toBe(1);
    expect(artifact.gate.checks.noUnexpectedRestarts).toBe(false);

    const validated = TransitionSoakArtifactSchema.parse(artifact);
    expect(validated.status).toBe("failed");
  });

  it("stops every iteration sampler exactly once", async () => {
    const samplers: Array<ReturnType<typeof createMockSamplerInstance>> = [];

    const mockRenderEngine: RenderEnginePort = {
      queueRender: vi.fn(async (input: QueueRenderInput) => ({
        executionId: `exec-${input.renderJobId}`,
        acceptedAt: new Date().toISOString()
      })),
      getRenderResult: vi.fn(async (executionId: string): Promise<RenderResult> => {
        // Fail on 3rd render to verify sampler stop on failure as well
        if (samplers.length === 3) {
          return {
            executionId,
            status: "failed",
            errorCode: "timeout",
            outputObjectKeys: [],
            completedAt: new Date().toISOString()
          };
        }
        return {
          executionId,
          status: "succeeded",
          outputObjectKeys: ["out.png"],
          completedAt: new Date().toISOString()
        };
      }),
      unloadModels: vi.fn(async () => {})
    };

    let currentTime = 1700000000000;
    const now = () => {
      currentTime += 500;
      return new Date(currentTime);
    };

    await runTransitionSoak({
      runId: "sampler-stop-count-run",
      requestedTransitionCount: 10,
      environment: createValidEnvironment(),
      identities: createValidIdentities(),
      baselines: createValidBaselines(),
      thresholds: createValidThresholds(),
      workflows: {
        flux: { prompt: "flux" },
        ltx: { prompt: "ltx" }
      },
      renderEngine: mockRenderEngine,
      createTelemetrySampler: () => {
        const sampler = createMockSamplerInstance();
        samplers.push(sampler);
        return sampler;
      },
      now,
      sleep: async () => {}
    });

    expect(samplers).toHaveLength(3);
    for (let i = 0; i < samplers.length; i++) {
      expect(samplers[i]!.startCount).toBe(1);
      expect(samplers[i]!.stopCount).toBe(1);
    }
  });
});
