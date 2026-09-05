import { describe, it, expect, vi } from "vitest";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
import {
  PlanSceneConfigurationUseCase,
  decidePlanningFallback
} from "./plan-scene-configuration.js";
import {
  PlanningNotAuthorizedError,
  PlanningSafetyRefusalError,
  PlanningProviderExhaustedError
} from "./plan-scene-configuration-errors.js";
import { SceneConfigurationValidationError } from "./validate-scene-configuration.js";
import type { CreativeBrief } from "./planning-prompt.js";

describe("PlanSceneConfigurationUseCase", () => {
  const testClientId = "client-alpha-123";
  const validAssetId1 = "11111111-1111-1111-1111-111111111111" as ReferenceAssetId;
  const validAssetId2 = "22222222-2222-2222-2222-222222222222" as ReferenceAssetId;
  const crossTenantAssetId = "33333333-3333-3333-3333-333333333333" as ReferenceAssetId;

  const resolvedAssets: ReferenceAsset[] = [
    {
      id: validAssetId1,
      clientId: testClientId,
      assetType: "brand_logo",
      storageBucket: "b",
      storageObjectKey: "k1",
      contentHashSha256: "h1"
    },
    {
      id: validAssetId2,
      clientId: testClientId,
      assetType: "style_lora",
      storageBucket: "b",
      storageObjectKey: "k2",
      contentHashSha256: "h2"
    }
  ];

  const testCampaignId = "campaign-secret-999";
  const brief: CreativeBrief = {
    title: "Summer Splash Launch",
    description: "Cinematic commercial intro with high energy",
    targetPlatform: "tiktok"
  };

  const validConfig = {
    prompt: "A cinematic shot of a refreshing beverage splashing with ice",
    referenceIds: [validAssetId1],
    engineProfileId: "LTX_25_720P_5S_V1",
    durationMs: 5000,
    loraConfigurationId: "summer-lora-v1"
  };

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

  function createMockRepo(assets: ReferenceAsset[]): ReferenceAssetRepository & {
    calledWithClientId: string | undefined;
    calledWithIds: readonly ReferenceAssetId[] | undefined;
  } {
    const repo = {
      calledWithClientId: undefined as string | undefined,
      calledWithIds: undefined as readonly ReferenceAssetId[] | undefined,
      listBySceneId: async () => [],
      findByIds: async (clientId: string, ids: readonly ReferenceAssetId[]) => {
        repo.calledWithClientId = clientId;
        repo.calledWithIds = ids;
        // only return assets where clientId matches
        return assets.filter((a) => a.clientId === clientId && ids.includes(a.id));
      }
    };
    return repo;
  }

  it("1. Happy path: Anthropic returns valid JSON referencing real resolved asset IDs and certified profile", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1, validAssetId2],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"],
        sensitiveDataMasking: true
      }
    });

    expect(result).toEqual(validConfig);
    expect(repo.calledWithClientId).toBe(testClientId);
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
  });

  it("2. allowCloudPlanning: false throws PlanningNotAuthorizedError without calling either client", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: false,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("3. allowedProviders missing 'Anthropic' throws PlanningNotAuthorizedError without calling either client", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["OpenAI"] // Anthropic missing
        }
      })
    ).rejects.toThrow("Anthropic not in allowedProviders");

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("4. allowedProviders contains 'Anthropic' but not 'OpenAI', Anthropic exhausted throws PlanningNotAuthorizedError at fallback boundary", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", message: "Timeout" },
      { kind: "retryable_failure", message: "Timeout 2" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"] // OpenAI omitted
        }
      })
    ).rejects.toThrow("OpenAI not in allowedProviders");

    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
  });

  it("5. sensitiveDataMasking: true masks campaignId in prompt and omits raw ID", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic"],
        sensitiveDataMasking: true
      }
    });

    expect(primary.calls).toHaveLength(1);
    const sentReq = primary.calls[0]!;
    expect(sentReq.userPrompt).not.toContain("campaign-secret-999");
    expect(sentReq.systemPrompt).not.toContain("campaign-secret-999");
    expect(sentReq.userPrompt).toContain("masked-campaign-");
  });

  it("6. Anthropic retryable_failure succeeds on second call without invoking OpenAI", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", httpStatus: 500, message: "Internal server error" },
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0);
  });

  it("7. Anthropic retryable_failure twice falls back to OpenAI and succeeds", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", httpStatus: 429, message: "Rate limit exceeded" },
      { kind: "retryable_failure", httpStatus: 429, message: "Rate limit exceeded again" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(1);
  });

  it("8. review witness scenario 2: Anthropic returns structurally invalid JSON (referenceIds not in resolved set) -> corrective retry -> still invalid -> falls back to OpenAI", async () => {
    const invalidConfig = {
      ...validConfig,
      referenceIds: ["99999999-9999-9999-9999-999999999999"]
    };

    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(invalidConfig) },
      { kind: "success", rawText: JSON.stringify(invalidConfig) } // corrective retry also returns invalid
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
    expect(primary.calls).toHaveLength(2);
    // second call should have received corrective feedback
    expect(primary.calls[1]!.userPrompt).toContain("not present in resolved reference assets");
    expect(fallback.calls).toHaveLength(1);
  });

  it("9. review witness scenario 3: Anthropic returns safety_refusal (403 refusal-classified) while OpenAI would succeed -> throws PlanningSafetyRefusalError and OpenAI is NEVER called", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      {
        kind: "safety_refusal",
        httpStatus: 403,
        message: "Content violates safety policy: cyber risk"
      }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningSafetyRefusalError);

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0); // Zero calls to fallback!
  });

  it("10. engineProfileId returned as 'not-a-certified-profile' is rejected by RenderProfileKeySchema and triggers corrective-retry / fallback", async () => {
    const uncertifiedProfileConfig = {
      ...validConfig,
      engineProfileId: "not-a-certified-profile"
    };

    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(uncertifiedProfileConfig) },
      { kind: "success", rawText: JSON.stringify(uncertifiedProfileConfig) }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
    expect(primary.calls).toHaveLength(2);
    expect(primary.calls[1]!.userPrompt).toContain("is not a certified profile");
    expect(fallback.calls).toHaveLength(1);
  });

  it("11. review witness scenario 1: referenceIds containing a syntactically valid but nonexistent UUID is excluded by findByIds and rejected by validation", async () => {
    const nonexistentUuid = "88888888-8888-8888-8888-888888888888" as ReferenceAssetId;
    const repo = createMockRepo(resolvedAssets); // only contains validAssetId1, validAssetId2

    // Both primary and fallback return the nonexistent UUID
    const badConfig = {
      ...validConfig,
      referenceIds: [nonexistentUuid]
    };

    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(badConfig) },
      { kind: "success", rawText: JSON.stringify(badConfig) }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(badConfig) },
      { kind: "success", rawText: JSON.stringify(badConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1, nonexistentUuid],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    expect(repo.calledWithClientId).toBe(testClientId);
  });

  it("12. design A8 witness: candidateReferenceAssetIds includes an asset belonging to a different client -> findByIds excludes it -> validation rejects it", async () => {
    const crossTenantAsset: ReferenceAsset = {
      id: crossTenantAssetId,
      clientId: "client-other-tenant",
      assetType: "brand_logo",
      storageBucket: "b",
      storageObjectKey: "k3",
      contentHashSha256: "h3"
    };

    // Repo contains both client assets and other client's asset
    const repo = createMockRepo([...resolvedAssets, crossTenantAsset]);

    const stolenAssetConfig = {
      ...validConfig,
      referenceIds: [crossTenantAssetId]
    };

    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(stolenAssetConfig) },
      { kind: "success", rawText: JSON.stringify(stolenAssetConfig) }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(stolenAssetConfig) },
      { kind: "success", rawText: JSON.stringify(stolenAssetConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId, // querying as testClientId
        candidateReferenceAssetIds: [validAssetId1, crossTenantAssetId],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    // Verify findByIds was called with testClientId
    expect(repo.calledWithClientId).toBe(testClientId);
  });

  it("13. Both providers exhausted on transport/validation throws PlanningProviderExhaustedError with attempts recorded for both", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", httpStatus: 503, message: "Service Unavailable" },
      { kind: "retryable_failure", httpStatus: 503, message: "Service Unavailable 2" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "retryable_failure", httpStatus: 500, message: "OpenAI Error 1" },
      { kind: "retryable_failure", httpStatus: 500, message: "OpenAI Error 2" }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    let caughtError: PlanningProviderExhaustedError | undefined;
    try {
      await useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      });
    } catch (e) {
      caughtError = e as PlanningProviderExhaustedError;
    }

    expect(caughtError).toBeInstanceOf(PlanningProviderExhaustedError);
    expect(caughtError?.attempts).toHaveLength(4);
    expect(caughtError?.attempts.map((a) => a.provider)).toEqual([
      "Anthropic",
      "Anthropic",
      "OpenAI",
      "OpenAI"
    ]);
  });

  it("14. JSON wrapped in a markdown code fence parses correctly and succeeds", async () => {
    const fencedJson = "```json\n" + JSON.stringify(validConfig) + "\n```";
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [{ kind: "success", rawText: fencedJson }]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
  });

  it("15. retryable_failure -> invalid success -> valid corrective success asserts three primary calls and zero fallback calls", async () => {
    const invalidConfig = {
      ...validConfig,
      referenceIds: ["99999999-9999-9999-9999-999999999999"]
    };

    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", httpStatus: 500, message: "Internal server error" },
      { kind: "success", rawText: JSON.stringify(invalidConfig) },
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
    expect(primary.calls).toHaveLength(3);
    expect(primary.calls[2]!.userPrompt).toContain("not present in resolved reference assets");
    expect(fallback.calls).toHaveLength(0);
  });

  it("16. swapped clients: primary is OpenAI and fallback is Anthropic throws PlanningNotAuthorizedError with zero calls made (policy allows Anthropic)", async () => {
    const repo = createMockRepo(resolvedAssets);
    const openAiPrimary = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const anthropicFallback = createMockClient("Anthropic", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: openAiPrimary,
      fallbackClient: anthropicFallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(openAiPrimary.calls).toHaveLength(0);
    expect(anthropicFallback.calls).toHaveLength(0);
  });

  it("17. swapped clients: primary is OpenAI and fallback is Anthropic throws PlanningNotAuthorizedError with zero calls made (policy allows both)", async () => {
    const repo = createMockRepo(resolvedAssets);
    const openAiPrimary = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const anthropicFallback = createMockClient("Anthropic", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: openAiPrimary,
      fallbackClient: anthropicFallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(openAiPrimary.calls).toHaveLength(0);
    expect(anthropicFallback.calls).toHaveLength(0);
  });

  it("18. misconfigured fallback client throws PlanningNotAuthorizedError with zero calls made", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const badFallback = createMockClient("Anthropic", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: badFallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(primary.calls).toHaveLength(0);
    expect(badFallback.calls).toHaveLength(0);
  });

  it("19. stalled primary connection times out and deterministically reaches fallback client", async () => {
    const repo = createMockRepo(resolvedAssets);
    // Primary client simulates stalled/never-resolving connection timing out
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", message: "Provider attempt timed out after 30ms" },
      { kind: "retryable_failure", message: "Provider attempt timed out after 30ms" }
    ]);
    // Fallback client succeeds
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback,
      overallTimeoutMs: 5000
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toBeDefined();
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(1);
  });

  it("20. stalled primary and fallback connections time out and reach PLANNING_PROVIDER_EXHAUSTED", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", message: "Primary timed out" },
      { kind: "retryable_failure", message: "Primary retry timed out" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "retryable_failure", message: "Fallback timed out" },
      { kind: "retryable_failure", message: "Fallback retry timed out" }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback,
      overallTimeoutMs: 5000
    });

    let caughtError: unknown;
    try {
      await useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PlanningProviderExhaustedError);
    const exhaustedErr = caughtError as PlanningProviderExhaustedError;
    expect(exhaustedErr.attempts).toHaveLength(4);
    expect(exhaustedErr.attempts[0]?.provider).toBe("Anthropic");
    expect(exhaustedErr.attempts[2]?.provider).toBe("OpenAI");
  });

  it("21. overall planning deadline expires and throws PlanningProviderExhaustedError", async () => {
    const repo = createMockRepo(resolvedAssets);
    // Client whose complete awaits until overall deadline fires
    const slowPrimary: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: vi.fn(async (req: PlanningModelRequest): Promise<PlanningModelOutcome> => {
        // Wait for request signal to abort
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) {
            resolve();
          } else {
            req.signal?.addEventListener("abort", () => resolve(), { once: true });
          }
        });
        return {
          kind: "retryable_failure",
          message: "Request aborted due to overall deadline"
        };
      })
    };
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: slowPrimary,
      fallbackClient: fallback,
      overallTimeoutMs: 30
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);
  });

  it("22. Anthropic permanent_failure on attempt 1 immediately falls back to OpenAI without retrying Anthropic", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "permanent_failure", httpStatus: 400, message: "Bad Request: schema malformed" }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result).toEqual(validConfig);
    expect(primary.calls).toHaveLength(1); // Never retried on same provider!
    expect(fallback.calls).toHaveLength(1); // Fell back to OpenAI
  });

  it("23. Anthropic safety_refusal on attempt 1 with non-403 status (e.g. HTTP 429 structured refusal) terminates immediately and never calls OpenAI", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      {
        kind: "safety_refusal",
        httpStatus: 429,
        message: "Rate limited and content policy violation: prompt blocked"
      }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningSafetyRefusalError);

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0); // OpenAI is NEVER called!
  });

  it("24. Anthropic safety_refusal on attempt 2 (e.g. HTTP 500 structured refusal) terminates immediately and never calls OpenAI", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", [
      { kind: "retryable_failure", httpStatus: 500, message: "Internal server error" },
      {
        kind: "safety_refusal",
        httpStatus: 500,
        message: "Internal error: prompt refused by safety filter"
      }
    ]);
    const fallback = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningSafetyRefusalError);

    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(0); // OpenAI is NEVER called!
  });

  it("25. model response with durationMs unequal to targetDurationMs triggers corrective retry and succeeds when corrected", async () => {
    const repo = createMockRepo(resolvedAssets);
    const wrongDurationConfig = { ...validConfig, durationMs: 4000 };
    const correctDurationConfig = { ...validConfig, durationMs: 5000 };

    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(wrongDurationConfig) },
      { kind: "success", rawText: JSON.stringify(correctDurationConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    const result = await useCase.execute({
      brief,
      campaignId: testCampaignId,
      clientId: testClientId,
      candidateReferenceAssetIds: [validAssetId1],
      targetDurationMs: 5000,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.durationMs).toBe(5000);
    expect(primary.calls).toHaveLength(2);
    expect(primary.calls[1]?.userPrompt).toContain(
      "durationMs 4000 does not match required targetDurationMs 5000"
    );
    expect(fallback.calls).toHaveLength(0);
  });

  it("26. targetDurationMs exceeding maxDurationMs throws SceneConfigurationValidationError synchronously without calling clients", async () => {
    const repo = createMockRepo(resolvedAssets);
    const primary = createMockClient("Anthropic", []);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        maxDurationMs: 4000,
        targetDurationMs: 5000,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(SceneConfigurationValidationError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("31. allowCloudPlanning: false throws PlanningNotAuthorizedError without calling findByIds, even if repository throws", async () => {
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

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: false,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(repoCalled).toBe(false);
    expect(repo.findByIds).not.toHaveBeenCalled();
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("32. repository lookup latency exceeding overallTimeoutMs exhausts deadline without calling model client", async () => {
    const repo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return resolvedAssets;
      })
    };
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback,
      overallTimeoutMs: 20
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        },
        overallTimeoutMs: 20
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("33. repository lookup rejection after overallTimeoutMs propagates original repository error without converting to PlanningProviderExhaustedError", async () => {
    class CustomDatabaseError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomDatabaseError";
      }
    }

    const repo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        throw new CustomDatabaseError("Post-deadline database connection dropped");
      })
    };
    const primary = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validConfig) }
    ]);
    const fallback = createMockClient("OpenAI", []);

    const useCase = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: repo,
      primaryClient: primary,
      fallbackClient: fallback,
      overallTimeoutMs: 20
    });

    await expect(
      useCase.execute({
        brief,
        campaignId: testCampaignId,
        clientId: testClientId,
        candidateReferenceAssetIds: [validAssetId1],
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        },
        overallTimeoutMs: 20
      })
    ).rejects.toThrow(CustomDatabaseError);

    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(0);
  });
});

