import type { CampaignProductionRunSceneRecord, SceneId } from "@cco/domain";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { computeCampaignProductionRunFingerprint } from "./campaign-production-fingerprint.js";
import type { EnqueueSceneProductionRenderUseCase } from "./enqueue-scene-production-render.js";
import {
  applySceneApprovalToScene,
  type ApproveSceneInput,
  type ReviewExecutionResult
} from "./review-scene.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export class ApproveSceneAndDispatchCampaignProductionUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly enqueueSceneProductionRender: EnqueueSceneProductionRenderUseCase
  ) {}

  async execute(input: ApproveSceneInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const scenesRepo = context.scenes;
      const campaignsRepo = context.campaigns;
      const runsRepo = context.campaignProductionRuns;
      if (
        typeof scenesRepo.findCampaignIdBySceneId !== "function" ||
        typeof scenesRepo.findByCampaignId !== "function" ||
        !campaignsRepo ||
        typeof campaignsRepo.transitionStatusIf !== "function" ||
        !runsRepo
      ) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      // 1. Lock-free campaign ID resolution to determine target campaign row
      const campaignId = await scenesRepo.findCampaignIdBySceneId(input.sceneId as SceneId);
      if (campaignId === undefined) {
        throw new SceneNotFoundError(input.sceneId);
      }

      // 2. Lock the parent campaign row FIRST among all row locks in this transaction
      const campaign = await campaignsRepo.findByIdForUpdate(campaignId);
      if (campaign === undefined) {
        throw new CampaignNotFoundError(campaignId);
      }

      // 3. Lock all scenes in the campaign in canonical scene_order
      const scenes = await scenesRepo.findByCampaignId(campaignId, { forUpdate: true });

      // 4. Locate target scene within the already-locked set (no separate findById call)
      const targetScene = scenes.find((s) => s.id === input.sceneId);
      if (targetScene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
      }

      const approvalResult = await applySceneApprovalToScene(context, targetScene, input);
      if (approvalResult.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: targetScene.snapshot()
        };
      }

      // 5. Derive readiness from live scene state in memory
      const ready =
        scenes.length === campaign.totalScenes &&
        scenes.every((scene) => scene.status === "approved");

      // 6. If not ready, update UI projection counter if changed and return
      if (!ready) {
        const approvedCount = scenes.filter((s) => s.status === "approved").length;
        if (campaign.approvedScenes !== approvedCount) {
          await campaignsRepo.save({
            ...campaign,
            approvedScenes: approvedCount
          });
        }
        return {
          isIdempotentReplay: false,
          scene: targetScene.snapshot()
        };
      }

      // 7. If ready, create production run and fan out jobs per scene
      const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const expectedTotalDurationMs = sortedScenes.reduce(
        (sum, s) => sum + s.snapshot().configuration.durationMs,
        0
      );

      const fingerprintEntries = sortedScenes.map((s) => ({
        sceneId: s.id,
        specRevision: s.snapshot().specRevision,
        sequenceIndex: s.sequenceIndex
      }));
      const fingerprint = computeCampaignProductionRunFingerprint(campaignId, fingerprintEntries);

      const { run, created } = await runsRepo.createIfAbsent({
        campaignId,
        fingerprint,
        status: "dispatched",
        expectedTotalDurationMs
      });

      if (created) {
        const runScenesToInsert: CampaignProductionRunSceneRecord[] = [];
        for (const scene of sortedScenes) {
          const renderResult = await this.enqueueSceneProductionRender.executeWithContext(context, {
            sceneId: scene.id
          });
          runScenesToInsert.push({
            runId: run.id,
            sceneId: scene.id,
            specRevision: scene.snapshot().specRevision,
            sequenceIndex: scene.sequenceIndex,
            expectedDurationMs: scene.snapshot().configuration.durationMs,
            productionJobId: renderResult.job.jobId
          });
        }
        await runsRepo.insertRunScenes(run.id, runScenesToInsert);
      }

      // 8. Monotonically progress campaign status projection to "queued"
      const approvedCount = scenes.length;
      const transitioned = await campaignsRepo.transitionStatusIf(
        campaignId,
        "drafting",
        "queued",
        { approvedScenes: approvedCount }
      );
      if (!transitioned) {
        const currentCampaign = await campaignsRepo.findById(campaignId);
        if (currentCampaign?.status !== "queued") {
          throw new Error(
            `Failed to transition campaign ${campaignId} status from drafting to queued (current status: ${currentCampaign?.status})`
          );
        }
      }

      return {
        isIdempotentReplay: false,
        scene: targetScene.snapshot()
      };
    });
  }
}
