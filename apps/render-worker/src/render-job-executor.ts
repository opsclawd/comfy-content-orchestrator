import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeReferenceBindings,
  compileShotPlan,
  findAudioPromptTargets,
  MAX_CANDIDATE_IMAGE_BYTES,
  type ComfyUiInputStagingPort,
  type EnforceLicenseRouting,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type HashBytesPort,
  type ObjectStoragePort,
  type ProfileRenderIdentity,
  type PutObjectInput,
  type ReferenceAssetRepository,
  type RenderWorkflow,
  type ResolvedApprovedVisualProductionMedia,
  type SceneRepository,
  type ShotPlanRepository,
  type StagedComfyUiInput
} from "@cco/application";
import {
  getProfileInjectionTopology,
  LTX_FRAME_STEP,
  LTX_SUPPORTED_FRAME_RANGE,
  type ManifestExecutedInstruction,
  type ManifestFrameAnchorEntry,
  type ManifestPrevisReviewEvidence,
  type ManifestReferenceImageEntry,
  type ManifestShotPlanReference,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  MINIMAX_H3_SUPPORTED_FRAME_RANGE,
  type NodeInjectionTarget,
  type ProfileInjectionTopology,
  RENDER_PROFILE_ALIASES,
  type SceneReferenceBinding,
  type ShotPlanRoutingMode
} from "@cco/contracts";
import type {
  CandidateId,
  JobKind,
  ReferenceAsset as DomainReferenceAsset,
  RenderJob,
  SceneId,
  ShotPlanId
} from "@cco/domain";
import {
  collectCertificationProvenance,
  hashWorkflow,
  HttpComfyUiOutputReader,
  loadCertificationProfile,
  type CertificationProfile,
  type CertificationProvenanceReport,
  type ComfyUiOutputReader
} from "@cco/infrastructure";
import { BUCKETS } from "@cco/shared";
import { PreflightError, verifyGoldMasterProvenance } from "./certification/preflight.js";
import type { RenderJobExecutor, WorkerRenderOutput } from "./worker.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");

export class RenderJobExecutionError extends Error {
  override readonly name: string = "RenderJobExecutionError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class RenderJobPayloadValidationError extends RenderJobExecutionError {
  override readonly name: string = "RenderJobPayloadValidationError";
}

export class CandidateOutputCardinalityError extends RenderJobExecutionError {
  override readonly name: string = "CandidateOutputCardinalityError";
}

export class ProductionManifestAssemblyError extends RenderJobExecutionError {
  override readonly name: string = "ProductionManifestAssemblyError";
}

export class WorkflowHashMismatchError extends RenderJobExecutionError {
  override readonly name: string = "WorkflowHashMismatchError";
}

export class MissingProfileTopologyError extends RenderJobExecutionError {
  override readonly name: string = "MissingProfileTopologyError";
  readonly profileId: string;
  readonly renderProfileKey?: string | undefined;

  constructor(profileId: string, renderProfileKey?: string, options?: ErrorOptions) {
    super(
      `Profile "${profileId}" (key: "${renderProfileKey ?? "unknown"}") does not define a declarative ProfileInjectionTopology`,
      options
    );
    this.profileId = profileId;
    this.renderProfileKey = renderProfileKey;
  }
}

export class MissingCertifiedProfileError extends RenderJobExecutionError {
  override readonly name: string = "MissingCertifiedProfileError";
  readonly workflowTemplate: string;
  constructor(workflowTemplate: string, options?: ErrorOptions) {
    super(`no certified profile for workflow_template "${workflowTemplate}"`, options);
    this.workflowTemplate = workflowTemplate;
  }
}

export class MissingApprovedCandidateForConditioningError extends RenderJobExecutionError {
  override readonly name: string = "MissingApprovedCandidateForConditioningError";
}

export class ReferenceImageIntegrityError extends RenderJobExecutionError {
  override readonly name: string = "ReferenceImageIntegrityError";
}

export class ReferenceImageStagingError extends RenderJobExecutionError {
  override readonly name: string = "ReferenceImageStagingError";
}

export class ReferenceImageInjectionInvariantError extends RenderJobExecutionError {
  override readonly name: string = "ReferenceImageInjectionInvariantError";
  readonly profileId: string;

  constructor(profileId: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.profileId = profileId;
  }
}

export interface AssembleProductionManifestInput {
  readonly job: RenderJob;
  readonly profile: CertificationProfile;
  readonly renderResult: ExecuteProfileRenderResult;
  readonly mediaObjects: readonly PutObjectInput[];
  readonly liveProvenance?: CertificationProvenanceReport | undefined;
  readonly workflow?: RenderWorkflow | undefined;
  readonly approvedCandidateId?: CandidateId | undefined;
  readonly conditioningImage?:
    | {
        readonly resolved: ResolvedApprovedVisualProductionMedia;
        readonly stagedAs: { readonly name: string; readonly subfolder: string };
        readonly injectionTarget: {
          readonly nodeId: string;
          readonly classType: string;
          readonly inputField: string;
        };
      }
    | undefined;
  readonly routingMode?: ShotPlanRoutingMode | undefined;
  readonly shotPlan?: ManifestShotPlanReference | undefined;
  readonly executedInstruction?: ManifestExecutedInstruction | undefined;
  readonly referenceImages?: readonly ManifestReferenceImageEntry[] | undefined;
  readonly firstFrame?: ManifestFrameAnchorEntry | undefined;
  readonly lastFrame?: ManifestFrameAnchorEntry | undefined;
  readonly previsReviewEvidence?: ManifestPrevisReviewEvidence | undefined;
  readonly submittedWorkflowHash?: string | undefined;
}

export type ProductionManifestAssembler =
  | {
      assembleManifest?: (
        input: AssembleProductionManifestInput
      ) =>
        | Promise<
            | { manifestPayload: Readonly<Record<string, unknown>> }
            | Readonly<Record<string, unknown>>
          >
        | { manifestPayload: Readonly<Record<string, unknown>> }
        | Readonly<Record<string, unknown>>;
      assemble?: (
        input: AssembleProductionManifestInput
      ) =>
        | Promise<
            | { manifestPayload: Readonly<Record<string, unknown>> }
            | Readonly<Record<string, unknown>>
          >
        | { manifestPayload: Readonly<Record<string, unknown>> }
        | Readonly<Record<string, unknown>>;
    }
  | ((
      input: AssembleProductionManifestInput
    ) =>
      | Promise<
          { manifestPayload: Readonly<Record<string, unknown>> } | Readonly<Record<string, unknown>>
        >
      | { manifestPayload: Readonly<Record<string, unknown>> }
      | Readonly<Record<string, unknown>>);

