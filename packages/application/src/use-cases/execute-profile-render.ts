import {
  type ComponentRef,
  type RenderProfileKey,
  type H3CandidateExecutionPolicy,
  H3CandidateExecutionPolicySchema
} from "@cco/contracts";
import type {
  GpuExecutionLeasePort,
  GpuMemorySnapshot,
  GpuTelemetryPort,
  RenderEnginePort,
  RenderQueueReceipt,
  RenderResult,
  RenderWorkflow
} from "../ports/index.js";
import type { EnforceLicenseRouting } from "./enforce-license-routing.js";

export interface ProfileRenderIdentity {
  readonly profileId: string;
  readonly renderProfileKey: RenderProfileKey | string;
  // Released H3 profiles carry their own release version (see
  // CertificationProfile.renderProfileIdentity.version in profile-manifest.ts),
  // not necessarily 1.
  readonly renderProfileVersion: number;
  readonly engine: "ltx_25" | "flux_schnell" | "ltx_25_i2v" | "minimax_h3_i2v" | "minimax_h3_ref2v";
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
  readonly executionPolicy?: H3CandidateExecutionPolicy | undefined;
  readonly onLeaseAcquired?: (() => Promise<void>) | undefined;
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

  const isCandidateKey =
    typeof identity.renderProfileKey === "string" &&
    /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(identity.renderProfileKey);

  const isReleaseKey =
    typeof identity.renderProfileKey === "string" &&
    /^H3_RELEASE_[0-9a-f]{64}_V[1-9]\d*$/.test(identity.renderProfileKey);

