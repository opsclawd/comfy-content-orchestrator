import { describe, expect, it } from "vitest";
import type {
  GpuExecutionLeasePort,
  GpuMemorySnapshot,
  GpuTelemetryPort,
  RenderEnginePort,
  RenderLease,
  RenderQueueReceipt,
  RenderResult,
  RenderWorkflow
} from "../ports/index.js";
import {
  ExecuteProfileRenderUseCase,
  ProfileRenderExecutionError,
  type ExecuteProfileRenderInput,
  type ProfileRenderIdentity
} from "./execute-profile-render.js";

const HASH = "a".repeat(64);
const WORKFLOW: RenderWorkflow = { "1": { class_type: "KSampler" } };
const GPU_SNAPSHOT: GpuMemorySnapshot = {
  totalVramMb: 24576,
  usedVramMb: 4096,
  freeVramMb: 20480,
  reservedVramMb: 512,
  measuredAt: "2026-08-16T00:00:00.000Z"
};

function createIdentity(overrides: Partial<ProfileRenderIdentity> = {}): ProfileRenderIdentity {
  return {
    profileId: "profile-ltx",
    renderProfileKey: "LTX_25_720P_5S_V1",
    renderProfileVersion: 1,
    engine: "ltx_25",
    workflowSha256: HASH,
    modelSha256: { checkpoint: HASH },
    runnerProfile: "runner-default",
    comfyUiCommit: "comfy-commit",
    ...overrides
  };
}

function createInput(
  overrides: Partial<ExecuteProfileRenderInput> = {}
): ExecuteProfileRenderInput {
  return {
    renderJobId: "render-job-1",
    sceneId: "scene-1",
    workflow: WORKFLOW,
    identity: createIdentity(),
    ...overrides
  };
}

function createSuccessResult(executionId = "prompt-1"): RenderResult {
  return {
    executionId,
    status: "succeeded",
    outputObjectKeys: ["images/scene-1.png", "metadata/scene-1.json"],
    completedAt: "2026-08-16T00:00:01.000Z"
  };
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
    private readonly result: RenderResult | undefined,
    private readonly queueError?: Error,
    private readonly resultError?: Error,
    private readonly unloadError?: Error
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
      executionId: "prompt-1",
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
    if (this.unloadError) {
      throw this.unloadError;
    }
  }
}

class FakeLease implements RenderLease {
  readonly holder = {
    version: 1 as const,
    pid: 123,
    startedAt: "2026-08-16T00:00:00.000Z",
    hostname: "test-host",
    leaseId: "lease-1"
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
    private readonly lease: FakeLease
  ) {}

