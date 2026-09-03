import { describe, expect, it } from "vitest";
import {
  ExecuteProfileRenderUseCase,
  GpuLeaseUnavailableError,
  type GpuExecutionLeasePort,
  type GpuMemorySnapshot,
  type GpuTelemetryPort,
  type RenderEnginePort,
  type RenderLease,
  type RenderQueueReceipt,
  type RenderResult,
  type RenderWorkflow
} from "@cco/application";
import type { CertificationProfile, CertificationProvenanceReport } from "@cco/infrastructure";
import { PreflightError } from "../certification/preflight.js";
import { isDirectExecution, runRenderCli, type RenderCliDependencies } from "./render.js";

const HASH_FLUX = "a".repeat(64);
const HASH_LTX = "b".repeat(64);
const HASH_MODEL_1 = "c".repeat(64);
const HASH_MODEL_2 = "d".repeat(64);

const FLUX_WORKFLOW_JSON = JSON.stringify({
  "1": { class_type: "KSampler", inputs: { steps: 4 } }
});
const LTX_WORKFLOW_JSON = JSON.stringify({ "1": { class_type: "KSampler", inputs: { steps: 8 } } });

const GPU_SNAPSHOT: GpuMemorySnapshot = {
  totalVramMb: 24576,
  usedVramMb: 4096,
  freeVramMb: 20480,
  reservedVramMb: 512,
  measuredAt: "2026-08-16T00:00:00.000Z"
};

function createFluxProfile(overrides: Partial<CertificationProfile> = {}): CertificationProfile {
  return {
    id: "flux-schnell-draft",
    engine: "flux_schnell",
    workflowPath: "/comfy/workflows/flux.json",
    workflowRelativePath: "flux_schnell_draft_api.json",
    expectedWorkflowHash: HASH_FLUX,
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    },
    baseline: {
      width: 1024,
      height: 1024,
      steps: 4,
      frames: 1
    },
    minFreeDiskGb: 0,
    runnerProfile: "dynamicvram-offload-v1",
    models: [{ category: "diffusion_models", relativePath: "flux1-schnell.safetensors" }],
    assertions: [
      { nodeId: "1", classType: "KSampler", input: "steps", equals: 4 },
      { nodeId: "5", classType: "EmptyLatentImage", input: "width", equals: 1024 },
      { nodeId: "5", classType: "EmptyLatentImage", input: "height", equals: 1024 }
    ],
    renderProfileIdentity: {
      key: "FLUX_SCHNELL_DRAFT_V1",
      version: 1
    },
    ...overrides
  };
}

function createLtxProfile(overrides: Partial<CertificationProfile> = {}): CertificationProfile {
  return {
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    workflowPath: "/comfy/workflows/ltx.json",
    workflowRelativePath: "ltx_25_720p_97f_api.json",
    expectedWorkflowHash: HASH_LTX,
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
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
      }
    ],
    assertions: [
      { nodeId: "1", classType: "KSampler", input: "steps", equals: 8 },
      { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "width", equals: 1280 },
      { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "height", equals: 720 },
      { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "length", equals: 97 }
    ],
    renderProfileIdentity: {
      key: "LTX_25_720P_5S_V1",
      version: 1
    },
    ...overrides
  };
}

function createApprovedReport(profile: CertificationProfile): Record<string, unknown> {
  const modelHashes: Record<string, string> = {};
  for (const m of profile.models) {
    modelHashes[`models/${m.category}/${m.relativePath}`] =
      profile.engine === "flux_schnell" ? HASH_MODEL_1 : HASH_MODEL_2;
  }
  return {
    version: 1,
    profileId: profile.id,
    generatedAt: "2026-08-16T00:00:00.000Z",
    workflow: {
      relativePath: profile.workflowRelativePath,
      sha256: profile.expectedWorkflowHash,
      source: profile.source
    },
    models: profile.models.map((m) => ({
      category: m.category,
      relativePath: m.relativePath,
      key: `models/${m.category}/${m.relativePath}`,
      bytes: 1000,
      sha256: profile.engine === "flux_schnell" ? HASH_MODEL_1 : HASH_MODEL_2
    })),
    git: {
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: []
    },
    disk: {
      freeBytes: 200 * 1024 * 1024 * 1024,
      modelFootprintGb: 10,
      minFreeDiskGb: profile.minFreeDiskGb,
      hasSufficientSpace: true
    },
    renderProfileProvenance: {
      key: profile.renderProfileIdentity?.key,
      version: 1,
      engine: profile.engine,
      workflowHash: profile.expectedWorkflowHash,
      modelHashes,
      frames: profile.baseline.frames ?? 1,
      steps: profile.baseline.steps,
      runnerProfile: profile.runnerProfile,
      measuredDiskFootprintGb: 10,
      minFreeDiskGb: profile.minFreeDiskGb
    }
  };
}

