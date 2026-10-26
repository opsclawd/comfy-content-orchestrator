import { describe, expect, it } from "vitest";
import {
  CampaignDurationPlanningError,
  type CreateCampaignShellRequest,
  type H3CandidateProfile,
  type StagingCandidateProfileSelection
} from "@cco/contracts";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
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
      targetTotalDurationMs: 10000,
      sceneCountOverride: 2
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.campaign.totalScenes).toBe(2);
    expect(uow.savedCampaigns).toHaveLength(1);
  });

  it("throws CampaignDurationPlanningError before saving when override cannot be feasibly allocated", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    // 15s with 2 scenes cannot be satisfied with 5s-only legacy profile (max ~11s for 2 stems)
    await expect(
      useCase.execute({
        ...validRequest,
        targetTotalDurationMs: 15000,
        sceneCountOverride: 2
      })
    ).rejects.toThrow("No feasible duration allocation found");

    expect(uow.savedCampaigns).toHaveLength(0);
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

  it("rejects idempotency key reuse when creative brief is altered", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const initialRequest = {
      ...validRequest,
      brief: {
        description: "Initial creative brief"
      }
    };
    await useCase.execute(initialRequest);

    // Altered brief with same idempotencyKey
    await expect(
      useCase.execute({
        ...validRequest,
        brief: {
          description: "Altered creative brief"
        }
      })
    ).rejects.toThrow(CampaignIdempotencyConflictError);
  });

  it("rejects idempotency key reuse when candidateReferenceAssetIds are altered", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const initialRequest = {
      ...validRequest,
      candidateReferenceAssetIds: ["asset-1", "asset-2"]
    };
    await useCase.execute(initialRequest);

    // Altered assets with same idempotencyKey
    await expect(
      useCase.execute({
        ...validRequest,
        candidateReferenceAssetIds: ["asset-1", "asset-3"]
      })
    ).rejects.toThrow(CampaignIdempotencyConflictError);
  });

  it("replays successfully when candidateReferenceAssetIds are canonically equivalent", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const initialRequest = {
      ...validRequest,
      candidateReferenceAssetIds: ["asset-2", "asset-1"]
    };
    const firstResult = await useCase.execute(initialRequest);
    expect(firstResult.isIdempotentReplay).toBe(false);

    // Same assets, reordered and with duplicates
    const replayResult = await useCase.execute({
      ...validRequest,
      candidateReferenceAssetIds: ["asset-1", "asset-2", "asset-1"]
    });
    expect(replayResult.isIdempotentReplay).toBe(true);
    expect(replayResult.campaign.id).toBe(firstResult.campaign.id);
  });

  it("rejects idempotency key reuse when scope is altered", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const initialRequest = {
      ...validRequest,
      scope: "production" as const
    };
    await useCase.execute(initialRequest);

    await expect(
      useCase.execute({
        ...validRequest,
        scope: "staging" as const
      })
    ).rejects.toThrow(CampaignIdempotencyConflictError);
  });

  it("rejects idempotency key reuse when allowedProfileSelections are altered", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    const initialRequest = {
      ...validRequest,
      allowedProfileSelections: [
        {
          kind: "legacy_production" as const,
          profileKey: "MINIMAX_H3_720P_5S_I2V_V1" as const,
          version: 1
        }
      ]
    };
    await useCase.execute(initialRequest);

    await expect(
      useCase.execute({
        ...validRequest,
        allowedProfileSelections: [
          {
            kind: "legacy_production" as const,
            profileKey: "MINIMAX_H3_720P_5S_REF2V_V1" as const,
            version: 1
          }
        ]
      })
    ).rejects.toThrow(CampaignIdempotencyConflictError);
  });

  it("rejects conflicting profile selectors with typed error", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignShellUseCase(uow);

    await expect(
      useCase.execute({
        ...validRequest,
        targetEngineProfileId: "MINIMAX_H3_720P_5S_I2V_V1",
        selectedProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1"
      })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  describe("staging candidate capability resolution and principal scoping (issue #426, AC-14)", () => {
    const candidateKey = `H3_CANDIDATE_${"b".repeat(32)}_V1`;
    const stagingCandidateSelection = {
      kind: "staging_candidate" as const,
      profileKey: candidateKey,
      specificationDigest: "b".repeat(64),
      targetId: "target-gpu-1",
      authorizationId: "auth-1"
    };
    const candidateProfile = {
      key: candidateKey,
      version: 1,
      specificationDigest: "b".repeat(64),
      specification: {
        route: "ref2v",
        routingMode: "reference_directed",
        width: 1280,
        height: 720,
        fps: 24,
        frames: 124
      },
      status: "candidate"
      // Remaining H3CandidateExecutionSpecification fields are not read by
      // resolveH3ProfileFrameCapabilities and are intentionally omitted from this fake.
    } as unknown as H3CandidateProfile;

    function makeStagingAuthSource() {
      const calls: Array<string | undefined> = [];
      return {
        calls,
        listAuthorizedCandidates: async (principal?: string) => {
          calls.push(principal);
          return [stagingCandidateSelection];
        },
        resolveCandidateGrant: async () => undefined
      };
    }

    it("passes the input principal through to listAuthorizedCandidates", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const stagingAuthSource = makeStagingAuthSource();
      const useCase = new CreateCampaignShellUseCase(uow, { stagingAuthSource });

      // No registryReader is configured, so capability resolution fails closed after
      // listAuthorizedCandidates has already been called with the principal — that call is
      // what this test verifies.
      await expect(
        useCase.execute({
          ...validRequest,
          principal: "alice",
          executionProfileSelection: stagingCandidateSelection,
          allowedProfileSelections: [stagingCandidateSelection]
        })
      ).rejects.toThrow(CampaignDurationPlanningError);

      expect(stagingAuthSource.calls).toContain("alice");
      expect(stagingAuthSource.calls.every((p) => p === "alice")).toBe(true);
    });

    it("resolves candidate frame capability from a configured registryReader instead of the always-empty shared catalog", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const stagingAuthSource = makeStagingAuthSource();
      const registryReader = {
        getCandidateProfile: (key: string | undefined) =>
          key === candidateKey ? candidateProfile : undefined,
        listCandidateProfiles: () => [candidateProfile]
      };
      const useCase = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource,
        registryReader
      });

      // 180 frames at 24fps is well outside the legacy 124-frame allowlist, so this can only
      // succeed if the real candidate specification (via registryReader) backs the feasibility
      // check — the always-empty static catalog would resolve no capability at all here.
      const result = await useCase.execute({
        ...validRequest,
        targetTotalDurationMs: 15000,
        sceneCountOverride: 3,
        principal: "alice",
        executionProfileSelection: stagingCandidateSelection,
        allowedProfileSelections: [stagingCandidateSelection]
      });

      expect(result.campaign.id).toBeDefined();
      expect(result.plan?.allocations[0]?.profileSelection).toEqual(stagingCandidateSelection);
    });

    it("fails closed on an unresolvable candidate when no registryReader is configured", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const stagingAuthSource = makeStagingAuthSource();
      const useCase = new CreateCampaignShellUseCase(uow, { stagingAuthSource });

      await expect(
        useCase.execute({
          ...validRequest,
          targetTotalDurationMs: 15000,
          sceneCountOverride: 3,
          principal: "alice",
          executionProfileSelection: stagingCandidateSelection,
          allowedProfileSelections: [stagingCandidateSelection]
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });
  });

  describe("independence of legacy requests from release/staging authority outages (issue #426)", () => {
    function makeThrowingProductionReleaseReader() {
      return {
        listReleasedProfiles: async () => {
          throw new Error("release bundle file is unreadable");
        },
        getReleasedProfile: async () => {
          throw new Error("release bundle file is unreadable");
        },
        isReleasedProfileKey: async () => false,
        getDeploymentEnablementState: async () => undefined
      };
    }

    function makeThrowingStagingAuthSource() {
      return {
        listAuthorizedCandidates: async () => {
          throw new Error("staging bundle file is unreadable");
        },
        resolveCandidateGrant: async () => undefined
      };
    }

    it("creates a purely legacy campaign shell even when the production release reader is unavailable", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const useCase = new CreateCampaignShellUseCase(uow, {
        productionReleaseReader: makeThrowingProductionReleaseReader()
      });

      const result = await useCase.execute(validRequest);

      expect(result.campaign.id).toBeDefined();
    });

    it("creates a purely legacy campaign shell even when the staging authorization source is unavailable", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const useCase = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: makeThrowingStagingAuthSource()
      });

      const result = await useCase.execute(validRequest);

      expect(result.campaign.id).toBeDefined();
    });

    it("still fails explicitly when a release IS requested and the release reader is unavailable", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const useCase = new CreateCampaignShellUseCase(uow, {
        productionReleaseReader: makeThrowingProductionReleaseReader()
      });

      await expect(
        useCase.execute({
          ...validRequest,
          selectedProfileKey: `H3_RELEASE_${"a".repeat(64)}_V1`
        })
      ).rejects.toThrow();
    });
  });

  describe("Planning authorization enforcement on supplied selection objects and scope/realm compatibility", () => {
    const candidateKey = "H3_CANDIDATE_11111111111111111111111111111111_V1";
    const authorityCandidateSelection: StagingCandidateProfileSelection = {
      kind: "staging_candidate",
      profileKey: candidateKey,
      specificationDigest: "1".repeat(64),
      targetId: "target-host-1",
      authorizationId: "auth-1"
    };

    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
      listAuthorizedCandidates: async () => [authorityCandidateSelection],
      resolveCandidateGrant: async () => undefined
    };

    const mockRegistryReader = {
      getCandidateProfile: () => undefined,
      listCandidateProfiles: () => [],
      isCandidateProfileKey: () => true,
      resolveH3ProfileFrameCapabilities: (key: string | undefined) =>
        key === candidateKey
          ? {
              profileKey: key,
              route: "ref2v" as const,
              routingMode: "reference_directed" as const,
              width: 1344,
              height: 768,
              fps: 24,
              allowedFrameCounts: [243],
              isAllowedFrameCount: (f: number) => f === 243
            }
          : undefined,
      isFrameCountAllowedForH3Profile: () => true
    };

    it("rejects forged caller-supplied executionProfileSelection when specificationDigest mismatches authority", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const useCase = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: mockStagingAuthSource,
        registryReader: mockRegistryReader
      });

      const forgedSelection: StagingCandidateProfileSelection = {
        kind: "staging_candidate",
        profileKey: candidateKey,
        specificationDigest: "2".repeat(64), // Mismatch!
        targetId: "target-host-1",
        authorizationId: "auth-1"
      };

      await expect(
        useCase.execute({
          ...validRequest,
          targetTotalDurationMs: 10000,
          scope: "staging",
          executionProfileSelection: forgedSelection
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    it("rejects forged member in allowedProfileSelections", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const useCase = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: mockStagingAuthSource,
        registryReader: mockRegistryReader
      });

      const forgedAllowed: StagingCandidateProfileSelection = {
        kind: "staging_candidate",
        profileKey: candidateKey,
        specificationDigest: "9".repeat(64), // Mismatch!
        targetId: "target-host-1",
        authorizationId: "auth-1"
      };

      await expect(
        useCase.execute({
          ...validRequest,
          targetTotalDurationMs: 10000,
          scope: "staging",
          selectedProfileKey: candidateKey,
          allowedProfileSelections: [forgedAllowed]
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    it("rejects staging candidate in production scope", async () => {
      const uow = new InMemorySceneUnitOfWork();
      const useCase = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: mockStagingAuthSource,
        registryReader: mockRegistryReader
      });

      await expect(
        useCase.execute({
          ...validRequest,
          targetTotalDurationMs: 10000,
          scope: "production",
          selectedProfileKey: candidateKey
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });
  });
});
