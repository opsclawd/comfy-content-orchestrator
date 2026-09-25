import { describe, expect, it, vi } from "vitest";
import { ReferenceAssetNotFoundError, type ReferenceAssetId } from "@cco/domain";
import type { ReferenceAssetRepository } from "../ports/index.js";
import { ArchiveReferenceAssetUseCase } from "./archive-reference-asset.js";

describe("ArchiveReferenceAssetUseCase", () => {
  const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const referenceId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId;

  it("successfully archives active owned asset", async () => {
    const archiveSpy = vi.fn().mockResolvedValue(true);
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      archive: archiveSpy
    };

    const useCase = new ArchiveReferenceAssetUseCase(repo);
    await expect(useCase.execute({ clientId, referenceId })).resolves.toBeUndefined();
    expect(archiveSpy).toHaveBeenCalledWith(clientId, referenceId);
  });

  it("throws ReferenceAssetNotFoundError if repository archive returns false", async () => {
    const archiveSpy = vi.fn().mockResolvedValue(false);
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      archive: archiveSpy
    };

    const useCase = new ArchiveReferenceAssetUseCase(repo);
    await expect(useCase.execute({ clientId, referenceId })).rejects.toThrow(
      ReferenceAssetNotFoundError
    );
  });
});
