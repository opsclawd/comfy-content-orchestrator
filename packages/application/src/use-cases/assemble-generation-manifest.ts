import { createHash } from "node:crypto";
import {
  getProfileInjectionTopology,
  LTX_FPS,
  type ManifestExecutedInstruction,
  type ManifestFrameAnchorEntry,
  type ManifestPrevisReviewEvidence,
  type ManifestReferenceImageEntry,
  type ManifestShotPlanReference,
  type ShotPlanRoutingMode
} from "@cco/contracts";
import type { CandidateId, RenderJob, SceneId } from "@cco/domain";
import type {
  HashBytesPort,
  PutObjectInput,
  ReferenceAssetRepository,
  RenderWorkflow,
  ResolvedApprovedVisualProductionMedia,
  SceneRepository,
  StoryboardCandidateRepository
} from "../ports/index.js";
import type { ExecuteProfileRenderResult } from "./execute-profile-render.js";
import { createGenerationManifestOutput } from "./generation-manifest-output.js";

export class IncompleteManifestError extends Error {
  override readonly name = "IncompleteManifestError";
  readonly missingField: string;

  constructor(missingField: string, options?: ErrorOptions) {
    super(`Cannot assemble manifest: required field "${missingField}" is unavailable`, options);
    this.missingField = missingField;
  }
}

export interface ManifestSourceProfile {
  readonly id: string;
  readonly engine: string;
  readonly runnerProfile: string;
  readonly source: {
    readonly kind: string;
    readonly license: string;
    readonly uri?: string | undefined;
    readonly revision?: string | undefined;
  };
  readonly baseline: {
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    readonly frames?: number | undefined;
    readonly fps?: number | undefined;
    readonly steps?: number | undefined;
    readonly approximateDurationSeconds?: number | undefined;
  };
  readonly models?:
    | readonly {
        readonly category: string;
        readonly relativePath: string;
      }[]
    | undefined;
  readonly renderProfileIdentity?:
    | {
        readonly key: string;
        readonly version: number;
      }
    | null
    | undefined;
}

export interface ManifestSourceProvenance {
  readonly generatedAt: string;
  readonly workflow: {
    readonly sha256: string;
  };
  readonly models?:
    | readonly {
        readonly key?: string | undefined;
        readonly category: string;
        readonly sha256: string;
        readonly bytes?: number | undefined;
      }[]
    | undefined;
  readonly git?:
    | {
        readonly comfyUiCommit?: string | undefined;
        readonly customNodes?: readonly unknown[] | undefined;
      }
    | undefined;
}

export interface AssembleManifestConditioningInput {
  readonly resolved: ResolvedApprovedVisualProductionMedia;
  readonly stagedAs: { readonly name: string; readonly subfolder: string };
  readonly injectionTarget: {
    readonly nodeId: string;
    readonly classType: string;
    readonly inputField: string;
  };
}

export interface ManifestExecutionConditioning {
  readonly candidateId: CandidateId;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly contentHashSha256: string;
  readonly media: {
    readonly bucket: string;
    readonly key: string;
    readonly sha256: string;
    readonly contentType: string;
  };
  readonly stagedAs: { readonly name: string; readonly subfolder: string };
  readonly injectionTarget: {
    readonly nodeId: string;
    readonly classType: string;
    readonly inputField: string;
  };
}

export interface AssembleManifestInput {
  readonly job: RenderJob;
  readonly profile: ManifestSourceProfile;
  readonly provenance?: ManifestSourceProvenance | undefined;
  readonly liveProvenance?: ManifestSourceProvenance | undefined;
  readonly renderResult: ExecuteProfileRenderResult;
  readonly workflow?: RenderWorkflow | undefined;
  readonly mediaObjects: readonly PutObjectInput[];
  readonly approvedCandidateId?: CandidateId | undefined;
  readonly conditioningImage?: AssembleManifestConditioningInput | undefined;
  readonly routingMode?: ShotPlanRoutingMode | undefined;
  readonly shotPlan?: ManifestShotPlanReference | undefined;
  readonly executedInstruction?: ManifestExecutedInstruction | undefined;
  readonly referenceImages?: readonly ManifestReferenceImageEntry[] | undefined;
  readonly firstFrame?: ManifestFrameAnchorEntry | undefined;
  readonly lastFrame?: ManifestFrameAnchorEntry | undefined;
  readonly previsReviewEvidence?: ManifestPrevisReviewEvidence | undefined;
  readonly submittedWorkflowHash?: string | undefined;
}