export interface RenderJobExecutorDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile | undefined;
  readonly readApprovedProvenance?: ((filePath: string) => Promise<unknown>) | undefined;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance | undefined;
  readonly verifyGoldMasterProvenance?: typeof verifyGoldMasterProvenance | undefined;
  readonly readWorkflowFile?: ((filePath: string) => Promise<string>) | undefined;
  readonly hashWorkflow?: typeof hashWorkflow | undefined;
  readonly hashBytes?: HashBytesPort | undefined;
  readonly executeProfileRender?:
    ((input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult>) | undefined;
  readonly useCase?:
    | {
        execute: (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult>;
        enforceLicense?: (input: {
          renderJobId: string;
          sceneId: string;
          renderProfileKey: string;
          renderProfileVersion: number;
        }) => void;
      }
    | undefined;
  readonly enforceLicenseRouting?: EnforceLicenseRouting | undefined;
  readonly outputReader?: ComfyUiOutputReader | undefined;
  readonly productionManifestAssembler?: ProductionManifestAssembler | undefined;
  readonly resolveApprovedCandidateMedia?:
    | {
        execute: (input: {
          sceneId: SceneId;
          approvedCandidateId: CandidateId;
        }) => Promise<ResolvedApprovedVisualProductionMedia>;
      }
    | undefined;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly stageReferenceImage?: ComfyUiInputStagingPort | undefined;
  readonly referenceAssetRepository?: ReferenceAssetRepository | undefined;
  readonly shotPlanRepository?: ShotPlanRepository | undefined;
  readonly sceneRepository?: SceneRepository | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface RenderJobExecutorOptions {
  readonly manifestPath?: string | undefined;
  readonly goldMasterProvenancePath?: string | undefined;
  readonly comfyUiDir?: string | undefined;
  readonly candidateBucket?: string | undefined;
  readonly deliveryBucket?: string | undefined;
  readonly buildObjectKey?:
    | ((sceneId: string, jobId: string, outputKey: string, contentHashSha256: string) => string)
    | undefined;
}

const CONTENT_TYPE_TO_EXTENSION: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg"
};

export function buildDeterministicStagingFilename(
  sceneId: string,
  jobId: string,
  sha256: string,
  contentType: string
): string {
  const sanitizedSceneId = sceneId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const sanitizedJobId = jobId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const mimeType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = CONTENT_TYPE_TO_EXTENSION[mimeType] ?? ".png";
  const digestSegment = sha256.slice(0, 16);
  return `cco-${sanitizedSceneId}-${sanitizedJobId}-${digestSegment}${ext}`;
}

export function buildDeterministicObjectKey(
  sceneId: string,
  jobId: string,
  outputKey: string,
  contentHashSha256: string
): string {
  const sanitizedSceneId = sceneId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const sanitizedJobId = jobId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = outputKey.split("/").pop() ?? outputKey;
  const sanitizedFilename = filename.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const digestSegment = contentHashSha256.slice(0, 16);
  return `scenes/${sanitizedSceneId}/jobs/${sanitizedJobId}/${digestSegment}-${sanitizedFilename}`;
}

interface ValidatedInjectedPayload {
  readonly prompt?: string | undefined;
  readonly negativePrompt?: string | undefined;
  readonly audioPrompt?: string | undefined;
  readonly seed?: number | undefined;
  readonly variantOrdinal?: number | undefined;
  readonly approvedCandidateId?: CandidateId | undefined;
  readonly frameCount?: number | undefined;
  readonly referenceImage?: string | undefined;
  readonly referenceImages?: readonly string[] | undefined;
  readonly shotPlanId?: string | undefined;
  readonly specRevision?: number | undefined;
}

const ALLOWED_CANDIDATE_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "seed",
  "variantOrdinal",
  "shotPlanId",
  "specRevision"
]);
const ALLOWED_PRODUCTION_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "audioPrompt",
  "seed",
  "approvedCandidateId",
  "frameCount"
]);
const ALLOWED_REF2V_PRODUCTION_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "audioPrompt",
  "seed",
  "frameCount",
  "shotPlanId",
  "specRevision"
]);

