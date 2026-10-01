import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
  type AcceptanceCampaignFixture,
  type ReferenceAssetResponse
} from "@cco/contracts";
import type { CampaignShellRecord, Scene } from "@cco/domain";
import type { AcceptanceFixtureAssetSourcePort } from "../ports/acceptance-fixture-asset-source-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/index.js";
import {
  AcceptanceFixtureIntegrityError,
  InstallAcceptanceCampaignFixtureUseCase
} from "./install-acceptance-campaign-fixture.js";
import type { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
import type { CreateSceneUseCase } from "./create-scene.js";
import type { UploadReferenceAssetUseCase } from "./upload-reference-asset.js";

/**
 * Minimal in-memory UnitOfWork fake backing `context.scenes.findByCampaignId`, so these
 * unit tests can exercise the same existing-scene lookup the real Postgres adapter performs
 * without needing a database.
 */
function buildInMemoryUow(scenesStore: Scene[]): UnitOfWork {
  return {
    execute: async <TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>) =>
      work({
        scenes: {
          findById: async () => undefined,
          save: async (scene: Scene) => {
            scenesStore.push(scene);
          },
          findByCampaignId: async () => scenesStore
        },
        reviewEvents: {} as UnitOfWorkContext["reviewEvents"],
        candidates: {} as UnitOfWorkContext["candidates"]
      } as unknown as UnitOfWorkContext)
  };
}

function buildReferenceAsset(id: string): ReferenceAssetResponse {
  return {
    id,
    clientId: "11111111-1111-1111-1111-111111111111",
    assetType: "image",
    storageBucket: "reference",
    storageObjectKey: `clients/x/references/${id}`,
    contentHashSha256: "a".repeat(64),
    mimeType: "image/jpeg",
    displayName: "fixture",
    libraryRole: "subject_identity",
    archivedAt: null,
    groupId: null,
    previewUrl: null,
    previewAvailability: "unavailable"
  } as ReferenceAssetResponse;
}

function buildCampaignRecord(): CampaignShellRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID() as CampaignShellRecord["id"],
    clientId: "11111111-1111-1111-1111-111111111111",
    title: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.title,
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 9,
    approvedScenes: 0,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: randomUUID(),
    targetTotalDurationMs: 45_000
  };
}