function createLiveReport(profile: CertificationProfile): CertificationProvenanceReport {
  return createApprovedReport(profile) as unknown as CertificationProvenanceReport;
}

class FakeRenderEngine implements RenderEnginePort {
  readonly queueInputs: Array<{
    readonly renderJobId: string;
    readonly sceneId: string;
    readonly renderProfileKey: string;
    readonly workflow: RenderWorkflow;
  }> = [];
  readonly resultExecutionIds: string[] = [];

  constructor(
    private readonly callLog: string[],
    private readonly result: RenderResult | undefined = {
      executionId: "prompt-123",
      status: "succeeded",
      outputObjectKeys: ["output/scene.png"],
      completedAt: "2026-08-16T00:00:01.000Z"
    },
    private readonly queueError?: Error,
    private readonly resultError?: Error
  ) {}

  async queueRender(input: {
    readonly renderJobId: string;
    readonly sceneId: string;
    readonly renderProfileKey: string;
    readonly workflow: RenderWorkflow;
  }): Promise<RenderQueueReceipt> {
    this.callLog.push("render.queue");
    this.queueInputs.push(input);
    if (this.queueError) {
      throw this.queueError;
    }
    return {
      executionId: "prompt-123",
      acceptedAt: "2026-08-16T00:00:00.100Z"
    };
  }

  async getRenderResult(executionId: string): Promise<RenderResult | undefined> {
    this.callLog.push("render.result");
    this.resultExecutionIds.push(executionId);
    if (this.resultError) {
      throw this.resultError;
    }
    return this.result;
  }

  async unloadModels(): Promise<void> {
    this.callLog.push("render.unload");
  }
}

class FakeLease implements RenderLease {
  readonly holder = {
    version: 1 as const,
    pid: 1234,
    startedAt: "2026-08-16T00:00:00.000Z",
    hostname: "test-host",
    leaseId: "lease-abc"
  };
  releaseCount = 0;

  constructor(
    private readonly callLog: string[],
    private readonly releaseError?: Error
  ) {}

  async release(): Promise<void> {
    this.callLog.push("lease.release");
    this.releaseCount += 1;
    if (this.releaseError) {
      throw this.releaseError;
    }
  }
}

class FakeGpuLease implements GpuExecutionLeasePort {
  acquireCount = 0;

  constructor(
    private readonly callLog: string[],
    private readonly lease: FakeLease,
    private readonly acquireError?: Error
  ) {}

  async acquireLease(): Promise<RenderLease> {
    this.callLog.push("lease.acquire");
    this.acquireCount += 1;
    if (this.acquireError) {
      throw this.acquireError;
    }
    return this.lease;
  }
}

class FakeGpuTelemetry implements GpuTelemetryPort {
  readCount = 0;

  constructor(
    private readonly callLog: string[],
    private readonly snapshot: GpuMemorySnapshot = GPU_SNAPSHOT,
    private readonly readError?: Error
  ) {}

  async readMemory(): Promise<GpuMemorySnapshot> {
    this.callLog.push("gpu.readMemory");
    this.readCount += 1;
    if (this.readError) {
      throw this.readError;
    }
    return this.snapshot;
  }
}

function buildValidCliArgs(profileId = "flux-schnell-draft"): string[] {
  return [
    "--profile",
    profileId,
    "--comfyui-dir",
    "/opt/ComfyUI",
    "--comfyui-url",
    "http://127.0.0.1:8188",
    "--gold-master-provenance",
    "/provenance/gold-master.json"
  ];
}

