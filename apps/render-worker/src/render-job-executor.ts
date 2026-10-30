import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeReferenceBindings,
  type CanonicalReferenceEntry,
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
  type H3CandidateRegistryReader,
  type H3CandidateAuthorizationPort,
  type H3RuntimeObservationPort,
  type ManifestSourceProvenance,
  type ProductionReleaseCapabilityReader,
  H3CandidateEligibilityService,
  parseImageByteHeader,
  runPrevisTextAdvisory,
  STORYBOARD_PREVIS_PROFILE_ID,
  type PrevisTextAdvisoryPolicy,
  type PrevisTextDetectionPort
} from "@cco/application";
import {
  computeAuthorizationPayloadDigest,
  computeCandidateProductionInputFingerprint,
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
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  resolveCandidateExecutionSelection,
  resolveH3ProfileFrameCapabilities,
  type H3CandidateProfile,
  type H3CandidateAuthorizationGrant,
  type H3CandidateExecutionSpecification,
  type NodeInjectionTarget,
  type ProfileInjectionTopology,
  type OwnerKind,
  OwnerKindSchema,
  type ExecutionRealm,
  ExecutionRealmSchema,
  type EvidenceOrigin,
  EvidenceOriginSchema,
  RENDER_PROFILE_ALIASES,
  type RenderProfileKey,
  type PrevisTextAdvisory,
  type ShotPlanRoutingMode,
  type H3ReleaseProfileKey,
  isReleasedProductionProfileKey
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
  type SpawnLikeFn,
  type H3CandidateProvenanceReport,
  resolveCandidateProvenanceFromCollection
} from "@cco/infrastructure";
import { BUCKETS } from "@cco/shared";
import { PreflightError, verifyGoldMasterProvenance } from "./certification/preflight.js";
import type { RenderJobExecutor, WorkerRenderOutput } from "./worker.js";

export type { ComfyUiOutputReader };

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");

export class RenderJobExecutionError extends Error {
  override readonly name: string = "RenderJobExecutionError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class CandidateProfileProductionDisabledError extends RenderJobExecutionError {
  override readonly name: string = "CandidateProfileProductionDisabledError";
}

export class CandidateExecutionMismatchError extends RenderJobExecutionError {
  override readonly name: string = "CandidateExecutionMismatchError";
  readonly blockerCode: string;

  constructor(message: string, blockerCode: string = "PROFILE_MISMATCH", options?: ErrorOptions) {
    super(message, options);
    this.blockerCode = blockerCode;
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
  readonly liveProvenance?: CertificationProvenanceReport | ManifestSourceProvenance | undefined;
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
  readonly candidateSpecificationDigest?: string | undefined;
  readonly requestedDurationMs?: number | undefined;
  readonly nominalDurationMs?: number | undefined;
  readonly submittedGraphHash?: string | undefined;
  readonly grantReference?: string | undefined;
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
  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
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
          engine?: "ltx_25" | "flux_schnell" | "ltx_25_i2v" | "minimax_h3_i2v" | "minimax_h3_ref2v";
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
  /** Advisory-only OCR for flux_schnell_storyboard_v1 previs stills; never blocks a job. */
  readonly previsTextDetector?: PrevisTextDetectionPort | undefined;
  readonly previsTextAdvisoryPolicy?: PrevisTextAdvisoryPolicy | undefined;
  readonly previsTextAdvisoryTimeoutMs?: number | undefined;
  readonly previsTextAdvisoryLogger?: Pick<Console, "info"> | undefined;
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
  readonly registryReader?: H3CandidateRegistryReader | undefined;
  readonly readCandidateProvenance?: ((filePath: string) => Promise<unknown>) | undefined;
  readonly resolveCandidateProvenance?: typeof resolveCandidateProvenanceFromCollection | undefined;
  readonly authorizationPort?: H3CandidateAuthorizationPort | undefined;
  readonly runtimeObservationPort?: H3RuntimeObservationPort | undefined;
  readonly eligibilityService?: H3CandidateEligibilityService | undefined;
  readonly targetHostname?: string | undefined;
  readonly targetGpuUuid?: string | undefined;
  readonly comfyUiRenderTimeoutMs?: number | undefined;
}

export interface RenderJobExecutorOptions {
  readonly manifestPath?: string | undefined;
  readonly goldMasterProvenancePath?: string | undefined;
  readonly candidateProvenancePath?: string | undefined;
  readonly comfyUiDir?: string | undefined;
  // Local ComfyUI base URL (e.g. "http://127.0.0.1:8188"). H3LiveRuntimeObserver resolves the
  // live ComfyUI process PID from whichever local process is listening on this endpoint's
  // port; without it, live runtime observation has no way to find the process to inspect and
  // fails closed (ADR 0008 section 6 requires a live PID, never a self-process fallback).
  readonly comfyUiEndpoint?: string | undefined;
  readonly candidateBucket?: string | undefined;
  readonly deliveryBucket?: string | undefined;
  readonly ffprobePath?: string | undefined;
  readonly registryReader?: H3CandidateRegistryReader | undefined;
  readonly comfyUiRenderTimeoutMs?: number | undefined;
  readonly buildObjectKey?:
    | ((sceneId: string, jobId: string, outputKey: string, contentHashSha256: string) => string)
    | undefined;
}

// H3 candidates (staging) are experimental variants of the same base MiniMax H3 weights that
// are already license-approved per route in config/component-license-registry.json
// (MINIMAX_H3_720P_5S_I2V_V1 / MINIMAX_H3_720P_5S_REF2V_V1). The candidate's own key is an
// internal governance/provenance identity (hash-derived, unique per distillation/attention
// variant) and is never itself a licensable component - checking license routing against it
// would always fail closed since no candidate key is ever pre-registered. License routing
// must instead check the real underlying model this candidate executes.
const H3_CANDIDATE_LICENSE_COMPONENT_BY_ROUTE: Readonly<Record<string, string>> = {
  i2v: "MINIMAX_H3_720P_5S_I2V_V1",
  ref2v: "MINIMAX_H3_720P_5S_REF2V_V1"
};
const H3_CANDIDATE_LICENSE_COMPONENT_VERSION = "1";

// Flattens the candidate spec's structured modelHashes (checkpoint/clip/audioVae/videoVae/
// turboLora + additionalModels) into a flat key->hash map. Used both for eligibility/execution
// context construction and for the render identity's modelSha256 - a naive
// Object.entries(...).filter(typeof v === "string") drops additionalModels entirely, since its
// value is itself an object, not a string (the bug this helper replaces).
function flattenH3CandidateModelHashes(
  modelHashes: H3CandidateExecutionSpecification["modelHashes"]
): Record<string, string> {
  return {
    checkpoint: modelHashes.checkpoint,
    clip: modelHashes.clip,
    audioVae: modelHashes.audioVae,
    videoVae: modelHashes.videoVae,
    ...(modelHashes.turboLora !== "none" ? { turboLora: modelHashes.turboLora } : {}),
    ...(modelHashes.additionalModels ?? {})
  };
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
  readonly beatIndex?: number | undefined;
  readonly approvedCandidateId?: CandidateId | undefined;
  readonly frameCount?: number | undefined;
  readonly referenceImage?: string | undefined;
  readonly referenceImages?: readonly string[] | undefined;
  readonly shotPlanId?: string | undefined;
  readonly specRevision?: number | undefined;
  readonly attemptId?: string | undefined;
  readonly productionInputFingerprint?: string | undefined;
  readonly candidateProfileKey?: string | undefined;
  readonly candidateSpecificationDigest?: string | undefined;
  readonly authorizationGrant?: H3CandidateAuthorizationGrant | undefined;
  readonly requestedDurationMs?: number | undefined;
  readonly nominalDurationMs?: number | undefined;
  readonly ownerKind?: OwnerKind | undefined;
  readonly acceptanceRunId?: string | undefined;
  readonly realm?: ExecutionRealm | undefined;
  readonly evidenceOrigin?: EvidenceOrigin | undefined;
  readonly releasedProfileKey?: string | undefined;
  readonly releasedSpecificationDigest?: string | undefined;
  readonly releaseDigest?: string | undefined;
}

const ALLOWED_CANDIDATE_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "seed",
  "variantOrdinal",
  "beatIndex",
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
  "attemptId",
  "productionInputFingerprint",
  "candidateProfileKey",
  "candidateSpecificationDigest",
  "authorizationGrant",
  "requestedDurationMs",
  "nominalDurationMs",
  "ownerKind",
  "acceptanceRunId",
  "realm",
  "evidenceOrigin",
  "releasedProfileKey",
  "releasedSpecificationDigest",
  "releaseDigest"
]);
const ALLOWED_REF2V_PRODUCTION_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "audioPrompt",
  "seed",
  "frameCount",
  "shotPlanId",
  "specRevision",
  "attemptId",
  "productionInputFingerprint",
  "candidateProfileKey",
  "candidateSpecificationDigest",
  "authorizationGrant",
  "requestedDurationMs",
  "nominalDurationMs",
  "ownerKind",
  "acceptanceRunId",
  "realm",
  "evidenceOrigin",
  "releasedProfileKey",
  "releasedSpecificationDigest",
  "releaseDigest"
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
  "attemptId",
  "productionInputFingerprint",
  "candidateProfileKey",
  "candidateSpecificationDigest",
  "authorizationGrant",
  "requestedDurationMs",
  "nominalDurationMs",
  "ownerKind",
  "acceptanceRunId",
  "realm",
  "evidenceOrigin",
  "releasedProfileKey",
  "releasedSpecificationDigest",
  "releaseDigest"
]);

