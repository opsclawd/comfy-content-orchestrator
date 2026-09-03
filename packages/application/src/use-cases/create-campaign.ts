import { randomUUID } from "node:crypto";
import type { CampaignId, CampaignRecord } from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";

export interface CreateCampaignInput {
  readonly clientId: string;
  readonly title: string;
  readonly targetPlatform?: string | undefined;
  readonly totalScenes?: number | undefined;
}

export class CreateCampaignUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: CreateCampaignInput): Promise<CampaignRecord> {
    return this.uow.execute(async (context) => {
      if (context.campaigns === undefined) {
        throw new Error(
          "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
        );
      }
      const now = new Date().toISOString();
      const record: CampaignRecord = {
        id: randomUUID() as CampaignId,
        clientId: input.clientId,
        title: input.title,
        targetPlatform: input.targetPlatform ?? "instagram_reels",
        status: "drafting",
        totalScenes: input.totalScenes ?? 1,
        approvedScenes: 0,
        createdAt: now,
        updatedAt: now
      };
      await context.campaigns.save(record);
      return record;
    });
  }
}
