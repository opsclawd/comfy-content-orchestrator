import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { type CreativeBrief, VoiceoverAssetRefSchema } from "@cco/contracts";
import {
  type CampaignId,
  type CampaignRecord,
  type CandidateId,
  type ClientRecord,
  type SceneConfiguration,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import type {
  CandidateRankingContext,
  ConcreteVoiceSynthesisPort,
  ObjectLocator,
  ObjectStoragePort,
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest,
  PutObjectInput,
  RankingModelClientPort,
  RankingModelOutcome,
  RankingModelRequest,
  ResolvedCandidateImage,
  StoredObject,
  VoiceSynthesisInput,
  VoiceSynthesisOutput
} from "../ports/index.js";
import {
  CandidateRankingOrchestrator,
  decodeVisualQaAuthorizationPolicy
} from "./candidate-ranking-orchestrator.js";
import { CreateSceneUseCase } from "./create-scene.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import {
  PlanningOrchestrationKernel,
  decodePlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import { PlanningNotAuthorizedError } from "./plan-scene-configuration-errors.js";
import type { PlanSceneConfigurationUseCase } from "./plan-scene-configuration.js";
import { SceneCreationModeMismatchError } from "./scene-creation-errors.js";
import { SubmitSceneCreationUseCase } from "./submit-scene-creation.js";
import {
  SynthesizeVoiceover,
  VoiceSynthesisNotAuthorizedError,
  decodeVoiceAuthorizationPolicy
} from "./synthesize-voiceover.js";

class FakePlanningModelClient implements PlanningModelClientPort {
  readonly calls: PlanningModelRequest[] = [];

  constructor(
    readonly providerName: "Anthropic" | "OpenAI",
    private readonly outcome: PlanningModelOutcome = {
      kind: "success",
      rawText: JSON.stringify({
        prompt: "Generated cinematic scene prompt",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 5000,
        loraConfigurationId: null
      })
    }
  ) {}

  async complete(req: PlanningModelRequest): Promise<PlanningModelOutcome> {
    this.calls.push(req);
    return this.outcome;
  }
}

class FakeRankingModelClient implements RankingModelClientPort {
  readonly calls: RankingModelRequest[] = [];

  constructor(
    readonly providerName: "Google" | "OpenAI",
    private readonly outcome: RankingModelOutcome = {
      kind: "success",
      rankedOrdinals: [2, 1]
    }
  ) {}

  async rankBatch(request: RankingModelRequest): Promise<RankingModelOutcome> {
    this.calls.push(request);
    return this.outcome;
  }
}

function createMockObjectStorage() {
  const storedObjects = new Map<string, StoredObject>();
  const putCalls: PutObjectInput[] = [];

  const port: ObjectStoragePort = {
    async putObject(input: PutObjectInput): Promise<ObjectLocator> {
      putCalls.push(input);
      const storageKey = `${input.bucket}/${input.key}`;
      const stored: StoredObject = {
        bucket: input.bucket,
        key: input.key,
        body: input.body,
        ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {})
      };
      storedObjects.set(storageKey, stored);
      return { bucket: input.bucket, key: input.key };
    },
    async getObject(locator: ObjectLocator): Promise<StoredObject | undefined> {
      return storedObjects.get(`${locator.bucket}/${locator.key}`);
    },
    async copyObject(from: ObjectLocator, to: ObjectLocator): Promise<ObjectLocator> {
      const source = storedObjects.get(`${from.bucket}/${from.key}`);
      if (source) {
        storedObjects.set(`${to.bucket}/${to.key}`, { ...source, bucket: to.bucket, key: to.key });
      }
      return { bucket: to.bucket, key: to.key };
    }
  };

  return { port, putCalls, storedObjects };
}

class FakeCloudVoiceSynthesisPort implements ConcreteVoiceSynthesisPort {
  readonly providerLocality = "cloud" as const;
  readonly providerName = "ElevenLabs";
  readonly calls: VoiceSynthesisInput[] = [];

  constructor(
    private readonly outcome: VoiceSynthesisOutput = {
      audio: new Uint8Array([1, 2, 3, 4, 5]),
      contentType: "audio/wav",
      sampleRateHz: 24000,
      durationMs: 850
    }
  ) {}

