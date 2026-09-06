import type { VideoStemRef } from "@cco/contracts";
import { toVideoStemOrder } from "@cco/domain";
import { validateAssemblySpec, type AssemblySpec } from "../ports/assembly-spec.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

export class CompleteCampaignProductionRunUseCases {
  constructor(private readonly uow: UnitOfWork) {}

  async onProductionJobStarted(jobId: string): Promise<void> {
    await this.uow.execute(async (context) => {
      const runsRepo = context.campaignProductionRuns;
      if (!runsRepo) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      const runScene = await runsRepo.findRunSceneByProductionJobId(jobId);
      if (runScene === undefined) {
        return;
      }

      const campaignsRepo = context.campaigns;
      if (!campaignsRepo || typeof campaignsRepo.transitionStatusIf !== "function") {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      const run = await runsRepo.findById(runScene.runId);
      if (run === undefined) {
        return;
      }
      await campaignsRepo.transitionStatusIf(run.campaignId, "queued", "rendering");
    });
  }

  async onProductionJobCompleted(jobId: string): Promise<void> {
    await this.uow.execute(async (context) => {
      const runsRepo = context.campaignProductionRuns;
      if (!runsRepo) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      const runScene = await runsRepo.findRunSceneByProductionJobId(jobId);
      if (runScene === undefined) {
        return;
      }

      const campaignsRepo = context.campaigns;
      const assemblyJobsRepo = context.assemblyJobs;
      const manifestRepo = context.generationManifests;
      if (
        !campaignsRepo ||
        typeof campaignsRepo.transitionStatusIf !== "function" ||
        !assemblyJobsRepo ||
        !manifestRepo ||
        typeof manifestRepo.findVideoStemSourceByJobId !== "function"
      ) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      // Observation query: if any sibling jobs in the run are still incomplete, do not claim assembly
      const incompleteCount = await runsRepo.countIncompleteRunScenes(runScene.runId);
      if (incompleteCount > 0) {
        return;
      }

      // Atomic single-row conditional claim: exactly one concurrent caller succeeds
      const claimedRun = await runsRepo.claimForAssembly(runScene.runId);
      if (claimedRun === undefined) {
        return;
      }

      const runScenes = await runsRepo.findRunScenes(claimedRun.id);
      const orderMap = toVideoStemOrder(runScenes);

      const videoStems: VideoStemRef[] = [];
      const sortedRunScenes = [...runScenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      for (const scene of sortedRunScenes) {
        if (!scene.productionJobId) {
          throw new Error(`Run scene ${scene.sceneId} has no productionJobId`);
        }
        const source = await manifestRepo.findVideoStemSourceByJobId(scene.productionJobId);
        if (source === undefined) {
          throw new Error(
            `Generation manifest source not found for production job ${scene.productionJobId}`
          );
        }

        const stemOrder = orderMap.get(scene.sceneId);
        if (stemOrder === undefined) {
          throw new Error(`Failed to resolve stem order for scene ${scene.sceneId}`);
        }

        videoStems.push({
          sceneId: scene.sceneId,
          generationManifestId: source.generationManifestId,
          order: stemOrder,
          media: source.media,
          expectedDurationMs: scene.expectedDurationMs
        });
      }

      const assemblySpec: AssemblySpec = {
        campaignId: claimedRun.campaignId,
        videoStems,
        assemblyProfile: {
          key: "VERTICAL_REEL_1080X1920_V1",
          version: 1
        },
        expectedTotalDurationMs: claimedRun.expectedTotalDurationMs,
        subtitleCues: []
      };

      validateAssemblySpec(assemblySpec);

      const assemblyJob = await assemblyJobsRepo.enqueue({
        campaignId: claimedRun.campaignId,
        assemblySpec
      });

      // Associate enqueued assembly job using assemblyJob.jobId
      await runsRepo.setAssemblyJobId(claimedRun.id, assemblyJob.jobId);

      // Monotonically advance campaign status to "qa" (assembly in flight).
      // Catch up from legal lagging predecessors (queued or rendering).
      const transitioned = await campaignsRepo.transitionStatusIf(
        claimedRun.campaignId,
        ["rendering", "queued"],
        "qa"
      );
      if (!transitioned) {
        const currentCampaign = await campaignsRepo.findById(claimedRun.campaignId);
        if (currentCampaign?.status !== "qa") {
          throw new Error(
            `Failed to transition campaign ${claimedRun.campaignId} status to qa (current status: ${currentCampaign?.status})`
          );
        }
      }
    });
  }

  async onProductionJobFailed(jobId: string): Promise<void> {
    await this.uow.execute(async (context) => {
      const runsRepo = context.campaignProductionRuns;
      if (!runsRepo) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      const runScene = await runsRepo.findRunSceneByProductionJobId(jobId);
      if (runScene === undefined) {
        return;
      }

      const campaignsRepo = context.campaigns;
      if (!campaignsRepo || typeof campaignsRepo.transitionStatusIf !== "function") {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }
      const failedRun = await runsRepo.claimFailure(runScene.runId);
      if (failedRun !== undefined) {
        const transitioned = await campaignsRepo.transitionStatusIf(
          failedRun.campaignId,
          ["queued", "rendering", "drafting"],
          "failed"
        );
        if (!transitioned) {
          const currentCampaign = await campaignsRepo.findById(failedRun.campaignId);
          if (currentCampaign?.status !== "failed") {
            throw new Error(
              `Failed to transition campaign ${failedRun.campaignId} status to failed (current status: ${currentCampaign?.status})`
            );
          }
        }
      }
    });
  }
}
