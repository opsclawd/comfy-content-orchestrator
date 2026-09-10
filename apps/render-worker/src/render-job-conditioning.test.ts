import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  type EnforceLicenseRouting,
  ExecuteProfileRenderUseCase,
  LicenseRoutingError,
  ResolveApprovedCandidateMediaUseCase,
  type GpuExecutionLeasePort,
  type GpuTelemetryPort,
  type HashBytesPort,
  type ObjectStoragePort,
  type SceneRepository,
  type StoryboardCandidateRepository,
  type StoredObject
} from "@cco/application";
import {
  Scene,
  type CampaignId,
  type CandidateId,
  type JobId,
  type LeaseToken,
  type RenderJob,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import {
  ComfyUiClient,
  ComfyUiRenderEngineAdapter,
  HttpComfyUiInputStagingAdapter,
  type CertificationProfile,
  type CertificationProvenanceReport
} from "@cco/infrastructure";
import { FakeComfyUiTransport } from "@cco/infrastructure/testing";
import {
  createCertifiedRenderJobExecutor,
  type AssembleProductionManifestInput,
  type ProductionManifestAssembler
} from "./render-job-executor.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface RecordedUpload {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly formType: string;
  readonly overwrite: string;
}

interface RecordedPrompt {
  readonly promptId: string;
  readonly workflow: Record<string, { class_type?: string; inputs: Record<string, unknown> }>;
  readonly clientId: string;
}

