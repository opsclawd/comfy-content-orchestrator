import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  type StagedComfyUiInput,
  type CampaignRepository,
  type ImageInspectionPort,
  type ValidatedImageMetadata,
  parseImageByteHeader
} from "@cco/application";
import {
  getProfileInjectionTopology,
  LTX_FPS,
  LTX_FRAME_STEP,
  LTX_SUPPORTED_FRAME_RANGE,
  type ManifestConfiguredMedia,
  type ManifestExecutedInstruction,
  type ManifestFrameAnchorEntry,
  type ManifestMeasuredMedia,
  type ManifestPrevisReviewEvidence,
  type ManifestReferenceImageEntry,
  type ManifestShotPlanReference,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  MINIMAX_H3_SUPPORTED_FRAME_RANGE,
  type NodeInjectionTarget,
  type ProfileInjectionTopology,
  RENDER_PROFILE_ALIASES,
  type ShotPlanRoutingMode
} from "@cco/contracts";
import type {
  CampaignRecord,
  CandidateId,
  JobKind,
  ReferenceAsset as DomainReferenceAsset,
  RenderJob,
  SceneId,
  ShotPlanId
} from "@cco/domain";
import {
  collectCertificationProvenance,
  defaultSpawnRunner,
  demuxAnimatedWebp,
  hashWorkflow,
  HttpComfyUiOutputReader,
  isAnimatedWebp,
  loadCertificationProfile,
  probeMedia,
  type CertificationProfile,
  type CertificationProvenanceReport,
  type ComfyUiOutputReader,
  type SpawnLikeFn
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
  readonly jobId?: string | undefined;
  readonly outputKey?: string | undefined;
  readonly formatPath?: "ffprobe" | "animated_webp_demux" | undefined;

  constructor(
    message: string,
    options?: ErrorOptions & {
      jobId?: string | undefined;
      outputKey?: string | undefined;
      formatPath?: "ffprobe" | "animated_webp_demux" | undefined;
    }
  ) {
    super(message, options);
    this.jobId = options?.jobId;
    this.outputKey = options?.outputKey;
    this.formatPath = options?.formatPath;
  }
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
  readonly attemptId?: string | undefined;
  readonly attemptOrdinal?: number | undefined;
  readonly shotPlan?: ManifestShotPlanReference | undefined;
  readonly executedInstruction?: ManifestExecutedInstruction | undefined;
  readonly referenceImages?: readonly ManifestReferenceImageEntry[] | undefined;
  readonly firstFrame?: ManifestFrameAnchorEntry | undefined;
  readonly lastFrame?: ManifestFrameAnchorEntry | undefined;
  readonly previsReviewEvidence?: ManifestPrevisReviewEvidence | undefined;
  readonly submittedWorkflowHash?: string | undefined;
  readonly configuredMedia?: ManifestConfiguredMedia | undefined;
  readonly measuredMedia?: ManifestMeasuredMedia | undefined;
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
  readonly imageValidator?: ImageInspectionPort | undefined;
  readonly imageInspectionPort?: ImageInspectionPort | undefined;
  readonly referenceAssetRepository?: ReferenceAssetRepository | undefined;
  readonly shotPlanRepository?: ShotPlanRepository | undefined;
  readonly sceneRepository?: SceneRepository | undefined;
  readonly campaignRepository?: CampaignRepository<CampaignRecord> | undefined;
  readonly now?: (() => Date) | undefined;
  readonly probeMedia?: typeof probeMedia | undefined;
  readonly isAnimatedWebp?: typeof isAnimatedWebp | undefined;
  readonly demuxAnimatedWebp?: typeof demuxAnimatedWebp | undefined;
  readonly spawnRunner?: SpawnLikeFn | undefined;
  readonly ffprobePath?: string | undefined;
  readonly formatAwareProber?:
    | ((options: {
        outputKey: string;
        checksumSha256: string;
        bytes: Uint8Array;
        filename: string;
        contentType?: string | undefined;
      }) => Promise<ManifestMeasuredMedia> | ManifestMeasuredMedia)
    | undefined;
}

