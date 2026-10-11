import type { SceneId, SceneStatus } from "@cco/domain";

export interface ShotPlanPlanningAdmissionInput {
  readonly sceneId: SceneId | string;
  readonly variantCount?: number | undefined;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
  readonly overallTimeoutMs?: number | undefined;
  readonly enqueuePrevisJobs?: boolean | undefined;
  readonly reroll?: boolean | undefined;
}

export interface ShotPlanPlanningAdmissionResultPort {
  readonly kind: "replay" | "admitted";
  readonly sceneId: SceneId | string;
  readonly status: SceneStatus;
  readonly specRevision: number;
}

export interface ShotPlanPlanningAdmissionPort {
  prepareAdmission(
    input: ShotPlanPlanningAdmissionInput
  ): Promise<ShotPlanPlanningAdmissionResultPort>;
}