export function validateInjectedPayload(
  payload: unknown,
  jobKind: JobKind,
  profile?: CertificationProfile | undefined,
  registryReader?:
    | {
        getCandidateProfile?(key: string | undefined): Readonly<H3CandidateProfile> | undefined;
        getReleasedProfile?(
          key: string | undefined
        ): Readonly<{ key: string; specification: H3CandidateExecutionSpecification }> | undefined;
      }
    | undefined
): ValidatedInjectedPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RenderJobPayloadValidationError("injectedPayload must be an object");
  }

  // A released profile's route (i2v vs ref2v) isn't encoded in its hash-keyed
  // renderProfileIdentity, so resolve it through the same capability lookup
  // used for frame-count validation below instead of relying solely on the
  // fixed legacy identity/engine string comparisons.
  const releasedCapability = isReleasedProductionProfileKey(profile?.renderProfileIdentity?.key)
    ? resolveH3ProfileFrameCapabilities(profile?.renderProfileIdentity?.key, registryReader)
    : undefined;

  const isRef2v =
    profile?.engine === "minimax_h3_ref2v" ||
    profile?.renderProfileIdentity?.key === "MINIMAX_H3_720P_5S_REF2V_V1" ||
    profile?.renderProfileIdentity?.key === "MINIMAX_H3_720P_5S_REF2V_TURBO4_V1" ||
    profile?.id === "minimax-h3-720p-124f-ref2v" ||
    profile?.id === "minimax-h3-720p-124f-ref2v-turbo4" ||
    releasedCapability?.route === "ref2v";

  const isH3I2v =
    profile?.engine === "minimax_h3_i2v" ||
    profile?.renderProfileIdentity?.key === "MINIMAX_H3_720P_5S_I2V_V1" ||
    releasedCapability?.route === "i2v" ||
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
      if (jobKind === "production" && key === "beatIndex") {
        throw new RenderJobPayloadValidationError(
          "beatIndex is candidate-only and not allowed in production jobs"
        );
      }
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
      if (jobKind === "candidate" && key === "productionInputFingerprint") {
        throw new RenderJobPayloadValidationError(
          "productionInputFingerprint is production-only and not allowed in candidate jobs"
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
      let topology =
        (profile as { topology?: ProfileInjectionTopology }).topology ??
        getProfileInjectionTopology(profileKey);
      if (!topology && registryReader && typeof profileKey === "string") {
        const candidate = registryReader.getCandidateProfile?.(profileKey);
        if (candidate?.topology) {
          topology = candidate.topology;
        }
      }
      if (!topology && profile.engine) {
        topology = getProfileInjectionTopology(profile.engine);
      }
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
      profileKey === "MINIMAX_H3_720P_5S_REF2V_V1" ||
      profileKey === "MINIMAX_H3_720P_5S_REF2V_TURBO4_V1" ||
      (typeof profileKey === "string" &&
        (profileKey.toLowerCase().includes("minimax") ||
          profileKey.startsWith("H3_") ||
          Boolean(profile?.engine?.toLowerCase().includes("minimax")) ||
          Boolean(profile?.id?.toLowerCase().includes("minimax"))));

    if (isMinimax) {
      if ((raw.frameCount - MINIMAX_H3_FRAME_GRID_BASE) % MINIMAX_H3_FRAME_GRID_STEP !== 0) {
        throw new RenderJobPayloadValidationError(
          `injectedPayload.frameCount must satisfy (frameCount - ${MINIMAX_H3_FRAME_GRID_BASE}) % ${MINIMAX_H3_FRAME_GRID_STEP} === 0`
        );
      }
      const capability = resolveH3ProfileFrameCapabilities(profileKey, registryReader);
      const isAllowed = capability ? capability.isAllowedFrameCount(raw.frameCount) : false;
      if (!isAllowed) {
        if (!capability) {
          throw new RenderJobPayloadValidationError(
            `Profile "${profileKey}" does not have recognized MiniMax-H3 frame capabilities`
          );
        }
        const minFrames = Math.min(...capability.allowedFrameCounts);
        const maxFrames = Math.max(...capability.allowedFrameCounts);
        throw new RenderJobPayloadValidationError(
          `injectedPayload.frameCount must be a safe integer between ${minFrames} and ${maxFrames}`
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
      let topology =
        (profile as { topology?: ProfileInjectionTopology }).topology ??
        getProfileInjectionTopology(profileKey);
      if (!topology && registryReader && typeof profileKey === "string") {
        const candidate = registryReader.getCandidateProfile?.(profileKey);
        if (candidate?.topology) {
          topology = candidate.topology;
        }
      }
      if (!topology && profile.engine) {
        topology = getProfileInjectionTopology(profile.engine);
      }
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

  let beatIndex: number | undefined;
  if ("beatIndex" in raw && raw.beatIndex !== undefined) {
    if (jobKind !== "candidate") {
      throw new RenderJobPayloadValidationError(
        "beatIndex is candidate-only and not allowed in production jobs"
      );
    }
    if (
      typeof raw.beatIndex !== "number" ||
      !Number.isInteger(raw.beatIndex) ||
      raw.beatIndex <= 0
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.beatIndex must be a positive integer"
      );
    }
    beatIndex = raw.beatIndex;
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

  let productionInputFingerprint: string | undefined;
  if ("productionInputFingerprint" in raw && raw.productionInputFingerprint !== undefined) {
    if (jobKind !== "production") {
      throw new RenderJobPayloadValidationError(
        "productionInputFingerprint is production-only and not allowed in candidate jobs"
      );
    }
    if (
      typeof raw.productionInputFingerprint !== "string" ||
      raw.productionInputFingerprint.trim().length === 0
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.productionInputFingerprint must be a non-empty string"
      );
    }
    productionInputFingerprint = raw.productionInputFingerprint.trim();
  }

  let candidateProfileKey: string | undefined;
  if ("candidateProfileKey" in raw && raw.candidateProfileKey !== undefined) {
    if (
      typeof raw.candidateProfileKey !== "string" ||
      !/^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(raw.candidateProfileKey)
    ) {
      throw new RenderJobPayloadValidationError(
        'injectedPayload.candidateProfileKey must match pattern "H3_CANDIDATE_<32-hex>_V<version>"'
      );
    }
    candidateProfileKey = raw.candidateProfileKey;
  }

  let candidateSpecificationDigest: string | undefined;
  if ("candidateSpecificationDigest" in raw && raw.candidateSpecificationDigest !== undefined) {
    if (
      typeof raw.candidateSpecificationDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(raw.candidateSpecificationDigest)
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.candidateSpecificationDigest must be a 64-character lowercase hex string"
      );
    }
    candidateSpecificationDigest = raw.candidateSpecificationDigest;
  }

  let authorizationGrant: H3CandidateAuthorizationGrant | undefined;
  if ("authorizationGrant" in raw && raw.authorizationGrant !== undefined) {
    if (typeof raw.authorizationGrant !== "object" || raw.authorizationGrant === null) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.authorizationGrant must be an object"
      );
    }
    authorizationGrant = raw.authorizationGrant as H3CandidateAuthorizationGrant;
  }

  let requestedDurationMs: number | undefined;
  if ("requestedDurationMs" in raw && raw.requestedDurationMs !== undefined) {
    if (typeof raw.requestedDurationMs !== "number" || raw.requestedDurationMs <= 0) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.requestedDurationMs must be a positive number"
      );
    }
    requestedDurationMs = raw.requestedDurationMs;
  }

  let nominalDurationMs: number | undefined;
  if ("nominalDurationMs" in raw && raw.nominalDurationMs !== undefined) {
    if (typeof raw.nominalDurationMs !== "number" || raw.nominalDurationMs <= 0) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.nominalDurationMs must be a positive number"
      );
    }
    nominalDurationMs = raw.nominalDurationMs;
  }

  let ownerKind: OwnerKind | undefined;
  if ("ownerKind" in raw && raw.ownerKind !== undefined) {
    const ownerKindParsed = OwnerKindSchema.safeParse(raw.ownerKind);
    if (!ownerKindParsed.success) {
      throw new RenderJobPayloadValidationError(
        `injectedPayload.ownerKind must be one of: ${OwnerKindSchema.options.join(", ")}`
      );
    }
    ownerKind = ownerKindParsed.data;
  }

  let acceptanceRunId: string | undefined;
  if ("acceptanceRunId" in raw && raw.acceptanceRunId !== undefined) {
    if (typeof raw.acceptanceRunId !== "string" || raw.acceptanceRunId.trim().length === 0) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.acceptanceRunId must be a non-empty string"
      );
    }
    acceptanceRunId = raw.acceptanceRunId.trim();
  }

  let realm: ExecutionRealm | undefined;
  if ("realm" in raw && raw.realm !== undefined) {
    const realmParsed = ExecutionRealmSchema.safeParse(raw.realm);
    if (!realmParsed.success) {
      throw new RenderJobPayloadValidationError(
        `injectedPayload.realm is invalid: ${realmParsed.error.message}`
      );
    }
    realm = realmParsed.data;
  }

  let evidenceOrigin: EvidenceOrigin | undefined;
  if ("evidenceOrigin" in raw && raw.evidenceOrigin !== undefined) {
    const evidenceOriginParsed = EvidenceOriginSchema.safeParse(raw.evidenceOrigin);
    if (!evidenceOriginParsed.success) {
      throw new RenderJobPayloadValidationError(
        `injectedPayload.evidenceOrigin must be one of: ${EvidenceOriginSchema.options.join(", ")}`
      );
    }
    evidenceOrigin = evidenceOriginParsed.data;
  }

  let releasedProfileKey: string | undefined;
  if ("releasedProfileKey" in raw && raw.releasedProfileKey !== undefined) {
    if (
      typeof raw.releasedProfileKey !== "string" ||
      !/^H3_RELEASE_[0-9a-f]{64}_V[1-9]\d*$/.test(raw.releasedProfileKey)
    ) {
      throw new RenderJobPayloadValidationError(
        'injectedPayload.releasedProfileKey must match pattern "H3_RELEASE_<64-hex>_V<version>"'
      );
    }
    releasedProfileKey = raw.releasedProfileKey;
  }

  let releasedSpecificationDigest: string | undefined;
  if ("releasedSpecificationDigest" in raw && raw.releasedSpecificationDigest !== undefined) {
    if (
      typeof raw.releasedSpecificationDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(raw.releasedSpecificationDigest)
    ) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.releasedSpecificationDigest must be a 64-character lowercase hex string"
      );
    }
    releasedSpecificationDigest = raw.releasedSpecificationDigest;
  }

  let releaseDigest: string | undefined;
  if ("releaseDigest" in raw && raw.releaseDigest !== undefined) {
    if (typeof raw.releaseDigest !== "string" || !/^[0-9a-f]{64}$/.test(raw.releaseDigest)) {
      throw new RenderJobPayloadValidationError(
        "injectedPayload.releaseDigest must be a 64-character lowercase hex string"
      );
    }
    releaseDigest = raw.releaseDigest;
  }

  return {
    prompt,
    negativePrompt,
    audioPrompt,
    seed,
    variantOrdinal,
    beatIndex,
    approvedCandidateId,
    frameCount,
    shotPlanId,
    specRevision,
    attemptId,
    productionInputFingerprint,
    candidateProfileKey,
    candidateSpecificationDigest,
    authorizationGrant,
    requestedDurationMs,
    nominalDurationMs,
    ownerKind,
    acceptanceRunId,
    realm,
    evidenceOrigin,
    releasedProfileKey,
    releasedSpecificationDigest,
    releaseDigest
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
  let topology =
    (profile as { topology?: ProfileInjectionTopology } | undefined)?.topology ??
    getProfileInjectionTopology(profileKey);
  if (!topology && profile?.engine) {
    topology = getProfileInjectionTopology(profile.engine);
  }

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
      if (topology.width && refNodeInputs && profile?.baseline?.width) {
        refNodeInputs[topology.width.inputField] = profile.baseline.width;
      }
      if (topology.height && refNodeInputs && profile?.baseline?.height) {
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

export function validateCandidateGraph(
  workflow: Record<string, unknown>,
  candidate: H3CandidateProfile,
  candidateProvenanceReport?: H3CandidateProvenanceReport | undefined
): void {
  const isRef2v = candidate.specification.route === "ref2v";
  const isI2v = candidate.specification.route === "i2v";

  let hasGeneratorNode = false;
  let hasSchedulerNode = false;
  let hasSamplerNode = false;
  let hasAttentionNode = false;
  let hasLoraNode = false;
  let hasCheckpointNode = false;

  for (const [nodeId, rawNode] of Object.entries(workflow)) {
    if (typeof rawNode !== "object" || rawNode === null) continue;
    const node = rawNode as { class_type?: string; inputs?: Record<string, unknown> };
    const classType = node.class_type ?? "";
    const inputs = node.inputs ?? {};

    if (
      classType === "CheckpointLoaderSimple" ||
      classType === "CheckpointLoader" ||
      classType.includes("Checkpoint") ||
      // Native MiniMax-H3 graphs load the diffusion checkpoint through
      // UNETLoader. Treat that topology as the checkpoint source instead of
      // requiring a disconnected legacy CheckpointLoader node.
      classType === "UNETLoader"
    ) {
      hasCheckpointNode = true;
    }

    // Negative tests: Route and node invariants
    if (isI2v) {
      if (classType === "MiniMaxH3ReferenceToVideo") {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" has class_type "${classType}" which is restricted to Ref2V, but candidate route is "i2v"`,
          "ROUTE_RESTRICTED_NODE"
        );
      }
      if (
        classType === "MiniMaxH3ImageToVideo" ||
        nodeId === candidate.topology.frameCount?.nodeId
      ) {
        hasGeneratorNode = true;
      }
      if (classType === "LoraLoaderModelOnly" || classType === "LoraLoader") {
        hasLoraNode = true;
        if (candidate.specification.modelHashes.turboLora === "none") {
          throw new CandidateExecutionMismatchError(
            `Candidate profile specifies no Turbo LoRA ('none'), but workflow contains LoRA loader node "${nodeId}"`,
            "TURBO_LORA_ROUTING_MISMATCH"
          );
        }
        const loraName = String(inputs.lora_name ?? "").toLowerCase();
        if (loraName.includes("ref2v") || loraName.includes("ref2va")) {
          throw new CandidateExecutionMismatchError(
            `Ref2VA Turbo LoRA is strictly restricted to Ref2V route; cannot execute on I2V candidate`,
            "TURBO_LORA_ROUTING_MISMATCH"
          );
        }
        if (
          inputs.strength_model !== undefined &&
          typeof inputs.strength_model === "number" &&
          (inputs.strength_model <= 0 || !Number.isFinite(inputs.strength_model))
        ) {
          throw new CandidateExecutionMismatchError(
            `LoRA loader node "${nodeId}" strength_model must be a positive finite number`,
            "LORA_STRENGTH_INVALID"
          );
        }
      }
    }

    if (isRef2v) {
      if (classType === "MiniMaxH3ImageToVideo") {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" has class_type "${classType}" which is restricted to I2V, but candidate route is "ref2v"`,
          "ROUTE_RESTRICTED_NODE"
        );
      }
      if (
        classType === "MiniMaxH3ReferenceToVideo" ||
        nodeId === candidate.topology.frameCount?.nodeId
      ) {
        hasGeneratorNode = true;
      }
      if (classType === "LoraLoaderModelOnly" || classType === "LoraLoader") {
        hasLoraNode = true;
        if (candidate.specification.modelHashes.turboLora === "none") {
          throw new CandidateExecutionMismatchError(
            `Candidate profile specifies no Turbo LoRA ('none'), but workflow contains LoRA loader node "${nodeId}"`,
            "TURBO_LORA_ROUTING_MISMATCH"
          );
        }
        const loraName = String(inputs.lora_name ?? "").toLowerCase();
        if (loraName.includes("fl2v") || loraName.includes("fl2va")) {
          throw new CandidateExecutionMismatchError(
            `FL2VA Turbo 8-step LoRA is strictly restricted to I2V route; cannot execute on Ref2V candidate`,
            "TURBO_LORA_ROUTING_MISMATCH"
          );
        }
        if (
          inputs.strength_model !== undefined &&
          typeof inputs.strength_model === "number" &&
          (inputs.strength_model <= 0 || !Number.isFinite(inputs.strength_model))
        ) {
          throw new CandidateExecutionMismatchError(
            `LoRA loader node "${nodeId}" strength_model must be a positive finite number`,
            "LORA_STRENGTH_INVALID"
          );
        }
      }
    }

    // Geometry, frame count, and CFG validation on generator or latent nodes
    if (
      classType === "MiniMaxH3ImageToVideo" ||
      classType === "MiniMaxH3ReferenceToVideo" ||
      classType === "EmptyMiniMaxH3LatentAV"
    ) {
      // These values define the actual generated media. Treat omission the same
      // as a mismatch: a matching template hash is not proof that the final
      // submitted graph still has the profile's exact geometry and timing.
      for (const [field, expected] of [
        ["width", candidate.specification.width],
        ["height", candidate.specification.height]
      ] as const) {
        if (inputs[field] !== expected) {
          throw new CandidateExecutionMismatchError(
            `Node "${nodeId}" (${classType}) must set ${field} to candidate value ${expected}; got ${String(inputs[field])}`,
            "GEOMETRY_MISMATCH"
          );
        }
      }
      const configuredFrames = inputs.length ?? inputs.frames ?? inputs.num_frames;
      if (configuredFrames !== candidate.specification.frames) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) must set frame count to candidate value ${candidate.specification.frames}; got ${String(configuredFrames)}`,
          "FRAME_COUNT_MISMATCH"
        );
      }
      if (inputs.fps !== undefined && inputs.fps !== candidate.specification.fps) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) fps (${inputs.fps}) does not match candidate specification fps (${candidate.specification.fps})`,
          "FPS_MISMATCH"
        );
      }
      if (inputs.width !== undefined && inputs.width !== candidate.specification.width) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) width (${inputs.width}) does not match candidate specification width (${candidate.specification.width})`,
          "GEOMETRY_MISMATCH"
        );
      }
      if (inputs.height !== undefined && inputs.height !== candidate.specification.height) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) height (${inputs.height}) does not match candidate specification height (${candidate.specification.height})`,
          "GEOMETRY_MISMATCH"
        );
      }
      const nodeFrames = inputs.length ?? inputs.frames ?? inputs.num_frames;
      if (nodeFrames !== undefined && nodeFrames !== candidate.specification.frames) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) frames (${nodeFrames}) does not match candidate specification frames (${candidate.specification.frames})`,
          "FRAME_COUNT_MISMATCH"
        );
      }
      if (inputs.fps !== undefined && inputs.fps !== candidate.specification.fps) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) fps (${inputs.fps}) does not match candidate specification fps (${candidate.specification.fps})`,
          "FPS_MISMATCH"
        );
      }
      if (inputs.cfg !== undefined && inputs.cfg !== candidate.specification.cfg) {
        throw new CandidateExecutionMismatchError(
          `Node "${nodeId}" (${classType}) cfg (${inputs.cfg}) does not match candidate specification cfg (${candidate.specification.cfg})`,
          "CFG_MISMATCH"
        );
      }
    }

    if ("cfg" in inputs && inputs.cfg !== candidate.specification.cfg) {
      throw new CandidateExecutionMismatchError(
        `Workflow CFG (${String(inputs.cfg)}) does not match candidate specification CFG (${candidate.specification.cfg})`,
        "CFG_MISMATCH"
      );
    }

    // Scheduler inputs
    if (classType === "BasicScheduler" || ("steps" in inputs && "scheduler" in inputs)) {
      hasSchedulerNode = true;
      if (inputs.steps !== undefined && inputs.steps !== candidate.specification.steps) {
        throw new CandidateExecutionMismatchError(
          `Workflow scheduler steps (${inputs.steps}) does not match candidate specification steps (${candidate.specification.steps})`,
          "STEPS_MISMATCH"
        );
      }
      if (
        inputs.scheduler !== undefined &&
        inputs.scheduler !== candidate.specification.scheduler
      ) {
        throw new CandidateExecutionMismatchError(
          `Workflow scheduler "${inputs.scheduler}" does not match candidate specification scheduler "${candidate.specification.scheduler}"`,
          "SCHEDULER_MISMATCH"
        );
      }
      if (inputs.denoise !== undefined && inputs.denoise !== candidate.specification.denoise) {
        throw new CandidateExecutionMismatchError(
          `Workflow denoise (${inputs.denoise}) does not match candidate specification denoise (${candidate.specification.denoise})`,
          "DENOISE_MISMATCH"
        );
      }
    }

    // Sampler inputs
    if (classType === "KSamplerSelect" || "sampler_name" in inputs) {
      hasSamplerNode = true;
      if (
        inputs.sampler_name !== undefined &&
        inputs.sampler_name !== candidate.specification.sampler
      ) {
        throw new CandidateExecutionMismatchError(
          `Workflow sampler "${inputs.sampler_name}" does not match candidate specification sampler "${candidate.specification.sampler}"`,
          "SAMPLER_MISMATCH"
        );
      }
    }

    // Attention backend inspection: detect silent dense-attention fallback
    if (classType.toLowerCase().includes("attention") || "attention_backend" in inputs) {
      hasAttentionNode = true;
      const nodeBackend = String(inputs.attention_backend ?? "").toLowerCase();
      if (
        (nodeBackend === "standard" || nodeBackend === "dense") &&
        candidate.specification.attention.backend !== "standard"
      ) {
        throw new CandidateExecutionMismatchError(
          `Detected silent dense-attention fallback: candidate profile requires "${candidate.specification.attention.backend}", but node "${nodeId}" configured "${nodeBackend}"`,
          "DENSE_ATTENTION_FALLBACK"
        );
      }
      if (
        candidate.specification.attention.backend !== "standard" &&
        nodeBackend !== candidate.specification.attention.backend.toLowerCase()
      ) {
        throw new CandidateExecutionMismatchError(
          `Attention backend mismatch: expected "${candidate.specification.attention.backend}", but node "${nodeId}" configured "${nodeBackend}"`,
          "ATTENTION_BACKEND_MISMATCH"
        );
      }
      if (candidate.specification.attention.sparsitySettings.enabled) {
        if (
          inputs.sparsity_method !== undefined &&
          String(inputs.sparsity_method).toLowerCase() !==
            candidate.specification.attention.sparsitySettings.method.toLowerCase()
        ) {
          throw new CandidateExecutionMismatchError(
            `Attention sparsity method mismatch: expected "${candidate.specification.attention.sparsitySettings.method}", but node "${nodeId}" configured "${inputs.sparsity_method}"`,
            "SPARSITY_MISMATCH"
          );
        }
      }
      if (
        inputs.fail_on_fallback !== undefined &&
        (inputs.fail_on_fallback === false ||
          inputs.fail_on_fallback === 0 ||
          inputs.fail_on_fallback === "false")
      ) {
        throw new CandidateExecutionMismatchError(
          `Attention fail_on_fallback must not be disabled for candidate "${candidate.key}"`,
          "FAIL_ON_FALLBACK_DISABLED"
        );
      }
    }
  }

  if (!hasGeneratorNode) {
    throw new CandidateExecutionMismatchError(
      `Workflow is missing required generator node for candidate route "${candidate.specification.route}"`,
      "MISSING_REQUIRED_NODE"
    );
  }
  if (!hasSchedulerNode) {
    throw new CandidateExecutionMismatchError(
      `Workflow is missing required scheduler node for candidate route "${candidate.specification.route}"`,
      "MISSING_REQUIRED_NODE"
    );
  }
  if (!hasSamplerNode) {
    throw new CandidateExecutionMismatchError(
      `Workflow is missing required sampler node for candidate route "${candidate.specification.route}"`,
      "MISSING_REQUIRED_NODE"
    );
  }
  if (candidate.specification.modelHashes.turboLora !== "none" && !hasLoraNode) {
    throw new CandidateExecutionMismatchError(
      `Workflow is missing required LoRA loader node for candidate Turbo LoRA`,
      "MISSING_REQUIRED_NODE"
    );
  }
  if (candidate.specification.attention.backend !== "standard" && !hasAttentionNode) {
    throw new CandidateExecutionMismatchError(
      `Workflow is missing required attention backend selector node for "${candidate.specification.attention.backend}"`,
      "MISSING_REQUIRED_NODE"
    );
  }
  if (candidate.specification.modelHashes.checkpoint && !hasCheckpointNode) {
    throw new CandidateExecutionMismatchError(
      `Workflow is missing required checkpoint loader node for candidate "${candidate.key}"`,
      "MISSING_REQUIRED_NODE"
    );
  }

  // Provenance runtime observer attention check
  if (candidate.specification.attention.backend !== "standard" && candidateProvenanceReport) {
    const optimizerFingerprint =
      candidateProvenanceReport.renderProfileProvenance?.optimizerFingerprint;
    if (
      optimizerFingerprint &&
      (optimizerFingerprint.attentionBackend === "standard" ||
        optimizerFingerprint.attentionBackend === "dense" ||
        optimizerFingerprint.attentionBackend !== candidate.specification.attention.backend)
    ) {
      throw new CandidateExecutionMismatchError(
        `Detected silent dense-attention fallback: candidate profile requires "${candidate.specification.attention.backend}", but runtime observed "${optimizerFingerprint.attentionBackend}"`,
        "DENSE_ATTENTION_FALLBACK"
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
  const candidateProvenancePath =
    options?.candidateProvenancePath ?? options?.goldMasterProvenancePath ?? manifestPath;
  const comfyUiDir = options?.comfyUiDir ?? process.env.COMFYUI_DIR ?? "";
  const comfyUiEndpoint = options?.comfyUiEndpoint ?? process.env.COMFYUI_URL;

  // Shared target identity for live runtime observation/eligibility calls. comfyUiEndpoint is
  // required here: H3LiveRuntimeObserver resolves the live PID from whichever local process is
  // listening on this endpoint's port, and refuses to fall back to "whatever process this
  // Node.js runner happens to be" (ADR 0008 section 6 - no self-process fallback).
  const buildRuntimeTarget = (
    gpuUuid: string
  ): {
    hostname: string;
    gpuUuid: string;
    comfyUiDir?: string;
    comfyUiEndpoint?: string;
  } => ({
    hostname: deps?.targetHostname ?? hostname(),
    gpuUuid,
    ...(comfyUiDir ? { comfyUiDir } : {}),
    ...(comfyUiEndpoint ? { comfyUiEndpoint } : {})
  });

  const executeCandidateRenderJob = async (
    job: RenderJob,
    candidateKey: string
  ): Promise<WorkerRenderOutput> => {
    // 1. Enforce staging execution scope gate
    if (job.executionScope !== "staging") {
      throw new CandidateProfileProductionDisabledError(
        `Candidate profile "${candidateKey}" requires executionScope to be "staging". Ordinary production queues remain disabled until #428 promotion.`
      );
    }

    // 2. Resolve candidate profile from trusted registry reader
    const registryReader = deps?.registryReader ?? options?.registryReader;
    const candidate = registryReader?.getCandidateProfile(candidateKey);
    if (!candidate) {
      throw new CandidateExecutionMismatchError(
        `MiniMax-H3 candidate profile "${candidateKey}" is not admitted in trusted candidate registry`,
        "UNKNOWN_CANDIDATE_PROFILE"
      );
    }

    const selection = resolveCandidateExecutionSelection(
      candidate,
      options?.comfyUiRenderTimeoutMs ?? deps?.comfyUiRenderTimeoutMs
    );

    // 3. Candidate route & topology setup
    const isRef2v = candidate.specification.route === "ref2v";
    const isH3I2v = candidate.specification.route === "i2v";
    const topology = candidate.topology;

    // 4. Validate injectedPayload with candidate profile awareness
    const validatedInjected = validateInjectedPayload(
      job.injectedPayload,
      job.jobKind,
      {
        id: candidate.key,
        engine: isRef2v ? "minimax_h3_ref2v" : "minimax_h3_i2v",
        renderProfileIdentity: {
          key: candidate.key as unknown as RenderProfileKey,
          version: 1
        },
        topology: candidate.topology
      } as unknown as CertificationProfile,
      registryReader
    );

    // 5. Check candidateSpecificationDigest if injected
    if (
      validatedInjected.candidateSpecificationDigest &&
      validatedInjected.candidateSpecificationDigest !== candidate.specificationDigest
    ) {
      throw new CandidateExecutionMismatchError(
        `Candidate specification digest mismatch: job injected "${validatedInjected.candidateSpecificationDigest}", candidate profile declared "${candidate.specificationDigest}"`,
        "SPECIFICATION_DIGEST_MISMATCH"
      );
    }

    // 6. Check exact frame count against candidate specification
    if (validatedInjected.frameCount !== candidate.specification.frames) {
      throw new CandidateExecutionMismatchError(
        `injected frameCount (${validatedInjected.frameCount}) must match candidate profile frames (${candidate.specification.frames})`,
        "FRAME_COUNT_MISMATCH"
      );
    }

    // 7. Load approved candidate provenance & verify
    const readCandidateProvenanceFn = deps?.readCandidateProvenance ?? readApprovedProvenanceFn;
    const resolveCandidateProvenanceFn =
      deps?.resolveCandidateProvenance ?? resolveCandidateProvenanceFromCollection;

    let candidateProvenanceReport: H3CandidateProvenanceReport;
    try {
      const rawProvenance = await readCandidateProvenanceFn(candidateProvenancePath);
      candidateProvenanceReport = resolveCandidateProvenanceFn(rawProvenance, candidateKey);
    } catch (cause) {
      throw new CandidateExecutionMismatchError(
        `Failed to resolve candidate provenance for "${candidateKey}": ${(cause as Error).message}`,
        "PROVENANCE_RESOLUTION_FAILED",
        { cause }
      );
    }

    // Check workflow path for directory traversal or absolute path
    if (
      candidateProvenanceReport.workflow.relativePath.includes("..") ||
      isAbsolute(candidateProvenanceReport.workflow.relativePath)
    ) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance workflow relativePath "${candidateProvenanceReport.workflow.relativePath}" contains directory traversal or is absolute`,
        "INVALID_WORKFLOW_PATH"
      );
    }

    // 8. Require and verify operator authorization grant before GPU work
    const grant =
      (validatedInjected as { authorizationGrant?: H3CandidateAuthorizationGrant })
        .authorizationGrant ??
      (job.injectedPayload as { authorizationGrant?: H3CandidateAuthorizationGrant })
        ?.authorizationGrant;
    if (!grant) {
      throw new CandidateExecutionMismatchError(
        `Candidate profile "${candidateKey}" requires a signed operator authorization grant before execution`,
        "MISSING_SIGNED_GRANT"
      );
    }

    if (!deps?.authorizationPort) {
      throw new CandidateExecutionMismatchError(
        `Candidate profile "${candidateKey}" requires authorizationPort dependency to verify operator authorization grant before execution`,
        "MISSING_AUTHORIZATION_PORT"
      );
    }
    // Staging/production execution must be bound to a real, operator-declared physical GPU.
    // A silently-defaulted placeholder here would let authorization/eligibility checks pass
    // against a GPU that doesn't exist, defeating the host/GPU-bound grant model entirely
    // (see ADR 0008 section 6, Live Runtime Observation Invariant). Fail closed instead.
    if (!deps?.targetGpuUuid) {
      throw new CandidateExecutionMismatchError(
        `Candidate profile "${candidateKey}" requires a configured targetGpuUuid identifying the real physical GPU this worker executes on; refusing to default to a placeholder GPU identity`,
        "MISSING_TARGET_GPU_UUID"
      );
    }
    const targetGpuUuid = deps.targetGpuUuid;
    const authDecision = await deps.authorizationPort.verifyCandidateAuthorization({
      grant,
      candidateKey,
      specificationDigest: candidate.specificationDigest,
      targetHostname: deps?.targetHostname ?? hostname(),
      targetGpuUuid,
      purpose: "staging",
      goldMasterWorkflowHash: candidate.specification.workflowHash,
      goldMasterModelHashesDigest: grant.payload?.goldMasterModelHashesDigest ?? ""
    });
    if (!authDecision.authorized) {
      throw new CandidateExecutionMismatchError(
        `Candidate authorization denied: ${authDecision.blocker ?? "unauthorized"}`,
        authDecision.blocker ?? "GRANT_AUTHORIZATION_DENIED"
      );
    }

    // Live runtime observation and eligibility evaluation
    const eligibilityService =
      deps?.eligibilityService ??
      (deps?.authorizationPort && deps?.runtimeObservationPort
        ? new H3CandidateEligibilityService({
            authorizationPort: deps.authorizationPort,
            runtimeObservationPort: deps.runtimeObservationPort,
            registryReader
          })
        : undefined);

    if (!eligibilityService) {
      throw new CandidateExecutionMismatchError(
        `Candidate profile "${candidateKey}" requires runtimeObservationPort or eligibilityService to verify live host, process, and optimizer eligibility`,
        "MISSING_RUNTIME_OBSERVATION_PORT"
      );
    }

    let liveObservation: { comfyUiCoreRevision: string } | undefined;
    if (deps?.runtimeObservationPort) {
      const liveObs = await deps.runtimeObservationPort.observeCurrentRuntime(
        buildRuntimeTarget(targetGpuUuid)
      );
      if (liveObs.ok && liveObs.observation) {
        liveObservation = liveObs.observation;
      }
    }

    const eligibilityDecision = await eligibilityService.evaluateEligibility({
      candidateKey,
      target: buildRuntimeTarget(targetGpuUuid),
      executionContext: {
        route: candidate.specification.route,
        routingMode: candidate.specification.routingMode,
        width: candidate.specification.width,
        height: candidate.specification.height,
        frames: candidate.specification.frames,
        workflowHash: candidate.specification.workflowHash,
        modelHashes: flattenH3CandidateModelHashes(candidate.specification.modelHashes),
        steps: candidate.specification.steps,
        sampler: candidate.specification.sampler,
        scheduler: candidate.specification.scheduler,
        runnerProfile: candidate.specification.runnerSettings.runnerProfile,
        cfg: candidate.specification.cfg,
        denoise: candidate.specification.denoise
      },
      goldMasterProvenance: {
        workflowHash: candidateProvenanceReport.workflow.sha256,
        modelHashes: candidateProvenanceReport.renderProfileProvenance.modelHashes
      },
      authorizationGrant: grant,
      purpose: "staging"
    });

    if (!eligibilityDecision.eligible) {
      throw new CandidateExecutionMismatchError(
        `Candidate profile ineligible for staging: ${eligibilityDecision.blockerCode} - ${eligibilityDecision.message}`,
        eligibilityDecision.blockerCode
      );
    }

    // Verify candidate provenance matches specification
    if (candidateProvenanceReport.candidateKey !== candidate.key) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance report candidateKey "${candidateProvenanceReport.candidateKey}" does not match profile key "${candidate.key}"`,
        "PROVENANCE_KEY_MISMATCH"
      );
    }
    const reportProv = candidateProvenanceReport.renderProfileProvenance;
    if (reportProv.frames !== candidate.specification.frames) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance frames ${reportProv.frames} does not match candidate specification frames ${candidate.specification.frames}`,
        "FRAME_COUNT_MISMATCH"
      );
    }
    if (
      reportProv.width !== candidate.specification.width ||
      reportProv.height !== candidate.specification.height
    ) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance dimensions ${reportProv.width}x${reportProv.height} do not match candidate specification dimensions ${candidate.specification.width}x${candidate.specification.height}`,
        "GEOMETRY_MISMATCH"
      );
    }
    if (reportProv.route !== candidate.specification.route) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance route "${reportProv.route}" does not match candidate specification route "${candidate.specification.route}"`,
        "ROUTE_MISMATCH"
      );
    }
    if (reportProv.routingMode !== candidate.specification.routingMode) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance routingMode "${reportProv.routingMode}" does not match candidate specification routingMode "${candidate.specification.routingMode}"`,
        "ROUTING_MODE_MISMATCH"
      );
    }
    if (reportProv.workflowHash !== candidate.specification.workflowHash) {
      throw new CandidateExecutionMismatchError(
        `Candidate provenance workflowHash "${reportProv.workflowHash}" does not match candidate specification workflowHash "${candidate.specification.workflowHash}"`,
        "WORKFLOW_HASH_MISMATCH"
      );
    }
    for (const [modelKey, expectedHash] of Object.entries(candidate.specification.modelHashes)) {
      if (modelKey === "additionalModels") {
        if (typeof expectedHash === "object" && expectedHash !== null) {
          for (const [addKey, addHash] of Object.entries(expectedHash)) {
            if (reportProv.modelHashes[addKey] !== addHash) {
              throw new CandidateExecutionMismatchError(
                `Candidate provenance additional model hash for "${addKey}" mismatch: expected "${addHash}", got "${reportProv.modelHashes[addKey]}"`,
                "MODEL_HASH_MISMATCH"
              );
            }
          }
        }
        continue;
      }
      if (modelKey === "turboLora" && expectedHash === "none") {
        continue;
      }
      if (reportProv.modelHashes[modelKey] !== expectedHash) {
        throw new CandidateExecutionMismatchError(
          `Candidate provenance model hash for "${modelKey}" mismatch: expected "${expectedHash}", got "${reportProv.modelHashes[modelKey]}"`,
          "MODEL_HASH_MISMATCH"
        );
      }
    }

    // 8. Load workflow file & recheck hash
    const candidateWorkflowPath = resolve(
      comfyUiDir || DEFAULT_REPO_ROOT,
      candidateProvenanceReport.workflow.relativePath
    );
    const rawWorkflow = await readWorkflowFileFn(candidateWorkflowPath);
    const recheckedWorkflowHash = hashWorkflowFn(rawWorkflow);

    if (
      recheckedWorkflowHash !== candidate.specification.workflowHash ||
      recheckedWorkflowHash !== candidateProvenanceReport.workflow.sha256
    ) {
      throw new WorkflowHashMismatchError(
        `Workflow hash mismatch for candidate "${candidateKey}": rechecked "${recheckedWorkflowHash}", expected "${candidate.specification.workflowHash}"`
      );
    }

    // 9. Authoritative license routing guard evaluated BEFORE any external I/O
    const licenseComponentId =
      H3_CANDIDATE_LICENSE_COMPONENT_BY_ROUTE[candidate.specification.route];
    if (!licenseComponentId) {
      throw new CandidateExecutionMismatchError(
        `Candidate profile "${candidateKey}" has unrecognized route "${candidate.specification.route}" with no corresponding license-registry component`,
        "UNLICENSED_CANDIDATE_ROUTE"
      );
    }
    if (deps?.enforceLicenseRouting) {
      deps.enforceLicenseRouting.enforce({
        requiredComponents: [
          {
            componentId: licenseComponentId,
            componentType: "model",
            versionOrRevision: H3_CANDIDATE_LICENSE_COMPONENT_VERSION
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
        renderProfileKey: candidate.key,
        renderProfileVersion: candidate.version,
        engine: candidate.specification.route === "i2v" ? "minimax_h3_i2v" : "minimax_h3_ref2v"
      });
    }

    // 10. Conditioning and ShotPlan route constraints
    let resolvedCandidateMedia: ResolvedApprovedVisualProductionMedia | undefined;
    let stagedReferenceImage: StagedComfyUiInput | undefined;
    let stagingFilename: string | undefined;
    let canonicalRefs: readonly CanonicalReferenceEntry[] = [];

    const stagedRefInputs: StagedComfyUiInput[] = [];
    const manifestRefImages: ManifestReferenceImageEntry[] = [];
    const stagedRefPaths: string[] = [];
    let promptToInject = validatedInjected.prompt;
    let executedInstruction: ManifestExecutedInstruction | undefined;
    let previsReviewEvidence: ManifestPrevisReviewEvidence | undefined;

    let executionError: unknown;
    let executionResult: WorkerRenderOutput | undefined;
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
        // Invariant: Ref2V shot plan cannot be executed on I2V candidate; ShotPlan routingMode must match
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

        canonicalRefs = canonicalizeReferenceBindings({
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

            const refStagingFilename = buildDeterministicStagingFilename(
              job.sceneId,
              `${job.jobId}-slot${ref.slotIndex}`,
              actualSha256,
              ref.asset.mimeType ?? "image/png"
            );
            if (refStagingFilename.includes("..")) {
              throw new ReferenceImageIntegrityError("refStagingFilename contains path traversal");
            }

            const stagedInput = await deps.stageReferenceImage.stage({
              filename: refStagingFilename,
              bytes: stored.body,
              contentType: ref.asset.mimeType ?? "image/png"
            });
            if (
              stagedInput.name.includes("/") ||
              stagedInput.name.includes("\\") ||
              stagedInput.name.includes("..") ||
              (stagedInput.subfolder &&
                (stagedInput.subfolder.includes("..") ||
                  stagedInput.subfolder.startsWith("/") ||
                  stagedInput.subfolder.startsWith("\\")))
            ) {
              throw new ReferenceImageIntegrityError("stagedInput contains path traversal");
            }
            stagedRefInputs.push(stagedInput);

            const stagedPath = stagedInput.subfolder
              ? `${stagedInput.subfolder}/${stagedInput.name}`
              : stagedInput.name;
            stagedRefPaths.push(stagedPath);

            const injectionTarget = topology.referenceImages![ref.slotIndex - 1]!;
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

        const sceneSpec = {
          revision: validatedInjected.specRevision,
          actionContext: sceneSnapshot.configuration?.prompt,
          scriptContext: (sceneSnapshot as { scriptContext?: string }).scriptContext
        };

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
      } else if (isH3I2v) {
        // Frame-anchored MiniMax-H3 execution
        if (!validatedInjected.shotPlanId) {
          throw new RenderJobExecutionError(
            "injectedPayload.shotPlanId is required for candidate frame-anchored execution"
          );
        }
        if (validatedInjected.specRevision === undefined) {
          throw new RenderJobExecutionError(
            "injectedPayload.specRevision is required for candidate frame-anchored execution"
          );
        }
        if (!deps?.shotPlanRepository) {
          throw new RenderJobExecutionError(
            "shotPlanRepository dependency is required for frame-anchored execution"
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
        // Invariant: Ref2V ShotPlan cannot inherit I2V eligibility!
        if (shotPlanDoc.routingMode !== "frame_anchored") {
          throw new CandidateExecutionMismatchError(
            `ShotPlan "${shotPlanDoc.id}" routingMode "${shotPlanDoc.routingMode}" does not match candidate profile route "i2v" (requires "frame_anchored")`
          );
        }

        if (!deps?.sceneRepository) {
          throw new RenderJobExecutionError(
            "sceneRepository dependency is required for frame-anchored execution"
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
            `Scene "${job.sceneId}" has no approvedShotPlanId; frame-anchored execution requires current-scene ShotPlan approval`
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
            `Scene "${job.sceneId}" has no approvedShotPlanRevision; frame-anchored execution requires verified current-revision approval`
          );
        }
        if (sceneSnapshot.approvedShotPlanRevision !== validatedInjected.specRevision) {
          throw new RenderJobExecutionError(
            `Scene "${job.sceneId}" approvedShotPlanRevision ${sceneSnapshot.approvedShotPlanRevision} does not match injected specRevision ${validatedInjected.specRevision}`
          );
        }

        if (!shotPlanDoc.continuity) {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" missing continuity for frame-anchored execution`
          );
        }
        if (shotPlanDoc.continuity.frameAnchorTarget !== "first_frame") {
          throw new CandidateExecutionMismatchError(
            `ShotPlan "${shotPlanDoc.id}" continuity.frameAnchorTarget must be "first_frame", got "${shotPlanDoc.continuity?.frameAnchorTarget}"`
          );
        }
        if (!shotPlanDoc.continuity.anchorCandidateId) {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" frame-anchored execution requires explicit anchorCandidateId`
          );
        }
        if (shotPlanDoc.continuity.anchorCandidateId !== validatedInjected.approvedCandidateId) {
          throw new CandidateExecutionMismatchError(
            `ShotPlan "${shotPlanDoc.id}" continuity.anchorCandidateId "${shotPlanDoc.continuity.anchorCandidateId}" does not match injected approvedCandidateId "${validatedInjected.approvedCandidateId}"`
          );
        }
        if (!shotPlanDoc.continuity.anchorMediaHashSha256) {
          throw new RenderJobExecutionError(
            `ShotPlan "${shotPlanDoc.id}" frame-anchored execution requires explicit anchorMediaHashSha256`
          );
        }
        if (shotPlanDoc.previs) {
          previsReviewEvidence = {
            candidateId: shotPlanDoc.previs.candidateId,
            contentHashSha256: shotPlanDoc.previs.contentHashSha256,
            specRevision: validatedInjected.specRevision!
          };
        }

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
            `Candidate profile "${candidate.key}" requires an approved candidate for conditioning, but injectedPayload.approvedCandidateId was not provided`
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

        const bytes = stored.body;
        if (bytes.length < 8) {
          throw new ReferenceImageIntegrityError(
            `Reference image object "${resolvedCandidateMedia.media.key}" buffer is too small to be a valid image`
          );
        }

        const declaredMime = (
          resolvedCandidateMedia.media.contentType ?? "image/png"
        ).toLowerCase();
        const imageInfo = parseImageByteHeader(bytes);
        if (!imageInfo) {
          throw new ReferenceImageIntegrityError(
            `Reference image object "${resolvedCandidateMedia.media.key}" has unknown or unsupported image format magic bytes`
          );
        }
        if (imageInfo.mimeType !== declaredMime) {
          throw new ReferenceImageIntegrityError(
            `Reference image object "${resolvedCandidateMedia.media.key}" detected format "${imageInfo.mimeType}" does not match declared MIME "${declaredMime}"`
          );
        }
        if (imageInfo.width <= 0 || imageInfo.height <= 0) {
          throw new ReferenceImageIntegrityError(
            `Reference image object "${resolvedCandidateMedia.media.key}" must have positive dimensions`
          );
        }

        const actualSha256 = await hashBytesPort.hashBytes(stored.body);
        if (actualSha256 !== resolvedCandidateMedia.media.sha256) {
          throw new ReferenceImageIntegrityError(
            `Reference image sha256 mismatch: expected "${resolvedCandidateMedia.media.sha256}", got "${actualSha256}"`
          );
        }
        if (
          shotPlanDoc?.continuity?.anchorMediaHashSha256 &&
          actualSha256 !== shotPlanDoc.continuity.anchorMediaHashSha256
        ) {
          throw new ReferenceImageIntegrityError(
            `Reference image sha256 mismatch against ShotPlan continuity: expected "${shotPlanDoc.continuity.anchorMediaHashSha256}", got "${actualSha256}"`
          );
        }

        const imageValidator = deps?.imageValidator ?? deps?.imageInspectionPort;
        if (imageValidator) {
          let inspected: ValidatedImageMetadata;
          try {
            inspected = await imageValidator.inspectAndValidate(bytes, declaredMime);
          } catch (cause) {
            throw new ReferenceImageIntegrityError(
              `Reference image object "${resolvedCandidateMedia.media.key}" decode validation failed: ${(cause as Error).message}`,
              { cause }
            );
          }
          if (inspected.detectedMimeType !== declaredMime) {
            throw new ReferenceImageIntegrityError(
              `Reference image object "${resolvedCandidateMedia.media.key}" detected format "${inspected.detectedMimeType}" does not match declared MIME "${declaredMime}"`
            );
          }
        }

        stagingFilename = buildDeterministicStagingFilename(
          job.sceneId,
          job.jobId,
          actualSha256,
          resolvedCandidateMedia.media.contentType ?? "image/png"
        );
        if (stagingFilename.includes("..")) {
          throw new ReferenceImageIntegrityError("stagingFilename contains path traversal");
        }

        stagedReferenceImage = await deps.stageReferenceImage.stage({
          filename: stagingFilename,
          bytes: stored.body,
          contentType: resolvedCandidateMedia.media.contentType ?? "image/png"
        });

        if (
          stagedReferenceImage.name.includes("/") ||
          stagedReferenceImage.name.includes("\\") ||
          stagedReferenceImage.name.includes("..") ||
          (stagedReferenceImage.subfolder &&
            (stagedReferenceImage.subfolder.includes("..") ||
              stagedReferenceImage.subfolder.startsWith("/") ||
              stagedReferenceImage.subfolder.startsWith("\\")))
        ) {
          throw new ReferenceImageIntegrityError("stagedReferenceImage contains path traversal");
        }
      }

      const referenceImageValue = stagedReferenceImage
        ? stagedReferenceImage.subfolder
          ? `${stagedReferenceImage.subfolder}/${stagedReferenceImage.name}`
          : stagedReferenceImage.name
        : undefined;

      // Recompute and verify candidate production input fingerprint
      const grantReference = grant
        ? `${computeAuthorizationPayloadDigest(grant.payload)}:${grant.signature}`
        : undefined;

      const recomputedFingerprint = computeCandidateProductionInputFingerprint({
        version: 2,
        sceneId: job.sceneId,
        specRevision: validatedInjected.specRevision!,
        shotPlanId: validatedInjected.shotPlanId ?? null,
        routingMode: isRef2v ? "reference_directed" : "frame_anchored",
        candidateKey: candidate.key,
        specificationDigest: candidate.specificationDigest,
        candidateVersion: candidate.version,
        executionScope: "staging",
        grantReference,
        workflowTemplate: candidate.specification.workflowHash,
        requestedDurationMs:
          validatedInjected.requestedDurationMs ??
          Math.round((candidate.specification.frames / candidate.specification.fps) * 1000),
        nominalDurationMs:
          validatedInjected.nominalDurationMs ??
          Math.round((candidate.specification.frames / candidate.specification.fps) * 1000),
        targetFrameCount: candidate.specification.frames,
        fps: candidate.specification.fps,
        width: candidate.specification.width,
        height: candidate.specification.height,
        compiledInstructionText: promptToInject ?? validatedInjected.prompt ?? "",
        compiledInstructionSha256:
          executedInstruction?.sha256 ??
          (isRef2v
            ? createHash("sha256")
                .update(Buffer.from(promptToInject ?? validatedInjected.prompt ?? "", "utf8"))
                .digest("hex")
            : "0000000000000000000000000000000000000000000000000000000000000000"),
        references: isRef2v
          ? canonicalRefs.map((r) => ({
              slotIndex: r.slotIndex,
              referenceAssetId: r.referenceAssetId,
              role: r.role,
              contentHashSha256: r.asset.contentHashSha256
            }))
          : undefined,
        frameAnchor:
          isH3I2v && resolvedCandidateMedia
            ? {
                frameAnchorTarget: "first_frame",
                anchorCandidateId: validatedInjected.approvedCandidateId!,
                anchorMediaHashSha256: resolvedCandidateMedia.media.sha256
              }
            : null
      });

      if (
        validatedInjected.productionInputFingerprint &&
        validatedInjected.specRevision !== undefined &&
        validatedInjected.productionInputFingerprint !== recomputedFingerprint
      ) {
        throw new CandidateExecutionMismatchError(
          `Production input fingerprint mismatch: job declared "${validatedInjected.productionInputFingerprint}", recomputed "${recomputedFingerprint}"`
        );
      }

      // 11. Mutate workflow
      const mutatedWorkflow = mutateWorkflow(
        rawWorkflow,
        {
          ...validatedInjected,
          ...(promptToInject !== undefined ? { prompt: promptToInject } : {}),
          ...(referenceImageValue !== undefined ? { referenceImage: referenceImageValue } : {}),
          ...(isRef2v ? { referenceImages: stagedRefPaths } : {})
        },
        {
          id: candidate.key,
          engine: isRef2v ? "minimax_h3_ref2v" : "minimax_h3_i2v",
          renderProfileIdentity: {
            key: candidate.key as unknown as RenderProfileKey,
            version: candidate.version
          },
          baseline: {
            width: candidate.specification.width,
            height: candidate.specification.height,
            frames: candidate.specification.frames,
            steps: candidate.specification.steps
          },
          topology: candidate.topology
        } as unknown as CertificationProfile
      );

      // 12. Validate candidate graph topology and negative gates
      validateCandidateGraph(
        mutatedWorkflow as Record<string, unknown>,
        candidate,
        candidateProvenanceReport
      );

      if (isRef2v && topology.referenceNode) {
        validateMiniMaxH3ReferenceToVideoInputSchema(
          topology.referenceNode.nodeId,
          (mutatedWorkflow as Record<string, unknown>)[topology.referenceNode.nodeId],
          mutatedWorkflow as Record<string, unknown>,
          stagedRefPaths.length
        );
      }

      // 13. Construct ProfileRenderIdentity
      const flattenedModelHashes: Record<string, string> = flattenH3CandidateModelHashes(
        candidate.specification.modelHashes
      );
      const identity: ProfileRenderIdentity = Object.freeze({
        profileId: candidate.key,
        renderProfileKey: candidate.key,
        renderProfileVersion: candidate.version,
        engine: (isRef2v
          ? "minimax_h3_ref2v"
          : "minimax_h3_i2v") as ProfileRenderIdentity["engine"],
        workflowSha256: recheckedWorkflowHash,
        modelSha256: flattenedModelHashes,
        runnerProfile: candidate.specification.runnerSettings.runnerProfile,
        comfyUiCommit:
          liveObservation?.comfyUiCoreRevision ??
          candidateProvenanceReport.observedRuntime?.comfyUiCoreRevision ??
          "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });

      // 14. Execute render
      const executeInput: ExecuteProfileRenderInput = {
        renderJobId: job.jobId,
        sceneId: job.sceneId,
        workflow: mutatedWorkflow,
        identity,
        executionPolicy: selection.executionPolicy,
        onLeaseAcquired: async () => {
          const recheckDecision = await eligibilityService.evaluateEligibility({
            candidateKey,
            target: buildRuntimeTarget(targetGpuUuid),
            executionContext: {
              route: candidate.specification.route,
              routingMode: candidate.specification.routingMode,
              width: candidate.specification.width,
              height: candidate.specification.height,
              frames: candidate.specification.frames,
              workflowHash: candidate.specification.workflowHash,
              modelHashes: flattenH3CandidateModelHashes(candidate.specification.modelHashes),
              steps: candidate.specification.steps,
              sampler: candidate.specification.sampler,
              scheduler: candidate.specification.scheduler,
              runnerProfile: candidate.specification.runnerSettings.runnerProfile,
              cfg: candidate.specification.cfg,
              denoise: candidate.specification.denoise
            },
            goldMasterProvenance: {
              workflowHash: candidateProvenanceReport.workflow.sha256,
              modelHashes: candidateProvenanceReport.renderProfileProvenance.modelHashes
            },
            authorizationGrant: grant,
            purpose: "staging"
          });
          if (!recheckDecision.eligible) {
            throw new CandidateExecutionMismatchError(
              `Candidate execution ineligible under GPU lease: ${recheckDecision.blockerCode} - ${recheckDecision.message}`,
              recheckDecision.blockerCode
            );
          }
        }
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

      if (renderResult.outputObjectKeys.length === 0) {
        throw new RenderJobExecutionError(
          "Candidate staging job requires at least 1 output object key, received 0"
        );
      }

      // 15. Read outputs, compute hashes
      const outputReader = deps?.outputReader ?? new HttpComfyUiOutputReader();
      const bucket = deliveryBucket;

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

      // 16. Probe primary video output
      const isAnimatedWebpFn = deps?.isAnimatedWebp ?? isAnimatedWebp;
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

      const bodyBytes =
        primaryOutput.body instanceof Uint8Array
          ? primaryOutput.body
          : Buffer.isBuffer(primaryOutput.body)
            ? new Uint8Array(primaryOutput.body)
            : new Uint8Array(Buffer.from(primaryOutput.body));

      let measuredMedia: ManifestMeasuredMedia;
      if (deps?.formatAwareProber) {
        measuredMedia = await deps.formatAwareProber({
          outputKey: primaryOutput.key,
          checksumSha256: primaryOutput.checksumSha256,
          bytes: bodyBytes,
          filename: primaryOutput.key.split("/").pop() ?? primaryOutput.key,
          ...(primaryOutput.contentType ? { contentType: primaryOutput.contentType } : {})
        });
      } else {
        const tempFileName = `cco-probe-${randomUUID()}.mp4`;
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
            errorContext: { jobId, outputKey: primaryOutput.key }
          });

          const videoStream = probed.videoStream;
          if (!videoStream || !videoStream.frameCount || videoStream.frameCount <= 0) {
            throw new ProductionManifestAssemblyError(
              `Job "${jobId}": Probed video stream in "${primaryOutput.key}" is missing a positive frameCount`,
              { jobId, outputKey: primaryOutput.key, formatPath: "ffprobe" }
            );
          }

          measuredMedia = {
            outputKey: primaryOutput.key,
            checksumSha256: primaryOutput.checksumSha256,
            container: "ffprobe",
            dimensions: { width: videoStream.width, height: videoStream.height },
            frameCount: videoStream.frameCount,
            fps: videoStream.frameRate,
            durationMs: videoStream.durationMs,
            formatDurationMs: probed.formatDurationMs,
            video: { codecName: videoStream.codecName, pixelFormat: videoStream.pixelFormat },
            measurement: "source_bytes"
          };
        } finally {
          await unlink(tempFilePath).catch(() => {});
        }
      }

      // 17. Post-render output validation against candidate specification
      if (measuredMedia.frameCount !== candidate.specification.frames) {
        throw new ProductionManifestAssemblyError(
          `Job "${jobId}": Probed output frame count ${measuredMedia.frameCount} does not match candidate specification frames ${candidate.specification.frames}`,
          { jobId, outputKey: primaryOutput.key }
        );
      }
      if (
        measuredMedia.dimensions.width !== candidate.specification.width ||
        measuredMedia.dimensions.height !== candidate.specification.height
      ) {
        throw new ProductionManifestAssemblyError(
          `Job "${jobId}": Probed output dimensions ${measuredMedia.dimensions.width}x${measuredMedia.dimensions.height} do not match candidate specification dimensions ${candidate.specification.width}x${candidate.specification.height}`,
          { jobId, outputKey: primaryOutput.key }
        );
      }
      if (
        measuredMedia.fps === null ||
        Math.abs(measuredMedia.fps - candidate.specification.fps) > 0.01
      ) {
        throw new ProductionManifestAssemblyError(
          `Job "${jobId}": Probed output fps ${measuredMedia.fps} does not match candidate specification fps ${candidate.specification.fps}`,
          { jobId, outputKey: primaryOutput.key }
        );
      }
      if (!Number.isFinite(measuredMedia.durationMs) || measuredMedia.durationMs <= 0) {
        throw new ProductionManifestAssemblyError(
          `Job "${jobId}": Probed output duration ${measuredMedia.durationMs}ms is invalid`,
          { jobId, outputKey: primaryOutput.key }
        );
      }
      if (
        measuredMedia.formatDurationMs !== undefined &&
        measuredMedia.formatDurationMs !== null &&
        Math.abs(measuredMedia.formatDurationMs - measuredMedia.durationMs) > 200
      ) {
        throw new ProductionManifestAssemblyError(
          `Job "${jobId}": Probed container format duration ${measuredMedia.formatDurationMs}ms diverges from stream duration ${measuredMedia.durationMs}ms beyond tolerance`,
          { jobId, outputKey: primaryOutput.key }
        );
      }
      const nominalDurationMs =
        (candidate.specification.frames / candidate.specification.fps) * 1000;
      if (Math.abs(measuredMedia.durationMs - nominalDurationMs) > 355) {
        throw new ProductionManifestAssemblyError(
          `Job "${jobId}": Probed output duration ${measuredMedia.durationMs}ms diverges from nominal duration ${nominalDurationMs}ms beyond tolerance`,
          { jobId, outputKey: primaryOutput.key }
        );
      }

      // 18. Configured media representing intent/workflow configuration
      const configuredMedia: ManifestConfiguredMedia = {
        outputKey: primaryOutput.key,
        checksumSha256: primaryOutput.checksumSha256,
        dimensions: {
          width: candidate.specification.width,
          height: candidate.specification.height
        },
        frameCount: candidate.specification.frames,
        fps: candidate.specification.fps,
        source: "render_profile_and_executed_workflow"
      };

      // 19. Assemble production manifest
      const assembler = deps?.productionManifestAssembler;
      if (!assembler) {
        throw new ProductionManifestAssemblyError(
          "Production render jobs require a ProductionManifestAssembler"
        );
      }

      const profileForAssembler: CertificationProfile = {
        id: candidate.key,
        engine: isRef2v ? "minimax_h3_ref2v" : "minimax_h3_i2v",
        workflowPath: candidateWorkflowPath,
        workflowRelativePath: candidateProvenanceReport.workflow.relativePath,
        expectedWorkflowHash: candidate.specification.workflowHash,
        source: {
          kind: "validated_host_export",
          uri: "https://github.com/Comfy-Org/MiniMax-H3",
          revision:
            liveObservation?.comfyUiCoreRevision ??
            candidateProvenanceReport.observedRuntime?.comfyUiCoreRevision ??
            "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          license: "ComfyUI"
        },
        baseline: {
          width: candidate.specification.width,
          height: candidate.specification.height,
          frames: candidate.specification.frames,
          steps: candidate.specification.steps,
          approximateDurationSeconds: candidate.specification.frames / candidate.specification.fps
        },
        minFreeDiskGb: candidate.specification.runnerSettings.minFreeDiskGb,
        runnerProfile: candidate.specification.runnerSettings.runnerProfile,
        models: [],
        assertions: [],
        renderProfileIdentity: {
          key: candidate.key as unknown as RenderProfileKey,
          version: candidate.version
        },
        topology: candidate.topology
      };

      const liveProvenance = {
        generatedAt: now().toISOString(),
        workflow: {
          sha256: recheckedWorkflowHash
        },
        models: Object.entries(flattenedModelHashes).map(([key, sha256]) => ({
          key,
          category: key.toLowerCase().includes("lora") ? "loras" : "checkpoints",
          sha256
        })),
        git: {
          comfyUiCommit:
            liveObservation?.comfyUiCoreRevision ??
            candidateProvenanceReport.observedRuntime?.comfyUiCoreRevision ??
            "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          customNodes: []
        }
      };

      const assembleInput: AssembleProductionManifestInput = {
        job,
        profile: profileForAssembler,
        renderResult,
        mediaObjects: Object.freeze(mediaObjects),
        workflow: mutatedWorkflow,
        configuredMedia,
        measuredMedia,
        liveProvenance,
        candidateSpecificationDigest: candidate.specificationDigest,
        grantReference,
        submittedGraphHash: hashWorkflowFn(JSON.stringify(mutatedWorkflow)),
        requestedDurationMs: validatedInjected.requestedDurationMs,
        nominalDurationMs: validatedInjected.nominalDurationMs,
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
              routingMode: "frame_anchored" as const,
              ...(stagedReferenceImage && resolvedCandidateMedia && topology.firstFrame
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
                        nodeId: topology.firstFrame.nodeId,
                        classType: topology.firstFrame.classType,
                        inputField: topology.firstFrame.inputField
                      }
                    }
                  }
                : {}),
              ...(validatedInjected.shotPlanId && validatedInjected.specRevision
                ? {
                    shotPlan: {
                      id: validatedInjected.shotPlanId,
                      specRevision: validatedInjected.specRevision
                    }
                  }
                : {}),
              submittedWorkflowHash: hashWorkflowFn(JSON.stringify(mutatedWorkflow))
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

      executionResult = {
        mediaObjects: Object.freeze(mediaObjects),
        manifestPayload: Object.freeze(manifestPayload)
      };
    } catch (err) {
      executionError = err;
    }

    const cleanupErrors: unknown[] = [];
    if (stagedReferenceImage && deps?.stageReferenceImage?.cleanup) {
      try {
        await deps.stageReferenceImage.cleanup(stagedReferenceImage);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    for (const staged of stagedRefInputs) {
      if (deps?.stageReferenceImage?.cleanup) {
        try {
          await deps.stageReferenceImage.cleanup(staged);
        } catch (err) {
          cleanupErrors.push(err);
        }
      }
    }

    if (executionError) {
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [executionError, ...cleanupErrors],
          "Candidate execution failed and reference image cleanup failed"
        );
      }
      throw executionError;
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Failed to clean up staged reference images");
    }

    return executionResult!;
  };

  return async (job: RenderJob): Promise<WorkerRenderOutput> => {
    const isCandidateKey = (key: string | undefined): key is string =>
      typeof key === "string" && /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(key);

    const rawInjected = job.injectedPayload as Record<string, unknown> | null;
    const candidateKey = isCandidateKey(job.workflowTemplate)
      ? job.workflowTemplate
      : isCandidateKey(rawInjected?.candidateProfileKey as string)
        ? (rawInjected?.candidateProfileKey as string)
        : undefined;

    if (candidateKey) {
      return executeCandidateRenderJob(job, candidateKey);
    }
    // 1. Resolve certified profile
    let profile: Awaited<ReturnType<typeof loadCertificationProfileFn>>;
    let resolvedReleaseSpecification: H3CandidateExecutionSpecification | undefined;
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
      } else if (deps?.productionReleaseReader) {
        const releasedKey = (rawInjected?.releasedProfileKey as string) ?? job.workflowTemplate;
        const released = await deps.productionReleaseReader.getReleasedProfile(releasedKey);
        if (released) {
          const isRef2v =
            released.specification.route === "ref2v" ||
            Boolean(
              released.topology?.referenceImages && released.topology.referenceImages.length > 0
            );
          const workflowRelativePath = isRef2v
            ? "minimax_h3_720p_ref2v_124f_api.json"
            : "minimax_h3_720p_i2v_124f_api.json";
          const manifestDir = dirname(manifestPath);
          const workflowPath = resolve(manifestDir, workflowRelativePath);
          const rawWorkflow = await readWorkflowFileFn(workflowPath);
          const computedWorkflowHash = hashWorkflowFn(rawWorkflow);
          if (computedWorkflowHash !== released.specification.workflowHash) {
            throw new WorkflowHashMismatchError(
              `Released profile "${released.key}" workflow hash mismatch: expected "${released.specification.workflowHash}", got "${computedWorkflowHash}"`
            );
          }
          profile = {
            id: released.key,
            engine: isRef2v ? "minimax_h3_ref2v" : "minimax_h3_i2v",
            workflowPath,
            workflowRelativePath,
            expectedWorkflowHash: released.specification.workflowHash,
            source: {
              kind: "official_upstream",
              uri: `comfy-release://${released.key}`,
              revision: `v${released.version}`,
              license: "proprietary"
            },
            baseline: {
              width: released.specification.width,
              height: released.specification.height,
              frames: released.specification.frames,
              steps: released.specification.steps,
              approximateDurationSeconds: Math.round(
                released.specification.frames / released.specification.fps
              )
            },
            minFreeDiskGb: 10,
            runnerProfile: "director_rtx_4090",
            models: [],
            assertions: [],
            // Preserve the real, hash-versioned released key (and the release's
            // own version number) rather than casting to a fixed-frame-count
            // legacy identity: resolveH3ProfileFrameCapabilities, getProfileInjectionTopology,
            // and the license-component lookup below all need the authentic
            // released key to resolve this profile's real (possibly >124) frame
            // count instead of silently falling back to the 124-frame legacy
            // capability.
            renderProfileIdentity: {
              key: released.key as H3ReleaseProfileKey,
              version: released.version
            },
            // getProfileInjectionTopology only recognizes the fixed legacy
            // profile identities; a dynamically hash-keyed release has no
            // entry there, so carry the release's own topology through
            // instead of relying on that lookup to resolve it.
            topology: released.topology
          };
          resolvedReleaseSpecification = released.specification;
        } else {
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

    const topology =
      profile.topology ??
      getProfileInjectionTopology(
        profile.renderProfileIdentity?.key ?? profile.id ?? profile.engine
      );
    if (profile.renderProfileIdentity && !topology) {
      throw new MissingProfileTopologyError(profile.id, profile.renderProfileIdentity.key);
    }

    // 2. Validate injectedPayload with profile awareness
    const renderProfileIdentityKey = profile.renderProfileIdentity.key;
    const releasedProfileReader = isReleasedProductionProfileKey(renderProfileIdentityKey)
      ? {
          getReleasedProfile: (key: string | undefined) =>
            key === renderProfileIdentityKey
              ? { key: renderProfileIdentityKey, specification: resolvedReleaseSpecification! }
              : undefined
        }
      : undefined;
    const validatedInjected = validateInjectedPayload(
      job.injectedPayload,
      job.jobKind,
      profile,
      releasedProfileReader
    );

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

    const isRef2v =
      profile.engine === "minimax_h3_ref2v" ||
      profile.renderProfileIdentity.key === "MINIMAX_H3_720P_5S_REF2V_V1" ||
      profile.renderProfileIdentity.key === "MINIMAX_H3_720P_5S_REF2V_TURBO4_V1" ||
      profile.id === "minimax-h3-720p-124f-ref2v" ||
      profile.id === "minimax-h3-720p-124f-ref2v-turbo4" ||
      resolvedReleaseSpecification?.route === "ref2v";

    const isH3I2v =
      profile.engine === "minimax_h3_i2v" ||
      profile.renderProfileIdentity.key === "MINIMAX_H3_720P_5S_I2V_V1" ||
      profile.id === "minimax-h3-720p-124f-i2v" ||
      resolvedReleaseSpecification?.route === "i2v";

    // A released profile's hash-keyed renderProfileIdentity is never itself
    // registered in the license registry (see enforceLicense in
    // execute-profile-render.ts) - it executes the same approved base MiniMax
    // H3 weights, routed by i2v/ref2v, so license checks must resolve against
    // that base component instead of failing closed on every release key.
    const licenseComponentId = isReleasedProductionProfileKey(profile.renderProfileIdentity.key)
      ? isRef2v
        ? "MINIMAX_H3_720P_5S_REF2V_V1"
        : "MINIMAX_H3_720P_5S_I2V_V1"
      : profile.renderProfileIdentity.key;
    const licenseVersionOrRevision = isReleasedProductionProfileKey(
      profile.renderProfileIdentity.key
    )
      ? "1"
      : String(profile.renderProfileIdentity.version);
    const licenseEngine = isRef2v ? "minimax_h3_ref2v" : isH3I2v ? "minimax_h3_i2v" : undefined;

    // Authoritative license routing guard evaluated BEFORE any external I/O (S3 reads, ComfyUI staging, GPU lease)
    if (deps?.enforceLicenseRouting) {
      deps.enforceLicenseRouting.enforce({
        requiredComponents: [
          {
            componentId: licenseComponentId,
            componentType: "model",
            versionOrRevision: licenseVersionOrRevision
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
        renderProfileVersion: profile.renderProfileIdentity.version,
        ...(licenseEngine !== undefined ? { engine: licenseEngine } : {})
      });
    }

    let resolvedCandidateMedia: ResolvedApprovedVisualProductionMedia | undefined;
    let stagedReferenceImage: StagedComfyUiInput | undefined;
    let stagingFilename: string | undefined;
    let canonicalRefs: readonly CanonicalReferenceEntry[] = [];

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

        canonicalRefs = canonicalizeReferenceBindings({
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
        let textAdvisory: PrevisTextAdvisory | undefined;
        if (profile.id === STORYBOARD_PREVIS_PROFILE_ID && deps?.previsTextDetector) {
          const startedAt = Date.now();
          textAdvisory = await runPrevisTextAdvisory(
            deps.previsTextDetector,
            {
              bytes: new Uint8Array(
                primaryMedia.body.buffer,
                primaryMedia.body.byteOffset,
                primaryMedia.body.byteLength
              ),
              contentType: primaryMedia.contentType
            },
            {
              ...(deps.previsTextAdvisoryPolicy ? { policy: deps.previsTextAdvisoryPolicy } : {}),
              ...(deps.previsTextAdvisoryTimeoutMs !== undefined
                ? { timeoutMs: deps.previsTextAdvisoryTimeoutMs }
                : {}),
              now
            }
          );
          try {
            (deps.previsTextAdvisoryLogger ?? console).info(
              JSON.stringify({
                event: "previs_text_advisory",
                jobId: job.jobId,
                sceneId: job.sceneId,
                shotPlanId: validatedInjected.shotPlanId,
                beatIndex: validatedInjected.beatIndex,
                status: textAdvisory.status,
                maxConfidence: textAdvisory.maxConfidence,
                detections: textAdvisory.detections.length,
                durationMs: Date.now() - startedAt
              })
            );
          } catch {
            // Logging must never affect job completion.
          }
        }
        const candidatePayload: Readonly<Record<string, unknown>> = Object.freeze({
          variantOrdinal: validatedInjected.variantOrdinal!,
          storageBucket: primaryMedia.bucket,
          storageObjectKey: primaryMedia.key,
          contentHashSha256: primaryMedia.checksumSha256!,
          ...(validatedInjected.beatIndex !== undefined
            ? { beatIndex: validatedInjected.beatIndex }
            : {}),
          ...(validatedInjected.shotPlanId ? { shotPlanId: validatedInjected.shotPlanId } : {}),
          ...(validatedInjected.specRevision !== undefined
            ? { specRevision: validatedInjected.specRevision }
            : {}),
          generationPayload: Object.freeze({
            promptIdComfy: renderResult.promptId,
            profile: renderResult.profile,
            originalOutputKey: renderResult.outputObjectKeys[0]!,
            ...(textAdvisory ? { textAdvisory } : {}),
            ...(validatedInjected.beatIndex !== undefined
              ? { beatIndex: validatedInjected.beatIndex }
              : {}),
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
          configuredFps = isH3I2v || isRef2v ? MINIMAX_H3_FPS : LTX_FPS;
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
