import type { CampaignId, Scene, SceneId } from "@cco/domain";

export interface SceneRepository {
  findById(sceneId: SceneId): Promise<Scene | undefined>;
  save(scene: Scene): Promise<void>;
  findByCampaignId?(
    campaignId: CampaignId,
    options?: { readonly forUpdate?: boolean }
  ): Promise<Scene[]>;
  /**
   * Lock-free lookup to discover the owning campaignId from a sceneId before taking any row locks.
   * Callers must not treat this as a substitute for the locked findByCampaignId read that follows it.
   */
  findCampaignIdBySceneId?(sceneId: SceneId): Promise<CampaignId | undefined>;
}
