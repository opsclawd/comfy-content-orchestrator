import type { CampaignId, CandidateId, SceneId, ShotPlanId, ShotPlanSnapshot } from "@cco/domain";
import {
  computeProductionInputFingerprint,
  type CameraIntentSummary,
  type H3ProductionInspectionReadModel,
  type InspectedFrameAnchor,
  type InspectedReferenceInput,
  type ProductionBlocker,
  type ProductionReadinessStatus,
  type ShotPlanRoutingMode
} from "@cco/contracts";
import type { HashBytesPort } from "../ports/hash-bytes.js";
import type { ImageInspectionPort } from "../ports/image-inspection-port.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { ReviewMediaDeliveryPort } from "../ports/review-media-delivery-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import {
  canonicalizeReferenceBindings,
  ReferenceCanonicalizationError,
  type CanonicalReferenceEntry
} from "../shot-plan-compiler/canonicalize-reference-bindings.js";
import { parseImageByteHeader } from "../shot-plan-compiler/image-header-parser.js";
import {
  compileShotPlan,
  ShotPlanCompilerError
} from "../shot-plan-compiler/shot-plan-compiler.js";
import {
  isMiniMaxEngineOrProfile,
  mapDurationMsToMiniMaxH3FrameCount,
  UnsupportedProductionDurationError
} from "./map-production-duration.js";
import { UnrepresentableProductionConfigurationError } from "./production-configuration-errors.js";
import { MAX_CANDIDATE_IMAGE_BYTES } from "./resolve-approved-candidate-media.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import { ShotPlanNotFoundError, StaleBibleBindingMismatchError } from "./plan-shot-plans-errors.js";
import {
  ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS,
  MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY,
  MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
  MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE
} from "./production-profile-constants.js";
import { InvalidTransitionError } from "@cco/domain";

export const MINIMAX_H3_EXECUTION_CEILING_SECONDS = 60 as const;

export interface PrepareSceneProductionInputsOptions {
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly hashBytes?: HashBytesPort | undefined;
  readonly imageValidator?: ImageInspectionPort | undefined;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
}

