import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { VoiceoverAssetRefSchema } from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import {
  SynthesizeVoiceover,
  SynthesizeVoiceoverValidationError,
  VoiceoverProvenanceConflictError,
  VoiceSynthesisNotAuthorizedError,
  decodeVoiceAuthorizationPolicy
} from "./synthesize-voiceover.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import type { CampaignId, CampaignRecord, ClientRecord } from "@cco/domain";
import type {
  ConcreteVoiceSynthesisPort,
  VoiceSynthesisInput,
  VoiceSynthesisOutput
} from "../ports/voice-synthesis-port.js";
import {
  type ObjectStoragePort,
  type PutObjectInput,
  type ObjectLocator,
  type StoredObject,
  ObjectAlreadyExistsError
} from "../ports/object-storage-port.js";

function createMockObjectStorage() {
  const storedObjects = new Map<string, StoredObject>();
  const putCalls: PutObjectInput[] = [];

  const port: ObjectStoragePort = {
    async putObject(input: PutObjectInput): Promise<ObjectLocator> {
      putCalls.push(input);
      const storageKey = `${input.bucket}/${input.key}`;
      if (input.ifNoneMatch === "*" && storedObjects.has(storageKey)) {
        throw new ObjectAlreadyExistsError(input.bucket, input.key);
      }
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

describe("SynthesizeVoiceover use-case", () => {
  it("synthesizes voiceover and writes to default BUCKETS.REVIEW storage with valid schema", async () => {
    const { port: storagePort, putCalls } = createMockObjectStorage();

    // Witness scenario: 35,420 samples @ 24,000 Hz yields 1475.8333... ms
    // Math.round at port boundary yields 1476 ms integer duration.
    const fakeWav = new Uint8Array(44 + 35420 * 2);
    const expectedSha256 = createHash("sha256").update(fakeWav).digest("hex");

    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: vi.fn(async (input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput> => {
        expect(input.text).toBe("Welcome to the video");
        expect(input.voiceId).toBe("af_heart");
        return {
          audio: fakeWav,
          contentType: "audio/wav",
          sampleRateHz: 24000,
          durationMs: 1476 // integer rounded
        };
      })
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    const result = await useCase.synthesize({
      campaignId: "camp-123",
      assetId: "vo-001",
      text: "Welcome to the video",
      voiceId: "af_heart",
      startMs: 500
    });

    const expectedKey = `campaigns/camp-123/voiceovers/vo-001-${expectedSha256}.wav`;

    // Verify storage write
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]!.bucket).toBe(BUCKETS.REVIEW);
    expect(putCalls[0]!.key).toBe(expectedKey);
    expect(putCalls[0]!.contentType).toBe("audio/wav");
    expect(putCalls[0]!.ifNoneMatch).toBe("*");

    // Verify return structure
    expect(result.assetId).toBe("vo-001");
    expect(result.kind).toBe("voiceover");
    expect(result.source).toEqual({ kind: "local" });
    expect(result.media.bucket).toBe(BUCKETS.REVIEW);
    expect(result.media.key).toBe(expectedKey);
    expect(result.media.sha256).toBe(expectedSha256);
    expect(result.startMs).toBe(500);
    expect(result.expectedDurationMs).toBe(1476);
    expect(Number.isInteger(result.expectedDurationMs)).toBe(true);

    // Schema compliance check: must pass VoiceoverAssetRefSchema
    const parsed = VoiceoverAssetRefSchema.parse(result);
    expect(parsed).toEqual(result);
  });

  it("respects explicit target bucket override", async () => {
    const { port: storagePort, putCalls } = createMockObjectStorage();

    const fakeWav = new Uint8Array(100);
    const expectedSha256 = createHash("sha256").update(fakeWav).digest("hex");

    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: vi.fn(async (): Promise<VoiceSynthesisOutput> => ({
        audio: fakeWav,
        contentType: "audio/wav",
        sampleRateHz: 24000,
        durationMs: 1000
      }))
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort,
      bucket: BUCKETS.DELIVERY
    });

    const result = await useCase.synthesize({
      campaignId: "camp-123",
      assetId: "vo-001",
      text: "Final voiceover",
      voiceId: "af_bella"
    });

    const expectedKey = `campaigns/camp-123/voiceovers/vo-001-${expectedSha256}.wav`;
    expect(putCalls[0]!.bucket).toBe(BUCKETS.DELIVERY);
    expect(putCalls[0]!.key).toBe(expectedKey);
    expect(result.media.bucket).toBe(BUCKETS.DELIVERY);
    expect(result.media.key).toBe(expectedKey);
    expect(result.startMs).toBe(0); // default when startMs omitted
  });

  it("sequential calls with same identity but differing audio publish to distinct content-addressed keys without overwrite", async () => {
    const { port: storagePort, storedObjects, putCalls } = createMockObjectStorage();

    const audioA = new Uint8Array([1, 2, 3, 4]);
    const shaA = createHash("sha256").update(audioA).digest("hex");
    const audioB = new Uint8Array([5, 6, 7, 8]);
    const shaB = createHash("sha256").update(audioB).digest("hex");

    let callCount = 0;
    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: vi.fn(async (): Promise<VoiceSynthesisOutput> => {
        callCount++;
        return {
          audio: callCount === 1 ? audioA : audioB,
          contentType: "audio/wav",
          sampleRateHz: 24000,
          durationMs: callCount === 1 ? 1000 : 2000
        };
      })
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    const result1 = await useCase.synthesize({
      campaignId: "camp-shared",
      assetId: "asset-1",
      text: "Text version A",
      voiceId: "af_heart"
    });

    const result2 = await useCase.synthesize({
      campaignId: "camp-shared",
      assetId: "asset-1",
      text: "Text version B (differing text)",
      voiceId: "af_heart"
    });

    expect(result1.media.sha256).toBe(shaA);
    expect(result2.media.sha256).toBe(shaB);
    expect(result1.media.key).toBe(`campaigns/camp-shared/voiceovers/asset-1-${shaA}.wav`);
    expect(result2.media.key).toBe(`campaigns/camp-shared/voiceovers/asset-1-${shaB}.wav`);

    // Verify both media objects exist in storage simultaneously and neither was overwritten
    expect(storedObjects.size).toBe(2);
    expect(storedObjects.get(`${BUCKETS.REVIEW}/${result1.media.key}`)).toBeDefined();
    expect(storedObjects.get(`${BUCKETS.REVIEW}/${result2.media.key}`)).toBeDefined();
    expect(putCalls).toHaveLength(2);
  });

  it("concurrent calls with same identity and differing audio publish safely without stomping", async () => {
    const { port: storagePort, storedObjects } = createMockObjectStorage();

    const audio1 = new Uint8Array([10, 20, 30]);
    const sha1 = createHash("sha256").update(audio1).digest("hex");
    const audio2 = new Uint8Array([40, 50, 60]);
    const sha2 = createHash("sha256").update(audio2).digest("hex");

    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: vi.fn(async (input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput> => {
        const isOne = input.text.includes("One");
        return {
          audio: isOne ? audio1 : audio2,
          contentType: "audio/wav",
          sampleRateHz: 24000,
          durationMs: isOne ? 1500 : 2500
        };
      })
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    const [res1, res2] = await Promise.all([
      useCase.synthesize({
        campaignId: "camp-concurrent",
        assetId: "asset-concurrent",
        text: "Narration One",
        voiceId: "af_heart"
      }),
      useCase.synthesize({
        campaignId: "camp-concurrent",
        assetId: "asset-concurrent",
        text: "Narration Two",
        voiceId: "af_heart"
      })
    ]);

    expect(res1.media.sha256).toBe(sha1);
    expect(res2.media.sha256).toBe(sha2);
    expect(res1.media.key).not.toBe(res2.media.key);
    expect(storedObjects.has(`${BUCKETS.REVIEW}/${res1.media.key}`)).toBe(true);
    expect(storedObjects.has(`${BUCKETS.REVIEW}/${res2.media.key}`)).toBe(true);
  });

  it("idempotently handles duplicate synthesis for identical content without duplicate puts", async () => {
    const { port: storagePort, putCalls } = createMockObjectStorage();

    const audio = new Uint8Array([99, 100, 101]);
    const sha = createHash("sha256").update(audio).digest("hex");

    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: vi.fn(async (): Promise<VoiceSynthesisOutput> => ({
        audio,
        contentType: "audio/wav",
        sampleRateHz: 24000,
        durationMs: 1200
      }))
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    const params = {
      campaignId: "camp-dup",
      assetId: "asset-dup",
      text: "Identical narration text",
      voiceId: "af_heart"
    };

    const first = await useCase.synthesize(params);
    const second = await useCase.synthesize(params);

    expect(first).toEqual(second);
    expect(first.media.sha256).toBe(sha);
    // Only 1 put call because second was resolved via getObject idempotency check
    expect(putCalls).toHaveLength(1);
  });

  it("raises VoiceoverProvenanceConflictError if storage already contains corrupted or mismatched checksum at the same key", async () => {
    const { port: storagePort, storedObjects } = createMockObjectStorage();

    const audio = new Uint8Array([11, 22, 33]);
    const sha = createHash("sha256").update(audio).digest("hex");
    const key = `campaigns/camp-conflict/voiceovers/asset-conflict-${sha}.wav`;

    // Pre-seed storage with mismatched checksum at this key
    storedObjects.set(`${BUCKETS.REVIEW}/${key}`, {
      bucket: BUCKETS.REVIEW,
      key,
      body: new Uint8Array([99]),
      checksumSha256: "mismatched-sha256-value"
    });

    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: vi.fn(async (): Promise<VoiceSynthesisOutput> => ({
        audio,
        contentType: "audio/wav",
        sampleRateHz: 24000,
        durationMs: 800
      }))
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    await expect(
      useCase.synthesize({
        campaignId: "camp-conflict",
        assetId: "asset-conflict",
        text: "Some audio text",
        voiceId: "af_heart"
      })
    ).rejects.toThrow(VoiceoverProvenanceConflictError);
  });

  it("defensively rejects non-integer or negative startMs with SynthesizeVoiceoverValidationError", async () => {
    const { port: storagePort } = createMockObjectStorage();
    const synthFn = vi.fn();
    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: synthFn
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    // Fractional startMs
    await expect(
      useCase.synthesize({
        campaignId: "camp-123",
        assetId: "vo-001",
        text: "Test",
        voiceId: "af_heart",
        startMs: 12.5
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    // Negative startMs
    await expect(
      useCase.synthesize({
        campaignId: "camp-123",
        assetId: "vo-001",
        text: "Test",
        voiceId: "af_heart",
        startMs: -100
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    // NaN startMs
    await expect(
      useCase.synthesize({
        campaignId: "camp-123",
        assetId: "vo-001",
        text: "Test",
        voiceId: "af_heart",
        startMs: NaN
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    // Ensure port was never called on validation failure
    expect(synthFn).not.toHaveBeenCalled();
  });

  it("defensively rejects missing or empty text, voiceId, campaignId, assetId", async () => {
    const { port: storagePort } = createMockObjectStorage();
    const synthFn = vi.fn();
    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: synthFn
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    await expect(
      useCase.synthesize({
        campaignId: "",
        assetId: "vo-1",
        text: "hello",
        voiceId: "af_heart"
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    await expect(
      useCase.synthesize({
        campaignId: "camp-1",
        assetId: "",
        text: "hello",
        voiceId: "af_heart"
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    await expect(
      useCase.synthesize({
        campaignId: "camp-1",
        assetId: "vo-1",
        text: "   ",
        voiceId: "af_heart"
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    await expect(
      useCase.synthesize({
        campaignId: "camp-1",
        assetId: "vo-1",
        text: "hello",
        voiceId: ""
      })
    ).rejects.toThrow(SynthesizeVoiceoverValidationError);

    expect(synthFn).not.toHaveBeenCalled();
  });

  it("defensively rejects non-positive, non-finite, and reciprocal-overflow speed values with SynthesizeVoiceoverValidationError", async () => {
    const { port: storagePort } = createMockObjectStorage();
    const synthFn = vi.fn();
    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: synthFn
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    const invalidSpeeds = [0, -1, NaN, Infinity, -Infinity, Number.MIN_VALUE];
    for (const speed of invalidSpeeds) {
      await expect(
        useCase.synthesize({
          campaignId: "camp-1",
          assetId: "vo-1",
          text: "hello",
          voiceId: "af_heart",
          speed
        })
      ).rejects.toThrow(SynthesizeVoiceoverValidationError);
    }

    expect(synthFn).not.toHaveBeenCalled();
  });

  it("passes through valid speed to voiceSynthesis port", async () => {
    const { port: storagePort } = createMockObjectStorage();
    const fakeWav = new Uint8Array(44 + 24000 * 2);
    const synthFn = vi.fn(async (input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput> => {
      expect(input.speed).toBe(1.2);
      return {
        audio: fakeWav,
        contentType: "audio/wav",
        sampleRateHz: 24000,
        durationMs: 1000
      };
    });
    const fakeSynthesisPort: ConcreteVoiceSynthesisPort = {
      synthesize: synthFn
    };

    const useCase = new SynthesizeVoiceover({
      voiceSynthesis: fakeSynthesisPort,
      objectStorage: storagePort
    });

    await useCase.synthesize({
      campaignId: "camp-1",
      assetId: "vo-1",
      text: "hello",
      voiceId: "af_heart",
      speed: 1.2
    });

    expect(synthFn).toHaveBeenCalledTimes(1);
  });

  describe("External Processing Policy Gate (PRD §9.6 voice enforcement)", () => {
    it("prohibits cloud voice provider call and throws VoiceSynthesisNotAuthorizedError when allowCloudVoice=false", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const synthSpy = vi.fn();
      const fakeCloudPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "cloud",
        providerName: "ElevenLabs",
        synthesize: synthSpy
      };

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
          campaignId: "camp-cloud-blocked",
          assetId: "vo-cloud-blocked",
          text: "Cloud narration text",
          voiceId: "cloud-voice-1"
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      expect(synthSpy).not.toHaveBeenCalled();
    });

    it("prohibits cloud voice provider call when providerName is not in allowedProviders", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const synthSpy = vi.fn();
      const fakeCloudPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "cloud",
        providerName: "ElevenLabs",
        synthesize: synthSpy
      };

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        policy: decodeVoiceAuthorizationPolicy({
          allowCloudVoice: true,
          allowedProviders: ["AzureTTS"]
        })
      });

      await expect(
        useCase.synthesize({
          campaignId: "camp-cloud-provider-blocked",
          assetId: "vo-cloud-provider-blocked",
          text: "Cloud narration text",
          voiceId: "cloud-voice-1"
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      expect(synthSpy).not.toHaveBeenCalled();
    });

    it("allows cloud voice provider call when allowCloudVoice=true with authorized provider", async () => {
      const { port: storagePort, putCalls } = createMockObjectStorage();
      const fakeWav = new Uint8Array([1, 2, 3, 4, 5]);
      const expectedSha256 = createHash("sha256").update(fakeWav).digest("hex");
      const synthSpy = vi.fn(async () => ({
        audio: fakeWav,
        contentType: "audio/wav",
        sampleRateHz: 24000,
        durationMs: 850
      }));
      const fakeCloudPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "cloud",
        providerName: "ElevenLabs",
        synthesize: synthSpy
      };

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

      expect(synthSpy).toHaveBeenCalledTimes(1);
      expect(result.source).toEqual({
        kind: "provider",
        providerId: "ElevenLabs"
      });
      expect(result.expectedDurationMs).toBe(850);
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]!.key).toBe(
        `campaigns/camp-cloud-allowed/voiceovers/vo-cloud-allowed-${expectedSha256}.wav`
      );
    });

    it("enforces PRD §3.3 degraded mode: accepts manual/local audio upload when allowCloudVoice=false without provider call", async () => {
      const { port: storagePort, putCalls } = createMockObjectStorage();
      const synthSpy = vi.fn();
      const fakeCloudPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "cloud",
        providerName: "ElevenLabs",
        synthesize: synthSpy
      };

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
        text: "Human uploaded voiceover script",
        voiceId: "human-voice",
        manualAudioUpload: {
          audio: manualAudio,
          durationMs: 2500,
          contentType: "audio/wav"
        }
      });

      // Synthesis provider call is strictly prevented
      expect(synthSpy).not.toHaveBeenCalled();

      // Audio is stored and ref is returned with kind "uploaded"
      expect(result.source).toEqual({ kind: "uploaded" });
      expect(result.expectedDurationMs).toBe(2500);
      expect(result.media.sha256).toBe(expectedSha256);
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]!.key).toBe(
        `campaigns/camp-manual-vo/voiceovers/vo-manual-01-${expectedSha256}.wav`
      );

      // Verify schema validity
      const parsed = VoiceoverAssetRefSchema.parse(result);
      expect(parsed).toEqual(result);
    });

    it("resolves client policy via UnitOfWork to gate cloud provider calls", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const synthSpy = vi.fn();
      const fakeCloudPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "cloud",
        providerName: "ElevenLabs",
        synthesize: synthSpy
      };

      const clientId = "client-vo-gated";
      const campaignId = "camp-vo-gated";

      const fakeCampaign: CampaignRecord = {
        id: campaignId as CampaignId,
        clientId,
        title: "Voice Gated Campaign",
        targetPlatform: "tiktok",
        status: "drafting",
        totalScenes: 1,
        approvedScenes: 0,
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z"
      };

      const fakeClient: ClientRecord = {
        id: clientId,
        companyName: "Acme Gated",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudVoice: false,
          allowedProviders: ["ElevenLabs"]
        },
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z"
      };

      const uow = new InMemorySceneUnitOfWork([], [], [], [fakeCampaign], [fakeClient]);

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

      expect(synthSpy).not.toHaveBeenCalled();
    });

    it("prohibits cloud voice provider calls when stored policy has allowCloudVoice=false even with attempted enabling override in parameters", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const synthSpy = vi.fn();
      const fakeCloudPort: ConcreteVoiceSynthesisPort = {
        providerLocality: "cloud",
        providerName: "ElevenLabs",
        synthesize: synthSpy
      };

      const clientId = "client-vo-gated";
      const campaignId = "camp-vo-gated";

      const fakeCampaign: CampaignRecord = {
        id: campaignId as CampaignId,
        clientId,
        title: "Voice Gated Campaign",
        targetPlatform: "tiktok",
        status: "drafting",
        totalScenes: 1,
        approvedScenes: 0,
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z"
      };

      const fakeClient: ClientRecord = {
        id: clientId,
        companyName: "Acme Gated",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudVoice: false,
          allowedProviders: ["ElevenLabs"]
        },
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z"
      };

      const uow = new InMemorySceneUnitOfWork([], [], [], [fakeCampaign], [fakeClient]);

      const useCase = new SynthesizeVoiceover({
        voiceSynthesis: fakeCloudPort,
        objectStorage: storagePort,
        uow
      });

      // Attempted enabling override with clientPolicy
      await expect(
        useCase.synthesize({
          campaignId,
          assetId: "vo-override-attempt-1",
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
          assetId: "vo-override-attempt-2",
          text: "Text requiring voiceover",
          voiceId: "cloud-voice-1",
          externalProcessingPolicy: {
            allowCloudVoice: true,
            allowedProviders: ["ElevenLabs"]
          }
        })
      ).rejects.toThrow(VoiceSynthesisNotAuthorizedError);

      expect(synthSpy).not.toHaveBeenCalled();
    });

    it("permits self-hosted synthesis even when allowCloudVoice=false", async () => {
      const { port: storagePort } = createMockObjectStorage();
      const fakeWav = new Uint8Array([7, 8, 9]);
      const synthSpy = vi.fn(async () => ({
        audio: fakeWav,
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