function validateInjectedPayload(
  payload: unknown,
  jobKind: JobKind,
  profile?: CertificationProfile | undefined
): ValidatedInjectedPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RenderJobPayloadValidationError("injectedPayload must be an object");
  }

  const isRef2v =
    profile?.engine === "minimax_h3_ref2v" ||
    profile?.renderProfileIdentity?.key === "MINIMAX_H3_720P_5S_REF2V_V1" ||
    profile?.id === "minimax-h3-720p-124f-ref2v";

  const allowedKeys =
    jobKind === "candidate"
      ? ALLOWED_CANDIDATE_KEYS
      : isRef2v
        ? ALLOWED_REF2V_PRODUCTION_KEYS
        : ALLOWED_PRODUCTION_KEYS;
  const keys = Object.keys(payload);

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      if (jobKind === "production" && key === "variantOrdinal") {
        throw new RenderJobPayloadValidationError(
          "variantOrdinal is candidate-only and not allowed in production jobs"
        );
      }
      if (jobKind === "production" && !isRef2v && key === "shotPlanId") {
        throw new RenderJobPayloadValidationError(
          "shotPlanId is candidate-only and not allowed in production jobs"
        );
      }
      if (jobKind === "production" && !isRef2v && key === "specRevision") {
        throw new RenderJobPayloadValidationError(
          "specRevision is candidate-only and not allowed in production jobs"
        );
      }
      if (jobKind === "candidate" && key === "approvedCandidateId") {
        throw new RenderJobPayloadValidationError(
          "approvedCandidateId is production-only and not allowed in candidate jobs"
        );
      }
      if (jobKind === "candidate" && key === "audioPrompt") {
        throw new RenderJobPayloadValidationError(
          "audioPrompt is production-only and not allowed in candidate jobs"
        );
      }
      if (jobKind === "candidate" && key === "frameCount") {
        throw new RenderJobPayloadValidationError(
          "frameCount is production-only and not allowed in candidate jobs"
        );
      }
      throw new RenderJobPayloadValidationError(`Unknown injected payload field: "${key}"`);
    }
  }

  if (jobKind === "production" && isRef2v) {
    const raw = payload as Record<string, unknown>;
    if (
      !("shotPlanId" in raw) ||
      raw.shotPlanId === undefined ||
      !("specRevision" in raw) ||
      raw.specRevision === undefined
    ) {
      throw new RenderJobPayloadValidationError(
        "Production reference-directed jobs require both shotPlanId and specRevision"
      );
    }
  }

  const raw = payload as Record<string, unknown>;
  let prompt: string | undefined;
  let negativePrompt: string | undefined;
  let audioPrompt: string | undefined;
  let seed: number | undefined;
  let variantOrdinal: number | undefined;
  let approvedCandidateId: CandidateId | undefined;
  let frameCount: number | undefined;

  if ("prompt" in raw && raw.prompt !== undefined) {
    if (typeof raw.prompt !== "string") {
      throw new RenderJobPayloadValidationError("injectedPayload.prompt must be a string");
    }
    prompt = raw.prompt;
  }

  if ("negativePrompt" in raw && raw.negativePrompt !== undefined) {
    if (typeof raw.negativePrompt !== "string") {
      throw new RenderJobPayloadValidationError("injectedPayload.negativePrompt must be a string");
    }
    negativePrompt = raw.negativePrompt;
  }

  if ("audioPrompt" in raw && raw.audioPrompt !== undefined) {
    if (jobKind !== "production") {
      throw new RenderJobPayloadValidationError(
        "audioPrompt is production-only and not allowed in candidate jobs"
      );
    }
    if (typeof raw.audioPrompt !== "string" || raw.audioPrompt.trim().length === 0) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.audioPrompt must be a non-empty string"
      );
    }
    if (profile) {
      const profileKey = profile.renderProfileIdentity?.key ?? profile.id ?? profile.engine;
      const topology = getProfileInjectionTopology(profileKey);
      if (profile.renderProfileIdentity && !topology) {
        throw new MissingProfileTopologyError(profile.id, profile.renderProfileIdentity.key);
      }
      if (topology && (topology.audioPrompt === null || !topology.audioPrompt)) {
        throw new RenderJobPayloadValidationError(
          `Profile "${profile.id}" does not support audio generation: audioPrompt is not supported`
        );
      }
    }
    audioPrompt = raw.audioPrompt.trim();
  }

  if ("seed" in raw && raw.seed !== undefined) {
    if (
      typeof raw.seed !== "number" ||
      !Number.isInteger(raw.seed) ||
      !Number.isSafeInteger(raw.seed) ||
      raw.seed < 0
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.seed must be a non-negative safe integer"
      );
    }
    seed = raw.seed;
  }

  if ("approvedCandidateId" in raw && raw.approvedCandidateId !== undefined) {
    if (jobKind !== "production") {
      throw new RenderJobPayloadValidationError(
        "approvedCandidateId is production-only and not allowed in candidate jobs"
      );
    }
    if (
      typeof raw.approvedCandidateId !== "string" ||
      raw.approvedCandidateId.trim().length === 0
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.approvedCandidateId must be a non-empty string"
      );
    }
    approvedCandidateId = raw.approvedCandidateId as CandidateId;
  }

  if ("frameCount" in raw && raw.frameCount !== undefined) {
    if (jobKind !== "production") {
      throw new RenderJobPayloadValidationError(
        "frameCount is production-only and not allowed in candidate jobs"
      );
    }
    if (
      typeof raw.frameCount !== "number" ||
      !Number.isInteger(raw.frameCount) ||
      !Number.isSafeInteger(raw.frameCount)
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.frameCount must be a safe integer"
      );
    }
    const profileKey = profile?.renderProfileIdentity?.key ?? profile?.id ?? profile?.engine;
    const isMinimax =
      profileKey === "MINIMAX_H3_720P_5S_I2V_V1" ||
      (typeof profileKey === "string" && profileKey.toLowerCase().includes("minimax"));

    if (isMinimax) {
      if ((raw.frameCount - MINIMAX_H3_FRAME_GRID_BASE) % MINIMAX_H3_FRAME_GRID_STEP !== 0) {
        throw new RenderJobPayloadValidationError(
          `injectedPayload.frameCount must satisfy (frameCount - ${MINIMAX_H3_FRAME_GRID_BASE}) % ${MINIMAX_H3_FRAME_GRID_STEP} === 0`
        );
      }
      if (
        raw.frameCount < MINIMAX_H3_SUPPORTED_FRAME_RANGE[0] ||
        raw.frameCount > MINIMAX_H3_SUPPORTED_FRAME_RANGE[1]
      ) {
        throw new RenderJobPayloadValidationError(
          `injectedPayload.frameCount must be a safe integer between ${MINIMAX_H3_SUPPORTED_FRAME_RANGE[0]} and ${MINIMAX_H3_SUPPORTED_FRAME_RANGE[1]}`
        );
      }
    } else {
      if ((raw.frameCount - 1) % LTX_FRAME_STEP !== 0) {
        throw new RenderJobPayloadValidationError(
          `injectedPayload.frameCount must satisfy (frameCount - 1) % ${LTX_FRAME_STEP} === 0`
        );
      }
      if (
        raw.frameCount < LTX_SUPPORTED_FRAME_RANGE[0] ||
        raw.frameCount > LTX_SUPPORTED_FRAME_RANGE[1]
      ) {
        throw new RenderJobPayloadValidationError(
          `injectedPayload.frameCount must be a safe integer between ${LTX_SUPPORTED_FRAME_RANGE[0]} and ${LTX_SUPPORTED_FRAME_RANGE[1]}`
        );
      }
    }
    if (profile) {
      const topology = getProfileInjectionTopology(profileKey);
      if (profile.renderProfileIdentity && !topology) {
        throw new MissingProfileTopologyError(profile.id, profile.renderProfileIdentity.key);
      }
      if (topology && !topology.frameCount) {
        throw new RenderJobPayloadValidationError(
          `Profile "${profile.id}" does not support frame-count injection: frameCount is not supported`
        );
      }
    }
    frameCount = raw.frameCount;
  }

  if (jobKind === "candidate") {
    if (raw.variantOrdinal === undefined || raw.variantOrdinal === null) {
      throw new RenderJobPayloadValidationError(
        "Candidate jobs require injectedPayload.variantOrdinal"
      );
    }
    if (
      typeof raw.variantOrdinal !== "number" ||
      !Number.isInteger(raw.variantOrdinal) ||
      raw.variantOrdinal < 1
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.variantOrdinal must be a positive integer"
      );
    }
    variantOrdinal = raw.variantOrdinal;
  }

  let shotPlanId: string | undefined;
  if ("shotPlanId" in raw && raw.shotPlanId !== undefined) {
    if (jobKind !== "candidate" && !isRef2v) {
      throw new RenderJobPayloadValidationError(
        "shotPlanId is candidate-only and not allowed in production jobs"
      );
    }
    if (typeof raw.shotPlanId !== "string" || raw.shotPlanId.trim().length === 0) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.shotPlanId must be a non-empty string"
      );
    }
    shotPlanId = raw.shotPlanId.trim();
  }

  let specRevision: number | undefined;
  if ("specRevision" in raw && raw.specRevision !== undefined) {
    if (jobKind !== "candidate" && !isRef2v) {
      throw new RenderJobPayloadValidationError(
        "specRevision is candidate-only and not allowed in production jobs"
      );
    }
    if (
      typeof raw.specRevision !== "number" ||
      !Number.isInteger(raw.specRevision) ||
      raw.specRevision <= 0
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.specRevision must be a positive integer"
      );
    }
    specRevision = raw.specRevision;
  }

  return {
    prompt,
    negativePrompt,
    audioPrompt,
    seed,
    variantOrdinal,
    approvedCandidateId,
    frameCount,
    shotPlanId,
    specRevision
  };
}

export function validateDeclaredTopology(
  workflow: Record<string, unknown>,
  topology: ProfileInjectionTopology
): void {
  const checkTarget = (target: NodeInjectionTarget, fieldDesc: string) => {
    const node = workflow[target.nodeId];
    if (
      typeof node !== "object" ||
      node === null ||
      (node as { class_type?: string }).class_type !== target.classType ||
      typeof (node as { inputs?: unknown }).inputs !== "object" ||
      (node as { inputs?: unknown }).inputs === null
    ) {
      throw new RenderJobExecutionError(
        `Expected node "${target.nodeId}" to exist with class_type "${target.classType}" and inputs object for ${fieldDesc} injection`
      );
    }
    const inputs = (node as { inputs: Record<string, unknown> }).inputs;
    if (!Object.prototype.hasOwnProperty.call(inputs, target.inputField)) {
      throw new RenderJobExecutionError(
        `Expected node "${target.nodeId}" to exist with class_type "${target.classType}" and inputs object containing "${target.inputField}" for ${fieldDesc} injection`
      );
    }
  };

  checkTarget(topology.prompt, "prompt");
  if (topology.negativePrompt) {
    checkTarget(topology.negativePrompt, "negativePrompt");
  }
  checkTarget(topology.seed, "seed");
  if (topology.audioPrompt) {
    checkTarget(topology.audioPrompt, "audioPrompt");
  }
  if (topology.frameCount) {
    checkTarget(topology.frameCount, "frameCount");
  }
  if (topology.width) {
    checkTarget(topology.width, "width");
  }
  if (topology.height) {
    checkTarget(topology.height, "height");
  }
  if (topology.refImageSize) {
    checkTarget(topology.refImageSize, "refImageSize");
  }
  if (topology.referenceNode) {
    checkTarget(topology.referenceNode, "referenceNode");
  }
  if (topology.referenceImage) {
    checkTarget(topology.referenceImage, "referenceImage");
  }
  if (topology.firstFrame) {
    checkTarget(topology.firstFrame, "firstFrame");
  }
  if (topology.lastFrame) {
    checkTarget(topology.lastFrame, "lastFrame");
  }
  if (topology.referenceImages) {
    for (let i = 0; i < topology.referenceImages.length; i++) {
      checkTarget(topology.referenceImages[i]!, `referenceImages[${i}]`);
    }
    if (topology.referenceNode?.inputField === "ref_images") {
      for (let b = 1; b <= 8; b++) {
        const batchNodeId = String(300 + b);
        const batchNode = workflow[batchNodeId];
        if (
          typeof batchNode !== "object" ||
          batchNode === null ||
          (batchNode as { class_type?: string }).class_type !== "ImageBatch"
        ) {
          throw new RenderJobExecutionError(
            `Topology mismatch for ref_images ImageBatch chain: expected node "${batchNodeId}" with class_type "ImageBatch"`
          );
        }
      }
    }
  }
}