describe("InstallAcceptanceCampaignFixtureUseCase", () => {
  it("installs only reference-role asset slots and binds them into every scene's referenceBindings", async () => {
    const campaignRecord = buildCampaignRecord();
    let uploadCallCount = 0;
    const scenesStore: Scene[] = [];
    let createdCount = 0;

    const assetSource: AcceptanceFixtureAssetSourcePort = {
      loadAssetBytes: vi.fn(async (slot) => ({
        body: Buffer.from(`fixture-bytes-${slot.name}`),
        mimeType: slot.mimeType,
        sha256: slot.sha256
      }))
    };

    const uploadReferenceAssetUseCase = {
      execute: vi.fn(async () => {
        uploadCallCount += 1;
        return buildReferenceAsset(`ref-${uploadCallCount}`);
      })
    } as unknown as UploadReferenceAssetUseCase;

    const createCampaignShellUseCase = {
      execute: vi.fn(async () => ({ campaign: campaignRecord, isIdempotentReplay: false }))
    } as unknown as CreateCampaignShellUseCase;

    const createSceneUseCase = {
      execute: vi.fn(async (input) => {
        createdCount += 1;
        const scene = {
          id: randomUUID(),
          campaignId: input.campaignId,
          sequenceIndex: createdCount,
          snapshot: () => ({})
        } as unknown as Scene;
        scenesStore.push(scene);
        return scene;
      })
    } as unknown as CreateSceneUseCase;

    const useCase = new InstallAcceptanceCampaignFixtureUseCase({
      uow: buildInMemoryUow(scenesStore),
      createCampaignShellUseCase,
      createSceneUseCase,
      uploadReferenceAssetUseCase,
      assetSource
    });

    const result = await useCase.execute({
      clientId: "11111111-1111-1111-1111-111111111111",
      idempotencyKey: randomUUID()
    });

    // Exactly the 5 reference_role slots are uploaded; the 2 frame-anchor slots are not.
    expect(uploadReferenceAssetUseCase.execute).toHaveBeenCalledTimes(5);
    expect(result.referenceAssetsBySlot.size).toBe(5);
    expect(result.referenceAssetsBySlot.has("frameAnchorStart")).toBe(false);
    expect(result.referenceAssetsBySlot.has("frameAnchorEnd")).toBe(false);

    // Every one of the 9 scenes was created.
    expect(createSceneUseCase.execute).toHaveBeenCalledTimes(9);
    expect(result.scenes).toHaveLength(9);
    expect(result.campaign).toBe(campaignRecord);
    expect(result.fixtureId).toBe(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.fixtureId);
  });

  it("is idempotent across a real second install: no duplicate scenes are created", async () => {
    const campaignRecord = buildCampaignRecord();
    const scenesStore: Scene[] = [];
    let createdCount = 0;
    let uploadCount = 0;

    const assetSource: AcceptanceFixtureAssetSourcePort = {
      loadAssetBytes: vi.fn(async (slot) => ({
        body: Buffer.from("x"),
        mimeType: slot.mimeType,
        sha256: slot.sha256
      }))
    };

    const uploadReferenceAssetUseCase = {
      execute: vi.fn(async () => {
        uploadCount += 1;
        return buildReferenceAsset(`ref-${uploadCount}`);
      })
    } as unknown as UploadReferenceAssetUseCase;

    let shellCallCount = 0;
    const createCampaignShellUseCase = {
      execute: vi.fn(async () => {
        shellCallCount += 1;
        return { campaign: campaignRecord, isIdempotentReplay: shellCallCount > 1 };
      })
    } as unknown as CreateCampaignShellUseCase;

    const createSceneUseCase = {
      execute: vi.fn(async (input) => {
        createdCount += 1;
        const scene = {
          id: randomUUID(),
          campaignId: input.campaignId,
          sequenceIndex: createdCount,
          snapshot: () => ({})
        } as unknown as Scene;
        scenesStore.push(scene);
        return scene;
      })
    } as unknown as CreateSceneUseCase;

    const uow = buildInMemoryUow(scenesStore);
    const useCase = new InstallAcceptanceCampaignFixtureUseCase({
      uow,
      createCampaignShellUseCase,
      createSceneUseCase,
      uploadReferenceAssetUseCase,
      assetSource
    });

    const first = await useCase.execute({
      clientId: "11111111-1111-1111-1111-111111111111",
      idempotencyKey: campaignRecord.idempotencyKey
    });
    expect(first.isIdempotentReplay).toBe(false);
    expect(first.scenes).toHaveLength(9);
    expect(createSceneUseCase.execute).toHaveBeenCalledTimes(9);

    const second = await useCase.execute({
      clientId: "11111111-1111-1111-1111-111111111111",
      idempotencyKey: campaignRecord.idempotencyKey
    });

    expect(second.isIdempotentReplay).toBe(true);
    // The critical regression check: a second install must converge, not duplicate.
    expect(createSceneUseCase.execute).toHaveBeenCalledTimes(9);
    expect(second.scenes).toHaveLength(9);
    expect(scenesStore).toHaveLength(9);
    expect(second.scenes.map((s) => s.sequenceIndex).sort()).toEqual(
      first.scenes.map((s) => s.sequenceIndex).sort()
    );
  });

  it("fails closed when a fixture asset's live bytes do not match the pinned sha256", async () => {
    const assetSource: AcceptanceFixtureAssetSourcePort = {
      loadAssetBytes: vi.fn(async () => ({
        body: Buffer.from("drifted"),
        mimeType: "image/jpeg",
        sha256: "0".repeat(64)
      }))
    };

    const useCase = new InstallAcceptanceCampaignFixtureUseCase({
      uow: buildInMemoryUow([]),
      createCampaignShellUseCase: { execute: vi.fn() } as unknown as CreateCampaignShellUseCase,
      createSceneUseCase: { execute: vi.fn() } as unknown as CreateSceneUseCase,
      uploadReferenceAssetUseCase: { execute: vi.fn() } as unknown as UploadReferenceAssetUseCase,
      assetSource
    });

    await expect(
      useCase.execute({
        clientId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: randomUUID()
      })
    ).rejects.toThrow(AcceptanceFixtureIntegrityError);
  });

  it("fails closed before touching any dependency when coverage verification fails", async () => {
    const brokenCampaign: AcceptanceCampaignFixture = {
      ...ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
      scenes: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.map((scene, i) =>
        i === 0 ? { ...scene, coverageRequirementIds: ["R01"] } : scene
      )
    };

    const assetSource = { loadAssetBytes: vi.fn() } as unknown as AcceptanceFixtureAssetSourcePort;
    const uploadReferenceAssetUseCase = {
      execute: vi.fn()
    } as unknown as UploadReferenceAssetUseCase;

    const useCase = new InstallAcceptanceCampaignFixtureUseCase({
      uow: buildInMemoryUow([]),
      createCampaignShellUseCase: { execute: vi.fn() } as unknown as CreateCampaignShellUseCase,
      createSceneUseCase: { execute: vi.fn() } as unknown as CreateSceneUseCase,
      uploadReferenceAssetUseCase,
      assetSource
    });

    await expect(
      useCase.execute({
        clientId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: randomUUID(),
        campaign: brokenCampaign
      })
    ).rejects.toThrow(AcceptanceFixtureIntegrityError);

    expect(assetSource.loadAssetBytes).not.toHaveBeenCalled();
    expect(uploadReferenceAssetUseCase.execute).not.toHaveBeenCalled();
  });
});
