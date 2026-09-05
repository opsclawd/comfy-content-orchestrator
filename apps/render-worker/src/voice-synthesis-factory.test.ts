import { describe, expect, it } from "vitest";
import { KokoroVoiceSynthesisAdapter, type KokoroEngine } from "@cco/infrastructure";
import { createVoiceSynthesisPort } from "./voice-synthesis-factory.js";

describe("createVoiceSynthesisPort", () => {
  it("creates KokoroVoiceSynthesisAdapter as the default voice synthesis port", () => {
    const port = createVoiceSynthesisPort();
    expect(port).toBeInstanceOf(KokoroVoiceSynthesisAdapter);
  });

  it("accepts a custom engine via configuration", async () => {
    const fakeEngine: KokoroEngine = {
      async synthesize() {
        return { samples: new Float32Array(2400), sampleRateHz: 24000 };
      }
    };

    const port = createVoiceSynthesisPort({
      provider: "kokoro",
      kokoro: { engine: fakeEngine }
    });

    expect(port).toBeInstanceOf(KokoroVoiceSynthesisAdapter);
    const result = await port.synthesize({ text: "Hello", voiceId: "af_heart" });
    expect(result.durationMs).toBe(100);
    expect(result.contentType).toBe("audio/wav");
  });
});
