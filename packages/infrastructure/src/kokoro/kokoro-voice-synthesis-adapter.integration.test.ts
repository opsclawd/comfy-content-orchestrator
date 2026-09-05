import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { KokoroVoiceSynthesisAdapter } from "./kokoro-voice-synthesis-adapter.js";
import {
  createKokoroJsEngine,
  resolveKokoroModelDir,
  verifyKokoroModelDir,
  findRepoRoot,
  loadPinnedKokoroVersion,
  PINNED_KOKORO_MODEL_REVISION,
  PINNED_KOKORO_ONNX_SHA256,
  PINNED_KOKORO_VOICE_AF_HEART_SHA256,
  PINNED_KOKORO_CONFIG_SHA256,
  PINNED_KOKORO_TOKENIZER_SHA256,
  PINNED_KOKORO_TOKENIZER_CONFIG_SHA256
} from "./kokoro-engine.js";
import { KokoroSynthesisError } from "./kokoro-error.js";

describe("KokoroVoiceSynthesisAdapter (real inference integration)", () => {
  beforeAll(() => {
    const repoRoot = findRepoRoot();
    const pinned = loadPinnedKokoroVersion(repoRoot);
    const modelDir = resolveKokoroModelDir();
    verifyKokoroModelDir(
      modelDir,
      pinned.sha256,
      pinned.modelRevision,
      pinned.modelId,
      pinned.voiceAfHeartSha256,
      pinned.configSha256,
      pinned.tokenizerSha256,
      pinned.tokenizerConfigSha256
    );
  });

  it("verifies and loads pinned model artifact then synthesizes real speech with non-silent audio, valid WAV header, and integer duration", async () => {
    // 1. Verify model cache provenance before inference
    const repoRoot = findRepoRoot();
    const pinned = loadPinnedKokoroVersion(repoRoot);
    const modelDir = resolveKokoroModelDir();
    expect(fs.existsSync(modelDir)).toBe(true);

    expect(pinned.modelRevision).toBe(PINNED_KOKORO_MODEL_REVISION);
    expect(pinned.sha256).toBe(PINNED_KOKORO_ONNX_SHA256);
    expect(pinned.voiceAfHeartSha256).toBe(PINNED_KOKORO_VOICE_AF_HEART_SHA256);
    expect(pinned.configSha256).toBe(PINNED_KOKORO_CONFIG_SHA256);
    expect(pinned.tokenizerSha256).toBe(PINNED_KOKORO_TOKENIZER_SHA256);
    expect(pinned.tokenizerConfigSha256).toBe(PINNED_KOKORO_TOKENIZER_CONFIG_SHA256);

    const manifestPath = path.join(modelDir, "model_manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.modelId).toBe(pinned.modelId);
    expect(manifest.revision).toBe(pinned.modelRevision);
    expect(manifest.sha256).toBe(pinned.sha256);
    expect(manifest.configSha256).toBe(pinned.configSha256);
    expect(manifest.tokenizerSha256).toBe(pinned.tokenizerSha256);
    expect(manifest.tokenizerConfigSha256).toBe(pinned.tokenizerConfigSha256);
    expect(manifest.voices?.af_heart).toBe(pinned.voiceAfHeartSha256);
    expect(fs.existsSync(path.join(modelDir, "voices", "af_heart.bin"))).toBe(true);

    // Must pass fail-closed SHA-256 and directory verification
    expect(() =>
      verifyKokoroModelDir(
        modelDir,
        pinned.sha256,
        pinned.modelRevision,
        pinned.modelId,
        pinned.voiceAfHeartSha256,
        pinned.configSha256,
        pinned.tokenizerSha256,
        pinned.tokenizerConfigSha256
      )
    ).not.toThrow();

    // 2. Verify default engine instantiation uses pinned local model directory
    const defaultEngine = createKokoroJsEngine();
    expect(defaultEngine.modelDir).toBe(modelDir);
    expect(defaultEngine.modelRevision).toBe(pinned.modelRevision);
    expect(defaultEngine.expectedSha256).toBe(pinned.sha256);
    expect(defaultEngine.modelId).toBe(pinned.modelId);
    expect(defaultEngine.voiceAfHeartSha256).toBe(pinned.voiceAfHeartSha256);
    expect(defaultEngine.configSha256).toBe(pinned.configSha256);
    expect(defaultEngine.tokenizerSha256).toBe(pinned.tokenizerSha256);
    expect(defaultEngine.tokenizerConfigSha256).toBe(pinned.tokenizerConfigSha256);

    // 3. Instantiate adapter with real pinned Kokoro JS engine
    const engine = createKokoroJsEngine({ modelDir });
    expect(engine.modelDir).toBe(modelDir);
    expect(engine.modelRevision).toBe(pinned.modelRevision);
    expect(engine.expectedSha256).toBe(pinned.sha256);
    expect(engine.modelId).toBe(pinned.modelId);
    expect(engine.voiceAfHeartSha256).toBe(pinned.voiceAfHeartSha256);
    expect(engine.configSha256).toBe(pinned.configSha256);
    expect(engine.tokenizerSha256).toBe(pinned.tokenizerSha256);
    expect(engine.tokenizerConfigSha256).toBe(pinned.tokenizerConfigSha256);
    expect(engine.getModelProvenance()).toEqual({
      modelDir,
      modelRevision: pinned.modelRevision,
      sha256: pinned.sha256,
      modelId: pinned.modelId,
      voiceAfHeartSha256: pinned.voiceAfHeartSha256,
      configSha256: pinned.configSha256,
      tokenizerSha256: pinned.tokenizerSha256,
      tokenizerConfigSha256: pinned.tokenizerConfigSha256
    });

    const adapter = new KokoroVoiceSynthesisAdapter(engine);

    const text = "Kokoro produces clear spoken voiceover for production drafts.";
    const result = await adapter.synthesize({
      text,
      voiceId: "af_heart",
      speed: 1.0
    });

    // Output shape assertions
    expect(result.contentType).toBe("audio/wav");
    expect(result.sampleRateHz).toBe(24000);
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.audio.length).toBeGreaterThan(44);

    // Well-formed WAV binary decoding and independent header validation
    const bytes = result.audio;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const riff = String.fromCharCode(...bytes.subarray(0, 4));
    expect(riff).toBe("RIFF");

    const chunkSize = view.getUint32(4, true);
    expect(chunkSize).toBe(bytes.length - 8);

    const wave = String.fromCharCode(...bytes.subarray(8, 12));
    expect(wave).toBe("WAVE");

    const fmt = String.fromCharCode(...bytes.subarray(12, 16));
    expect(fmt).toBe("fmt ");

    const subchunk1Size = view.getUint32(16, true);
    expect(subchunk1Size).toBe(16);

    const audioFormat = view.getUint16(20, true);
    expect(audioFormat).toBe(1); // 1 = PCM

    const channels = view.getUint16(22, true);
    expect(channels).toBe(1); // 1 = Mono

    const sampleRate = view.getUint32(24, true);
    expect(sampleRate).toBe(24000);

    const byteRate = view.getUint32(28, true);
    expect(byteRate).toBe(48000); // 24000 * 1 channel * 2 bytes/sample

    const blockAlign = view.getUint16(32, true);
    expect(blockAlign).toBe(2);

    const bitsPerSample = view.getUint16(34, true);
    expect(bitsPerSample).toBe(16);

    const dataMarker = String.fromCharCode(...bytes.subarray(36, 40));
    expect(dataMarker).toBe("data");

    const dataSize = view.getUint32(40, true);
    expect(dataSize).toBe(bytes.length - 44);

    const sampleCount = dataSize / 2;
    expect(sampleCount).toBeGreaterThan(1000);

    // Duration integer math invariant
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
    const expectedRoundedDuration = Math.round((sampleCount / sampleRate) * 1000);
    expect(result.durationMs).toBe(expectedRoundedDuration);

    // Non-silence verification: compute RMS amplitude across decoded PCM samples
    let sumSquares = 0;
    let peakAmplitude = 0;
    for (let i = 0; i < sampleCount; i++) {
      const pcm16 = view.getInt16(44 + i * 2, true);
      const normalized = pcm16 / 32768.0;
      sumSquares += normalized * normalized;
      const absSample = Math.abs(normalized);
      if (absSample > peakAmplitude) {
        peakAmplitude = absSample;
      }
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    expect(rms).toBeGreaterThan(0.01);
    expect(peakAmplitude).toBeGreaterThan(0.1);
  }, 120_000);

  it("synthesizes long narration beyond 512 model tokens without truncation or content loss (F-7343b469)", async () => {
    const engine = createKokoroJsEngine();
    const adapter = new KokoroVoiceSynthesisAdapter(engine);

    // 10 distinct sentences totaling ~140 words, well beyond the 512 token boundary
    const sentenceList = [
      "The cinematic landscape opens with towering mountains bathed in morning light.",
      "A quiet breeze sweeps through the valley as the drone descends toward the river.",
      "Engineers and artists collaborate to construct powerful autonomous workflows.",
      "High quality audio synthesis ensures every narration sounds natural and compelling.",
      "Each sequence is timed with precision to align seamlessly with video edits.",
      "Subtitles and captions are generated downstream for maximum accessibility.",
      "Reviewers inspect each candidate frame before final delivery reels are assembled.",
      "Reliable software architecture prevents regressions and guarantees provenance.",
      "Automated pipeline steps enforce license routing policies across all campaigns.",
      "This concludes our comprehensive overview of the next generation media platform."
    ];

    const shortScript = sentenceList.slice(0, 2).join(" ");
    const longScript = sentenceList.join(" ");

    const shortResult = await adapter.synthesize({
      text: shortScript,
      voiceId: "af_heart",
      speed: 1.0
    });

    const longResult = await adapter.synthesize({
      text: longScript,
      voiceId: "af_heart",
      speed: 1.0
    });

    expect(Number.isInteger(longResult.durationMs)).toBe(true);
    expect(longResult.contentType).toBe("audio/wav");

    // The full narration has 5x more sentences than the short script.
    // If text past 512 tokens were silently truncated (as kokoro-js raw generate does),
    // longResult would be roughly equal to or capped near ~28s.
    // Proving content after the 512 token boundary was synthesized:
    expect(longResult.durationMs).toBeGreaterThan(shortResult.durationMs * 3);
    expect(longResult.audio.length).toBeGreaterThan(shortResult.audio.length * 3);
  }, 180_000);

  it("fails closed with MODEL_LOAD_FAILED before synthesis when model cache is invalid or checksum mismatched (F-54d7c752 & F-29fe094e)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-cache-test-"));
    try {
      // 1. Clean/empty cache without model files
      const cleanCacheEngine = createKokoroJsEngine({ modelDir: tmpDir });
      const adapter1 = new KokoroVoiceSynthesisAdapter(cleanCacheEngine);

      await expect(
        adapter1.synthesize({ text: "Test speech", voiceId: "af_heart" })
      ).rejects.toThrow(KokoroSynthesisError);

      try {
        await adapter1.synthesize({ text: "Test speech", voiceId: "af_heart" });
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
      }

      // 2. Model directory with assets but missing manifest
      const dummyConfig = "{}";
      const dummyConfigSha = (await import("node:crypto"))
        .createHash("sha256")
        .update(dummyConfig)
        .digest("hex");
      const onnxDir = path.join(tmpDir, "onnx");
      fs.mkdirSync(onnxDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "config.json"), dummyConfig);
      fs.writeFileSync(path.join(tmpDir, "tokenizer.json"), dummyConfig);
      fs.writeFileSync(path.join(tmpDir, "tokenizer_config.json"), dummyConfig);
      fs.writeFileSync(path.join(onnxDir, "model_quantized.onnx"), "fake-weights");

      const noManifestEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter2 = new KokoroVoiceSynthesisAdapter(noManifestEngine);
      try {
        await adapter2.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on missing manifest");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("manifest missing");
      }

      // 3. Model directory with mismatched revision (e.g. mutable 'main')
      const manifestPath = path.join(tmpDir, "model_manifest.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: "main",
          sha256: PINNED_KOKORO_ONNX_SHA256,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha
        })
      );

      const wrongRevEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter3 = new KokoroVoiceSynthesisAdapter(wrongRevEngine);
      try {
        await adapter3.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on revision mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("revision mismatch");
      }

      // 4. Model directory with correct revision in manifest but mismatched SHA-256 on model weights
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: PINNED_KOKORO_MODEL_REVISION,
          sha256: PINNED_KOKORO_ONNX_SHA256,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha
        })
      );

      const wrongShaEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter4 = new KokoroVoiceSynthesisAdapter(wrongShaEngine);
      try {
        await adapter4.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on SHA-256 mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("SHA-256 checksum mismatch");
      }

      // 5. Model directory with mismatched modelId in manifest
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "unpinned/wrong-model-id",
          revision: PINNED_KOKORO_MODEL_REVISION,
          sha256: PINNED_KOKORO_ONNX_SHA256,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha
        })
      );

      const wrongIdEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter5 = new KokoroVoiceSynthesisAdapter(wrongIdEngine);
      try {
        await adapter5.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on modelId mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("model ID mismatch");
      }

      // 6. Model directory with valid model files and manifest, but missing voices/af_heart.bin (F-5ae9ee8d)
      fs.writeFileSync(path.join(tmpDir, "onnx", "model_quantized.onnx"), "weights-content");
      const computedOnnxSha = (await import("node:crypto"))
        .createHash("sha256")
        .update("weights-content")
        .digest("hex");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: PINNED_KOKORO_MODEL_REVISION,
          sha256: computedOnnxSha,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: PINNED_KOKORO_VOICE_AF_HEART_SHA256
          }
        })
      );

      const missingVoiceEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedSha256: computedOnnxSha,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter6 = new KokoroVoiceSynthesisAdapter(missingVoiceEngine);
      try {
        await adapter6.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on missing voice artifact");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("voice artifact missing");
      }

      // 7. Model directory with mismatched SHA-256 for voices/af_heart.bin (F-5ae9ee8d)
      const voicesDir = path.join(tmpDir, "voices");
      fs.mkdirSync(voicesDir, { recursive: true });
      fs.writeFileSync(path.join(voicesDir, "af_heart.bin"), "corrupted-voice-bytes");

      const corruptedVoiceEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedSha256: computedOnnxSha,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter7 = new KokoroVoiceSynthesisAdapter(corruptedVoiceEngine);
      try {
        await adapter7.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on voice SHA-256 mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("voice SHA-256 checksum mismatch");
      }

      // 8. Model directory with mismatched voice SHA-256 in manifest (F-5ae9ee8d)
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: PINNED_KOKORO_MODEL_REVISION,
          sha256: computedOnnxSha,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: "tampered-manifest-voice-sha"
          }
        })
      );

      const wrongManifestVoiceEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedSha256: computedOnnxSha,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter8 = new KokoroVoiceSynthesisAdapter(wrongManifestVoiceEngine);
      try {
        await adapter8.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on manifest voice mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("manifest voice SHA-256 mismatch");
      }

      // 9. Model directory with mismatched config.json SHA-256 (F-54d7c752 & F-29fe094e)
      fs.writeFileSync(path.join(voicesDir, "af_heart.bin"), "valid-voice");
      const validVoiceSha = (await import("node:crypto"))
        .createHash("sha256")
        .update("valid-voice")
        .digest("hex");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: PINNED_KOKORO_MODEL_REVISION,
          sha256: computedOnnxSha,
          configSha256: dummyConfigSha,
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: validVoiceSha
          }
        })
      );
      fs.writeFileSync(path.join(tmpDir, "config.json"), "tampered-config-file");

      const corruptedConfigEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedSha256: computedOnnxSha,
        expectedVoiceSha256: validVoiceSha,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter9 = new KokoroVoiceSynthesisAdapter(corruptedConfigEngine);
      try {
        await adapter9.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on config SHA-256 mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("config SHA-256 checksum mismatch");
      }

      // 10. Model directory with mismatched manifest configSha256 (F-54d7c752 & F-29fe094e)
      fs.writeFileSync(path.join(tmpDir, "config.json"), dummyConfig);
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
          revision: PINNED_KOKORO_MODEL_REVISION,
          sha256: computedOnnxSha,
          configSha256: "tampered-manifest-config-sha",
          tokenizerSha256: dummyConfigSha,
          tokenizerConfigSha256: dummyConfigSha,
          voices: {
            af_heart: validVoiceSha
          }
        })
      );

      const wrongManifestConfigEngine = createKokoroJsEngine({
        modelDir: tmpDir,
        expectedSha256: computedOnnxSha,
        expectedVoiceSha256: validVoiceSha,
        expectedConfigSha256: dummyConfigSha,
        expectedTokenizerSha256: dummyConfigSha,
        expectedTokenizerConfigSha256: dummyConfigSha
      });
      const adapter10 = new KokoroVoiceSynthesisAdapter(wrongManifestConfigEngine);
      try {
        await adapter10.synthesize({ text: "Test speech", voiceId: "af_heart" });
        expect.unreachable("should have thrown on manifest config mismatch");
      } catch (err) {
        expect((err as KokoroSynthesisError).code).toBe("MODEL_LOAD_FAILED");
        expect((err as Error).message).toContain("manifest config SHA-256 mismatch");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
