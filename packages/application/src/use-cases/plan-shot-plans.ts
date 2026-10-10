import { randomUUID } from "node:crypto";
import {
  Scene,
  ShotPlan,
  type ReferenceAsset,
  type ReferenceAssetId,
  type SceneId,
  type SceneReferenceBinding,
  type SceneStatus,
  type ShotPlanId
} from "@cco/domain";
import {
  MAX_PLANNING_IMAGES,
  type PlanningModelClientPort,
  type PlanningModelImage,
  type PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { CANDIDATE_BASE_SEED } from "./progress-scene-production.js";
import {
  compileStoryboardPrevisPrompt,
  STORYBOARD_PREVIS_WORKFLOW_TEMPLATE
} from "../shot-plan-compiler/index.js";
import { canonicalizeReferenceBindings } from "../shot-plan-compiler/canonicalize-reference-bindings.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import {
  decodePlanningAuthorizationPolicy,
  PlanningOrchestrationKernel,
  type PlanningAuthorizationPolicy,
  type PlanningWorkflowPrepared
} from "./planning-orchestration-kernel.js";
import { buildShotPlanPrompt, type BoundReferencePromptInput } from "./shot-plan-prompt.js";
import { parseShotPlanResponse, type ShotPlanProposal } from "./shot-plan-response-parser.js";
import { stripReasoningBlock } from "./strip-reasoning-block.js";
import {
  InvalidShotPlanVariantCountError,
  ReferenceAssetDescriptionGenerationError,
  PlannerReferenceImageAcquisitionError,
  ShotPlanValidationError,
  CampaignReferenceBibleRoleConflictError,
  InvalidPersistentSubjectIdError,
  StaleBibleBindingMismatchError
} from "./plan-shot-plans-errors.js";
import type {
  CampaignReferenceBibleEntry,
  CampaignReferenceBibleEntryInput,
  CampaignReferenceBibleRole
} from "../ports/campaign-reference-bible-repository.js";
import { PlanningNotAuthorizedError } from "./plan-scene-configuration-errors.js";
import { DEFAULT_EXTERNAL_PROCESSING_POLICY } from "./create-client.js";

export const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB

const SUPPORTED_PLANNER_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function resolveAndValidatePlannerImageMime(
  referenceAssetId: string,
  assetMime?: string | undefined,
  storageContentType?: string | undefined
): string {
  const normalize = (mime?: string): string | undefined => {
    if (!mime) return undefined;
    const base = mime.split(";")[0]?.trim().toLowerCase();
    return base && base.length > 0 ? base : undefined;
  };

  const normalizedAssetMime = normalize(assetMime);
  const normalizedStorageMime = normalize(storageContentType);

  if (normalizedStorageMime !== undefined) {
    if (!SUPPORTED_PLANNER_IMAGE_MIMES.has(normalizedStorageMime)) {
      throw new PlannerReferenceImageAcquisitionError(
        referenceAssetId,
        `Storage object has unsupported or generic contentType '${normalizedStorageMime}'. Supported types: image/png, image/jpeg, image/webp.`,
        "INVALID_MIME_TYPE"
      );
    }
  }

  const chosenMime = normalizedStorageMime ?? normalizedAssetMime;

  if (!chosenMime || !SUPPORTED_PLANNER_IMAGE_MIMES.has(chosenMime)) {
    const detail = chosenMime ?? "missing";
    throw new PlannerReferenceImageAcquisitionError(
      referenceAssetId,
      `Unsupported, generic, or missing MIME type '${detail}'. Supported types: image/png, image/jpeg, image/webp.`,
      "INVALID_MIME_TYPE"
    );
  }

  return chosenMime;
}

export interface PlanShotPlansDeps {
  readonly uow: UnitOfWork;
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
  readonly imageDescriptionClient?: PlanningModelClientPort | undefined;
  readonly overallTimeoutMs?: number | undefined;
  readonly kernel?: PlanningOrchestrationKernel | undefined;
  readonly objectStorage?: ObjectStoragePort | undefined;
}

export interface PlanShotPlansInput {
  readonly sceneId: SceneId | string;
  readonly variantCount?: number | undefined;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
  readonly overallTimeoutMs?: number | undefined;
  readonly enqueuePrevisJobs?: boolean | undefined;
  readonly reroll?: boolean | undefined;
}

export interface PlanShotPlansResult {
  readonly shotPlans: readonly ShotPlan[];
  readonly isIdempotentReplay: boolean;
}

export type PlanShotPlansAdmissionResult =
  | {
      readonly kind: "replay";
      readonly sceneId: SceneId | string;
      readonly status: SceneStatus;
      readonly specRevision: number;
      readonly shotPlans: readonly ShotPlan[];
    }
  | {
      readonly kind: "admitted";
      readonly sceneId: SceneId | string;
      readonly status: SceneStatus;
      readonly specRevision: number;
      readonly variantCount: number;
      readonly runId: string;
      readonly isDuplicate: boolean;
      readonly input: PlanShotPlansInput & { readonly variantCount: number };
    };

interface PreparePlanningWorkflowParams {
  readonly scene: Scene;
  readonly policy: PlanningAuthorizationPolicy;
  readonly activeBindings: readonly SceneReferenceBinding[];
  readonly campaignBibleEntries: readonly CampaignReferenceBibleEntry[];
  readonly allCampaignBindings: readonly SceneReferenceBinding[];
  readonly assetsMap: Map<string, ReferenceAsset>;
  readonly descriptionsByHash: Map<string, string>;
  readonly newlyGeneratedDescriptions?: Map<string, string> | undefined;
  readonly refRepo?:
    | (ReferenceAssetRepository & {
        readonly findDescriptionByContentHash?: (
          contentHashSha256: string
        ) => Promise<string | undefined>;
        readonly updateDescriptionByContentHash?: (
          contentHashSha256: string,
          description: string
        ) => Promise<void>;
        readonly withLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
      })
    | undefined;
  readonly bibleInitializer?:
    | ((
        entries: CampaignReferenceBibleEntryInput[]
      ) => Promise<readonly CampaignReferenceBibleEntry[]>)
    | undefined;
  readonly hasCampaignBibleRepo: boolean;
  readonly variantCount: number;
  readonly signal: AbortSignal;
}

export class PlanShotPlansUseCase {
  private readonly kernel: PlanningOrchestrationKernel;

