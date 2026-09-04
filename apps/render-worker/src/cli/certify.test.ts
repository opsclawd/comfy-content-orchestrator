import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CertificationEnvironment, CertificationArtifact } from "@cco/contracts";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import type { RenderEnginePort, RenderQueueReceipt, RenderResult } from "@cco/application";
import {
  parseCertifyCliArgs,
  runCertificationCli,
  type CertifyCliDependencies,
  type TelemetrySamplerControl
} from "./certify.js";
import { PreflightError } from "../certification/preflight.js";

describe("certify CLI", () => {
  const mockLtxProfile: CertificationProfile = Object.freeze({
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    workflowPath: "/test/manifests/ltx_25_720p_97f_api.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
    source: Object.freeze({
      kind: "official_upstream" as const,
      uri: "https://github.com/Lightricks/LTX-2",
      revision: "main",
      license: "LTX-2 Community License"
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
        relativePath: "ltx-video-2b-v0.9.1.safetensors"
      },
      {
        category: "clip" as const,
        relativePath: "t5xxl_fp16.safetensors"
      },
      {
        category: "vae" as const,
        relativePath: "ltx-video-vae.safetensors"
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
        classType: "EmptyLTXLatentVideo",
        input: "width",
        equals: 1280
      },
      {
        nodeId: "5",
        classType: "EmptyLTXLatentVideo",
        input: "height",
        equals: 720
      },
      {
        nodeId: "5",
        classType: "EmptyLTXLatentVideo",
        input: "length",
        equals: 97
      }
    ]),
    renderProfileIdentity: Object.freeze({
      key: "LTX_25_720P_5S_V1" as const,
      version: 1 as const
    })
  });

  const mockFluxProfile: CertificationProfile = Object.freeze({
    id: "flux-schnell-draft",
    engine: "flux_schnell",
    workflowPath: "/test/manifests/flux_schnell_draft_api.json",
    workflowRelativePath: "flux_schnell_draft_api.json",
    expectedWorkflowHash: "a".repeat(64),
    source: Object.freeze({
      kind: "validated_host_export" as const,
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }),
    baseline: Object.freeze({
      width: 1024,
      height: 1024,
      frames: 1,
      steps: 4
    }),
    minFreeDiskGb: 0,
    runnerProfile: "dynamicvram-offload-v1",
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "flux1-schnell.safetensors"
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
    renderProfileIdentity: Object.freeze({
      key: "FLUX_SCHNELL_DRAFT_V1" as const,
      version: 1 as const
    })
  });

  const mockApprovedProvenance: CertificationProvenanceReport = Object.freeze({
    version: 1,
    profileId: "ltx-25-720p-97f",
    generatedAt: "2026-08-15T12:00:00.000Z",
    workflow: Object.freeze({
      relativePath: "ltx_25_720p_97f_api.json",
      sha256: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      source: Object.freeze({
        kind: "validated_host_export" as const,
        uri: "https://example.com/comfyui/ltx",
        revision: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        license: "LTX-2 Community License"
      })
    }),
    models: Object.freeze([
      {
        category: "diffusion_models" as const,
        relativePath: "ltx-video-2b-v0.9.1.safetensors",
        key: "diffusion_models/ltx-video-2b-v0.9.1.safetensors",
        sha256: "1".repeat(64),
        bytes: 1000
      },
      {
        category: "clip" as const,
        relativePath: "t5xxl_fp16.safetensors",
        key: "clip/t5xxl_fp16.safetensors",
        sha256: "2".repeat(64),
        bytes: 1000
      },
      {
        category: "vae" as const,
        relativePath: "ltx-video-vae.safetensors",
        key: "vae/ltx-video-vae.safetensors",
        sha256: "3".repeat(64),
        bytes: 1000
      }
    ]),
    git: Object.freeze({
      comfyUiCommit: "a".repeat(40),
      customNodes: Object.freeze([
        {
          name: "comfyui-ltx-nodes",
          commit: "b".repeat(40),
          status: "tracked" as const
        }
      ])
    }),
    disk: Object.freeze({
      modelFootprintBytes: 3000,
      availableBytes: 200_000_000_000,
      requiredFreeBytes: 100_000_000_000,
      modelFootprintGb: 0.000003,
      availableGb: 200,
      minFreeDiskGb: 100,
      passes: true
    }),
    renderProfileProvenance: Object.freeze({
      key: "LTX_25_720P_5S_V1",
      version: 1,
      engine: "ltx_25",
      workflowHash: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      modelHashes: Object.freeze({
        "diffusion_models/ltx-video-2b-v0.9.1.safetensors": "1".repeat(64),
        "clip/t5xxl_fp16.safetensors": "2".repeat(64),
        "vae/ltx-video-vae.safetensors": "3".repeat(64)
      }),
      frames: 97,
      steps: 8,
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 0.000003,
      minFreeDiskGb: 100
    })
  });

  const mockLiveProvenance: CertificationProvenanceReport = Object.freeze({
    ...mockApprovedProvenance
  });

  const mockEnvironment: CertificationEnvironment = {
    nodeVersion: "v22.10.0",
    platform: "linux",
    arch: "x64",
    osRelease: "6.8.0-generic",
    osVersion: "#1 SMP",
    cpuModel: "AMD Ryzen 9 7950X",
    cpuCount: 32,
    gpuName: "NVIDIA GeForce RTX 4090",
    gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
    gpuDriverVersion: "550.54.14",
    gpuTotalMemoryMb: 24576,
    cudaVersion: "12.4",
    comfyUiPid: 1234,
    comfyUiArgs: ["python3", "main.py"]
  };

  const mockWorkflowJson = JSON.stringify({
    "1": {
      class_type: "KSampler",
      inputs: {
        steps: 8
      }
    }
  });

  const mockPassedArtifact: CertificationArtifact = {
    version: 1,
    runId: "run-001",
    generatedAt: "2026-08-15T12:05:00.000Z",
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
      workflowSha256: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      modelSha256: {
        "diffusion_models/ltx-video-2b-v0.9.1.safetensors": "1".repeat(64),
        "clip/t5xxl_fp16.safetensors": "2".repeat(64),
        "vae/ltx-video-vae.safetensors": "3".repeat(64)
      },
      comfyUiCommit: "a".repeat(40),
      customNodes: [
        {
          name: "comfyui-ltx-nodes",
          commit: "b".repeat(40),
          status: "tracked" as const
        }
      ]
    },
    environment: mockEnvironment,
    render: {
      executionId: "exec-123",
      status: "succeeded",
      outputObjectKeys: ["output/ltx_001.webp"],
      startedAt: "2026-08-15T12:01:00.000Z",
      completedAt: "2026-08-15T12:03:00.000Z",
      totalDurationMs: 120000
    },
    telemetry: {
      sampleIntervalMs: 200,
      samples: [
        {
          measuredAt: "2026-08-15T12:01:00.000Z",
          phase: "pre_dispatch" as const,
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
        },
        {
          measuredAt: "2026-08-15T12:04:00.000Z",
          phase: "post_unload" as const,
          gpu: { totalVramMb: 24576, usedVramMb: 1200, freeVramMb: 23376, reservedVramMb: 0 },
          host: {
            hostRamTotalMb: 65536,
            hostRamAvailableMb: 44000,
            hostRamUsedMb: 21536,
            swapTotalMb: 16384,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 0,
            systemMinorPageFaults: 0,
            processPid: 1234,
            processStartTimeTicks: 100,
            processRssMb: 1600,
            processMajorPageFaults: 0,
            processMinorPageFaults: 0
          }
        }
      ],
      samplingErrors: [],
      peakVramMb: 18000,
      reservedVramMb: 0,
      peakHostRamUsedMb: 25000,
      peakProcessRssMb: 4000,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 0,
      systemMinorPageFaultDelta: 100,
      processMajorPageFaultDelta: 0,
      processMinorPageFaultDelta: 50,
      postUnloadUsedVramMb: 1200,
      postUnloadFreeVramMb: 23376
    },
    gate: Object.freeze({
      passed: true,
      maxDurationMs: 300000,
      checks: Object.freeze({
        renderSuccess: true,
        noOom: true,
        durationWithinLimit: true,
        telemetryComplete: true,
        postUnloadHeadroomObserved: true
      })
    }),
    failure: null
  };

  const mockFailedArtifact: CertificationArtifact = Object.freeze({
    ...mockPassedArtifact,
    status: "failed",
    render: Object.freeze({
      ...mockPassedArtifact.render,
      status: "failed"
    }),
    gate: Object.freeze({
      ...mockPassedArtifact.gate,
      passed: false,
      checks: Object.freeze({
        ...mockPassedArtifact.gate.checks,
        renderSuccess: false
      })
    }),
    failure: Object.freeze({
      phase: "rendering",
      code: "render_failed",
      message: "Render execution failed"
    })
  });

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
      measuredAt: "2026-08-15T12:00:00.000Z",
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
    stop: vi.fn().mockResolvedValue(mockPassedArtifact.telemetry)
  });

  const createMockRenderEngine = (): RenderEnginePort => ({
    queueRender: vi.fn().mockResolvedValue({
      executionId: "exec-123",
      acceptedAt: "2026-08-15T12:00:00.000Z"
    } satisfies RenderQueueReceipt),
    getRenderResult: vi.fn().mockResolvedValue({
      executionId: "exec-123",
      status: "succeeded",
      outputObjectKeys: ["output/ltx_001.webp"],
      completedAt: "2026-08-15T12:02:00.000Z"
    } satisfies RenderResult),
    unloadModels: vi.fn().mockResolvedValue(undefined)
  });

  const createStandardDependencies = (
    overrides?: Partial<CertifyCliDependencies>
  ): CertifyCliDependencies => ({
    loadCertificationProfile: vi.fn().mockResolvedValue(mockLtxProfile),
    readApprovedProvenance: vi.fn().mockResolvedValue(mockApprovedProvenance),
    collectCertificationProvenance: vi.fn().mockResolvedValue(mockLiveProvenance),
    collectRunnerEnvironment: vi.fn().mockResolvedValue(mockEnvironment),
    verifyGoldMasterProvenance: vi.fn().mockReturnValue(undefined),
    classifyCertificationHardware: vi.fn().mockReturnValue({
      status: "ready",
      gpuName: "NVIDIA GeForce RTX 4090"
    }),
    verifyComfyUiMemoryMode: vi.fn().mockReturnValue(undefined),
    readWorkflowFile: vi.fn().mockResolvedValue(mockWorkflowJson),
    createRenderEngine: vi.fn().mockReturnValue(createMockRenderEngine()),
    createTelemetrySampler: vi.fn().mockReturnValue(createMockSamplerControl()),
    runCertification: vi.fn().mockResolvedValue(mockPassedArtifact),
    writeCertificationArtifacts: vi.fn().mockResolvedValue({
      runId: "run-001",
      outputDirectory: "/repo/certification/ltx-25/run-001",
      resultJsonPath: "/repo/certification/ltx-25/run-001/result.json",
      summaryMdPath: "/repo/certification/ltx-25/run-001/summary.md",
      approvedProvenancePath: "/repo/certification/ltx-25/run-001/approved-provenance.json",
      relativeOutputDirectory: "certification/ltx-25/run-001",
      relativeResultJsonPath: "certification/ltx-25/run-001/result.json",
      relativeSummaryMdPath: "certification/ltx-25/run-001/summary.md",
      relativeApprovedProvenancePath: "certification/ltx-25/run-001/approved-provenance.json",
      artifact: mockPassedArtifact
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
    "--gold-master-provenance",
    "/templates/provenance.json",
    "--run-id",
    "run-001"
  ];

  describe("Behavioral Invariants", () => {
    it("completes all preflight checks before starting telemetry or rendering (preflight-precedes-side-effects)", async () => {
      const order: string[] = [];

      const samplerControl = createMockSamplerControl();
      (samplerControl.start as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("sampler.start");
      });

      const renderEngine = createMockRenderEngine();
      (renderEngine.queueRender as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("renderEngine.queueRender");
        return { executionId: "exec-123", acceptedAt: "2026-08-15T12:00:00.000Z" };
      });

      const deps = createStandardDependencies({
        loadCertificationProfile: vi.fn().mockImplementation(async () => {
          order.push("loadCertificationProfile");
          return mockLtxProfile;
        }),
        readApprovedProvenance: vi.fn().mockImplementation(async () => {
          order.push("readApprovedProvenance");
          return mockApprovedProvenance;
        }),
        collectCertificationProvenance: vi.fn().mockImplementation(async () => {
          order.push("collectCertificationProvenance");
          return mockLiveProvenance;
        }),
        collectRunnerEnvironment: vi.fn().mockImplementation(async () => {
          order.push("collectRunnerEnvironment");
          return mockEnvironment;
        }),
        verifyGoldMasterProvenance: vi.fn().mockImplementation(() => {
          order.push("verifyGoldMasterProvenance");
        }),
        classifyCertificationHardware: vi.fn().mockImplementation(() => {
          order.push("classifyCertificationHardware");
          return { status: "ready", gpuName: "NVIDIA GeForce RTX 4090" };
        }),
        verifyComfyUiMemoryMode: vi.fn().mockImplementation(() => {
          order.push("verifyComfyUiMemoryMode");
        }),
        readWorkflowFile: vi.fn().mockImplementation(async () => {
          order.push("readWorkflowFile");
          return mockWorkflowJson;
        }),
        createRenderEngine: vi.fn().mockReturnValue(renderEngine),
        createTelemetrySampler: vi.fn().mockReturnValue(samplerControl),
        runCertification: vi.fn().mockImplementation(async () => {
          order.push("runCertification");
          return mockPassedArtifact;
        }),
        writeCertificationArtifacts: vi.fn().mockImplementation(async () => {
          order.push("writeCertificationArtifacts");
          return {
            runId: "run-001",
            outputDirectory: "/repo/certification/ltx-25/run-001",
            resultJsonPath: "/repo/certification/ltx-25/run-001/result.json",
            summaryMdPath: "/repo/certification/ltx-25/run-001/summary.md",
            relativeOutputDirectory: "certification/ltx-25/run-001",
            relativeResultJsonPath: "certification/ltx-25/run-001/result.json",
            relativeSummaryMdPath: "certification/ltx-25/run-001/summary.md",
            artifact: mockPassedArtifact
          };
        })
      });

      const io = createMockIo();
      const exitCode = await runCertificationCli(standardArgs, io, deps);

      expect(exitCode).toBe(0);

      // Verify that all preflight steps precede runCertification and artifact write
      const preflightSteps = [
        "loadCertificationProfile",
        "readApprovedProvenance",
        "collectCertificationProvenance",
        "collectRunnerEnvironment",
        "classifyCertificationHardware",
        "verifyGoldMasterProvenance",
        "verifyComfyUiMemoryMode",
        "readWorkflowFile"
      ];

      for (const step of preflightSteps) {
        const stepIndex = order.indexOf(step);
        const runCertIndex = order.indexOf("runCertification");
        const writeArtifactsIndex = order.indexOf("writeCertificationArtifacts");

        expect(stepIndex).toBeGreaterThanOrEqual(0);
        expect(stepIndex).toBeLessThan(runCertIndex);
        expect(runCertIndex).toBeLessThan(writeArtifactsIndex);
      }
    });

    it("defaults to DynamicVRAM and isolates highvram comparator output (dynamicvram-is-default)", async () => {
      let dynamicModePassed: string | undefined;
      let highvramModePassed: string | undefined;

      // Default run (no --highvram flag)
      const dynamicDeps = createStandardDependencies({
        verifyComfyUiMemoryMode: vi.fn().mockImplementation((opts) => {
          dynamicModePassed = typeof opts === "object" ? opts.runnerMode : opts;
        }),
        runCertification: vi.fn().mockImplementation(async (opts) => {
          expect(opts.runnerMode).toBe("dynamicvram");
          return mockPassedArtifact;
        })
      });

      const dynamicIo = createMockIo();
      const dynamicArgs = [
        "--comfyui-dir",
        "/opt/comfyui",
        "--comfyui-url",
        "http://127.0.0.1:8188",
        "--comfyui-pid",
        "1234",
        "--gold-master-provenance",
        "/templates/provenance.json",
        "--run-id",
        "dyn-001"
      ];

      const dynamicCode = await runCertificationCli(dynamicArgs, dynamicIo, dynamicDeps);

      expect(dynamicCode).toBe(0);
      expect(dynamicModePassed).toBe("dynamicvram");
      expect(dynamicDeps.writeCertificationArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({
          artifact: expect.objectContaining({ runnerMode: "dynamicvram" })
        })
      );

      // Now with --highvram
      const highvramDeps = createStandardDependencies({
        verifyComfyUiMemoryMode: vi.fn().mockImplementation((opts) => {
          highvramModePassed = typeof opts === "object" ? opts.runnerMode : opts;
        }),
        runCertification: vi.fn().mockImplementation(async (opts) => {
          expect(opts.runnerMode).toBe("highvram");
          return { ...mockPassedArtifact, runnerMode: "highvram", runId: "high-001" };
        })
      });

      const highvramIo = createMockIo();
      const highvramArgs = [
        "--comfyui-dir",
        "/opt/comfyui",
        "--comfyui-url",
        "http://127.0.0.1:8188",
        "--comfyui-pid",
        "1234",
        "--gold-master-provenance",
        "/templates/provenance.json",
        "--run-id",
        "high-001",
        "--highvram"
      ];

      const highvramCode = await runCertificationCli(highvramArgs, highvramIo, highvramDeps);

      expect(highvramCode).toBe(0);
      expect(highvramModePassed).toBe("highvram");
      expect(highvramDeps.writeCertificationArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({
          artifact: expect.objectContaining({ runnerMode: "highvram" })
        })
      );
    });

    it("maps unsupported hardware to 77 and refused preflight to 1 (hardware-unavailable-is-explicit-skip)", async () => {
      // 1. Hardware unavailable (e.g. non-RTX 4090 GPU or nvidia-smi missing) -> exit code 77, no artifact written
      const unsupportedDeps = createStandardDependencies({
        classifyCertificationHardware: vi.fn().mockReturnValue({
          status: "unsupported",
          reason:
            'Only "NVIDIA GeForce RTX 4090" is certification-capable; host has: "NVIDIA GeForce RTX 3080"'
        })
      });

      const unsupportedIo = createMockIo();
      const unsupportedExit = await runCertificationCli(
        standardArgs,
        unsupportedIo,
        unsupportedDeps
      );

      expect(unsupportedExit).toBe(77);
      expect(unsupportedIo.stderrLines.join(" ")).toContain("RTX 4090");
      expect(unsupportedDeps.runCertification).not.toHaveBeenCalled();
      expect(unsupportedDeps.writeCertificationArtifacts).not.toHaveBeenCalled();

      // 2. Hardware refused (e.g. invalid ComfyUI PID) -> exit code 1, no artifact written
      const refusedHardwareDeps = createStandardDependencies({
        classifyCertificationHardware: vi.fn().mockReturnValue({
          status: "refused",
          reason: "Invalid ComfyUI PID: -1"
        })
      });

      const refusedHardwareIo = createMockIo();
      const refusedHardwareExit = await runCertificationCli(
        standardArgs,
        refusedHardwareIo,
        refusedHardwareDeps
      );

      expect(refusedHardwareExit).toBe(1);
      expect(refusedHardwareIo.stderrLines.join(" ")).toContain("Invalid ComfyUI PID");
      expect(refusedHardwareDeps.writeCertificationArtifacts).not.toHaveBeenCalled();

      // 3. Environment collection error that classifies as unsupported (e.g. nvidia-smi ENOENT) -> 77
      const envErrorDeps = createStandardDependencies({
        collectRunnerEnvironment: vi.fn().mockRejectedValue(new Error("spawn nvidia-smi ENOENT")),
        classifyCertificationHardware: vi.fn().mockReturnValue({
          status: "unsupported",
          reason: "NVIDIA tooling or GPU query unavailable: spawn nvidia-smi ENOENT"
        })
      });

      const envErrorIo = createMockIo();
      const envErrorExit = await runCertificationCli(standardArgs, envErrorIo, envErrorDeps);

      expect(envErrorExit).toBe(77);
      expect(envErrorIo.stderrLines.join(" ")).toContain("nvidia-smi");
      expect(envErrorDeps.writeCertificationArtifacts).not.toHaveBeenCalled();

      // 4. Preflight refusal (e.g. memory mode conflict) -> exit code 1
      const memoryRefusalDeps = createStandardDependencies({
        verifyComfyUiMemoryMode: vi.fn().mockImplementation(() => {
          throw new PreflightError(
            "DynamicVRAM mode requires default ComfyUI memory management, but explicit VRAM flags were found: --lowvram"
          );
        })
      });

      const memIo = createMockIo();
      const memExit = await runCertificationCli(standardArgs, memIo, memoryRefusalDeps);

      expect(memExit).toBe(1);
      expect(memIo.stderrLines.join(" ")).toContain("--lowvram");
      expect(memoryRefusalDeps.writeCertificationArtifacts).not.toHaveBeenCalled();
    });

    it("publishes measured success and failure outcomes with truthful exit codes (render-outcome-is-published)", async () => {
      // 1. Success outcome -> write artifact, print paths/summary, exit 0
      const successDeps = createStandardDependencies({
        runCertification: vi.fn().mockResolvedValue(mockPassedArtifact)
      });

      const successIo = createMockIo();
      const successExit = await runCertificationCli(standardArgs, successIo, successDeps);

      expect(successExit).toBe(0);
      expect(successDeps.writeCertificationArtifacts).toHaveBeenCalledTimes(1);
      expect(successDeps.writeCertificationArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({
          liveProvenance: mockLiveProvenance,
          profile: mockLtxProfile
        })
      );
      expect(successIo.stdoutLines.join(" ")).toContain("result.json");
      expect(successIo.stdoutLines.join(" ")).toContain("summary.md");
      expect(successIo.stdoutLines.join(" ")).toContain("Approved Provenance:");

      // 2. Render failure / timeout outcome -> write failed artifact, print summary, exit 1
      const failureDeps = createStandardDependencies({
        runCertification: vi.fn().mockResolvedValue(mockFailedArtifact),
        writeCertificationArtifacts: vi.fn().mockResolvedValue({
          runId: "run-001",
          outputDirectory: "/repo/certification/ltx-25/run-001",
          resultJsonPath: "/repo/certification/ltx-25/run-001/result.json",
          summaryMdPath: "/repo/certification/ltx-25/run-001/summary.md",
          relativeOutputDirectory: "certification/ltx-25/run-001",
          relativeResultJsonPath: "certification/ltx-25/run-001/result.json",
          relativeSummaryMdPath: "certification/ltx-25/run-001/summary.md",
          artifact: mockFailedArtifact
        })
      });

      const failureIo = createMockIo();
      const failureExit = await runCertificationCli(standardArgs, failureIo, failureDeps);

      expect(failureExit).toBe(1);
      expect(failureDeps.writeCertificationArtifacts).toHaveBeenCalledTimes(1);
      expect(failureDeps.writeCertificationArtifacts).toHaveBeenCalledWith(
        expect.objectContaining({
          artifact: expect.objectContaining({ status: "failed" })
        })
      );
      expect(failureIo.stdoutLines.join(" ")).toContain("result.json");
    });

    it("does not execute the CLI when imported (direct-entry-is-testable)", async () => {
      const previousExitCode = process.exitCode;
      const mod = await import("./certify.js");
      expect(mod.parseCertifyCliArgs).toBeDefined();
      expect(mod.runCertificationCli).toBeDefined();
      expect(process.exitCode).toBe(previousExitCode);
    });
  });

  describe("CLI Flag Parsing", () => {
    it("parses all required and optional flags correctly", () => {
      const parsed = parseCertifyCliArgs([
        "--comfyui-dir",
        "/custom/comfyui",
        "--comfyui-url",
        "http://192.168.1.50:8188",
        "--comfyui-pid",
        "4567",
        "--gold-master-provenance",
        "/custom/gold.json",
        "--run-id",
        "custom-run-001",
        "--profile",
        "flux-schnell-draft",
        "--manifest",
        "/custom/manifest.json",
        "--gpu-index",
        "1",
        "--output-root",
        "/custom/output",
        "--highvram"
      ]);

      expect(parsed.kind).toBe("run");
      if (parsed.kind === "run") {
        expect(parsed.options.comfyUiDir).toBe("/custom/comfyui");
        expect(parsed.options.comfyUiUrl).toBe("http://192.168.1.50:8188");
        expect(parsed.options.comfyUiPid).toBe(4567);
        expect(parsed.options.goldMasterProvenancePath).toBe("/custom/gold.json");
        expect(parsed.options.runId).toBe("custom-run-001");
        expect(parsed.options.profileId).toBe("flux-schnell-draft");
        expect(parsed.options.manifestPath).toBe("/custom/manifest.json");
        expect(parsed.options.gpuIndex).toBe(1);
        expect(parsed.options.outputRoot).toBe("/custom/output");
        expect(parsed.options.highvram).toBe(true);
        expect(parsed.options.runnerMode).toBe("highvram");
      }
    });

    it("applies fixed repository-relative defaults for optional flags", () => {
      const parsed = parseCertifyCliArgs([
        "--comfyui-dir",
        "/custom/comfyui",
        "--comfyui-url",
        "http://127.0.0.1:8188",
        "--comfyui-pid",
        "1234",
        "--gold-master-provenance",
        "/custom/gold.json",
        "--run-id",
        "run-100"
      ]);

      expect(parsed.kind).toBe("run");
      if (parsed.kind === "run") {
        expect(parsed.options.profileId).toBe("ltx-25-720p-97f");
        expect(parsed.options.gpuIndex).toBe(0);
        expect(parsed.options.highvram).toBe(false);
        expect(parsed.options.runnerMode).toBe("dynamicvram");
        expect(parsed.options.manifestPath).toMatch(/templates\/provenance\.json$/);
        expect(parsed.options.outputRoot).toMatch(/certification\/ltx-25$/);
      }
    });

    it("handles --flag=value format and pnpm argument separator --", () => {
      const parsed = parseCertifyCliArgs([
        "--",
        "--comfyui-dir=/custom/comfyui",
        "--comfyui-url=http://127.0.0.1:8188",
        "--comfyui-pid=1234",
        "--gold-master-provenance=/custom/gold.json",
        "--run-id=run-100"
      ]);

      expect(parsed.kind).toBe("run");
      if (parsed.kind === "run") {
        expect(parsed.options.comfyUiDir).toBe("/custom/comfyui");
        expect(parsed.options.comfyUiUrl).toBe("http://127.0.0.1:8188");
        expect(parsed.options.comfyUiPid).toBe(1234);
        expect(parsed.options.goldMasterProvenancePath).toBe("/custom/gold.json");
        expect(parsed.options.runId).toBe("run-100");
      }
    });

    it("returns help for --help and -h", () => {
      expect(parseCertifyCliArgs(["--help"])).toEqual({ kind: "help" });
      expect(parseCertifyCliArgs(["-h"])).toEqual({ kind: "help" });
      expect(parseCertifyCliArgs(["--comfyui-dir", "/foo", "--help"])).toEqual({ kind: "help" });
    });

    it("rejects missing required flags", () => {
      expect(() =>
        parseCertifyCliArgs([
          "--comfyui-url",
          "http://127.0.0.1:8188",
          "--comfyui-pid",
          "1234",
          "--gold-master-provenance",
          "/gold.json",
          "--run-id",
          "run-1"
        ])
      ).toThrow(/--comfyui-dir/);

      expect(() =>
        parseCertifyCliArgs([
          "--comfyui-dir",
          "/comfy",
          "--comfyui-pid",
          "1234",
          "--gold-master-provenance",
          "/gold.json",
          "--run-id",
          "run-1"
        ])
      ).toThrow(/--comfyui-url/);

      expect(() =>
        parseCertifyCliArgs([
          "--comfyui-dir",
          "/comfy",
          "--comfyui-url",
          "http://127.0.0.1:8188",
          "--gold-master-provenance",
          "/gold.json",
          "--run-id",
          "run-1"
        ])
      ).toThrow(/--comfyui-pid/);

      expect(() =>
        parseCertifyCliArgs([
          "--comfyui-dir",
          "/comfy",
          "--comfyui-url",
          "http://127.0.0.1:8188",
          "--comfyui-pid",
          "1234",
          "--run-id",
          "run-1"
        ])
      ).toThrow(/--gold-master-provenance/);

      expect(() =>
        parseCertifyCliArgs([
          "--comfyui-dir",
          "/comfy",
          "--comfyui-url",
          "http://127.0.0.1:8188",
          "--comfyui-pid",
          "1234",
          "--gold-master-provenance",
          "/gold.json"
        ])
      ).toThrow(/--run-id/);
    });

    it("rejects invalid comfyui-pid values", () => {
      const base = [
        "--comfyui-dir",
        "/comfy",
        "--comfyui-url",
        "http://127.0.0.1:8188",
        "--gold-master-provenance",
        "/gold.json",
        "--run-id",
        "run-1"
      ];

      expect(() => parseCertifyCliArgs([...base, "--comfyui-pid", "abc"])).toThrow(
        /positive integer/
      );
      expect(() => parseCertifyCliArgs([...base, "--comfyui-pid", "0"])).toThrow(
        /positive integer/
      );
      expect(() => parseCertifyCliArgs([...base, "--comfyui-pid", "-5"])).toThrow(
        /positive integer/
      );
      expect(() => parseCertifyCliArgs([...base, "--comfyui-pid", "1.5"])).toThrow(
        /positive integer/
      );
    });

    it("rejects invalid gpu-index values", () => {
      const base = [...standardArgs];
      expect(() => parseCertifyCliArgs([...base, "--gpu-index", "-1"])).toThrow(
        /non-negative integer/
      );
      expect(() => parseCertifyCliArgs([...base, "--gpu-index", "xyz"])).toThrow(
        /non-negative integer/
      );
      expect(() => parseCertifyCliArgs([...base, "--gpu-index", "2.3"])).toThrow(
        /non-negative integer/
      );
    });

    it("rejects invalid run-id values", () => {
      const base = [
        "--comfyui-dir",
        "/comfy",
        "--comfyui-url",
        "http://127.0.0.1:8188",
        "--comfyui-pid",
        "1234",
        "--gold-master-provenance",
        "/gold.json"
      ];

      expect(() => parseCertifyCliArgs([...base, "--run-id", "INVALID_UPPER"])).toThrow(/run-id/i);
      expect(() => parseCertifyCliArgs([...base, "--run-id", "../traversal"])).toThrow(/run-id/i);
      expect(() => parseCertifyCliArgs([...base, "--run-id", "slash/id"])).toThrow(/run-id/i);
      expect(() => parseCertifyCliArgs([...base, "--run-id", "-bad-start"])).toThrow(/run-id/i);
      expect(() => parseCertifyCliArgs([...base, "--run-id", ""])).toThrow(/run-id/i);
    });

    it("rejects duplicate flags", () => {
      expect(() =>
        parseCertifyCliArgs([...standardArgs, "--gpu-index", "0", "--gpu-index", "1"])
      ).toThrow(/duplicate flag/i);
    });

    it("rejects unknown flags", () => {
      expect(() => parseCertifyCliArgs([...standardArgs, "--unrecognized-flag"])).toThrow(
        /unknown flag/i
      );
    });

    it("rejects positional arguments", () => {
      expect(() => parseCertifyCliArgs([...standardArgs, "extra-positional-arg"])).toThrow(
        /unexpected argument/i
      );
    });

    it("rejects flags missing values", () => {
      expect(() => parseCertifyCliArgs(["--comfyui-dir", "/comfy", "--comfyui-url"])).toThrow(
        /requires a value/i
      );
    });
  });

  describe("Help and usage output", () => {
    it("prints usage documentation for all required and optional flags on --help and exits 0", async () => {
      const io = createMockIo();
      const deps = createStandardDependencies();

      const exitCode = await runCertificationCli(["--help"], io, deps);

      expect(exitCode).toBe(0);
      const text = io.stdoutLines.join("\n");
      expect(text).toContain("--comfyui-dir");
      expect(text).toContain("--comfyui-url");
      expect(text).toContain("--comfyui-pid");
      expect(text).toContain("--gold-master-provenance");
      expect(text).toContain("--run-id");
      expect(text).toContain("--profile");
      expect(text).toContain("--manifest");
      expect(text).toContain("--gpu-index");
      expect(text).toContain("--output-root");
      expect(text).toContain("--highvram");
      expect(text).toContain("--help");

      // No hardware queries or side effects on help
      expect(deps.loadCertificationProfile).not.toHaveBeenCalled();
      expect(deps.collectRunnerEnvironment).not.toHaveBeenCalled();
    });
  });

  describe("Package scripts and configuration", () => {
    it("render-worker package.json exposes certify, certify:ltx, and certify:flux with tsx entrypoint", async () => {
      const packageJsonPath = resolve(
        fileURLToPath(new URL("../../package.json", import.meta.url))
      );
      const content = await readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.scripts).toBeDefined();
      expect(parsed.scripts["certify"]).toBe("tsx src/cli/certify.ts");
      expect(parsed.scripts["certify:ltx"]).toBe(
        "tsx src/cli/certify.ts --profile ltx-25-720p-97f"
      );
      expect(parsed.scripts["certify:flux"]).toBe(
        "tsx src/cli/certify.ts --profile flux-schnell-draft"
      );
    });

    it("root package.json exposes certify, certify:ltx, and certify:flux filter commands", async () => {
      const rootPackageJsonPath = resolve(
        fileURLToPath(new URL("../../../../package.json", import.meta.url))
      );
      const content = await readFile(rootPackageJsonPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.scripts).toBeDefined();
      expect(parsed.scripts["certify"]).toBe("pnpm --filter render-worker certify");
      expect(parsed.scripts["certify:ltx"]).toBe("pnpm --filter render-worker certify:ltx");
      expect(parsed.scripts["certify:flux"]).toBe("pnpm --filter render-worker certify:flux");
    });
  });

  describe("Multi-Engine Profile Execution", () => {
    it("executes certification run successfully for LTX profile", async () => {
      const stdout = vi.fn();
      const stderr = vi.fn();
      const writeCertificationArtifacts = vi.fn().mockResolvedValue({
        runId: "run-001",
        outputDirectory: "/test/certification/ltx-25/run-001",
        resultJsonPath: "/test/certification/ltx-25/run-001/result.json",
        summaryMdPath: "/test/certification/ltx-25/run-001/summary.md",
        relativeOutputDirectory: "certification/ltx-25/run-001",
        relativeResultJsonPath: "certification/ltx-25/run-001/result.json",
        relativeSummaryMdPath: "certification/ltx-25/run-001/summary.md",
        artifact: mockPassedArtifact
      });

      const deps = createStandardDependencies({
        writeCertificationArtifacts,
        loadCertificationProfile: vi.fn().mockResolvedValue(mockLtxProfile)
      });

      const exitCode = await runCertificationCli(standardArgs, { stdout, stderr }, deps);

      expect(exitCode).toBe(0);
      expect(writeCertificationArtifacts).toHaveBeenCalled();
    });

    it("executes certification run successfully for FLUX profile", async () => {
      const stdout = vi.fn();
      const stderr = vi.fn();

      const fluxArtifact: CertificationArtifact = {
        ...mockPassedArtifact,
        runId: "flux-schnell-cert-run-001",
        identity: {
          profileId: "flux-schnell-draft",
          renderProfileKey: "FLUX_SCHNELL_DRAFT_V1",
          renderProfileVersion: 1,
          engine: "flux_schnell",
          width: 1024,
          height: 1024,
          frames: 1,
          steps: 4,
          workflowSha256: "a".repeat(64),
          modelSha256: {
            "models/diffusion_models/flux1-schnell.safetensors": "b".repeat(64)
          },
          comfyUiCommit: "e".repeat(40),
          customNodes: []
        }
      };

      const writeCertificationArtifacts = vi.fn().mockResolvedValue({
        runId: "flux-schnell-cert-run-001",
        outputDirectory: "/test/certification/flux-schnell/flux-schnell-cert-run-001",
        resultJsonPath: "/test/certification/flux-schnell/flux-schnell-cert-run-001/result.json",
        summaryMdPath: "/test/certification/flux-schnell/flux-schnell-cert-run-001/summary.md",
        relativeOutputDirectory: "certification/flux-schnell/flux-schnell-cert-run-001",
        relativeResultJsonPath: "certification/flux-schnell/flux-schnell-cert-run-001/result.json",
        relativeSummaryMdPath: "certification/flux-schnell/flux-schnell-cert-run-001/summary.md",
        artifact: fluxArtifact
      });

      const deps = createStandardDependencies({
        loadCertificationProfile: vi.fn().mockResolvedValue(mockFluxProfile),
        runCertification: vi.fn().mockResolvedValue(fluxArtifact),
        writeCertificationArtifacts
      });

      const exitCode = await runCertificationCli(
        [
          "--comfyui-dir=/comfy",
          "--comfyui-url=http://127.0.0.1:8188",
          "--comfyui-pid=12345",
          "--gold-master-provenance=/gold.json",
          "--profile=flux-schnell-draft",
          "--run-id=flux-schnell-cert-run-001"
        ],
        { stdout, stderr },
        deps
      );

      expect(exitCode).toBe(0);
      expect(writeCertificationArtifacts).toHaveBeenCalled();
    });
  });
});
