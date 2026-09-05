import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { KokoroVoiceSynthesisAdapter } from "./kokoro-voice-synthesis-adapter.js";
import {
  type KokoroEngine,
  type KokoroEngineInput,
  type KokoroEngineOutput,
  createKokoroJsEngine,
  verifyKokoroModelDir,
  loadPinnedKokoroVersion,
  splitTextIntoSafeUtterances,
  MAX_MODEL_TOKEN_LIMIT
} from "./kokoro-engine.js";
import { KokoroSynthesisError } from "./kokoro-error.js";

describe("KokoroVoiceSynthesisAdapter", () => {
  it("synthesizes audio with integer durationMs and valid WAV output", async () => {
    // 35,420 samples at 24,000 Hz = 1475.8333... ms
    const sampleRateHz = 24000;
    const sampleCount = 35420;
    const testSamples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      testSamples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRateHz);
    }

    const fakeEngine: KokoroEngine = {
      async synthesize(input: KokoroEngineInput): Promise<KokoroEngineOutput> {
        expect(input.text).toBe("Test utterance");
        expect(input.voiceId).toBe("af_heart");
        expect(input.speed).toBe(1.1);
        return {
          samples: testSamples,
          sampleRateHz
        };
      }
    };

    const adapter = new KokoroVoiceSynthesisAdapter(fakeEngine);
    const result = await adapter.synthesize({
      text: "Test utterance",
      voiceId: "af_heart",
      speed: 1.1
    });

    expect(result.contentType).toBe("audio/wav");
    expect(result.sampleRateHz).toBe(24000);
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.audio.length).toBe(44 + sampleCount * 2);

    // Explicit verification of integer duration rounding
    // 35420 / 24000 * 1000 = 1475.8333333333335 -> Math.round -> 1476
    expect(result.durationMs).toBe(1476);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it("rejects empty text or empty voiceId with KokoroSynthesisError", async () => {
    const fakeEngine: KokoroEngine = {
      async synthesize(): Promise<KokoroEngineOutput> {
        return { samples: new Float32Array(100), sampleRateHz: 24000 };
      }
    };
    const adapter = new KokoroVoiceSynthesisAdapter(fakeEngine);

    await expect(adapter.synthesize({ text: "", voiceId: "af_heart" })).rejects.toThrow(
      KokoroSynthesisError
    );

    await expect(adapter.synthesize({ text: "   ", voiceId: "af_heart" })).rejects.toThrow(
      KokoroSynthesisError
    );

    await expect(adapter.synthesize({ text: "Hello", voiceId: "" })).rejects.toThrow(
      KokoroSynthesisError
    );

    await expect(adapter.synthesize({ text: "Hello", voiceId: "   " })).rejects.toThrow(
      KokoroSynthesisError
    );
  });

  it("propagates engine synthesis errors", async () => {
    const fakeEngine: KokoroEngine = {
      async synthesize(): Promise<KokoroEngineOutput> {
        throw new KokoroSynthesisError("INFERENCE_FAILED", "ONNX failure");
      }
    };
    const adapter = new KokoroVoiceSynthesisAdapter(fakeEngine);

    await expect(adapter.synthesize({ text: "Hello", voiceId: "af_heart" })).rejects.toThrow(
      KokoroSynthesisError
    );
  });
});