export interface PrepareSceneProductionInputsInput {
  readonly sceneId: string;
  readonly shotPlanId?: string | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface PrepareSceneProductionInputsResult {
  readonly readiness: ProductionReadinessStatus;
  readonly blockers: readonly ProductionBlocker[];
  readonly inspection: H3ProductionInspectionReadModel;
  readonly canonicalReferences: readonly CanonicalReferenceEntry[];
  readonly targetShotPlan?: ShotPlanSnapshot | undefined;
  readonly durationResultOk: boolean;
  readonly frameCount: number;
}

function validateImageBytes(
  bytes: Uint8Array,
  declaredMime: string,
  expectedWidth: number | undefined,
  expectedHeight: number | undefined,
  assetId: string
): { readonly ok: boolean; readonly error?: string } {
  if (bytes.length < 8) {
    return {
      ok: false,
      error: `Reference asset "${assetId}" buffer is too small to be a valid image.`
    };
  }

  const parsed = parseImageByteHeader(bytes);
  if (!parsed) {
    return {
      ok: false,
      error: `Reference asset "${assetId}" contains invalid or unrecognized image byte format.`
    };
  }

  if (declaredMime !== parsed.mimeType) {
    return {
      ok: false,
      error: `Reference asset "${assetId}" MIME type mismatch: declared "${declaredMime}", detected "${parsed.mimeType}".`
    };
  }

  if (parsed.width <= 0 || parsed.height <= 0) {
    return {
      ok: false,
      error: `Reference asset "${assetId}" must have positive dimensions.`
    };
  }

  if (expectedWidth !== undefined && parsed.width !== expectedWidth) {
    return {
      ok: false,
      error: `Reference asset "${assetId}" width mismatch: expected ${expectedWidth}, got ${parsed.width}.`
    };
  }

  if (expectedHeight !== undefined && parsed.height !== expectedHeight) {
    return {
      ok: false,
      error: `Reference asset "${assetId}" height mismatch: expected ${expectedHeight}, got ${parsed.height}.`
    };
  }

  return { ok: true };
}

export class PrepareSceneProductionInputsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly options?: PrepareSceneProductionInputsOptions
  ) {}

  async execute(
    input: PrepareSceneProductionInputsInput
  ): Promise<PrepareSceneProductionInputsResult> {
    return this.uow.execute((context) => this.executeWithContext(context, input));
  }

  async executeWithContext(
    context: UnitOfWorkContext,
    input: PrepareSceneProductionInputsInput
  ): Promise<PrepareSceneProductionInputsResult> {
    const dryRun = input.dryRun ?? false;
    const actionName = dryRun ? "inspectProductionInputs" : "queueForProduction";

    // 1. Fetch scene
    const scene = await context.scenes.findById(input.sceneId as SceneId);
    if (!scene) {
      throw new SceneNotFoundError(input.sceneId);
    }

    const snapshot = scene.snapshot();
    const blockers: ProductionBlocker[] = [];

    // 2. Validate Engine Profile
    const isMiniMax = isMiniMaxEngineOrProfile(snapshot.configuration.engineProfileId);
    if (!isMiniMax) {
      blockers.push({
        code: "UNSUPPORTED_ENGINE_PROFILE",
        message: `Scene engineProfileId "${snapshot.configuration.engineProfileId}" is not a MiniMax-H3 production profile.`
      });
    }

    if (!ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS.has(snapshot.configuration.engineProfileId)) {
      blockers.push({
        code: "UNREPRESENTABLE_ENGINE_PROFILE",
        message: `Engine profile "${snapshot.configuration.engineProfileId}" is not recognized for production.`
      });
    }

    const rawScene = snapshot as unknown as Record<string, unknown>;
    const rawConfig = snapshot.configuration as unknown as Record<string, unknown> | undefined;
    if (
      isMiniMax &&
      (rawScene.trim !== undefined ||
        rawScene.loop !== undefined ||
        rawConfig?.trim !== undefined ||
        rawConfig?.loop !== undefined)
    ) {
      blockers.push({
        code: "UNSUPPORTED_TRIM_OR_LOOP",
        message: `MiniMax-H3 does not support scene trim or loop controls.`
      });
    }

    // 3. Duration Quantization
    const durationResult = mapDurationMsToMiniMaxH3FrameCount(snapshot.configuration.durationMs);
    let targetDurationMs = snapshot.configuration.durationMs;
    let targetFrameCount = 124;
    if (!durationResult.ok) {
      blockers.push({
        code: "UNSUPPORTED_PRODUCTION_DURATION",
        message: durationResult.reason
      });
    } else {
      targetDurationMs = durationResult.achievedDurationMs;
      targetFrameCount = durationResult.frameCount;
    }

    // 4. Resolve Target ShotPlan
    const targetShotPlanId =
      input.shotPlanId ?? snapshot.selectedShotPlanId ?? snapshot.approvedShotPlanId;

    let shotPlanSnapshot: ShotPlanSnapshot | undefined;
    if (!targetShotPlanId) {
      blockers.push({
        code: "MISSING_SHOT_PLAN_SELECTION",
        message: `Scene "${scene.id}" has no selected or approved ShotPlan.`
      });
    } else {
      if (!context.shotPlans) {
        throw new Error("UnitOfWorkContext is missing shotPlans repository");
      }
      const shotPlanDomain = await context.shotPlans.findById(targetShotPlanId as ShotPlanId);
      if (!shotPlanDomain) {
        if (input.shotPlanId) {
          throw new ShotPlanNotFoundError(input.shotPlanId);
        }
        blockers.push({
          code: "SHOT_PLAN_NOT_FOUND",
          message: `ShotPlan "${targetShotPlanId}" was not found.`
        });
      } else {
        shotPlanSnapshot = shotPlanDomain.snapshot();
      }
    }

    // 5. Validate ShotPlan Association & Revision
    if (shotPlanSnapshot) {
      if (shotPlanSnapshot.sceneId !== scene.id) {
        blockers.push({
          code: "SHOT_PLAN_SCENE_MISMATCH",
          message: `ShotPlan "${shotPlanSnapshot.id}" belongs to scene "${shotPlanSnapshot.sceneId}", not "${scene.id}".`
        });
      }
      if (shotPlanSnapshot.specRevision !== snapshot.specRevision) {
        blockers.push({
          code: "STALE_SHOT_PLAN_REVISION",
          message: `ShotPlan specRevision (${shotPlanSnapshot.specRevision}) does not match scene specRevision (${snapshot.specRevision}).`
        });
      }
    }

    // 6. Routing Mode & RenderProfile
    const routingMode: ShotPlanRoutingMode =
      shotPlanSnapshot?.routingMode ?? snapshot.productionRoutingMode ?? "reference_directed";

    if (snapshot.productionRoutingMode && snapshot.productionRoutingMode !== routingMode) {
      blockers.push({
        code: "ROUTING_MODE_MISMATCH",
        message: `Scene productionRoutingMode (${snapshot.productionRoutingMode}) does not match ShotPlan routingMode (${routingMode}).`
      });
    }

    const renderProfileKey =
      routingMode === "frame_anchored"
        ? MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY
        : MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY;

    const workflowTemplate =
      routingMode === "frame_anchored"
        ? MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE
        : MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE;

    let canonicalRefs: readonly CanonicalReferenceEntry[] = [];
    const inspectedReferences: InspectedReferenceInput[] = [];
    let inspectedFrameAnchor: InspectedFrameAnchor | null = null;
    let compiledInstructionText = snapshot.configuration.prompt;
    let compiledInstructionSha256 =
      "0000000000000000000000000000000000000000000000000000000000000000";

    // 7. Route-Specific Conditioning Resolution
    // 7. Route-Specific Conditioning Resolution
    if (routingMode === "reference_directed") {
      if (!context.referenceAssets || !context.referenceAssets.listBindingsBySceneId) {
        if (!dryRun) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            "referenceAssets repository with listBindingsBySceneId is required in UnitOfWorkContext for reference-directed production."
          );
        }
        blockers.push({
          code: "MISSING_REPOSITORY",
          message:
            "referenceAssets repository with listBindingsBySceneId is required in UnitOfWorkContext for reference-directed production."
        });
      }

      if (!this.options?.objectStorage) {
        if (!dryRun) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            "objectStorage dependency is mandatory for reference-directed H3 admission."
          );
        }
        blockers.push({
          code: "MISSING_STORAGE_DEPENDENCY",
          message: "objectStorage dependency is mandatory for reference-directed H3 admission."
        });
      }

      if (!this.options?.hashBytes) {
        if (!dryRun) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            "hashBytes dependency is mandatory for reference-directed H3 admission."
          );
        }
        blockers.push({
          code: "MISSING_HASH_DEPENDENCY",
          message: "hashBytes dependency is mandatory for reference-directed H3 admission."
        });
      }

      const rawBindings = context.referenceAssets?.listBindingsBySceneId
        ? await context.referenceAssets.listBindingsBySceneId(scene.id as SceneId, {
            specRevision: snapshot.specRevision
          })
        : [];

      for (const b of rawBindings) {
        if (b.sceneId && b.sceneId !== scene.id) {
          const msg = `Reference binding for asset "${b.referenceAssetId}" belongs to scene "${b.sceneId}", which does not match scene "${scene.id}".`;
          if (!dryRun) {
            throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
          }
          blockers.push({
            code: "REFERENCE_BINDING_SCENE_MISMATCH",
            message: msg
          });
        }
        if (b.specRevision !== undefined && b.specRevision !== snapshot.specRevision) {
          const msg = `Reference binding for asset "${b.referenceAssetId}" has specRevision ${b.specRevision}, which does not match scene specRevision ${snapshot.specRevision}.`;
          if (!dryRun) {
            throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
          }
          blockers.push({
            code: "STALE_REFERENCE_BINDING_REVISION",
            message: msg
          });
        }
      }

      const rawAssets = context.referenceAssets
        ? await context.referenceAssets.listBySceneId(scene.id as SceneId, {
            specRevision: snapshot.specRevision
          })
        : [];
      const assetsById = new Map(rawAssets.map((a) => [a.id, a]));

      if (context.campaignReferenceBible) {
        const bibleEntries = await context.campaignReferenceBible.findByCampaignId(
          scene.campaignId
        );
        const bibleMap = new Map(bibleEntries.map((e) => [e.referenceAssetId.toLowerCase(), e]));

        for (const b of rawBindings) {
          if (b.role === "subject_identity" || b.role === "location") {
            const entry = bibleMap.get(b.referenceAssetId.toLowerCase());
            if (!entry) {
              const msg = `Asset "${b.referenceAssetId}" is bound to scene "${scene.id}" with role "${b.role}" but does not exist in campaign bible.`;
              if (!dryRun) {
                throw new StaleBibleBindingMismatchError(scene.id, b.referenceAssetId, msg);
              }
              blockers.push({
                code: "STALE_BIBLE_BINDING_MISMATCH",
                message: msg
              });
            } else if (entry.role !== b.role) {
              const msg = `Asset "${b.referenceAssetId}" is bound with role "${b.role}" in scene "${scene.id}", but campaign bible has role "${entry.role}".`;
              if (!dryRun) {
                throw new StaleBibleBindingMismatchError(scene.id, b.referenceAssetId, msg);
              }
              blockers.push({
                code: "STALE_BIBLE_BINDING_MISMATCH",
                message: msg
              });
            }
          }
        }

        for (const [id, asset] of assetsById.entries()) {
          const entry = bibleMap.get(id.toLowerCase());
          if (entry && (entry.role === "subject_identity" || entry.role === "location")) {
            assetsById.set(
              id,
              Object.freeze({
                ...asset,
                description: entry.description
              })
            );
          }
        }
      } else {
        const hasEligibleBindings = rawBindings.some(
          (b) => b.role === "subject_identity" || b.role === "location"
        );
        if (hasEligibleBindings) {
          const msg = `campaignReferenceBible repository is required in UnitOfWorkContext for scene "${scene.id}" with subject/location bindings.`;
          if (!dryRun) {
            throw new StaleBibleBindingMismatchError(scene.id, "", msg);
          }
          blockers.push({
            code: "STALE_BIBLE_BINDING_MISMATCH",
            message: msg
          });
        }
      }

      if (!context.campaigns) {
        if (!dryRun) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            "campaigns repository is required in UnitOfWorkContext for reference-directed H3 admission."
          );
        }
        blockers.push({
          code: "MISSING_REPOSITORY",
          message:
            "campaigns repository is required in UnitOfWorkContext for reference-directed H3 admission."
        });
      }
      const campaign = context.campaigns
        ? await context.campaigns.findById(scene.campaignId as CampaignId)
        : undefined;
      if (!campaign || !campaign.clientId) {
        const msg = `Campaign "${scene.campaignId}" not found or lacks clientId for scene "${scene.id}".`;
        if (!dryRun) {
          throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
        }
        blockers.push({
          code: "CAMPAIGN_CLIENT_ID_MISSING",
          message: msg
        });
      }
      const expectedClientId = campaign?.clientId ?? "";

      try {
        canonicalRefs = canonicalizeReferenceBindings({
          bindings: rawBindings,
          assetsById,
          expectedClientId,
          expectedSceneId: scene.id
        });
      } catch (err) {
        if (err instanceof ReferenceCanonicalizationError) {
          const msg = `Reference canonicalization failed: ${err.message}`;
          if (!dryRun) {
            throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
          }
          blockers.push({
            code: "REFERENCE_CANONICALIZATION_FAILED",
            message: msg
          });
        } else {
          throw err;
        }
      }

      // Verify each canonical reference asset bytes and hashes
      for (const ref of canonicalRefs) {
        if (ref.asset.clientId !== expectedClientId) {
          const msg = `Reference asset "${ref.referenceAssetId}" client "${ref.asset.clientId}" does not match scene campaign client "${expectedClientId}".`;
          if (!dryRun) {
            throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
          }
          blockers.push({
            code: "REFERENCE_CLIENT_MISMATCH",
            message: msg
          });
        }

        const refAssetSceneId = (ref.asset as { sceneId?: string }).sceneId;
        if (refAssetSceneId && refAssetSceneId !== scene.id) {
          const msg = `Reference asset "${ref.referenceAssetId}" belongs to scene "${refAssetSceneId}", which does not match scene "${scene.id}".`;
          if (!dryRun) {
            throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
          }
          blockers.push({
            code: "REFERENCE_ASSET_SCENE_MISMATCH",
            message: msg
          });
        }

        if (this.options?.objectStorage && this.options?.hashBytes) {
          const stored = await this.options.objectStorage.getObject(
            { bucket: ref.asset.storageBucket, key: ref.asset.storageObjectKey },
            { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
          );

          if (!stored || !stored.body || stored.body.byteLength === 0) {
            const msg = `Reference asset "${ref.referenceAssetId}" object "${ref.asset.storageObjectKey}" is missing or empty in storage.`;
            if (!dryRun) {
              throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
            }
            blockers.push({
              code: "MISSING_REFERENCE_MEDIA",
              message: msg
            });
          } else {
            const actualSha256 = await this.options.hashBytes.hashBytes(stored.body);
            if (actualSha256 !== ref.asset.contentHashSha256) {
              const msg = `Reference asset "${ref.referenceAssetId}" content hash mismatch: expected "${ref.asset.contentHashSha256}", got "${actualSha256}".`;
              if (!dryRun) {
                throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
              }
              blockers.push({
                code: "REFERENCE_HASH_MISMATCH",
                message: msg
              });
            }

            const declaredMime = ref.asset.mimeType ?? "image/png";
            if (this.options?.imageValidator) {
              try {
                const inspected = await this.options.imageValidator.inspectAndValidate(
                  stored.body,
                  declaredMime
                );
                if (ref.asset.width !== undefined && inspected.width !== ref.asset.width) {
                  const msg = `Reference asset "${ref.referenceAssetId}" width mismatch: expected ${ref.asset.width}, got ${inspected.width}.`;
                  if (!dryRun) {
                    throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
                  }
                  blockers.push({
                    code: "REFERENCE_DIMENSION_MISMATCH",
                    message: msg
                  });
                }
                if (ref.asset.height !== undefined && inspected.height !== ref.asset.height) {
                  const msg = `Reference asset "${ref.referenceAssetId}" height mismatch: expected ${ref.asset.height}, got ${inspected.height}.`;
                  if (!dryRun) {
                    throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
                  }
                  blockers.push({
                    code: "REFERENCE_DIMENSION_MISMATCH",
                    message: msg
                  });
                }
              } catch (err) {
                if (err instanceof InvalidTransitionError) throw err;
                const msg = `Reference asset "${ref.referenceAssetId}" media validation failed: ${(err as Error).message}`;
                if (!dryRun) {
                  throw new InvalidTransitionError(scene.id, scene.status, actionName, msg);
                }
                blockers.push({
                  code: "REFERENCE_MEDIA_VALIDATION_FAILED",
                  message: msg
                });
              }
            } else {
              const byteCheck = validateImageBytes(
                stored.body,
                declaredMime,
                ref.asset.width,
                ref.asset.height,
                ref.referenceAssetId
              );
              if (!byteCheck.ok && byteCheck.error) {
                if (!dryRun) {
                  throw new InvalidTransitionError(
                    scene.id,
                    scene.status,
                    actionName,
                    byteCheck.error
                  );
                }
                blockers.push({
                  code: "REFERENCE_MEDIA_VALIDATION_FAILED",
                  message: byteCheck.error
                });
              }
            }
          }
        }

        let previewUrl: string | null = null;
        let previewAvailability: "available" | "unavailable" = "unavailable";
        if (
          this.options?.mediaDelivery &&
          ref.asset.storageBucket &&
          ref.asset.storageObjectKey &&
          ref.asset.contentHashSha256
        ) {
          try {
            const url = await this.options.mediaDelivery.generatePresignedReadUrl({
              bucket: ref.asset.storageBucket,
              key: ref.asset.storageObjectKey,
              contentHash: ref.asset.contentHashSha256
            });
            if (url) {
              previewUrl = url;
              previewAvailability = "available";
            }
          } catch {
            // Non-fatal: thumbnail generation failure does not block production
          }
        }

        inspectedReferences.push({
          slotIndex: ref.slotIndex,
          promptTag: ref.promptTag,
          referenceAssetId: ref.referenceAssetId,
          displayName: ref.asset.displayName || ref.referenceAssetId.slice(0, 8),
          role: ref.role,
          contentHashSha256: ref.asset.contentHashSha256,
          previewUrl,
          previewAvailability
        });
      }

      // Compile ShotPlan instruction
      if (shotPlanSnapshot) {
        try {
          const compiled = compileShotPlan({
            shotPlan: shotPlanSnapshot,
            sceneSpec: {
              revision: snapshot.specRevision,
              actionContext: snapshot.configuration.prompt,
              scriptContext: (snapshot as { scriptContext?: string }).scriptContext
            },
            references: canonicalRefs,
            routingMode: "reference_directed",
            configuredDurationMs: targetDurationMs,
            allowUnapproved: dryRun
          });
          compiledInstructionText = compiled.instructionText;
          compiledInstructionSha256 = compiled.instructionHashSha256;
        } catch (err) {
          if (err instanceof ShotPlanCompilerError) {
            blockers.push({
              code: err.code,
              message: err.message
            });
          } else {
            throw err;
          }
        }
      }
    } else if (routingMode === "frame_anchored") {
      if (
        !shotPlanSnapshot?.continuity ||
        shotPlanSnapshot.continuity.frameAnchorTarget === "none"
      ) {
        blockers.push({
          code: "MISSING_FRAME_ANCHOR_TARGET",
          message: `ShotPlan "${shotPlanSnapshot?.id}" must specify a non-"none" frameAnchorTarget.`
        });
      } else if (shotPlanSnapshot.continuity.frameAnchorTarget !== "first_frame") {
        blockers.push({
          code: "UNSUPPORTED_FRAME_ANCHOR_TARGET",
          message: `ShotPlan "${shotPlanSnapshot.id}" specifies frameAnchorTarget "${shotPlanSnapshot.continuity.frameAnchorTarget}". Only "first_frame" is currently supported.`
        });
      }

      const anchorCandidateId = shotPlanSnapshot?.continuity?.anchorCandidateId;
      const anchorMediaHash = shotPlanSnapshot?.continuity?.anchorMediaHashSha256;

      if (!anchorCandidateId) {
        blockers.push({
          code: "MISSING_ANCHOR_CANDIDATE_ID",
          message: `Frame-anchored execution requires anchorCandidateId in ShotPlan continuity.`
        });
      }
      if (!anchorMediaHash) {
        blockers.push({
          code: "MISSING_ANCHOR_MEDIA_HASH",
          message: `Frame-anchored execution requires anchorMediaHashSha256 in ShotPlan continuity.`
        });
      }

      if (
        snapshot.selectedCandidateId &&
        anchorCandidateId &&
        anchorCandidateId !== snapshot.selectedCandidateId
      ) {
        blockers.push({
          code: "ANCHOR_CANDIDATE_MISMATCH",
          message: `ShotPlan anchorCandidateId "${anchorCandidateId}" does not match scene selectedCandidateId "${snapshot.selectedCandidateId}".`
        });
      }

      if (anchorCandidateId) {
        if (!context.candidates) {
          throw new Error("UnitOfWorkContext is missing candidates repository");
        }
        const candidate = await context.candidates.findById(anchorCandidateId as CandidateId);
        if (!candidate) {
          blockers.push({
            code: "ANCHOR_CANDIDATE_NOT_FOUND",
            message: `Authoritative frame candidate "${anchorCandidateId}" not found in candidate repository.`
          });
        } else {
          if (candidate.sceneId !== scene.id) {
            blockers.push({
              code: "ANCHOR_CANDIDATE_SCENE_MISMATCH",
              message: `Authoritative frame candidate "${anchorCandidateId}" belongs to scene "${candidate.sceneId}", not "${scene.id}".`
            });
          }
          if (candidate.specRevision !== snapshot.specRevision) {
            blockers.push({
              code: "STALE_ANCHOR_CANDIDATE_REVISION",
              message: `Authoritative frame candidate "${anchorCandidateId}" revision (${candidate.specRevision}) does not match scene specRevision (${snapshot.specRevision}).`
            });
          }
          if (anchorMediaHash && candidate.contentHash !== anchorMediaHash) {
            blockers.push({
              code: "ANCHOR_CANDIDATE_HASH_MISMATCH",
              message: `Authoritative frame candidate "${anchorCandidateId}" content hash "${candidate.contentHash}" does not match declared "${anchorMediaHash}".`
            });
          }

          if (this.options?.objectStorage && this.options?.hashBytes) {
            const stored = await this.options.objectStorage.getObject(
              { bucket: candidate.storageBucket, key: candidate.storageObjectKey },
              { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
            );
            if (!stored || !stored.body || stored.body.byteLength === 0) {
              blockers.push({
                code: "MISSING_ANCHOR_CANDIDATE_MEDIA",
                message: `Authoritative frame candidate "${anchorCandidateId}" object "${candidate.storageObjectKey}" is missing or empty in storage.`
              });
            } else {
              const actualSha256 = await this.options.hashBytes.hashBytes(stored.body);
              if (actualSha256 !== candidate.contentHash) {
                blockers.push({
                  code: "ANCHOR_MEDIA_HASH_MISMATCH",
                  message: `Authoritative frame candidate "${anchorCandidateId}" storage hash mismatch: expected "${candidate.contentHash}", got "${actualSha256}".`
                });
              }
            }
          }

          let previewUrl: string | null = null;
          let previewAvailability: "available" | "unavailable" = "unavailable";
          if (
            this.options?.mediaDelivery &&
            candidate.storageBucket &&
            candidate.storageObjectKey &&
            candidate.contentHash
          ) {
            try {
              const url = await this.options.mediaDelivery.generatePresignedReadUrl({
                bucket: candidate.storageBucket,
                key: candidate.storageObjectKey,
                contentHash: candidate.contentHash
              });
              if (url) {
                previewUrl = url;
                previewAvailability = "available";
              }
            } catch {
              // preview generation non-fatal
            }
          }

          inspectedFrameAnchor = {
            frameAnchorTarget: (shotPlanSnapshot?.continuity?.frameAnchorTarget ??
              "first_frame") as "first_frame",
            anchorCandidateId,
            anchorMediaHashSha256: anchorMediaHash ?? candidate.contentHash,
            previewUrl,
            previewAvailability
          };
        }
      }

      // Prompt for frame-anchored route
      compiledInstructionText = snapshot.configuration.prompt;
    }

    // 8. Evaluate Readiness Status
    let readiness: ProductionReadinessStatus;
    if (blockers.length > 0) {
      readiness = "blocked";
    } else if (
      snapshot.status !== "approved" ||
      !snapshot.approval ||
      snapshot.approval.revision !== snapshot.specRevision ||
      !shotPlanSnapshot ||
      shotPlanSnapshot.status !== "approved"
    ) {
      readiness = "awaiting_approval";
    } else {
      readiness = "ready";
    }

    // 9. Fail-Closed Real Dispatch Admission
    if (!dryRun) {
      if (!isMiniMax) {
        throw new UnrepresentableProductionConfigurationError(scene.id, ["engineProfileId"]);
      }
      if (!durationResult.ok) {
        throw new UnsupportedProductionDurationError(
          snapshot.configuration.durationMs,
          durationResult.reason
        );
      }
      if (snapshot.approval === undefined || snapshot.approval.revision !== snapshot.specRevision) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Production requires an approved SceneSpec at current revision ${snapshot.specRevision}.`
        );
      }
      if (!shotPlanSnapshot) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Production requires an approved current-revision ShotPlan for scene "${scene.id}".`
        );
      }
      if (shotPlanSnapshot.status !== "approved") {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `ShotPlan "${shotPlanSnapshot.id}" must be approved, got status "${shotPlanSnapshot.status}".`
        );
      }
      if (blockers.length > 0) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Production admission blocked (${blockers[0]?.code}): ${blockers[0]?.message}`
        );
      }
    }

    // 10. Structured Camera Intent Summary
    const cameraIntentSummary: CameraIntentSummary | undefined = shotPlanSnapshot
      ? {
          framing: shotPlanSnapshot.framing,
          angle: shotPlanSnapshot.angle,
          cameraMovement: shotPlanSnapshot.cameraMovement,
          movementSpeed: shotPlanSnapshot.movementSpeed,
          lensIntent: shotPlanSnapshot.lensIntent,
          cameraPosition: shotPlanSnapshot.cameraPosition,
          cameraPromptDescription: shotPlanSnapshot.cameraPromptDescription || undefined
        }
      : undefined;

    // 11. Compute Deterministic Input Fingerprint
    const productionInputFingerprint = computeProductionInputFingerprint({
      sceneId: scene.id,
      specRevision: snapshot.specRevision,
      shotPlanId: shotPlanSnapshot?.id ?? null,
      routingMode,
      renderProfileKey,
      workflowTemplate,
      targetDurationMs,
      targetFrameCount,
      fps: 24,
      width: 1344,
      height: 768,
      compiledInstructionText,
      compiledInstructionSha256,
      references: inspectedReferences,
      frameAnchor: inspectedFrameAnchor
    });

    const inspection: H3ProductionInspectionReadModel = {
      authority: {
        sceneId: scene.id,
        specRevision: snapshot.specRevision,
        shotPlanId: shotPlanSnapshot?.id ?? null,
        variantOrdinal: shotPlanSnapshot?.variantOrdinal ?? null,
        shotPlanStatus: shotPlanSnapshot?.status ?? null,
        isCurrentRevision: shotPlanSnapshot?.specRevision === snapshot.specRevision
      },
      route: {
        routingMode,
        renderProfileKey,
        workflowTemplate,
        targetDurationMs,
        targetFrameCount,
        fps: 24,
        width: 1344,
        height: 768
      },
      visualInputs: {
        references: inspectedReferences,
        frameAnchor: inspectedFrameAnchor
      },
      instruction: {
        compiledText: compiledInstructionText,
        compiledSha256: compiledInstructionSha256,
        cameraIntentSummary
      },
      admission: {
        readiness,
        blockers
      },
      runtimeContext: {
        durationCeilingSeconds: MINIMAX_H3_EXECUTION_CEILING_SECONDS
      },
      productionInputFingerprint
    };

    return {
      readiness,
      blockers,
      inspection,
      canonicalReferences: canonicalRefs,
      targetShotPlan: shotPlanSnapshot,
      durationResultOk: durationResult.ok,
      frameCount: targetFrameCount
    };
  }
}
