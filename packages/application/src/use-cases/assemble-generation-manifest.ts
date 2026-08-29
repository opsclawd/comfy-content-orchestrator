import type { CandidateId, RenderJob } from "@cco/domain";
import type {
  HashBytesPort,
  PutObjectInput,
  ReferenceAssetRepository,
  RenderWorkflow,
  SceneRepository,
  StoryboardCandidateRepository
} from "../ports/index.js";
import type { ExecuteProfileRenderResult } from "./execute-profile-render.js";

export interface ManifestSourceProfile {
  readonly id: string;
  readonly engine: string;
  readonly runnerProfile: string;
  readonly source: Readonly<{
    kind: string;
    license: string;
    uri?: string;
    revision?: string;
  }>;
  readonly baseline: Readonly<{
    width?: number;
    height?: number;
    frames?: number;
    steps: number;
    approximateDurationSeconds?: number;
  }>;
  readonly models?: readonly {
    category: string;
    relativePath: string;
  }[];
}

export interface ManifestSourceProvenance {
  readonly generatedAt: string;
  readonly workflow: Readonly<{
    sha256: string;
  }>;
  readonly models: readonly {
    key: string;
    category: string;
    sha256: string;
    bytes: number;
  }[];
  readonly git: Readonly<{
    comfyUiCommit: string;
    customNodes: readonly unknown[];
  }>;
}

export interface AssembleGenerationManifestDeps {
  readonly hashBytes: HashBytesPort;
  readonly storyboardCandidateRepository: StoryboardCandidateRepository;
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly sceneRepository: SceneRepository;
}

export interface AssembleManifestInput {
  readonly job: RenderJob;
  readonly profile: ManifestSourceProfile;
  readonly renderResult: ExecuteProfileRenderResult;
  readonly provenance?: ManifestSourceProvenance | undefined;
  readonly liveProvenance?: ManifestSourceProvenance | undefined;
  readonly mediaObjects?: readonly PutObjectInput[] | undefined;
  readonly workflow?: RenderWorkflow | undefined;
  readonly approvedCandidateId?: CandidateId | undefined;
}

export interface AssembleManifestResult {
  readonly manifestPayload: Readonly<Record<string, unknown>>;
}

export class IncompleteManifestError extends Error {
  override readonly name = "IncompleteManifestError";
  readonly missingField: string;

  constructor(missingField: string, options?: ErrorOptions) {
    super(`Cannot assemble manifest: required field "${missingField}" is unavailable`, options);
    this.missingField = missingField;
  }
}

function findNodesByClassType(
  workflow: Readonly<Record<string, unknown>>,
  classType: string
): Array<{ nodeId: string; inputs: Record<string, unknown> }> {
  const result: Array<{ nodeId: string; inputs: Record<string, unknown> }> = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (
      typeof node === "object" &&
      node !== null &&
      !Array.isArray(node) &&
      (node as { class_type?: unknown }).class_type === classType &&
      typeof (node as { inputs?: unknown }).inputs === "object" &&
      (node as { inputs?: unknown }).inputs !== null
    ) {
      result.push({
        nodeId,
        inputs: (node as { inputs: Record<string, unknown> }).inputs
      });
    }
  }
  return result;
}

export class AssembleGenerationManifest {
  constructor(private readonly deps: AssembleGenerationManifestDeps) {}