describe("KokoroJsEngine error recovery and resilience (F-85f4cd06)", () => {
  it("verifies SHA-256 fail-closed and rejects mismatched model weights with MODEL_LOAD_FAILED", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro-sha-test-"));
    try {
      const dummyConfig = "dummy-config-content";
      const dummyConfigSha = createHash("sha256").update(dummyConfig).digest("hex");
      const onnxDir = path.join(tmpDir, "onnx");
      fs.mkdirSync(onnxDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "config.json"), dummyConfig);
      fs.writeFileSync(path.join(tmpDir, "tokenizer.json"), dummyConfig);
      fs.writeFileSync(path.join(tmpDir, "tokenizer_config.json"), dummyConfig);
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
          sha256: "expected-sha256-hash",
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha
        })
      );
      fs.writeFileSync(path.join(onnxDir, "model_quantized.onnx"), "tampered-corrupted-bytes");

      expect(() => {
        verifyKokoroModelDir(
          tmpDir,
          "expected-sha256-hash",
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      }).toThrowError(KokoroSynthesisError);

      try {
        verifyKokoroModelDir(
          tmpDir,
          "expected-sha256-hash",
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("SHA-256 checksum mismatch");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies manifest and revision fail-closed with MODEL_LOAD_FAILED", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro-manifest-test-"));
    try {
      const dummyConfig = "dummy-config-content";
      const dummyConfigSha = createHash("sha256").update(dummyConfig).digest("hex");
      const onnxDir = path.join(tmpDir, "onnx");
      fs.mkdirSync(onnxDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "config.json"), dummyConfig);
      fs.writeFileSync(path.join(tmpDir, "tokenizer.json"), dummyConfig);
      fs.writeFileSync(path.join(tmpDir, "tokenizer_config.json"), dummyConfig);
      fs.writeFileSync(path.join(onnxDir, "model_quantized.onnx"), "sample-weights");

      // Subcase 1: Manifest missing entirely
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("manifest missing");
      }

      // Subcase 2: Manifest invalid JSON
      fs.writeFileSync(path.join(tmpDir, "model_manifest.json"), "not-valid-json{");
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("invalid JSON");
      }

      // Subcase 3: Revision mismatch
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "wrong-revision-hash",
          sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha
        })
      );
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("revision mismatch");
      }

      // Subcase 4: Model ID mismatch
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "wrong-model-id",
          revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
          sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha
        })
      );
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          undefined,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("model ID mismatch");
      }

      // Subcase 5: Manifest voice SHA-256 mismatch
      const sampleSha = createHash("sha256").update("sample-weights").digest("hex");
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
          sha256: sampleSha,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: "wrong-voice-sha"
          }
        })
      );
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("manifest voice SHA-256 mismatch");
      }

      // Subcase 6: Voice artifact missing
      const pinned = loadPinnedKokoroVersion();
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
          sha256: sampleSha,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: pinned.voiceAfHeartSha256
          }
        })
      );
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("voice artifact missing");
      }

      // Subcase 7: Voice artifact SHA-256 mismatch
      const voicesDir = path.join(tmpDir, "voices");
      fs.mkdirSync(voicesDir, { recursive: true });
      fs.writeFileSync(path.join(voicesDir, "af_heart.bin"), "corrupt-voice-weights");
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          undefined,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("voice SHA-256 checksum mismatch");
      }

      // Subcase 8: config.json file SHA-256 mismatch
      fs.writeFileSync(path.join(voicesDir, "af_heart.bin"), "valid-voice");
      const validVoiceSha = createHash("sha256").update("valid-voice").digest("hex");
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
          sha256: sampleSha,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: validVoiceSha
          }
        })
      );
      fs.writeFileSync(path.join(tmpDir, "config.json"), "tampered-config");
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          validVoiceSha,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          validVoiceSha,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("config SHA-256 checksum mismatch");
      }

      // Subcase 9: manifest configSha256 mismatch
      fs.writeFileSync(path.join(tmpDir, "config.json"), dummyConfig);
      fs.writeFileSync(
        path.join(tmpDir, "model_manifest.json"),
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "1939ad2a8e416c0acfeecc08a694d14ef25f2231",
          sha256: sampleSha,
          configSha256: "wrong-manifest-config-sha",
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: validVoiceSha
          }
        })
      );
      expect(() =>
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          validVoiceSha,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        )
      ).toThrowError(KokoroSynthesisError);
      try {
        verifyKokoroModelDir(
          tmpDir,
          sampleSha,
          undefined,
          undefined,
          validVoiceSha,
          dummyConfigSha,
          dummyConfigSha,
          dummyConfigSha
        );
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("manifest config SHA-256 mismatch");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads pinned version metadata from .kokoro-version or throws on corrupt file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro-version-test-"));
    try {
      // 1. Valid .kokoro-version
      fs.writeFileSync(
        path.join(tmpDir, ".kokoro-version"),
        `KOKORO_MODEL_ID=onnx-community/Kokoro-82M-v1.0-ONNX\n` +
          `KOKORO_MODEL_REVISION=1939ad2a8e416c0acfeecc08a694d14ef25f2231\n` +
          `KOKORO_ONNX_QUANTIZED_SHA256=fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478\n` +
          `KOKORO_CONFIG_SHA256=df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f\n` +
          `KOKORO_TOKENIZER_SHA256=77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34\n` +
          `KOKORO_TOKENIZER_CONFIG_SHA256=be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20\n` +
          `KOKORO_MODEL_DIR=custom/cache/dir\n` +
          `KOKORO_VOICE_AF_HEART_SHA256=d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b\n`
      );

      const parsed = loadPinnedKokoroVersion(tmpDir);
      expect(parsed.modelId).toBe("onnx-community/Kokoro-82M-v1.0-ONNX");
      expect(parsed.modelRevision).toBe("1939ad2a8e416c0acfeecc08a694d14ef25f2231");
      expect(parsed.sha256).toBe(
        "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478"
      );
      expect(parsed.configSha256).toBe(
        "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f"
      );
      expect(parsed.tokenizerSha256).toBe(
        "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34"
      );
      expect(parsed.tokenizerConfigSha256).toBe(
        "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20"
      );
      expect(parsed.modelDir).toBe("custom/cache/dir");
      expect(parsed.voiceAfHeartSha256).toBe(
        "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"
      );

      // 2. Corrupt .kokoro-version missing required variables
      fs.writeFileSync(path.join(tmpDir, ".kokoro-version"), "CORRUPT_KEY=foo\n");
      expect(() => loadPinnedKokoroVersion(tmpDir)).toThrow(KokoroSynthesisError);
      try {
        loadPinnedKokoroVersion(tmpDir);
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exposes immutable model provenance and resolved directory", () => {
    const engine = createKokoroJsEngine();
    expect(engine.modelDir).toBeDefined();
    expect(engine.modelRevision).toBeDefined();
    expect(engine.expectedSha256).toBeDefined();
    expect(engine.modelId).toBeDefined();
    expect(engine.voiceAfHeartSha256).toBeDefined();
    expect(engine.configSha256).toBeDefined();
    expect(engine.tokenizerSha256).toBeDefined();
    expect(engine.tokenizerConfigSha256).toBeDefined();

    const prov = engine.getModelProvenance();
    expect(prov.modelDir).toBe(engine.modelDir);
    expect(prov.modelRevision).toBe(engine.modelRevision);
    expect(prov.sha256).toBe(engine.expectedSha256);
    expect(prov.modelId).toBe(engine.modelId);
    expect(prov.voiceAfHeartSha256).toBe(engine.voiceAfHeartSha256);
    expect(prov.configSha256).toBe(engine.configSha256);
    expect(prov.tokenizerSha256).toBe(engine.tokenizerSha256);
    expect(prov.tokenizerConfigSha256).toBe(engine.tokenizerConfigSha256);
  });
});

describe("KokoroJsEngine utterance splitting and token limits (F-7343b469)", () => {
  it("rejects unsplittable utterance that exceeds maximum token limit with INVALID_INPUT", async () => {
    const mockTts = {
      tokenizer: vi.fn((_phonemes: string) => ({
        input_ids: {
          dims: [1, MAX_MODEL_TOKEN_LIMIT + 50],
          size: MAX_MODEL_TOKEN_LIMIT + 50
        }
      })),
      _validate_voice: vi.fn(() => "a")
    };

    // A continuous string with no spaces or punctuation
    const hugeUnsplittable = "a".repeat(1000);

    await expect(
      splitTextIntoSafeUtterances(
        mockTts as unknown as Parameters<typeof splitTextIntoSafeUtterances>[0],
        hugeUnsplittable,
        "af_heart"
      )
    ).rejects.toThrow(KokoroSynthesisError);

    try {
      await splitTextIntoSafeUtterances(
        mockTts as unknown as Parameters<typeof splitTextIntoSafeUtterances>[0],
        hugeUnsplittable,
        "af_heart"
      );
    } catch (err) {
      expect((err as KokoroSynthesisError).code).toBe("INVALID_INPUT");
    }
  });
});
