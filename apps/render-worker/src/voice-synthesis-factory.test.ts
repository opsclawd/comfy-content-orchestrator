import { describe, expect, it } from "vitest";
import {
  KokoroVoiceSynthesisAdapter,
  PiperVoiceSynthesisAdapter,
  type KokoroEngine
} from "@cco/infrastructure";
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

  it("creates PiperVoiceSynthesisAdapter when provider is piper and configuredVoiceId is present", () => {
    const port = createVoiceSynthesisPort({
      provider: "piper",
      piper: {
        configuredVoiceId: "en_US-lessac-medium",
        baseUrl: "http://localhost:5000"
      }
    });

    expect(port).toBeInstanceOf(PiperVoiceSynthesisAdapter);
    expect((port as PiperVoiceSynthesisAdapter).configuredVoiceId).toBe("en_US-lessac-medium");
  });

  it("throws clear configuration error when provider is piper but configuredVoiceId is missing", () => {
    expect(() =>
      createVoiceSynthesisPort({
        provider: "piper"
      })
    ).toThrowError("createVoiceSynthesisPort: provider 'piper' requires piper.configuredVoiceId");

    expect(() =>
      createVoiceSynthesisPort({
        provider: "piper",
        piper: {
          configuredVoiceId: "   "
        }
      })
    ).toThrowError("createVoiceSynthesisPort: provider 'piper' requires piper.configuredVoiceId");
  });

  it("passes timeoutMs to PiperHttpClient when specified", () => {
    const port = createVoiceSynthesisPort({
      provider: "piper",
      piper: {
        configuredVoiceId: "en_US-lessac-medium",
        baseUrl: "http://localhost:5000",
        timeoutMs: 15_000
      }
    });

    expect(port).toBeInstanceOf(PiperVoiceSynthesisAdapter);
    expect((port as PiperVoiceSynthesisAdapter).client.timeoutMs).toBe(15_000);
  });
});
