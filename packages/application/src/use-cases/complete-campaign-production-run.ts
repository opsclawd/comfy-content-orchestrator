import type { PersistentMediaRef } from "@cco/contracts";
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
      const manifestRepo = context.generationManifests;
      if (
        !campaignsRepo ||
        typeof campaignsRepo.transitionStatusIf !== "function" ||
        !manifestRepo ||
        typeof manifestRepo.findVideoStemSourceByJobId !== "function"
      ) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      // Check that this job has a resolvable manifest; if missing or invalid, do not throw, but treat as not review-ready
      let source:
        | {
            readonly generationManifestId: string;
            readonly media: PersistentMediaRef;
            readonly renderAttempt?: number;
          }
        | undefined;
      try {
        source = await manifestRepo.findVideoStemSourceByJobId(jobId);
      } catch {
        return;
      }

      if (source === undefined) {
        return;
      }

      // Observation query: if any sibling jobs in the run are still incomplete, do not claim production review
      const incompleteCount = await runsRepo.countIncompleteRunScenes(runScene.runId);
      if (incompleteCount > 0) {
        return;
      }

      // Atomic single-row conditional claim: exactly one concurrent caller succeeds
      const claimedRun = await runsRepo.claimForProductionReview(runScene.runId);
      if (claimedRun === undefined) {
        return;
      }

      // Monotonically advance campaign status to "qa" (production review ready).
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
