import type { UnitOfWork } from "../ports/unit-of-work.js";

export class CompleteCampaignProductionRunAssemblyUseCases {
  constructor(private readonly uow: UnitOfWork) {}

  async onAssemblyJobCompleted(assemblyJobId: string): Promise<void> {
    await this.uow.execute(async (context) => {
      const runsRepo = context.campaignProductionRuns;
      if (!runsRepo) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      const run = await runsRepo.findByAssemblyJobId(assemblyJobId);
      if (run === undefined) {
        return;
      }

      const campaignsRepo = context.campaigns;
      if (!campaignsRepo || typeof campaignsRepo.transitionStatusIf !== "function") {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }
      const completedRun = await runsRepo.claimCompletion(run.id);
      if (completedRun !== undefined) {
        const transitioned = await campaignsRepo.transitionStatusIf(
          completedRun.campaignId,
          ["qa", "rendering", "queued"],
          "completed"
        );
        if (!transitioned) {
          const currentCampaign = await campaignsRepo.findById(completedRun.campaignId);
          if (currentCampaign?.status !== "completed") {
            throw new Error(
              `Failed to transition campaign ${completedRun.campaignId} status to completed (current status: ${currentCampaign?.status})`
            );
          }
        }
      }
    });
  }

  async onAssemblyJobFailed(assemblyJobId: string): Promise<void> {
    await this.uow.execute(async (context) => {
      const runsRepo = context.campaignProductionRuns;
      if (!runsRepo) {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }

      const run = await runsRepo.findByAssemblyJobId(assemblyJobId);
      if (run === undefined) {
        return;
      }

      const campaignsRepo = context.campaigns;
      if (!campaignsRepo || typeof campaignsRepo.transitionStatusIf !== "function") {
        throw new Error("UnitOfWorkContext is missing required campaign production repositories");
      }
      const failedRun = await runsRepo.claimFailure(run.id);
      if (failedRun !== undefined) {
        const transitioned = await campaignsRepo.transitionStatusIf(
          failedRun.campaignId,
          ["qa", "rendering", "queued"],
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
