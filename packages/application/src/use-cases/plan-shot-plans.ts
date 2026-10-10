import { randomUUID } from "node:crypto";
import {
  ShotPlan,
  type ReferenceAsset,
  type ReferenceAssetId,
  type SceneId,
  type ShotPlanId
} from "@cco/domain";
import {
  MAX_PLANNING_IMAGES,
  type PlanningModelClientPort,
  type PlanningModelImage,
  type PlanningModelOutcome,
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
  type PlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import { buildShotPlanPrompt, type BoundReferencePromptInput } from "./shot-plan-prompt.js";
import { parseShotPlanResponse, type ShotPlanProposal } from "./shot-plan-response-parser.js";
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

  // Storage contentType, when present, must be verified as supported (never accept generic application/octet-stream or unsupported types)
  if (normalizedStorageMime !== undefined) {
    if (!SUPPORTED_PLANNER_IMAGE_MIMES.has(normalizedStorageMime)) {
      throw new PlannerReferenceImageAcquisitionError(
        referenceAssetId,
        `Storage object has unsupported or generic contentType '${normalizedStorageMime}'. Supported types: image/png, image/jpeg, image/webp.`,
        "INVALID_MIME_TYPE"
      );
    }
  }

  // Precedence rule:
  // Verified storage contentType takes precedence when provided; otherwise fall back to validated ReferenceAsset domain metadata.
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
    refRepo: ReferenceAssetRepository & {
      readonly findDescriptionByContentHash: (
        contentHashSha256: string
      ) => Promise<string | undefined>;
      readonly updateDescriptionByContentHash: (
        contentHashSha256: string,
        description: string
      ) => Promise<void>;
      readonly withLock: <T>(key: string, action: () => Promise<T>) => Promise<T>;
    },
    policy: PlanningAuthorizationPolicy,
    signal: AbortSignal
  ): Promise<string> {
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

    const hash = asset.contentHashSha256;
    if (descriptionsByHash.has(hash)) {
      return descriptionsByHash.get(hash)!;
    }

    if (asset.description && asset.description.trim().length > 0) {
      const trimmed = asset.description.trim();
      descriptionsByHash.set(hash, trimmed);
      return trimmed;
    }

    const cached = await refRepo.findDescriptionByContentHash(hash);
    if (cached && cached.trim().length > 0) {
      const trimmed = cached.trim();
      descriptionsByHash.set(hash, trimmed);
      return trimmed;
    }

    return await refRepo.withLock(hash, async () => {
      if (descriptionsByHash.has(hash)) {
        return descriptionsByHash.get(hash)!;
      }

      const rechecked = await refRepo.findDescriptionByContentHash(hash);
      if (rechecked && rechecked.trim().length > 0) {
        const trimmed = rechecked.trim();
        descriptionsByHash.set(hash, trimmed);
        return trimmed;
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
          }`
        );
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

      const base64Data = Buffer.from(objResult.body).toString("base64");
      const mimeType = asset.mimeType ?? "image/jpeg";

      let outcome: PlanningModelOutcome;
      try {
        outcome = await imageClient.complete({
          systemPrompt:
            "You are a specialized visual analysis assistant for video production. Describe the provided reference image concisely and objectively, focusing on visual details, appearance, and physical characteristics relevant to video generation. Return only the description text with no conversational preamble or markdown formatting.",
          userPrompt: `Provide a concise, objective visual description of this reference image (role: ${role}).`,
          images: [{ mimeType, base64Data }],
          bindingCount: 1,
          maxImages: 1,
          signal
        });
      } catch (err) {
        if (signal.aborted) {
          throw signal.reason ?? err;
        }
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Failed to complete description request for reference asset "${asset.id}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

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

      const generatedDesc = outcome.rawText.trim();
      if (generatedDesc.length === 0) {
        throw new ReferenceAssetDescriptionGenerationError(
          asset.id,
          `Generated description for reference asset "${asset.id}" was blank.`
        );
      }

      await refRepo.updateDescriptionByContentHash(hash, generatedDesc);
      descriptionsByHash.set(hash, generatedDesc);
      return generatedDesc;
    });
  }

  async execute(input: PlanShotPlansInput): Promise<PlanShotPlansResult> {
    const variantCount = input.variantCount ?? 3;
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

    const proposals = await this.kernel.run({
      policy,
      overallTimeoutMs: input.overallTimeoutMs,
      prepare: async (signal: AbortSignal) => {
        let boundReferences: BoundReferencePromptInput[] | undefined;
        let plannerImages: readonly PlanningModelImage[] | undefined;
        let bindingCount: number | undefined;
        let maxImages: number | undefined;

        const bindings = context.referenceAssets?.listBindingsBySceneId
          ? await context.referenceAssets.listBindingsBySceneId(scene.id, {
              specRevision: scene.specRevision
            })
          : [];
        const activeBindings = bindings.filter((b) => !b.archivedAt);

        const refRepo = context.referenceAssets as
          | (ReferenceAssetRepository & {
              readonly findDescriptionByContentHash: (
                contentHashSha256: string
              ) => Promise<string | undefined>;
              readonly updateDescriptionByContentHash: (
                contentHashSha256: string,
                description: string
              ) => Promise<void>;
              readonly withLock: <T>(key: string, action: () => Promise<T>) => Promise<T>;
            })
          | undefined;

        let campaignBibleEntries: readonly CampaignReferenceBibleEntry[] = [];

        if (context.campaignReferenceBible) {
          const bibleRepo = context.campaignReferenceBible;
          const existingBible = await bibleRepo.findByCampaignId(scene.campaignId);

          if (existingBible.length > 0) {
            campaignBibleEntries = existingBible;

            // Validate current scene bindings against existing bible
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
          } else {
            // Check if any scene in the campaign already had a planning run
            const campaignScenes =
              context.scenes && typeof context.scenes.findByCampaignId === "function"
                ? await context.scenes.findByCampaignId(scene.campaignId)
                : [scene];
            let campaignHasShotPlans = false;
            for (const s of campaignScenes) {
              const plans = context.shotPlans
                ? await context.shotPlans.listBySceneAndRevision(s.id, s.specRevision)
                : [];
              if (plans.length > 0) {
                campaignHasShotPlans = true;
                break;
              }
            }

            if (campaignHasShotPlans) {
              // Bible is empty from prior run; any eligible bindings in this scene mismatch
              for (const b of activeBindings) {
                if (b.role === "subject_identity" || b.role === "location") {
                  throw new StaleBibleBindingMismatchError(
                    scene.id,
                    b.referenceAssetId,
                    `Campaign bible is empty but scene "${scene.id}" has bound asset "${b.referenceAssetId}".`
                  );
                }
              }
              campaignBibleEntries = [];
            } else {
              // First planning run for campaign! Initialize bible snapshot from all campaign scenes
              const rolesByAssetId = new Map<string, Set<CampaignReferenceBibleRole>>();
              const assetIdCasing = new Map<string, string>();

              for (const s of campaignScenes) {
                const sBindings = context.referenceAssets?.listBindingsBySceneId
                  ? await context.referenceAssets.listBindingsBySceneId(s.id, {
                      specRevision: s.specRevision
                    })
                  : [];
                for (const b of sBindings.filter((b) => !b.archivedAt)) {
                  if (b.role === "subject_identity" || b.role === "location") {
                    const lower = b.referenceAssetId.toLowerCase();
                    if (!assetIdCasing.has(lower)) {
                      assetIdCasing.set(lower, b.referenceAssetId);
                    }
                    if (!rolesByAssetId.has(lower)) {
                      rolesByAssetId.set(lower, new Set());
                    }
                    rolesByAssetId.get(lower)!.add(b.role);
                  }
                }
              }

              // Detect conflicting roles across campaign scenes
              for (const [lower, roles] of rolesByAssetId.entries()) {
                if (roles.size > 1) {
                  throw new CampaignReferenceBibleRoleConflictError(
                    assetIdCasing.get(lower)!,
                    Array.from(roles)
                  );
                }
              }

              if (rolesByAssetId.size === 0) {
                const initRes = await bibleRepo.initializeSnapshot({
                  campaignId: scene.campaignId,
                  entries: []
                });
                campaignBibleEntries = initRes.entries;
              } else {
                if (!context.referenceAssets || !refRepo) {
                  throw new ReferenceAssetDescriptionGenerationError(
                    Array.from(assetIdCasing.values())[0]!,
                    "ReferenceAsset repository is not configured on UnitOfWorkContext."
                  );
                }

                const eligibleAssetIds = Array.from(assetIdCasing.values());
                const campaignRecord = context.campaigns
                  ? await context.campaigns.findById(scene.campaignId)
                  : undefined;
                const clientId = campaignRecord?.clientId;

                let allEligibleAssets: readonly ReferenceAsset[] = [];
                if (context.referenceAssets.findByIdsGlobal) {
                  allEligibleAssets = await context.referenceAssets.findByIdsGlobal(
                    eligibleAssetIds as unknown as readonly ReferenceAssetId[]
                  );
                } else if (clientId && context.referenceAssets.findByIds) {
                  allEligibleAssets = await context.referenceAssets.findByIds(
                    clientId,
                    eligibleAssetIds as unknown as readonly ReferenceAssetId[]
                  );
                } else {
                  const found = new Map<string, ReferenceAsset>();
                  for (const s of campaignScenes) {
                    const list = await context.referenceAssets.listBySceneId(s.id, {
                      specRevision: s.specRevision
                    });
                    for (const a of list) {
                      found.set(a.id.toLowerCase(), a);
                    }
                  }
                  allEligibleAssets = Array.from(found.values());
                }

                const eligibleAssetsMap = new Map<string, ReferenceAsset>();
                for (const a of allEligibleAssets) {
                  eligibleAssetsMap.set(a.id.toLowerCase(), a);
                }
                for (const id of eligibleAssetIds) {
                  if (!eligibleAssetsMap.has(id.toLowerCase())) {
                    throw new ReferenceAssetDescriptionGenerationError(
                      id,
                      `Reference asset "${id}" could not be resolved for campaign "${scene.campaignId}".`
                    );
                  }
                }

                const bibleDescriptionsByHash = new Map<string, string>();
                for (const id of eligibleAssetIds) {
                  const asset = eligibleAssetsMap.get(id.toLowerCase())!;
                  const role = Array.from(rolesByAssetId.get(id.toLowerCase())!)[0]!;
                  await this.ensureAssetDescription(
                    asset,
                    role,
                    bibleDescriptionsByHash,
                    refRepo,
                    policy,
                    signal
                  );
                }

                const sortedAssets = Array.from(eligibleAssetsMap.values()).sort((a, b) => {
                  const roleA = Array.from(rolesByAssetId.get(a.id.toLowerCase())!)[0]!;
                  const roleB = Array.from(rolesByAssetId.get(b.id.toLowerCase())!)[0]!;
                  const priorityA = roleA === "subject_identity" ? 0 : 1;
                  const priorityB = roleB === "subject_identity" ? 0 : 1;
                  if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                  }
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
                      bibleDescriptionsByHash.get(asset.contentHashSha256) ??
                      asset.description ??
                      "";
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

                const initRes = await bibleRepo.initializeSnapshot({
                  campaignId: scene.campaignId,
                  entries: snapshotEntries
                });
                campaignBibleEntries = initRes.entries;

                // Validate scene active bindings against winner
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
        }

        if (activeBindings.length > 0) {
          if (signal.aborted) {
            throw signal.reason ?? new Error("Planning deadline exceeded");
          }

          if (!context.referenceAssets) {
            throw new ReferenceAssetDescriptionGenerationError(
              activeBindings[0]!.referenceAssetId,
              "ReferenceAsset repository is not configured on UnitOfWorkContext."
            );
          }

          if (!refRepo && !context.campaignReferenceBible) {
            throw new ReferenceAssetDescriptionGenerationError(
              activeBindings[0]!.referenceAssetId,
              "ReferenceAsset repository lacks required description caching or locking operations (findDescriptionByContentHash, updateDescriptionByContentHash, withLock)."
            );
          }

          const sceneAssets = await context.referenceAssets.listBySceneId(scene.id, {
            specRevision: scene.specRevision
          });

          const assetsMap = new Map<string, ReferenceAsset>();
          for (const a of sceneAssets) {
            assetsMap.set(a.id, a);
            assetsMap.set(a.id.toLowerCase(), a);
          }

          const missingIds = activeBindings
            .map((b) => b.referenceAssetId)
            .filter((id) => !assetsMap.has(id) && !assetsMap.has(id.toLowerCase()));

          if (missingIds.length > 0 && context.referenceAssets.findByIdsGlobal) {
            const globalAssets = await context.referenceAssets.findByIdsGlobal(
              missingIds as readonly ReferenceAssetId[]
            );
            for (const a of globalAssets) {
              assetsMap.set(a.id, a);
              assetsMap.set(a.id.toLowerCase(), a);
            }
          }

          // Verify every active binding resolved to an asset
          for (const b of activeBindings) {
            const resolved =
              assetsMap.get(b.referenceAssetId) ?? assetsMap.get(b.referenceAssetId.toLowerCase());
            if (!resolved) {
              throw new ReferenceAssetDescriptionGenerationError(
                b.referenceAssetId,
                `Reference asset "${b.referenceAssetId}" could not be resolved for scene "${scene.id}".`
              );
            }
          }

          const sceneDescriptionsByHash = new Map<string, string>();
          for (const b of activeBindings) {
            const asset = (assetsMap.get(b.referenceAssetId) ??
              assetsMap.get(b.referenceAssetId.toLowerCase()))!;
            const bibleEntry = campaignBibleEntries.find(
              (e) => e.referenceAssetId.toLowerCase() === b.referenceAssetId.toLowerCase()
            );
            if (bibleEntry) {
              sceneDescriptionsByHash.set(asset.contentHashSha256, bibleEntry.description);
            } else if (refRepo) {
              await this.ensureAssetDescription(
                asset,
                b.role,
                sceneDescriptionsByHash,
                refRepo,
                policy,
                signal
              );
            }
          }

          const enrichedAssetsById = new Map<string, ReferenceAsset>();
          for (const [id, a] of assetsMap.entries()) {
            const bibleEntry = campaignBibleEntries.find(
              (e) => e.referenceAssetId.toLowerCase() === a.id.toLowerCase()
            );
            const desc = bibleEntry
              ? bibleEntry.description
              : (sceneDescriptionsByHash.get(a.contentHashSha256) ?? a.description);
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
              : (sceneDescriptionsByHash.get(ref.contentHashSha256) ?? ref.asset.description ?? "");
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

          if (hasInvokableImageCapableClient && canonicalRefs.length > 0) {
            if (!this.deps.objectStorage) {
              throw new PlannerReferenceImageAcquisitionError(
                canonicalRefs[0]!.referenceAssetId,
                "ObjectStoragePort is required to retrieve reference images for planning when an image-capable planning client is configured.",
                "MISSING_STORAGE_PORT"
              );
            }

            const acquiredImages: PlanningModelImage[] = [];
            for (const ref of canonicalRefs) {
              if (signal.aborted) {
                throw signal.reason ?? new Error("Planning deadline exceeded");
              }

              const asset = ref.asset;
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
        const boundReferenceIds = new Set(
          activeBindings.map((b) => b.referenceAssetId.toLowerCase())
        );

        return {
          buildRequest: (correctiveFeedback?: string): PlanningModelRequest => {
            const baseRequest = buildShotPlanPrompt({
              scenePrompt: scene.configuration.prompt,
              sceneDurationMs: targetDurationMs,
              engineProfileId: scene.configuration.engineProfileId,
              variantCount: input.variantCount,
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
            const selected = parsed.slice(0, input.variantCount);
            if (selected.length === 0) {
              throw new ShotPlanValidationError("No valid shot plan proposals found in response.");
            }

            for (let i = 0; i < selected.length; i++) {
              const proposal = selected[i]!;
              if (proposal.beats.length > 0) {
                for (const beat of proposal.beats) {
                  if (
                    beat.startMs < 0 ||
                    beat.endMs > targetDurationMs ||
                    beat.startMs > beat.endMs
                  ) {
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

    const shotPlans: ShotPlan[] = proposals.map((proposal, idx) => {
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

    await context.shotPlans.saveMany(shotPlans);

    if (input.enqueuePrevisJobs !== false && context.jobs !== undefined) {
      if (scene.status === "draft_pending") {
        scene.beginCandidateGeneration();
        await context.scenes.save(scene);
      }
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
    }

    return {
      shotPlans,
      isIdempotentReplay: false
    };
  }
}