export function mutateWorkflow(
  rawWorkflowJson: string,
  injected: ValidatedInjectedPayload,
  profile?: CertificationProfile | undefined
): RenderWorkflow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawWorkflowJson);
  } catch (err) {
    throw new PreflightError(`Workflow must be a valid JSON string: ${(err as Error).message}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    throw new PreflightError("Workflow must be a non-empty JSON object");
  }

  const workflow = parsed as Record<string, unknown>;
  const profileKey = profile?.renderProfileIdentity?.key ?? profile?.id ?? profile?.engine;
  const topology = getProfileInjectionTopology(profileKey);

  if (profile?.renderProfileIdentity && !topology) {
    throw new MissingProfileTopologyError(profile.id, profile.renderProfileIdentity.key);
  }

  if (injected.referenceImage !== undefined && (!topology || !topology.referenceImage)) {
    throw new ReferenceImageInjectionInvariantError(
      profile?.id ?? "unknown",
      `referenceImage was provided for injection but the profile "${profile?.id ?? "unknown"}" does not declare a referenceImage injection target`
    );
  }

  if (topology) {
    validateDeclaredTopology(workflow, topology);

    if (injected.prompt !== undefined) {
      const node = workflow[topology.prompt.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.prompt.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.prompt.nodeId}" to exist with class_type "${topology.prompt.classType}" and inputs object for prompt injection`
        );
      }
      (node as { inputs: Record<string, unknown> }).inputs[topology.prompt.inputField] =
        injected.prompt;
    }

    if (injected.negativePrompt !== undefined) {
      if (!topology.negativePrompt) {
        throw new RenderJobExecutionError(
          `Profile "${profile?.id ?? "unknown"}" does not declare a negativePrompt injection target`
        );
      }
      const node = workflow[topology.negativePrompt.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.negativePrompt.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.negativePrompt.nodeId}" to exist with class_type "${topology.negativePrompt.classType}" and inputs object for negativePrompt injection`
        );
      }
      (node as { inputs: Record<string, unknown> }).inputs[topology.negativePrompt.inputField] =
        injected.negativePrompt;
    }

    if (injected.seed !== undefined) {
      const node = workflow[topology.seed.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.seed.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.seed.nodeId}" to exist with class_type "${topology.seed.classType}" and inputs object for seed injection`
        );
      }
      (node as { inputs: Record<string, unknown> }).inputs[topology.seed.inputField] =
        injected.seed;
    }

    if (injected.audioPrompt !== undefined) {
      if (topology.audioPrompt === null || !topology.audioPrompt) {
        throw new RenderJobExecutionError(
          `Profile "${profile?.id ?? "unknown"}" does not support audio generation: audioPrompt is not supported for workflow template`
        );
      }
      const node = workflow[topology.audioPrompt.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.audioPrompt.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.audioPrompt.nodeId}" to exist with class_type "${topology.audioPrompt.classType}" and inputs object for audioPrompt injection`
        );
      }
      (node as { inputs: Record<string, unknown> }).inputs[topology.audioPrompt.inputField] =
        injected.audioPrompt;
    }

    if (injected.frameCount !== undefined) {
      if (!topology.frameCount) {
        throw new RenderJobExecutionError(
          `Profile "${profile?.id ?? "unknown"}" does not declare a frameCount injection target`
        );
      }
      const node = workflow[topology.frameCount.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.frameCount.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.frameCount.nodeId}" to exist with class_type "${topology.frameCount.classType}" and inputs object for frameCount injection`
        );
      }
      (node as { inputs: Record<string, unknown> }).inputs[topology.frameCount.inputField] =
        injected.frameCount;
    }

    if (topology.referenceImage) {
      if (
        typeof injected.referenceImage !== "string" ||
        injected.referenceImage.trim().length === 0
      ) {
        throw new ReferenceImageInjectionInvariantError(
          profile?.id ?? "unknown",
          `Profile "${profile?.id ?? "unknown"}" declares a referenceImage injection target but no referenceImage value was provided for injection`
        );
      }
      const node = workflow[topology.referenceImage.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.referenceImage.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.referenceImage.nodeId}" to exist with class_type "${topology.referenceImage.classType}" and inputs object for referenceImage injection`
        );
      }
      (node as { inputs: Record<string, unknown> }).inputs[topology.referenceImage.inputField] =
        injected.referenceImage;
    } else if (injected.referenceImage !== undefined) {
      throw new ReferenceImageInjectionInvariantError(
        profile?.id ?? "unknown",
        `referenceImage was provided for injection but the profile "${profile?.id ?? "unknown"}" does not declare a referenceImage injection target`
      );
    }

    if (topology.referenceImages) {
      const stagedRefImages = injected.referenceImages ?? [];
      const N = stagedRefImages.length;
      if (N > 9) {
        throw new RenderJobExecutionError(`Cannot inject more than 9 reference images (got ${N})`);
      }

      // 1. Inject active references for slots 1..N
      for (let i = 0; i < N; i++) {
        const target = topology.referenceImages[i]!;
        const node = workflow[target.nodeId];
        if (
          typeof node !== "object" ||
          node === null ||
          (node as { class_type?: string }).class_type !== target.classType ||
          typeof (node as { inputs?: unknown }).inputs !== "object" ||
          (node as { inputs?: unknown }).inputs === null
        ) {
          throw new RenderJobExecutionError(
            `Expected node "${target.nodeId}" to exist with class_type "${target.classType}" and inputs object for reference image injection`
          );
        }
        (node as { inputs: Record<string, unknown> }).inputs[target.inputField] =
          stagedRefImages[i];
      }

      // 2. Remove unused reference loader nodes (slots N+1..9)
      for (let i = N; i < topology.referenceImages.length; i++) {
        const target = topology.referenceImages[i]!;
        delete workflow[target.nodeId];
      }

      // 3. Connect ref_images on referenceNode and prune ImageBatch chain (nodes 301..308)
      const refNode = topology.referenceNode ? workflow[topology.referenceNode.nodeId] : undefined;
      const refNodeInputs =
        typeof refNode === "object" && refNode !== null && "inputs" in refNode
          ? (refNode as { inputs: Record<string, unknown> }).inputs
          : undefined;

      if (refNodeInputs) {
        if (topology.referenceNode?.inputField === "ref_images") {
          // MiniMax-H3 native ref_images via ImageBatch chain
          if (N === 0) {
            // Delete all batch nodes 301..308
            for (let b = 1; b <= 8; b++) {
              delete workflow[String(300 + b)];
            }
            // In node 105: remove ref_images input completely for prompt-only execution
            delete refNodeInputs.ref_images;
          } else if (N === 1) {
            // Delete all batch nodes 301..308
            for (let b = 1; b <= 8; b++) {
              delete workflow[String(300 + b)];
            }
            // Connect ref_images directly to loader 201
            refNodeInputs.ref_images = ["201", 0];
          } else {
            // N >= 2: keep batch nodes 301 .. (300 + N - 1)
            // Delete batch nodes (300 + N) .. 308
            for (let b = N; b <= 8; b++) {
              delete workflow[String(300 + b)];
            }
            // Connect ref_images to the last kept batch node: 300 + N - 1
            refNodeInputs.ref_images = [String(300 + N - 1), 0];
          }
        }
      }

      if (topology.refImageSize && refNodeInputs) {
        refNodeInputs[topology.refImageSize.inputField] = "max";
      }
      if (topology.width && refNodeInputs && profile?.baseline.width) {
        refNodeInputs[topology.width.inputField] = profile.baseline.width;
      }
      if (topology.height && refNodeInputs && profile?.baseline.height) {
        refNodeInputs[topology.height.inputField] = profile.baseline.height;
      }
    }
  } else {
    if (injected.referenceImage !== undefined) {
      throw new ReferenceImageInjectionInvariantError(
        profile?.id ?? "unknown",
        `referenceImage was provided for injection but no topology is declared for profile "${profile?.id ?? "unknown"}"`
      );
    }
    if (injected.prompt !== undefined) {
      const node3 = workflow["3"];
      if (
        typeof node3 !== "object" ||
        node3 === null ||
        (node3 as { class_type?: string }).class_type !== "CLIPTextEncode" ||
        typeof (node3 as { inputs?: unknown }).inputs !== "object" ||
        (node3 as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          'Expected node "3" to exist with class_type "CLIPTextEncode" and inputs object for prompt injection'
        );
      }
      (node3 as { inputs: Record<string, unknown> }).inputs.text = injected.prompt;
    }

    if (injected.negativePrompt !== undefined) {
      const node4 = workflow["4"];
      if (
        typeof node4 !== "object" ||
        node4 === null ||
        (node4 as { class_type?: string }).class_type !== "CLIPTextEncode" ||
        typeof (node4 as { inputs?: unknown }).inputs !== "object" ||
        (node4 as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          'Expected node "4" to exist with class_type "CLIPTextEncode" and inputs object for negativePrompt injection'
        );
      }
      (node4 as { inputs: Record<string, unknown> }).inputs.text = injected.negativePrompt;
    }

    if (injected.seed !== undefined) {
      const node1 = workflow["1"];
      if (
        typeof node1 !== "object" ||
        node1 === null ||
        (node1 as { class_type?: string }).class_type !== "KSampler" ||
        typeof (node1 as { inputs?: unknown }).inputs !== "object" ||
        (node1 as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          'Expected node "1" to exist with class_type "KSampler" and inputs object for seed injection'
        );
      }
      (node1 as { inputs: Record<string, unknown> }).inputs.seed = injected.seed;
    }

    if (injected.audioPrompt !== undefined) {
      const audioTargets = findAudioPromptTargets(workflow);
      if (audioTargets.length === 0) {
        throw new RenderJobExecutionError(
          "No compatible audio prompt node found in workflow for audioPrompt injection"
        );
      }
      if (audioTargets.length > 1) {
        throw new RenderJobExecutionError(
          `Multiple ambiguous audio prompt target nodes found in workflow for audioPrompt injection: [${audioTargets.map((t) => t.nodeId).join(", ")}]`
        );
      }
      const target = audioTargets[0]!;
      const targetNode = workflow[target.nodeId] as { inputs: Record<string, unknown> };
      targetNode.inputs[target.inputField] = injected.audioPrompt;
    }
  }

  return workflow as RenderWorkflow;
}

