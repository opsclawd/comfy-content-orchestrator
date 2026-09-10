import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelFileHash } from "./hasher.js";
import { DiskPreflightError, type DiskPreflightResult } from "./preflight.js";
import type { GitProvenance } from "./git-tracker.js";
import type { CertificationProfile } from "./profile-manifest.js";
import {
  collectCertificationProvenance,
  type ProvenanceProgress,
  type ProvenanceCollectorDependencies
} from "./collector.js";

describe("Certification Provenance Collector", () => {
  let tempDir: string;

  const createMockLtxProfile = (
    overrides?: Partial<CertificationProfile>
  ): CertificationProfile => ({
    id: "ltx_25_720p_97f",
    engine: "comfyui",
    workflowPath: "/manifests/ltx_25_720p_97f_api.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: "a".repeat(64),
    source: {
      kind: "official_upstream",
      uri: "https://github.com/Comfy-Org/ComfyUI_examples/tree/master/ltx_video",
      revision: "main",
      license: "Apache-2.0"
    },
    baseline: {
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    },
    minFreeDiskGb: 100,
    runnerProfile: "dynamicvram-offload-v1",
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-video-2b-v0.9.1.safetensors"
      }
    ],
    assertions: [
      {
        nodeId: "6",
        classType: "CLIPTextEncode",
        input: "text",
        equals: "prompt text"
      }
    ],
    renderProfileIdentity: {
      key: "LTX_25_720P_5S_V1",
      version: 1
    },
    ...overrides
  });

  const createMockFluxProfile = (
    overrides?: Partial<CertificationProfile>
  ): CertificationProfile => ({
    id: "flux_schnell_draft",
    engine: "comfyui",
    workflowPath: "/manifests/flux_schnell_draft_api.json",
    workflowRelativePath: "flux_schnell_draft_api.json",
    expectedWorkflowHash: "b".repeat(64),
    source: {
      kind: "validated_host_export",
      uri: "file:///opt/comfyui/workflows/flux_schnell.json",
      revision: "host-export-v1",
      license: "Apache-2.0"
    },
    baseline: {
      steps: 4
    },
    minFreeDiskGb: 0,
    runnerProfile: "dynamicvram-offload-v1",
    models: [
      {
        category: "checkpoints",
        relativePath: "flux1-schnell.safetensors"
      }
    ],
    assertions: [
      {
        nodeId: "1",
        classType: "KSampler",
        input: "steps",
        equals: 4
      }
    ],
    renderProfileIdentity: null,
    ...overrides
  });

  const createMockLtxI2vProfile = (
    overrides?: Partial<CertificationProfile>
  ): CertificationProfile => ({
    id: "ltx-25-720p-97f-i2v",
    engine: "ltx_25_i2v",
    workflowPath: "/manifests/ltx_25_720p_i2v_97f_api.json",
    workflowRelativePath: "ltx_25_720p_i2v_97f_api.json",
    expectedWorkflowHash: "e0b417a3c3b5dc91ed417891789795c6a56e602d39c80eed7e1253a2ea41baab",
    source: {
      kind: "authored_from_spec",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    },
    baseline: {
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    },
    minFreeDiskGb: 100,
    runnerProfile: "dynamicvram-offload-v1",
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
      },
      {
        category: "clip",
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
      },
      {
        category: "vae",
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors"
      }
    ],
    assertions: [
      {
        nodeId: "21",
        classType: "ImageScale",
        input: "crop",
        equals: "center"
      }
    ],
    renderProfileIdentity: {
      key: "LTX_25_720P_5S_I2V_V1",
      version: 1
    },
    ...overrides
  });

  const createMockDiskResult = (overrides?: Partial<DiskPreflightResult>): DiskPreflightResult =>
    Object.freeze({
      modelFootprintBytes: 68_800_000_000,
      availableBytes: 150_000_000_000,
      requiredFreeBytes: 100_000_000_000,
      modelFootprintGb: 68.8,
      availableGb: 150.0,
      minFreeDiskGb: 100,
      passes: true,
      ...overrides
    });

  const createMockGitResult = (overrides?: Partial<GitProvenance>): GitProvenance =>
    Object.freeze({
      comfyUiCommit: "1234567890abcdef1234567890abcdef12345678",
      customNodes: Object.freeze([
        Object.freeze({
          name: "ComfyUI-Manager",
          commit: "abcdef1234567890abcdef1234567890abcdef12",
          status: "tracked"
        })
      ]),
      ...overrides
    });

  const createMockModelHashes = (): readonly ModelFileHash[] =>
    Object.freeze([
      Object.freeze({
        category: "diffusion_models",
        relativePath: "ltx-video-2b-v0.9.1.safetensors",
        key: "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors",
        bytes: 68_800_000_000,
        sha256: "c".repeat(64)
      })
    ]);

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "collector-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("collector runs preflight before hashing any large file", async () => {
    const callOrder: string[] = [];
    const progressEvents: ProvenanceProgress[] = [];

    const mockPreflightResult = createMockDiskResult({
      availableBytes: 50_000_000_000,
      availableGb: 50,
      passes: false
    });

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => {
        callOrder.push("runDiskPreflight");
        throw new DiskPreflightError(mockPreflightResult);
      }),
      collectGitProvenance: vi.fn(async () => {
        callOrder.push("collectGitProvenance");
        return createMockGitResult();
      }),
      readWorkflowFile: vi.fn(async () => {
        callOrder.push("readWorkflowFile");
        return '{"nodes": []}';
      }),
      hashWorkflow: vi.fn(() => {
        callOrder.push("hashWorkflow");
        return "a".repeat(64);
      }),
      hashModelFiles: vi.fn(async () => {
        callOrder.push("hashModelFiles");
        return createMockModelHashes();
      })
    };

    const profile = createMockLtxProfile();

    await expect(
      collectCertificationProvenance(
        {
          comfyUiDir: "/opt/ComfyUI",
          profile,
          onProgress: (ev) => progressEvents.push(ev)
        },
        dependencies
      )
    ).rejects.toThrow(DiskPreflightError);

    expect(callOrder).toEqual(["runDiskPreflight"]);
    expect(dependencies.runDiskPreflight).toHaveBeenCalledWith(
      "/opt/ComfyUI",
      profile.models,
      profile.minFreeDiskGb
    );
    expect(dependencies.collectGitProvenance).not.toHaveBeenCalled();
    expect(dependencies.readWorkflowFile).not.toHaveBeenCalled();
    expect(dependencies.hashWorkflow).not.toHaveBeenCalled();
    expect(dependencies.hashModelFiles).not.toHaveBeenCalled();
    expect(progressEvents).toEqual([{ phase: "preflight", status: "started" }]);
  });

  it("collector rejects workflow hash drift before model hashing", async () => {
    const callOrder: string[] = [];
    const progressEvents: ProvenanceProgress[] = [];

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => {
        callOrder.push("runDiskPreflight");
        return createMockDiskResult();
      }),
      collectGitProvenance: vi.fn(async () => {
        callOrder.push("collectGitProvenance");
        return createMockGitResult();
      }),
      readWorkflowFile: vi.fn(async () => {
        callOrder.push("readWorkflowFile");
        return '{"nodes": [{"id": 1}]}';
      }),
      hashWorkflow: vi.fn(() => {
        callOrder.push("hashWorkflow");
        // Returns drifted hash
        return "f".repeat(64);
      }),
      hashModelFiles: vi.fn(async () => {
        callOrder.push("hashModelFiles");
        return createMockModelHashes();
      })
    };

    const profile = createMockLtxProfile();

    await expect(
      collectCertificationProvenance(
        {
          comfyUiDir: "/opt/ComfyUI",
          profile,
          onProgress: (ev) => progressEvents.push(ev)
        },
        dependencies
      )
    ).rejects.toThrow(/workflow hash mismatch/i);

    expect(callOrder).toEqual([
      "runDiskPreflight",
      "collectGitProvenance",
      "readWorkflowFile",
      "hashWorkflow"
    ]);
    expect(dependencies.hashModelFiles).not.toHaveBeenCalled();
  });

  it("collector emits stable model keys and LTX RenderProfile provenance fields", async () => {
    const fixedDate = new Date("2026-08-15T12:00:00.000Z");
    const profile = createMockLtxProfile();
    const diskResult = createMockDiskResult();
    const gitResult = createMockGitResult();
    const modelHashes = createMockModelHashes();

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => diskResult),
      collectGitProvenance: vi.fn(async () => gitResult),
      readWorkflowFile: vi.fn(async () => '{"nodes": []}'),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async () => modelHashes)
    };

    const report = await collectCertificationProvenance(
      {
        comfyUiDir: "/opt/ComfyUI",
        profile,
        now: () => fixedDate
      },
      dependencies
    );

    expect(report).toEqual({
      version: 1,
      profileId: "ltx_25_720p_97f",
      generatedAt: "2026-08-15T12:00:00.000Z",
      workflow: {
        relativePath: "ltx_25_720p_97f_api.json",
        sha256: "a".repeat(64),
        source: {
          kind: "official_upstream",
          uri: "https://github.com/Comfy-Org/ComfyUI_examples/tree/master/ltx_video",
          revision: "main",
          license: "Apache-2.0"
        }
      },
      models: [
        {
          category: "diffusion_models",
          relativePath: "ltx-video-2b-v0.9.1.safetensors",
          key: "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors",
          bytes: 68_800_000_000,
          sha256: "c".repeat(64)
        }
      ],
      git: gitResult,
      disk: diskResult,
      renderProfileProvenance: {
        key: "LTX_25_720P_5S_V1",
        version: 1,
        engine: "comfyui",
        workflowHash: "a".repeat(64),
        modelHashes: {
          "models/diffusion_models/ltx-video-2b-v0.9.1.safetensors": "c".repeat(64)
        },
        frames: 97,
        steps: 8,
        runnerProfile: "dynamicvram-offload-v1",
        measuredDiskFootprintGb: 68.8,
        minFreeDiskGb: 100
      }
    });

    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.workflow)).toBe(true);
    expect(Object.isFrozen(report.models)).toBe(true);
    expect(Object.isFrozen(report.git)).toBe(true);
    expect(Object.isFrozen(report.disk)).toBe(true);
    expect(Object.isFrozen(report.renderProfileProvenance)).toBe(true);
    expect(Object.isFrozen(report.renderProfileProvenance?.modelHashes)).toBe(true);
  });

  it("collector maps baseline.frames directly without magic defaults", async () => {
    const profile = createMockLtxProfile({
      baseline: {
        width: 1280,
        height: 720,
        frames: 121,
        steps: 8
      }
    });

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => createMockDiskResult()),
      collectGitProvenance: vi.fn(async () => createMockGitResult()),
      readWorkflowFile: vi.fn(async () => '{"nodes": []}'),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async () => createMockModelHashes())
    };

    const report = await collectCertificationProvenance(
      {
        comfyUiDir: "/opt/ComfyUI",
        profile
      },
      dependencies
    );

    expect(report.renderProfileProvenance?.frames).toBe(121);
  });

  it("collector throws when renderProfileIdentity is set but baseline.frames is missing", async () => {
    const profile = createMockLtxProfile({
      baseline: {
        steps: 8
      }
    });

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => createMockDiskResult()),
      collectGitProvenance: vi.fn(async () => createMockGitResult()),
      readWorkflowFile: vi.fn(async () => '{"nodes": []}'),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async () => createMockModelHashes())
    };

    await expect(
      collectCertificationProvenance(
        {
          comfyUiDir: "/opt/ComfyUI",
          profile
        },
        dependencies
      )
    ).rejects.toThrow(
      /specifies renderProfileIdentity "LTX_25_720P_5S_V1" but baseline\.frames is missing/i
    );
  });

  it("collector preserves ComfyUI and non-Git custom-node evidence", async () => {
    const profile = createMockLtxProfile();
    const gitWithNonGitNodes: GitProvenance = {
      comfyUiCommit: "1111222233334444555566667777888899990000",
      customNodes: [
        {
          name: "custom-node-git",
          commit: "2222333344445555666677778888999900001111",
          status: "tracked"
        },
        {
          name: "custom-node-manual-copy",
          commit: null,
          status: "not_git"
        },
        {
          name: "custom-node-broken-git",
          commit: null,
          status: "unavailable"
        }
      ]
    };

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => createMockDiskResult()),
      collectGitProvenance: vi.fn(async () => gitWithNonGitNodes),
      readWorkflowFile: vi.fn(async () => "{}"),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async () => createMockModelHashes())
    };

    const report = await collectCertificationProvenance(
      {
        comfyUiDir: "/opt/ComfyUI",
        profile
      },
      dependencies
    );

    expect(report.git).toEqual(gitWithNonGitNodes);
    expect(report.git.customNodes).toHaveLength(3);
    expect(report.git.customNodes[1]).toEqual({
      name: "custom-node-manual-copy",
      commit: null,
      status: "not_git"
    });
    expect(report.git.customNodes[2]).toEqual({
      name: "custom-node-broken-git",
      commit: null,
      status: "unavailable"
    });
  });

  it("collector emits null RenderProfile provenance for FLUX without losing hashes", async () => {
    const profile = createMockFluxProfile();
    const fluxModelHashes: readonly ModelFileHash[] = [
      {
        category: "checkpoints",
        relativePath: "flux1-schnell.safetensors",
        key: "models/checkpoints/flux1-schnell.safetensors",
        bytes: 23_800_000_000,
        sha256: "d".repeat(64)
      }
    ];

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () =>
        createMockDiskResult({
          modelFootprintBytes: 23_800_000_000,
          modelFootprintGb: 23.8,
          minFreeDiskGb: 0,
          requiredFreeBytes: 0
        })
      ),
      collectGitProvenance: vi.fn(async () => createMockGitResult()),
      readWorkflowFile: vi.fn(async () => "{}"),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async () => fluxModelHashes)
    };

    const report = await collectCertificationProvenance(
      {
        comfyUiDir: "/opt/ComfyUI",
        profile
      },
      dependencies
    );

    expect(report.profileId).toBe("flux_schnell_draft");
    expect(report.renderProfileProvenance).toBeNull();
    expect(report.workflow.sha256).toBe("b".repeat(64));
    expect(report.models).toEqual(fluxModelHashes);
  });

  it("collector reports progress in deterministic phase order", async () => {
    const progressEvents: ProvenanceProgress[] = [];
    const profile = createMockLtxProfile({
      models: [
        { category: "diffusion_models", relativePath: "m1.safetensors" },
        { category: "clip", relativePath: "m2.safetensors" }
      ]
    });

    const modelHashes: readonly ModelFileHash[] = [
      {
        category: "diffusion_models",
        relativePath: "m1.safetensors",
        key: "models/diffusion_models/m1.safetensors",
        bytes: 1000,
        sha256: "1".repeat(64)
      },
      {
        category: "clip",
        relativePath: "m2.safetensors",
        key: "models/clip/m2.safetensors",
        bytes: 2000,
        sha256: "2".repeat(64)
      }
    ];

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => createMockDiskResult()),
      collectGitProvenance: vi.fn(async () => createMockGitResult()),
      readWorkflowFile: vi.fn(async () => "{}"),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async (_dir, _specs, onProgress) => {
        onProgress?.({ status: "started", key: "models/diffusion_models/m1.safetensors" });
        onProgress?.({ status: "completed", key: "models/diffusion_models/m1.safetensors" });
        onProgress?.({ status: "started", key: "models/clip/m2.safetensors" });
        onProgress?.({ status: "completed", key: "models/clip/m2.safetensors" });
        return modelHashes;
      })
    };

    await collectCertificationProvenance(
      {
        comfyUiDir: "/opt/ComfyUI",
        profile,
        onProgress: (event) => progressEvents.push(event)
      },
      dependencies
    );

    expect(progressEvents).toEqual([
      { phase: "preflight", status: "started" },
      { phase: "preflight", status: "completed" },
      { phase: "git", status: "started" },
      { phase: "git", status: "completed" },
      { phase: "workflow_hash", status: "started" },
      { phase: "workflow_hash", status: "completed" },
      { phase: "model_hash", status: "started" },
      {
        phase: "model_hash",
        status: "started",
        detail: "models/diffusion_models/m1.safetensors"
      },
      {
        phase: "model_hash",
        status: "completed",
        detail: "models/diffusion_models/m1.safetensors"
      },
      {
        phase: "model_hash",
        status: "started",
        detail: "models/clip/m2.safetensors"
      },
      {
        phase: "model_hash",
        status: "completed",
        detail: "models/clip/m2.safetensors"
      },
      { phase: "model_hash", status: "completed" }
    ]);
  });

  it("collector works with real default dependencies on a small test environment", async () => {
    // Setup real minimal ComfyUI directory
    const comfyUiDir = join(tempDir, "ComfyUI");
    await mkdir(join(comfyUiDir, "models", "diffusion_models"), { recursive: true });
    await mkdir(join(comfyUiDir, ".git"), { recursive: true });

    const modelPath = join(comfyUiDir, "models", "diffusion_models", "test.safetensors");
    await writeFile(modelPath, "model-content");

    const workflowPath = join(tempDir, "workflow.json");
    const workflowContent = JSON.stringify({ "1": { class_type: "KSampler" } });
    await writeFile(workflowPath, workflowContent);

    // Profile targeting these files
    const profile: CertificationProfile = {
      id: "test_profile",
      engine: "comfyui",
      workflowPath,
      workflowRelativePath: "workflow.json",
      expectedWorkflowHash: "4be7e459f85fb6cd9d2a7d855954c74e825171b1687743a0945ae16768a8d067", // Hash of canonicalized {"1":{"class_type":"KSampler"}}
      source: {
        kind: "official_upstream",
        uri: "https://example.com",
        revision: "v1",
        license: "MIT"
      },
      baseline: {
        steps: 8,
        frames: 97
      },
      minFreeDiskGb: 0,
      runnerProfile: "dynamicvram-offload-v1",
      models: [
        {
          category: "diffusion_models",
          relativePath: "test.safetensors"
        }
      ],
      assertions: [
        {
          nodeId: "1",
          classType: "KSampler",
          input: "steps",
          equals: 8
        }
      ],
      renderProfileIdentity: {
        key: "LTX_25_720P_5S_V1",
        version: 1
      }
    };

    const report = await collectCertificationProvenance(
      {
        comfyUiDir,
        profile
      },
      {
        collectGitProvenance: async () => createMockGitResult()
      }
    );

    expect(report.profileId).toBe("test_profile");
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.key).toBe("models/diffusion_models/test.safetensors");
    expect(report.models[0]?.bytes).toBe(13);
    expect(
      report.renderProfileProvenance?.modelHashes["models/diffusion_models/test.safetensors"]
    ).toBe(report.models[0]?.sha256);
  });

  it("collector collects provenance and constructs RenderProfileProvenance for LTX I2V profile", async () => {
    const fixedDate = new Date("2026-09-01T12:00:00.000Z");
    const profile = createMockLtxI2vProfile();
    const diskResult = createMockDiskResult();
    const gitResult = createMockGitResult();
    const modelHashes: readonly ModelFileHash[] = Object.freeze([
      Object.freeze({
        category: "diffusion_models",
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        key: "models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        bytes: 22_000_000_000,
        sha256: "c".repeat(64)
      }),
      Object.freeze({
        category: "clip",
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        key: "models/clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        bytes: 12_000_000_000,
        sha256: "d".repeat(64)
      }),
      Object.freeze({
        category: "vae",
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors",
        key: "models/vae/ltx-2.5-video-vae-conv-bf16.safetensors",
        bytes: 200_000_000,
        sha256: "e".repeat(64)
      })
    ]);

    const dependencies: ProvenanceCollectorDependencies = {
      runDiskPreflight: vi.fn(async () => diskResult),
      collectGitProvenance: vi.fn(async () => gitResult),
      readWorkflowFile: vi.fn(async () => '{"nodes": []}'),
      hashWorkflow: vi.fn(() => profile.expectedWorkflowHash),
      hashModelFiles: vi.fn(async () => modelHashes)
    };

    const report = await collectCertificationProvenance(
      {
        comfyUiDir: "/opt/ComfyUI",
        profile,
        now: () => fixedDate
      },
      dependencies
    );

    expect(report.profileId).toBe("ltx-25-720p-97f-i2v");
    expect(report.renderProfileProvenance).not.toBeNull();
    expect(report.renderProfileProvenance?.key).toBe("LTX_25_720P_5S_I2V_V1");
    expect(report.renderProfileProvenance?.engine).toBe("ltx_25_i2v");
    expect(report.renderProfileProvenance?.version).toBe(1);
    expect(report.renderProfileProvenance?.frames).toBe(97);
    expect(report.renderProfileProvenance?.steps).toBe(8);
    expect(report.renderProfileProvenance?.workflowHash).toBe(profile.expectedWorkflowHash);
    expect(report.workflow.source.kind).toBe("authored_from_spec");
  });
});