  async acquireLease(): Promise<RenderLease> {
    this.callLog.push("lease.acquire");
    this.acquireCount += 1;
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

function createUseCase(
  options: {
    readonly result?: RenderResult | undefined;
    readonly resultError?: Error;
    readonly queueError?: Error;
    readonly releaseError?: Error;
    readonly readError?: Error;
    readonly unloadError?: Error;
    readonly callLog?: string[];
    readonly now?: () => Date;
  } = {}
) {
  const callLog = options.callLog ?? [];
  const lease = new FakeLease(callLog, options.releaseError);
  const gpuLease = new FakeGpuLease(callLog, lease);
  const telemetry = new FakeGpuTelemetry(callLog, GPU_SNAPSHOT, options.readError);
  const renderEngine = new FakeRenderEngine(
    callLog,
    Object.hasOwn(options, "result") ? options.result : createSuccessResult(),
    options.queueError,
    options.resultError,
    options.unloadError
  );
  const useCase = new ExecuteProfileRenderUseCase(renderEngine, gpuLease, telemetry, options.now);
  return { callLog, lease, gpuLease, telemetry, renderEngine, useCase };
}

describe("ExecuteProfileRenderUseCase", () => {
  it("acquires the lease before telemetry and render dispatch", async () => {
    const { callLog, useCase } = createUseCase();

    await useCase.execute(createInput());

    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
  });

  it("returns a structured successful render result", async () => {
    const identity = createIdentity();
    const times = [new Date("2026-08-16T00:00:00.100Z"), new Date("2026-08-16T00:00:01.250Z")];
    let nowIndex = 0;
    const { useCase } = createUseCase({ now: () => times[nowIndex++] ?? times[1]! });

    const result = await useCase.execute(createInput({ identity }));

    expect(result).toEqual({
      status: "succeeded",
      promptId: "prompt-1",
      outputObjectKeys: ["images/scene-1.png", "metadata/scene-1.json"],
      durationMs: 1150,
      profile: identity,
      preDispatchGpu: GPU_SNAPSHOT
    });
    expect(result.profile).toBe(identity);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("releases the lease when queueRender throws", async () => {
    const queueError = new Error("queue unavailable");
    const { callLog, lease, renderEngine, useCase } = createUseCase({ queueError });

    await expect(useCase.execute(createInput())).rejects.toBe(queueError);

    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.unload",
      "lease.release"
    ]);
    expect(renderEngine.resultExecutionIds).toHaveLength(0);
    expect(lease.releaseCount).toBe(1);
  });

  it("releases the lease when getRenderResult throws", async () => {
    const resultError = new Error("result unavailable");
    const { callLog, lease, useCase } = createUseCase({ resultError });

    await expect(useCase.execute(createInput())).rejects.toBe(resultError);

    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
    expect(lease.releaseCount).toBe(1);
  });

  it("releases the lease when the render result is missing", async () => {
    const { callLog, lease, useCase } = createUseCase({ result: undefined });

    await expect(useCase.execute(createInput())).rejects.toMatchObject({
      name: "ProfileRenderExecutionError",
      code: "render_result_missing"
    });

    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
    expect(lease.releaseCount).toBe(1);
  });

  it("releases the lease when the render result reports failure", async () => {
    const failedResult: RenderResult = {
      executionId: "prompt-failed",
      status: "failed",
      outputObjectKeys: [],
      completedAt: "2026-08-16T00:00:01.000Z",
      errorCode: "out_of_memory"
    };
    const { callLog, lease, useCase } = createUseCase({ result: failedResult });

    const error = await useCase.execute(createInput()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProfileRenderExecutionError);
    expect(error).toMatchObject({
      code: "out_of_memory",
      promptId: "prompt-failed"
    });
    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
    expect(lease.releaseCount).toBe(1);
  });

  it("releases the lease when pre-dispatch telemetry fails without dispatching", async () => {
    const readError = new Error("telemetry unavailable");
    const { callLog, lease, renderEngine, useCase } = createUseCase({ readError });

    await expect(useCase.execute(createInput())).rejects.toBe(readError);

    expect(callLog).toEqual(["lease.acquire", "gpu.readMemory", "render.unload", "lease.release"]);
    expect(renderEngine.queueInputs).toHaveLength(0);
    expect(lease.releaseCount).toBe(1);
  });

  it("does not acquire or dispatch when validated identity input is inconsistent", async () => {
    const invalidInputs: Array<{
      readonly name: string;
      readonly input: ExecuteProfileRenderInput;
    }> = [
      {
        name: "empty profile ID",
        input: createInput({ identity: createIdentity({ profileId: " " }) })
      },
      {
        name: "empty render job ID",
        input: createInput({ renderJobId: " " })
      },
      {
        name: "empty scene ID",
        input: createInput({ sceneId: " " })
      },
      {
        name: "invalid version",
        input: createInput({
          identity: {
            ...createIdentity(),
            renderProfileVersion: 2
          } as unknown as ProfileRenderIdentity
        })
      },
      {
        name: "invalid workflow hash",
        input: createInput({ identity: createIdentity({ workflowSha256: "not-a-hash" }) })
      },
      {
        name: "empty model hashes",
        input: createInput({ identity: createIdentity({ modelSha256: {} }) })
      },
      {
        name: "mismatched profile engine",
        input: createInput({ identity: createIdentity({ engine: "flux_schnell" }) })
      },
      {
        name: "empty workflow",
        input: createInput({ workflow: {} })
      }
    ];

    for (const invalidInput of invalidInputs) {
      const { gpuLease, renderEngine, telemetry, useCase } = createUseCase();

      await expect(useCase.execute(invalidInput.input)).rejects.toBeInstanceOf(Error);

      expect(gpuLease.acquireCount, invalidInput.name).toBe(0);
      expect(telemetry.readCount, invalidInput.name).toBe(0);
      expect(renderEngine.queueInputs, invalidInput.name).toHaveLength(0);
    }
  });

  it("surfaces lease release failure after an otherwise successful render", async () => {
    const releaseError = new Error("lease release uncertain");
    const { callLog, lease, useCase } = createUseCase({ releaseError });

    await expect(useCase.execute(createInput())).rejects.toBe(releaseError);

    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
    expect(lease.releaseCount).toBe(1);
  });

  it("preserves both primary and release errors when cleanup also fails", async () => {
    const primaryError = new Error("queue failed");
    const releaseError = new Error("release failed");
    const { callLog, lease, useCase } = createUseCase({
      queueError: primaryError,
      releaseError
    });

    const error = await useCase.execute(createInput()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({
      message: "Render execution and GPU lease release both failed"
    });
    expect((error as AggregateError).errors).toEqual([primaryError, releaseError]);
    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.unload",
      "lease.release"
    ]);
    expect(lease.releaseCount).toBe(1);
  });

  it("releases the lease even when unloadModels throws", async () => {
    const unloadError = new Error("unload failed");
    const { callLog, lease, useCase } = createUseCase({ unloadError });

    const result = await useCase.execute(createInput());

    expect(result.status).toBe("succeeded");
    expect(callLog).toEqual([
      "lease.acquire",
      "gpu.readMemory",
      "render.queue",
      "render.result",
      "render.unload",
      "lease.release"
    ]);
    expect(lease.releaseCount).toBe(1);
  });
});
