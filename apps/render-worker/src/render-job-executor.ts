import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type HashBytesPort,
  type ProfileRenderIdentity,
  type PutObjectInput,
  type RenderWorkflow
} from "@cco/application";
import type { CandidateId, JobKind, RenderJob } from "@cco/domain";
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
  override readonly name = "WorkflowHashMismatchError";
}

export class MissingCertifiedProfileError extends RenderJobExecutionError {
  override readonly name = "MissingCertifiedProfileError";
  readonly workflowTemplate: string;
  constructor(workflowTemplate: string, options?: ErrorOptions) {
    super(`no certified profile for workflow_template "${workflowTemplate}"`, options);
    this.workflowTemplate = workflowTemplate;
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
}

export type ProductionManifestAssembler =
  | {
      assembleManifest?: (
        input: AssembleProductionManifestInput
      ) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
      assemble?: (
        input: AssembleProductionManifestInput
      ) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
    }
  | ((
      input: AssembleProductionManifestInput
    ) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>);

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
    | { execute: (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult> }
    | undefined;
  readonly outputReader?: ComfyUiOutputReader | undefined;
  readonly productionManifestAssembler?: ProductionManifestAssembler | undefined;
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
}

const ALLOWED_CANDIDATE_KEYS = new Set(["prompt", "negativePrompt", "seed", "variantOrdinal"]);
const ALLOWED_PRODUCTION_KEYS = new Set([
  "prompt",
  "negativePrompt",
  "audioPrompt",
  "seed",
  "approvedCandidateId"
]);

function validateInjectedPayload(payload: unknown, jobKind: JobKind): ValidatedInjectedPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RenderJobPayloadValidationError("injectedPayload must be an object");
  }

  const allowedKeys = jobKind === "candidate" ? ALLOWED_CANDIDATE_KEYS : ALLOWED_PRODUCTION_KEYS;
  const keys = Object.keys(payload);

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      if (jobKind === "production" && key === "variantOrdinal") {
        throw new RenderJobPayloadValidationError(
          "variantOrdinal is candidate-only and not allowed in production jobs"
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
      throw new RenderJobPayloadValidationError(`Unknown injected payload field: "${key}"`);
    }
  }

  const raw = payload as Record<string, unknown>;
  let prompt: string | undefined;
  let negativePrompt: string | undefined;
  let audioPrompt: string | undefined;
  let seed: number | undefined;
  let variantOrdinal: number | undefined;
  let approvedCandidateId: CandidateId | undefined;

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

  return { prompt, negativePrompt, audioPrompt, seed, variantOrdinal, approvedCandidateId };
}

function mutateWorkflow(
  rawWorkflowJson: string,
  injected: ValidatedInjectedPayload
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
    // 1. Validate injectedPayload FIRST (before loading or rendering)
    const validatedInjected = validateInjectedPayload(job.injectedPayload, job.jobKind);

    // 2. Resolve certified profile
    let profile: Awaited<ReturnType<typeof loadCertificationProfileFn>>;
    try {
      profile = await loadCertificationProfileFn(manifestPath, job.workflowTemplate);
    } catch (cause) {
      throw new MissingCertifiedProfileError(job.workflowTemplate, { cause });
    }
    if (!profile.renderProfileIdentity) {
      throw new PreflightError(
        `Profile "${profile.id}" does not define renderProfileIdentity in manifest`
      );
    }

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

    const mutatedWorkflow = mutateWorkflow(rawWorkflow, validatedInjected);

    // 5. Construct ProfileRenderIdentity
    const identity: ProfileRenderIdentity = Object.freeze({
      profileId: profile.id,
      renderProfileKey: profile.renderProfileIdentity.key,
      renderProfileVersion: profile.renderProfileIdentity.version,
      engine: profile.engine as "ltx_25" | "flux_schnell",
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

    // 8. Read outputs, compute hashes, build PutObjectInputs
    const outputReader = deps?.outputReader ?? new HttpComfyUiOutputReader();
    const mediaObjects: PutObjectInput[] = [];

    const bucket = job.jobKind === "candidate" ? candidateBucket : deliveryBucket;

    for (const outputKey of renderResult.outputObjectKeys) {
      const output = await outputReader.readOutput(outputKey);
      const checksumSha256 = await hashBytesPort.hashBytes(output.bytes);
      const storageObjectKey = buildObjectKeyFn(job.sceneId, job.jobId, outputKey, checksumSha256);

      mediaObjects.push({
        bucket,
        key: storageObjectKey,
        body: output.bytes,
        checksumSha256,
        ...(output.contentType ? { contentType: output.contentType } : {})
      });
    }

    // 9. Completion payload assembly
    if (job.jobKind === "candidate") {
      const primaryMedia = mediaObjects[0]!;
      const candidatePayload: Readonly<Record<string, unknown>> = Object.freeze({
        variantOrdinal: validatedInjected.variantOrdinal!,
        storageBucket: primaryMedia.bucket,
        storageObjectKey: primaryMedia.key,
        contentHashSha256: primaryMedia.checksumSha256!,
        generationPayload: Object.freeze({
          promptIdComfy: renderResult.promptId,
          profile: renderResult.profile,
          originalOutputKey: renderResult.outputObjectKeys[0]!
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
      ...(validatedInjected.approvedCandidateId !== undefined
        ? { approvedCandidateId: validatedInjected.approvedCandidateId }
        : {})
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
  };
}

export const createRenderJobExecutor = createCertifiedRenderJobExecutor;
