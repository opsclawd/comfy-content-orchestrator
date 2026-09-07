import { describe, expect, it } from "vitest";
import { AssemblySpecSchema } from "@cco/contracts";
import type {
  ConcreteVoiceSynthesisPort,
  VoiceSynthesisOutput
} from "../ports/voice-synthesis-port.js";
import {
  type ObjectStoragePort,
  type PutObjectInput,
  type ObjectLocator,
  type StoredObject,
  ObjectAlreadyExistsError
} from "../ports/object-storage-port.js";
import type {
  ConcreteForcedAlignmentPort,
  ForcedAlignmentInput
} from "../ports/forced-alignment-port.js";
import { SynthesizeVoiceover } from "./synthesize-voiceover.js";
import { GenerateSubtitleCues } from "./generate-subtitle-cues.js";
import { SynthesizeVoiceoverWithSubtitles } from "./synthesize-voiceover-with-subtitles.js";

function createMockObjectStorage(): ObjectStoragePort {
  const storedObjects = new Map<string, StoredObject>();

  return {
    async putObject(input: PutObjectInput): Promise<ObjectLocator> {
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
}

describe("SynthesizeVoiceoverWithSubtitles use case", () => {
  it("synthesizes voiceover and generates aligned subtitle cues with exactly one synth call", async () => {
    let synthCallCount = 0;
    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]);

    const fakeVoiceSynthesis: ConcreteVoiceSynthesisPort = {
      async synthesize(): Promise<VoiceSynthesisOutput> {
        synthCallCount++;
        return {
          audio: fakeAudio,
          contentType: "audio/wav",
          sampleRateHz: 24000,
          durationMs: 3000
        };
      }
    };

    let capturedAlignmentInput: ForcedAlignmentInput | undefined;
    const fakeAlignmentPort: ConcreteForcedAlignmentPort = {
      async align(input) {
        capturedAlignmentInput = input;
        return {
          words: [
            { word: "This", startMs: 100, endMs: 500, aligned: true },
            { word: "is", startMs: 600, endMs: 900, aligned: true },
            { word: "aligned.", startMs: 1000, endMs: 2000, aligned: true }
          ]
        };
      }
    };

    const objectStorage = createMockObjectStorage();
    const synthesizeVoiceover = new SynthesizeVoiceover({
      voiceSynthesis: fakeVoiceSynthesis,
      objectStorage
    });
    const generateSubtitleCues = new GenerateSubtitleCues({
      forcedAlignment: fakeAlignmentPort
    });

    const useCase = new SynthesizeVoiceoverWithSubtitles({
      synthesizeVoiceover,
      generateSubtitleCues
    });

    const result = await useCase.synthesize({
      campaignId: "camp-123",
      assetId: "vo-123",
      text: "This is aligned.",
      voiceId: "af_heart",
      startMs: 1000,
      language: "en",
      cueOptions: { maxWords: 5 }
    });

    // Verify exactly ONE voice synthesis call (no duplicate synth invocation)
    expect(synthCallCount).toBe(1);

    // Verify voiceover ref
    expect(result.voiceover.assetId).toBe("vo-123");
    expect(result.voiceover.startMs).toBe(1000);
    expect(result.voiceover.expectedDurationMs).toBe(3000);
    expect(result.voiceover.kind).toBe("voiceover");

    // Verify captured input to forced alignment
    expect(capturedAlignmentInput).toBeDefined();
    expect(capturedAlignmentInput!.text).toBe("This is aligned.");
    expect(capturedAlignmentInput!.language).toBe("en");
    expect(capturedAlignmentInput!.audio).toEqual(fakeAudio);

    // Verify generated subtitle cues with offset applied (voiceover startMs = 1000)
    expect(result.subtitleCues).toHaveLength(1);
    expect(result.subtitleCues[0]!.text).toBe("This is aligned.");
    expect(result.subtitleCues[0]!.startMs).toBe(1100); // 100 + 1000
    expect(result.subtitleCues[0]!.endMs).toBe(3000); // 2000 + 1000
  });

  it("forwards custom language and cueOptions cleanly through top-level params (Finding 4 fix)", async () => {
    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const fakeVoiceSynthesis: ConcreteVoiceSynthesisPort = {
      async synthesize(): Promise<VoiceSynthesisOutput> {
        return {
          audio: fakeAudio,
          contentType: "audio/wav",
          sampleRateHz: 24000,
          durationMs: 2000
        };
      }
    };

    let receivedLanguage: string | undefined;
    const fakeAlignmentPort: ConcreteForcedAlignmentPort = {
      async align(input) {
        receivedLanguage = input.language;
        return {
          words: [
            { word: "Uno", startMs: 100, endMs: 400, aligned: true },
            { word: "Dos", startMs: 500, endMs: 800, aligned: true }
          ]
        };
      }
    };

    const objectStorage = createMockObjectStorage();
    const synthesizeVoiceover = new SynthesizeVoiceover({
      voiceSynthesis: fakeVoiceSynthesis,
      objectStorage
    });
    const generateSubtitleCues = new GenerateSubtitleCues({
      forcedAlignment: fakeAlignmentPort
    });

    const useCase = new SynthesizeVoiceoverWithSubtitles({
      synthesizeVoiceover,
      generateSubtitleCues
    });

    const result = await useCase.synthesize({
      campaignId: "camp-es",
      assetId: "vo-es",
      text: "Uno Dos",
      voiceId: "es_speaker",
      language: "es",
      cueOptions: { maxWords: 1 }
    });

    expect(receivedLanguage).toBe("es");
    expect(result.subtitleCues).toHaveLength(2);
    expect(result.subtitleCues[0]!.text).toBe("Uno");
    expect(result.subtitleCues[1]!.text).toBe("Dos");
  });

  it("produces voiceover and subtitle cues that plug cleanly into AssemblySpecSchema", async () => {
    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const fakeVoiceSynthesis: ConcreteVoiceSynthesisPort = {
      async synthesize(): Promise<VoiceSynthesisOutput> {
        return {
          audio: fakeAudio,
          contentType: "audio/wav",
          sampleRateHz: 24000,
          durationMs: 4000
        };
      }
    };

    const fakeAlignmentPort: ConcreteForcedAlignmentPort = {
      async align() {
        return {
          words: [
            { word: "Scene", startMs: 200, endMs: 800, aligned: true },
            { word: "narration.", startMs: 900, endMs: 1800, aligned: true }
          ]
        };
      }
    };

    const objectStorage = createMockObjectStorage();
    const synthesizeVoiceover = new SynthesizeVoiceover({
      voiceSynthesis: fakeVoiceSynthesis,
      objectStorage
    });
    const generateSubtitleCues = new GenerateSubtitleCues({
      forcedAlignment: fakeAlignmentPort
    });

    const useCase = new SynthesizeVoiceoverWithSubtitles({
      synthesizeVoiceover,
      generateSubtitleCues
    });

    const { voiceover, subtitleCues } = await useCase.synthesize({
      campaignId: "camp-spec",
      assetId: "vo-spec",
      text: "Scene narration.",
      voiceId: "af_heart",
      startMs: 0
    });

    const dummyHash = "a".repeat(64);
    const assemblySpecFixture = {
      campaignId: "camp-spec",
      assemblyId: "asm-1",
      jobId: "job-1",
      videoStems: [
        {
          sceneId: "scene-1",
          generationManifestId: "gen-1",
          order: 0,
          media: {
            bucket: "cco-renders",
            key: "renders/scene-1.mp4",
            sha256: dummyHash,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ],
      voiceover,
      soundbed: {
        assetId: "sb-1",
        kind: "soundbed",
        media: {
          bucket: "cco-audio",
          key: "audio/soundbed-1.wav",
          sha256: dummyHash,
          contentType: "audio/wav"
        },
        source: { kind: "local" },
        startMs: 0,
        expectedDurationMs: 5000
      },
      subtitleCues,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000
    };

    const parsed = AssemblySpecSchema.parse(assemblySpecFixture);
    expect(parsed.voiceover).toEqual(voiceover);
    expect(parsed.subtitleCues).toEqual(subtitleCues);
  });
});