  constructor(private readonly deps: PlanShotPlansDeps) {
    this.kernel =
      deps.kernel ??
      new PlanningOrchestrationKernel({
        primaryClient: deps.primaryClient,
        fallbackClient: deps.fallbackClient,
        ...(deps.overallTimeoutMs !== undefined ? { overallTimeoutMs: deps.overallTimeoutMs } : {})
      });
  }

  private resolveImageDescriptionClient(
    policy: PlanningAuthorizationPolicy,
    referenceAssetId: string
  ): PlanningModelClientPort {
    const candidates: PlanningModelClientPort[] = [];
    if (this.deps.imageDescriptionClient) {
      candidates.push(this.deps.imageDescriptionClient);
    }
    if (
      this.deps.primaryClient.imageCapability === true ||
      this.deps.primaryClient.supportsImages === true
    ) {
      candidates.push(this.deps.primaryClient);
    }
    if (
      this.deps.fallbackClient.imageCapability === true ||
      this.deps.fallbackClient.supportsImages === true
    ) {
      candidates.push(this.deps.fallbackClient);
    }

    if (candidates.length === 0) {
      throw new ReferenceAssetDescriptionGenerationError(
        referenceAssetId,
        `No image-capable planning client is configured for reference asset "${referenceAssetId}".`
      );
    }

    const authorized = candidates.find((c) => policy.allowedProviders.has(c.providerName));
    if (!authorized) {
      const providers = candidates.map((c) => c.providerName).join(", ");
      throw new PlanningNotAuthorizedError(
        `No image-capable planning client (${providers}) is authorized in allowedProviders`
      );
    }

    return authorized;
  }

  private async ensureAssetDescription(
    asset: ReferenceAsset,
    role: string,
    descriptionsByHash: Map<string, string>,
    refRepo:
      | (ReferenceAssetRepository & {
          readonly findDescriptionByContentHash?: (
            contentHashSha256: string
          ) => Promise<string | undefined>;
          readonly updateDescriptionByContentHash?: (
            contentHashSha256: string,
            description: string
          ) => Promise<void>;
          readonly withLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
        })
      | undefined,
    policy: PlanningAuthorizationPolicy,
    signal: AbortSignal,
    newlyGeneratedDescriptions?: Map<string, string>
  ): Promise<string> {
    if (!newlyGeneratedDescriptions) {
      if (
        !refRepo ||
        typeof refRepo.findDescriptionByContentHash !== "function" ||
        typeof refRepo.updateDescriptionByContentHash !== "function" ||
        typeof refRepo.withLock !== "function"
      ) {
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          "ReferenceAsset repository lacks required description caching or locking operations (findDescriptionByContentHash, updateDescriptionByContentHash, withLock)."
        );
      }
    }

    const hash = asset.contentHashSha256;
    if (descriptionsByHash.has(hash)) {
      return descriptionsByHash.get(hash)!;
    }

    if (asset.description && asset.description.trim().length > 0) {
      const trimmed = asset.description.trim();
      descriptionsByHash.set(hash, trimmed);
      return trimmed;
    }

    if (refRepo?.findDescriptionByContentHash) {
      const cached = await refRepo.findDescriptionByContentHash(hash);
      if (cached && cached.trim().length > 0) {
        const trimmed = cached.trim();
        descriptionsByHash.set(hash, trimmed);
        return trimmed;
      }
    }

    const generateAndStore = async (): Promise<string> => {
      if (descriptionsByHash.has(hash)) {
        return descriptionsByHash.get(hash)!;
      }

      if (refRepo?.findDescriptionByContentHash) {
        const rechecked = await refRepo.findDescriptionByContentHash(hash);
        if (rechecked && rechecked.trim().length > 0) {
          const trimmed = rechecked.trim();
          descriptionsByHash.set(hash, trimmed);
          return trimmed;
        }
      }

      if (signal.aborted) {
        throw signal.reason ?? new Error("Planning deadline exceeded");
      }

      const imageClient = this.resolveImageDescriptionClient(policy, asset.id);

      if (!this.deps.objectStorage) {
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          "ObjectStoragePort is required to retrieve reference asset image for description generation."
        );
      }

