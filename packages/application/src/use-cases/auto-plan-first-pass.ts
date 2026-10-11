import type { SceneId } from "@cco/domain";
import type { ShotPlanPlanningAdmissionPort } from "../ports/shot-plan-planning-admission-port.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

export interface AutoPlanFirstPassLogger {
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
  info?(message: string, ...args: unknown[]): void;
}

export interface AutoPlanFirstPassShotPlansInput {
  readonly sceneId: SceneId | string;
  readonly uow: UnitOfWork;
  readonly coordinator?: ShotPlanPlanningAdmissionPort | undefined;
  readonly logger?: AutoPlanFirstPassLogger | undefined;
}

export interface AutoPlanFirstPassResult {
  readonly triggered: boolean;
  readonly reason?: string | undefined;
}

/**
 * Narrow auto-planning helper that checks whether a committed scene is eligible
 * for first-pass shot plan generation.
 *
 * Eligible conditions:
 * 1. Scene exists and its status is strictly 'draft_pending'.
 * 2. Scene has at least one active reference binding for its current specRevision.
 * 3. Scene has zero ShotPlans for its current specRevision.
 *
 * When eligible, invokes the existing asynchronous admission coordinator (prepareAdmission)
 * outside the database transaction, omitting reroll.
 *
 * If planning is unconfigured or encounters an error, the error is logged and caught so that
 * the preceding reference-binding transaction is never rolled back.
 */
export async function triggerFirstPassShotPlanningIfEligible(
  input: AutoPlanFirstPassShotPlansInput
): Promise<AutoPlanFirstPassResult> {
  const { sceneId, uow, coordinator, logger } = input;
  if (!coordinator) {
    logger?.warn?.(
      `First-pass shot-plan auto-trigger skipped for scene '${sceneId}': planning coordinator is not configured`
    );
    return { triggered: false, reason: "coordinator_not_configured" };
  }

  try {
    // Step 1: In a short transaction, reload and verify eligibility
    let check: { eligible: true; sceneId: SceneId } | { eligible: false; reason: string };
    try {
      check = await uow.execute(async (context) => {
        const scene = await context.scenes.findById(sceneId as SceneId);
        if (!scene) {
          return { eligible: false, reason: "scene_not_found" } as const;
        }

        // Must be draft_pending (prevents triggering on reviewed, approved, or in-flight scenes)
        if (scene.status !== "draft_pending") {
          return { eligible: false, reason: "not_draft_pending" } as const;
        }

        // Must have at least one active reference binding for current specRevision
        let activeBindingsCount = 0;
        if (context.referenceAssets?.listBindingsBySceneId) {
          const bindings = await context.referenceAssets.listBindingsBySceneId(scene.id, {
            specRevision: scene.specRevision
          });
          activeBindingsCount = bindings.filter((b) => !b.archivedAt).length;
        }

        if (activeBindingsCount === 0 && scene.configuration.referenceBindings) {
          activeBindingsCount = scene.configuration.referenceBindings.filter(
            (b) => !b.archivedAt && b.specRevision === scene.specRevision
          ).length;
        }

        if (
          activeBindingsCount === 0 &&
          scene.configuration.referenceIds &&
          scene.configuration.referenceIds.length > 0
        ) {
          activeBindingsCount = scene.configuration.referenceIds.length;
        }

        if (activeBindingsCount === 0) {
          return { eligible: false, reason: "no_active_reference_bindings" } as const;
        }

        // Must have no ShotPlans for this scene at the current specRevision (first-pass on fresh scene only; never auto-regenerate scenes that already have plans)
        if (context.shotPlans) {
          const existingPlans = await context.shotPlans.listBySceneAndRevision(
            scene.id,
            scene.specRevision
          );
          if (existingPlans.length > 0) {
            return { eligible: false, reason: "has_existing_shot_plans" } as const;
          }
        }

        return {
          eligible: true,
          sceneId: scene.id
        } as const;
      });
    } catch (err) {
      logger?.warn?.(
        `First-pass shot-plan eligibility check failed for scene '${sceneId}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { triggered: false, reason: "eligibility_error" };
    }

    if (!check.eligible) {
      return { triggered: false, reason: check.reason };
    }

    // Step 2: Outside DB transaction, invoke existing asynchronous admission path
    try {
      await coordinator.prepareAdmission({
        sceneId: check.sceneId
      });
      return { triggered: true };
    } catch (err) {
      logger?.warn?.(
        `First-pass shot-plan auto-trigger failed for scene '${sceneId}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { triggered: false, reason: "admission_error" };
    }
  } catch (err) {
    logger?.warn?.(
      `First-pass shot-plan auto-trigger unexpected failure for scene '${sceneId}': ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { triggered: false, reason: "auto_planning_failed" };
  }
}
