import { ReferenceAssetNotFoundError, type ReferenceAssetId } from "@cco/domain";
import type { ReferenceAssetRepository } from "../ports/index.js";

export interface ArchiveReferenceAssetInput {
  readonly clientId: string;
  readonly referenceId: ReferenceAssetId;
}

export class ArchiveReferenceAssetUseCase {
  constructor(private readonly referenceAssetRepository: ReferenceAssetRepository) {}

  async execute(input: ArchiveReferenceAssetInput): Promise<void> {
    if (!this.referenceAssetRepository.archive) {
      throw new Error("ReferenceAssetRepository does not support archiving");
    }

    const archived = await this.referenceAssetRepository.archive(input.clientId, input.referenceId);
    if (!archived) {
      throw new ReferenceAssetNotFoundError(input.referenceId);
    }
  }
}
