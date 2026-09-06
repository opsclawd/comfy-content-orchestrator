import { describe, expect, it } from "vitest";
import { SubtitleCueSchema } from "@cco/contracts";
import type { AlignedWord, ConcreteForcedAlignmentPort } from "../ports/forced-alignment-port.js";
import {
  GenerateSubtitleCues,
  GenerateSubtitleCuesValidationError,
  groupWordsIntoSubtitleCues
} from "./generate-subtitle-cues.js";

describe("groupWordsIntoSubtitleCues", () => {
  it("returns an empty array when given an empty word list", () => {
    expect(groupWordsIntoSubtitleCues([])).toEqual([]);
  });

  it("groups words respecting default maxWords, maxChars, and maxCueDurationMs", () => {
    const words: AlignedWord[] = [
      { word: "W1", startMs: 0, endMs: 400, aligned: true },
      { word: "W2", startMs: 450, endMs: 900, aligned: true },
      { word: "W3", startMs: 950, endMs: 1400, aligned: true },
      { word: "W4", startMs: 1450, endMs: 1900, aligned: true },
      { word: "W5", startMs: 1950, endMs: 2400, aligned: true },
      { word: "W6", startMs: 2450, endMs: 2900, aligned: true },
      { word: "W7", startMs: 2950, endMs: 3400, aligned: true },
      { word: "W8", startMs: 3450, endMs: 3900, aligned: true },
      { word: "W9", startMs: 3950, endMs: 4400, aligned: true }
    ];

    // Default maxWords is 8, and "W1 .. W8" is 23 chars (under 42) and duration 3900ms (under 4000ms)
    const cues = groupWordsIntoSubtitleCues(words);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe("W1 W2 W3 W4 W5 W6 W7 W8");
    expect(cues[0]!.startMs).toBe(0);
    expect(cues[0]!.endMs).toBe(3900);
    expect(cues[1]!.text).toBe("W9");
    expect(cues[1]!.startMs).toBe(3950);
    expect(cues[1]!.endMs).toBe(4400);
  });

  it("breaks early at sentence-ending punctuation", () => {
    const words: AlignedWord[] = [
      { word: "First", startMs: 100, endMs: 300, aligned: true },
      { word: "sentence.", startMs: 350, endMs: 700, aligned: true },
      { word: "Second", startMs: 800, endMs: 1100, aligned: true },
      { word: "sentence!", startMs: 1150, endMs: 1500, aligned: true },
      { word: "Third?", startMs: 1600, endMs: 1900, aligned: true }
    ];

    const cues = groupWordsIntoSubtitleCues(words);
    expect(cues).toHaveLength(3);
    expect(cues[0]!.text).toBe("First sentence.");
    expect(cues[0]!.startMs).toBe(100);
    expect(cues[0]!.endMs).toBe(700);

    expect(cues[1]!.text).toBe("Second sentence!");
    expect(cues[1]!.startMs).toBe(800);
    expect(cues[1]!.endMs).toBe(1500);

    expect(cues[2]!.text).toBe("Third?");
    expect(cues[2]!.startMs).toBe(1600);
    expect(cues[2]!.endMs).toBe(1900);
  });

  it("breaks when maxChars or maxCueDurationMs is exceeded", () => {
    const words: AlignedWord[] = [
      { word: "Short", startMs: 0, endMs: 500, aligned: true },
      { word: "phrase", startMs: 600, endMs: 1200, aligned: true },
      { word: "another", startMs: 1300, endMs: 2000, aligned: true }
    ];

    // maxChars: 12 -> "Short phrase" has 12 chars. Adding " another" exceeds 12 chars
    const charCues = groupWordsIntoSubtitleCues(words, { maxChars: 12 });
    expect(charCues).toHaveLength(2);
    expect(charCues[0]!.text).toBe("Short phrase");
    expect(charCues[1]!.text).toBe("another");

    // maxCueDurationMs: 1000 -> "phrase" ends at 1200, duration 1200 - 0 = 1200 > 1000
    const durCues = groupWordsIntoSubtitleCues(words, { maxCueDurationMs: 1000 });
    expect(durCues).toHaveLength(3);
    expect(durCues[0]!.text).toBe("Short");
    expect(durCues[1]!.text).toBe("phrase");
    expect(durCues[2]!.text).toBe("another");
  });

  describe("interpolation and transcript preservation (Findings 5, 3, F-55916e5c, F-2b8e07f5)", () => {
    it("interpolates unaligned words between aligned words evenly and monotonically", () => {
      const words: AlignedWord[] = [
        { word: "Start", startMs: 100, endMs: 400, aligned: true },
        { word: "unalignedOne", startMs: 0, endMs: 0, aligned: false },
        { word: "unalignedTwo", startMs: 0, endMs: 0, aligned: false },
        { word: "End", startMs: 1000, endMs: 1300, aligned: true }
      ];

      // Window between 400ms and 1000ms is 600ms. Split by 2 words: 300ms each
      // unalignedOne: [400, 700], unalignedTwo: [700, 1000]
      const cues = groupWordsIntoSubtitleCues(words, { maxWords: 10 });
      expect(cues).toHaveLength(1);
      expect(cues[0]!.text).toBe("Start unalignedOne unalignedTwo End");
      expect(cues[0]!.startMs).toBe(100);
      expect(cues[0]!.endMs).toBe(1300);
    });

    it("interpolates leading and trailing unaligned words against 0 and maxDurationMs", () => {
      const words: AlignedWord[] = [
        { word: "Leading", startMs: 0, endMs: 0, aligned: false },
        { word: "Middle", startMs: 500, endMs: 900, aligned: true },
        { word: "Trailing", startMs: 0, endMs: 0, aligned: false }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxDurationMs: 1500, maxWords: 10 });
      expect(cues).toHaveLength(1);
      expect(cues[0]!.text).toBe("Leading Middle Trailing");
      expect(cues[0]!.startMs).toBe(0);
      expect(cues[0]!.endMs).toBe(1500);
    });

    it("preserves zero-width coincident window with maxWords: 1 without dropping unaligned words (F-55916e5c)", () => {
      // Aligned A [0,400], unaligned X, aligned B [400,800], maxWords: 1
      const words: AlignedWord[] = [
        { word: "A", startMs: 0, endMs: 400, aligned: true },
        { word: "X", startMs: 0, endMs: 0, aligned: false },
        { word: "B", startMs: 400, endMs: 800, aligned: true }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxWords: 1 });
      const concatenatedText = cues.map((c) => c.text).join(" ");
      expect(concatenatedText).toBe("A X B");

      for (const cue of cues) {
        expect(cue.endMs).toBeGreaterThan(cue.startMs);
        expect(() => SubtitleCueSchema.parse(cue)).not.toThrow();
      }
    });

    it("preserves trailing unaligned token after punctuated word at maxDurationMs boundary (F-55916e5c & F-2b8e07f5)", () => {
      // Aligned Done. [800, 1000] followed by unaligned missing with maxDurationMs: 1000
      const words: AlignedWord[] = [
        { word: "Done.", startMs: 800, endMs: 1000, aligned: true },
        { word: "missing", startMs: 0, endMs: 0, aligned: false }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxDurationMs: 1000 });
      const concatenatedText = cues.map((c) => c.text).join(" ");
      expect(concatenatedText).toBe("Done. missing");

      for (const cue of cues) {
        expect(cue.endMs).toBeGreaterThan(cue.startMs);
        expect(cue.endMs).toBeLessThanOrEqual(1000);
        expect(() => SubtitleCueSchema.parse(cue)).not.toThrow();
      }
    });

    it("preserves leading unaligned token at zero boundary with maxWords: 1 (F-2b8e07f5)", () => {
      // Unaligned Intro followed by aligned Start [0, 500]
      const words: AlignedWord[] = [
        { word: "Intro", startMs: 0, endMs: 0, aligned: false },
        { word: "Start", startMs: 0, endMs: 500, aligned: true }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxWords: 1 });
      const concatenatedText = cues.map((c) => c.text).join(" ");
      expect(concatenatedText).toBe("Intro Start");

      for (const cue of cues) {
        expect(cue.endMs).toBeGreaterThan(cue.startMs);
        expect(() => SubtitleCueSchema.parse(cue)).not.toThrow();
      }
    });

    it("preserves multiple consecutive zero-gap unaligned tokens", () => {
      const words: AlignedWord[] = [
        { word: "A", startMs: 0, endMs: 400, aligned: true },
        { word: "X", startMs: 0, endMs: 0, aligned: false },
        { word: "Y", startMs: 0, endMs: 0, aligned: false },
        { word: "B", startMs: 400, endMs: 800, aligned: true }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxWords: 1 });
      const concatenatedText = cues.map((c) => c.text).join(" ");
      expect(concatenatedText).toBe("A X Y B");

      for (const cue of cues) {
        expect(cue.endMs).toBeGreaterThan(cue.startMs);
        expect(() => SubtitleCueSchema.parse(cue)).not.toThrow();
      }
    });

    it("produces a single full-duration cue when all words are unaligned", () => {
      const words: AlignedWord[] = [
        { word: "Every", startMs: 0, endMs: 0, aligned: false },
        { word: "single", startMs: 0, endMs: 0, aligned: false },
        { word: "token", startMs: 0, endMs: 0, aligned: false },
        { word: "unaligned", startMs: 0, endMs: 0, aligned: false }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxDurationMs: 4500 });
      expect(cues).toHaveLength(1);
      expect(cues[0]!.text).toBe("Every single token unaligned");
      expect(cues[0]!.startMs).toBe(0);
      expect(cues[0]!.endMs).toBe(4500);
    });

    it("clamps word spanning boundary to maxDurationMs without producing endMs <= startMs", () => {
      // Witness scenario: word aligned 4990ms to 5050ms with maxDurationMs 5000
      const words: AlignedWord[] = [
        { word: "Spanning", startMs: 4990, endMs: 5050, aligned: true }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxDurationMs: 5000 });
      expect(cues).toHaveLength(1);
      expect(cues[0]!.text).toBe("Spanning");
      expect(cues[0]!.startMs).toBe(4990);
      expect(cues[0]!.endMs).toBe(5000);
      expect(cues[0]!.endMs).toBeGreaterThan(cues[0]!.startMs);
    });

    it("filters out words starting at or after maxDurationMs rather than rewriting into the final millisecond (F-ba01d28c)", () => {
      // Word starting exactly at the duration boundary, and a word starting after it
      const words: AlignedWord[] = [
        { word: "InBounds", startMs: 1000, endMs: 2000, aligned: true },
        { word: "AtBoundary", startMs: 5000, endMs: 5100, aligned: true },
        { word: "PastBoundary", startMs: 5050, endMs: 5200, aligned: true }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxDurationMs: 5000 });
      expect(cues).toHaveLength(1);
      expect(cues[0]!.text).toBe("InBounds");
      expect(cues[0]!.startMs).toBe(1000);
      expect(cues[0]!.endMs).toBe(2000);

      const allEmittedWords = cues.flatMap((c) => c.text.split(/\s+/));
      expect(allEmittedWords).toContain("InBounds");
      expect(allEmittedWords).not.toContain("AtBoundary");
      expect(allEmittedWords).not.toContain("PastBoundary");
    });

    it("returns empty array if all words start at or after maxDurationMs", () => {
      const words: AlignedWord[] = [
        { word: "AtBoundary", startMs: 5000, endMs: 5100, aligned: true },
        { word: "PastBoundary", startMs: 5200, endMs: 5400, aligned: true }
      ];

      const cues = groupWordsIntoSubtitleCues(words, { maxDurationMs: 5000 });
      expect(cues).toEqual([]);
    });
  });

  describe("postcondition property test", () => {
    it("strictly guarantees endMs > startMs and exact transcript preservation across all in-bounds fuzzed inputs", () => {
      const sampleWords = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog."];
      const testCasesCount = 50;

      for (let tc = 0; tc < testCasesCount; tc++) {
        const wordCount = 1 + (tc % 15);
        const testWords: AlignedWord[] = [];

        let currentMs = (tc * 73) % 200;
        for (let i = 0; i < wordCount; i++) {
          const isAligned = (tc + i) % 3 !== 0;
          const duration = ((tc * 31 + i * 17) % 600) + 50;
          const startMs = currentMs;
          const endMs = startMs + duration;
          currentMs = endMs + ((tc + i) % 50);

          testWords.push({
            word: sampleWords[i % sampleWords.length]!,
            startMs,
            endMs,
            aligned: isAligned
          });
        }

        const maxDurationMs = currentMs + 500;
        const cues = groupWordsIntoSubtitleCues(testWords, { maxDurationMs });
        for (const cue of cues) {
          expect(cue.endMs).toBeGreaterThan(cue.startMs);
          expect(cue.startMs).toBeGreaterThanOrEqual(0);
          expect(cue.endMs).toBeLessThanOrEqual(maxDurationMs);
          expect(cue.text.trim().length).toBeGreaterThan(0);
          expect(() => SubtitleCueSchema.parse(cue)).not.toThrow();
        }

        // Full transcript preservation: every input word must appear in the combined cue text
        const concatenatedText = cues.map((c) => c.text).join(" ");
        const emittedWords = concatenatedText.split(/\s+/).filter(Boolean);
        const expectedWords = testWords.map((w) => w.word);
        expect(emittedWords).toEqual(expectedWords);
      }
    });

    it("guarantees boundary compliance and excludes words starting at or after maxDurationMs", () => {
      const testCasesCount = 50;

      for (let tc = 0; tc < testCasesCount; tc++) {
        const maxDurationMs = 1000 + (tc % 10) * 500;
        const wordCount = 1 + (tc % 15);
        const testWords: AlignedWord[] = [];

        let currentMs = (tc * 73) % 200;
        for (let i = 0; i < wordCount; i++) {
          const isAligned = (tc + i) % 3 !== 0;
          const duration = ((tc * 31 + i * 17) % 600) + 50;
          const startMs = currentMs;
          const endMs = startMs + duration;
          currentMs = endMs + ((tc + i) % 50);

          testWords.push({
            word: `word${i}`,
            startMs,
            endMs,
            aligned: isAligned
          });
        }

        const cues = groupWordsIntoSubtitleCues(testWords, { maxDurationMs });
        for (const cue of cues) {
          expect(cue.endMs).toBeGreaterThan(cue.startMs);
          expect(cue.startMs).toBeGreaterThanOrEqual(0);
          expect(cue.endMs).toBeLessThanOrEqual(maxDurationMs);
          expect(cue.text.trim().length).toBeGreaterThan(0);
          expect(() => SubtitleCueSchema.parse(cue)).not.toThrow();
        }

        // Any word starting at or after maxDurationMs must never appear in the cues
        const concatenatedText = cues.map((c) => c.text).join(" ");
        const emittedWords = new Set(concatenatedText.split(/\s+/).filter(Boolean));
        for (const w of testWords) {
          if (w.startMs >= maxDurationMs) {
            expect(emittedWords.has(w.word)).toBe(false);
          }
        }
      }
    });
  });
});

