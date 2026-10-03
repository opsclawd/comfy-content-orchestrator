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
      const targetRun = completedRun ?? (run.status === "completed" ? run : undefined);
      if (targetRun !== undefined) {
        const transitioned = await campaignsRepo.transitionStatusIf(
          targetRun.campaignId,
          ["qa", "rendering", "queued", "failed"],
          "completed"
        );
        if (!transitioned) {
          const currentCampaign = await campaignsRepo.findById(targetRun.campaignId);
          if (currentCampaign?.status !== "completed") {
            throw new Error(
              `Failed to transition campaign ${targetRun.campaignId} status to completed (current status: ${currentCampaign?.status})`
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
      const targetRun = failedRun ?? (run.status === "failed" ? run : undefined);
      if (targetRun !== undefined) {
        const transitioned = await campaignsRepo.transitionStatusIf(
          targetRun.campaignId,
          ["qa", "rendering", "queued", "failed"],
          "failed"
        );
        if (!transitioned) {
          const currentCampaign = await campaignsRepo.findById(targetRun.campaignId);
          if (currentCampaign?.status !== "failed") {
            throw new Error(
              `Failed to transition campaign ${targetRun.campaignId} status to failed (current status: ${currentCampaign?.status})`
            );
          }
        }
      }
    });
  }
}
