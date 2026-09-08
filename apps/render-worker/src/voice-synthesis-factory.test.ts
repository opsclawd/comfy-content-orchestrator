import { describe, expect, it, vi } from "vitest";
import type { ConcreteVoiceSynthesisPort } from "@cco/application";
import { VoiceSynthesisNotAuthorizedError } from "@cco/application";
import {
  KokoroVoiceSynthesisAdapter,
  PiperVoiceSynthesisAdapter,
  type KokoroEngine
} from "@cco/infrastructure";
import { createVoiceSynthesisPort } from "./voice-synthesis-factory.js";

describe("createVoiceSynthesisPort", () => {
  it("creates KokoroVoiceSynthesisAdapter as the default voice synthesis port with self-hosted locality", () => {
    const port = createVoiceSynthesisPort();
    expect(port).toBeInstanceOf(KokoroVoiceSynthesisAdapter);
    expect(port.providerLocality).toBe("self-hosted");
    expect(port.providerName).toBe("kokoro");
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

  it("creates PiperVoiceSynthesisAdapter when provider is piper with self-hosted locality", () => {
    const port = createVoiceSynthesisPort({
      provider: "piper",
      piper: {
        configuredVoiceId: "en_US-lessac-medium",
        baseUrl: "http://localhost:5000"
      }
    });

    expect(port).toBeInstanceOf(PiperVoiceSynthesisAdapter);
    expect((port as PiperVoiceSynthesisAdapter).configuredVoiceId).toBe("en_US-lessac-medium");
    expect(port.providerLocality).toBe("self-hosted");
    expect(port.providerName).toBe("piper");
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

  it("enforces externalProcessingPolicy when cloud provider is configured and allowCloudVoice=false", async () => {
    const synthesizeSpy = vi.fn(async () => ({
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
      sampleRateHz: 24000,
      durationMs: 500
    }));

    const fakeCloudAdapter: ConcreteVoiceSynthesisPort = {
      providerLocality: "cloud",
      providerName: "ElevenLabs",
      synthesize: synthesizeSpy
    };

    const port = createVoiceSynthesisPort({
      providerLocality: "cloud",
      cloud: {
        adapter: fakeCloudAdapter,
        providerName: "ElevenLabs"
      },
      externalProcessingPolicy: {
        allowCloudVoice: false,
        allowedProviders: ["ElevenLabs"]
      }
    });

    expect(port.providerLocality).toBe("cloud");
    await expect(port.synthesize({ text: "Hello", voiceId: "cloud-voice-1" })).rejects.toThrow(
      VoiceSynthesisNotAuthorizedError
    );
    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it("permits synthesis when cloud provider is configured and allowCloudVoice=true with authorized provider", async () => {
    const synthesizeSpy = vi.fn(async () => ({
      audio: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
      sampleRateHz: 24000,
      durationMs: 500
    }));

    const fakeCloudAdapter: ConcreteVoiceSynthesisPort = {
      providerLocality: "cloud",
      providerName: "ElevenLabs",
      synthesize: synthesizeSpy
    };

    const port = createVoiceSynthesisPort({
      providerLocality: "cloud",
      cloud: {
        adapter: fakeCloudAdapter,
        providerName: "ElevenLabs"
      },
      externalProcessingPolicy: {
        allowCloudVoice: true,
        allowedProviders: ["ElevenLabs"]
      }
    });

    const result = await port.synthesize({ text: "Hello", voiceId: "cloud-voice-1" });
    expect(result.durationMs).toBe(500);
    expect(synthesizeSpy).toHaveBeenCalledTimes(1);
  });
});