export interface AssembleManifestResult {
  readonly manifestPayload: Readonly<Record<string, unknown>>;
}

export interface AssembleGenerationManifestDeps {
  readonly hashBytes: HashBytesPort;
  readonly sceneRepository: SceneRepository;
  readonly storyboardCandidateRepository: StoryboardCandidateRepository;
  readonly referenceAssetRepository: ReferenceAssetRepository;
}

export interface AudioPromptTargetNode {
  readonly nodeId: string;
  readonly classType: string;
  readonly title?: string | undefined;
  readonly inputField: "text" | "prompt" | "audio_prompt" | "audioPrompt";
  readonly currentValue?: string | undefined;
}

export function findAudioPromptTargets(
  workflow: Readonly<Record<string, unknown>>
): AudioPromptTargetNode[] {
  const targets: AudioPromptTargetNode[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
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
      const isAudio =
        classType.toLowerCase().includes("audio") || title.toLowerCase().includes("audio");

      if (isAudio) {
        let inputField: "text" | "prompt" | "audio_prompt" | "audioPrompt" | undefined;
        if ("audio_prompt" in inputs) {
          inputField = "audio_prompt";
        } else if ("audioPrompt" in inputs) {
          inputField = "audioPrompt";
        } else if ("text" in inputs) {
          inputField = "text";
        } else if ("prompt" in inputs) {
          inputField = "prompt";
        }

        if (inputField !== undefined) {
          const rawVal = inputs[inputField];
          const currentValue = typeof rawVal === "string" ? rawVal : undefined;
          targets.push({
            nodeId,
            classType,
            title: title || undefined,
            inputField,
            currentValue
          });
        }
      }
    }
  }
  return targets;
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
    // License-routing components are matched on (componentId, versionOrRevision)
    // — see execute-profile-render.ts's own requiredComponents construction.
    // Persisting the version here (not just the profile id string) lets
    // downstream consumers (e.g. assembly's license-routing check) resolve
    // the exact component reference generation-time already verified,
    // instead of guessing a version.
    const renderProfileVersion = input.profile.renderProfileIdentity?.version ?? null;

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
      sha256: provenance.workflow.sha256,
      ...(input.submittedWorkflowHash ? { submittedWorkflowHash: input.submittedWorkflowHash } : {})
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
      if (loras.length === 0) {
        const loraModels = input.profile.models?.filter((m) => m.category === "loras") ?? [];
        for (const m of loraModels) {
          loras.push({ name: m.relativePath });
        }
      }
    } else {
      // Fallback: filter input.profile.models by category === "loras"
      const loraModels = input.profile.models?.filter((m) => m.category === "loras") ?? [];
      for (const m of loraModels) {
        loras.push({ name: m.relativePath });
      }
    }

    // 7. Sampling parameters (authoritatively derived from post-dispatch workflow)
    if (!input.workflow) {
      throw new IncompleteManifestError("sampling");
    }

    let seed: number | undefined;
    let steps: number | undefined = input.profile.baseline.steps;
    let cfg: number | undefined;
    let sampler: string | undefined;
    let scheduler: string | undefined;
    let denoise: number | undefined;

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
    } else {
      // Modular sampling nodes (SamplerCustom / SamplerCustomAdvanced, BasicScheduler, RandomNoise, KSamplerSelect, Guiders)
      const randomNoiseNodes = findNodesByClassType(input.workflow, "RandomNoise");
      if (
        randomNoiseNodes.length > 0 &&
        typeof randomNoiseNodes[0]!.inputs.noise_seed === "number"
      ) {
        seed = randomNoiseNodes[0]!.inputs.noise_seed;
      }

      const basicSchedulers = findNodesByClassType(input.workflow, "BasicScheduler");
      if (basicSchedulers.length > 0) {
        const bs = basicSchedulers[0]!;
        if (typeof bs.inputs.steps === "number") {
          steps = bs.inputs.steps;
        }
        if (typeof bs.inputs.scheduler === "string") {
          scheduler = bs.inputs.scheduler;
        }
        if (typeof bs.inputs.denoise === "number") {
          denoise = bs.inputs.denoise;
        }
      }

      const samplerSelects = findNodesByClassType(input.workflow, "KSamplerSelect");
      if (samplerSelects.length > 0 && typeof samplerSelects[0]!.inputs.sampler_name === "string") {
        sampler = samplerSelects[0]!.inputs.sampler_name;
      }

      const cfgGuiders = [
        ...findNodesByClassType(input.workflow, "CFGGuider"),
        ...findNodesByClassType(input.workflow, "DualCFGGuider")
      ];
      if (cfgGuiders.length > 0 && typeof cfgGuiders[0]!.inputs.cfg === "number") {
        cfg = cfgGuiders[0]!.inputs.cfg;
      } else if (findNodesByClassType(input.workflow, "BasicGuider").length > 0) {
        cfg = 1.0;
      }
    }

    // Fallbacks from injection payload and profile baseline if any remaining undefined
    if (
      seed === undefined &&
      typeof (input.job.injectedPayload as Record<string, unknown> | undefined)?.seed === "number"
    ) {
      seed = (input.job.injectedPayload as Record<string, unknown>).seed as number;
    }
    if (steps === undefined) {
      steps = input.profile.baseline.steps;
    }
    if (denoise === undefined) {
      denoise = 1.0;
    }
    if (cfg === undefined) {
      cfg = 1.0;
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
    const profileKey =
      input.profile.renderProfileIdentity?.key ?? input.profile.id ?? input.profile.engine;
    const topology = getProfileInjectionTopology(profileKey);

    if (input.profile.renderProfileIdentity && !topology) {
      throw new IncompleteManifestError(
        `topology (missing ProfileInjectionTopology for certified profile "${input.profile.id}" / "${input.profile.renderProfileIdentity.key}")`
      );
    }

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
    let frameCount = frames;
    let fps = frames / approximateDurationSeconds;

    if (topology?.frameCount) {
      const frameNode = input.workflow[topology.frameCount.nodeId] as
        { class_type?: string; inputs?: Record<string, unknown> } | undefined;
      if (
        frameNode?.class_type === topology.frameCount.classType &&
        typeof frameNode.inputs?.[topology.frameCount.inputField] === "number" &&
        (frameNode.inputs[topology.frameCount.inputField] as number) > 0
      ) {
        frameCount = frameNode.inputs[topology.frameCount.inputField] as number;
        fps = LTX_FPS;
      } else {
        throw new IncompleteManifestError("frameCount");
      }
    }

    let promptText: string | undefined;
    let negativePromptText: string | undefined;
    let audioPromptText: string | null = null;

    if (topology) {
      const promptNode = input.workflow[topology.prompt.nodeId] as
        { class_type?: string; inputs?: Record<string, unknown> } | undefined;
      if (
        promptNode?.class_type === topology.prompt.classType &&
        typeof promptNode.inputs?.[topology.prompt.inputField] === "string"
      ) {
        promptText = promptNode.inputs[topology.prompt.inputField] as string;
      }

      if (topology.negativePrompt) {
        const negNode = input.workflow[topology.negativePrompt.nodeId] as
          { class_type?: string; inputs?: Record<string, unknown> } | undefined;
        if (
          negNode?.class_type === topology.negativePrompt.classType &&
          typeof negNode.inputs?.[topology.negativePrompt.inputField] === "string"
        ) {
          negativePromptText = negNode.inputs[topology.negativePrompt.inputField] as string;
        }
      }

      if (topology.audioPrompt) {
        const audioNode = input.workflow[topology.audioPrompt.nodeId] as
          { class_type?: string; inputs?: Record<string, unknown> } | undefined;
        if (
          audioNode?.class_type === topology.audioPrompt.classType &&
          typeof audioNode.inputs?.[topology.audioPrompt.inputField] === "string"
        ) {
          audioPromptText =
            (audioNode.inputs[topology.audioPrompt.inputField] as string).trim() || null;
        }
      } else {
        audioPromptText = null;
      }
    } else {
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

      const audioTargets = findAudioPromptTargets(input.workflow);
      if (audioTargets.length > 1) {
        throw new IncompleteManifestError(
          `audioPrompt (ambiguous audio prompt target nodes in workflow: [${audioTargets.map((t) => t.nodeId).join(", ")}])`
        );
      }
      if (
        audioTargets.length === 1 &&
        audioTargets[0]?.currentValue &&
        audioTargets[0].currentValue.trim().length > 0
      ) {
        audioPromptText = audioTargets[0].currentValue.trim();
      } else {
        audioPromptText = null;
      }
    }

    if (!promptText || promptText.trim().length === 0) {
      throw new IncompleteManifestError("prompts");
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

    // 11. Approved StoryboardCandidate identity/hash & execution conditioning
    let approvedCandidate:
      | {
          readonly id: CandidateId;
          readonly contentHash: string;
          readonly specRevision: number;
          readonly variantOrdinal: number;
        }
      | undefined;
    let executionConditioning: ManifestExecutionConditioning | undefined;

    if (input.routingMode === "reference_directed") {
      // In reference_directed mode, candidate stills NEVER enter execution conditioning
      // (False Conditioning Invariant).
      if (input.conditioningImage) {
        throw new IncompleteManifestError(
          "executionConditioning (False Conditioning Invariant: candidate conditioningImage is forbidden in reference_directed mode)"
        );
      }
      if (!input.shotPlan) {
        throw new IncompleteManifestError("shotPlan");
      }
      if (!input.executedInstruction) {
        throw new IncompleteManifestError("executedInstruction");
      }
      if (input.executedInstruction.text !== prompts.prompt) {
        throw new IncompleteManifestError(
          `executedInstruction.text (submitted workflow prompt does not match executedInstruction)`
        );
      }
      const expectedInstructionSha256 = createHash("sha256")
        .update(Buffer.from(input.executedInstruction.text, "utf8"))
        .digest("hex");
      if (input.executedInstruction.sha256 !== expectedInstructionSha256) {
        throw new IncompleteManifestError(
          `executedInstruction.sha256 (expected "${expectedInstructionSha256}", got "${input.executedInstruction.sha256}")`
        );
      }
      const expectedInstructionBytes = Buffer.byteLength(input.executedInstruction.text, "utf8");
      if (input.executedInstruction.byteLength !== expectedInstructionBytes) {
        throw new IncompleteManifestError(
          `executedInstruction.byteLength (expected ${expectedInstructionBytes}, got ${input.executedInstruction.byteLength})`
        );
      }
      if (input.referenceImages && input.referenceImages.length > 0) {
        for (const entry of input.referenceImages) {
          const injectedNode = input.workflow?.[entry.injectionTarget.nodeId] as
            { class_type?: string; inputs?: Record<string, unknown> } | undefined;
          if (!injectedNode || injectedNode.class_type !== entry.injectionTarget.classType) {
            throw new IncompleteManifestError(
              `referenceImages.injectionTarget (node "${entry.injectionTarget.nodeId}" with class "${entry.injectionTarget.classType}" missing from workflow)`
            );
          }
          const expectedStagedValue = entry.stagedAs.subfolder
            ? `${entry.stagedAs.subfolder}/${entry.stagedAs.name}`
            : entry.stagedAs.name;
          const actualInjectedValue = injectedNode.inputs?.[entry.injectionTarget.inputField];
          if (actualInjectedValue !== expectedStagedValue) {
            throw new IncompleteManifestError(
              `referenceImages.injectionTarget (expected staged image "${expectedStagedValue}" at input "${entry.injectionTarget.inputField}", got "${actualInjectedValue}")`
            );
          }
        }
      }
      if (topology?.referenceImages) {
        const activeNodeIds = new Set(
          (input.referenceImages ?? []).map((e) => e.injectionTarget.nodeId)
        );
        for (const target of topology.referenceImages) {
          if (!activeNodeIds.has(target.nodeId) && input.workflow?.[target.nodeId]) {
            throw new IncompleteManifestError(
              `referenceImages (unused topology node "${target.nodeId}" still present in submitted workflow)`
            );
          }
        }
      }
      if (topology?.referenceNode) {
        const refNode = input.workflow?.[topology.referenceNode.nodeId] as
          { class_type?: string; inputs?: Record<string, unknown> } | undefined;
        if (!refNode || refNode.class_type !== topology.referenceNode.classType) {
          throw new IncompleteManifestError(
            `referenceNode (node "${topology.referenceNode.nodeId}" with class "${topology.referenceNode.classType}" missing from workflow)`
          );
        }
        const activeSlots = new Set((input.referenceImages ?? []).map((e) => e.slotIndex));
        for (const entry of input.referenceImages ?? []) {
          const expectedLink = [entry.injectionTarget.nodeId, 0];
          const actualLink = refNode.inputs?.[`ref_image_${entry.slotIndex}`];
          if (
            !Array.isArray(actualLink) ||
            actualLink[0] !== expectedLink[0] ||
            actualLink[1] !== expectedLink[1]
          ) {
            throw new IncompleteManifestError(
              `referenceNode.inputs.ref_image_${entry.slotIndex} (expected connection to ["${entry.injectionTarget.nodeId}", 0], got ${JSON.stringify(actualLink)})`
            );
          }
        }
        for (let s = 1; s <= 9; s++) {
          if (!activeSlots.has(s) && refNode.inputs?.[`ref_image_${s}`] !== undefined) {
            throw new IncompleteManifestError(
              `referenceNode.inputs.ref_image_${s} (inactive slot ${s} must not be connected on node "${topology.referenceNode.nodeId}")`
            );
          }
        }
      }
    } else if (input.routingMode === "frame_anchored") {
      if (!input.firstFrame) {
        throw new IncompleteManifestError("firstFrame");
      }
      const injectedNode = input.workflow?.[input.firstFrame.injectionTarget.nodeId] as
        { class_type?: string; inputs?: Record<string, unknown> } | undefined;
      if (!injectedNode || injectedNode.class_type !== input.firstFrame.injectionTarget.classType) {
        throw new IncompleteManifestError(
          `firstFrame.injectionTarget (node "${input.firstFrame.injectionTarget.nodeId}" with class "${input.firstFrame.injectionTarget.classType}" missing from workflow)`
        );
      }
      const expectedStagedValue = input.firstFrame.stagedAs.subfolder
        ? `${input.firstFrame.stagedAs.subfolder}/${input.firstFrame.stagedAs.name}`
        : input.firstFrame.stagedAs.name;
      const actualInjectedValue =
        injectedNode.inputs?.[input.firstFrame.injectionTarget.inputField];
      if (actualInjectedValue !== expectedStagedValue) {
        throw new IncompleteManifestError(
          `firstFrame.injectionTarget (expected staged image "${expectedStagedValue}" at input "${input.firstFrame.injectionTarget.inputField}", got "${actualInjectedValue}")`
        );
      }
      if (input.lastFrame) {
        const lastNode = input.workflow?.[input.lastFrame.injectionTarget.nodeId] as
          { class_type?: string; inputs?: Record<string, unknown> } | undefined;
        if (!lastNode || lastNode.class_type !== input.lastFrame.injectionTarget.classType) {
          throw new IncompleteManifestError(
            `lastFrame.injectionTarget (node "${input.lastFrame.injectionTarget.nodeId}" with class "${input.lastFrame.injectionTarget.classType}" missing from workflow)`
          );
        }
        const expectedLastStaged = input.lastFrame.stagedAs.subfolder
          ? `${input.lastFrame.stagedAs.subfolder}/${input.lastFrame.stagedAs.name}`
          : input.lastFrame.stagedAs.name;
        const actualLastInjected = lastNode.inputs?.[input.lastFrame.injectionTarget.inputField];
        if (actualLastInjected !== expectedLastStaged) {
          throw new IncompleteManifestError(
            `lastFrame.injectionTarget (expected staged image "${expectedLastStaged}" at input "${input.lastFrame.injectionTarget.inputField}", got "${actualLastInjected}")`
          );
        }
      }
      if (input.conditioningImage) {
        const { resolved, stagedAs, injectionTarget } = input.conditioningImage;
        approvedCandidate = {
          id: resolved.input.candidateId,
          contentHash: resolved.media.sha256,
          specRevision: resolved.input.specRevision,
          variantOrdinal: resolved.input.variantOrdinal
        };
        executionConditioning = {
          candidateId: resolved.input.candidateId,
          sceneId: resolved.input.sceneId,
          specRevision: resolved.input.specRevision,
          contentHashSha256: resolved.media.sha256,
          media: {
            bucket: resolved.media.bucket,
            key: resolved.media.key,
            sha256: resolved.media.sha256,
            contentType: resolved.media.contentType
          },
          stagedAs: { name: stagedAs.name, subfolder: stagedAs.subfolder },
          injectionTarget: {
            nodeId: injectionTarget.nodeId,
            classType: injectionTarget.classType,
            inputField: injectionTarget.inputField
          }
        };
      }
    } else if (input.conditioningImage) {
      const { resolved, stagedAs, injectionTarget } = input.conditioningImage;

      // 1. Scene identity
      if (resolved.input.sceneId !== input.job.sceneId) {
        throw new IncompleteManifestError("executionConditioning.sceneId");
      }

      // 2. Candidate identity vs. the explicit assembler input parameter, when supplied.
      if (
        input.approvedCandidateId !== undefined &&
        resolved.input.candidateId !== input.approvedCandidateId
      ) {
        throw new IncompleteManifestError("executionConditioning.candidateId");
      }

      // 3. Candidate identity vs. the job's own declared payload field (job.injectedPayload is
      // Readonly<Record<string, unknown>>; guard the type since it is not validated at this layer).
      const jobDeclaredCandidateId = input.job.injectedPayload["approvedCandidateId"];
      if (
        typeof jobDeclaredCandidateId === "string" &&
        jobDeclaredCandidateId !== resolved.input.candidateId
      ) {
        throw new IncompleteManifestError("executionConditioning.candidateId");
      }

      // 4. Revision cross-check against the scene already loaded in step 1 (no new repository
      // call -- `scene` is fetched unconditionally for every job). This is a fail-closed gate,
      // not a value source: approvedCandidate/executionConditioning below still read
      // resolved.input.specRevision, never scene.snapshot().specRevision.
      if (resolved.input.specRevision !== scene.snapshot().specRevision) {
        throw new IncompleteManifestError("executionConditioning.specRevision");
      }

      // 5. Positive-integer sanity check on the carried revision itself.
      if (!Number.isInteger(resolved.input.specRevision) || resolved.input.specRevision <= 0) {
        throw new IncompleteManifestError("executionConditioning.specRevision");
      }

      // 6. Verified-hash vs. DB-recorded-hash self-consistency (belt-and-suspenders; #225 already
      // enforces this before staging).
      if (resolved.media.sha256 !== resolved.input.contentHashSha256) {
        throw new IncompleteManifestError("executionConditioning.contentHash");
      }

      // 7. Injection-target cross-check against the executed workflow snapshot.
      const injectedNode = input.workflow?.[injectionTarget.nodeId] as
        { class_type?: string; inputs?: Record<string, unknown> } | undefined;
      if (
        !injectedNode ||
        injectedNode.class_type !== injectionTarget.classType ||
        typeof injectedNode.inputs?.[injectionTarget.inputField] !== "string"
      ) {
        throw new IncompleteManifestError("executionConditioning.injectionTarget");
      }
      const injectedValue = injectedNode.inputs[injectionTarget.inputField] as string;
      const expectedStagedValue = stagedAs.subfolder
        ? `${stagedAs.subfolder}/${stagedAs.name}`
        : stagedAs.name;
      if (injectedValue !== expectedStagedValue) {
        throw new IncompleteManifestError("executionConditioning.injectionTarget");
      }

      approvedCandidate = {
        id: resolved.input.candidateId,
        contentHash: resolved.media.sha256,
        specRevision: resolved.input.specRevision,
        variantOrdinal: resolved.input.variantOrdinal
      };

      executionConditioning = {
        candidateId: resolved.input.candidateId,
        sceneId: resolved.input.sceneId,
        specRevision: resolved.input.specRevision,
        contentHashSha256: resolved.media.sha256,
        media: {
          bucket: resolved.media.bucket,
          key: resolved.media.key,
          sha256: resolved.media.sha256,
          contentType: resolved.media.contentType
        },
        stagedAs: { name: stagedAs.name, subfolder: stagedAs.subfolder },
        injectionTarget: {
          nodeId: injectionTarget.nodeId,
          classType: injectionTarget.classType,
          inputField: injectionTarget.inputField
        }
      };
    } else if (input.approvedCandidateId) {
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

    // 15. Outputs & execution duration (computed in parallel)
    if (!input.mediaObjects || input.mediaObjects.length === 0) {
      throw new IncompleteManifestError("outputs");
    }

    const outputs = await Promise.all(
      input.mediaObjects.map(async (obj) => {
        let checksumSha256 = obj.checksumSha256;
        if (!checksumSha256 && obj.body) {
          checksumSha256 = await this.deps.hashBytes.hashBytes(obj.body);
        }
        if (!checksumSha256) {
          throw new IncompleteManifestError("outputs.checksumSha256");
        }
        return createGenerationManifestOutput({
          bucket: obj.bucket,
          key: obj.key,
          filename: obj.key.split("/").pop() ?? obj.key,
          checksumSha256,
          ...(obj.contentType ? { contentType: obj.contentType } : {})
        });
      })
    );

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
      renderProfileVersion,
      models: Object.freeze(models),
      workflow: Object.freeze(workflowIdentity),
      loras: Object.freeze(loras),
      sampling: Object.freeze(sampling),
      dimensions: Object.freeze(dimensions),
      frameCount,
      fps,
      prompts: Object.freeze(prompts),
      referenceAssets: Object.freeze(referenceAssetIdentities),
      ...(input.routingMode !== undefined ? { routingMode: input.routingMode } : {}),
      ...(input.shotPlan !== undefined ? { shotPlan: Object.freeze(input.shotPlan) } : {}),
      ...(input.executedInstruction !== undefined
        ? { executedInstruction: Object.freeze(input.executedInstruction) }
        : {}),
      ...(input.referenceImages !== undefined
        ? {
            referenceImages: Object.freeze(
              input.referenceImages.map((entry) =>
                Object.freeze({
                  ...entry,
                  stagedAs: Object.freeze({ ...entry.stagedAs }),
                  injectionTarget: Object.freeze({ ...entry.injectionTarget })
                })
              )
            )
          }
        : input.routingMode === "reference_directed"
          ? { referenceImages: Object.freeze([]) }
          : {}),
      ...(input.firstFrame !== undefined
        ? {
            firstFrame: Object.freeze({
              ...input.firstFrame,
              stagedAs: Object.freeze({ ...input.firstFrame.stagedAs }),
              injectionTarget: Object.freeze({ ...input.firstFrame.injectionTarget })
            })
          }
        : {}),
      ...(input.lastFrame !== undefined
        ? {
            lastFrame: Object.freeze({
              ...input.lastFrame,
              stagedAs: Object.freeze({ ...input.lastFrame.stagedAs }),
              injectionTarget: Object.freeze({ ...input.lastFrame.injectionTarget })
            })
          }
        : {}),
      ...(input.previsReviewEvidence !== undefined
        ? { previsReviewEvidence: Object.freeze(input.previsReviewEvidence) }
        : {}),
      ...(approvedCandidate !== undefined
        ? { approvedCandidate: Object.freeze(approvedCandidate) }
        : {}),
      ...(executionConditioning !== undefined
        ? {
            executionConditioning: Object.freeze({
              ...executionConditioning,
              media: Object.freeze(executionConditioning.media),
              stagedAs: Object.freeze(executionConditioning.stagedAs),
              injectionTarget: Object.freeze(executionConditioning.injectionTarget)
            })
          }
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