  if (isReleaseKey) {
    if (
      typeof identity.renderProfileVersion !== "number" ||
      !Number.isInteger(identity.renderProfileVersion) ||
      identity.renderProfileVersion < 1
    ) {
      throw new ProfileRenderExecutionError(
        "invalid_input",
        "identity.renderProfileVersion must be a positive integer"
      );
    }
  } else if (identity.renderProfileVersion !== 1) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      "identity.renderProfileVersion must be 1"
    );
  }

  const validProfileKey =
    identity.renderProfileKey === "LTX_25_720P_5S_V1" ||
    identity.renderProfileKey === "FLUX_SCHNELL_DRAFT_V1" ||
    identity.renderProfileKey === "FLUX_SCHNELL_STORYBOARD_V1" ||
    identity.renderProfileKey === "LTX_25_720P_5S_I2V_V1" ||
    identity.renderProfileKey === "MINIMAX_H3_720P_5S_I2V_V1" ||
    identity.renderProfileKey === "MINIMAX_H3_720P_5S_REF2V_V1" ||
    identity.renderProfileKey === "MINIMAX_H3_720P_5S_REF2V_TURBO4_V1" ||
    isCandidateKey ||
    isReleaseKey;
  if (!validProfileKey) {
    throw new ProfileRenderExecutionError("invalid_input", "identity.renderProfileKey is invalid");
  }

  if (isCandidateKey || isReleaseKey) {
    if (identity.engine !== "minimax_h3_i2v" && identity.engine !== "minimax_h3_ref2v") {
      throw new ProfileRenderExecutionError(
        "invalid_input",
        isReleaseKey
          ? "H3 release profile must have engine minimax_h3_i2v or minimax_h3_ref2v"
          : "H3 candidate profile must have engine minimax_h3_i2v or minimax_h3_ref2v"
      );
    }
  } else {
    const expectedEngine =
      identity.renderProfileKey === "LTX_25_720P_5S_V1"
        ? "ltx_25"
        : identity.renderProfileKey === "LTX_25_720P_5S_I2V_V1"
          ? "ltx_25_i2v"
          : identity.renderProfileKey === "MINIMAX_H3_720P_5S_I2V_V1"
            ? "minimax_h3_i2v"
            : identity.renderProfileKey === "MINIMAX_H3_720P_5S_REF2V_V1" ||
                identity.renderProfileKey === "MINIMAX_H3_720P_5S_REF2V_TURBO4_V1"
              ? "minimax_h3_ref2v"
              : "flux_schnell";
    if (identity.engine !== expectedEngine) {
      throw new ProfileRenderExecutionError(
        "invalid_input",
        "identity.renderProfileKey and identity.engine must describe the same render profile"
      );
    }
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

  const isCandidate =
    typeof input.identity.renderProfileKey === "string" &&
    /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(input.identity.renderProfileKey);

  if (isCandidate && input.executionPolicy === undefined) {
    throw new ProfileRenderExecutionError(
      "invalid_input",
      "Candidate render execution requires explicit executionPolicy"
    );
  }

  if (input.executionPolicy !== undefined) {
    const parseResult = H3CandidateExecutionPolicySchema.safeParse(input.executionPolicy);
    if (!parseResult.success) {
      throw new ProfileRenderExecutionError(
        "invalid_input",
        `executionPolicy is invalid: ${parseResult.error.message}`
      );
    }
  }
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
    private readonly enforceLicenseRouting: EnforceLicenseRouting,
    private readonly now: () => Date = () => new Date()
  ) {}

  enforceLicense(input: {
    renderJobId: string;
    sceneId: string;
    renderProfileKey: string;
    renderProfileVersion: number;
    engine?: ProfileRenderIdentity["engine"] | undefined;
  }): void {
    // H3 candidate keys (staging, hash-derived per distillation/attention variant) and H3
    // release keys (certified, hash-derived per specification digest) are never themselves
    // registered in the license registry - they're internal governance/provenance identities,
    // not licensable components. They execute the same base MiniMax H3 weights that are
    // already approved per route, so license routing must check against that base component
    // instead of failing closed on every candidate/release key.
    const isCandidateKey = /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(input.renderProfileKey);
    const isReleaseKey = /^H3_RELEASE_[0-9a-f]{64}_V[1-9]\d*$/.test(input.renderProfileKey);
    let componentId = input.renderProfileKey;
    let versionOrRevision = String(input.renderProfileVersion);
    if (isCandidateKey || isReleaseKey) {
      if (input.engine === "minimax_h3_i2v") {
        componentId = "MINIMAX_H3_720P_5S_I2V_V1";
      } else if (input.engine === "minimax_h3_ref2v") {
        componentId = "MINIMAX_H3_720P_5S_REF2V_V1";
      } else {
        throw new ProfileRenderExecutionError(
          "invalid_input",
          `H3 ${isReleaseKey ? "release" : "candidate"} license enforcement requires engine minimax_h3_i2v or minimax_h3_ref2v`
        );
      }
      versionOrRevision = "1";
    }
    const requiredComponents: readonly ComponentRef[] = [
      {
        componentId,
        componentType: "model",
        versionOrRevision
      }
    ];
    this.enforceLicenseRouting.enforce({
      requiredComponents,
      operation: {
        kind: "generation",
        renderJobId: input.renderJobId,
        sceneId: input.sceneId
      }
    });
  }

  async execute(input: ExecuteProfileRenderInput): Promise<ExecuteProfileRenderResult> {
    validateInput(input);

    this.enforceLicense({
      renderJobId: input.renderJobId,
      sceneId: input.sceneId,
      renderProfileKey: input.identity.renderProfileKey,
      renderProfileVersion: input.identity.renderProfileVersion,
      engine: input.identity.engine
    });

    const lease = await this.gpuLease.acquireLease();
    let primaryError: unknown;
    let hasPrimaryError = false;
    let unloadError: unknown;
    let hasUnloadError = false;
    let releaseError: unknown;
    let hasReleaseError = false;
    let skipLeaseRelease = false;
    let receipt: RenderQueueReceipt | undefined;
    let successfulResult: ExecuteProfileRenderResult | undefined;
    try {
      if (input.onLeaseAcquired) {
        await input.onLeaseAcquired();
      }
      const preDispatchGpu = await this.gpuTelemetry.readMemory();
      const startedAt = this.now().getTime();
      receipt = await this.renderEngine.queueRender({
        renderJobId: input.renderJobId,
        sceneId: input.sceneId,
        renderProfileKey: input.identity.renderProfileKey,
        workflow: input.workflow,
        ...(input.executionPolicy?.renderTimeoutMs !== undefined
          ? { timeoutMs: input.executionPolicy.renderTimeoutMs }
          : {})
      });
      const result = await this.renderEngine.getRenderResult(receipt.executionId);
      const durationMs = Math.max(0, this.now().getTime() - startedAt);
      successfulResult = buildSuccessfulResult(input.identity, preDispatchGpu, result, durationMs);
    } catch (error) {
      primaryError = error;
      hasPrimaryError = true;
      if (receipt?.executionId) {
        if (typeof this.renderEngine.cancelRender === "function") {
          try {
            await this.renderEngine.cancelRender(receipt.executionId);
          } catch (cancelErr) {
            if (input.executionPolicy !== undefined) {
              // Cannot confirm quiescence - retain host capacity / quarantine host
              skipLeaseRelease = true;
              if (!hasPrimaryError) {
                primaryError = cancelErr;
              }
            }
          }
        } else if (input.executionPolicy !== undefined) {
          // Cannot confirm quiescence when cancelRender is not supported on candidate path
          skipLeaseRelease = true;
        }
      }
    } finally {
      try {
        await this.renderEngine.unloadModels();
      } catch (caughtUnloadError) {
        if (input.executionPolicy !== undefined) {
          hasUnloadError = true;
          unloadError = caughtUnloadError;
          // Retain host capacity / quarantine host on candidate cleanup failure
          skipLeaseRelease = true;
        }
        // For legacy profiles without executionPolicy, errors during unload are swallowed
      }
      if (!skipLeaseRelease) {
        try {
          await lease.release();
        } catch (caughtReleaseError) {
          hasReleaseError = true;
          releaseError = caughtReleaseError;
        }
      }
    }

    if (hasPrimaryError && hasReleaseError && !hasUnloadError) {
      throw new AggregateError(
        [primaryError, releaseError],
        "Render execution and GPU lease release both failed"
      );
    }

    const errors: unknown[] = [];
    if (hasPrimaryError) errors.push(primaryError);
    if (hasUnloadError) errors.push(unloadError);
    if (hasReleaseError) errors.push(releaseError);

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        "Render execution, model unload, or GPU lease release failed"
      );
    }
    return successfulResult!;
  }
}
