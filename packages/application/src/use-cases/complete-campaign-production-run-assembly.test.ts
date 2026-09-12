import { describe, expect, it, vi } from "vitest";
import type { CampaignId, CampaignProductionRunRecord, CampaignRecord } from "@cco/domain";
import type { CampaignProductionRunRepository, CampaignRepository, UnitOfWork } from "../index.js";
import { CompleteCampaignProductionRunAssemblyUseCases } from "./complete-campaign-production-run-assembly.js";

describe("CompleteCampaignProductionRunAssemblyUseCases", () => {
  it("transitions campaign to completed on assembly job completion", async () => {
    const campaign: CampaignRecord = {
      id: "camp-1" as CampaignId,
      clientId: "client-1",
      title: "Test Campaign",
      targetPlatform: "tiktok",
      status: "qa",
      totalScenes: 2,
      approvedScenes: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const run: CampaignProductionRunRecord = {
      id: "run-1",
      campaignId: "camp-1" as CampaignId,
      fingerprint: "fp-1",
      status: "assembling",
      expectedTotalDurationMs: 8000,
      assemblyJobId: "assembly-job-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const completedRun: CampaignProductionRunRecord = {
      ...run,
      status: "completed"
    };

    let currentCampaign: CampaignRecord = campaign;
    const savedCampaigns: CampaignRecord[] = [];
    const mockCampaigns: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(async () => currentCampaign),
      findByIdForUpdate: vi.fn(async () => currentCampaign),
      save: vi.fn(async (c) => {
        savedCampaigns.push(c);
        currentCampaign = c;
      }),
      transitionStatusIf: vi.fn(async (_id, _from, to) => {
        currentCampaign = { ...currentCampaign, status: to };
        savedCampaigns.push(currentCampaign);
        return true;
      })
    };

    const mockRuns: CampaignProductionRunRepository = {
      findByAssemblyJobId: vi.fn(async () => run),
      claimCompletion: vi.fn(async () => completedRun),
      createIfAbsent: vi.fn(),
      insertRunScenes: vi.fn(),
      findById: vi.fn(),
      findRunScenes: vi.fn(async () => []),
      findRunSceneByProductionJobId: vi.fn(),
      countIncompleteRunScenes: vi.fn(async () => 0),
      claimForProductionReview: vi.fn(),
      claimForAssembly: vi.fn(),
      setAssemblyJobId: vi.fn(),
      claimFailure: vi.fn()
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({ campaigns: mockCampaigns, campaignProductionRuns: mockRuns })
      )
    };

    const useCases = new CompleteCampaignProductionRunAssemblyUseCases(mockUow);
    await useCases.onAssemblyJobCompleted("assembly-job-123");

    expect(mockRuns.claimCompletion).toHaveBeenCalledWith("run-1");
    expect(savedCampaigns).toHaveLength(1);
    expect(savedCampaigns[0]?.status).toBe("completed");
  });

  it("transitions campaign to failed on assembly job failure", async () => {
    const campaign: CampaignRecord = {
      id: "camp-1" as CampaignId,
      clientId: "client-1",
      title: "Test Campaign",
      targetPlatform: "tiktok",
      status: "qa",
      totalScenes: 2,
      approvedScenes: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const run: CampaignProductionRunRecord = {
      id: "run-1",
      campaignId: "camp-1" as CampaignId,
      fingerprint: "fp-1",
      status: "assembling",
      expectedTotalDurationMs: 8000,
      assemblyJobId: "assembly-job-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const failedRun: CampaignProductionRunRecord = {
      ...run,
      status: "failed"
    };

    let currentCampaign: CampaignRecord = campaign;
    const savedCampaigns: CampaignRecord[] = [];
    const mockCampaigns: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(async () => currentCampaign),
      findByIdForUpdate: vi.fn(async () => currentCampaign),
      save: vi.fn(async (c) => {
        savedCampaigns.push(c);
        currentCampaign = c;
      }),
      transitionStatusIf: vi.fn(async (_id, _from, to) => {
        currentCampaign = { ...currentCampaign, status: to };
        savedCampaigns.push(currentCampaign);
        return true;
      })
    };

    const mockRuns: CampaignProductionRunRepository = {
      findByAssemblyJobId: vi.fn(async () => run),
      claimFailure: vi.fn(async () => failedRun),
      createIfAbsent: vi.fn(),
      insertRunScenes: vi.fn(),
      findById: vi.fn(),
      findRunScenes: vi.fn(async () => []),
      findRunSceneByProductionJobId: vi.fn(),
      countIncompleteRunScenes: vi.fn(async () => 0),
      claimForProductionReview: vi.fn(),
      claimForAssembly: vi.fn(),
      setAssemblyJobId: vi.fn(),
      claimCompletion: vi.fn()
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({ campaigns: mockCampaigns, campaignProductionRuns: mockRuns })
      )
    };

    const useCases = new CompleteCampaignProductionRunAssemblyUseCases(mockUow);
    await useCases.onAssemblyJobFailed("assembly-job-123");

    expect(mockRuns.claimFailure).toHaveBeenCalledWith("run-1");
    expect(savedCampaigns).toHaveLength(1);
    expect(savedCampaigns[0]?.status).toBe("failed");
  });
});
