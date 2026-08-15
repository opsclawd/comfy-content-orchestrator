import type { Scene, SceneId } from "@cco/domain";

export interface SceneRepository {
  findById(sceneId: SceneId): Promise<Scene | undefined>;
  save(scene: Scene): Promise<void>;
}
