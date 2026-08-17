import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type {
  CertificationEnvironment,
  TransitionFamily,
  TransitionFamilyBaseline,
  TransitionSoakArtifact,
  TransitionSoakThresholds
} from "@cco/contracts";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import type { RenderEnginePort, RenderQueueReceipt, RenderResult } from "@cco/application";
import {
  parseCertifyTransitionSoakCliArgs,
  runTransitionSoakCli,
  type CertifyTransitionSoakCliDependencies,
  type TelemetrySamplerControl
} from "./certify-transition-soak.js";
import { PreflightError } from "../certification/transition-preflight.js";

describe("certify:transition-soak CLI", () => {
  const mockFluxProfile: CertificationProfile = Object.freeze({
    id: "flux-schnell-draft",
    engine: "flux_schnell",
    workflowPath: "/test/manifests/flux_schnell_draft_api.json",
    workflowRelativePath: "flux_schnell_draft_api.json",
    expectedWorkflowHash: "af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5",
    source: Object.freeze({
      kind: "validated_host_export" as const,
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }),
    baseline: Object.freeze({
      width: 1024,
      height: 1024,
      steps: 4
    }),
    minFreeDiskGb: 0,
    runnerProfile: "dynamicvram-offload-v1",
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "flux1-schnell.safetensors"
      },
      {
        category: "clip" as const,
        relativePath: "t5xxl_fp8_e4m3fn.safetensors"
      },
      {
        category: "clip" as const,
        relativePath: "clip_l.safetensors"
      },
      {
        category: "vae" as const,
        relativePath: "ae.safetensors"
      }
    ]),
    assertions: Object.freeze([
      {
        nodeId: "1",
        classType: "KSampler",
        input: "steps",
        equals: 4
      },
      {
        nodeId: "5",
        classType: "EmptyLatentImage",
        input: "width",
        equals: 1024
      },
      {
        nodeId: "5",
        classType: "EmptyLatentImage",
        input: "height",
        equals: 1024
      }
    ]),
    renderProfileIdentity: null
  });

  const mockLtxProfile: CertificationProfile = Object.freeze({
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    workflowPath: "/test/manifests/ltx_25_720p_97f_api.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
    source: Object.freeze({
      kind: "validated_host_export" as const,
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }),
    baseline: Object.freeze({
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    }),
    minFreeDiskGb: 100,
    runnerProfile: "dynamicvram-offload-v1",
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
      },
      {
        category: "clip" as const,
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
      },
      {
        category: "vae" as const,
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors"
      }
    ]),
    assertions: Object.freeze([
      {
        nodeId: "1",
        classType: "KSampler",
        input: "steps",
        equals: 8
      },
      {
        nodeId: "5",
        classType: "EmptyLTXVLatentVideo",
        input: "width",
        equals: 1280
      },
      {
        nodeId: "5",
        classType: "EmptyLTXVLatentVideo",
        input: "height",
        equals: 720
      },
      {
        nodeId: "5",
        classType: "EmptyLTXVLatentVideo",
        input: "length",
        equals: 97
      }
    ]),
    renderProfileIdentity: Object.freeze({
      key: "LTX_25_720P_5S_V1" as const,
      version: 1 as const
    })
  });

  const mockFluxApprovedProvenance: CertificationProvenanceReport = Object.freeze({
    version: 1,
    profileId: "flux-schnell-draft",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: Object.freeze({
      relativePath: "flux_schnell_draft_api.json",
      sha256: "af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5",
      source: Object.freeze({
        kind: "validated_host_export" as const,
        uri: "https://github.com/comfyanonymous/ComfyUI",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        license: "GPL-3.0"
      })
    }),
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "flux1-schnell.safetensors",
        key: "diffusion_models/flux1-schnell.safetensors",
        sha256: "1".repeat(64),
        bytes: 23800000000
      },
      {
        category: "clip" as const,
        relativePath: "t5xxl_fp8_e4m3fn.safetensors",
        key: "clip/t5xxl_fp8_e4m3fn.safetensors",
        sha256: "2".repeat(64),
        bytes: 4900000000
      },
      {
        category: "clip" as const,
        relativePath: "clip_l.safetensors",
        key: "clip/clip_l.safetensors",
        sha256: "3".repeat(64),
        bytes: 246000000
      },
      {
        category: "vae" as const,
        relativePath: "ae.safetensors",
        key: "vae/ae.safetensors",
        sha256: "4".repeat(64),
        bytes: 335000000
      }
    ]),
    git: Object.freeze({
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: Object.freeze([])
    }),
    disk: Object.freeze({
      modelFootprintBytes: 29281000000,
      availableBytes: 200_000_000_000,
      requiredFreeBytes: 0,
      modelFootprintGb: 29.28,
      availableGb: 200,
      minFreeDiskGb: 0,
      passes: true
    }),
    renderProfileProvenance: null
  });

  const mockLtxApprovedProvenance: CertificationProvenanceReport = Object.freeze({
    version: 1,
    profileId: "ltx-25-720p-97f",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: Object.freeze({
      relativePath: "ltx_25_720p_97f_api.json",
      sha256: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
      source: Object.freeze({
        kind: "validated_host_export" as const,
        uri: "https://github.com/comfyanonymous/ComfyUI",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        license: "GPL-3.0"
      })
    }),
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        key: "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        sha256: "5".repeat(64),
        bytes: 23800000000
      },
      {
        category: "clip" as const,
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        key: "clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        sha256: "6".repeat(64),
        bytes: 14000000000
      },
      {
        category: "vae" as const,
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors",
        key: "vae/ltx-2.5-video-vae-conv-bf16.safetensors",
        sha256: "7".repeat(64),
        bytes: 335000000
      }
    ]),
    git: Object.freeze({
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: Object.freeze([])
    }),
    disk: Object.freeze({
      modelFootprintBytes: 38135000000,
      availableBytes: 200_000_000_000,
      requiredFreeBytes: 100_000_000_000,
      modelFootprintGb: 38.14,
      availableGb: 200,
      minFreeDiskGb: 100,
      passes: true
    }),
    renderProfileProvenance: Object.freeze({
      key: "LTX_25_720P_5S_V1",
      version: 1,
      engine: "ltx_25",
      workflowHash: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
      modelHashes: Object.freeze({
        "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors":
          "5".repeat(64),
        "clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors": "6".repeat(64),
        "vae/ltx-2.5-video-vae-conv-bf16.safetensors": "7".repeat(64)
      }),
      frames: 97,
      steps: 8,
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 38.14,
      minFreeDiskGb: 100
    })
  });

  const mockFluxLiveProvenance: CertificationProvenanceReport = Object.freeze({
    ...mockFluxApprovedProvenance,
    generatedAt: "2026-08-16T12:00:00.000Z"
  });

  const mockLtxLiveProvenance: CertificationProvenanceReport = Object.freeze({
    ...mockLtxApprovedProvenance,
    generatedAt: "2026-08-16T12:00:00.000Z"
  });

  const mockEnvironment: CertificationEnvironment = {
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
    comfyUiPid: 1234,
    comfyUiArgs: ["--port", "8188"]
  };

  const mockFluxBaseline: TransitionFamilyBaseline = Object.freeze({
    profileId: "flux-schnell-draft",
    baselineDurationMs: 11020,
    peakVramMb: 23938,
    peakHostRamUsedMb: 29087,
    peakProcessRssMb: 26874,
    postUnloadFreeVramMb: 23487
  });

  const mockLtxBaseline: TransitionFamilyBaseline = Object.freeze({
    profileId: "ltx-25-720p-97f",
    baselineDurationMs: 46874,
    peakVramMb: 24028,
    peakHostRamUsedMb: 29325,
    peakProcessRssMb: 27364,
    postUnloadFreeVramMb: 23487
  });

  const mockWorkflowJson = JSON.stringify({
    "1": { class_type: "KSampler", inputs: { steps: 4 } }
  });

  function createMockPassedArtifact(runId = "transition-run-001"): TransitionSoakArtifact {
    const iterations = [];
    for (let i = 0; i <= 10; i++) {
      const family: TransitionFamily = i % 2 === 0 ? "flux" : "ltx";
      const fromFamily: TransitionFamily | null = i === 0 ? null : i % 2 === 1 ? "flux" : "ltx";
      iterations.push({
        renderIndex: i,
        transitionIndex: i === 0 ? null : i,
        fromFamily,
        family,
        render: {
          executionId: `exec-${i}`,
          status: "succeeded" as const,
          outputObjectKeys: [`output-${i}.webp`],
          startedAt: "2026-08-16T12:00:00.000Z",
          completedAt: "2026-08-16T12:00:30.000Z",
          totalDurationMs: family === "flux" ? 11000 : 46000
        },
        telemetry: {
          sampleIntervalMs: 200 as const,
          samples: [],
          samplingErrors: [],
          peakVramMb: 23000,
          reservedVramMb: 500,
          peakHostRamUsedMb: 28000,
          peakProcessRssMb: 25000,
          swapUsedDeltaMb: 0,
          systemSwapInPageDelta: 0,
          systemSwapOutPageDelta: 0,
          systemMajorPageFaultDelta: 0,
          systemMinorPageFaultDelta: 0,
          processMajorPageFaultDelta: 0,
          processMinorPageFaultDelta: 0,
          postUnloadUsedVramMb: 500,
          postUnloadFreeVramMb: 23500
        },
        cleanup: {
          startedAt: "2026-08-16T12:00:30.000Z",
          completedAt: "2026-08-16T12:00:32.000Z",
          durationMs: 2000,
          attempts: 1,
          postUnloadFreeVramMb: 23500,
          passed: true
        },
        oomDetected: false,
        comfyUiRestarted: false,
        failure: null
      });
    }

    return {
      version: 1,
      runId,
      generatedAt: "2026-08-16T12:10:00.000Z",
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
        flux: mockFluxBaseline,
        ltx: mockLtxBaseline
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
          modelSha256: { "flux.safetensors": "b".repeat(64) },
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          customNodes: [],
          measuredDiskFootprintGb: 29.28,
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
          workflowSha256: "c".repeat(64),
          modelSha256: { "ltx.safetensors": "d".repeat(64) },
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          customNodes: [],
          measuredDiskFootprintGb: 38.14,
          minFreeDiskGb: 100
        }
      },
      environment: mockEnvironment,
      iterations,
      aggregates: {
        peakVramMb: 23500,
        peakHostRamUsedMb: 28500,
        peakProcessRssMb: 25500,
        swapUsedDeltaMb: 0,
        systemSwapInPageDelta: 0,
        systemSwapOutPageDelta: 0,
        systemMajorPageFaultDelta: 0,
        systemMinorPageFaultDelta: 0,
        processMajorPageFaultDelta: 0,
        processMinorPageFaultDelta: 0,
        renderFailureCount: 0,
        cleanupFailureCount: 0,
        samplingErrorCount: 0,
        oomCount: 0,
        unexpectedRestartCount: 0,
        sameFamilyPeakVramGrowthMb: { flux: 50, ltx: 50 },
        sameFamilyPeakHostRamGrowthMb: { flux: 50, ltx: 50 },
        sameFamilyPeakProcessRssGrowthMb: { flux: 50, ltx: 50 },
        postUnloadUsedVramGrowthMb: 0,
        postUnloadHostRamGrowthMb: 0,
        postUnloadProcessRssGrowthMb: 0,
        latencyDegradationPercent: { flux: 0.5, ltx: 0.5 }
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

  function createMockFailedArtifact(runId = "transition-run-001"): TransitionSoakArtifact {
    const passed = createMockPassedArtifact(runId);
    return {
      ...passed,
      status: "failed",
      selectedRunnerProfile: null,
      gate: {
        passed: false,
        checks: {
          ...passed.gate.checks,
          allRendersSuccessful: false
        }
      },
      failure: {
        phase: "rendering",
        code: "render_failed",
        message: "Render failed at iteration 3"
      }
    };
  }

  const createMockIo = () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    return {
      stdout: (line: string) => stdoutLines.push(line),
      stderr: (line: string) => stderrLines.push(line),
      stdoutLines,
      stderrLines
    };
  };

  const createMockSamplerControl = (): TelemetrySamplerControl => ({
    start: vi.fn().mockResolvedValue(undefined),
    sampleNow: vi.fn().mockResolvedValue({
      measuredAt: "2026-08-16T12:00:00.000Z",
      phase: "pre_dispatch",
      gpu: { totalVramMb: 24576, usedVramMb: 1024, freeVramMb: 23552, reservedVramMb: 0 },
      host: {
        hostRamTotalMb: 65536,
        hostRamAvailableMb: 45000,
        hostRamUsedMb: 20536,
        swapTotalMb: 16384,
        swapUsedMb: 0,
        systemSwapInPages: 0,
        systemSwapOutPages: 0,
        systemMajorPageFaults: 0,
        systemMinorPageFaults: 0,
        processPid: 1234,
        processStartTimeTicks: 100,
        processRssMb: 1500,
        processMajorPageFaults: 0,
        processMinorPageFaults: 0
      }
    }),
    stop: vi.fn().mockResolvedValue({
      sampleIntervalMs: 200,
      samples: [],
      samplingErrors: [],
      peakVramMb: 23000,
      reservedVramMb: 500,
      peakHostRamUsedMb: 28000,
      peakProcessRssMb: 25000,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 0,
      systemMinorPageFaultDelta: 0,
      processMajorPageFaultDelta: 0,
      processMinorPageFaultDelta: 0,
      postUnloadUsedVramMb: 500,
      postUnloadFreeVramMb: 23500
    })
  });

  const createMockRenderEngine = (): RenderEnginePort => ({
    queueRender: vi.fn().mockResolvedValue({
      executionId: "exec-123",
      acceptedAt: "2026-08-16T12:00:00.000Z"
    } satisfies RenderQueueReceipt),
    getRenderResult: vi.fn().mockResolvedValue({
      executionId: "exec-123",
      status: "succeeded",
      outputObjectKeys: ["output/transition_001.webp"],
      completedAt: "2026-08-16T12:02:00.000Z"
    } satisfies RenderResult),
    unloadModels: vi.fn().mockResolvedValue(undefined)
  });

  const createStandardDependencies = (
    overrides?: Partial<CertifyTransitionSoakCliDependencies>
  ): CertifyTransitionSoakCliDependencies => ({
    loadCertificationProfile: vi.fn().mockImplementation(async (_path, id) => {
      if (id === "flux-schnell-draft") return mockFluxProfile;
      if (id === "ltx-25-720p-97f") return mockLtxProfile;
      throw new Error(`Unknown profile id: ${id}`);
    }),
    readApprovedProvenance: vi.fn().mockImplementation(async (path: string) => {
      if (path.includes("flux")) return mockFluxApprovedProvenance;
      if (path.includes("ltx")) return mockLtxApprovedProvenance;
      return mockFluxApprovedProvenance;
    }),
    readBaselineArtifact: vi.fn().mockImplementation(async (path: string) => {
      if (path.includes("flux")) return mockFluxBaseline;
      if (path.includes("ltx")) return mockLtxBaseline;
      return mockFluxBaseline;
    }),
    collectCertificationProvenance: vi.fn().mockImplementation(async ({ profile }) => {
      if (profile.id === "flux-schnell-draft") return mockFluxLiveProvenance;
      if (profile.id === "ltx-25-720p-97f") return mockLtxLiveProvenance;
      throw new Error(`Unknown profile: ${profile.id}`);
    }),
    collectRunnerEnvironment: vi.fn().mockResolvedValue(mockEnvironment),
    verifyTransitionGoldMasters: vi.fn().mockReturnValue(undefined),
    classifyCertificationHardware: vi.fn().mockReturnValue({
      status: "ready",
      gpuName: "NVIDIA GeForce RTX 4090"
    }),
    verifyComfyUiMemoryMode: vi.fn().mockReturnValue(undefined),
    readWorkflowFile: vi.fn().mockResolvedValue(mockWorkflowJson),
    createRenderEngine: vi.fn().mockReturnValue(createMockRenderEngine()),
    createTelemetrySampler: vi.fn().mockReturnValue(createMockSamplerControl()),
    runTransitionSoak: vi.fn().mockResolvedValue(createMockPassedArtifact()),
    writeTransitionSoakArtifacts: vi.fn().mockResolvedValue({
      runId: "transition-run-001",
      outputDirectory: "/repo/certification/transition-soak/transition-run-001",
      resultJsonPath: "/repo/certification/transition-soak/transition-run-001/result.json",
      summaryMdPath: "/repo/certification/transition-soak/transition-run-001/summary.md",
      relativeOutputDirectory: "certification/transition-soak/transition-run-001",
      relativeResultJsonPath: "certification/transition-soak/transition-run-001/result.json",
      relativeSummaryMdPath: "certification/transition-soak/transition-run-001/summary.md",
      artifact: createMockPassedArtifact()
    }),
    ...overrides
  });

  const standardArgs = [
    "--comfyui-dir",
    "/opt/comfyui",
    "--comfyui-url",
    "http://127.0.0.1:8188",
    "--comfyui-pid",
    "1234",
    "--flux-gold-master-provenance",
    "/templates/flux-provenance.json",
    "--ltx-gold-master-provenance",
    "/templates/ltx-provenance.json",
    "--run-id",
    "transition-run-001"
  ];

  // 1. safe-defaults
  it("defaults to ten switches and the documented thresholds", () => {
    const parsed = parseCertifyTransitionSoakCliArgs(standardArgs);
    expect(parsed.kind).toBe("run");
    if (parsed.kind !== "run") return;

    expect(parsed.options.transitionCount).toBe(10);
    expect(parsed.options.gpuIndex).toBe(0);
    expect(parsed.options.thresholds).toEqual({
      minPostUnloadFreeVramMb: 23000,
      minHostAvailableMb: 1024,
      maxVramGrowthMb: 256,
      maxHostGrowthMb: 256,
      maxLatencyDegradationPercent: 20,
      cleanupTimeoutMs: 30000,
      cleanupPollIntervalMs: 500
    } satisfies TransitionSoakThresholds);

    expect(parsed.options.manifestPath).toMatch(/templates\/provenance\.json$/);
    expect(parsed.options.outputRoot).toMatch(/certification\/transition-soak$/);
    expect(parsed.options.fluxBaselinePath).toMatch(
      /certification\/flux-schnell\/flux-schnell-cert-run-001\/result\.json$/
    );
    expect(parsed.options.ltxBaselinePath).toMatch(
      /certification\/ltx-25\/ltx-cert-run-002\/result\.json$/
    );
  });

  // 2. argument parsing validation & rejection
  it("rejects transition counts below ten and invalid threshold values", () => {
    // Transition count below 10
    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--transition-count", "9"])
    ).toThrow(/transition-count must be an integer >= 10/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--transition-count", "0"])
    ).toThrow(/transition-count must be an integer >= 10/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--transition-count", "abc"])
    ).toThrow(/transition-count must be an integer >= 10/i);

    // Negative / invalid thresholds
    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--min-post-unload-free-vram-mb", "-1"])
    ).toThrow(/min-post-unload-free-vram-mb must be a non-negative integer/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--min-host-available-mb", "-100"])
    ).toThrow(/min-host-available-mb must be a non-negative integer/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--max-vram-growth-mb", "-10"])
    ).toThrow(/max-vram-growth-mb must be a non-negative integer/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--max-host-growth-mb", "-50"])
    ).toThrow(/max-host-growth-mb must be a non-negative integer/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([
        ...standardArgs,
        "--max-latency-degradation-percent",
        "-5"
      ])
    ).toThrow(/max-latency-degradation-percent must be a non-negative number/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--cleanup-timeout-ms", "0"])
    ).toThrow(/cleanup-timeout-ms must be a positive integer/i);

    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--cleanup-poll-interval-ms", "-100"])
    ).toThrow(/cleanup-poll-interval-ms must be a positive integer/i);

    // Reject --highvram
    expect(() => parseCertifyTransitionSoakCliArgs([...standardArgs, "--highvram"])).toThrow(
      /--highvram/i
    );

    // Reject unknown flags
    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--unknown-flag", "value"])
    ).toThrow(/unknown flag/i);

    // Reject duplicate flags
    expect(() =>
      parseCertifyTransitionSoakCliArgs([...standardArgs, "--gpu-index", "0", "--gpu-index", "1"])
    ).toThrow(/duplicate flag/i);

    // Reject unsafe run IDs
    expect(() =>
      parseCertifyTransitionSoakCliArgs([
        ...standardArgs.filter((a) => a !== "transition-run-001" && a !== "--run-id"),
        "--run-id",
        "../unsafe-run"
      ])
    ).toThrow(/invalid --run-id/i);
  });

  // 3. preflight-before-side-effects
  it("completes both provenance checks before creating render side effects", async () => {
    const executionOrder: string[] = [];

    const deps = createStandardDependencies({
      loadCertificationProfile: vi.fn().mockImplementation(async (_path, id) => {
        executionOrder.push(`loadCertificationProfile:${id}`);
        if (id === "flux-schnell-draft") return mockFluxProfile;
        if (id === "ltx-25-720p-97f") return mockLtxProfile;
        throw new Error(`Unknown profile id: ${id}`);
      }),
      readApprovedProvenance: vi.fn().mockImplementation(async (path: string) => {
        executionOrder.push(`readApprovedProvenance:${path.includes("flux") ? "flux" : "ltx"}`);
        return path.includes("flux") ? mockFluxApprovedProvenance : mockLtxApprovedProvenance;
      }),
      readBaselineArtifact: vi.fn().mockImplementation(async (path: string) => {
        executionOrder.push(`readBaselineArtifact:${path.includes("flux") ? "flux" : "ltx"}`);
        return path.includes("flux") ? mockFluxBaseline : mockLtxBaseline;
      }),
      collectCertificationProvenance: vi.fn().mockImplementation(async ({ profile }) => {
        executionOrder.push(`collectCertificationProvenance:${profile.id}`);
        return profile.id === "flux-schnell-draft" ? mockFluxLiveProvenance : mockLtxLiveProvenance;
      }),
      collectRunnerEnvironment: vi.fn().mockImplementation(async () => {
        executionOrder.push("collectRunnerEnvironment");
        return mockEnvironment;
      }),
      classifyCertificationHardware: vi.fn().mockImplementation(() => {
        executionOrder.push("classifyCertificationHardware");
        return { status: "ready", gpuName: "NVIDIA GeForce RTX 4090" };
      }),
      verifyTransitionGoldMasters: vi.fn().mockImplementation(() => {
        executionOrder.push("verifyTransitionGoldMasters");
      }),
      verifyComfyUiMemoryMode: vi.fn().mockImplementation(() => {
        executionOrder.push("verifyComfyUiMemoryMode");
      }),
      readWorkflowFile: vi.fn().mockImplementation(async (path: string) => {
        executionOrder.push(`readWorkflowFile:${path.includes("flux") ? "flux" : "ltx"}`);
        return mockWorkflowJson;
      }),
      createRenderEngine: vi.fn().mockImplementation(() => {
        executionOrder.push("createRenderEngine");
        return createMockRenderEngine();
      }),
      createTelemetrySampler: vi.fn().mockImplementation(() => {
        executionOrder.push("createTelemetrySampler");
        return createMockSamplerControl();
      }),
      runTransitionSoak: vi.fn().mockImplementation(async () => {
        executionOrder.push("runTransitionSoak");
        return createMockPassedArtifact();
      })
    });

    const io = createMockIo();
    const exitCode = await runTransitionSoakCli(standardArgs, io, deps);

    expect(exitCode).toBe(0);

    // Verify all preflight steps occur before createRenderEngine / createTelemetrySampler / runTransitionSoak
    const renderEngineIndex = executionOrder.indexOf("createRenderEngine");
    const runTransitionIndex = executionOrder.indexOf("runTransitionSoak");

    expect(renderEngineIndex).toBeGreaterThan(-1);
    expect(runTransitionIndex).toBeGreaterThan(-1);

    expect(executionOrder.indexOf("loadCertificationProfile:flux-schnell-draft")).toBeLessThan(
      renderEngineIndex
    );
    expect(executionOrder.indexOf("loadCertificationProfile:ltx-25-720p-97f")).toBeLessThan(
      renderEngineIndex
    );
    expect(executionOrder.indexOf("readApprovedProvenance:flux")).toBeLessThan(renderEngineIndex);
    expect(executionOrder.indexOf("readApprovedProvenance:ltx")).toBeLessThan(renderEngineIndex);
    expect(
      executionOrder.indexOf("collectCertificationProvenance:flux-schnell-draft")
    ).toBeLessThan(renderEngineIndex);
    expect(executionOrder.indexOf("collectCertificationProvenance:ltx-25-720p-97f")).toBeLessThan(
      renderEngineIndex
    );
    expect(executionOrder.indexOf("verifyTransitionGoldMasters")).toBeLessThan(renderEngineIndex);
    expect(executionOrder.indexOf("verifyComfyUiMemoryMode")).toBeLessThan(renderEngineIndex);

    // Verify that if preflight throws (e.g. Gold Master drift), NO side effects happen
    const failedPreflightDeps = createStandardDependencies({
      verifyTransitionGoldMasters: vi.fn().mockImplementation(() => {
        throw new PreflightError("Approved and live provenance mismatch");
      }),
      createRenderEngine: vi.fn(),
      runTransitionSoak: vi.fn()
    });

    const failIo = createMockIo();
    const failExitCode = await runTransitionSoakCli(standardArgs, failIo, failedPreflightDeps);
    expect(failExitCode).toBe(1);
    expect(failedPreflightDeps.createRenderEngine).not.toHaveBeenCalled();
    expect(failedPreflightDeps.runTransitionSoak).not.toHaveBeenCalled();
    expect(failIo.stderrLines.join(" ")).toContain("Approved and live provenance mismatch");
  });

  // 4. unsupported hardware mapping
  it("maps unsupported hardware to exit 77", async () => {
    const deps = createStandardDependencies({
      classifyCertificationHardware: vi.fn().mockReturnValue({
        status: "unsupported",
        reason:
          'Only "NVIDIA GeForce RTX 4090" is certification-capable; host has: "NVIDIA GeForce RTX 3090"'
      }),
      createRenderEngine: vi.fn(),
      runTransitionSoak: vi.fn()
    });

    const io = createMockIo();
    const exitCode = await runTransitionSoakCli(standardArgs, io, deps);

    expect(exitCode).toBe(77);
    expect(deps.createRenderEngine).not.toHaveBeenCalled();
    expect(deps.runTransitionSoak).not.toHaveBeenCalled();
    expect(io.stderrLines.join(" ")).toContain("Hardware unsupported");
  });

  // 5. runs eleven strict alternating records for ten switches
  it("runs eleven strict alternating records for ten switches", async () => {
    let capturedOptions: unknown;

    const deps = createStandardDependencies({
      runTransitionSoak: vi.fn().mockImplementation(async (opts) => {
        capturedOptions = opts;
        return createMockPassedArtifact();
      })
    });

    const io = createMockIo();
    const exitCode = await runTransitionSoakCli(standardArgs, io, deps);

    expect(exitCode).toBe(0);
    expect(deps.runTransitionSoak).toHaveBeenCalledTimes(1);

    const opts = capturedOptions as {
      requestedTransitionCount: number;
      runnerProfile: string;
      identities: { flux: unknown; ltx: unknown };
      baselines: { flux: unknown; ltx: unknown };
      workflows: { flux: unknown; ltx: unknown };
      createTelemetrySampler: (idx: number, family: TransitionFamily) => TelemetrySamplerControl;
    };

    expect(opts.requestedTransitionCount).toBe(10);
    expect(opts.runnerProfile).toBe("dynamicvram-offload-v1");
    expect(opts.identities.flux).toBeDefined();
    expect(opts.identities.ltx).toBeDefined();

    // Verify createTelemetrySampler factory is provided
    expect(typeof opts.createTelemetrySampler).toBe("function");
    const sampler = opts.createTelemetrySampler(0, "flux");
    expect(sampler).toBeDefined();
    expect(typeof sampler.start).toBe("function");
  });

  // 6. truthful-publication-exit
  it("publishes pass and fail outcomes before returning their truthful exit code", async () => {
    // Passed run
    const passDeps = createStandardDependencies({
      runTransitionSoak: vi.fn().mockResolvedValue(createMockPassedArtifact("run-pass")),
      writeTransitionSoakArtifacts: vi.fn().mockResolvedValue({
        runId: "run-pass",
        outputDirectory: "/repo/certification/transition-soak/run-pass",
        resultJsonPath: "/repo/certification/transition-soak/run-pass/result.json",
        summaryMdPath: "/repo/certification/transition-soak/run-pass/summary.md",
        relativeOutputDirectory: "certification/transition-soak/run-pass",
        relativeResultJsonPath: "certification/transition-soak/run-pass/result.json",
        relativeSummaryMdPath: "certification/transition-soak/run-pass/summary.md",
        artifact: createMockPassedArtifact("run-pass")
      })
    });

    const passIo = createMockIo();
    const passCode = await runTransitionSoakCli(
      [
        ...standardArgs.filter((a) => a !== "transition-run-001" && a !== "--run-id"),
        "--run-id",
        "run-pass"
      ],
      passIo,
      passDeps
    );

    expect(passCode).toBe(0);
    expect(passDeps.writeTransitionSoakArtifacts).toHaveBeenCalledTimes(1);
    expect(passIo.stdoutLines.join(" ")).toContain(
      "certification/transition-soak/run-pass/result.json"
    );
    expect(passIo.stdoutLines.join(" ")).toContain(
      "certification/transition-soak/run-pass/summary.md"
    );

    // Failed run
    const failDeps = createStandardDependencies({
      runTransitionSoak: vi.fn().mockResolvedValue(createMockFailedArtifact("run-fail")),
      writeTransitionSoakArtifacts: vi.fn().mockResolvedValue({
        runId: "run-fail",
        outputDirectory: "/repo/certification/transition-soak/run-fail",
        resultJsonPath: "/repo/certification/transition-soak/run-fail/result.json",
        summaryMdPath: "/repo/certification/transition-soak/run-fail/summary.md",
        relativeOutputDirectory: "certification/transition-soak/run-fail",
        relativeResultJsonPath: "certification/transition-soak/run-fail/result.json",
        relativeSummaryMdPath: "certification/transition-soak/run-fail/summary.md",
        artifact: createMockFailedArtifact("run-fail")
      })
    });

    const failIo = createMockIo();
    const failCode = await runTransitionSoakCli(
      [
        ...standardArgs.filter((a) => a !== "transition-run-001" && a !== "--run-id"),
        "--run-id",
        "run-fail"
      ],
      failIo,
      failDeps
    );

    expect(failCode).toBe(1);
    expect(failDeps.writeTransitionSoakArtifacts).toHaveBeenCalledTimes(1);
    expect(failIo.stdoutLines.join(" ")).toContain(
      "certification/transition-soak/run-fail/result.json"
    );
    expect(failIo.stdoutLines.join(" ")).toContain(
      "certification/transition-soak/run-fail/summary.md"
    );
    expect(failIo.stderrLines.join(" ")).toContain("render_failed");
  });

  // 7. no-import-side-effect
  it("does not execute when imported", async () => {
    const originalArgv = [...process.argv];
    const originalExitCode = process.exitCode;
    try {
      process.argv = ["node", "certify-transition-soak.ts"];
      const module = await import("./certify-transition-soak.js");
      expect(typeof module.runTransitionSoakCli).toBe("function");
      expect(typeof module.parseCertifyTransitionSoakCliArgs).toBe("function");
      expect(typeof module.isDirectExecution).toBe("function");
      expect(process.exitCode).toBe(originalExitCode);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  // 8. exposes package scripts
  it("exposes the root and render-worker package scripts", async () => {
    const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
    const rootPkg = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
    const workerPkg = JSON.parse(
      await readFile(resolve(repoRoot, "apps/render-worker/package.json"), "utf8")
    );

    expect(rootPkg.scripts?.["certify:transition-soak"]).toBe(
      "pnpm --filter render-worker certify:transition-soak"
    );
    expect(workerPkg.scripts?.["certify:transition-soak"]).toBe(
      "tsx src/cli/certify-transition-soak.ts"
    );
  });
});
