import { describe, expect, it, vi } from "vitest";
import type { CreativeBrief } from "@cco/contracts";
import type {
  CampaignId,
  CampaignRecord,
  ClientRecord,
  ReferenceAsset,
  ReferenceAssetId
} from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ClientNotFoundError } from "./client-not-found-error.js";
import {
  PlanningNotAuthorizedError,
  PlanningProviderExhaustedError,
  PlanningSafetyRefusalError
} from "./plan-scene-configuration-errors.js";
import { PlanCampaignBeatSheetUseCase } from "./plan-campaign-beat-sheet.js";
import { CampaignBeatSheetValidationError } from "./validate-campaign-beat-sheet.js";

describe("PlanCampaignBeatSheetUseCase", () => {
  const testClientId = "client-test-123";
  const testCampaignId = "campaign-test-456";
  const validAssetId1 = "11111111-1111-1111-1111-111111111111" as ReferenceAssetId;

  const cloudEnabledPolicy = {
    allowCloudPlanning: true,
    allowedProviders: ["Anthropic", "OpenAI"],
    sensitiveDataMasking: true
  };

  const cloudDisabledPolicy = {
    allowCloudPlanning: false,
    allowedProviders: [],
    sensitiveDataMasking: true
  };

  const brief: CreativeBrief = {
    title: "10s Product Launch Teaser",
    description: "High-energy commercial intro launching revolutionary electric scooter",
    targetPlatform: "tiktok"
  };

  const valid3BeatPayload = {
    beats: [
      {
        ordinal: 1,
        brief: {
          title: "Opening Reveal",
          description: "Close-up of scooter headlight igniting in dark studio"
        },
        targetDurationMs: 2500
      },
      {
        ordinal: 2,
        brief: {
          title: "Action Ride",
          description: "Scooter accelerating through illuminated city boulevard"
        },
        targetDurationMs: 5000
      },
      {
        ordinal: 3,
        brief: {
          title: "Logo & Price",
          description: "Static lockup with sleek branding and call to action"
        },
        targetDurationMs: 2500
      }
    ]
  };

  function createSeededUow(
    policy: Record<string, unknown> = cloudEnabledPolicy,
    totalScenes = 3
  ): InMemorySceneUnitOfWork {
    const campaign: CampaignRecord = {
      id: testCampaignId as CampaignId,
      clientId: testClientId,
      title: "Scooter Launch",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes,
      approvedScenes: 0,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };

    const client: ClientRecord = {
      id: testClientId,
      companyName: "Velocity Mobility",
      brandBibleJson: {},
      defaultAspectRatio: "9:16",
      externalProcessingPolicy: policy,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };

    return new InMemorySceneUnitOfWork([], [], [], [campaign], [client]);
  }

  function createMockClient(
    providerName: "Anthropic" | "OpenAI",
    outcomes: PlanningModelOutcome[]
  ): PlanningModelClientPort & { calls: PlanningModelRequest[] } {
    let callIndex = 0;
    const calls: PlanningModelRequest[] = [];
    return {
      providerName,
      calls,
      complete: vi.fn(async (req: PlanningModelRequest): Promise<PlanningModelOutcome> => {
        calls.push(req);
        const outcome = outcomes[callIndex] ??
          outcomes[outcomes.length - 1] ?? {
            kind: "retryable_failure",
            message: "exhausted"
          };
        callIndex++;
        return outcome;
      })
    };
  }

  function createMockRepo(assets: ReferenceAsset[] = []): ReferenceAssetRepository {
    return {
      listBySceneId: async () => [],
      findByIds: async (clientId: string, ids: readonly ReferenceAssetId[]) =>
        assets.filter((a) => a.clientId === clientId && ids.includes(a.id))
    };
  }

  it("1. Happy path: Anthropic produces valid beat sheet with exactly campaign.totalScenes beats summing to targetTotalDurationMs", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(valid3BeatPayload) }
    ]);
    const fallback = createMockClient("OpenAI", []);
    const repo = createMockRepo();

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      campaignId: testCampaignId,
      brief,
      targetTotalDurationMs: 10000,
      candidateReferenceAssetIds: [validAssetId1]
    });

    expect(result.campaignId).toBe(testCampaignId);
    expect(result.targetTotalDurationMs).toBe(10000);
    expect(result.beats).toHaveLength(3);
    expect(result.beats[0]?.ordinal).toBe(1);
    expect(result.beats[1]?.ordinal).toBe(2);
    expect(result.beats[2]?.ordinal).toBe(3);
    expect(result.beats.reduce((sum, b) => sum + b.targetDurationMs, 0)).toBe(10000);

    // Primary was called once, OpenAI was not called
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);

    // Verify prompt had totalScenes=3 and targetTotalDurationMs=10000
    expect(primary.calls[0]?.systemPrompt).toContain("beats: array of exactly 3 scene beats");
    expect(primary.calls[0]?.systemPrompt).toContain("MUST equal exactly 10000 ms");

    // Invariant: no scenes created, no campaigns modified
    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.savedCampaigns).toHaveLength(0);
  });

  it("2. allowCloudPlanning disabled throws PlanningNotAuthorizedError fail-closed with zero model calls", async () => {
    const uow = createSeededUow(cloudDisabledPolicy, 3);
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("3. safety_refusal terminates immediately as PlanningSafetyRefusalError without falling over", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const primary = createMockClient("Anthropic", [
      { kind: "safety_refusal", httpStatus: 403, message: "Safety refusal: content restricted" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(valid3BeatPayload) }
    ]);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000
      })
    ).rejects.toThrow(PlanningSafetyRefusalError);

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0); // NEVER fail over on safety refusal!
  });

  it("4. malformed output triggers corrective retry on same client and succeeds when corrected", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    // First attempt: invalid beat count (2 instead of 3)
    const invalidBeatsPayload = {
      beats: [valid3BeatPayload.beats[0], valid3BeatPayload.beats[1]]
    };

    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(invalidBeatsPayload) },
      { kind: "success", rawText: JSON.stringify(valid3BeatPayload) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      campaignId: testCampaignId,
      brief,
      targetTotalDurationMs: 10000
    });

    expect(result.beats).toHaveLength(3);
    expect(primary.calls).toHaveLength(2);
    expect(primary.calls[1]?.userPrompt).toContain(
      "beats array must contain exactly 3 beats, got 2"
    );
    expect(fallback.calls).toHaveLength(0);
  });

  it("5. primary fails twice with corrective retry -> falls back to OpenAI and succeeds", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    // Invalid duration sum (9000 instead of 10000)
    const wrongSumPayload = {
      beats: [
        { ...valid3BeatPayload.beats[0], targetDurationMs: 2000 },
        valid3BeatPayload.beats[1],
        valid3BeatPayload.beats[2]
      ]
    };

    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(wrongSumPayload) },
      { kind: "success", rawText: JSON.stringify(wrongSumPayload) }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(valid3BeatPayload) }
    ]);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      campaignId: testCampaignId,
      brief,
      targetTotalDurationMs: 10000
    });

    expect(result.beats).toHaveLength(3);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(1);
  });

  it("6. both providers exhausted throws PlanningProviderExhaustedError", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", message: "Server overloaded" },
      { kind: "retryable_failure", message: "Server overloaded" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "retryable_failure", message: "OpenAI rate limited" },
      { kind: "retryable_failure", message: "OpenAI rate limited" }
    ]);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(2);
  });

  it("7. throws CampaignNotFoundError when campaign does not exist", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        campaignId: "nonexistent-campaign",
        brief,
        targetTotalDurationMs: 10000
      })
    ).rejects.toThrow(CampaignNotFoundError);
  });

  it("8. throws ClientNotFoundError when client does not exist", async () => {
    const campaign: CampaignRecord = {
      id: testCampaignId as CampaignId,
      clientId: "nonexistent-client",
      title: "Scooter Launch",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };
    const uow = new InMemorySceneUnitOfWork([], [], [], [campaign], []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: createMockClient("Anthropic", []),
      fallbackClient: createMockClient("OpenAI", [])
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000
      })
    ).rejects.toThrow(ClientNotFoundError);
  });

  it("9. validates targetTotalDurationMs is positive integer before resolving", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: createMockRepo(),
      primaryClient: createMockClient("Anthropic", []),
      fallbackClient: createMockClient("OpenAI", [])
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 0
      })
    ).rejects.toThrow(CampaignBeatSheetValidationError);

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 5000.5
      })
    ).rejects.toThrow(CampaignBeatSheetValidationError);
  });

  it("10. allowCloudPlanning disabled throws PlanningNotAuthorizedError without calling findByIds, even if repository throws", async () => {
    const uow = createSeededUow(cloudDisabledPolicy, 3);
    let repoCalled = false;
    const repo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: vi.fn(async () => {
        repoCalled = true;
        throw new Error("Repository failure");
      })
    };
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(repoCalled).toBe(false);
    expect(repo.findByIds).not.toHaveBeenCalled();
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("11. repository lookup latency exceeding overallTimeoutMs exhausts deadline without calling model client", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const repo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return [];
      })
    };
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(valid3BeatPayload) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback,
      overallTimeoutMs: 20
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000,
        overallTimeoutMs: 20
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("12. targetTotalDurationMs < campaign.totalScenes throws CampaignBeatSheetValidationError without repository or provider calls", async () => {
    const uow = createSeededUow(cloudEnabledPolicy, 5);
    let repoCalled = false;
    const repo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: vi.fn(async () => {
        repoCalled = true;
        return [];
      })
    };
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 4
      })
    ).rejects.toThrow(CampaignBeatSheetValidationError);

    expect(repoCalled).toBe(false);
    expect(repo.findByIds).not.toHaveBeenCalled();
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("13. repository lookup rejection after overallTimeoutMs propagates original repository error without converting to PlanningProviderExhaustedError", async () => {
    class CustomDatabaseError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomDatabaseError";
      }
    }

    const uow = createSeededUow(cloudEnabledPolicy, 3);
    const repo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        throw new CustomDatabaseError("Post-deadline database connection dropped");
      })
    };
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(valid3BeatPayload) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback,
      overallTimeoutMs: 20
    });

    await expect(
      useCase.execute({
        campaignId: testCampaignId,
        brief,
        targetTotalDurationMs: 10000,
        overallTimeoutMs: 20
      })
    ).rejects.toThrow(CustomDatabaseError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });
});