export function createCertifiedRenderJobExecutor(
  deps?: RenderJobExecutorDependencies,
  options?: RenderJobExecutorOptions
): RenderJobExecutor {
  const loadCertificationProfileFn = deps?.loadCertificationProfile ?? loadCertificationProfile;
  const readApprovedProvenanceFn =
    deps?.readApprovedProvenance ??
    (async (filePath: string) => {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content);
    });
  const collectCertificationProvenanceFn =
    deps?.collectCertificationProvenance ?? collectCertificationProvenance;
  const verifyGoldMasterProvenanceFn =
    deps?.verifyGoldMasterProvenance ?? verifyGoldMasterProvenance;
  const readWorkflowFileFn =
    deps?.readWorkflowFile ?? ((filePath: string) => readFile(filePath, "utf8"));
  const hashWorkflowFn = deps?.hashWorkflow ?? hashWorkflow;
  const hashBytesPort: HashBytesPort = deps?.hashBytes ?? {
    hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  };
  const now = deps?.now ?? (() => new Date());
  const buildObjectKeyFn = options?.buildObjectKey ?? buildDeterministicObjectKey;

  const candidateBucket = options?.candidateBucket ?? BUCKETS.REVIEW;
  const deliveryBucket = options?.deliveryBucket ?? BUCKETS.DELIVERY;

  const manifestPath = options?.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const goldMasterProvenancePath = options?.goldMasterProvenancePath ?? manifestPath;
  const comfyUiDir = options?.comfyUiDir ?? process.env.COMFYUI_DIR ?? "";

  return async (job: RenderJob): Promise<WorkerRenderOutput> => {
    // 1. Resolve certified profile
    let profile: Awaited<ReturnType<typeof loadCertificationProfileFn>>;
    try {
      profile = await loadCertificationProfileFn(manifestPath, job.workflowTemplate);
    } catch (cause) {
      const resolvedKey = RENDER_PROFILE_ALIASES[job.workflowTemplate];
      if (
        resolvedKey === "MINIMAX_H3_720P_5S_I2V_V1" &&
        job.workflowTemplate !== "minimax-h3-720p-124f-i2v"
      ) {
        try {
          profile = await loadCertificationProfileFn(manifestPath, "minimax-h3-720p-124f-i2v");
        } catch {
          throw new MissingCertifiedProfileError(job.workflowTemplate, { cause });
        }
      } else {
        throw new MissingCertifiedProfileError(job.workflowTemplate, { cause });
      }
    }
    if (!profile.renderProfileIdentity) {
      throw new PreflightError(
        `Profile "${profile.id}" does not define renderProfileIdentity in manifest`
      );
    }

    const topology = getProfileInjectionTopology(
      profile.renderProfileIdentity?.key ?? profile.id ?? profile.engine
    );
    if (profile.renderProfileIdentity && !topology) {
      throw new MissingProfileTopologyError(profile.id, profile.renderProfileIdentity.key);
    }

    // 2. Validate injectedPayload with profile awareness
    const validatedInjected = validateInjectedPayload(job.injectedPayload, job.jobKind, profile);

    // 3. Approved provenance & live provenance collection & verification
    const approvedProvenance = await readApprovedProvenanceFn(goldMasterProvenancePath);
    const liveProvenance = await collectCertificationProvenanceFn({
      comfyUiDir,
      profile,
      now
    });

    verifyGoldMasterProvenanceFn({
      approved: approvedProvenance,
      live: liveProvenance,
      profile
    });

    // 4. Read workflow, verify hash, mutate workflow
    const rawWorkflow = await readWorkflowFileFn(profile.workflowPath);
    const recheckedWorkflowHash = hashWorkflowFn(rawWorkflow);

    if (
      recheckedWorkflowHash !== liveProvenance.workflow.sha256 ||
      recheckedWorkflowHash !== profile.expectedWorkflowHash
    ) {
      throw new WorkflowHashMismatchError(
        `Workflow hash mismatch after collection: rechecked "${recheckedWorkflowHash}", live "${liveProvenance.workflow.sha256}", expected "${profile.expectedWorkflowHash}"`
      );
    }

    if (!liveProvenance.renderProfileProvenance) {
      throw new PreflightError(
        `Live provenance for profile "${profile.id}" is missing renderProfileProvenance`
      );
    }

    // Authoritative license routing guard evaluated BEFORE any external I/O (S3 reads, ComfyUI staging, GPU lease)
    if (deps?.enforceLicenseRouting) {
      deps.enforceLicenseRouting.enforce({
        requiredComponents: [
          {
            componentId: profile.renderProfileIdentity.key,
            componentType: "model",
            versionOrRevision: String(profile.renderProfileIdentity.version)
          }
        ],
        operation: {
          kind: "generation",
          renderJobId: job.jobId,
          sceneId: job.sceneId
        }
      });
    } else if (
      deps?.useCase &&
      "enforceLicense" in deps.useCase &&
      typeof deps.useCase.enforceLicense === "function"
    ) {
      deps.useCase.enforceLicense({
        renderJobId: job.jobId,
        sceneId: job.sceneId,
        renderProfileKey: profile.renderProfileIdentity.key,
        renderProfileVersion: profile.renderProfileIdentity.version
      });
    }

    const isRef2v =
      profile.engine === "minimax_h3_ref2v" ||
      profile.renderProfileIdentity.key === "MINIMAX_H3_720P_5S_REF2V_V1" ||
      profile.id === "minimax-h3-720p-124f-ref2v";

    let resolvedCandidateMedia: ResolvedApprovedVisualProductionMedia | undefined;
    let stagedReferenceImage: StagedComfyUiInput | undefined;
    let stagingFilename: string | undefined;

    const stagedRefInputs: StagedComfyUiInput[] = [];
    const manifestRefImages: ManifestReferenceImageEntry[] = [];
    const stagedRefPaths: string[] = [];
    let promptToInject = validatedInjected.prompt;
    let executedInstruction: ManifestExecutedInstruction | undefined;
    let previsReviewEvidence: ManifestPrevisReviewEvidence | undefined;

    try {
      if (isRef2v) {
        // Reference-directed MiniMax-H3 execution
        if (!deps?.shotPlanRepository) {
          throw new RenderJobExecutionError(
            "shotPlanRepository dependency is required for reference-directed execution"
          );
        }
        if (!deps?.referenceAssetRepository) {
          throw new RenderJobExecutionError(
            "referenceAssetRepository dependency is required for reference-directed execution"
          );
        }
        if (!validatedInjected.shotPlanId) {
          throw new RenderJobExecutionError(
            "injectedPayload.shotPlanId is required for reference-directed execution"
          );
        }
        if (!validatedInjected.specRevision) {
          throw new RenderJobExecutionError(
            "injectedPayload.specRevision is required for reference-directed execution"
          );
        }

        const shotPlanDomain = await deps.shotPlanRepository.findById(
          validatedInjected.shotPlanId as ShotPlanId
        );
        if (!shotPlanDomain) {
          throw new RenderJobExecutionError(
            `ShotPlan "${validatedInjected.shotPlanId}" not found in shotPlanRepository`
          );
        }
        const shotPlanDoc = shotPlanDomain.snapshot();

        if (shotPlanDoc.status !== "approved") {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" must be approved, got status "${shotPlanDoc.status}"`
          );
        }
        if (shotPlanDoc.sceneId !== job.sceneId) {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" belongs to scene "${shotPlanDoc.sceneId}", but render job is for scene "${job.sceneId}"`
          );
        }
        if (shotPlanDoc.specRevision !== validatedInjected.specRevision) {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" specRevision ${shotPlanDoc.specRevision} does not match injected specRevision ${validatedInjected.specRevision}`
          );
        }
        if (shotPlanDoc.routingMode !== "reference_directed") {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" routingMode must be "reference_directed", got "${shotPlanDoc.routingMode}"`
          );
        }

        let sceneSpec: { revision: number; actionContext?: string; scriptContext?: string } = {
          revision: validatedInjected.specRevision
        };

        if (deps?.sceneRepository) {
          const sceneDomain = await deps.sceneRepository.findById(job.sceneId as SceneId);
          if (!sceneDomain) {
            throw new RenderJobExecutionError(
              `Scene "${job.sceneId}" not found in sceneRepository`
            );
          }
          const sceneSnapshot = sceneDomain.snapshot();
          if (sceneSnapshot.specRevision !== validatedInjected.specRevision) {
            throw new RenderJobExecutionError(
              `Scene "${job.sceneId}" specRevision ${sceneSnapshot.specRevision} does not match injected specRevision ${validatedInjected.specRevision}`
            );
          }
          if (
            sceneSnapshot.approvedShotPlanId &&
            sceneSnapshot.approvedShotPlanId !== validatedInjected.shotPlanId
          ) {
            throw new RenderJobExecutionError(
              `Scene "${job.sceneId}" approvedShotPlanId "${sceneSnapshot.approvedShotPlanId}" does not match injected shotPlanId "${validatedInjected.shotPlanId}"`
            );
          }
          if (
            sceneSnapshot.selectedShotPlanId &&
            sceneSnapshot.selectedShotPlanId !== validatedInjected.shotPlanId
          ) {
            throw new RenderJobExecutionError(
              `Scene "${job.sceneId}" selectedShotPlanId "${sceneSnapshot.selectedShotPlanId}" does not match injected shotPlanId "${validatedInjected.shotPlanId}"`
            );
          }
          sceneSpec = {
            revision: validatedInjected.specRevision,
            actionContext: sceneSnapshot.configuration?.prompt
          };
        }

        const rawAssets = await deps.referenceAssetRepository.listBySceneId(job.sceneId as SceneId);
        const assetsById = new Map<string, DomainReferenceAsset>(rawAssets.map((a) => [a.id, a]));

        let rawBindings: readonly SceneReferenceBinding[] = [];
        if (deps.referenceAssetRepository.listBindingsBySceneId) {
          rawBindings = await deps.referenceAssetRepository.listBindingsBySceneId(
            job.sceneId as SceneId,
            {
              specRevision: validatedInjected.specRevision
            }
          );
        }

        const canonicalRefs = canonicalizeReferenceBindings({
          bindings: rawBindings,
          assetsById
        });

        if (canonicalRefs.length > 0) {
          if (!deps?.objectStorage) {
            throw new RenderJobExecutionError(
              "objectStorage dependency is required for reference image staging"
            );
          }
          if (!deps?.stageReferenceImage) {
            throw new RenderJobExecutionError(
              "stageReferenceImage dependency is required for reference image staging"
            );
          }

          for (const ref of canonicalRefs) {
            const stored = await deps.objectStorage.getObject(
              { bucket: ref.asset.storageBucket, key: ref.asset.storageObjectKey },
              { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
            );
            if (!stored || !stored.body || stored.body.byteLength === 0) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" is missing or empty in storage`
              );
            }

            const actualSha256 = await hashBytesPort.hashBytes(stored.body);
            if (actualSha256 !== ref.asset.contentHashSha256) {
              throw new ReferenceImageIntegrityError(
                `Reference image sha256 mismatch for asset "${ref.referenceAssetId}": expected "${ref.asset.contentHashSha256}", got "${actualSha256}"`
              );
            }

            const refStagingFilename = buildDeterministicStagingFilename(
              job.sceneId,
              `${job.jobId}-slot${ref.slotIndex}`,
              actualSha256,
              ref.asset.mimeType ?? "image/png"
            );

            let stagedInput: StagedComfyUiInput;
            try {
              stagedInput = await deps.stageReferenceImage.stage({
                filename: refStagingFilename,
                bytes: stored.body,
                contentType: ref.asset.mimeType ?? "image/png"
              });
            } catch (cause) {
              throw new ReferenceImageStagingError(
                `Failed to stage reference image "${refStagingFilename}": ${(cause as Error).message}`,
                { cause }
              );
            }
            stagedRefInputs.push(stagedInput);

            const stagedPath = stagedInput.subfolder
              ? `${stagedInput.subfolder}/${stagedInput.name}`
              : stagedInput.name;
            stagedRefPaths.push(stagedPath);

            const injectionTarget = topology!.referenceImages![ref.slotIndex - 1]!;
            manifestRefImages.push({
              slotIndex: ref.slotIndex,
              promptTag: ref.promptTag,
              assetId: ref.referenceAssetId,
              contentHashSha256: actualSha256,
              role: ref.role,
              stagedAs: { name: stagedInput.name, subfolder: stagedInput.subfolder },
              injectionTarget: {
                nodeId: injectionTarget.nodeId,
                classType: injectionTarget.classType,
                inputField: injectionTarget.inputField
              }
            });
          }
        }

        if (shotPlanDoc.previs) {
          previsReviewEvidence = {
            candidateId: shotPlanDoc.previs.candidateId,
            contentHashSha256: shotPlanDoc.previs.contentHashSha256,
            specRevision: shotPlanDoc.specRevision,
            variantOrdinal: shotPlanDoc.variantOrdinal,
            storageBucket: shotPlanDoc.previs.storageBucket,
            storageObjectKey: shotPlanDoc.previs.storageObjectKey
          };
        }

        const compiled = compileShotPlan({
          shotPlan: shotPlanDoc,
          sceneSpec,
          references: canonicalRefs,
          routingMode: "reference_directed"
        });
        promptToInject = compiled.instructionText;
        executedInstruction = {
          text: compiled.instructionText,
          sha256: compiled.instructionHashSha256,
          byteLength: compiled.instructionBytes.byteLength
        };
      } else if (topology?.referenceImage) {
        if (!deps?.resolveApprovedCandidateMedia) {
          throw new RenderJobExecutionError(
            "resolveApprovedCandidateMedia dependency is required for reference image conditioning"
          );
        }
        if (!deps?.objectStorage) {
          throw new RenderJobExecutionError(
            "objectStorage dependency is required for reference image conditioning"
          );
        }
        if (!deps?.stageReferenceImage) {
          throw new RenderJobExecutionError(
            "stageReferenceImage dependency is required for reference image conditioning"
          );
        }
        if (!validatedInjected.approvedCandidateId) {
          throw new MissingApprovedCandidateForConditioningError(
            `Workflow template "${job.workflowTemplate}" requires an approved candidate for conditioning, but injectedPayload.approvedCandidateId was not provided`
          );
        }

        resolvedCandidateMedia = await deps.resolveApprovedCandidateMedia.execute({
          sceneId: job.sceneId as SceneId,
          approvedCandidateId: validatedInjected.approvedCandidateId
        });

        const stored = await deps.objectStorage.getObject(
          {
            bucket: resolvedCandidateMedia.media.bucket,
            key: resolvedCandidateMedia.media.key
          },
          { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
        );

        if (!stored || !stored.body || stored.body.byteLength === 0) {
          throw new ReferenceImageIntegrityError(
            `Reference image object "${resolvedCandidateMedia.media.key}" is missing or empty in storage`
          );
        }

        const actualSha256 = await hashBytesPort.hashBytes(stored.body);
        if (actualSha256 !== resolvedCandidateMedia.media.sha256) {
          throw new ReferenceImageIntegrityError(
            `Reference image sha256 mismatch: expected "${resolvedCandidateMedia.media.sha256}", got "${actualSha256}"`
          );
        }

        stagingFilename = buildDeterministicStagingFilename(
          job.sceneId,
          job.jobId,
          actualSha256,
          resolvedCandidateMedia.media.contentType ?? "image/png"
        );

        try {
          stagedReferenceImage = await deps.stageReferenceImage.stage({
            filename: stagingFilename,
            bytes: stored.body,
            contentType: resolvedCandidateMedia.media.contentType ?? "image/png"
          });
        } catch (cause) {
          throw new ReferenceImageStagingError(
            `Failed to stage reference image "${stagingFilename}": ${(cause as Error).message}`,
            { cause }
          );
        }
      }

      if (stagedReferenceImage) {
        if (
          stagedReferenceImage.name.includes("/") ||
          stagedReferenceImage.name.includes("\\") ||
          stagedReferenceImage.name.includes("..") ||
          stagedReferenceImage.name === "."
        ) {
          throw new RenderJobExecutionError(
            `Staged reference image returned unsafe filename with path traversal: "${stagedReferenceImage.name}"`
          );
        }
        if (stagingFilename && stagedReferenceImage.name !== stagingFilename) {
          throw new RenderJobExecutionError(
            `Staged reference image name "${stagedReferenceImage.name}" did not match requested staging filename "${stagingFilename}"`
          );
        }
        if (stagedReferenceImage.subfolder) {
          if (
            stagedReferenceImage.subfolder.includes("/") ||
            stagedReferenceImage.subfolder.includes("\\") ||
            stagedReferenceImage.subfolder.includes("..") ||
            stagedReferenceImage.subfolder === "."
          ) {
            throw new RenderJobExecutionError(
              `Staged reference image returned unsafe subfolder with path traversal: "${stagedReferenceImage.subfolder}"`
            );
          }
        }
      }

      const referenceImageValue = stagedReferenceImage
        ? stagedReferenceImage.subfolder
          ? `${stagedReferenceImage.subfolder}/${stagedReferenceImage.name}`
          : stagedReferenceImage.name
        : undefined;

      const mutatedWorkflow = mutateWorkflow(
        rawWorkflow,
        {
          ...validatedInjected,
          ...(promptToInject !== undefined ? { prompt: promptToInject } : {}),
          ...(referenceImageValue !== undefined ? { referenceImage: referenceImageValue } : {}),
          ...(isRef2v ? { referenceImages: stagedRefPaths } : {})
        },
        profile
      );

      // 5. Construct ProfileRenderIdentity
      const identity: ProfileRenderIdentity = Object.freeze({
        profileId: profile.id,
        renderProfileKey: profile.renderProfileIdentity.key,
        renderProfileVersion: profile.renderProfileIdentity.version,
        engine: profile.engine as
          "ltx_25" | "flux_schnell" | "ltx_25_i2v" | "minimax_h3_i2v" | "minimax_h3_ref2v",
        workflowSha256: recheckedWorkflowHash,
        modelSha256: liveProvenance.renderProfileProvenance.modelHashes,
        runnerProfile: profile.runnerProfile,
        comfyUiCommit: liveProvenance.git.comfyUiCommit
      });

      // 6. Execute render exactly once
      const executeInput: ExecuteProfileRenderInput = {
        renderJobId: job.jobId,
        sceneId: job.sceneId,
        workflow: mutatedWorkflow,
        identity
      };

      let renderResult: ExecuteProfileRenderResult;
      if (deps?.executeProfileRender) {
        renderResult = await deps.executeProfileRender(executeInput);
      } else if (deps?.useCase) {
        renderResult = await deps.useCase.execute(executeInput);
      } else {
        throw new RenderJobExecutionError(
          "No render execution useCase or executeProfileRender provided"
        );
      }

      // 7. Output cardinality checks
      if (job.jobKind === "candidate") {
        if (renderResult.outputObjectKeys.length !== 1) {
          throw new CandidateOutputCardinalityError(
            `Candidate job requires exactly 1 output object key, received: ${renderResult.outputObjectKeys.length}`
          );
        }
      } else {
        if (renderResult.outputObjectKeys.length === 0) {
          throw new RenderJobExecutionError(
            "Production job requires at least 1 output object key, received 0"
          );
        }
      }

      // 8. Read outputs, compute hashes, build PutObjectInputs in parallel
      const outputReader = deps?.outputReader ?? new HttpComfyUiOutputReader();
      const bucket = job.jobKind === "candidate" ? candidateBucket : deliveryBucket;

      const mediaObjects: PutObjectInput[] = await Promise.all(
        renderResult.outputObjectKeys.map(async (outputKey) => {
          const output = await outputReader.readOutput(outputKey);
          const checksumSha256 = await hashBytesPort.hashBytes(output.bytes);
          const storageObjectKey = buildObjectKeyFn(
            job.sceneId,
            job.jobId,
            outputKey,
            checksumSha256
          );

          return {
            bucket,
            key: storageObjectKey,
            body: output.bytes,
            checksumSha256,
            ...(output.contentType ? { contentType: output.contentType } : {})
          };
        })
      );

      // 9. Completion payload assembly
      if (job.jobKind === "candidate") {
        const primaryMedia = mediaObjects[0]!;
        const candidatePayload: Readonly<Record<string, unknown>> = Object.freeze({
          variantOrdinal: validatedInjected.variantOrdinal!,
          storageBucket: primaryMedia.bucket,
          storageObjectKey: primaryMedia.key,
          contentHashSha256: primaryMedia.checksumSha256!,
          ...(validatedInjected.shotPlanId ? { shotPlanId: validatedInjected.shotPlanId } : {}),
          ...(validatedInjected.specRevision !== undefined
            ? { specRevision: validatedInjected.specRevision }
            : {}),
          generationPayload: Object.freeze({
            promptIdComfy: renderResult.promptId,
            profile: renderResult.profile,
            originalOutputKey: renderResult.outputObjectKeys[0]!,
            ...(validatedInjected.shotPlanId ? { shotPlanId: validatedInjected.shotPlanId } : {}),
            ...(validatedInjected.specRevision !== undefined
              ? { specRevision: validatedInjected.specRevision }
              : {})
          })
        });

        return {
          mediaObjects: Object.freeze(mediaObjects),
          candidatePayload
        };
      }

      // Production job
      const assembler = deps?.productionManifestAssembler;
      if (!assembler) {
        throw new ProductionManifestAssemblyError(
          "Production render jobs require a ProductionManifestAssembler"
        );
      }

      const assembleInput: AssembleProductionManifestInput = {
        job,
        profile,
        renderResult,
        mediaObjects: Object.freeze(mediaObjects),
        liveProvenance,
        workflow: mutatedWorkflow,
        ...(isRef2v
          ? {
              routingMode: "reference_directed" as const,
              shotPlan: {
                id: validatedInjected.shotPlanId!,
                specRevision: validatedInjected.specRevision!
              },
              executedInstruction,
              referenceImages: manifestRefImages,
              submittedWorkflowHash: hashWorkflowFn(JSON.stringify(mutatedWorkflow)),
              ...(previsReviewEvidence ? { previsReviewEvidence } : {})
            }
          : {
              ...(validatedInjected.approvedCandidateId !== undefined
                ? { approvedCandidateId: validatedInjected.approvedCandidateId }
                : {}),
              ...(resolvedCandidateMedia && stagedReferenceImage && topology?.referenceImage
                ? {
                    conditioningImage: {
                      resolved: resolvedCandidateMedia,
                      stagedAs: {
                        name: stagedReferenceImage.name,
                        subfolder: stagedReferenceImage.subfolder
                      },
                      injectionTarget: {
                        nodeId: topology.referenceImage.nodeId,
                        classType: topology.referenceImage.classType,
                        inputField: topology.referenceImage.inputField
                      }
                    }
                  }
                : {})
            })
      };

      let manifestPayload: Readonly<Record<string, unknown>>;
      if (typeof assembler === "function") {
        const res = await assembler(assembleInput);
        manifestPayload =
          res &&
          typeof res === "object" &&
          "manifestPayload" in res &&
          typeof res.manifestPayload === "object" &&
          res.manifestPayload !== null
            ? (res.manifestPayload as Readonly<Record<string, unknown>>)
            : (res as Readonly<Record<string, unknown>>);
      } else if (typeof assembler.assembleManifest === "function") {
        const res = await assembler.assembleManifest(assembleInput);
        manifestPayload =
          res &&
          typeof res === "object" &&
          "manifestPayload" in res &&
          typeof res.manifestPayload === "object" &&
          res.manifestPayload !== null
            ? (res.manifestPayload as Readonly<Record<string, unknown>>)
            : (res as Readonly<Record<string, unknown>>);
      } else if (typeof assembler.assemble === "function") {
        const res = await assembler.assemble(assembleInput);
        manifestPayload =
          res &&
          typeof res === "object" &&
          "manifestPayload" in res &&
          typeof res.manifestPayload === "object" &&
          res.manifestPayload !== null
            ? (res.manifestPayload as Readonly<Record<string, unknown>>)
            : (res as Readonly<Record<string, unknown>>);
      } else {
        throw new ProductionManifestAssemblyError(
          "ProductionManifestAssembler does not implement assembleManifest or assemble method"
        );
      }

      if (
        typeof manifestPayload !== "object" ||
        manifestPayload === null ||
        Array.isArray(manifestPayload) ||
        Object.keys(manifestPayload).length === 0
      ) {
        throw new ProductionManifestAssemblyError(
          "Production manifest assembler returned an empty or invalid manifest payload"
        );
      }

      return {
        mediaObjects: Object.freeze(mediaObjects),
        manifestPayload: Object.freeze(manifestPayload)
      };
    } finally {
      if (stagedReferenceImage && deps?.stageReferenceImage?.cleanup) {
        try {
          await deps.stageReferenceImage.cleanup(stagedReferenceImage);
        } catch {
          // best-effort cleanup; never fail render on cleanup error
        }
      }
      for (const staged of stagedRefInputs) {
        if (deps?.stageReferenceImage?.cleanup) {
          try {
            await deps.stageReferenceImage.cleanup(staged);
          } catch {
            // best-effort cleanup
          }
        }
      }
    }
  };
}

export const createRenderJobExecutor = createCertifiedRenderJobExecutor;
