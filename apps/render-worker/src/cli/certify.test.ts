import { describe, expect, it, vi } from "vitest";
import type { CertificationEnvironment, CertificationArtifact } from "@cco/contracts";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import {
  parseCertifyCliArgs,
  runCertificationCli,
  type CertifyCliDependencies
} from "./certify.js";

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
    assertions: Object.freeze([]),
    renderProfileIdentity: Object.freeze({
      key: "FLUX_SCHNELL_DRAFT_V1" as const,
      version: 1 as const
    })
  });

  const mockApprovedProvenance: CertificationProvenanceReport = Object.freeze({
    version: 1,
    profileId: "ltx-25-720p-97f",
    generatedAt: "2026-08-15T20:00:00.000Z",
    workflow: {
      relativePath: "ltx_25_720p_97f_api.json",
      sha256: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      source: {
        kind: "official_upstream" as const,
        uri: "https://github.com/Lightricks/LTX-2",
        revision: "main",
        license: "LTX-2 Community License"
      }
    },
    models: [
      {
        category: "diffusion_models" as const,
        relativePath: "ltx-video-2b-v0.9.1.safetensors",
        key: "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors",
        bytes: 1000,
        sha256: "b".repeat(64)
      },
      {
        category: "clip" as const,
        relativePath: "t5xxl_fp16.safetensors",
        key: "models/clip/t5xxl_fp16.safetensors",
        bytes: 1000,
        sha256: "c".repeat(64)
      },
      {
        category: "vae" as const,
        relativePath: "ltx-video-vae.safetensors",
        key: "models/vae/ltx-video-vae.safetensors",
        bytes: 1000,
        sha256: "d".repeat(64)
      }
    ],
    git: {
      comfyUiCommit: "e".repeat(40),
      customNodes: [
        {
          name: "ComfyUI-LTXVideo",
          commit: "f".repeat(40),
          status: "tracked" as const
        }
      ]
    },
    disk: {
      modelFootprintBytes: 3000,
      availableBytes: 500000000000,
      requiredFreeBytes: 107374182400,
      modelFootprintGb: 0.000003,
      availableGb: 500,
      minFreeDiskGb: 100,
      passes: true
    },
    renderProfileProvenance: {
      key: "LTX_25_720P_5S_V1" as const,
      version: 1 as const,
      engine: "ltx_25",
      workflowHash: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      modelHashes: {
        "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors": "b".repeat(64),
        "models/clip/t5xxl_fp16.safetensors": "c".repeat(64),
        "models/vae/ltx-video-vae.safetensors": "d".repeat(64)
      },
      frames: 97,
      steps: 8,
      runnerProfile: "dynamicvram-offload-v1",
      measuredDiskFootprintGb: 0.000003,
      minFreeDiskGb: 100
    }
  });

  const mockLiveProvenance: CertificationProvenanceReport = {
    ...mockApprovedProvenance
  };

  const mockEnvironment: CertificationEnvironment = {
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
  };

  const mockWorkflowJson = JSON.stringify({ "1": { class_type: "KSampler", inputs: {} } });

  const validArtifactResult: CertificationArtifact = {
    version: 1,
    runId: "trinidad-rtx4090-dynamicvram-v1",
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
      workflowSha256: "e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a",
      modelSha256: {
        "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors": "b".repeat(64),
        "models/clip/t5xxl_fp16.safetensors": "c".repeat(64),
        "models/vae/ltx-video-vae.safetensors": "d".repeat(64)
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
    environment: mockEnvironment,
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
          gpu: { totalVramMb: 24564, usedVramMb: 1024, freeVramMb: 23540, reservedVramMb: 0 },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 50000,
            hostRamUsedMb: 14000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 0,
            systemMinorPageFaults: 100,
            processPid: 12345,
            processStartTimeTicks: 5000,
            processRssMb: 1000,
            processMajorPageFaults: 0,
            processMinorPageFaults: 50
          }
        },
        {
          measuredAt: "2026-08-15T20:00:48.000Z",
          phase: "post_unload",
          gpu: { totalVramMb: 24564, usedVramMb: 1024, freeVramMb: 23540, reservedVramMb: 0 },
          host: {
            hostRamTotalMb: 64000,
            hostRamAvailableMb: 50000,
            hostRamUsedMb: 14000,
            swapTotalMb: 16000,
            swapUsedMb: 0,
            systemSwapInPages: 0,
            systemSwapOutPages: 0,
            systemMajorPageFaults: 0,
            systemMinorPageFaults: 100,
            processPid: 12345,
            processStartTimeTicks: 5000,
            processRssMb: 1000,
            processMajorPageFaults: 0,
            processMinorPageFaults: 50
          }
        }
      ],
      samplingErrors: [],
      peakVramMb: 24028,
      reservedVramMb: 0,
      peakHostRamUsedMb: 14000,
      peakProcessRssMb: 1000,
      swapUsedDeltaMb: 0,
      systemSwapInPageDelta: 0,
      systemSwapOutPageDelta: 0,
      systemMajorPageFaultDelta: 0,
      systemMinorPageFaultDelta: 100,
      processMajorPageFaultDelta: 0,
      processMinorPageFaultDelta: 50,
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

  it("parses CLI arguments correctly with default and custom --profile", () => {
    const validArgs = [
      "--comfyui-dir=/comfy",
      "--comfyui-url=http://127.0.0.1:8188",
      "--comfyui-pid=12345",
      "--gold-master-provenance=/gold.json"
    ];
    const parsedDefault = parseCertifyCliArgs(validArgs);
    expect(parsedDefault.kind).toBe("run");
    if (parsedDefault.kind === "run") {
      expect(parsedDefault.options.profileId).toBe("ltx-25-720p-97f");
    }

    const parsedFlux = parseCertifyCliArgs([...validArgs, "--profile=flux-schnell-draft"]);
    expect(parsedFlux.kind).toBe("run");
    if (parsedFlux.kind === "run") {
      expect(parsedFlux.options.profileId).toBe("flux-schnell-draft");
    }
  });

  it("executes certification run successfully for LTX profile", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const writeCertificationArtifacts = vi.fn().mockResolvedValue({
      runId: "trinidad-rtx4090-dynamicvram-v1",
      outputDirectory: "/test/certification/ltx-25/trinidad-rtx4090-dynamicvram-v1",
      resultJsonPath: "/test/certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json",
      summaryMdPath: "/test/certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md",
      relativeOutputDirectory: "certification/ltx-25/trinidad-rtx4090-dynamicvram-v1",
      relativeResultJsonPath: "certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json",
      relativeSummaryMdPath: "certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md",
      artifact: validArtifactResult
    });

    const deps: CertifyCliDependencies = {
      loadCertificationProfile: vi.fn().mockResolvedValue(mockLtxProfile),
      readApprovedProvenance: vi.fn().mockResolvedValue(mockApprovedProvenance),
      collectCertificationProvenance: vi.fn().mockResolvedValue(mockLiveProvenance),
      collectRunnerEnvironment: vi.fn().mockResolvedValue(mockEnvironment),
      verifyGoldMasterProvenance: vi.fn(),
      classifyCertificationHardware: vi.fn().mockReturnValue({ status: "supported", details: {} }),
      verifyComfyUiMemoryMode: vi.fn(),
      readWorkflowFile: vi.fn().mockResolvedValue(mockWorkflowJson),
      runCertification: vi.fn().mockResolvedValue(validArtifactResult),
      writeCertificationArtifacts,
      stdout,
      stderr
    };

    const exitCode = await runCertificationCli(
      [
        "--comfyui-dir=/comfy",
        "--comfyui-url=http://127.0.0.1:8188",
        "--comfyui-pid=12345",
        "--gold-master-provenance=/gold.json"
      ],
      deps
    );

    expect(exitCode).toBe(0);
    expect(writeCertificationArtifacts).toHaveBeenCalled();
  });

  it("executes certification run successfully for FLUX profile", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const fluxArtifact: CertificationArtifact = {
      ...validArtifactResult,
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

    const deps: CertifyCliDependencies = {
      loadCertificationProfile: vi.fn().mockResolvedValue(mockFluxProfile),
      readApprovedProvenance: vi.fn().mockResolvedValue(mockApprovedProvenance),
      collectCertificationProvenance: vi.fn().mockResolvedValue({
        ...mockLiveProvenance,
        profileId: "flux-schnell-draft"
      }),
      collectRunnerEnvironment: vi.fn().mockResolvedValue(mockEnvironment),
      verifyGoldMasterProvenance: vi.fn(),
      classifyCertificationHardware: vi.fn().mockReturnValue({ status: "supported", details: {} }),
      verifyComfyUiMemoryMode: vi.fn(),
      readWorkflowFile: vi.fn().mockResolvedValue(mockWorkflowJson),
      runCertification: vi.fn().mockResolvedValue(fluxArtifact),
      writeCertificationArtifacts,
      stdout,
      stderr
    };

    const exitCode = await runCertificationCli(
      [
        "--comfyui-dir=/comfy",
        "--comfyui-url=http://127.0.0.1:8188",
        "--comfyui-pid=12345",
        "--gold-master-provenance=/gold.json",
        "--profile=flux-schnell-draft"
      ],
      deps
    );

    expect(exitCode).toBe(0);
    expect(writeCertificationArtifacts).toHaveBeenCalled();
  });
});