describe("GenerateSubtitleCues use case", () => {
  const fakeAudio = new Uint8Array([1, 2, 3, 4]);

  it("generates subtitle cues with timeline offset applied", async () => {
    const fakeAlignmentPort: ConcreteForcedAlignmentPort = {
      align: async (input) => {
        expect(input.language).toBe("en");
        expect(input.text).toBe("Hello world");
        expect(input.audio).toBe(fakeAudio);
        return {
          words: [
            { word: "Hello", startMs: 100, endMs: 500, aligned: true },
            { word: "world", startMs: 600, endMs: 1000, aligned: true }
          ]
        };
      }
    };

    const useCase = new GenerateSubtitleCues({ forcedAlignment: fakeAlignmentPort });
    const cues = await useCase.generate({
      audio: fakeAudio,
      text: "Hello world",
      voiceoverStartMs: 2000,
      voiceoverDurationMs: 1500
    });

    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("Hello world");
    // Offset by voiceoverStartMs = 2000
    expect(cues[0]!.startMs).toBe(2100);
    expect(cues[0]!.endMs).toBe(3000);
    expect(() => SubtitleCueSchema.parse(cues[0])).not.toThrow();
  });

  it("forwards custom language and cueOptions", async () => {
    let capturedLanguage: string | undefined;

    const fakeAlignmentPort: ConcreteForcedAlignmentPort = {
      align: async (input) => {
        capturedLanguage = input.language;
        return {
          words: [
            { word: "Bonjour", startMs: 50, endMs: 400, aligned: true },
            { word: "monde", startMs: 450, endMs: 800, aligned: true }
          ]
        };
      }
    };

    const useCase = new GenerateSubtitleCues({ forcedAlignment: fakeAlignmentPort });
    const cues = await useCase.generate({
      audio: fakeAudio,
      text: "Bonjour monde",
      voiceoverStartMs: 0,
      voiceoverDurationMs: 1000,
      language: "fr",
      cueOptions: { maxWords: 1 }
    });

    expect(capturedLanguage).toBe("fr");
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe("Bonjour");
    expect(cues[1]!.text).toBe("monde");
  });

  it("validates inputs and throws GenerateSubtitleCuesValidationError", async () => {
    const fakeAlignmentPort: ConcreteForcedAlignmentPort = {
      align: async () => ({ words: [] })
    };
    const useCase = new GenerateSubtitleCues({ forcedAlignment: fakeAlignmentPort });

    await expect(
      useCase.generate({
        audio: fakeAudio,
        text: "",
        voiceoverStartMs: 0,
        voiceoverDurationMs: 1000
      })
    ).rejects.toThrow(GenerateSubtitleCuesValidationError);

    await expect(
      useCase.generate({
        audio: new Uint8Array(0),
        text: "test",
        voiceoverStartMs: 0,
        voiceoverDurationMs: 1000
      })
    ).rejects.toThrow(GenerateSubtitleCuesValidationError);

    await expect(
      useCase.generate({
        audio: fakeAudio,
        text: "test",
        voiceoverStartMs: -1,
        voiceoverDurationMs: 1000
      })
    ).rejects.toThrow(GenerateSubtitleCuesValidationError);

    await expect(
      useCase.generate({
        audio: fakeAudio,
        text: "test",
        voiceoverStartMs: 0,
        voiceoverDurationMs: 0
      })
    ).rejects.toThrow(GenerateSubtitleCuesValidationError);
  });
});
