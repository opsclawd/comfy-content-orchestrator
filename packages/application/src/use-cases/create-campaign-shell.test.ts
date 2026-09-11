import { describe, expect, it } from "vitest";
import type { CreateCampaignShellRequest } from "@cco/contracts";
import type { CampaignId, CampaignShellRecord } from "@cco/domain";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
import { CampaignIdempotencyConflictError } from "./campaign-idempotency-conflict-error.js";
import { InvalidTargetDurationError } from "./invalid-target-duration-error.js";
import { InvalidSceneCountError } from "./invalid-scene-count-error.js";
import { InvalidSceneCountCombinationError } from "./invalid-scene-count-combination-error.js";
import { computeCampaignRequestHash } from "./campaign-request-hash.js";

describe("CreateCampaignShellUseCase", () => {
  const validRequest: CreateCampaignShellRequest = {
    idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
    clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
    title: "Summer Collection",
    targetPlatform: "tiktok",
    targetTotalDurationMs: 15000,
    sceneCountOverride: undefined
  };

  it("creates a campaign shell with derived scene count when no override is supplied", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const result = await useCase.execute(validRequest);

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.campaign.id).toBeDefined();
    expect(result.campaign.clientId).toBe(validRequest.clientId);
    expect(result.campaign.title).toBe(validRequest.title);
    expect(result.campaign.targetPlatform).toBe("tiktok");
    expect(result.campaign.status).toBe("drafting");
    expect(result.campaign.totalScenes).toBe(3); // 15_000 / 5_000 = 3
    expect(result.campaign.approvedScenes).toBe(0);
    expect(result.campaign.idempotencyKey).toBe(validRequest.idempotencyKey);
    expect(result.campaign.targetTotalDurationMs).toBe(15000);
    expect(uow.savedCampaigns).toHaveLength(1);
  });

  it("creates a campaign shell with authoritative scene count when valid override is supplied", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const result = await useCase.execute({
      ...validRequest,
      sceneCountOverride: 2
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.campaign.totalScenes).toBe(2);
    expect(uow.savedCampaigns).toHaveLength(1);
  });

  it("throws InvalidTargetDurationError before saving when duration is invalid", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    await expect(
      useCase.execute({
        ...validRequest,
        targetTotalDurationMs: 3000
      })
    ).rejects.toThrow(InvalidTargetDurationError);

    expect(uow.savedCampaigns).toHaveLength(0);
  });

  it("throws InvalidSceneCountError before saving when override is invalid", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    await expect(
      useCase.execute({
        ...validRequest,
        sceneCountOverride: 0
      })
    ).rejects.toThrow(InvalidSceneCountError);

    expect(uow.savedCampaigns).toHaveLength(0);
  });

  it("throws InvalidSceneCountCombinationError before saving for invalid combination (reviewer witness: 5000ms, 60 scenes)", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    await expect(
      useCase.execute({
        ...validRequest,
        targetTotalDurationMs: 5000,
        sceneCountOverride: 60
      })
    ).rejects.toThrow(InvalidSceneCountCombinationError);

    expect(uow.savedCampaigns).toHaveLength(0);
  });

  it("Auto-mode replay witness: retry with identical declared fields resumes shell with isIdempotentReplay: true", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    // Initial submission in Auto mode (sceneCountOverride: undefined)
    const firstResult = await useCase.execute(validRequest);
    expect(firstResult.isIdempotentReplay).toBe(false);
    expect(firstResult.campaign.totalScenes).toBe(3);
    expect(uow.savedCampaigns).toHaveLength(1);

    // Identical retry (lost response scenario)
    const secondResult = await useCase.execute(validRequest);
    expect(secondResult.isIdempotentReplay).toBe(true);
    expect(secondResult.campaign.id).toBe(firstResult.campaign.id);
    expect(secondResult.campaign.totalScenes).toBe(3);
    expect(secondResult.campaign.idempotencyKey).toBe(validRequest.idempotencyKey);
    // Ensure no second shell was created
    expect(uow.savedCampaigns).toHaveLength(1);
  });

  it("rejects idempotency key reuse with different payload with CampaignIdempotencyConflictError", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    await useCase.execute(validRequest);

    // Different title with same idempotencyKey
    await expect(
      useCase.execute({
        ...validRequest,
        title: "Completely Different Title"
      })
    ).rejects.toThrow(CampaignIdempotencyConflictError);

    // Different duration with same idempotencyKey
    await expect(
      useCase.execute({
        ...validRequest,
        targetTotalDurationMs: 20000
      })
    ).rejects.toThrow(CampaignIdempotencyConflictError);

    // Exactly 1 campaign created
    expect(uow.savedCampaigns).toHaveLength(1);
  });

  it("recovers from a concurrent duplicate race (23505 simulation) via a fresh read in execute()", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const hash = await computeCampaignRequestHash(validRequest);

    const winningCampaign: CampaignShellRecord = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as CampaignId,
      clientId: validRequest.clientId,
      title: validRequest.title,
      targetPlatform: validRequest.targetPlatform ?? "instagram_reels",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: validRequest.idempotencyKey,
      targetTotalDurationMs: validRequest.targetTotalDurationMs
    };

    // Simulate the concurrent race:
    // When the losing attempt calls findByIdempotencyKey, the winner hasn't committed yet (returns undefined).
    // When saveWithRequestHash is called, the winner has just committed and caused a unique constraint conflict (23505).
    let attempt = 0;
    uow.withBeforeSaveWithRequestHash((_campaign, _h) => {
      attempt++;
      uow.seedCampaignWithHash(winningCampaign, hash);
      throw new CampaignIdempotencyConflictError(validRequest.idempotencyKey);
    });

    // execute() catches CampaignIdempotencyConflictError and recovers the winner in a fresh read
    const result = await useCase.execute(validRequest);
    expect(attempt).toBe(1);
    expect(result.isIdempotentReplay).toBe(true);
    expect(result.campaign.id).toBe(winningCampaign.id);
  });

  it("rejects with CampaignIdempotencyConflictError when concurrent recovery read finds a different request hash (Finding 3)", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const winningCampaign: CampaignShellRecord = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as CampaignId,
      clientId: validRequest.clientId,
      title: "Conflicting Campaign By Another Client",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: validRequest.idempotencyKey,
      targetTotalDurationMs: validRequest.targetTotalDurationMs
    };

    const differentPayloadHash = "0".repeat(64);

    uow.withBeforeSaveWithRequestHash(() => {
      uow.seedCampaignWithHash(winningCampaign, differentPayloadHash);
      throw new CampaignIdempotencyConflictError(validRequest.idempotencyKey);
    });

    await expect(useCase.execute(validRequest)).rejects.toThrow(CampaignIdempotencyConflictError);
  });

  it("rejects with CampaignIdempotencyConflictError when concurrent recovery read finds no row (Finding 3)", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    uow.withBeforeSaveWithRequestHash(() => {
      // Losing insert encountered conflict, but winning transaction rolled back so fresh read finds no row
      throw new CampaignIdempotencyConflictError(validRequest.idempotencyKey);
    });

    await expect(useCase.execute(validRequest)).rejects.toThrow(CampaignIdempotencyConflictError);
  });

  it("resolves original campaign with archivedAt explicitly populated on identical retry of an archived shell (Finding 1)", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const firstResult = await useCase.execute(validRequest);
    expect(firstResult.isIdempotentReplay).toBe(false);

    // Simulate archiving the campaign
    const archivedAt = new Date().toISOString();
    const archivedCampaign: CampaignShellRecord = {
      ...firstResult.campaign,
      archivedAt
    };
    const hash = await computeCampaignRequestHash(validRequest);
    uow.seedCampaignWithHash(archivedCampaign, hash);

    const retryResult = await useCase.execute(validRequest);
    expect(retryResult.isIdempotentReplay).toBe(true);
    expect(retryResult.campaign.id).toBe(firstResult.campaign.id);
    expect(retryResult.campaign.archivedAt).toBe(archivedAt);
  });

  it("executeWithContext propagates conflict without attempting recovery (caller-managed transaction)", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    // Force conflict on saveWithRequestHash
    uow.withBeforeSaveWithRequestHash(() => {
      throw new CampaignIdempotencyConflictError(validRequest.idempotencyKey);
    });

    // When called directly inside an existing transaction, conflict propagates out
    await uow.execute(async (context) => {
      await expect(useCase.executeWithContext(context, validRequest)).rejects.toThrow(
        CampaignIdempotencyConflictError
      );
    });
  });
});