describe("render CLI", () => {
  it("completes provenance preflight before constructing or acquiring the GPU lease", async () => {
    const callLog: string[] = [];
    const profile = createFluxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const lease = new FakeLease(callLog);
    const gpuLease = new FakeGpuLease(callLog, lease);
    const telemetry = new FakeGpuTelemetry(callLog);
    const renderEngine = new FakeRenderEngine(callLog);

    const deps: RenderCliDependencies = {
      loadCertificationProfile: async () => {
        callLog.push("preflight.loadProfile");
        return profile;
      },
      readApprovedProvenance: async () => {
        callLog.push("preflight.readApproved");
        return approved;
      },
      collectCertificationProvenance: async () => {
        callLog.push("preflight.collectLive");
        return live;
      },
      verifyGoldMasterProvenance: () => {
        callLog.push("preflight.verifyGoldMaster");
      },
      readWorkflowFile: async () => {
        callLog.push("preflight.readWorkflow");
        return FLUX_WORKFLOW_JSON;
      },
      hashWorkflow: () => {
        callLog.push("preflight.hashWorkflow");
        return HASH_FLUX;
      },
      createRenderEngine: () => {
        callLog.push("factory.createRenderEngine");
        return renderEngine;
      },
      createGpuLease: () => {
        callLog.push("factory.createGpuLease");
        return gpuLease;
      },
      createGpuTelemetry: () => {
        callLog.push("factory.createGpuTelemetry");
        return telemetry;
      }
    };

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const exitCode = await runRenderCli(
      buildValidCliArgs("flux-schnell-draft"),
      {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line)
      },
      deps
    );

    expect(exitCode).toBe(0);
    expect(callLog).toEqual([
      "preflight.loadProfile",
      "preflight.readApproved",
      "preflight.collectLive",
      "preflight.verifyGoldMaster",
      "preflight.readWorkflow",
      "preflight.hashWorkflow",
      "factory.createRenderEngine",
      "factory.createGpuLease",
      "factory.createGpuTelemetry",
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
  });

  it("does not acquire or dispatch when profile provenance mismatches", async () => {
    const callLog: string[] = [];
    const profile = createFluxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const lease = new FakeLease(callLog);
    const gpuLease = new FakeGpuLease(callLog, lease);

    const deps: RenderCliDependencies = {
      loadCertificationProfile: async () => profile,
      readApprovedProvenance: async () => approved,
      collectCertificationProvenance: async () => live,
      verifyGoldMasterProvenance: () => {
        throw new PreflightError(
          "Model hash mismatch for key models/diffusion_models/flux1-schnell.safetensors"
        );
      },
      createGpuLease: () => {
        callLog.push("factory.createGpuLease");
        return gpuLease;
      },
      createRenderEngine: () => {
        callLog.push("factory.createRenderEngine");
        return new FakeRenderEngine(callLog);
      }
    };

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const exitCode = await runRenderCli(
      buildValidCliArgs("flux-schnell-draft"),
      {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line)
      },
      deps
    );

    expect(exitCode).toBe(1);
    expect(stdoutLines).toHaveLength(0);
    expect(gpuLease.acquireCount).toBe(0);
    expect(callLog).toEqual([]);

    const errorJson = JSON.parse(stderrLines.find((l) => l.startsWith("{")) ?? "{}");
    expect(errorJson).toMatchObject({
      status: "failed",
      stage: "preflight",
      code: "preflight_failed"
    });
    expect(errorJson.message).toContain("Model hash mismatch");
  });

  it("does not acquire or dispatch when the workflow changes after provenance collection", async () => {
    const callLog: string[] = [];
    const profile = createFluxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const lease = new FakeLease(callLog);
    const gpuLease = new FakeGpuLease(callLog, lease);

    const deps: RenderCliDependencies = {
      loadCertificationProfile: async () => profile,
      readApprovedProvenance: async () => approved,
      collectCertificationProvenance: async () => live,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => '{"tampered": true}',
      hashWorkflow: () => "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      createGpuLease: () => {
        callLog.push("factory.createGpuLease");
        return gpuLease;
      }
    };

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const exitCode = await runRenderCli(
      buildValidCliArgs("flux-schnell-draft"),
      {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line)
      },
      deps
    );

    expect(exitCode).toBe(1);
    expect(stdoutLines).toHaveLength(0);
    expect(gpuLease.acquireCount).toBe(0);
    expect(callLog).toEqual([]);

    const errorJson = JSON.parse(stderrLines.find((l) => l.startsWith("{")) ?? "{}");
    expect(errorJson).toMatchObject({
      status: "failed",
      stage: "preflight",
      code: "workflow_hash_mismatch"
    });
  });

  it("dispatches FLUX and LTX through the same application use case", async () => {
    const profiles = [
      {
        id: "flux-schnell-draft",
        profile: createFluxProfile(),
        workflowJson: FLUX_WORKFLOW_JSON,
        hash: HASH_FLUX,
        key: "FLUX_SCHNELL_DRAFT_V1"
      },
      {
        id: "ltx-25-720p-97f",
        profile: createLtxProfile(),
        workflowJson: LTX_WORKFLOW_JSON,
        hash: HASH_LTX,
        key: "LTX_25_720P_5S_V1"
      }
    ];

    for (const item of profiles) {
      const callLog: string[] = [];
      const approved = createApprovedReport(item.profile);
      const live = createLiveReport(item.profile);

      const lease = new FakeLease(callLog);
      const gpuLease = new FakeGpuLease(callLog, lease);
      const telemetry = new FakeGpuTelemetry(callLog);
      const renderEngine = new FakeRenderEngine(callLog);

      let executedInput: unknown;
      const deps: RenderCliDependencies = {
        loadCertificationProfile: async () => item.profile,
        readApprovedProvenance: async () => approved,
        collectCertificationProvenance: async () => live,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => item.workflowJson,
        hashWorkflow: () => item.hash,
        createRenderEngine: () => renderEngine,
        createGpuLease: () => gpuLease,
        createGpuTelemetry: () => telemetry,
        loadComponentLicenseRegistry: async () => ({
          schemaVersion: 1 as const,
          registryRevision: "2026-08-29.1",
          generatedAt: "2026-08-29T12:00:00.000Z",
          entries: [
            {
              componentId: "FLUX_SCHNELL_DRAFT_V1",
              componentType: "model" as const,
              versionOrRevision: "1",
              status: "approved" as const,
              licenseSource: "docs/prd.md §3.5",
              reviewedAt: "2026-08-29T12:00:00.000Z",
              policyRevision: "2026-08-29.1"
            },
            {
              componentId: "LTX_25_720P_5S_V1",
              componentType: "model" as const,
              versionOrRevision: "1",
              status: "approved" as const,
              licenseSource: "docs/prd.md §3.5",
              reviewedAt: "2026-08-29T12:00:00.000Z",
              policyRevision: "2026-08-29.1"
            }
          ]
        }),
        createUseCase: (engine, leasePort, telemetryPort, enforceLicenseRouting) => {
          const realUseCase = new ExecuteProfileRenderUseCase(
            engine,
            leasePort,
            telemetryPort,
            enforceLicenseRouting
          );
          return {
            execute: async (input) => {
              executedInput = input;
              return realUseCase.execute(input);
            }
          };
        }
      };

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];
      const exitCode = await runRenderCli(
        buildValidCliArgs(item.id),
        {
          stdout: (line) => stdoutLines.push(line),
          stderr: (line) => stderrLines.push(line)
        },
        deps
      );

      expect(exitCode).toBe(0);
      expect(renderEngine.queueInputs).toHaveLength(1);
      expect(renderEngine.queueInputs[0]!.renderProfileKey).toBe(item.key);
      expect(executedInput).toMatchObject({
        identity: {
          profileId: item.id,
          renderProfileKey: item.key
        }
      });
    }
  });

  it("emits one structured success object and exit zero", async () => {
    const callLog: string[] = [];
    const profile = createFluxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const lease = new FakeLease(callLog);
    const gpuLease = new FakeGpuLease(callLog, lease);
    const telemetry = new FakeGpuTelemetry(callLog);
    const renderEngine = new FakeRenderEngine(callLog, {
      executionId: "prompt-flux-1",
      status: "succeeded",
      outputObjectKeys: ["output/image-001.png"],
      completedAt: "2026-08-16T00:00:01.000Z"
    });

    const times = [
      new Date("2026-08-16T00:00:00.000Z"),
      new Date("2026-08-16T00:00:00.000Z"),
      new Date("2026-08-16T00:00:02.500Z")
    ];
    let timeIndex = 0;

    const deps: RenderCliDependencies = {
      loadCertificationProfile: async () => profile,
      readApprovedProvenance: async () => approved,
      collectCertificationProvenance: async () => live,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => FLUX_WORKFLOW_JSON,
      hashWorkflow: () => HASH_FLUX,
      createRenderEngine: () => renderEngine,
      createGpuLease: () => gpuLease,
      createGpuTelemetry: () => telemetry,
      now: () => times[timeIndex++] ?? times[times.length - 1]!
    };

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const exitCode = await runRenderCli(
      buildValidCliArgs("flux-schnell-draft"),
      {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line)
      },
      deps
    );

    expect(exitCode).toBe(0);
    expect(stdoutLines).toHaveLength(1);

    const parsedStdout = JSON.parse(stdoutLines[0]!);
    expect(parsedStdout).toEqual({
      status: "succeeded",
      promptId: "prompt-flux-1",
      outputObjectKeys: ["output/image-001.png"],
      durationMs: 2500,
      profile: {
        profileId: "flux-schnell-draft",
        renderProfileKey: "FLUX_SCHNELL_DRAFT_V1",
        renderProfileVersion: 1,
        engine: "flux_schnell",
        workflowSha256: HASH_FLUX,
        modelSha256: {
          "models/diffusion_models/flux1-schnell.safetensors": HASH_MODEL_1
        },
        runnerProfile: "dynamicvram-offload-v1",
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      preDispatchGpu: GPU_SNAPSHOT
    });
  });

  it("maps lease telemetry queue and render failures to non-zero structured errors", async () => {
    const profile = createFluxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const failureCases = [
      {
        name: "lease unavailable",
        buildDeps: (callLog: string[]) => {
          const holder = {
            version: 1 as const,
            pid: 9999,
            startedAt: "2026-08-16T00:00:00.000Z",
            hostname: "trinidad",
            leaseId: "active-lease-id"
          };
          const lease = new FakeLease(callLog);
          const gpuLease = new FakeGpuLease(
            callLog,
            lease,
            new GpuLeaseUnavailableError("GPU lock held by PID 9999", holder)
          );
          return {
            createGpuLease: () => gpuLease,
            createGpuTelemetry: () => new FakeGpuTelemetry(callLog),
            createRenderEngine: () => new FakeRenderEngine(callLog)
          };
        },
        expectedStatus: "failed",
        expectedStage: "lease_acquisition",
        expectedCode: "gpu_lease_unavailable",
        expectedHolderPid: 9999
      },
      {
        name: "telemetry read error",
        buildDeps: (callLog: string[]) => {
          const lease = new FakeLease(callLog);
          const gpuLease = new FakeGpuLease(callLog, lease);
          const telemetry = new FakeGpuTelemetry(
            callLog,
            GPU_SNAPSHOT,
            new Error("nvidia-smi failed")
          );
          return {
            createGpuLease: () => gpuLease,
            createGpuTelemetry: () => telemetry,
            createRenderEngine: () => new FakeRenderEngine(callLog)
          };
        },
        expectedStatus: "failed",
        expectedStage: "telemetry",
        expectedCode: "telemetry_failed",
        expectedHolderPid: undefined
      },
      {
        name: "queue render error",
        buildDeps: (callLog: string[]) => {
          const lease = new FakeLease(callLog);
          const gpuLease = new FakeGpuLease(callLog, lease);
          const telemetry = new FakeGpuTelemetry(callLog);
          const renderEngine = new FakeRenderEngine(
            callLog,
            undefined,
            new Error("ComfyUI connection refused")
          );
          return {
            createGpuLease: () => gpuLease,
            createGpuTelemetry: () => telemetry,
            createRenderEngine: () => renderEngine
          };
        },
        expectedStatus: "failed",
        expectedStage: "render_execution",
        expectedCode: "render_queue_failed",
        expectedHolderPid: undefined
      },
      {
        name: "render execution failure (OOM)",
        buildDeps: (callLog: string[]) => {
          const lease = new FakeLease(callLog);
          const gpuLease = new FakeGpuLease(callLog, lease);
          const telemetry = new FakeGpuTelemetry(callLog);
          const failedResult: RenderResult = {
            executionId: "prompt-oom",
            status: "failed",
            outputObjectKeys: [],
            completedAt: "2026-08-16T00:00:01.000Z",
            errorCode: "out_of_memory"
          };
          const renderEngine = new FakeRenderEngine(callLog, failedResult);
          return {
            createGpuLease: () => gpuLease,
            createGpuTelemetry: () => telemetry,
            createRenderEngine: () => renderEngine
          };
        },
        expectedStatus: "failed",
        expectedStage: "render_execution",
        expectedCode: "out_of_memory",
        expectedHolderPid: undefined
      }
    ];

    for (const testCase of failureCases) {
      const callLog: string[] = [];
      const testSpecificDeps = testCase.buildDeps(callLog);

      const deps: RenderCliDependencies = {
        loadCertificationProfile: async () => profile,
        readApprovedProvenance: async () => approved,
        collectCertificationProvenance: async () => live,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => FLUX_WORKFLOW_JSON,
        hashWorkflow: () => HASH_FLUX,
        ...testSpecificDeps
      };

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];
      const exitCode = await runRenderCli(
        buildValidCliArgs("flux-schnell-draft"),
        {
          stdout: (line) => stdoutLines.push(line),
          stderr: (line) => stderrLines.push(line)
        },
        deps
      );

      expect(exitCode, testCase.name).toBe(1);
      expect(stdoutLines, testCase.name).toHaveLength(0);

      const errorJson = JSON.parse(stderrLines.find((l) => l.startsWith("{")) ?? "{}");
      expect(errorJson.status, testCase.name).toBe(testCase.expectedStatus);
      expect(errorJson.stage, testCase.name).toBe(testCase.expectedStage);
      expect(errorJson.code, testCase.name).toBe(testCase.expectedCode);
      if (testCase.expectedHolderPid !== undefined) {
        expect(errorJson.holder?.pid, testCase.name).toBe(testCase.expectedHolderPid);
      }
    }
  });

  it("releases ownership on every post-acquisition failure", async () => {
    const profile = createFluxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const scenarios = [
      {
        name: "telemetry failure",
        buildEngine: (callLog: string[]) => new FakeRenderEngine(callLog),
        buildTelemetry: (callLog: string[]) =>
          new FakeGpuTelemetry(callLog, GPU_SNAPSHOT, new Error("telemetry crash"))
      },
      {
        name: "queue failure",
        buildEngine: (callLog: string[]) =>
          new FakeRenderEngine(callLog, undefined, new Error("queue timeout")),
        buildTelemetry: (callLog: string[]) => new FakeGpuTelemetry(callLog)
      },
      {
        name: "result failure",
        buildEngine: (callLog: string[]) =>
          new FakeRenderEngine(callLog, undefined, undefined, new Error("result socket closed")),
        buildTelemetry: (callLog: string[]) => new FakeGpuTelemetry(callLog)
      }
    ];

    for (const scenario of scenarios) {
      const callLog: string[] = [];
      const lease = new FakeLease(callLog);
      const gpuLease = new FakeGpuLease(callLog, lease);
      const telemetry = scenario.buildTelemetry(callLog);
      const renderEngine = scenario.buildEngine(callLog);

      const deps: RenderCliDependencies = {
        loadCertificationProfile: async () => profile,
        readApprovedProvenance: async () => approved,
        collectCertificationProvenance: async () => live,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => FLUX_WORKFLOW_JSON,
        hashWorkflow: () => HASH_FLUX,
        createGpuLease: () => gpuLease,
        createGpuTelemetry: () => telemetry,
        createRenderEngine: () => renderEngine
      };

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];
      const exitCode = await runRenderCli(
        buildValidCliArgs("flux-schnell-draft"),
        {
          stdout: (line) => stdoutLines.push(line),
          stderr: (line) => stderrLines.push(line)
        },
        deps
      );

      expect(exitCode, scenario.name).toBe(1);
      expect(stdoutLines, scenario.name).toHaveLength(0);
      expect(gpuLease.acquireCount, scenario.name).toBe(1);
      expect(lease.releaseCount, scenario.name).toBe(1);
      expect(callLog).toContain("lease.release");
    }
  });

  it("help exits zero without constructing infrastructure", async () => {
    const callLog: string[] = [];
    const deps: RenderCliDependencies = {
      loadCertificationProfile: async () => {
        callLog.push("loadProfile");
        return createFluxProfile();
      },
      createRenderEngine: () => {
        callLog.push("createRenderEngine");
        return new FakeRenderEngine(callLog);
      },
      createGpuLease: () => {
        callLog.push("createGpuLease");
        return new FakeGpuLease(callLog, new FakeLease(callLog));
      }
    };

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const exitCode = await runRenderCli(
      ["--help"],
      {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line)
      },
      deps
    );

    expect(exitCode).toBe(0);
    expect(stdoutLines.join("\n")).toContain("Usage: render");
    expect(stderrLines).toHaveLength(0);
    expect(callLog).toHaveLength(0);
  });

  it("fails closed when license registry denies profile component with zero GPU lease or queue calls", async () => {
    const callLog: string[] = [];
    const profile = createLtxProfile();
    const approved = createApprovedReport(profile);
    const live = createLiveReport(profile);

    const lease = new FakeLease(callLog);
    const gpuLease = new FakeGpuLease(callLog, lease);
    const telemetry = new FakeGpuTelemetry(callLog);
    const renderEngine = new FakeRenderEngine(callLog);

    // The committed seed registry approved LTX_25_720P_5S_V1 (issue #143
    // operator determination), so this test injects a registry that still
    // reports LTX as review_required to verify the fail-closed path
    // independently of the production registry contents.
    const deps: RenderCliDependencies = {
      loadCertificationProfile: async () => profile,
      readApprovedProvenance: async () => approved,
      collectCertificationProvenance: async () => live,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => LTX_WORKFLOW_JSON,
      hashWorkflow: () => HASH_LTX,
      createRenderEngine: () => renderEngine,
      createGpuLease: () => gpuLease,
      createGpuTelemetry: () => telemetry,
      loadComponentLicenseRegistry: async () => ({
        registryRevision: "test-review-required",
        generatedAt: "2026-08-29T12:00:00.000Z",
        entries: [
          {
            componentId: "LTX_25_720P_5S_V1",
            componentType: "model" as const,
            versionOrRevision: "1",
            status: "review_required" as const,
            licenseSource: "test-fixture",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "test-review-required"
          }
        ]
      })
    };

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const exitCode = await runRenderCli(
      buildValidCliArgs("ltx-25-720p-97f"),
      {
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line)
      },
      deps
    );

    expect(exitCode).toBe(1);
    expect(stdoutLines).toHaveLength(0);
    expect(gpuLease.acquireCount).toBe(0);
    expect(renderEngine.queueInputs).toHaveLength(0);

    const errorJson = JSON.parse(stderrLines.find((l) => l.startsWith("{")) ?? "{}");
    expect(errorJson).toMatchObject({
      status: "failed",
      stage: "license_routing",
      code: "license_routing_denied"
    });
    expect(errorJson.message).toContain('Component "LTX_25_720P_5S_V1"');
    expect(errorJson.message).toContain('has policy status "review_required"');
  });

  it("direct execution assigns the returned code to process.exitCode", () => {
    expect(typeof isDirectExecution).toBe("function");
    expect(isDirectExecution()).toBe(false);
  });
});