      let objResult;
      try {
        objResult = await this.deps.objectStorage.getObject(
          { bucket: asset.storageBucket, key: asset.storageObjectKey },
          { signal, maxBytes: MAX_REFERENCE_IMAGE_BYTES }
        );
      } catch (err) {
        if (signal.aborted) {
          throw signal.reason ?? err;
        }
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Failed to retrieve storage object for reference asset "${asset.id}": ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err }
        );
      }

      if (signal.aborted) {
        throw signal.reason ?? new Error("Planning deadline exceeded");
      }

      if (!objResult || !objResult.body || objResult.body.length === 0) {
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Storage object for reference asset "${asset.id}" is empty or not found.`
        );
      }

      if (objResult.body.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Storage object for reference asset "${asset.id}" exceeds max image size limit (${MAX_REFERENCE_IMAGE_BYTES} bytes).`
        );
      }

      const mimeType = resolveAndValidatePlannerImageMime(
        asset.id,
        asset.mimeType,
        objResult.contentType
      );

      const base64Data = Buffer.from(objResult.body).toString("base64");
      const outcome = await imageClient.complete({
        systemPrompt:
          "You are a specialized visual analysis assistant for video production. Describe the provided reference image concisely and objectively, focusing on visual details, appearance, and physical characteristics relevant to video generation. Return only the description text with no conversational preamble or markdown formatting.",
        userPrompt: `Provide a concise, objective visual description of this reference image (role: ${role}).`,
        images: [{ mimeType, base64Data }],
        bindingCount: 1,
        maxImages: 1,
        signal
      });

      if (signal.aborted) {
        throw signal.reason ?? new Error("Planning deadline exceeded");
      }

      if (outcome.kind !== "success") {
        const failureReason =
          outcome.kind === "retryable_failure" || outcome.kind === "permanent_failure"
            ? outcome.message
            : outcome.kind === "safety_refusal"
              ? "safety refusal"
              : "unknown failure";
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Description generation failed for reference asset "${asset.id}": ${failureReason}`
        );
      }

      const generatedDesc = stripReasoningBlock(outcome.rawText);
      if (generatedDesc.length === 0) {
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Generated description for reference asset "${asset.id}" was blank.`
        );
      }

      if (newlyGeneratedDescriptions) {
        newlyGeneratedDescriptions.set(hash, generatedDesc);
      } else if (refRepo?.updateDescriptionByContentHash) {
        await refRepo.updateDescriptionByContentHash(hash, generatedDesc);
      }

      descriptionsByHash.set(hash, generatedDesc);
      return generatedDesc;
    };

    if (refRepo?.withLock && !newlyGeneratedDescriptions) {
      return await refRepo.withLock(hash, generateAndStore);
    }

    return await generateAndStore();
  }

  private async preparePlanningWorkflow(
    params: PreparePlanningWorkflowParams
  ): Promise<PlanningWorkflowPrepared<readonly ShotPlanProposal[]>> {
    const {
      scene,
      policy,
      activeBindings,
      allCampaignBindings,
      assetsMap,
      descriptionsByHash,
      newlyGeneratedDescriptions,
      refRepo,
      bibleInitializer,
      hasCampaignBibleRepo,
      variantCount,
      signal
    } = params;

    let campaignBibleEntries = params.campaignBibleEntries;

    if (hasCampaignBibleRepo) {
      if (campaignBibleEntries.length > 0) {
        for (const b of activeBindings) {
          if (b.role === "subject_identity" || b.role === "location") {
            const matched = campaignBibleEntries.find(
              (e) => e.referenceAssetId.toLowerCase() === b.referenceAssetId.toLowerCase()
            );
            if (!matched) {
              throw new StaleBibleBindingMismatchError(
                scene.id,
                b.referenceAssetId,
                `Asset "${b.referenceAssetId}" is bound to scene "${scene.id}" with role "${b.role}" but does not exist in campaign bible.`
              );
            }
            if (matched.role !== b.role) {
              throw new StaleBibleBindingMismatchError(
                scene.id,
                b.referenceAssetId,
                `Asset "${b.referenceAssetId}" is bound with role "${b.role}" in scene "${scene.id}", but campaign bible has role "${matched.role}".`
              );
            }
          }
        }
      } else if (bibleInitializer) {
        const allBindings = allCampaignBindings.length > 0 ? allCampaignBindings : activeBindings;
        const rolesByAssetId = new Map<string, Set<CampaignReferenceBibleRole>>();
        for (const b of allBindings) {
          if (b.role === "subject_identity" || b.role === "location") {
            const lower = b.referenceAssetId.toLowerCase();
            const set = rolesByAssetId.get(lower) ?? new Set<CampaignReferenceBibleRole>();
            set.add(b.role);
            rolesByAssetId.set(lower, set);
          }
        }

        for (const [lower, roles] of rolesByAssetId.entries()) {
          if (roles.size > 1) {
            throw new CampaignReferenceBibleRoleConflictError(
              rolesByAssetId.get(lower)
                ? (Array.from(allBindings).find((b) => b.referenceAssetId.toLowerCase() === lower)
                    ?.referenceAssetId ?? lower)
                : lower,
              Array.from(roles)
            );
          }
        }

        const eligibleAssetIds = Array.from(rolesByAssetId.keys());
        if (eligibleAssetIds.length > 0) {
          for (const id of eligibleAssetIds) {
            if (!assetsMap.has(id.toLowerCase())) {
              throw new ReferenceAssetDescriptionGenerationError(
                id,
                `Reference asset "${id}" could not be resolved for campaign "${scene.campaignId}".`
              );
            }
          }

          for (const id of eligibleAssetIds) {
            const asset = assetsMap.get(id.toLowerCase())!;
            const role = Array.from(rolesByAssetId.get(id.toLowerCase())!)[0]!;
            const desc = await this.ensureAssetDescription(
              asset,
              role,
              descriptionsByHash,
              refRepo,
              policy,
              signal,
              newlyGeneratedDescriptions
            );
            descriptionsByHash.set(asset.contentHashSha256, desc);
          }

          const sortedAssets = eligibleAssetIds
            .map((id) => assetsMap.get(id.toLowerCase())!)
            .sort((a, b) => {
              const roleA = Array.from(rolesByAssetId.get(a.id.toLowerCase())!)[0]!;
              const roleB = Array.from(rolesByAssetId.get(b.id.toLowerCase())!)[0]!;
              const priorityA = roleA === "subject_identity" ? 0 : 1;
              const priorityB = roleB === "subject_identity" ? 0 : 1;
              if (priorityA !== priorityB) return priorityA - priorityB;
              const idA = a.id.toLowerCase();
              const idB = b.id.toLowerCase();
              if (idA < idB) return -1;
              if (idA > idB) return 1;
              if (a.id < b.id) return -1;
              if (a.id > b.id) return 1;
              return 0;
            });

          const snapshotEntries: CampaignReferenceBibleEntryInput[] = sortedAssets.map(
            (asset, index) => {
              const role = Array.from(rolesByAssetId.get(asset.id.toLowerCase())!)[0]!;
              const desc =
                descriptionsByHash.get(asset.contentHashSha256) ?? asset.description ?? "";
              if (!desc || desc.trim().length === 0) {
                throw new ReferenceAssetDescriptionGenerationError(
                  asset.id,
                  `No description available for reference asset "${asset.id}".`
                );
              }
              return {
                referenceAssetId: asset.id,
                role,
                description: desc.trim(),
                biblePromptTag: `<Picture ${index + 1}>`,
                sourceContentHashSha256: asset.contentHashSha256
              };
            }
          );

          campaignBibleEntries = await bibleInitializer(snapshotEntries);

          for (const b of activeBindings) {
            if (b.role === "subject_identity" || b.role === "location") {
              const matched = campaignBibleEntries.find(
                (e) => e.referenceAssetId.toLowerCase() === b.referenceAssetId.toLowerCase()
              );
              if (!matched) {
                throw new StaleBibleBindingMismatchError(
                  scene.id,
                  b.referenceAssetId,
                  `Asset "${b.referenceAssetId}" is bound to scene "${scene.id}" with role "${b.role}" but does not exist in campaign bible.`
                );
              }
              if (matched.role !== b.role) {
                throw new StaleBibleBindingMismatchError(
                  scene.id,
                  b.referenceAssetId,
                  `Asset "${b.referenceAssetId}" is bound with role "${b.role}" in scene "${scene.id}", but campaign bible has role "${matched.role}".`
                );
              }
            }
          }
        }
      }
    }

    let boundReferences: BoundReferencePromptInput[] | undefined;
    let plannerImages: readonly PlanningModelImage[] | undefined;
    let bindingCount: number | undefined;
    let maxImages: number | undefined;

    if (activeBindings.length > 0) {
      if (signal.aborted) {
        throw signal.reason ?? new Error("Planning deadline exceeded");
      }

      for (const b of activeBindings) {
        const asset = assetsMap.get(b.referenceAssetId.toLowerCase());
        if (!asset) {
          throw new ReferenceAssetDescriptionGenerationError(
            b.referenceAssetId,
            `Reference asset "${b.referenceAssetId}" could not be resolved for scene "${scene.id}".`
          );
        }
        const bibleEntry = campaignBibleEntries.find(
          (e) => e.referenceAssetId.toLowerCase() === b.referenceAssetId.toLowerCase()
        );
        if (bibleEntry) {
          descriptionsByHash.set(asset.contentHashSha256, bibleEntry.description);
        } else {
          const desc = await this.ensureAssetDescription(
            asset,
            b.role,
            descriptionsByHash,
            refRepo,
            policy,
            signal,
            newlyGeneratedDescriptions
          );
          descriptionsByHash.set(asset.contentHashSha256, desc);
        }
      }

      const enrichedAssetsById = new Map<string, ReferenceAsset>();
      for (const [id, a] of assetsMap.entries()) {
        const bibleEntry = campaignBibleEntries.find(
          (e) => e.referenceAssetId.toLowerCase() === a.id.toLowerCase()
        );
        const desc = bibleEntry
          ? bibleEntry.description
          : (descriptionsByHash.get(a.contentHashSha256) ?? a.description);
        const enriched = Object.freeze({
          ...a,
          description: desc
        });
        enrichedAssetsById.set(id, enriched);
      }

      const canonicalRefs = canonicalizeReferenceBindings({
        bindings: activeBindings,
        assetsById: enrichedAssetsById
      });

      boundReferences = canonicalRefs.map((ref) => {
        const bibleEntry = campaignBibleEntries.find(
          (e) => e.referenceAssetId.toLowerCase() === ref.referenceAssetId.toLowerCase()
        );
        const desc = bibleEntry
          ? bibleEntry.description
          : (descriptionsByHash.get(ref.contentHashSha256) ?? ref.asset.description ?? "");
        if (!desc || desc.trim().length === 0) {
          throw new ReferenceAssetDescriptionGenerationError(
            ref.referenceAssetId,
            `No description available for reference asset "${ref.referenceAssetId}".`
          );
        }
        return {
          promptTag: ref.promptTag,
          role: ref.role,
          description: desc.trim(),
          referenceAssetId: ref.referenceAssetId
        };
      });

      const isClientCapable = (client: PlanningModelClientPort): boolean =>
        client.imageCapability === true || client.supportsImages === true;

      const hasInvokableImageCapableClient =
        (policy.allowedProviders.has(this.deps.primaryClient.providerName) &&
          isClientCapable(this.deps.primaryClient)) ||
        (policy.allowedProviders.has(this.deps.fallbackClient.providerName) &&
          isClientCapable(this.deps.fallbackClient));

      if (hasInvokableImageCapableClient) {
        if (!this.deps.objectStorage) {
          throw new PlannerReferenceImageAcquisitionError(
            activeBindings[0]!.referenceAssetId,
            "ObjectStoragePort is required to retrieve reference images for planner.",
            "OBJECT_STORAGE_REQUIRED"
          );
        }

        const acquiredImages: PlanningModelImage[] = [];

        for (const ref of canonicalRefs) {
          if (signal.aborted) {
            throw signal.reason ?? new Error("Planning deadline exceeded");
          }

          const asset =
            assetsMap.get(ref.referenceAssetId) ??
            assetsMap.get(ref.referenceAssetId.toLowerCase());
          if (!asset) {
            throw new PlannerReferenceImageAcquisitionError(
              ref.referenceAssetId,
              `Asset metadata not found for reference asset "${ref.referenceAssetId}".`,
              "METADATA_MISSING"
            );
          }

          let objResult;
          try {
            objResult = await this.deps.objectStorage.getObject(
              { bucket: asset.storageBucket, key: asset.storageObjectKey },
              { signal, maxBytes: MAX_REFERENCE_IMAGE_BYTES }
            );
          } catch (err) {
            if (signal.aborted) {
              throw signal.reason ?? err;
            }
            throw new PlannerReferenceImageAcquisitionError(
              ref.referenceAssetId,
              `Failed to retrieve storage object for reference asset "${ref.referenceAssetId}": ${
                err instanceof Error ? err.message : String(err)
              }`,
              "RETRIEVAL_FAILED",
              { cause: err }
            );
          }

          if (signal.aborted) {
            throw signal.reason ?? new Error("Planning deadline exceeded");
          }

          if (!objResult || !objResult.body || objResult.body.length === 0) {
            throw new PlannerReferenceImageAcquisitionError(
              ref.referenceAssetId,
              `Storage object for reference asset "${ref.referenceAssetId}" is empty or not found.`,
              "EMPTY_IMAGE"
            );
          }

          if (objResult.body.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
            throw new PlannerReferenceImageAcquisitionError(
              ref.referenceAssetId,
              `Storage object for reference asset "${ref.referenceAssetId}" exceeds max image size limit (${MAX_REFERENCE_IMAGE_BYTES} bytes).`,
              "OVERSIZED_IMAGE"
            );
          }

          const mimeType = resolveAndValidatePlannerImageMime(
            ref.referenceAssetId,
            asset.mimeType,
            objResult.contentType
          );

          const base64Data = Buffer.from(objResult.body).toString("base64");
          acquiredImages.push({
            mimeType,
            base64Data
          });
        }

        plannerImages = acquiredImages;
        bindingCount = canonicalRefs.length;
        maxImages = Math.min(canonicalRefs.length, MAX_PLANNING_IMAGES);
      }
    }

    const activeSubjectAssetIds = new Set(
      activeBindings
        .filter((b) => b.role === "subject_identity")
        .map((b) => b.referenceAssetId.toLowerCase())
    );
    const activeLocationAssetIds = new Set(
      activeBindings
        .filter((b) => b.role === "location")
        .map((b) => b.referenceAssetId.toLowerCase())
    );
    const boundReferenceIds = new Set(activeBindings.map((b) => b.referenceAssetId.toLowerCase()));

    const targetDurationMs = scene.configuration.durationMs;

    return {
      buildRequest: (correctiveFeedback?: string): PlanningModelRequest => {
        const baseRequest = buildShotPlanPrompt({
          scenePrompt: scene.configuration.prompt,
          sceneDurationMs: targetDurationMs,
          engineProfileId: scene.configuration.engineProfileId,
          variantCount,
          ...(boundReferences !== undefined && boundReferences.length > 0
            ? { boundReferences }
            : { referenceAssetIds: scene.configuration.referenceIds }),
          correctiveFeedback
        });

        if (plannerImages !== undefined && plannerImages.length > 0) {
          return {
            ...baseRequest,
            images: plannerImages,
            bindingCount,
            maxImages
          };
        }

        return baseRequest;
      },
      parseAndValidate: (rawText: string): readonly ShotPlanProposal[] => {
        const parsed = parseShotPlanResponse(rawText);
        const selected = parsed.slice(0, variantCount);
        if (selected.length === 0) {
          throw new ShotPlanValidationError("No valid shot plan proposals found in response.");
        }

        for (let i = 0; i < selected.length; i++) {
          const proposal = selected[i]!;
          if (proposal.beats.length > 0) {
            for (const beat of proposal.beats) {
              if (beat.startMs < 0 || beat.endMs > targetDurationMs || beat.startMs > beat.endMs) {
                throw new ShotPlanValidationError(
                  `Variant ${i + 1} beat ${beat.beatIndex} has invalid timing [${beat.startMs}, ${beat.endMs}] for duration ${targetDurationMs}ms.`
                );
              }
            }
          }

          if (proposal.continuity && proposal.continuity.persistentSubjectIds.length > 0) {
            for (const persistentId of proposal.continuity.persistentSubjectIds) {
              const lower = persistentId.toLowerCase();
              if (activeLocationAssetIds.has(lower)) {
                throw new InvalidPersistentSubjectIdError(
                  persistentId,
                  `Persistent subject ID "${persistentId}" references a location asset, but only subject_identity assets are allowed in continuity.`
                );
              }
              if (!activeSubjectAssetIds.has(lower)) {
                throw new InvalidPersistentSubjectIdError(
                  persistentId,
                  `Persistent subject ID "${persistentId}" does not match any active scene-bound subject_identity reference in the campaign bible.`
                );
              }
            }
          }

          if (proposal.subjects.length > 0) {
            for (const subject of proposal.subjects) {
              if (
                subject.referenceAssetId &&
                !boundReferenceIds.has(subject.referenceAssetId.toLowerCase())
              ) {
                throw new ShotPlanValidationError(
                  `Variant ${i + 1} subject '${subject.subjectId}' references unbound asset ID '${subject.referenceAssetId}'.`
                );
              }
            }
          }
        }

        return selected;
      }
    };
  }

  private createShotPlansFromProposals(params: {
    readonly proposals: readonly ShotPlanProposal[];
    readonly scene: Scene;
    readonly maxExistingOrdinal: number;
    readonly targetDurationMs: number;
    readonly targetFrameCount: number;
  }): ShotPlan[] {
    const { proposals, scene, maxExistingOrdinal, targetDurationMs, targetFrameCount } = params;
    return proposals.map((proposal, idx) => {
      const beats =
        proposal.beats.length > 0
          ? proposal.beats
          : [
              {
                beatIndex: 1,
                startMs: 0,
                endMs: targetDurationMs,
                description: proposal.actionSummary,
                cameraAction: proposal.cameraMovement,
                subjectAction: proposal.actionSummary
              }
            ];

      return ShotPlan.create({
        id: randomUUID() as ShotPlanId,
        sceneId: scene.id,
        specRevision: scene.specRevision,
        variantOrdinal: maxExistingOrdinal + idx + 1,
        status: "draft",
        routingMode: "reference_directed",
        targetDurationMs,
        targetFrameCount,
        framing: proposal.framing,
        angle: proposal.angle,
        lensIntent: proposal.lensIntent,
        cameraPosition: proposal.cameraPosition,
        cameraMovement: proposal.cameraMovement,
        movementSpeed: proposal.movementSpeed,
        cameraPromptDescription: proposal.cameraPromptDescription,
        subjects: proposal.subjects,
        actionSummary: proposal.actionSummary,
        beats,
        lightingStyle: proposal.lightingStyle,
        environmentDescription: proposal.environmentDescription,
        colorPalette: proposal.colorPalette,
        ...(proposal.atmosphere ? { atmosphere: proposal.atmosphere } : {}),
        ...(proposal.dialogue ? { dialogue: proposal.dialogue } : {}),
        continuity: proposal.continuity ?? {
          persistentSubjectIds: [],
          frameAnchorTarget: "none"
        }
      });
    });
  }

  private async persistShotPlansAndPrevisJobs(params: {
    readonly context: UnitOfWorkContext;
    readonly scene: Scene;
    readonly shotPlans: readonly ShotPlan[];
    readonly newlyGeneratedDescriptions?: Map<string, string> | undefined;
    readonly enqueuePrevisJobs?: boolean | undefined;
    readonly runId?: string | undefined;
  }): Promise<readonly ShotPlan[]> {
    const { context, scene, shotPlans, newlyGeneratedDescriptions, enqueuePrevisJobs, runId } =
      params;

    if (!context.shotPlans) {
      throw new Error("UnitOfWorkContext.shotPlans is not configured.");
    }

    if (runId && scene.activePlanningRunId !== runId) {
      return [];
    }

    if (newlyGeneratedDescriptions && context.referenceAssets?.updateDescriptionByContentHash) {
      for (const [hash, desc] of newlyGeneratedDescriptions) {
        await context.referenceAssets.updateDescriptionByContentHash(hash, desc);
      }
    }

    await context.shotPlans.saveMany(shotPlans);

    if (enqueuePrevisJobs !== false && context.jobs !== undefined) {
      if (scene.status === "draft_pending") {
        scene.beginCandidateGeneration();
      }
      scene.clearPlanningRun();
      await context.scenes.save(scene);

      for (const plan of shotPlans) {
        const previsPrompt = compileStoryboardPrevisPrompt(plan);
        await context.jobs.enqueue({
          sceneId: scene.id,
          jobKind: "candidate",
          workflowTemplate: STORYBOARD_PREVIS_WORKFLOW_TEMPLATE,
          injectedPayload: {
            prompt: previsPrompt.prompt,
            negativePrompt: previsPrompt.negativePrompt,
            seed: CANDIDATE_BASE_SEED + plan.variantOrdinal,
            variantOrdinal: plan.variantOrdinal,
            shotPlanId: plan.id,
            specRevision: plan.specRevision
          }
        });
      }
    } else if (enqueuePrevisJobs === false) {
      if (scene.status === "generating_candidates") {
        scene.submitCandidatesForReview();
      } else {
        scene.clearPlanningRun();
      }
      await context.scenes.save(scene);
    } else {
      scene.clearPlanningRun();
      await context.scenes.save(scene);
    }

    return shotPlans;
  }

  async prepareAdmission(input: PlanShotPlansInput): Promise<PlanShotPlansAdmissionResult> {
    const variantCount = input.variantCount ?? 2;
    if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 5) {
      throw new InvalidShotPlanVariantCountError(variantCount);
    }

    return await this.deps.uow.execute(async (context) => {
      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (!scene) {
        throw new SceneNotFoundError(input.sceneId);
      }

      if (!context.shotPlans) {
        throw new Error("UnitOfWorkContext.shotPlans is not configured.");
      }

      const existing = await context.shotPlans.listBySceneAndRevision(scene.id, scene.specRevision);
      if (existing.length > 0 && !input.reroll) {
        return {
          kind: "replay",
          sceneId: scene.id,
          status: scene.status,
          specRevision: scene.specRevision,
          shotPlans: existing
        };
      }

      if (input.reroll) {
        for (const p of existing) {
          if (p.status === "draft") {
            p.supersede();
            await context.shotPlans.save(p);
          }
        }
      }

      const now = Date.now();
      const isCurrentlyActivePlanning =
        scene.status === "generating_candidates" &&
        Boolean(scene.activePlanningRunId) &&
        Boolean(scene.activePlanningExpiresAt) &&
        new Date(scene.activePlanningExpiresAt!).getTime() > now;

      if (isCurrentlyActivePlanning) {
        return {
          kind: "admitted",
          sceneId: scene.id,
          status: scene.status,
          specRevision: scene.specRevision,
          variantCount,
          runId: scene.activePlanningRunId!,
          isDuplicate: true,
          input: { ...input, variantCount }
        };
      }

      const runId = randomUUID();
      const leaseDurationMs = Math.max(input.overallTimeoutMs ?? 60_000, 60_000) + 30_000;
      const expiresAt = new Date(now + leaseDurationMs).toISOString();
      const planningLease = { runId, expiresAt };

      if (scene.status === "draft_pending") {
        scene.beginCandidateGeneration(planningLease);
        await context.scenes.save(scene);
      } else if (scene.status === "director_review") {
        if (input.reroll) {
          scene.rerollShotPlan(planningLease);
        } else {
          scene.beginCandidateGeneration(planningLease);
        }
        await context.scenes.save(scene);
      } else if (scene.status === "generating_candidates") {
        scene.beginCandidateGeneration(planningLease);
        await context.scenes.save(scene);
      } else if (scene.status === "failed") {
        scene.recoverToReview();
        scene.beginCandidateGeneration(planningLease);
        await context.scenes.save(scene);
      } else {
        scene.beginCandidateGeneration(planningLease);
        await context.scenes.save(scene);
      }

      return {
        kind: "admitted",
        sceneId: scene.id,
        status: scene.status,
        specRevision: scene.specRevision,
        variantCount,
        runId,
        isDuplicate: false,
        input: { ...input, variantCount }
      };
    });
  }

  async executePlanningPipeline(
    sceneIdInput: SceneId | string,
    specRevision: number,
    input: PlanShotPlansInput & { readonly variantCount: number },
    runId?: string,
    signal?: AbortSignal
  ): Promise<readonly ShotPlan[]> {
    try {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("Planning cancelled");
      }

      // Step 1: Read scene and related data in a short transaction
      const readData = await this.deps.uow.execute(async (context) => {
        const scene = await context.scenes.findById(sceneIdInput as SceneId);
        if (!scene) {
          throw new SceneNotFoundError(sceneIdInput);
        }
        if (
          scene.specRevision !== specRevision ||
          scene.status !== "generating_candidates" ||
          (runId && scene.activePlanningRunId !== runId)
        ) {
          return null;
        }

        let rawPolicy = input.externalProcessingPolicy;
        if (!rawPolicy && context.campaigns && context.clients) {
          const campaign = await context.campaigns.findById(scene.campaignId);
          if (campaign) {
            const client = await context.clients.findById(campaign.clientId);
            if (client) {
              rawPolicy = client.externalProcessingPolicy;
            }
          }
        }

        const bindings = context.referenceAssets?.listBindingsBySceneId
          ? await context.referenceAssets.listBindingsBySceneId(scene.id, {
              specRevision: scene.specRevision
            })
          : [];
        const activeBindings = bindings.filter((b) => !b.archivedAt);

        let campaignBibleEntries: readonly CampaignReferenceBibleEntry[] = [];
        if (context.campaignReferenceBible) {
          campaignBibleEntries = await context.campaignReferenceBible.findByCampaignId(
            scene.campaignId
          );
        }

        const allCampaignBindings: SceneReferenceBinding[] = [];
        if (
          context.campaignReferenceBible &&
          campaignBibleEntries.length === 0 &&
          context.scenes.findByCampaignId
        ) {
          const campaignScenes = await context.scenes.findByCampaignId(scene.campaignId);
          for (const s of campaignScenes) {
            if (context.referenceAssets?.listBindingsBySceneId) {
              const bList = await context.referenceAssets.listBindingsBySceneId(s.id, {
                specRevision: s.specRevision
              });
              allCampaignBindings.push(...bList.filter((b) => !b.archivedAt));
            }
          }
        }

        let sceneAssets: readonly ReferenceAsset[] = [];
        if (context.referenceAssets) {
          sceneAssets = await context.referenceAssets.listBySceneId(scene.id, {
            specRevision: scene.specRevision
          });
        }

        const assetsMap = new Map<string, ReferenceAsset>();
        for (const a of sceneAssets) {
          assetsMap.set(a.id, a);
          assetsMap.set(a.id.toLowerCase(), a);
        }

        const candidateBindingIds = [
          ...activeBindings.map((b) => b.referenceAssetId),
          ...allCampaignBindings.map((b) => b.referenceAssetId)
        ];
        const missingIds = candidateBindingIds.filter(
          (id) => !assetsMap.has(id) && !assetsMap.has(id.toLowerCase())
        );

        if (missingIds.length > 0 && context.referenceAssets?.findByIdsGlobal) {
          const globalAssets = await context.referenceAssets.findByIdsGlobal(
            missingIds as readonly ReferenceAssetId[]
          );
          for (const a of globalAssets) {
            assetsMap.set(a.id, a);
            assetsMap.set(a.id.toLowerCase(), a);
          }
        }

        const refRepo = context.referenceAssets as
          | (ReferenceAssetRepository & {
              readonly findDescriptionByContentHash?: (
                contentHashSha256: string
              ) => Promise<string | undefined>;
              readonly updateDescriptionByContentHash?: (
                contentHashSha256: string,
                description: string
              ) => Promise<void>;
              readonly withLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
            })
          | undefined;

        const cachedDescriptions = new Map<string, string>();
        if (refRepo && typeof refRepo.findDescriptionByContentHash === "function") {
          for (const a of assetsMap.values()) {
            const desc = await refRepo.findDescriptionByContentHash(a.contentHashSha256);
            if (desc) {
              cachedDescriptions.set(a.contentHashSha256, desc);
            }
          }
        }

        return {
          sceneSnapshot: scene.snapshot(),
          rawPolicy,
          activeBindings,
          campaignBibleEntries,
          allCampaignBindings,
          assets: Array.from(assetsMap.values()),
          cachedDescriptions,
          hasCampaignBibleRepo: Boolean(context.campaignReferenceBible),
          hasRefRepo: Boolean(refRepo)
        };
      });

      if (!readData) {
        return [];
      }

      const scene = Scene.reconstitute(readData.sceneSnapshot);
      const policy: PlanningAuthorizationPolicy = decodePlanningAuthorizationPolicy(
        readData.rawPolicy ?? DEFAULT_EXTERNAL_PROCESSING_POLICY
      );

      const targetDurationMs = scene.configuration.durationMs;
      const targetFrameCount = Math.round((targetDurationMs / 1000) * 24);

      // Step 2: Outside DB transaction, generate missing descriptions and run model
      const descriptionsByHash = new Map<string, string>(readData.cachedDescriptions);
      const newlyGeneratedDescriptions = new Map<string, string>();

      const assetsMap = new Map<string, ReferenceAsset>();
      for (const a of readData.assets) {
        assetsMap.set(a.id, a);
        assetsMap.set(a.id.toLowerCase(), a);
      }

      const proposals = await this.kernel.run({
        policy,
        overallTimeoutMs: input.overallTimeoutMs,
        signal,
        prepare: async (prepSignal: AbortSignal) => {
          return await this.preparePlanningWorkflow({
            scene,
            policy,
            activeBindings: readData.activeBindings,
            campaignBibleEntries: readData.campaignBibleEntries,
            allCampaignBindings: readData.allCampaignBindings,
            assetsMap,
            descriptionsByHash,
            newlyGeneratedDescriptions,
            bibleInitializer: async (entries) => {
              const initRes = await this.deps.uow.execute(async (context) => {
                if (!context.campaignReferenceBible) return { entries: [] };
                return await context.campaignReferenceBible.initializeSnapshot({
                  campaignId: scene.campaignId,
                  entries
                });
              });
              return initRes.entries;
            },
            hasCampaignBibleRepo: readData.hasCampaignBibleRepo,
            variantCount: input.variantCount,
            signal: prepSignal
          });
        }
      });

      if (signal?.aborted) {
        throw signal.reason ?? new Error("Planning cancelled");
      }

      // Step 3: Short write transaction: persist shot plans and previs render jobs
      const savedPlans = await this.deps.uow.execute(async (context) => {
        const currentScene = await context.scenes.findById(scene.id);
        if (
          !currentScene ||
          currentScene.specRevision !== specRevision ||
          currentScene.status !== "generating_candidates" ||
          (runId && currentScene.activePlanningRunId !== runId)
        ) {
          return [];
        }

        if (signal?.aborted) {
          throw signal.reason ?? new Error("Planning cancelled");
        }

        if (!context.shotPlans) {
          throw new Error("UnitOfWorkContext.shotPlans is not configured.");
        }

        const existing = await context.shotPlans.listBySceneAndRevision(
          currentScene.id,
          currentScene.specRevision
        );
        const existingCandidates = context.candidates
          ? await context.candidates.listBySceneAndRevision(
              currentScene.id,
              currentScene.specRevision
            )
          : [];
        const maxExistingPlanOrdinal = existing.reduce(
          (max, p) => Math.max(max, p.variantOrdinal),
          0
        );
        const maxExistingCandidateOrdinal = existingCandidates.reduce(
          (max, c) => Math.max(max, c.variantOrdinal),
          0
        );
        const maxExistingOrdinal = Math.max(maxExistingPlanOrdinal, maxExistingCandidateOrdinal);

        const shotPlans = this.createShotPlansFromProposals({
          proposals,
          scene: currentScene,
          maxExistingOrdinal,
          targetDurationMs,
          targetFrameCount
        });

        return await this.persistShotPlansAndPrevisJobs({
          context,
          scene: currentScene,
          shotPlans,
          newlyGeneratedDescriptions,
          enqueuePrevisJobs: input.enqueuePrevisJobs,
          runId
        });
      });

      return savedPlans;
    } catch (err) {
      // Step 4: Failure handling - mark scene failed with reason in short transaction
      try {
        const failureReason = signal?.aborted
          ? signal.reason instanceof Error
            ? signal.reason.message
            : typeof signal.reason === "string"
              ? signal.reason
              : "Shot-plan generation was cancelled"
          : err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Shot-plan generation failed";

        await this.deps.uow.execute(async (context) => {
          const scene = await context.scenes.findById(sceneIdInput as SceneId);
          if (
            scene &&
            scene.status === "generating_candidates" &&
            scene.specRevision === specRevision &&
            (!runId || scene.activePlanningRunId === runId)
          ) {
            scene.fail(failureReason);
            await context.scenes.save(scene);
          }
        });
      } catch {
        // Do not mask original error
      }
      throw err;
    }
  }

  async execute(input: PlanShotPlansInput): Promise<PlanShotPlansResult> {
    const variantCount = input.variantCount ?? 2;
    if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 5) {
      throw new InvalidShotPlanVariantCountError(variantCount);
    }

    return await this.deps.uow.execute((context) =>
      this.executeWithContext(context, { ...input, variantCount })
    );
  }

  async executeWithContext(
    context: UnitOfWorkContext,
    input: PlanShotPlansInput & { readonly variantCount: number }
  ): Promise<PlanShotPlansResult> {
    const scene = await context.scenes.findById(input.sceneId as SceneId);
    if (!scene) {
      throw new SceneNotFoundError(input.sceneId);
    }

    if (!context.shotPlans) {
      throw new Error("UnitOfWorkContext.shotPlans is not configured.");
    }

    const existing = await context.shotPlans.listBySceneAndRevision(scene.id, scene.specRevision);
    if (existing.length > 0 && !input.reroll) {
      return {
        shotPlans: existing,
        isIdempotentReplay: true
      };
    }

    if (input.reroll) {
      for (const p of existing) {
        if (p.status === "draft") {
          p.supersede();
          await context.shotPlans.save(p);
        }
      }
    }

    let rawPolicy = input.externalProcessingPolicy;
    if (!rawPolicy && context.campaigns && context.clients) {
      const campaign = await context.campaigns.findById(scene.campaignId);
      if (campaign) {
        const client = await context.clients.findById(campaign.clientId);
        if (client) {
          rawPolicy = client.externalProcessingPolicy;
        }
      }
    }

    const policy: PlanningAuthorizationPolicy = decodePlanningAuthorizationPolicy(
      rawPolicy ?? DEFAULT_EXTERNAL_PROCESSING_POLICY
    );

    const targetDurationMs = scene.configuration.durationMs;
    const targetFrameCount = Math.round((targetDurationMs / 1000) * 24);

    const bindings = context.referenceAssets?.listBindingsBySceneId
      ? await context.referenceAssets.listBindingsBySceneId(scene.id, {
          specRevision: scene.specRevision
        })
      : [];
    const activeBindings = bindings.filter((b) => !b.archivedAt);

    let campaignBibleEntries: readonly CampaignReferenceBibleEntry[] = [];
    if (context.campaignReferenceBible) {
      campaignBibleEntries = await context.campaignReferenceBible.findByCampaignId(
        scene.campaignId
      );
    }

    const allCampaignBindings: SceneReferenceBinding[] = [];
    if (
      context.campaignReferenceBible &&
      campaignBibleEntries.length === 0 &&
      context.scenes.findByCampaignId
    ) {
      const campaignScenes = await context.scenes.findByCampaignId(scene.campaignId);
      for (const s of campaignScenes) {
        if (context.referenceAssets?.listBindingsBySceneId) {
          const bList = await context.referenceAssets.listBindingsBySceneId(s.id, {
            specRevision: s.specRevision
          });
          allCampaignBindings.push(...bList.filter((b) => !b.archivedAt));
        }
      }
    }

    let sceneAssets: readonly ReferenceAsset[] = [];
    if (context.referenceAssets) {
      sceneAssets = await context.referenceAssets.listBySceneId(scene.id, {
        specRevision: scene.specRevision
      });
    }

    const assetsMap = new Map<string, ReferenceAsset>();
    for (const a of sceneAssets) {
      assetsMap.set(a.id, a);
      assetsMap.set(a.id.toLowerCase(), a);
    }

    const candidateBindingIds = [
      ...activeBindings.map((b) => b.referenceAssetId),
      ...allCampaignBindings.map((b) => b.referenceAssetId)
    ];
    const missingIds = candidateBindingIds.filter(
      (id) => !assetsMap.has(id) && !assetsMap.has(id.toLowerCase())
    );

    if (missingIds.length > 0 && context.referenceAssets?.findByIdsGlobal) {
      const globalAssets = await context.referenceAssets.findByIdsGlobal(
        missingIds as readonly ReferenceAssetId[]
      );
      for (const a of globalAssets) {
        assetsMap.set(a.id, a);
        assetsMap.set(a.id.toLowerCase(), a);
      }
    }

    const refRepo = context.referenceAssets as
      | (ReferenceAssetRepository & {
          readonly findDescriptionByContentHash?: (
            contentHashSha256: string
          ) => Promise<string | undefined>;
          readonly updateDescriptionByContentHash?: (
            contentHashSha256: string,
            description: string
          ) => Promise<void>;
          readonly withLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
        })
      | undefined;

    const descriptionsByHash = new Map<string, string>();
    if (refRepo && typeof refRepo.findDescriptionByContentHash === "function") {
      for (const a of assetsMap.values()) {
        const desc = await refRepo.findDescriptionByContentHash(a.contentHashSha256);
        if (desc) {
          descriptionsByHash.set(a.contentHashSha256, desc);
        }
      }
    }

    const proposals = await this.kernel.run({
      policy,
      overallTimeoutMs: input.overallTimeoutMs,
      prepare: async (signal: AbortSignal) => {
        return await this.preparePlanningWorkflow({
          scene,
          policy,
          activeBindings,
          campaignBibleEntries,
          allCampaignBindings,
          assetsMap,
          descriptionsByHash,
          refRepo,
          bibleInitializer: context.campaignReferenceBible
            ? async (entries) => {
                const initRes = await context.campaignReferenceBible!.initializeSnapshot({
                  campaignId: scene.campaignId,
                  entries
                });
                return initRes.entries;
              }
            : undefined,
          hasCampaignBibleRepo: Boolean(context.campaignReferenceBible),
          variantCount: input.variantCount,
          signal
        });
      }
    });

    const existingCandidates = context.candidates
      ? await context.candidates.listBySceneAndRevision(scene.id, scene.specRevision)
      : [];
    const maxExistingPlanOrdinal = existing.reduce((max, p) => Math.max(max, p.variantOrdinal), 0);
    const maxExistingCandidateOrdinal = existingCandidates.reduce(
      (max, c) => Math.max(max, c.variantOrdinal),
      0
    );
    const maxExistingOrdinal = Math.max(maxExistingPlanOrdinal, maxExistingCandidateOrdinal);

    const shotPlans = this.createShotPlansFromProposals({
      proposals,
      scene,
      maxExistingOrdinal,
      targetDurationMs,
      targetFrameCount
    });

    const savedPlans = await this.persistShotPlansAndPrevisJobs({
      context,
      scene,
      shotPlans,
      enqueuePrevisJobs: input.enqueuePrevisJobs
    });

    return {
      shotPlans: savedPlans,
      isIdempotentReplay: false
    };
  }
}
