import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { PiperVoiceSynthesisAdapter } from "./piper-voice-synthesis-adapter.js";
import { PiperHttpClient } from "./piper-client.js";
import { PiperSynthesisError } from "./piper-error.js";
import { decodeWav } from "./wav-decoder.js";
import { findRepoRoot, loadPinnedPiperVersion, type PinnedPiperVersion } from "./piper-version.js";

describe("PiperVoiceSynthesisAdapter (real inference integration)", () => {
  let startedContainer: StartedTestContainer | undefined;
  let adapter: PiperVoiceSynthesisAdapter;
  let client: PiperHttpClient;
  let pinned: PinnedPiperVersion;
  let declaredSampleRateHz: number;

  beforeAll(async () => {
    const repoRoot = findRepoRoot();
    pinned = loadPinnedPiperVersion(repoRoot);

    const voiceDir = path.resolve(repoRoot, pinned.voiceDir);
    const modelFile = path.join(voiceDir, `${pinned.voiceId}.onnx`);
    const configFile = path.join(voiceDir, `${pinned.voiceId}.onnx.json`);

    expect(fs.existsSync(modelFile)).toBe(true);
    expect(fs.existsSync(configFile)).toBe(true);
    const voiceConfig = JSON.parse(fs.readFileSync(configFile, "utf8")) as {
      audio?: { sample_rate?: number };
    };
    declaredSampleRateHz = voiceConfig.audio?.sample_rate ?? 0;
    expect(declaredSampleRateHz).toBeGreaterThan(0);

    const dockerContext = path.resolve(repoRoot, "docker/piper");
    const containerBuilder = await GenericContainer.fromDockerfile(
      dockerContext,
      "Dockerfile"
    ).build();

    startedContainer = await containerBuilder
      .withBindMounts([{ source: voiceDir, target: "/voices", mode: "ro" }])
      .withCommand(["-m", `/voices/${pinned.voiceId}.onnx`])
      .withExposedPorts(5000)
      .withWaitStrategy(Wait.forHttp("/", 5000).forStatusCode(200))
      .start();

    const host = startedContainer.getHost();
    const port = startedContainer.getMappedPort(5000);
    const baseUrl = `http://${host}:${port}`;

    client = new PiperHttpClient(baseUrl);
    adapter = new PiperVoiceSynthesisAdapter(pinned.voiceId, client);
  }, 240_000);

  afterAll(async () => {
    if (startedContainer) {
      await startedContainer.stop();
    }
  });

  it("synthesizes real speech with non-silent audio, valid WAV header, and integer duration", async () => {
    const text = "Piper produces natural and characterful voiceovers for multi-scene production.";
    const result = await adapter.synthesize({
      text,
      voiceId: pinned.voiceId,
      speed: 1.0
    });

    // Output shape assertions
    expect(result.contentType).toBe("audio/wav");
    expect(result.sampleRateHz).toBe(declaredSampleRateHz);
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.audio.length).toBeGreaterThan(44);

    // Well-formed WAV binary decoding via production decodeWav
    const decoded = decodeWav(result.audio);
    expect(decoded.sampleRateHz).toBe(declaredSampleRateHz);
    expect(decoded.numChannels).toBe(1);
    expect(decoded.bitsPerSample).toBe(16);
    expect(decoded.dataByteLength).toBeGreaterThan(1000);
    expect(result.durationMs).toBe(decoded.durationMs);

    // Duration integer math invariant
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);

    // Non-silence verification: compute RMS and peak amplitude across decoded PCM samples
    const view = new DataView(
      result.audio.buffer,
      result.audio.byteOffset,
      result.audio.byteLength
    );
    const sampleCount = decoded.dataByteLength / 2;
    let sumSquares = 0;
    let peakAmplitude = 0;

    // Scan data payload offset dynamically
    const dataOffset = decoded.dataByteOffset;
    for (let i = 0; i < sampleCount; i++) {
      const pcm16 = view.getInt16(dataOffset + i * 2, true);
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
  }, 60_000);

  it("proves speed affects duration end-to-end against the real service (Finding 2 regression)", async () => {
    const text =
      "This sentence is synthesized at two different speeds to verify the length scale parameter.";

    const defaultResult = await adapter.synthesize({
      text,
      voiceId: pinned.voiceId
    });

    const slowerResult = await adapter.synthesize({
      text,
      voiceId: pinned.voiceId,
      speed: 0.8
    });

    const fasterResult = await adapter.synthesize({
      text,
      voiceId: pinned.voiceId,
      speed: 1.3
    });

    // Speed 0.8 must take longer than default speed (1.0)
    expect(slowerResult.durationMs).toBeGreaterThan(defaultResult.durationMs);
    // Measurable difference proves length_scale was actually wired through to Piper
    expect(slowerResult.durationMs - defaultResult.durationMs).toBeGreaterThan(100);

    // Speed 1.3 must be shorter than default speed (1.0)
    expect(fasterResult.durationMs).toBeLessThan(defaultResult.durationMs);
    expect(defaultResult.durationMs - fasterResult.durationMs).toBeGreaterThan(100);
  }, 60_000);

  it("rejects mismatched voiceId with VOICE_NOT_FOUND without making a network call (Finding 4 regression)", async () => {
    const synthesizeSpy = vi.spyOn(client, "synthesize");

    await expect(
      adapter.synthesize({
        text: "This should fail fast before any network call",
        voiceId: "unconfigured-voice"
      })
    ).rejects.toThrowError(PiperSynthesisError);

    try {
      await adapter.synthesize({
        text: "This should fail fast before any network call",
        voiceId: "unconfigured-voice"
      });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("VOICE_NOT_FOUND");
      expect(error.context.requestedVoiceId).toBe("unconfigured-voice");
      expect(error.context.configuredVoiceId).toBe(pinned.voiceId);
    }

    expect(synthesizeSpy).not.toHaveBeenCalled();
    synthesizeSpy.mockRestore();
  });
});