function setupRecordingComfyUiTransport(): {
  transport: FakeComfyUiTransport;
  recordedUploads: RecordedUpload[];
  recordedPrompts: RecordedPrompt[];
} {
  const transport = new FakeComfyUiTransport();
  const recordedUploads: RecordedUpload[] = [];
  const recordedPrompts: RecordedPrompt[] = [];
  let promptCounter = 0;

  transport.fakeFetch.setDefaultResponseHandler(async (input, init) => {
    const urlStr = String(input);
    if (urlStr.includes("/upload/image")) {
      const formData = init?.body as FormData;
      const file = formData.get("image") as File;
      const formType = String(formData.get("type") ?? "");
      const overwrite = String(formData.get("overwrite") ?? "");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filename = file.name;
      const contentType = file.type;

      recordedUploads.push({
        filename,
        bytes,
        contentType,
        formType,
        overwrite
      });

      return new Response(
        JSON.stringify({
          name: filename,
          subfolder: "conditioning",
          type: "input"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (urlStr.includes("/history/")) {
      const parts = urlStr.split("/");
      const promptId = parts[parts.length - 1] || "prompt-1";
      return new Response(
        JSON.stringify({
          [promptId]: {
            status: { completed: true, status_str: "success" },
            outputs: {
              "9": {
                images: [{ filename: "output.webp", type: "output", subfolder: "" }]
              }
            }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (urlStr.endsWith("/prompt") || urlStr.includes("/prompt?")) {
      promptCounter += 1;
      const promptId = `prompt-${promptCounter}`;
      const body = JSON.parse(init?.body as string);
      recordedPrompts.push({
        promptId,
        workflow: body.prompt,
        clientId: body.client_id
      });

      queueMicrotask(() => {
        const ws = transport.createdWebSockets[transport.createdWebSockets.length - 1];
        if (ws) {
          ws.message({
            type: "executing",
            data: { prompt_id: promptId, node: null }
          });
        }
      });

      return new Response(JSON.stringify({ prompt_id: promptId }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (urlStr.includes("/free")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });

  const origCreateWebSocket = transport.createWebSocket.bind(transport);
  transport.createWebSocket = (url: string) => {
    const ws = origCreateWebSocket(url);
    const origAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = (type, listener) => {
      origAddEventListener(type, listener);
      if (type === "message") {
        queueMicrotask(() => {
          ws.message({
            type: "status",
            data: { status: { exec_info: { queue_remaining: 0 } } }
          });
        });
      }
    };
    return ws;
  };

  return { transport, recordedUploads, recordedPrompts };
}

describe("End-to-End Conditioning Injection (Criterion 11 & Governance)", () => {
  it("proves changing only the approved candidate changes the actual image input submitted to ComfyUI and carries full provenance to manifest assembler", async () => {
    const realLtxI2vTemplatePath = resolve(
      DEFAULT_REPO_ROOT,
      "templates/ltx_25_720p_i2v_97f_api.json"
    );
    const realLtxI2vTemplateJson = await readFile(realLtxI2vTemplatePath, "utf8");
    const templateSha256 = createHash("sha256").update(realLtxI2vTemplateJson).digest("hex");

    const certifiedI2vProfile: CertificationProfile = {
      id: "ltx-25-720p-97f-i2v",
      engine: "ltx_25_i2v",
      workflowPath: realLtxI2vTemplatePath,
      workflowRelativePath: "ltx_25_720p_i2v_97f_api.json",
      expectedWorkflowHash: templateSha256,
      source: {
        kind: "validated_host_export",
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
      models: [],
      assertions: [],
      renderProfileIdentity: {
        key: "LTX_25_720P_5S_I2V_V1",
        version: 1
      }
    };

    const mockLiveProvenance: CertificationProvenanceReport = {
      version: 1,
      profileId: "ltx-25-720p-97f-i2v",
      generatedAt: "2026-09-09T00:00:00.000Z",
      models: [],
      disk: {
        modelFootprintBytes: 0,
        availableBytes: 100_000_000_000,
        requiredFreeBytes: 0,
        modelFootprintGb: 0,
        availableGb: 100,
        minFreeDiskGb: 100,
        passes: true
      },
      git: {
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNodes: []
      },
      workflow: {
        relativePath: "ltx_25_720p_i2v_97f_api.json",
        sha256: templateSha256,
        source: {
          kind: "validated_host_export",
          uri: "https://github.com/comfyanonymous/ComfyUI",
          revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          license: "GPL-3.0"
        }
      },
      renderProfileProvenance: {
        key: "LTX_25_720P_5S_I2V_V1",
        version: 1,
        engine: "ltx_25_i2v",
        workflowHash: templateSha256,
        frames: 97,
        steps: 8,
        runnerProfile: "dynamicvram-offload-v1",
        measuredDiskFootprintGb: 20,
        minFreeDiskGb: 100,
        modelHashes: {
          "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors": "a".repeat(64)
        }
      }
    };

    // Shared invariant semantics across both runs:
    // Candidate selection is the SOLE variable changed between Job A and Job B
    const fixedSceneId = "11111111-aaaa-4111-8111-111111111111" as SceneId;
    const fixedCampaignId = "camp-001" as CampaignId;
    const fixedSpecRevision = 1;
    const fixedPrompt = "A majestic golden sunset over mountain peaks";
    const fixedSeed = 12345;
    const fixedJobId = "job-exec-prod-001" as JobId;

    // Candidate A: 100 bytes of pattern 42
    const bytesA = new Uint8Array(100).fill(42);
    const sha256A = sha256Hex(bytesA);
    const candidateIdA = "cand-scene1-version1" as CandidateId;

    const candA: StoryboardCandidate = {
      id: candidateIdA,
      sceneId: fixedSceneId,
      specRevision: fixedSpecRevision,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${candidateIdA}.png`,
      contentHash: sha256A,
      generationMetadata: {},
      createdAt: "2026-09-09T10:00:00.000Z"
    };

    const sceneA = Scene.reconstitute({
      id: fixedSceneId,
      campaignId: fixedCampaignId,
      status: "rendering",
      specRevision: fixedSpecRevision,
      configuration: {
        prompt: fixedPrompt,
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_I2V_V1",
        durationMs: 5000
      },
      selectedCandidateId: candidateIdA,
      selectedCandidateRevision: fixedSpecRevision,
      approval: {
        revision: fixedSpecRevision,
        approvedBy: "reviewer-1",
        approvedAt: "2026-09-09T10:05:00.000Z"
      }
    });

    // Candidate B: 100 bytes of pattern 84
    const bytesB = new Uint8Array(100).fill(84);
    const sha256B = sha256Hex(bytesB);
    const candidateIdB = "cand-scene1-version2" as CandidateId;

    const candB: StoryboardCandidate = {
      id: candidateIdB,
      sceneId: fixedSceneId,
      specRevision: fixedSpecRevision,
      variantOrdinal: 2,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${candidateIdB}.png`,
      contentHash: sha256B,
      generationMetadata: {},
      createdAt: "2026-09-09T11:00:00.000Z"
    };

    const sceneB = Scene.reconstitute({
      id: fixedSceneId,
      campaignId: fixedCampaignId,
      status: "rendering",
      specRevision: fixedSpecRevision,
      configuration: {
        prompt: fixedPrompt,
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_I2V_V1",
        durationMs: 5000
      },
      selectedCandidateId: candidateIdB,
      selectedCandidateRevision: fixedSpecRevision,
      approval: {
        revision: fixedSpecRevision,
        approvedBy: "reviewer-1",
        approvedAt: "2026-09-09T11:05:00.000Z"
      }
    });

    // Storage containing both candidate images
    const storageMap = new Map<string, StoredObject>([
      [
        `godzspeed-review:candidates/${candidateIdA}.png`,
        {
          bucket: "godzspeed-review",
          key: `candidates/${candidateIdA}.png`,
          body: bytesA,
          contentType: "image/png"
        }
      ],
      [
        `godzspeed-review:candidates/${candidateIdB}.png`,
        {
          bucket: "godzspeed-review",
          key: `candidates/${candidateIdB}.png`,
          body: bytesB,
          contentType: "image/png"
        }
      ]
    ]);

    const objectStorage: ObjectStoragePort = {
      getObject: async (locator) => storageMap.get(`${locator.bucket}:${locator.key}`),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };

    let currentScene = sceneA;
    const sceneRepository: SceneRepository = {
      findById: async (id) => (id === fixedSceneId ? currentScene : undefined),
      save: async () => {}
    };

    const storyboardCandidateRepository: StoryboardCandidateRepository = {
      findById: async (id) => {
        if (id === candidateIdA) return candA;
        if (id === candidateIdB) return candB;
        return undefined;
      },
      insert: async () => {},
      listBySceneAndRevision: async (sceneId, rev) => {
        if (sceneId === fixedSceneId && rev === fixedSpecRevision) {
          return [candA, candB];
        }
        return [];
      }
    };

    const hashBytesPort: HashBytesPort = {
      hashBytes: async (b) => sha256Hex(b)
    };

    // Real candidate resolver from #223
    const resolveApprovedCandidateMedia = new ResolveApprovedCandidateMediaUseCase({
      sceneRepository,
      storyboardCandidateRepository,
      objectStorage,
      hashBytes: hashBytesPort
    });

    // Real ComfyUI transport, client, stager, and render engine
    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const unlinkSpy = vi.fn().mockResolvedValue(undefined);
    const stageReferenceImage = new HttpComfyUiInputStagingAdapter({
      client,
      comfyUiDir: "/tmp/fake-comfyui",
      unlinkFn: unlinkSpy
    });

    const renderEngine = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport
    });

    const fakeGpuLease = {
      acquireLease: async () => ({
        holder: {
          version: 1 as const,
          pid: 1234,
          startedAt: new Date().toISOString(),
          hostname: "test-host",
          leaseId: "lease-1"
        },
        release: async () => {}
      })
    };

    const fakeGpuTelemetry: GpuTelemetryPort = {
      readMemory: async () => ({
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      })
    };

    const mockEnforceLicenseRouting = {
      enforce: vi.fn().mockReturnValue(undefined)
    };

    const useCase = new ExecuteProfileRenderUseCase(
      renderEngine,
      fakeGpuLease,
      fakeGpuTelemetry,
      mockEnforceLicenseRouting as unknown as EnforceLicenseRouting
    );

    // Track assemble manifest calls
    const assembledInputs: AssembleProductionManifestInput[] = [];

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: async (input) => {
        assembledInputs.push(input);
        return {
          manifestId: `manifest-${input.job.jobId}`,
          ok: true
        };
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => certifiedI2vProfile,
      readApprovedProvenance: async () => mockLiveProvenance,
      collectCertificationProvenance: async () => mockLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => realLtxI2vTemplateJson,
      hashWorkflow: () => templateSha256,
      useCase,
      outputReader: {
        readOutput: async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/webp"
        })
      },
      resolveApprovedCandidateMedia,
      objectStorage,
      stageReferenceImage,
      productionManifestAssembler: mockAssembler,
      hashBytes: hashBytesPort
    });

    // Job A: Uses candidate A
    const jobA: RenderJob = {
      jobId: fixedJobId,
      sceneId: fixedSceneId,
      jobKind: "production",
      workflowTemplate: "ltx-25-720p-97f-i2v",
      status: "rendering",
      leaseToken: "lease-prod-001" as LeaseToken,
      workerId: "worker-1",
      leaseExpiresAt: new Date("2026-09-09T12:00:00.000Z"),
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      injectedPayload: {
        prompt: fixedPrompt,
        seed: fixedSeed,
        approvedCandidateId: candidateIdA
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Job B: Same scene, same job ID, same prompt, same seed, differing ONLY in candidate B
    const jobB: RenderJob = {
      jobId: fixedJobId,
      sceneId: fixedSceneId,
      jobKind: "production",
      workflowTemplate: "ltx-25-720p-97f-i2v",
      status: "rendering",
      leaseToken: "lease-prod-001" as LeaseToken,
      workerId: "worker-1",
      leaseExpiresAt: new Date("2026-09-09T12:00:00.000Z"),
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      injectedPayload: {
        prompt: fixedPrompt,
        seed: fixedSeed,
        approvedCandidateId: candidateIdB
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Execute Job A
    currentScene = sceneA;
    const resultA = await executor(jobA);
    expect(resultA.manifestPayload).toBeDefined();

    // Execute Job B
    currentScene = sceneB;
    const resultB = await executor(jobB);
    expect(resultB.manifestPayload).toBeDefined();

    // Verification 1: /upload/image was called twice over the real ComfyUiClient boundary
    // Assert multipart form data contains the exact candidate bytes and deterministic filename
    expect(recordedUploads).toHaveLength(2);
    const uploadA = recordedUploads[0]!;
    const uploadB = recordedUploads[1]!;

    expect(uploadA.bytes).toEqual(bytesA);
    expect(uploadB.bytes).toEqual(bytesB);
    expect(uploadA.formType).toBe("input");
    expect(uploadB.formType).toBe("input");
    expect(uploadA.overwrite).toBe("true");
    expect(uploadB.overwrite).toBe("true");

    // Filenames include candidate hash slice and are deterministic
    expect(uploadA.filename).toContain(sha256A.slice(0, 16));
    expect(uploadB.filename).toContain(sha256B.slice(0, 16));
    expect(uploadA.filename).not.toEqual(uploadB.filename);

    // Verification 2: /prompt was called twice with the mutated workflow submitted to ComfyUI
    expect(recordedPrompts).toHaveLength(2);
    const promptA = recordedPrompts[0]!;
    const promptB = recordedPrompts[1]!;

    const node20A = promptA.workflow["20"];
    const node20B = promptB.workflow["20"];
    expect(node20A).toBeDefined();
    expect(node20B).toBeDefined();
    expect(node20A!.class_type).toBe("LoadImage");
    expect(node20B!.class_type).toBe("LoadImage");

    // CRITICAL: Changing ONLY the candidate changes the actual image input submitted to ComfyUI!
    expect(node20A!.inputs.image).toBe(`conditioning/${uploadA.filename}`);
    expect(node20B!.inputs.image).toBe(`conditioning/${uploadB.filename}`);
    expect(node20A!.inputs.image).not.toEqual(node20B!.inputs.image);

    // Assert that other workflow nodes are completely unchanged between Run A and Run B
    // Prompts are identical
    expect(promptA.workflow["3"]!.inputs.text).toBe(fixedPrompt);
    expect(promptB.workflow["3"]!.inputs.text).toBe(fixedPrompt);
    // Seeds are identical
    expect(promptA.workflow["1"]!.inputs.seed).toBe(fixedSeed);
    expect(promptB.workflow["1"]!.inputs.seed).toBe(fixedSeed);

    // Verification 3: Lossless provenance carried forward to manifest assembler
    expect(assembledInputs).toHaveLength(2);
    const manifestInputA = assembledInputs[0]!;
    const manifestInputB = assembledInputs[1]!;

    expect(manifestInputA.conditioningImage).toEqual({
      resolved: {
        input: {
          candidateId: candidateIdA,
          sceneId: fixedSceneId,
          specRevision: fixedSpecRevision,
          contentHashSha256: sha256A
        },
        media: {
          bucket: "godzspeed-review",
          key: `candidates/${candidateIdA}.png`,
          sha256: sha256A,
          contentType: "image/png"
        }
      },
      stagedAs: {
        name: uploadA.filename,
        subfolder: "conditioning"
      },
      injectionTarget: {
        nodeId: "20",
        classType: "LoadImage",
        inputField: "image"
      }
    });

    expect(manifestInputB.conditioningImage).toEqual({
      resolved: {
        input: {
          candidateId: candidateIdB,
          sceneId: fixedSceneId,
          specRevision: fixedSpecRevision,
          contentHashSha256: sha256B
        },
        media: {
          bucket: "godzspeed-review",
          key: `candidates/${candidateIdB}.png`,
          sha256: sha256B,
          contentType: "image/png"
        }
      },
      stagedAs: {
        name: uploadB.filename,
        subfolder: "conditioning"
      },
      injectionTarget: {
        nodeId: "20",
        classType: "LoadImage",
        inputField: "image"
      }
    });

    // Verification 4: Cleanups occurred for both staged files in ComfyUI input directory
    expect(unlinkSpy).toHaveBeenCalledWith(
      `/tmp/fake-comfyui/input/conditioning/${uploadA.filename}`
    );
    expect(unlinkSpy).toHaveBeenCalledWith(
      `/tmp/fake-comfyui/input/conditioning/${uploadB.filename}`
    );
  });

  it("fails closed with zero external I/O when profile license is denied by license routing guard (Finding F-864bb299)", async () => {
    const realLtxI2vTemplatePath = resolve(
      DEFAULT_REPO_ROOT,
      "templates/ltx_25_720p_i2v_97f_api.json"
    );
    const realLtxI2vTemplateJson = await readFile(realLtxI2vTemplatePath, "utf8");
    const templateSha256 = createHash("sha256").update(realLtxI2vTemplateJson).digest("hex");

    const certifiedI2vProfile: CertificationProfile = {
      id: "ltx-25-720p-97f-i2v",
      engine: "ltx_25_i2v",
      workflowPath: realLtxI2vTemplatePath,
      workflowRelativePath: "ltx_25_720p_i2v_97f_api.json",
      expectedWorkflowHash: templateSha256,
      source: {
        kind: "validated_host_export",
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
      models: [],
      assertions: [],
      renderProfileIdentity: {
        key: "LTX_25_720P_5S_I2V_V1",
        version: 1
      }
    };

    const mockLiveProvenance: CertificationProvenanceReport = {
      version: 1,
      profileId: "ltx-25-720p-97f-i2v",
      generatedAt: "2026-09-09T00:00:00.000Z",
      models: [],
      disk: {
        modelFootprintBytes: 0,
        availableBytes: 100_000_000_000,
        requiredFreeBytes: 0,
        modelFootprintGb: 0,
        availableGb: 100,
        minFreeDiskGb: 100,
        passes: true
      },
      git: {
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNodes: []
      },
      workflow: {
        relativePath: "ltx_25_720p_i2v_97f_api.json",
        sha256: templateSha256,
        source: {
          kind: "validated_host_export",
          uri: "https://github.com/comfyanonymous/ComfyUI",
          revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          license: "GPL-3.0"
        }
      },
      renderProfileProvenance: {
        key: "LTX_25_720P_5S_I2V_V1",
        version: 1,
        engine: "ltx_25_i2v",
        workflowHash: templateSha256,
        frames: 97,
        steps: 8,
        runnerProfile: "dynamicvram-offload-v1",
        measuredDiskFootprintGb: 20,
        minFreeDiskGb: 100,
        modelHashes: {}
      }
    };

    const mockResolveApprovedCandidateMedia = {
      execute: vi.fn()
    };

    const mockObjectStorage: ObjectStoragePort = {
      getObject: vi.fn(),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };

    const { transport } = setupRecordingComfyUiTransport();
    const fetchSpy = vi.spyOn(transport.fakeFetch, "fetch");

    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const mockStagingAdapter = new HttpComfyUiInputStagingAdapter({
      client,
      comfyUiDir: "/tmp/fake-comfyui"
    });
    const stageSpy = vi.spyOn(mockStagingAdapter, "stage");

    const mockGpuLease: GpuExecutionLeasePort = {
      acquireLease: vi.fn()
    };

    const mockEnforceLicenseRouting = {
      enforce: vi.fn().mockImplementation(() => {
        throw new LicenseRoutingError(
          "Component LTX_25_720P_5S_I2V_V1 is not approved for production use",
          {
            registryRevision: "registry-v1",
            evaluatedComponents: [],
            deniedReasons: ["Unregistered profile key LTX_25_720P_5S_I2V_V1"]
          }
        );
      })
    };

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => certifiedI2vProfile,
      readApprovedProvenance: async () => mockLiveProvenance,
      collectCertificationProvenance: async () => mockLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => realLtxI2vTemplateJson,
      hashWorkflow: () => templateSha256,
      enforceLicenseRouting: mockEnforceLicenseRouting as unknown as EnforceLicenseRouting,
      resolveApprovedCandidateMedia: mockResolveApprovedCandidateMedia,
      objectStorage: mockObjectStorage,
      stageReferenceImage: mockStagingAdapter,
      executeProfileRender: vi.fn()
    });

    const job: RenderJob = {
      jobId: "job-denied-001" as JobId,
      sceneId: "scene-denied-001" as SceneId,
      jobKind: "production",
      workflowTemplate: "ltx-25-720p-97f-i2v",
      status: "rendering",
      leaseToken: "lease-denied" as LeaseToken,
      workerId: "worker-1",
      leaseExpiresAt: new Date("2026-09-09T12:00:00.000Z"),
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      injectedPayload: {
        prompt: "A prompt that should never be dispatched",
        seed: 42,
        approvedCandidateId: "cand-denied" as CandidateId
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Assert that execution rejects with LicenseRoutingError
    await expect(executor(job)).rejects.toThrow(LicenseRoutingError);

    // CRITICAL GOVERNANCE INVARIANT:
    // Zero external candidate resolver calls
    expect(mockResolveApprovedCandidateMedia.execute).not.toHaveBeenCalled();
    // Zero object-storage reads (protects against unauthorized data access / TOCTOU)
    expect(mockObjectStorage.getObject).not.toHaveBeenCalled();
    // Zero ComfyUI staging calls
    expect(stageSpy).not.toHaveBeenCalled();
    // Zero GPU lease acquisitions
    expect(mockGpuLease.acquireLease).not.toHaveBeenCalled();
    // Zero ComfyUI fetch calls (/upload/image, /prompt)
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
