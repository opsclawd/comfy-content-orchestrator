import { describe, expect, it } from "vitest";
import type { CreativeBrief } from "@cco/contracts";
import type { ClientRecord } from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest,
  ReferenceAssetRepository
} from "../ports/index.js";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
import { MaterializeStoryboardUseCase } from "./materialize-storyboard.js";
import { PlanCampaignBeatSheetUseCase } from "./plan-campaign-beat-sheet.js";
import { PlanSceneConfigurationUseCase } from "./plan-scene-configuration.js";
import { PlanCampaignStoryboardUseCase } from "./plan-campaign-storyboard.js";
import {
  CANDIDATE_BATCH_SIZE,
  ProgressSceneProductionUseCases
} from "./progress-scene-production.js";
import { MIN_SCENE_COUNT, MAX_SCENE_COUNT, resolveSceneCount } from "./scene-count-policy.js";
import { PlanningProviderExhaustedError } from "./plan-scene-configuration-errors.js";

class StubPlanningModelClient implements PlanningModelClientPort {
  beatSheetInvocations = 0;
  sceneConfigInvocations = 0;
  shouldThrow = false;
  failOnBeatOrdinal: number | null = null;
  shouldReturnMalformedBeatSheet = false;
  emittedBeats: Array<{ ordinal: number; brief: CreativeBrief; targetDurationMs: number }> = [];
  recordedSceneRequests: PlanningModelRequest[] = [];

  constructor(readonly providerName: "Anthropic" | "OpenAI" = "Anthropic") {}

  resetCounts(): void {
    this.beatSheetInvocations = 0;
    this.sceneConfigInvocations = 0;
    this.emittedBeats = [];
    this.recordedSceneRequests = [];
  }

  async complete(request: PlanningModelRequest): Promise<PlanningModelOutcome> {
    if (this.shouldThrow) {
      return {
        kind: "retryable_failure",
        message: "Provider outage simulation"
      };
    }

    // Distinguish between beat-sheet and per-beat scene configuration requests
    if (request.userPrompt.includes("Total Required Scenes:")) {
      this.beatSheetInvocations++;
      if (this.shouldReturnMalformedBeatSheet) {
        return { kind: "success", rawText: "not json" };
      }

      const totalScenesMatch = request.userPrompt.match(/Total Required Scenes:\s*(\d+)/);
      const totalDurationMatch = request.userPrompt.match(/Target Total Duration:\s*(\d+)\s*ms/);
      const totalScenes = totalScenesMatch ? parseInt(totalScenesMatch[1]!, 10) : 3;
      const targetTotalDurationMs = totalDurationMatch
        ? parseInt(totalDurationMatch[1]!, 10)
        : 15000;

      // Generate uneven, non-uniform beat durations for discriminating duration-authority proof.
      // Every beat has an asymmetric target duration; sum equals targetTotalDurationMs.
      let beatDurations: number[];
      if (totalScenes === 3 && targetTotalDurationMs === 15000) {
        beatDurations = [3000, 7000, 5000];
      } else if (totalScenes === 2 && targetTotalDurationMs === 15000) {
        beatDurations = [6000, 9000];
      } else {
        const baseDuration = Math.floor(targetTotalDurationMs / totalScenes);
        const remainder = targetTotalDurationMs - baseDuration * totalScenes;
        const delta = Math.min(Math.floor(baseDuration / 2), 1500);
        beatDurations = Array.from({ length: totalScenes }, (_, i) => {
          if (i === 0) return baseDuration - delta + remainder;
          if (i === 1 && totalScenes > 1) return baseDuration + delta;
          return baseDuration;
        });
      }

      const beats = Array.from({ length: totalScenes }, (_, i) => ({
        ordinal: i + 1,
        brief: {
          title: `Golden Beat ${i + 1}`,
          description: `Visual description for golden beat ${i + 1}`
        },
        targetDurationMs: beatDurations[i]!
      }));
      this.emittedBeats = beats;

      return {
        kind: "success",
        rawText: JSON.stringify({ beats })
      };
    }

    this.sceneConfigInvocations++;
    this.recordedSceneRequests.push(request);

    if (
      this.failOnBeatOrdinal !== null &&
      request.userPrompt.includes(`Golden Beat ${this.failOnBeatOrdinal}`)
    ) {
      return {
        kind: "retryable_failure",
        message: `Simulated failure on beat ${this.failOnBeatOrdinal}`
      };
    }

    const durationMatch = request.systemPrompt.match(/must equal exactly (\d+)/);
    if (!durationMatch) {
      throw new Error(
        "StubPlanningModelClient: missing authoritative target duration constraint in systemPrompt"
      );
    }
    const durationMs = parseInt(durationMatch[1]!, 10);

    return {
      kind: "success",
      rawText: JSON.stringify({
        prompt: `Cinematic rendering for beat scene ${this.sceneConfigInvocations}`,
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs,
        loraConfigurationId: null
      })
    };
  }
}

