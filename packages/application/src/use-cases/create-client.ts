import { randomUUID } from "node:crypto";
import type { ClientRecord } from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";

// Default policy matching Postgres schema column default in 001_baseline.sql:90-96
export const DEFAULT_EXTERNAL_PROCESSING_POLICY: Readonly<Record<string, unknown>> = Object.freeze({
  allowCloudPlanning: true,
  allowCloudVisualQA: true,
  allowCloudVoice: true,
  allowedProviders: ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
  sensitiveDataMasking: true
});

export const DEFAULT_ASPECT_RATIO = "9:16";

export interface CreateClientInput {
  readonly companyName: string;
  readonly brandBibleJson?: Record<string, unknown> | undefined;
  readonly defaultAspectRatio?: string | undefined;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
}

export class CreateClientUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: CreateClientInput): Promise<ClientRecord> {
    return this.uow.execute(async (context) => {
      if (context.clients === undefined) {
        throw new Error(
          "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
        );
      }
      const now = new Date().toISOString();
      const record: ClientRecord = {
        id: randomUUID(),
        companyName: input.companyName,
        brandBibleJson: input.brandBibleJson ?? {},
        defaultAspectRatio: input.defaultAspectRatio ?? DEFAULT_ASPECT_RATIO,
        externalProcessingPolicy: input.externalProcessingPolicy ?? {
          ...DEFAULT_EXTERNAL_PROCESSING_POLICY
        },
        createdAt: now,
        updatedAt: now
      };
      await context.clients.save(record);
      return record;
    });
  }
}
