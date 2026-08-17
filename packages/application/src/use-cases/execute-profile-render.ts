import type { RenderProfileKey } from "@cco/contracts";
import type {
  GpuExecutionLeasePort,
  GpuMemorySnapshot,
  GpuTelemetryPort,
  RenderEnginePort,
  RenderResult,
  RenderWorkflow
} from "../ports/index.js";

export interface ProfileRenderIdentity {
  readonly profileId: string;
  readonly renderProfileKey: RenderProfileKey;
  readonly renderProfileVersion: 1;
  readonly engine: "ltx_25" | "flux_schnell";
  readonly workflowSha256: string;
  readonly modelSha256: Readonly<Record<string, string>>;
  readonly runnerProfile: string;
  readonly comfyUiCommit: string;
}

export interface ExecuteProfileRenderInput {
  readonly renderJobId: string;
  readonly sceneId: string;
  readonly workflow: RenderWorkflow;
  readonly identity: ProfileRenderIdentity;
}

export interface ExecuteProfileRenderResult {
  readonly status: "succeeded";
  readonly promptId: string;
  readonly outputObjectKeys: readonly string[];
  readonly durationMs: number;
  readonly profile: ProfileRenderIdentity;
  readonly preDispatchGpu: GpuMemorySnapshot;
}

export class ProfileRenderExecutionError extends Error {
  override readonly name = "ProfileRenderExecutionError";

  constructor(
    readonly code: string,
    message: string,
    readonly promptId?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonBlank(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProfileRenderExecutionError("invalid_input", `${field} must be non-blank`);
  }
}

function requireSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      `${field} must be a lowercase 64-character hexadecimal SHA-256 hash`
    );
  }
}

function validateIdentity(identity: unknown): asserts identity is ProfileRenderIdentity {
  if (!isRecord(identity)) {
    throw new ProfileRenderExecutionError("invalid_input", "identity must be an object");
  }

  requireNonBlank(identity.profileId, "identity.profileId");
  requireNonBlank(identity.renderProfileKey, "identity.renderProfileKey");
  requireNonBlank(identity.engine, "identity.engine");
  requireNonBlank(identity.runnerProfile, "identity.runnerProfile");
  requireNonBlank(identity.comfyUiCommit, "identity.comfyUiCommit");

  if (identity.renderProfileVersion !== 1) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      "identity.renderProfileVersion must be 1"
    );
  }

  const validProfileKey =
    identity.renderProfileKey === "LTX_25_720P_5S_V1" ||
    identity.renderProfileKey === "FLUX_SCHNELL_DRAFT_V1";
  if (!validProfileKey) {
    throw new ProfileRenderExecutionError("invalid_input", "identity.renderProfileKey is invalid");
  }

  const expectedEngine =
    identity.renderProfileKey === "LTX_25_720P_5S_V1" ? "ltx_25" : "flux_schnell";
  if (identity.engine !== expectedEngine) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      "identity.renderProfileKey and identity.engine must describe the same render profile"
    );
  }

  requireSha256(identity.workflowSha256, "identity.workflowSha256");
  if (!isRecord(identity.modelSha256) || Object.keys(identity.modelSha256).length === 0) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      "identity.modelSha256 must contain at least one model hash"
    );
  }
  for (const [modelKey, modelHash] of Object.entries(identity.modelSha256)) {
    requireNonBlank(modelKey, "identity.modelSha256 key");
    requireSha256(modelHash, `identity.modelSha256.${modelKey}`);
  }
}

function validateInput(input: unknown): asserts input is ExecuteProfileRenderInput {
  if (!isRecord(input)) {
    throw new ProfileRenderExecutionError("invalid_input", "input must be an object");
  }

  requireNonBlank(input.renderJobId, "renderJobId");
  requireNonBlank(input.sceneId, "sceneId");
  if (!isRecord(input.workflow) || Object.keys(input.workflow).length === 0) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      "workflow must contain at least one workflow key"
    );
  }
  validateIdentity(input.identity);
}

function buildSuccessfulResult(
  identity: ProfileRenderIdentity,
  preDispatchGpu: GpuMemorySnapshot,
  result: RenderResult | undefined,
  durationMs: number
): ExecuteProfileRenderResult {
  if (result === undefined) {
    throw new ProfileRenderExecutionError(
      "render_result_missing",
      "Render engine returned no terminal render result"
    );
  }
  if (result.status === "failed") {
    throw new ProfileRenderExecutionError(
      result.errorCode ?? "render_failed",
      "Render execution failed",
      result.executionId
    );
  }

  return {
    status: "succeeded",
    promptId: result.executionId,
    outputObjectKeys: result.outputObjectKeys,
    durationMs,
    profile: identity,
    preDispatchGpu
  };
}

export class ExecuteProfileRenderUseCase {
  constructor(
    private readonly renderEngine: RenderEnginePort,
    private readonly gpuLease: GpuExecutionLeasePort,
    private readonly gpuTelemetry: GpuTelemetryPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: ExecuteProfileRenderInput): Promise<ExecuteProfileRenderResult> {
    validateInput(input);

    const lease = await this.gpuLease.acquireLease();
    let primaryError: unknown;
    let hasPrimaryError = false;
    let releaseError: unknown;
    let hasReleaseError = false;
    let successfulResult: ExecuteProfileRenderResult | undefined;
    try {
      const preDispatchGpu = await this.gpuTelemetry.readMemory();
      const startedAt = this.now().getTime();
      const receipt = await this.renderEngine.queueRender({
        renderJobId: input.renderJobId,
        sceneId: input.sceneId,
        renderProfileKey: input.identity.renderProfileKey,
        workflow: input.workflow
      });
      const result = await this.renderEngine.getRenderResult(receipt.executionId);
      const durationMs = Math.max(0, this.now().getTime() - startedAt);
      successfulResult = buildSuccessfulResult(input.identity, preDispatchGpu, result, durationMs);
    } catch (error) {
      primaryError = error;
      hasPrimaryError = true;
    } finally {
      try {
        await lease.release();
      } catch (caughtReleaseError) {
        hasReleaseError = true;
        releaseError = caughtReleaseError;
      }
    }

    if (hasPrimaryError) {
      if (hasReleaseError) {
        throw new AggregateError(
          [primaryError, releaseError],
          "Render execution and GPU lease release both failed"
        );
      }
      throw primaryError;
    }
    if (hasReleaseError) {
      throw releaseError;
    }
    return successfulResult!;
  }
}
