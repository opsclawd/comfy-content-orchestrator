import { beforeAll, describe, expect, it } from "vitest";
import { groupWordsIntoSubtitleCues } from "@cco/application";
import { WhisperXAlignmentAdapter } from "./whisperx-alignment-adapter.js";
import {
  findRepoRoot,
  loadPinnedWhisperXVersion,
  resolveWhisperXPythonPath,
  verifyWhisperXModelDir
} from "./whisperx-engine.js";
import { createKokoroJsEngine } from "../kokoro/kokoro-engine.js";
import { KokoroVoiceSynthesisAdapter } from "../kokoro/kokoro-voice-synthesis-adapter.js";

describe("WhisperXAlignmentAdapter (integration with real model/venv)", () => {
  beforeAll(() => {
    const repoRoot = findRepoRoot();
    verifyWhisperXModelDir(repoRoot);
  });

  it("aligns real synthesized speech with measured timestamps and interpolates hard tokens (F-70cd4f12 & F-72d9cec6)", async () => {
    const repoRoot = findRepoRoot();
    const pinned = loadPinnedWhisperXVersion(repoRoot);
    expect(pinned.alignmentModelId).toBeDefined();
    const pythonPath = resolveWhisperXPythonPath(repoRoot);

    const adapter = new WhisperXAlignmentAdapter({
      workspaceRoot: repoRoot,
      pythonPath
    });

    // 1. Synthesize real intelligible speech using Kokoro
    const kokoroEngine = createKokoroJsEngine();
    const kokoroAdapter = new KokoroVoiceSynthesisAdapter(kokoroEngine);
    const spokenText = "Welcome to test subtitle alignment.";
    const synthResult = await kokoroAdapter.synthesize({
      text: spokenText,
      voiceId: "af_heart",
      speed: 1.0
    });
    const audio = synthResult.audio;
    const durationMs = synthResult.durationMs;
    expect(audio.byteLength).toBeGreaterThan(0);
    expect(durationMs).toBeGreaterThan(1000);

    // 2. Align synthesized audio against transcript with a deliberately unalignable hard token ('123')
    const transcript = "Welcome to test 123 subtitle alignment.";
    const result = await adapter.align({
      audio,
      text: transcript,
      language: "en"
    });

    // Positional coverage: every word from transcript is present in exact order
    expect(result.words.length).toBe(6);
    const outputText = result.words.map((w) => w.word).join(" ");
    expect(outputText).toBe(transcript);

    // Verified measured words (aligned: true)
    const welcomeWord = result.words.find((w) => w.word === "Welcome")!;
    expect(welcomeWord.aligned).toBe(true);
    expect(welcomeWord.startMs).toBeGreaterThanOrEqual(0);
    expect(welcomeWord.startMs).toBeLessThan(1000);
    expect(welcomeWord.endMs).toBeGreaterThan(welcomeWord.startMs);

    const testWord = result.words.find((w) => w.word === "test")!;
    expect(testWord.aligned).toBe(true);
    expect(testWord.startMs).toBeGreaterThanOrEqual(welcomeWord.startMs);
    expect(testWord.endMs).toBeGreaterThan(testWord.startMs);

    const alignmentWord = result.words.find((w) => w.word === "alignment.")!;
    expect(alignmentWord.aligned).toBe(true);
    expect(alignmentWord.startMs).toBeGreaterThan(testWord.startMs);
    expect(alignmentWord.endMs).toBeGreaterThan(alignmentWord.startMs);
    expect(alignmentWord.endMs).toBeLessThanOrEqual(durationMs + 200);

    // Monotonicity of measured words
    const measuredWords = result.words.filter((w) => w.aligned);
    expect(measuredWords.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < measuredWords.length - 1; i++) {
      expect(measuredWords[i + 1]!.startMs).toBeGreaterThanOrEqual(measuredWords[i]!.startMs);
    }

    // Deliberately hard-to-align token ('123') is not measured
    const hardToken = result.words.find((w) => w.word === "123")!;
    expect(hardToken.aligned).toBe(false);

    // Grouping into cues preserves all tokens, including interpolated '123'
    const cues = groupWordsIntoSubtitleCues(result.words, { maxDurationMs: durationMs });
    expect(cues.length).toBeGreaterThan(0);
    const combinedCuesText = cues.map((c) => c.text).join(" ");
    expect(combinedCuesText).toContain("123");
    expect(combinedCuesText.split(/\s+/).filter(Boolean)).toEqual(
      transcript.split(/\s+/).filter(Boolean)
    );

    // All cues satisfy the conditional invariant endMs > startMs and clip duration
    for (const cue of cues) {
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
      expect(cue.startMs).toBeGreaterThanOrEqual(0);
      expect(cue.endMs).toBeLessThanOrEqual(durationMs);
    }
  });
});
