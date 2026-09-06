import { describe, expect, it } from "vitest";
import {
  toVideoStemOrder,
  type CampaignProductionRunSceneRecord
} from "./campaign-production-run.js";
import type { SceneId } from "./scene.js";

describe("CampaignProductionRun domain model", () => {
  describe("toVideoStemOrder", () => {
    it("maps 1-based sequenceIndex [1, 2, 3] to contiguous 0-based wire indices [0, 1, 2]", () => {
      const runScenes: CampaignProductionRunSceneRecord[] = [
        {
          runId: "run-1",
          sceneId: "scene-b" as SceneId,
          specRevision: 1,
          sequenceIndex: 2,
          expectedDurationMs: 4000
        },
        {
          runId: "run-1",
          sceneId: "scene-a" as SceneId,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4000
        },
        {
          runId: "run-1",
          sceneId: "scene-c" as SceneId,
          specRevision: 1,
          sequenceIndex: 3,
          expectedDurationMs: 4000
        }
      ];

      const mapping = toVideoStemOrder(runScenes);

      expect(mapping.get("scene-a")).toBe(0);
      expect(mapping.get("scene-b")).toBe(1);
      expect(mapping.get("scene-c")).toBe(2);
    });

    it("maps non-contiguous sequence indices (e.g. gaps) to contiguous 0-based positions", () => {
      const runScenes = [
        { sceneId: "scene-1", sequenceIndex: 10 },
        { sceneId: "scene-2", sequenceIndex: 30 },
        { sceneId: "scene-3", sequenceIndex: 20 }
      ];

      const mapping = toVideoStemOrder(runScenes);

      expect(mapping.get("scene-1")).toBe(0);
      expect(mapping.get("scene-3")).toBe(1);
      expect(mapping.get("scene-2")).toBe(2);
    });
  });
});