describe("decidePlanningFallback", () => {
  it("maps success to terminal_success regardless of attempt number", () => {
    expect(decidePlanningFallback({ kind: "success", rawText: "{}" }, 1)).toBe("terminal_success");
    expect(decidePlanningFallback({ kind: "success", rawText: "{}" }, 2)).toBe("terminal_success");
  });

  it("maps safety_refusal to terminal_safety_refusal for all statuses and attempts", () => {
    expect(
      decidePlanningFallback({ kind: "safety_refusal", httpStatus: 403, message: "blocked" }, 1)
    ).toBe("terminal_safety_refusal");
    expect(
      decidePlanningFallback({ kind: "safety_refusal", httpStatus: 403, message: "blocked" }, 2)
    ).toBe("terminal_safety_refusal");
    expect(
      decidePlanningFallback({ kind: "safety_refusal", httpStatus: 429, message: "policy" }, 1)
    ).toBe("terminal_safety_refusal");
    expect(
      decidePlanningFallback({ kind: "safety_refusal", httpStatus: 500, message: "refusal" }, 1)
    ).toBe("terminal_safety_refusal");
  });

  it("maps retryable_failure to retry_same on attempt 1, fallback on attempt 2", () => {
    expect(
      decidePlanningFallback({ kind: "retryable_failure", httpStatus: 500, message: "error" }, 1)
    ).toBe("retry_same");
    expect(
      decidePlanningFallback({ kind: "retryable_failure", httpStatus: 500, message: "error" }, 2)
    ).toBe("fallback");
  });

  it("maps permanent_failure to fallback on attempt 1 and attempt 2 (no same-provider retry)", () => {
    expect(
      decidePlanningFallback({ kind: "permanent_failure", httpStatus: 400, message: "invalid" }, 1)
    ).toBe("fallback");
    expect(
      decidePlanningFallback(
        { kind: "permanent_failure", httpStatus: 401, message: "unauthorized" },
        2
      )
    ).toBe("fallback");
  });
});
