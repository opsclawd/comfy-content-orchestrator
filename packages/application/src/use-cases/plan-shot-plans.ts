import { randomUUID } from "node:crypto";
import {
  ShotPlan,
  type ReferenceAsset,
  type ReferenceAssetId,
  type SceneId,
  type ShotPlanId
} from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome
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
  ShotPlanValidationError
} from "./plan-shot-plans-errors.js";
import { PlanningNotAuthorizedError } from "./plan-scene-configuration-errors.js";
import { DEFAULT_EXTERNAL_PROCESSING_POLICY } from "./create-client.js";

export const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB

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

        const bindings = context.referenceAssets?.listBindingsBySceneId
          ? await context.referenceAssets.listBindingsBySceneId(scene.id, {
              specRevision: scene.specRevision
            })
          : [];
        const activeBindings = bindings.filter((b) => !b.archivedAt);

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

          if (
            typeof context.referenceAssets.findDescriptionByContentHash !== "function" ||
            typeof context.referenceAssets.updateDescriptionByContentHash !== "function" ||
            typeof context.referenceAssets.withLock !== "function"
          ) {
            throw new ReferenceAssetDescriptionGenerationError(
              activeBindings[0]!.referenceAssetId,
              "ReferenceAsset repository lacks required description caching or locking operations (findDescriptionByContentHash, updateDescriptionByContentHash, withLock)."
            );
          }

          const refRepo = context.referenceAssets as ReferenceAssetRepository & {
            readonly findDescriptionByContentHash: (
              contentHashSha256: string
            ) => Promise<string | undefined>;
            readonly updateDescriptionByContentHash: (
              contentHashSha256: string,
              description: string
            ) => Promise<void>;
            readonly withLock: <T>(key: string, action: () => Promise<T>) => Promise<T>;
          };

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

          const descriptionsByHash = new Map<string, string>();

          for (const b of activeBindings) {
            if (signal.aborted) {
              throw signal.reason ?? new Error("Planning deadline exceeded");
            }

            const asset = (assetsMap.get(b.referenceAssetId) ??
              assetsMap.get(b.referenceAssetId.toLowerCase()))!;
            const hash = asset.contentHashSha256;

            if (descriptionsByHash.has(hash)) {
              continue;
            }

            if (asset.description && asset.description.trim().length > 0) {
              descriptionsByHash.set(hash, asset.description.trim());
              continue;
            }

            const cached = await refRepo.findDescriptionByContentHash(hash);
            if (cached && cached.trim().length > 0) {
              descriptionsByHash.set(hash, cached.trim());
              continue;
            }

            await refRepo.withLock(hash, async () => {
              if (descriptionsByHash.has(hash)) {
                return;
              }

              const rechecked = await refRepo.findDescriptionByContentHash(hash);
              if (rechecked && rechecked.trim().length > 0) {
                descriptionsByHash.set(hash, rechecked.trim());
                return;
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
                  userPrompt: `Provide a concise, objective visual description of this reference image (role: ${b.role}).`,
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
            });
          }

          const enrichedAssetsById = new Map<string, ReferenceAsset>();
          for (const [id, a] of assetsMap.entries()) {
            const desc = descriptionsByHash.get(a.contentHashSha256) ?? a.description;
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
            const desc =
              descriptionsByHash.get(ref.contentHashSha256) ?? ref.asset.description ?? "";
            if (!desc || desc.trim().length === 0) {
              throw new ReferenceAssetDescriptionGenerationError(
                ref.referenceAssetId,
                `No description available for reference asset "${ref.referenceAssetId}".`
              );
            }
            return {
              promptTag: ref.promptTag,
              role: ref.role,
              description: desc.trim()
            };
          });
        }

        return {
          buildRequest: (correctiveFeedback?: string) =>
            buildShotPlanPrompt({
              scenePrompt: scene.configuration.prompt,
              sceneDurationMs: targetDurationMs,
              engineProfileId: scene.configuration.engineProfileId,
              variantCount: input.variantCount,
              ...(boundReferences !== undefined && boundReferences.length > 0
                ? { boundReferences }
                : { referenceAssetIds: scene.configuration.referenceIds }),
              correctiveFeedback
            }),
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