describe("PlanCampaignStoryboardUseCase", () => {
  const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const defaultBrief: CreativeBrief = {
    title: "Golden Storyboard Commercial",
    description: "High impact visual storytelling commercial with vibrant lighting",
    targetPlatform: "instagram_reels"
  };

  const clientRecord: ClientRecord = {
    id: clientId,
    companyName: "Acme Studios",
    brandBibleJson: {},
    defaultAspectRatio: "9:16",
    externalProcessingPolicy: {
      allowCloudPlanning: true,
      allowedProviders: ["Anthropic", "OpenAI"],
      sensitiveDataMasking: false
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };

  const mockAssetRepo: ReferenceAssetRepository = {
    listBySceneId: async () => [],
    findByIds: async () => []
  };

  function createTestHarness(options?: {
    stubClient?: StubPlanningModelClient;
    omitJobQueue?: boolean;
  }) {
    const stubClient = options?.stubClient ?? new StubPlanningModelClient("Anthropic");
    const fallbackClient: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubClient.complete(req)
    };
    const queue = new InMemoryJobQueue();
    let uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, undefined, [
      clientRecord
    ]);
    if (!options?.omitJobQueue) {
      uow = uow.withJobs(queue);
    }

    const progressSceneProduction = new ProgressSceneProductionUseCases(
      uow,
      undefined,
      options?.omitJobQueue ? undefined : queue
    );
    const createCampaignShell = new CreateCampaignShellUseCase(uow);
    const planCampaignBeatSheet = new PlanCampaignBeatSheetUseCase({
      uow,
      referenceAssetRepository: mockAssetRepo,
      primaryClient: stubClient,
      fallbackClient
    });
    const planSceneConfiguration = new PlanSceneConfigurationUseCase({
      referenceAssetRepository: mockAssetRepo,
      primaryClient: stubClient,
      fallbackClient
    });
    const materializeStoryboard = new MaterializeStoryboardUseCase(uow, progressSceneProduction);

    const useCase = new PlanCampaignStoryboardUseCase({
      createCampaignShell,
      planCampaignBeatSheet,
      planSceneConfiguration,
      materializeStoryboard,
      uow
    });

    return {
      useCase,
      stubClient,
      queue,
      uow,
      createCampaignShell,
      materializeStoryboard
    };
  }

  describe("Golden Planning Fixture (Structural Regression Coverage)", () => {
    it("satisfies all objective structural assertions for auto-mode resolution", async () => {
      const { useCase, uow, queue, stubClient } = createTestHarness();

      const targetTotalDurationMs = 15000;
      const expectedDerivedN = resolveSceneCount({ targetTotalDurationMs });

      // 1. Scene-count resolution within bounds
      expect(expectedDerivedN).toBeGreaterThanOrEqual(MIN_SCENE_COUNT);
      expect(expectedDerivedN).toBeLessThanOrEqual(MAX_SCENE_COUNT);
      expect(expectedDerivedN).toBe(3);

      const result = await useCase.execute({
        idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73810",
        clientId,
        title: "Auto-Mode Golden Campaign",
        targetPlatform: "instagram_reels",
        targetTotalDurationMs,
        brief: defaultBrief
      });

      // Assert basic result structure
      expect(result.campaign.id).toBeDefined();
      expect(result.campaign.totalScenes).toBe(expectedDerivedN);
      expect(result.isIdempotentReplay).toBe(false);
      expect(result.isStoryboardIdempotentReplay).toBe(false);

      // 2. Exactly N scenes returned and persisted
      expect(result.scenes).toHaveLength(expectedDerivedN);
      const persistedScenes = await uow.execute((ctx) =>
        ctx.scenes.findByCampaignId!(result.campaign.id)
      );
      expect(persistedScenes).toHaveLength(expectedDerivedN);

      // 3. Exactly N beats with ordinals 1..N, contiguous, no gaps/dupes
      const actualOrdinals = result.scenes.map((s) => s.sequenceIndex);
      const expectedOrdinals = Array.from({ length: expectedDerivedN }, (_, i) => i + 1);
      expect(actualOrdinals).toEqual(expectedOrdinals);

      // 4. Persisted scene ordering matches beat ordering
      for (let i = 0; i < expectedDerivedN; i++) {
        expect(persistedScenes[i]!.sequenceIndex).toBe(i + 1);
        expect(persistedScenes[i]!.id).toBe(result.scenes[i]!.id);
      }

      // 5. Authoritative duration propagation: exact equality by ordinal among each beat target,
      // the targetDurationMs supplied to scene planning, the validated configuration, and persisted scene duration.
      expect(stubClient.emittedBeats).toHaveLength(expectedDerivedN);
      expect(stubClient.recordedSceneRequests).toHaveLength(expectedDerivedN);
      // Prove that the golden fixture beat allocation is deliberately uneven / asymmetric:
      expect(stubClient.emittedBeats.map((b) => b.targetDurationMs)).toEqual([3000, 7000, 5000]);

      for (let i = 0; i < expectedDerivedN; i++) {
        const beat = stubClient.emittedBeats[i]!;
        const scene = result.scenes[i]!;
        const persisted = persistedScenes[i]!;
        const recordedReq = stubClient.recordedSceneRequests[i]!;

        // Exact equality of ordinal
        expect(scene.sequenceIndex).toBe(beat.ordinal);
        expect(persisted.sequenceIndex).toBe(beat.ordinal);

        // Prompt received authoritative targetDurationMs matching beat target exactly
        const promptMatch = recordedReq.systemPrompt.match(/must equal exactly (\d+)/);
        expect(promptMatch).not.toBeNull();
        expect(parseInt(promptMatch![1]!, 10)).toBe(beat.targetDurationMs);

        // Validated SceneConfiguration.durationMs equals beat.targetDurationMs
        expect(scene.configuration.durationMs).toBe(beat.targetDurationMs);

        // Persisted scene durationMs equals beat.targetDurationMs
        expect(persisted.snapshot().configuration.durationMs).toBe(beat.targetDurationMs);
      }

      // Total duration sums exactly to targetTotalDurationMs
      const totalDuration = result.scenes.reduce((sum, s) => sum + s.configuration.durationMs, 0);
      expect(totalDuration).toBe(targetTotalDurationMs);

      // 6. Candidate admission using batch-size policy (CANDIDATE_BATCH_SIZE = 3)
      expect(queue.jobs).toHaveLength(expectedDerivedN * CANDIDATE_BATCH_SIZE);
      expect(uow.enqueuedJobs).toHaveLength(expectedDerivedN * CANDIDATE_BATCH_SIZE);
      for (const scene of result.scenes) {
        const sceneJobs = queue.jobs.filter((j) => j.sceneId === scene.id);
        expect(sceneJobs).toHaveLength(CANDIDATE_BATCH_SIZE);
        expect(sceneJobs.every((j) => j.jobKind === "candidate")).toBe(true);
      }

      // 7. Stub client recorded exactly 1 beat-sheet invocation and N scene-config invocations
      expect(stubClient.beatSheetInvocations).toBe(1);
      expect(stubClient.sceneConfigInvocations).toBe(expectedDerivedN);
    });

    it("enforces override authority: explicit sceneCountOverride produces distinct N", async () => {
      const { useCase, stubClient } = createTestHarness();

      const targetTotalDurationMs = 15000;
      const autoN = resolveSceneCount({ targetTotalDurationMs });
      expect(autoN).toBe(3);

      // Override with 2 scenes (within [1000, 15000] bounds)
      const sceneCountOverride = 2;
      const result = await useCase.execute({
        idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73820",
        clientId,
        title: "Override Golden Campaign",
        targetTotalDurationMs,
        sceneCountOverride,
        brief: defaultBrief
      });

      expect(result.campaign.totalScenes).toBe(sceneCountOverride);
      expect(result.campaign.totalScenes).not.toBe(autoN);
      expect(result.scenes).toHaveLength(sceneCountOverride);
      expect(result.scenes.map((s) => s.sequenceIndex)).toEqual([1, 2]);

      // Assert per-ordinal duration equality for override case (uneven split 6000ms and 9000ms)
      expect(stubClient.emittedBeats.map((b) => b.targetDurationMs)).toEqual([6000, 9000]);
      for (let i = 0; i < sceneCountOverride; i++) {
        const beat = stubClient.emittedBeats[i]!;
        const scene = result.scenes[i]!;
        expect(scene.sequenceIndex).toBe(beat.ordinal);
        expect(scene.configuration.durationMs).toBe(beat.targetDurationMs);
      }
    });

    it("proves Auto-mode determinism across two independent runs", async () => {
      const targetTotalDurationMs = 20000;
      const run1N = resolveSceneCount({ targetTotalDurationMs });
      const run2N = resolveSceneCount({ targetTotalDurationMs });

      expect(run1N).toBe(run2N);
      expect(run1N).toBe(4);

      const harness1 = createTestHarness();
      const harness2 = createTestHarness();

      const res1 = await harness1.useCase.execute({
        idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73831",
        clientId,
        title: "Determinism Run 1",
        targetTotalDurationMs,
        brief: defaultBrief
      });

      const res2 = await harness2.useCase.execute({
        idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73832",
        clientId,
        title: "Determinism Run 2",
        targetTotalDurationMs,
        brief: defaultBrief
      });

      expect(res1.campaign.totalScenes).toBe(res2.campaign.totalScenes);
      expect(res1.scenes).toHaveLength(res2.scenes.length);
    });
  });

  describe("Idempotent Replay Short-Circuit (Finding 1 Regression Coverage)", () => {
    it("short-circuits on full replay: 0 new planning invocations, 0 new jobs, isStoryboardIdempotentReplay: true", async () => {
      const { useCase, stubClient, queue, uow } = createTestHarness();
      const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73840";

      const input = {
        idempotencyKey,
        clientId,
        title: "Replay Test Campaign",
        targetTotalDurationMs: 15000,
        brief: defaultBrief
      };

      // First run: completes normally
      const firstResult = await useCase.execute(input);
      expect(firstResult.isIdempotentReplay).toBe(false);
      expect(firstResult.isStoryboardIdempotentReplay).toBe(false);
      expect(stubClient.beatSheetInvocations).toBe(1);
      expect(stubClient.sceneConfigInvocations).toBe(3);
      const initialJobCount = queue.jobs.length;
      expect(initialJobCount).toBe(3 * CANDIDATE_BATCH_SIZE);

      // Reset invocation counters
      stubClient.resetCounts();

      // Second run: replay with identical request
      const secondResult = await useCase.execute(input);

      // Assert ZERO new LLM invocations occurred
      expect(stubClient.beatSheetInvocations).toBe(0);
      expect(stubClient.sceneConfigInvocations).toBe(0);

      // Assert replay flags
      expect(secondResult.isIdempotentReplay).toBe(true);
      expect(secondResult.isStoryboardIdempotentReplay).toBe(true);

      // Assert same campaign and scenes
      expect(secondResult.campaign.id).toBe(firstResult.campaign.id);
      expect(secondResult.scenes).toHaveLength(firstResult.scenes.length);
      for (let i = 0; i < firstResult.scenes.length; i++) {
        expect(secondResult.scenes[i]!.id).toBe(firstResult.scenes[i]!.id);
        expect(secondResult.scenes[i]!.sequenceIndex).toBe(firstResult.scenes[i]!.sequenceIndex);
      }

      // Assert no new candidate jobs enqueued
      expect(queue.jobs.length).toBe(initialJobCount);
      expect(uow.enqueuedJobs.length).toBe(initialJobCount);
    });

    it("succeeds on replay even during a total provider outage (Finding 1 witness scenario)", async () => {
      const { useCase, stubClient } = createTestHarness();
      const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73850";

      const input = {
        idempotencyKey,
        clientId,
        title: "Provider Outage Replay",
        targetTotalDurationMs: 15000,
        brief: defaultBrief
      };

      // 1. First run succeeds
      const firstResult = await useCase.execute(input);
      expect(firstResult.isStoryboardIdempotentReplay).toBe(false);

      // 2. Simulate complete provider outage (all LLM calls will fail)
      stubClient.shouldThrow = true;
      stubClient.resetCounts();

      // 3. Replay with same idempotencyKey must succeed without throwing
      const replayResult = await useCase.execute(input);
      expect(replayResult.isStoryboardIdempotentReplay).toBe(true);
      expect(replayResult.campaign.id).toBe(firstResult.campaign.id);
      expect(replayResult.scenes).toHaveLength(3);
      expect(stubClient.beatSheetInvocations).toBe(0);
      expect(stubClient.sceneConfigInvocations).toBe(0);
    });

    it("does not short-circuit if previous attempt failed before materialization (0 scenes)", async () => {
      const { useCase, stubClient, uow } = createTestHarness();
      const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73860";

      const input = {
        idempotencyKey,
        clientId,
        title: "Recoverable Draft Campaign",
        targetTotalDurationMs: 15000,
        brief: defaultBrief
      };

      // First run: beat-sheet planning fails with malformed output
      stubClient.shouldReturnMalformedBeatSheet = true;
      await expect(useCase.execute(input)).rejects.toThrow();

      // Check state: campaign shell was created in step 1, but 0 scenes exist
      const savedShell = await uow.execute((ctx) =>
        ctx.campaigns!.findByIdempotencyKey!(idempotencyKey)
      );
      expect(savedShell).toBeDefined();
      const scenesAfterFailure = await uow.execute((ctx) =>
        ctx.scenes.findByCampaignId!(savedShell!.id)
      );
      expect(scenesAfterFailure).toHaveLength(0);

      // Second run: provider is now healthy
      stubClient.shouldReturnMalformedBeatSheet = false;
      stubClient.resetCounts();

      const recoveredResult = await useCase.execute(input);

      // It must NOT short-circuit: planning MUST run to materialize scenes
      expect(stubClient.beatSheetInvocations).toBe(1);
      expect(stubClient.sceneConfigInvocations).toBe(3);

      // Shell was replayed, but storyboard was freshly materialized
      expect(recoveredResult.isIdempotentReplay).toBe(true);
      expect(recoveredResult.isStoryboardIdempotentReplay).toBe(false);
      expect(recoveredResult.scenes).toHaveLength(3);
    });
  });

  describe("Failure Semantics", () => {
    it("beat-sheet planning failure leaves shell intact with 0 scenes and 0 jobs", async () => {
      const { useCase, stubClient, uow, queue } = createTestHarness();
      const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73870";

      stubClient.shouldThrow = true;

      await expect(
        useCase.execute({
          idempotencyKey,
          clientId,
          title: "Failed Beat Sheet Planning",
          targetTotalDurationMs: 15000,
          brief: defaultBrief
        })
      ).rejects.toBeInstanceOf(PlanningProviderExhaustedError);

      // Campaign shell was committed in step 1
      const savedShell = await uow.execute((ctx) =>
        ctx.campaigns!.findByIdempotencyKey!(idempotencyKey)
      );
      expect(savedShell).toBeDefined();
      expect(savedShell?.status).toBe("drafting");
      expect(savedShell?.totalScenes).toBe(3);

      // Zero scenes were saved
      const scenes = await uow.execute((ctx) => ctx.scenes.findByCampaignId!(savedShell!.id));
      expect(scenes).toHaveLength(0);
      expect(uow.savedScenes).toHaveLength(0);

      // Zero candidate jobs enqueued
      expect(queue.jobs).toHaveLength(0);
    });

    it("per-beat scene-config planning failure leaves shell intact with 0 scenes and 0 jobs", async () => {
      const { useCase, stubClient, uow, queue } = createTestHarness();
      const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73880";

      // Fail on beat 2 of 3
      stubClient.failOnBeatOrdinal = 2;

      await expect(
        useCase.execute({
          idempotencyKey,
          clientId,
          title: "Failed Scene Config Planning",
          targetTotalDurationMs: 15000,
          brief: defaultBrief
        })
      ).rejects.toBeInstanceOf(PlanningProviderExhaustedError);

      // Shell exists
      const savedShell = await uow.execute((ctx) =>
        ctx.campaigns!.findByIdempotencyKey!(idempotencyKey)
      );
      expect(savedShell).toBeDefined();

      // Zero scenes committed (atomicity across the plan)
      const scenes = await uow.execute((ctx) => ctx.scenes.findByCampaignId!(savedShell!.id));
      expect(scenes).toHaveLength(0);
      expect(uow.savedScenes).toHaveLength(0);
      expect(queue.jobs).toHaveLength(0);
    });

    it("materialize failure (missing job queue) leaves shell intact with 0 scenes committed", async () => {
      const { useCase, uow } = createTestHarness({ omitJobQueue: true });
      const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73890";

      await expect(
        useCase.execute({
          idempotencyKey,
          clientId,
          title: "Failed Materialize Step",
          targetTotalDurationMs: 15000,
          brief: defaultBrief
        })
      ).rejects.toThrow(/Unit of work does not provide a transactional job enqueuer/);

      // Shell exists
      const savedShell = await uow.execute((ctx) =>
        ctx.campaigns!.findByIdempotencyKey!(idempotencyKey)
      );
      expect(savedShell).toBeDefined();

      // Zero scenes persisted
      const scenes = await uow.execute((ctx) => ctx.scenes.findByCampaignId!(savedShell!.id));
      expect(scenes).toHaveLength(0);
    });
  });
});
