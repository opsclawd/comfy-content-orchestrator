import type { SceneId, ShotPlan, ShotPlanId } from "@cco/domain";

export interface ShotPlanRepository {
  findById(shotPlanId: ShotPlanId): Promise<ShotPlan | undefined>;
  save(shotPlan: ShotPlan): Promise<void>;
  saveMany(shotPlans: readonly ShotPlan[]): Promise<void>;
  listBySceneAndRevision(sceneId: SceneId, specRevision: number): Promise<readonly ShotPlan[]>;
  listByScene(sceneId: SceneId): Promise<readonly ShotPlan[]>;
}
