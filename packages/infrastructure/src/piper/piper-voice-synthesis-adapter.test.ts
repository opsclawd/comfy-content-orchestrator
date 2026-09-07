import { describe, expect, it, vi } from "vitest";
import { encodeWav } from "../kokoro/wav-encoder.js";
import { PiperVoiceSynthesisAdapter } from "./piper-voice-synthesis-adapter.js";
import { PiperHttpClient } from "./piper-client.js";
import { PiperSynthesisError } from "./piper-error.js";

function createValidWav(sampleRateHz = 22050, durationSeconds = 1): Uint8Array {
  const sampleCount = Math.round(sampleRateHz * durationSeconds);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sampleRateHz);
  }
  return encodeWav(samples, sampleRateHz);
}

describe("PiperVoiceSynthesisAdapter", () => {
  it("rejects construction with empty or whitespace configuredVoiceId", () => {
    const client = new PiperHttpClient();
    expect(() => new PiperVoiceSynthesisAdapter("", client)).toThrowError(PiperSynthesisError);
    expect(() => new PiperVoiceSynthesisAdapter("   ", client)).toThrowError(PiperSynthesisError);
  });

  it("rejects empty or whitespace text with INVALID_INPUT without calling client", async () => {
    const client = new PiperHttpClient();
    const synthesizeSpy = vi.spyOn(client, "synthesize");
    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);

    await expect(
      adapter.synthesize({ text: "", voiceId: "en_US-lessac-medium" })
    ).rejects.toThrowError(PiperSynthesisError);

    await expect(
      adapter.synthesize({ text: "   ", voiceId: "en_US-lessac-medium" })
    ).rejects.toThrowError(PiperSynthesisError);

    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it("rejects empty or whitespace voiceId with INVALID_INPUT without calling client", async () => {
    const client = new PiperHttpClient();
    const synthesizeSpy = vi.spyOn(client, "synthesize");
    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);

    await expect(adapter.synthesize({ text: "Hello", voiceId: "" })).rejects.toThrowError(
      PiperSynthesisError
    );

    await expect(adapter.synthesize({ text: "Hello", voiceId: "   " })).rejects.toThrowError(
      PiperSynthesisError
    );

    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it("rejects speed <= 0, non-finite speeds, and speeds with non-finite reciprocal with INVALID_INPUT without calling client (Finding 1 & quality regression)", async () => {
    const client = new PiperHttpClient();
    const synthesizeSpy = vi.spyOn(client, "synthesize");
    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);

    const invalidSpeeds = [
      0,
      -0.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MIN_VALUE // 5e-324: reciprocal 1.0 / Number.MIN_VALUE is Infinity
    ];

    for (const speed of invalidSpeeds) {
      await expect(
        adapter.synthesize({ text: "Hello", voiceId: "en_US-lessac-medium", speed })
      ).rejects.toThrowError(PiperSynthesisError);

      try {
        await adapter.synthesize({ text: "Hello", voiceId: "en_US-lessac-medium", speed });
      } catch (err: unknown) {
        const error = err as PiperSynthesisError;
        expect(error.code).toBe("INVALID_INPUT");
        expect(error.context.speed).toBe(speed);
      }
    }

    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it("rejects mismatched voiceId with VOICE_NOT_FOUND without calling client (Finding 4 regression)", async () => {
    const client = new PiperHttpClient();
    const synthesizeSpy = vi.spyOn(client, "synthesize");
    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);

    await expect(
      adapter.synthesize({ text: "Hello", voiceId: "different_voice" })
    ).rejects.toThrowError(PiperSynthesisError);

    try {
      await adapter.synthesize({ text: "Hello", voiceId: "different_voice" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("VOICE_NOT_FOUND");
      expect(error.context.requestedVoiceId).toBe("different_voice");
      expect(error.context.configuredVoiceId).toBe("en_US-lessac-medium");
    }

    expect(synthesizeSpy).not.toHaveBeenCalled();
  });

  it("forwards lengthScale = 1.0 / speed to client when speed is specified (Finding 2 regression)", async () => {
    const client = new PiperHttpClient();
    const validWav = createValidWav(22050, 1);
    const synthesizeSpy = vi.spyOn(client, "synthesize").mockResolvedValue(validWav);

    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);
    await adapter.synthesize({
      text: "Testing speed propagation",
      voiceId: "en_US-lessac-medium",
      speed: 1.2
    });

    expect(synthesizeSpy).toHaveBeenCalledTimes(1);
    const requestArg = synthesizeSpy.mock.calls[0]![0];
    expect(requestArg.text).toBe("Testing speed propagation");
    expect(requestArg.voice).toBe("en_US-lessac-medium");
    expect(requestArg.lengthScale).toBeCloseTo(1.0 / 1.2, 5);
  });

  it("omits lengthScale when speed is undefined", async () => {
    const client = new PiperHttpClient();
    const validWav = createValidWav(22050, 1);
    const synthesizeSpy = vi.spyOn(client, "synthesize").mockResolvedValue(validWav);

    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);
    await adapter.synthesize({
      text: "Normal speed",
      voiceId: "en_US-lessac-medium"
    });

    expect(synthesizeSpy).toHaveBeenCalledTimes(1);
    const requestArg = synthesizeSpy.mock.calls[0]![0];
    expect(requestArg.lengthScale).toBeUndefined();
  });

  it("happy path computes durationMs purely from the measured response audio bytes", async () => {
    const client = new PiperHttpClient();
    // 22050 Hz, 33075 samples = 1.5 seconds = 1500 ms
    const validWav = createValidWav(22050, 1.5);
    vi.spyOn(client, "synthesize").mockResolvedValue(validWav);

    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);
    const result = await adapter.synthesize({
      text: "A short utterance",
      voiceId: "en_US-lessac-medium"
    });

    expect(result.contentType).toBe("audio/wav");
    expect(result.sampleRateHz).toBe(22050);
    expect(result.durationMs).toBe(1500);
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.audio).toEqual(validWav);
  });

  it("propagates client failure codes (SERVICE_UNAVAILABLE, INFERENCE_FAILED, DECODE_FAILED)", async () => {
    const client = new PiperHttpClient();
    const adapter = new PiperVoiceSynthesisAdapter("en_US-lessac-medium", client);

    vi.spyOn(client, "synthesize").mockRejectedValue(
      new PiperSynthesisError("SERVICE_UNAVAILABLE", "Network down")
    );
    await expect(
      adapter.synthesize({ text: "Hello", voiceId: "en_US-lessac-medium" })
    ).rejects.toThrowError(PiperSynthesisError);

    vi.spyOn(client, "synthesize").mockRejectedValue(
      new PiperSynthesisError("INFERENCE_FAILED", "Failed")
    );
    await expect(
      adapter.synthesize({ text: "Hello", voiceId: "en_US-lessac-medium" })
    ).rejects.toThrowError(PiperSynthesisError);

    vi.spyOn(client, "synthesize").mockResolvedValue(
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0])
    ); // invalid truncated WAV
    await expect(
      adapter.synthesize({ text: "Hello", voiceId: "en_US-lessac-medium" })
    ).rejects.toThrowError(PiperSynthesisError);
  });
});