  async synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput> {
    this.calls.push(input);
    return this.outcome;
  }
}

function makeFakeCandidate(variantOrdinal: number): StoryboardCandidate {
  return {
    id: `cand-${variantOrdinal}` as CandidateId,
    sceneId: "scene-policy-test-1" as SceneId,
    specRevision: 1,
    variantOrdinal,
    storageBucket: "review-bucket",
    storageObjectKey: `candidates/cand-${variantOrdinal}.png`,
    contentHash: `hash-${variantOrdinal}`,
    generationMetadata: {},
    createdAt: "2026-09-07T00:00:00.000Z"
  };
}

function makeFakeCampaign(campaignId: string, clientId: string): CampaignRecord {
  return {
    id: campaignId as CampaignId,
    clientId,
    title: "Manual Campaign",
    targetPlatform: "tiktok",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z"
  };
}

function makeFakeClient(clientId: string, policy: Record<string, unknown>): ClientRecord {
  return {
    id: clientId,
    companyName: "Acme Corp",
    brandBibleJson: {},
    defaultAspectRatio: "9:16",
    externalProcessingPolicy: policy,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z"
  };
}

describe("External Processing Policy Gate (PRD §9.6)", () => {
  describe("allowCloudPlanning enforcement", () => {
    it("prohibits cloud provider calls and throws PlanningNotAuthorizedError when allowCloudPlanning=false", async () => {
      const primaryClient = new FakePlanningModelClient("Anthropic");
      const fallbackClient = new FakePlanningModelClient("OpenAI");

      const kernel = new PlanningOrchestrationKernel({
        primaryClient,
        fallbackClient
      });

      const policy = decodePlanningAuthorizationPolicy({
        allowCloudPlanning: false,
        allowedProviders: ["Anthropic", "OpenAI"],
        sensitiveDataMasking: false
      });

      await expect(
        kernel.run({
          policy,
          buildRequest: () => ({
            systemPrompt: "You are a creative planner",
            userPrompt: "Create opening scene"
          }),
          parseAndValidate: (rawText: string) => JSON.parse(rawText)
        })
      ).rejects.toThrow(PlanningNotAuthorizedError);

      expect(primaryClient.calls).toHaveLength(0);
      expect(fallbackClient.calls).toHaveLength(0);
    });

    it("allows cloud provider calls when allowCloudPlanning=true with authorized provider", async () => {
      const primaryClient = new FakePlanningModelClient("Anthropic");
      const fallbackClient = new FakePlanningModelClient("OpenAI");

      const kernel = new PlanningOrchestrationKernel({
        primaryClient,
        fallbackClient
      });

      const policy = decodePlanningAuthorizationPolicy({
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"],
        sensitiveDataMasking: false
      });

      const result = await kernel.run({
        policy,
        buildRequest: () => ({
          systemPrompt: "You are a creative planner",
          userPrompt: "Create opening scene"
        }),
        parseAndValidate: (rawText: string) => JSON.parse(rawText) as { prompt: string }
      });

      expect(result).toHaveProperty("prompt", "Generated cinematic scene prompt");
      expect(primaryClient.calls).toHaveLength(1);
      expect(fallbackClient.calls).toHaveLength(0);
    });

    it("enforces PRD §3.3 manual degraded mode: rejects brief submission when allowCloudPlanning=false", async () => {
      const clientId = "client-manual-only";
      const campaignId = "campaign-manual-only";
      const planExecuteSpy = vi.fn();

      const fakePlanSceneUseCase = {
        execute: planExecuteSpy
      } as unknown as PlanSceneConfigurationUseCase;

      const uow = new InMemorySceneUnitOfWork(
        [],
        [],
        [],
        [makeFakeCampaign(campaignId, clientId)],
        [
          makeFakeClient(clientId, {
            allowCloudPlanning: false,
            allowedProviders: ["Anthropic"]
          })
        ]
      );

      const createScene = new CreateSceneUseCase(uow);
      const submitScene = new SubmitSceneCreationUseCase({
        uow,
        createScene,
        planSceneConfiguration: fakePlanSceneUseCase
      });

      const brief: CreativeBrief = {
        title: "Test Scene",
        description: "Scene description",
        targetPlatform: "tiktok"
      };

      await expect(
        submitScene.execute({
          campaignId,
          kind: "brief",
          brief
        })
      ).rejects.toThrow(SceneCreationModeMismatchError);

      expect(planExecuteSpy).not.toHaveBeenCalled();
    });

    it("enforces PRD §3.3 manual degraded mode: accepts manual SceneConfiguration when allowCloudPlanning=false without provider calls", async () => {
      const clientId = "client-manual-only";
      const campaignId = "campaign-manual-only";
      const planExecuteSpy = vi.fn();

      const fakePlanSceneUseCase = {
        execute: planExecuteSpy
      } as unknown as PlanSceneConfigurationUseCase;

      const uow = new InMemorySceneUnitOfWork(
        [],
        [],
        [],
        [makeFakeCampaign(campaignId, clientId)],
        [
          makeFakeClient(clientId, {
            allowCloudPlanning: false,
            allowedProviders: ["Anthropic"]
          })
        ]
      );

      const createScene = new CreateSceneUseCase(uow);
      const submitScene = new SubmitSceneCreationUseCase({
        uow,
        createScene,
        planSceneConfiguration: fakePlanSceneUseCase
      });

      const manualConfig: SceneConfiguration = {
        prompt: "Manually authored creator prompt",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 5000,
        loraConfigurationId: null
      };

      const scene = await submitScene.execute({
        campaignId,
        kind: "manual",
        configuration: manualConfig
      });

      expect(scene.snapshot().configuration.prompt).toBe("Manually authored creator prompt");
      expect(planExecuteSpy).not.toHaveBeenCalled();
    });
  });

  describe("allowCloudVisualQA enforcement", () => {
    it("prohibits cloud provider calls, skips image resolution, and returns candidates unranked when allowCloudVisualQA=false", async () => {
      const primaryClient = new FakeRankingModelClient("Google", {
        kind: "success",
        rankedOrdinals: [2, 1]
      });
      const fallbackClient = new FakeRankingModelClient("OpenAI");

      const orchestrator = new CandidateRankingOrchestrator({
        primaryClient,
        fallbackClient,
        policy: decodeVisualQaAuthorizationPolicy({
          allowCloudVisualQA: false,
          allowedProviders: ["Google", "OpenAI"],
          sensitiveDataMasking: false
        })
      });

      const candidate1 = makeFakeCandidate(1);
      const candidate2 = makeFakeCandidate(2);
      const resolveImageData = vi.fn(
        async (c: StoryboardCandidate): Promise<ResolvedCandidateImage | undefined> => ({
          base64Data: `image-bytes-${c.variantOrdinal}`,
          mimeType: "image/png"
        })
      );

      const context: CandidateRankingContext = {
        sceneId: "scene-policy-test-1" as SceneId,
        shotDescription: "Hero establishing shot",
        resolveImageData
      };

      const result = await orchestrator.rank([candidate1, candidate2], context);

      // Preserves original unranked order (PRD §3.3 degraded behavior)
      expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2]);
      // Zero provider calls
      expect(primaryClient.calls).toHaveLength(0);
      expect(fallbackClient.calls).toHaveLength(0);
      // Zero image resolution calls
      expect(resolveImageData).not.toHaveBeenCalled();
    });

    it("allows cloud provider calls and reorders candidates when allowCloudVisualQA=true with authorized provider", async () => {
      const primaryClient = new FakeRankingModelClient("Google", {
        kind: "success",
        rankedOrdinals: [2, 1]
      });
      const fallbackClient = new FakeRankingModelClient("OpenAI");

      const orchestrator = new CandidateRankingOrchestrator({
        primaryClient,
        fallbackClient,
        policy: decodeVisualQaAuthorizationPolicy({
          allowCloudVisualQA: true,
          allowedProviders: ["Google", "OpenAI"],
          sensitiveDataMasking: false
        })
      });

      const candidate1 = makeFakeCandidate(1);
      const candidate2 = makeFakeCandidate(2);
      const resolveImageData = vi.fn(
        async (c: StoryboardCandidate): Promise<ResolvedCandidateImage | undefined> => ({
          base64Data: `image-bytes-${c.variantOrdinal}`,
          mimeType: "image/png"
        })
      );

      const context: CandidateRankingContext = {
        sceneId: "scene-policy-test-1" as SceneId,
        shotDescription: "Hero establishing shot",
        resolveImageData
      };

      const result = await orchestrator.rank([candidate1, candidate2], context);

      // Reordered by ranking model outcome
      expect(result.map((c) => c.variantOrdinal)).toEqual([2, 1]);
      // Primary called, fallback not called
      expect(primaryClient.calls).toHaveLength(1);
      expect(fallbackClient.calls).toHaveLength(0);
      // Images resolved
      expect(resolveImageData).toHaveBeenCalledTimes(2);
    });

    it("prevents cloud provider calls when sensitiveDataMasking=true even if allowCloudVisualQA=true", async () => {
      const primaryClient = new FakeRankingModelClient("Google", {
        kind: "success",
        rankedOrdinals: [2, 1]
      });
      const fallbackClient = new FakeRankingModelClient("OpenAI");

      const orchestrator = new CandidateRankingOrchestrator({
        primaryClient,
        fallbackClient,
        policy: decodeVisualQaAuthorizationPolicy({
          allowCloudVisualQA: true,
          allowedProviders: ["Google", "OpenAI"],
          sensitiveDataMasking: true
        })
      });

      const candidate1 = makeFakeCandidate(1);
      const candidate2 = makeFakeCandidate(2);
      const resolveImageData = vi.fn(
        async (c: StoryboardCandidate): Promise<ResolvedCandidateImage | undefined> => ({
          base64Data: `image-bytes-${c.variantOrdinal}`,
          mimeType: "image/png"
        })
      );

      const context: CandidateRankingContext = {
        sceneId: "scene-policy-test-1" as SceneId,
        shotDescription: "Hero establishing shot",
        resolveImageData
      };

      const result = await orchestrator.rank([candidate1, candidate2], context);

      expect(result.map((c) => c.variantOrdinal)).toEqual([1, 2]);
      expect(primaryClient.calls).toHaveLength(0);
      expect(fallbackClient.calls).toHaveLength(0);
      expect(resolveImageData).not.toHaveBeenCalled();
    });
  });

  describe("allowCloudVoice enforcement", () => {
    it("prohibits cloud voice provider calls and throws VoiceSynthesisNotAuthorizedError when allowCloudVoice=false without manual upload", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const fakeCloudPort = new FakeCloudVoiceSynthesisPort();

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        policy: decodeVoiceAuthorizationPolicy({
          allowCloudVoice: false,
          allowedProviders: ["ElevenLabs"]
        })
      });

      await expect(
        useCase.synthesize({
          campaignId: "camp-cloud-vo-disabled",
          assetId: "vo-cloud-01",
          text: "Cloud narration text",
          voiceId: "cloud-voice-1"
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      expect(fakeCloudPort.calls).toHaveLength(0);
    });

    it("enforces PRD §3.3 manual degraded mode: accepts manual/local audio upload when allowCloudVoice=false without cloud provider calls", async () => {
      const { port: storagePort, putCalls } = createMockObjectStorage();
      const fakeCloudPort = new FakeCloudVoiceSynthesisPort();

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        policy: decodeVoiceAuthorizationPolicy({
          allowCloudVoice: false,
          allowedProviders: ["ElevenLabs"]
        })
      });

      const manualAudio = new Uint8Array([10, 20, 30, 40]);
      const expectedSha256 = createHash("sha256").update(manualAudio).digest("hex");

      const result = await useCase.synthesize({
        campaignId: "camp-manual-vo",
        assetId: "vo-manual-01",
        text: "Human authored voiceover script",
        voiceId: "human-voice",
        manualAudioUpload: {
          audio: manualAudio,
          durationMs: 3000,
          contentType: "audio/wav"
        }
      });

      // Synthesis provider call is strictly prevented
      expect(fakeCloudPort.calls).toHaveLength(0);

      // Audio is stored and ref is returned with kind "uploaded" (PRD §3.3 degraded behavior)
      expect(result.source).toEqual({ kind: "uploaded" });
      expect(result.expectedDurationMs).toBe(3000);
      expect(result.media.sha256).toBe(expectedSha256);
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]!.key).toBe(
        `campaigns/camp-manual-vo/voiceovers/vo-manual-01-${expectedSha256}.wav`
      );

      // Schema compliance check: must pass VoiceoverAssetRefSchema
      const parsed = VoiceoverAssetRefSchema.parse(result);
      expect(parsed).toEqual(result);
    });

    it("allows cloud voice provider calls when allowCloudVoice=true with authorized provider", async () => {
      const { port: storagePort, putCalls } = createMockObjectStorage();
      const fakeCloudPort = new FakeCloudVoiceSynthesisPort();

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        policy: decodeVoiceAuthorizationPolicy({
          allowCloudVoice: true,
          allowedProviders: ["ElevenLabs"]
        })
      });

      const result = await useCase.synthesize({
        campaignId: "camp-cloud-allowed",
        assetId: "vo-cloud-allowed",
        text: "Cloud narration text",
        voiceId: "cloud-voice-1"
      });

      expect(fakeCloudPort.calls).toHaveLength(1);
      expect(result.source).toEqual({
        kind: "provider",
        providerId: "ElevenLabs"
      });
      expect(result.expectedDurationMs).toBe(850);
      expect(putCalls).toHaveLength(1);
    });

    it("resolves client policy via UnitOfWork to gate cloud provider calls", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const fakeCloudPort = new FakeCloudVoiceSynthesisPort();
      const clientId = "client-vo-gated";
      const campaignId = "camp-vo-gated";

      const uow = new InMemorySceneUnitOfWork(
        [],
        [],
        [],
        [makeFakeCampaign(campaignId, clientId)],
        [
          makeFakeClient(clientId, {
            allowCloudVoice: false,
            allowedProviders: ["ElevenLabs"]
          })
        ]
      );

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        uow
      });

      await expect(
        useCase.synthesize({
          campaignId,
          assetId: "vo-uow-gated",
          text: "Text requiring voiceover",
          voiceId: "cloud-voice-1"
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      expect(fakeCloudPort.calls).toHaveLength(0);
    });

    it("prohibits cloud voice provider calls when stored policy has allowCloudVoice=false even with attempted enabling override", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const fakeCloudPort = new FakeCloudVoiceSynthesisPort();
      const clientId = "client-vo-gated";
      const campaignId = "camp-vo-gated";

      const uow = new InMemorySceneUnitOfWork(
        [],
        [],
        [],
        [makeFakeCampaign(campaignId, clientId)],
        [
          makeFakeClient(clientId, {
            allowCloudVoice: false,
            allowedProviders: ["ElevenLabs"]
          })
        ]
      );

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        uow
      });

      // Attempted enabling override with clientPolicy
      await expect(
        useCase.synthesize({
          campaignId,
          assetId: "vo-uow-override-attempt-1",
          text: "Text requiring voiceover",
          voiceId: "cloud-voice-1",
          clientPolicy: {
            allowCloudVoice: true,
            allowedProviders: new Set(["ElevenLabs"]),
            sensitiveDataMasking: false
          }
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      // Attempted enabling override with externalProcessingPolicy
      await expect(
        useCase.synthesize({
          campaignId,
          assetId: "vo-uow-override-attempt-2",
          text: "Text requiring voiceover",
          voiceId: "cloud-voice-1",
          externalProcessingPolicy: {
            allowCloudVoice: true,
            allowedProviders: ["ElevenLabs"]
          }
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      expect(fakeCloudPort.calls).toHaveLength(0);
    });

    it("permits self-hosted voice synthesis without cloud calls even when allowCloudVoice=false", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const synthSpy = vi.fn(async () => ({
        audio: new Uint8Array([7, 8, 9]),
        contentType: "audio/wav",
        sampleRateHz: 24000,
        durationMs: 400
      }));

      const fakeSelfHostedPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "self-hosted",
        providerName: "kokoro",
        synthesize: synthSpy
      };

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeSelfHostedPort,
        objectStorage: storagePort,
        policy: decodeVoiceAuthorizationPolicy({
          allowCloudVoice: false
        })
      });

      const result = await useCase.synthesize({
        campaignId: "camp-self-hosted",
        assetId: "vo-self-hosted-01",
        text: "Self-hosted text",
        voiceId: "af_heart"
      });

      expect(synthSpy).toHaveBeenCalledTimes(1);
      expect(result.source).toEqual({ kind: "local" });
    });
  });
});