export interface RenderJobExecutorOptions {
  readonly manifestPath?: string | undefined;
  readonly goldMasterProvenancePath?: string | undefined;
  readonly comfyUiDir?: string | undefined;
  readonly candidateBucket?: string | undefined;
  readonly deliveryBucket?: string | undefined;
  readonly ffprobePath?: string | undefined;
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

export function isVideoMediaObject(
  obj: PutObjectInput,
  isAnimatedWebpFn: (bytes: Uint8Array) => boolean,
  hasCustomProber = false
): boolean {
  const keyLower = obj.key.toLowerCase();
  const contentTypeLower = obj.contentType?.toLowerCase() ?? "";
  if (
    keyLower.endsWith(".mp4") ||
    keyLower.endsWith(".webm") ||
    keyLower.endsWith(".mov") ||
    keyLower.endsWith(".mkv") ||
    contentTypeLower.startsWith("video/")
  ) {
    return true;
  }
  if (keyLower.endsWith(".webp") || contentTypeLower === "image/webp") {
    if (hasCustomProber) {
      return true;
    }
    if (obj.body) {
      const bytes =
        obj.body instanceof Uint8Array
          ? obj.body
          : Buffer.isBuffer(obj.body)
            ? new Uint8Array(obj.body)
            : new Uint8Array(Buffer.from(obj.body));
      if (isAnimatedWebpFn(bytes)) {
        return true;
      }
    }
  }
  return false;
}

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
  readonly attemptId?: string | undefined;
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
  "frameCount",
  "attemptId"
]);
const ALLOWED_REF2V_PRODUCTION_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "audioPrompt",
  "seed",
  "frameCount",
  "shotPlanId",
  "specRevision",
  "attemptId"
]);
const ALLOWED_H3_I2V_PRODUCTION_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "audioPrompt",
  "seed",
  "approvedCandidateId",
  "frameCount",
  "shotPlanId",
  "specRevision",
  "attemptId"
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

  const isH3I2v =
    profile?.engine === "minimax_h3_i2v" ||
    profile?.renderProfileIdentity?.key === "MINIMAX_H3_720P_5S_I2V_V1" ||
    profile?.id === "minimax-h3-720p-124f-i2v";

  const allowedKeys =
    jobKind === "candidate"
      ? ALLOWED_CANDIDATE_KEYS
      : isRef2v
        ? ALLOWED_REF2V_PRODUCTION_KEYS
        : isH3I2v
          ? ALLOWED_H3_I2V_PRODUCTION_KEYS
          : ALLOWED_PRODUCTION_KEYS;
  const keys = Object.keys(payload);

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      if (jobKind === "production" && key === "variantOrdinal") {
        throw new RenderJobPayloadValidationError(
          "variantOrdinal is candidate-only and not allowed in production jobs"
        );
      }
      if (jobKind === "production" && !isRef2v && !isH3I2v && key === "shotPlanId") {
        throw new RenderJobPayloadValidationError(
          "shotPlanId is candidate-only and not allowed in production jobs"
        );
      }
      if (jobKind === "production" && !isRef2v && !isH3I2v && key === "specRevision") {
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
      if (jobKind === "candidate" && key === "attemptId") {
        throw new RenderJobPayloadValidationError(
          "attemptId is production-only and not allowed in candidate jobs"
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
    if (jobKind !== "candidate" && !isRef2v && !isH3I2v) {
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
    if (jobKind !== "candidate" && !isRef2v && !isH3I2v) {
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

  let attemptId: string | undefined;
  if ("attemptId" in raw && raw.attemptId !== undefined) {
    if (jobKind !== "production") {
      throw new RenderJobPayloadValidationError(
        "attemptId is production-only and not allowed in candidate jobs"
      );
    }
    if (typeof raw.attemptId !== "string" || raw.attemptId.trim().length === 0) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.attemptId must be a non-empty string"
      );
    }
    attemptId = raw.attemptId.trim();
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
    specRevision,
    attemptId
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
    if (topology.referenceSlotFields) {
      // Per-slot Autogrow inputs (ref_images.ref_image_N) are validated separately below;
      // the referenceNode itself has no static literal inputField key to check here.
      const node = workflow[topology.referenceNode.nodeId];
      if (
        typeof node !== "object" ||
        node === null ||
        (node as { class_type?: string }).class_type !== topology.referenceNode.classType ||
        typeof (node as { inputs?: unknown }).inputs !== "object" ||
        (node as { inputs?: unknown }).inputs === null
      ) {
        throw new RenderJobExecutionError(
          `Expected node "${topology.referenceNode.nodeId}" to exist with class_type "${topology.referenceNode.classType}" and inputs object for referenceNode injection`
        );
      }
    } else {
      checkTarget(topology.referenceNode, "referenceNode");
    }
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
    const seenImageNodeIds = new Set<string>();
    for (let i = 0; i < topology.referenceImages.length; i++) {
      const target = topology.referenceImages[i]!;
      if (seenImageNodeIds.has(target.nodeId)) {
        throw new RenderJobExecutionError(
          `Duplicate node ID "${target.nodeId}" in referenceImages topology targets`
        );
      }
      seenImageNodeIds.add(target.nodeId);
      checkTarget(target, `referenceImages[${i}]`);
    }
    if (topology.referenceSlotFields && topology.referenceNode) {
      if (topology.referenceSlotFields.length !== topology.referenceImages.length) {
        throw new RenderJobExecutionError(
          `referenceSlotFields length (${topology.referenceSlotFields.length}) must match referenceImages length (${topology.referenceImages.length})`
        );
      }
      const refNode = workflow[topology.referenceNode.nodeId] as
        { class_type?: string; inputs?: Record<string, unknown> } | undefined;
      for (let i = 0; i < topology.referenceSlotFields.length; i++) {
        const slotField = topology.referenceSlotFields[i]!;
        const expectedTarget = topology.referenceImages[i]!;
        const actualLink = refNode?.inputs?.[slotField];
        if (
          !Array.isArray(actualLink) ||
          actualLink[0] !== expectedTarget.nodeId ||
          actualLink[1] !== 0
        ) {
          throw new RenderJobExecutionError(
            `Expected node "${topology.referenceNode.nodeId}" input "${slotField}" to connect to ${JSON.stringify([expectedTarget.nodeId, 0])}, got ${JSON.stringify(actualLink)}`
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

      // 3. Prune unused per-slot ref_images.ref_image_N Autogrow inputs on referenceNode
      // (slots 0..N-1 stay wired to their LoadImage nodes by the static template)
      const refNode = topology.referenceNode ? workflow[topology.referenceNode.nodeId] : undefined;
      const refNodeInputs =
        typeof refNode === "object" && refNode !== null && "inputs" in refNode
          ? (refNode as { inputs: Record<string, unknown> }).inputs
          : undefined;

      if (refNodeInputs && topology.referenceSlotFields) {
        for (let i = N; i < topology.referenceSlotFields.length; i++) {
          delete refNodeInputs[topology.referenceSlotFields[i]!];
        }
      }

      if (topology.refImageSize && refNodeInputs) {
        // ref_image_size is a required input on MiniMaxH3ReferenceToVideo (verified live on the
        // pinned render host: omitting it fails ComfyUI validation with required_input_missing,
        // even for N=0). "match" is used when there are no references to conform to.
        refNodeInputs[topology.refImageSize.inputField] = N > 0 ? "max" : "match";
      }
      if (topology.width && refNodeInputs && profile?.baseline.width) {
        refNodeInputs[topology.width.inputField] = profile.baseline.width;
      }
      if (topology.height && refNodeInputs && profile?.baseline.height) {
        refNodeInputs[topology.height.inputField] = profile.baseline.height;
      }

      if (
        topology.referenceNode &&
        topology.referenceNode.classType === "MiniMaxH3ReferenceToVideo"
      ) {
        validateMiniMaxH3ReferenceToVideoInputSchema(
          topology.referenceNode.nodeId,
          workflow[topology.referenceNode.nodeId],
          workflow,
          N
        );
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

export function validateMiniMaxH3ReferenceToVideoInputSchema(
  nodeId: string,
  nodeData: unknown,
  workflow: Record<string, unknown>,
  activeReferenceCount: number
): void {
  if (
    typeof nodeData !== "object" ||
    nodeData === null ||
    (nodeData as { class_type?: string }).class_type !== "MiniMaxH3ReferenceToVideo"
  ) {
    throw new RenderJobExecutionError(
      `Node "${nodeId}" must have class_type "MiniMaxH3ReferenceToVideo"`
    );
  }
  const inputs = (nodeData as { inputs?: Record<string, unknown> }).inputs;
  if (typeof inputs !== "object" || inputs === null) {
    throw new RenderJobExecutionError(`Node "${nodeId}" inputs must be a valid object`);
  }

  // Required inputs
  for (const req of ["clip", "vae", "audio_vae", "prompt", "width", "height", "length"]) {
    if (!Object.prototype.hasOwnProperty.call(inputs, req)) {
      throw new RenderJobExecutionError(
        `Node "${nodeId}" (MiniMaxH3ReferenceToVideo) missing required registered input "${req}"`
      );
    }
  }

  // Check required link connections
  for (const linkReq of ["clip", "vae", "audio_vae"]) {
    const link = inputs[linkReq];
    if (
      !Array.isArray(link) ||
      link.length !== 2 ||
      typeof link[0] !== "string" ||
      typeof link[1] !== "number" ||
      !workflow[link[0]]
    ) {
      throw new RenderJobExecutionError(
        `Node "${nodeId}" input "${linkReq}" must be a valid link tuple pointing to an existing upstream node`
      );
    }
  }

  // Check numeric controls
  if (typeof inputs.width !== "number" || inputs.width <= 0) {
    throw new RenderJobExecutionError(`Node "${nodeId}" input "width" must be a positive integer`);
  }
  if (typeof inputs.height !== "number" || inputs.height <= 0) {
    throw new RenderJobExecutionError(`Node "${nodeId}" input "height" must be a positive integer`);
  }
  if (typeof inputs.length !== "number" || inputs.length <= 0) {
    throw new RenderJobExecutionError(`Node "${nodeId}" input "length" must be a positive integer`);
  }
  if (typeof inputs.prompt !== "string" || inputs.prompt.trim().length === 0) {
    throw new RenderJobExecutionError(`Node "${nodeId}" input "prompt" must be a non-empty string`);
  }

  // ref_image_size is a required input on the pinned MiniMaxH3ReferenceToVideo node (verified
  // live: omitting it fails ComfyUI validation with required_input_missing, even for N=0).
  if (inputs.ref_image_size !== "match" && inputs.ref_image_size !== "max") {
    throw new RenderJobExecutionError(
      `Node "${nodeId}" input "ref_image_size" must be "match" or "max", got "${JSON.stringify(inputs.ref_image_size)}"`
    );
  }

  // ref_images is a native Autogrow input exposed as per-slot dotted keys
  // ref_images.ref_image_0 .. ref_images.ref_image_8 (0-indexed, up to 9 slots).
  for (let s = 0; s < 9; s++) {
    const slotField = `ref_images.ref_image_${s}`;
    const link = inputs[slotField];
    if (s < activeReferenceCount) {
      if (
        !Array.isArray(link) ||
        link.length !== 2 ||
        typeof link[0] !== "string" ||
        typeof link[1] !== "number" ||
        !workflow[link[0]]
      ) {
        throw new RenderJobExecutionError(
          `Node "${nodeId}" input "${slotField}" must be a valid link tuple pointing to an existing upstream node for active reference slot ${s}`
        );
      }
      const upstreamNode = workflow[link[0]] as { class_type?: string } | undefined;
      if (upstreamNode?.class_type !== "LoadImage") {
        throw new RenderJobExecutionError(
          `Node "${nodeId}" input "${slotField}" must connect to a LoadImage node, got "${upstreamNode?.class_type}"`
        );
      }
    } else if (link !== undefined) {
      throw new RenderJobExecutionError(
        `Node "${nodeId}" input "${slotField}" must be omitted for inactive reference slot ${s} (activeReferenceCount=${activeReferenceCount})`
      );
    }
  }
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

    const isH3I2v =
      profile.engine === "minimax_h3_i2v" ||
      profile.renderProfileIdentity.key === "MINIMAX_H3_720P_5S_I2V_V1" ||
      profile.id === "minimax-h3-720p-124f-i2v";

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

        if (!deps?.sceneRepository) {
          throw new RenderJobExecutionError(
            "sceneRepository dependency is required for reference-directed execution"
          );
        }

        const sceneDomain = await deps.sceneRepository.findById(job.sceneId as SceneId);
        if (!sceneDomain) {
          throw new RenderJobExecutionError(`Scene "${job.sceneId}" not found in sceneRepository`);
        }
        const sceneSnapshot = sceneDomain.snapshot();
        if (sceneSnapshot.specRevision !== validatedInjected.specRevision) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" specRevision ${sceneSnapshot.specRevision} does not match injected specRevision ${validatedInjected.specRevision}`
          );
        }
        if (!sceneSnapshot.approvedShotPlanId) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" has no approvedShotPlanId; reference-directed execution requires current-scene ShotPlan approval`
          );
        }
        if (sceneSnapshot.approvedShotPlanId !== validatedInjected.shotPlanId) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" approvedShotPlanId "${sceneSnapshot.approvedShotPlanId}" does not match injected shotPlanId "${validatedInjected.shotPlanId}"`
          );
        }
        if (
          sceneSnapshot.approvedShotPlanRevision === undefined ||
          sceneSnapshot.approvedShotPlanRevision === null
        ) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" has no approvedShotPlanRevision; reference-directed execution requires verified current-revision approval`
          );
        }
        if (sceneSnapshot.approvedShotPlanRevision !== validatedInjected.specRevision) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" approvedShotPlanRevision ${sceneSnapshot.approvedShotPlanRevision} does not match injected specRevision ${validatedInjected.specRevision}`
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
        if (
          sceneSnapshot.approval &&
          sceneSnapshot.approval.revision !== validatedInjected.specRevision
        ) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" approval revision ${sceneSnapshot.approval.revision} does not match injected specRevision ${validatedInjected.specRevision}`
          );
        }
        const rawScene = sceneSnapshot as unknown as Record<string, unknown>;
        const rawConfig = sceneSnapshot.configuration as unknown as
          Record<string, unknown> | undefined;
        if (
          rawScene.trim !== undefined ||
          rawScene.loop !== undefined ||
          rawConfig?.trim !== undefined ||
          rawConfig?.loop !== undefined
        ) {
          throw new RenderJobExecutionError(
            `MiniMax-H3 does not support scene trim or loop controls; received unsupported intent`
          );
        }
        const sceneSpec = {
          revision: validatedInjected.specRevision,
          actionContext: sceneSnapshot.configuration?.prompt,
          scriptContext: (sceneSnapshot as { scriptContext?: string }).scriptContext
        };

        if (!deps?.campaignRepository) {
          throw new RenderJobExecutionError(
            "campaignRepository dependency is required for reference-directed execution"
          );
        }
        const campaign = await deps.campaignRepository.findById(sceneSnapshot.campaignId);
        if (!campaign || !campaign.clientId) {
          throw new RenderJobExecutionError(
            `Campaign "${sceneSnapshot.campaignId}" not found or lacks clientId in campaignRepository`
          );
        }
        const expectedClientId = campaign.clientId;

        if (!deps.referenceAssetRepository.listBindingsBySceneId) {
          throw new RenderJobExecutionError(
            "referenceAssetRepository.listBindingsBySceneId is required for reference-directed execution"
          );
        }

        const rawAssets = await deps.referenceAssetRepository.listBySceneId(job.sceneId as SceneId);
        const assetsById = new Map<string, DomainReferenceAsset>(rawAssets.map((a) => [a.id, a]));

        const rawBindings = await deps.referenceAssetRepository.listBindingsBySceneId(
          job.sceneId as SceneId,
          {
            specRevision: validatedInjected.specRevision
          }
        );

        for (const binding of rawBindings) {
          if (binding.sceneId && binding.sceneId !== job.sceneId) {
            throw new RenderJobExecutionError(
              `SceneReferenceBinding for asset "${binding.referenceAssetId}" belongs to scene "${binding.sceneId}", which does not match job sceneId "${job.sceneId}"`
            );
          }
          if (
            binding.specRevision !== undefined &&
            binding.specRevision !== validatedInjected.specRevision
          ) {
            throw new RenderJobExecutionError(
              `SceneReferenceBinding for asset "${binding.referenceAssetId}" has specRevision ${binding.specRevision}, which does not match injected specRevision ${validatedInjected.specRevision}`
            );
          }
        }

        const canonicalRefs = canonicalizeReferenceBindings({
          bindings: rawBindings,
          assetsById,
          expectedClientId,
          expectedSceneId: job.sceneId
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
          const imageValidator = deps?.imageValidator ?? deps?.imageInspectionPort;
          if (!imageValidator) {
            throw new RenderJobExecutionError(
              "imageValidator dependency is required for reference image staging"
            );
          }

          for (const ref of canonicalRefs) {
            if (ref.asset.clientId !== expectedClientId) {
              throw new ReferenceImageIntegrityError(
                `Reference asset "${ref.referenceAssetId}" client "${ref.asset.clientId}" does not match scene campaign client "${expectedClientId}"`
              );
            }

            const refAssetSceneId = (ref.asset as { sceneId?: string }).sceneId;
            if (refAssetSceneId && refAssetSceneId !== job.sceneId) {
              throw new ReferenceImageIntegrityError(
                `Reference asset "${ref.referenceAssetId}" belongs to scene "${refAssetSceneId}", which does not match job sceneId "${job.sceneId}"`
              );
            }

            const stored = await deps.objectStorage.getObject(
              { bucket: ref.asset.storageBucket, key: ref.asset.storageObjectKey },
              { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
            );
            if (!stored || !stored.body || stored.body.byteLength === 0) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" is missing or empty in storage`
              );
            }

            const bytes = stored.body;
            if (bytes.length < 8) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" buffer is too small to be a valid image`
              );
            }

            const declaredMime = (ref.asset.mimeType ?? "image/png").toLowerCase();
            const imageInfo = parseImageByteHeader(bytes);
            if (!imageInfo) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" has unknown or unsupported image format magic bytes`
              );
            }
            if (imageInfo.mimeType !== declaredMime) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" detected format "${imageInfo.mimeType}" does not match declared MIME "${declaredMime}"`
              );
            }
            if (imageInfo.width <= 0 || imageInfo.height <= 0) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" must have positive dimensions`
              );
            }
            if (ref.asset.width !== undefined && imageInfo.width !== ref.asset.width) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" width mismatch: expected ${ref.asset.width}, got ${imageInfo.width}`
              );
            }
            if (ref.asset.height !== undefined && imageInfo.height !== ref.asset.height) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" height mismatch: expected ${ref.asset.height}, got ${imageInfo.height}`
              );
            }

            const actualSha256 = await hashBytesPort.hashBytes(stored.body);
            if (actualSha256 !== ref.asset.contentHashSha256) {
              throw new ReferenceImageIntegrityError(
                `Reference image sha256 mismatch for asset "${ref.referenceAssetId}": expected "${ref.asset.contentHashSha256}", got "${actualSha256}"`
              );
            }

            let inspected: ValidatedImageMetadata;
            try {
              inspected = await imageValidator.inspectAndValidate(bytes, declaredMime);
            } catch (cause) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" decode validation failed: ${(cause as Error).message}`,
                { cause }
              );
            }

            if (inspected.detectedMimeType !== declaredMime) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" detected format "${inspected.detectedMimeType}" does not match declared MIME "${declaredMime}"`
              );
            }
            if (inspected.width <= 0 || inspected.height <= 0) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" must have positive dimensions`
              );
            }
            if (ref.asset.width !== undefined && inspected.width !== ref.asset.width) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" width mismatch: expected ${ref.asset.width}, got ${inspected.width}`
              );
            }
            if (ref.asset.height !== undefined && inspected.height !== ref.asset.height) {
              throw new ReferenceImageIntegrityError(
                `Reference image object "${ref.asset.storageObjectKey}" height mismatch: expected ${ref.asset.height}, got ${inspected.height}`
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
              bindingId: ref.bindingId,
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

        if (isH3I2v && validatedInjected.shotPlanId) {
          if (!deps?.shotPlanRepository) {
            throw new RenderJobExecutionError(
              "shotPlanRepository dependency is required for frame-anchored execution"
            );
          }
          if (validatedInjected.specRevision === undefined) {
            throw new RenderJobExecutionError(
              "injectedPayload.specRevision is required for frame-anchored execution"
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
          if (shotPlanDoc.routingMode !== "frame_anchored") {
            throw new RenderJobExecutionError(
              `ShotPlan "${shotPlanDoc.id}" routingMode must be "frame_anchored", got "${shotPlanDoc.routingMode}"`
            );
          }
          if (!shotPlanDoc.continuity) {
            throw new RenderJobExecutionError(
              `ShotPlan "${shotPlanDoc.id}" missing continuity for frame-anchored execution`
            );
          }
          if (shotPlanDoc.continuity.frameAnchorTarget !== "first_frame") {
            throw new RenderJobExecutionError(
              `ShotPlan "${shotPlanDoc.id}" frameAnchorTarget must be "first_frame", got "${shotPlanDoc.continuity.frameAnchorTarget}"`
            );
          }
          if (!shotPlanDoc.continuity.anchorCandidateId) {
            throw new RenderJobExecutionError(
              `ShotPlan "${shotPlanDoc.id}" frame-anchored execution requires explicit anchorCandidateId`
            );
          }
          if (!shotPlanDoc.continuity.anchorMediaHashSha256) {
            throw new RenderJobExecutionError(
              `ShotPlan "${shotPlanDoc.id}" frame-anchored execution requires explicit anchorMediaHashSha256`
            );
          }
          if (shotPlanDoc.continuity.anchorCandidateId !== validatedInjected.approvedCandidateId) {
            throw new RenderJobExecutionError(
              `ShotPlan "${shotPlanDoc.id}" anchorCandidateId "${shotPlanDoc.continuity.anchorCandidateId}" does not match injected approvedCandidateId "${validatedInjected.approvedCandidateId}"`
            );
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

        if (isH3I2v && validatedInjected.shotPlanId && deps?.shotPlanRepository) {
          const shotPlanDomain = await deps.shotPlanRepository.findById(
            validatedInjected.shotPlanId as ShotPlanId
          );
          const shotPlanDoc = shotPlanDomain?.snapshot();
          if (
            shotPlanDoc?.continuity?.anchorMediaHashSha256 &&
            shotPlanDoc.continuity.anchorMediaHashSha256 !== actualSha256
          ) {
            throw new ReferenceImageIntegrityError(
              `Reference image sha256 mismatch with ShotPlan anchor: expected "${shotPlanDoc.continuity.anchorMediaHashSha256}", got "${actualSha256}"`
            );
          }
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

      if (isRef2v && topology?.referenceNode) {
        validateMiniMaxH3ReferenceToVideoInputSchema(
          topology.referenceNode.nodeId,
          (mutatedWorkflow as Record<string, unknown>)[topology.referenceNode.nodeId],
          mutatedWorkflow as Record<string, unknown>,
          stagedRefPaths.length
        );
      }

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

      // Format-aware probe of primary video output for production manifest assembly
      const isAnimatedWebpFn = deps?.isAnimatedWebp ?? isAnimatedWebp;
      const demuxAnimatedWebpFn = deps?.demuxAnimatedWebp ?? demuxAnimatedWebp;
      const hasCustomProber = typeof deps?.formatAwareProber === "function";

      let primaryOutput = mediaObjects.find((obj) =>
        isVideoMediaObject(obj, isAnimatedWebpFn, hasCustomProber)
      );
      if (!primaryOutput && hasCustomProber && mediaObjects.length > 0) {
        primaryOutput = mediaObjects[0];
      }
      const jobId = job.jobId ?? (job as { id?: string }).id ?? "";
      if (!primaryOutput || !primaryOutput.body || !primaryOutput.checksumSha256) {
        throw new ProductionManifestAssemblyError(
          `Primary video output not found or missing bytes for media probing in job "${jobId}"`,
          { jobId }
        );
      }

      const outputKey = primaryOutput.key;

      let measuredMedia: ManifestMeasuredMedia;
      if (deps?.formatAwareProber) {
        const bodyBytes =
          primaryOutput.body instanceof Uint8Array
            ? primaryOutput.body
            : Buffer.isBuffer(primaryOutput.body)
              ? new Uint8Array(primaryOutput.body)
              : new Uint8Array(Buffer.from(primaryOutput.body));
        measuredMedia = await deps.formatAwareProber({
          outputKey: primaryOutput.key,
          checksumSha256: primaryOutput.checksumSha256,
          bytes: bodyBytes,
          filename: primaryOutput.key.split("/").pop() ?? primaryOutput.key,
          ...(primaryOutput.contentType ? { contentType: primaryOutput.contentType } : {})
        });
      } else {
        const bodyBytes =
          primaryOutput.body instanceof Uint8Array
            ? primaryOutput.body
            : Buffer.isBuffer(primaryOutput.body)
              ? new Uint8Array(primaryOutput.body)
              : new Uint8Array(Buffer.from(primaryOutput.body));

        if (isAnimatedWebpFn(bodyBytes)) {
          try {
            const demuxed = demuxAnimatedWebpFn(bodyBytes);
            if (!demuxed.frames || demuxed.frames.length === 0) {
              throw new ProductionManifestAssemblyError(
                `Job "${jobId}": Animated WebP demux returned 0 frames for primary output "${outputKey}"`,
                { jobId, outputKey, formatPath: "animated_webp_demux" }
              );
            }
            const frameDurationsMs = demuxed.frames.map((f) => f.durationMs);
            const totalDurationMs = frameDurationsMs.reduce((acc, d) => acc + d, 0);
            const firstDuration = frameDurationsMs[0]!;
            const isUniform = frameDurationsMs.every((d) => d === firstDuration);
            const fps = isUniform && firstDuration > 0 ? 1000 / firstDuration : null;

            measuredMedia = {
              outputKey: primaryOutput.key,
              checksumSha256: primaryOutput.checksumSha256,
              container: "animated_webp_demux",
              dimensions: {
                width: demuxed.width,
                height: demuxed.height
              },
              frameCount: demuxed.frames.length,
              fps,
              durationMs: totalDurationMs,
              formatDurationMs: totalDurationMs,
              frameDurationsMs,
              measurement: "source_bytes"
            };
          } catch (err) {
            if (err instanceof ProductionManifestAssemblyError) {
              throw err;
            }
            throw new ProductionManifestAssemblyError(
              `Job "${jobId}": Failed to demux animated WebP output for measurement in "${outputKey}": ${(err as Error).message}`,
              { cause: err, jobId, outputKey, formatPath: "animated_webp_demux" }
            );
          }
        } else {
          const keyLower = primaryOutput.key.toLowerCase();
          let ext = ".mp4";
          if (keyLower.endsWith(".webm") || primaryOutput.contentType === "video/webm") {
            ext = ".webm";
          } else if (keyLower.endsWith(".mov") || primaryOutput.contentType === "video/quicktime") {
            ext = ".mov";
          } else if (keyLower.endsWith(".mkv")) {
            ext = ".mkv";
          } else if (keyLower.endsWith(".mp4") || primaryOutput.contentType === "video/mp4") {
            ext = ".mp4";
          } else {
            const filename = primaryOutput.key.split("/").pop() ?? "";
            const dotIdx = filename.lastIndexOf(".");
            if (dotIdx !== -1) {
              ext = filename.slice(dotIdx);
            }
          }

          const tempFileName = `cco-probe-${randomUUID()}${ext}`;
          const tempFilePath = join(tmpdir(), tempFileName);

          try {
            await writeFile(tempFilePath, bodyBytes, { flag: "wx" });
            const probeMediaFn = deps?.probeMedia ?? probeMedia;
            const runner = deps?.spawnRunner ?? defaultSpawnRunner;
            const ffprobe = deps?.ffprobePath ?? options?.ffprobePath ?? "ffprobe";

            const probed = await probeMediaFn({
              runner,
              ffprobePath: ffprobe,
              filePath: tempFilePath,
              isOutput: true,
              countFrames: true,
              checkFrameIntervals: true,
              errorContext: {
                jobId,
                outputKey
              }
            });

            const videoStream = probed.videoStream;
            if (!videoStream || !videoStream.frameCount || videoStream.frameCount <= 0) {
              throw new ProductionManifestAssemblyError(
                `Job "${jobId}": Probed video stream in "${outputKey}" is missing a positive frameCount`,
                { jobId, outputKey, formatPath: "ffprobe" }
              );
            }
            if (videoStream.width <= 0 || videoStream.height <= 0) {
              throw new ProductionManifestAssemblyError(
                `Job "${jobId}": Probed video stream in "${outputKey}" has invalid dimensions (${videoStream.width}x${videoStream.height})`,
                { jobId, outputKey, formatPath: "ffprobe" }
              );
            }
            if (videoStream.frameRate !== null && videoStream.frameRate <= 0) {
              throw new ProductionManifestAssemblyError(
                `Job "${jobId}": Probed video stream in "${outputKey}" has invalid frameRate (${videoStream.frameRate})`,
                { jobId, outputKey, formatPath: "ffprobe" }
              );
            }

            measuredMedia = {
              outputKey: primaryOutput.key,
              checksumSha256: primaryOutput.checksumSha256,
              container: "ffprobe",
              dimensions: {
                width: videoStream.width,
                height: videoStream.height
              },
              frameCount: videoStream.frameCount,
              fps: videoStream.frameRate,
              durationMs: videoStream.durationMs,
              formatDurationMs: probed.formatDurationMs,
              video: {
                codecName: videoStream.codecName,
                pixelFormat: videoStream.pixelFormat
              },
              ...(probed.audioStream
                ? {
                    audio: {
                      codecName: probed.audioStream.codecName,
                      sampleRateHz: probed.audioStream.sampleRateHz,
                      channels: probed.audioStream.channels,
                      durationMs: probed.audioStream.durationMs,
                      ...(probed.audioStream.bitrateKbps !== undefined
                        ? { bitrateKbps: probed.audioStream.bitrateKbps }
                        : {})
                    }
                  }
                : {}),
              measurement: "source_bytes"
            };
          } catch (err) {
            if (err instanceof ProductionManifestAssemblyError) {
              throw err;
            }
            throw new ProductionManifestAssemblyError(
              `Job "${jobId}": Failed to probe primary output media for measurement in "${outputKey}": ${(err as Error).message}`,
              { cause: err, jobId, outputKey, formatPath: "ffprobe" }
            );
          } finally {
            await unlink(tempFilePath).catch(() => {});
          }
        }
      }

      // Construct configuredMedia representing intent/workflow configuration
      const configuredDimensions = {
        width: profile.baseline.width!,
        height: profile.baseline.height!
      };
      let configuredFrameCount = profile.baseline.frames!;
      let configuredFps = profile.baseline.frames! / profile.baseline.approximateDurationSeconds!;
      if (topology?.frameCount) {
        const frameNode = mutatedWorkflow[topology.frameCount.nodeId] as
          { class_type?: string; inputs?: Record<string, unknown> } | undefined;
        if (
          frameNode?.class_type === topology.frameCount.classType &&
          typeof frameNode.inputs?.[topology.frameCount.inputField] === "number" &&
          (frameNode.inputs[topology.frameCount.inputField] as number) > 0
        ) {
          configuredFrameCount = frameNode.inputs[topology.frameCount.inputField] as number;
          configuredFps = LTX_FPS;
        }
      }
      const configuredMedia: ManifestConfiguredMedia = {
        outputKey: primaryOutput.key,
        checksumSha256: primaryOutput.checksumSha256,
        dimensions: configuredDimensions,
        frameCount: configuredFrameCount,
        fps: configuredFps,
        source: "render_profile_and_executed_workflow"
      };

      const assembleInput: AssembleProductionManifestInput = {
        job,
        profile,
        renderResult,
        mediaObjects: Object.freeze(mediaObjects),
        liveProvenance,
        workflow: mutatedWorkflow,
        configuredMedia,
        measuredMedia,
        ...(validatedInjected.attemptId !== undefined
          ? { attemptId: validatedInjected.attemptId }
          : {}),
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
              ...(isH3I2v && validatedInjected.shotPlanId && validatedInjected.specRevision
                ? {
                    routingMode: "frame_anchored" as const,
                    shotPlan: {
                      id: validatedInjected.shotPlanId,
                      specRevision: validatedInjected.specRevision
                    },
                    ...(resolvedCandidateMedia && stagedReferenceImage && topology?.referenceImage
                      ? {
                          firstFrame: {
                            anchorType: "first_frame" as const,
                            candidateId: validatedInjected.approvedCandidateId,
                            contentHashSha256: resolvedCandidateMedia.media.sha256,
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
                      : {}),
                    submittedWorkflowHash: hashWorkflowFn(JSON.stringify(mutatedWorkflow)),
                    ...(previsReviewEvidence ? { previsReviewEvidence } : {})
                  }
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