  async assemble(input: AssembleManifestInput): Promise<AssembleManifestResult> {
    // 1. Identity & scene lookup
    const scene = await this.deps.sceneRepository.findById(input.job.sceneId);
    if (!scene) {
      throw new IncompleteManifestError("campaignId");
    }
    const manifestId = input.job.jobId;
    const jobId = input.job.jobId;
    const campaignId = scene.campaignId;
    const sceneId = input.job.sceneId;

    // 2. Render attempt & timestamp
    const renderAttempt = input.job.retryCount + 1;
    const provenance = input.provenance ?? input.liveProvenance;
    if (!provenance || !provenance.generatedAt) {
      throw new IncompleteManifestError("renderedAt");
    }
    const renderedAt = provenance.generatedAt;

    // 3. Engine & profile identity
    if (!input.profile.engine) {
      throw new IncompleteManifestError("engine");
    }
    if (!input.profile.id) {
      throw new IncompleteManifestError("renderProfile");
    }
    const engine = input.profile.engine;
    const renderProfile = input.profile.id;

    // 4. Model SHA-256 hashes
    if (!provenance.models || !Array.isArray(provenance.models)) {
      throw new IncompleteManifestError("models");
    }
    const models = provenance.models.map((m) => ({
      key: m.key,
      category: m.category,
      sha256: m.sha256,
      bytes: m.bytes
    }));

    // 5. Workflow template identity / hash
    if (!provenance.workflow?.sha256) {
      throw new IncompleteManifestError("workflow.sha256");
    }
    const workflowIdentity = {
      templateId: input.profile.id,
      sha256: provenance.workflow.sha256
    };

    // 6. LoRA identities and strengths
    interface LoraSpec {
      readonly name: string;
      readonly strengthModel?: number | undefined;
      readonly strengthClip?: number | undefined;
    }
    const loras: LoraSpec[] = [];

    if (input.workflow) {
      const loraNodes = [
        ...findNodesByClassType(input.workflow, "LoraLoader"),
        ...findNodesByClassType(input.workflow, "LoraLoaderModelOnly"),
        ...findNodesByClassType(input.workflow, "CR Load LoRA")
      ];
      for (const node of loraNodes) {
        const name = typeof node.inputs.lora_name === "string" ? node.inputs.lora_name : undefined;
        if (name) {
          const strengthModel =
            typeof node.inputs.strength_model === "number" ? node.inputs.strength_model : undefined;
          const strengthClip =
            typeof node.inputs.strength_clip === "number" ? node.inputs.strength_clip : undefined;
          loras.push({
            name,
            ...(strengthModel !== undefined ? { strengthModel } : {}),
            ...(strengthClip !== undefined ? { strengthClip } : {})
          });
        }
      }
    } else {
      // Fallback: filter input.profile.models by category === "loras"
      const loraModels = input.profile.models?.filter((m) => m.category === "loras") ?? [];
      for (const m of loraModels) {
        loras.push({ name: m.relativePath });
      }
    }

    // 7. Sampling parameters
    let seed: number | undefined;
    let steps: number | undefined = input.profile.baseline.steps;
    let cfg: number | undefined;
    let sampler: string | undefined;
    let scheduler: string | undefined;
    let denoise: number | undefined;

    if (input.workflow) {
      const ksamplers = [
        ...findNodesByClassType(input.workflow, "KSampler"),
        ...findNodesByClassType(input.workflow, "KSamplerAdvanced")
      ];
      if (ksamplers.length > 0) {
        const ksampler = ksamplers[0]!;
        if (typeof ksampler.inputs.seed === "number") {
          seed = ksampler.inputs.seed;
        }
        if (typeof ksampler.inputs.steps === "number") {
          steps = ksampler.inputs.steps;
        }
        if (typeof ksampler.inputs.cfg === "number") {
          cfg = ksampler.inputs.cfg;
        }
        if (typeof ksampler.inputs.sampler_name === "string") {
          sampler = ksampler.inputs.sampler_name;
        } else if (typeof ksampler.inputs.sampler === "string") {
          sampler = ksampler.inputs.sampler;
        }
        if (typeof ksampler.inputs.scheduler === "string") {
          scheduler = ksampler.inputs.scheduler;
        }
        if (typeof ksampler.inputs.denoise === "number") {
          denoise = ksampler.inputs.denoise;
        }
      }
    }

    if (seed === undefined && typeof input.job.injectedPayload?.seed === "number") {
      seed = input.job.injectedPayload.seed;
    }
    if (steps === undefined && typeof input.job.injectedPayload?.steps === "number") {
      steps = input.job.injectedPayload.steps;
    }
    if (cfg === undefined && typeof input.job.injectedPayload?.cfg === "number") {
      cfg = input.job.injectedPayload.cfg;
    }
    if (sampler === undefined && typeof input.job.injectedPayload?.sampler === "string") {
      sampler = input.job.injectedPayload.sampler;
    } else if (
      sampler === undefined &&
      typeof input.job.injectedPayload?.sampler_name === "string"
    ) {
      sampler = input.job.injectedPayload.sampler_name;
    }
    if (scheduler === undefined && typeof input.job.injectedPayload?.scheduler === "string") {
      scheduler = input.job.injectedPayload.scheduler;
    }
    if (denoise === undefined && typeof input.job.injectedPayload?.denoise === "number") {
      denoise = input.job.injectedPayload.denoise;
    }

    if (
      seed === undefined ||
      steps === undefined ||
      cfg === undefined ||
      sampler === undefined ||
      scheduler === undefined ||
      denoise === undefined
    ) {
      throw new IncompleteManifestError("sampling");
    }

    const sampling = {
      seed,
      steps,
      cfg,
      sampler,
      scheduler,
      denoise
    };

    // 8. Dimensions, frame count, FPS
    const { width, height, frames, approximateDurationSeconds } = input.profile.baseline;
    if (width === undefined || typeof width !== "number" || width <= 0) {
      throw new IncompleteManifestError("dimensions.width");
    }
    if (height === undefined || typeof height !== "number" || height <= 0) {
      throw new IncompleteManifestError("dimensions.height");
    }
    if (frames === undefined || typeof frames !== "number" || frames <= 0) {
      throw new IncompleteManifestError("frameCount");
    }
    if (
      approximateDurationSeconds === undefined ||
      typeof approximateDurationSeconds !== "number" ||
      approximateDurationSeconds <= 0
    ) {
      throw new IncompleteManifestError("fps");
    }

    const dimensions = { width, height };
    const frameCount = frames;
    const fps = frames / approximateDurationSeconds;

    // 9. Prompts & audio prompt
    let promptText: string | undefined;
    let negativePromptText: string | undefined;
    let audioPromptText: string | undefined;

    if (input.workflow) {
      const node3 = input.workflow["3"] as
        { class_type?: string; inputs?: { text?: string } } | undefined;
      const node4 = input.workflow["4"] as
        { class_type?: string; inputs?: { text?: string } } | undefined;

      if (node3?.class_type === "CLIPTextEncode" && typeof node3.inputs?.text === "string") {
        promptText = node3.inputs.text;
      }
      if (node4?.class_type === "CLIPTextEncode" && typeof node4.inputs?.text === "string") {
        negativePromptText = node4.inputs.text;
      }

      if (promptText === undefined) {
        const clipNodes = findNodesByClassType(input.workflow, "CLIPTextEncode");
        if (clipNodes.length > 0 && typeof clipNodes[0]!.inputs.text === "string") {
          promptText = clipNodes[0]!.inputs.text;
        }
        if (clipNodes.length > 1 && typeof clipNodes[1]!.inputs.text === "string") {
          negativePromptText = clipNodes[1]!.inputs.text;
        }
      }

      for (const [, node] of Object.entries(input.workflow)) {
        if (
          typeof node === "object" &&
          node !== null &&
          !Array.isArray(node) &&
          typeof (node as { inputs?: unknown }).inputs === "object" &&
          (node as { inputs?: unknown }).inputs !== null
        ) {
          const inputs = (node as { inputs: Record<string, unknown> }).inputs;
          const classType = String((node as { class_type?: unknown }).class_type ?? "");
          const title = String((node as { _meta?: { title?: unknown } })._meta?.title ?? "");
          if (classType.toLowerCase().includes("audio") || title.toLowerCase().includes("audio")) {
            if (typeof inputs.text === "string" && inputs.text.trim().length > 0) {
              audioPromptText = inputs.text.trim();
            } else if (typeof inputs.prompt === "string" && inputs.prompt.trim().length > 0) {
              audioPromptText = inputs.prompt.trim();
            } else if (
              typeof inputs.audio_prompt === "string" &&
              inputs.audio_prompt.trim().length > 0
            ) {
              audioPromptText = inputs.audio_prompt.trim();
            }
          }
        }
      }
    }

    if (promptText === undefined && typeof input.job.injectedPayload?.prompt === "string") {
      promptText = input.job.injectedPayload.prompt;
    }
    if (
      negativePromptText === undefined &&
      typeof input.job.injectedPayload?.negativePrompt === "string"
    ) {
      negativePromptText = input.job.injectedPayload.negativePrompt;
    }
    if (
      audioPromptText === undefined &&
      typeof input.job.injectedPayload?.audioPrompt === "string" &&
      input.job.injectedPayload.audioPrompt.trim().length > 0
    ) {
      audioPromptText = input.job.injectedPayload.audioPrompt.trim();
    }

    if (!promptText) {
      throw new IncompleteManifestError("prompts");
    }
    if (!audioPromptText) {
      throw new IncompleteManifestError("audioPrompt");
    }

    const prompts = {
      prompt: promptText,
      ...(negativePromptText !== undefined ? { negativePrompt: negativePromptText } : {}),
      audioPrompt: audioPromptText
    };

    // 10. Persistent ReferenceAsset identities
    const referenceAssets = await this.deps.referenceAssetRepository.listBySceneId(
      input.job.sceneId
    );
    const referenceAssetIdentities = referenceAssets.map((asset) => ({
      id: asset.id,
      assetType: asset.assetType,
      storageBucket: asset.storageBucket,
      storageObjectKey: asset.storageObjectKey,
      contentHashSha256: asset.contentHashSha256
    }));

    // 11. Approved StoryboardCandidate identity/hash
    let approvedCandidate:
      | {
          readonly id: CandidateId;
          readonly contentHash: string;
          readonly specRevision: number;
          readonly variantOrdinal: number;
        }
      | undefined;

    if (input.approvedCandidateId) {
      const candidate = await this.deps.storyboardCandidateRepository.findById(
        input.approvedCandidateId
      );
      if (!candidate) {
        throw new IncompleteManifestError("approvedCandidate");
      }
      const sceneSnapshot = scene.snapshot();
      if (candidate.sceneId !== input.job.sceneId) {
        throw new IncompleteManifestError("approvedCandidate");
      }
      if (sceneSnapshot.selectedCandidateId !== candidate.id) {
        throw new IncompleteManifestError("approvedCandidate");
      }
      if (
        candidate.specRevision !== sceneSnapshot.specRevision ||
        sceneSnapshot.selectedCandidateRevision !== candidate.specRevision ||
        sceneSnapshot.approval === undefined ||
        sceneSnapshot.approval.revision !== candidate.specRevision
      ) {
        throw new IncompleteManifestError("approvedCandidate");
      }
      approvedCandidate = {
        id: candidate.id,
        contentHash: candidate.contentHash,
        specRevision: candidate.specRevision,
        variantOrdinal: candidate.variantOrdinal
      };
    }

    // 12. ComfyUI commit / custom-node environment
    const comfyUiCommit = provenance.git?.comfyUiCommit;
    if (!comfyUiCommit || typeof comfyUiCommit !== "string" || comfyUiCommit.trim().length === 0) {
      throw new IncompleteManifestError("comfyUiCommit");
    }
    const environment = {
      comfyUiCommit,
      customNodes: provenance.git.customNodes ?? []
    };

    // 13. Runner profile & runtime metadata
    if (!input.profile.runnerProfile) {
      throw new IncompleteManifestError("runnerProfile");
    }
    const promptIdComfy = input.renderResult.promptId;
    if (!promptIdComfy || typeof promptIdComfy !== "string" || promptIdComfy.trim().length === 0) {
      throw new IncompleteManifestError("promptIdComfy");
    }
    const runnerProfile = input.profile.runnerProfile;
    const runtimeMetadata = {
      promptId: promptIdComfy,
      durationMs: input.renderResult.durationMs,
      preDispatchGpu: input.renderResult.preDispatchGpu
    };

    // 14. Governance / license / policy identity
    if (!input.profile.source?.license) {
      throw new IncompleteManifestError("governance.license");
    }
    const governance = {
      license: input.profile.source.license,
      sourceKind: input.profile.source.kind,
      ...(input.profile.source.uri ? { sourceUri: input.profile.source.uri } : {}),
      ...(input.profile.source.revision ? { sourceRevision: input.profile.source.revision } : {})
    };

    // 15. Outputs & execution duration
    if (!input.mediaObjects || input.mediaObjects.length === 0) {
      throw new IncompleteManifestError("outputs");
    }

    const outputs = [];
    for (const obj of input.mediaObjects) {
      let checksumSha256 = obj.checksumSha256;
      if (!checksumSha256 && obj.body) {
        checksumSha256 = await this.deps.hashBytes.hashBytes(obj.body);
      }
      if (!checksumSha256) {
        throw new IncompleteManifestError("outputs.checksumSha256");
      }
      outputs.push({
        bucket: obj.bucket,
        key: obj.key,
        filename: obj.key.split("/").pop() ?? obj.key,
        checksumSha256,
        ...(obj.contentType ? { contentType: obj.contentType } : {})
      });
    }

    const outputObjectKeys = input.renderResult.outputObjectKeys;
    const executionDurationMs = input.renderResult.durationMs;

    const manifestPayload: Readonly<Record<string, unknown>> = Object.freeze({
      manifestId,
      jobId,
      promptIdComfy,
      campaignId,
      sceneId,
      renderAttempt,
      renderedAt,
      engine,
      renderProfile,
      models: Object.freeze(models),
      workflow: Object.freeze(workflowIdentity),
      loras: Object.freeze(loras),
      sampling: Object.freeze(sampling),
      dimensions: Object.freeze(dimensions),
      frameCount,
      fps,
      prompts: Object.freeze(prompts),
      referenceAssets: Object.freeze(referenceAssetIdentities),
      ...(approvedCandidate !== undefined
        ? { approvedCandidate: Object.freeze(approvedCandidate) }
        : {}),
      environment: Object.freeze(environment),
      runnerProfile,
      runtimeMetadata: Object.freeze(runtimeMetadata),
      governance: Object.freeze(governance),
      outputs: Object.freeze(outputs),
      outputObjectKeys: Object.freeze([...outputObjectKeys]),
      executionDurationMs
    });

    return { manifestPayload };
  }
}
