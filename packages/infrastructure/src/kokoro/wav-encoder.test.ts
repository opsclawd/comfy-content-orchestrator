import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav-encoder.js";
import { KokoroSynthesisError } from "./kokoro-error.js";

describe("encodeWav", () => {
  it("encodes PCM samples into a valid RIFF/WAVE header and data block", () => {
    const sampleRate = 24000;
    // 100 samples
    const samples = new Float32Array(100);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const wavBytes = encodeWav(samples, sampleRate);

    // Total length must be 44 header bytes + 100 samples * 2 bytes/sample = 244 bytes
    expect(wavBytes.length).toBe(44 + 100 * 2);

    const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);

    // "RIFF"
    const riff = String.fromCharCode(...wavBytes.subarray(0, 4));
    expect(riff).toBe("RIFF");

    // ChunkSize = 36 + dataSize
    const chunkSize = view.getUint32(4, true);
    expect(chunkSize).toBe(36 + 100 * 2);

    // "WAVE"
    const wave = String.fromCharCode(...wavBytes.subarray(8, 12));
    expect(wave).toBe("WAVE");

    // "fmt "
    const fmt = String.fromCharCode(...wavBytes.subarray(12, 16));
    expect(fmt).toBe("fmt ");

    // Subchunk1Size = 16 for PCM
    const subchunk1Size = view.getUint32(16, true);
    expect(subchunk1Size).toBe(16);

    // AudioFormat = 1 (PCM)
    const audioFormat = view.getUint16(20, true);
    expect(audioFormat).toBe(1);

    // NumChannels = 1 (mono assumption for Kokoro voice synthesis)
    const numChannels = view.getUint16(22, true);
    expect(numChannels).toBe(1);

    // SampleRate = 24000
    const declaredSampleRate = view.getUint32(24, true);
    expect(declaredSampleRate).toBe(24000);

    // ByteRate = SampleRate * NumChannels * BitsPerSample / 8 = 24000 * 1 * 2 = 48000
    const byteRate = view.getUint32(28, true);
    expect(byteRate).toBe(48000);

    // BlockAlign = NumChannels * BitsPerSample / 8 = 2
    const blockAlign = view.getUint16(32, true);
    expect(blockAlign).toBe(2);

    // BitsPerSample = 16
    const bitsPerSample = view.getUint16(34, true);
    expect(bitsPerSample).toBe(16);

    // "data"
    const dataTag = String.fromCharCode(...wavBytes.subarray(36, 40));
    expect(dataTag).toBe("data");

    // Subchunk2Size = NumSamples * NumChannels * BitsPerSample / 8 = 200
    const subchunk2Size = view.getUint32(40, true);
    expect(subchunk2Size).toBe(200);
  });

  it("accurately clamps and quantizes floating point samples to signed 16-bit integers", () => {
    // Test boundary values: 0, 1.0 (max positive), -1.0 (max negative), overshoot (> 1.0, < -1.0)
    const samples = new Float32Array([0.0, 1.0, -1.0, 1.5, -2.0, 0.5, -0.5]);
    const wavBytes = encodeWav(samples, 16000);
    const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);

    expect(view.getInt16(44 + 0 * 2, true)).toBe(0);
    expect(view.getInt16(44 + 1 * 2, true)).toBe(32767);
    expect(view.getInt16(44 + 2 * 2, true)).toBe(-32768);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(32767); // Clamped from 1.5
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32768); // Clamped from -2.0
    expect(view.getInt16(44 + 5 * 2, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(44 + 6 * 2, true)).toBe(Math.round(-0.5 * 32768));
  });

  it("rejects empty sample arrays with KokoroSynthesisError", () => {
    expect(() => encodeWav(new Float32Array(0), 24000)).toThrow(KokoroSynthesisError);
    try {
      encodeWav(new Float32Array(0), 24000);
    } catch (err) {
      expect(err).toBeInstanceOf(KokoroSynthesisError);
      expect((err as KokoroSynthesisError).code).toBe("INVALID_INPUT");
    }
  });

  it("rejects invalid or non-positive sample rates", () => {
    const samples = new Float32Array([0.1, 0.2]);
    expect(() => encodeWav(samples, 0)).toThrow(KokoroSynthesisError);
    expect(() => encodeWav(samples, -24000)).toThrow(KokoroSynthesisError);
    expect(() => encodeWav(samples, 24000.5)).toThrow(KokoroSynthesisError);
  });
});
