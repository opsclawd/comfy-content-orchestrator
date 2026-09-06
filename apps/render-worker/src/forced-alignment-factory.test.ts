import { describe, expect, it } from "vitest";
import { WhisperXAlignmentAdapter, type WhisperXSpawnLikeFn } from "@cco/infrastructure";
import { createForcedAlignmentPort } from "./forced-alignment-factory.js";

describe("createForcedAlignmentPort", () => {
  it("creates WhisperXAlignmentAdapter as the default forced alignment port", () => {
    const port = createForcedAlignmentPort({
      whisperx: { skipPreflight: true }
    });
    expect(port).toBeInstanceOf(WhisperXAlignmentAdapter);
  });

  it("accepts custom configuration options", async () => {
    const fakeRunner: WhisperXSpawnLikeFn = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        words: [{ word: "Aligned", start: 0.1, end: 0.5, aligned: true }]
      }),
      stderr: ""
    });

    const port = createForcedAlignmentPort({
      provider: "whisperx",
      whisperx: {
        pythonPath: "/custom/python",
        scriptPath: "/custom/script.py",
        spawnRunner: fakeRunner,
        skipPreflight: true
      }
    });

    expect(port).toBeInstanceOf(WhisperXAlignmentAdapter);
    const result = await port.align({
      audio: new Uint8Array([1, 2, 3, 4]),
      text: "Aligned"
    });
    expect(result.words).toHaveLength(1);
    expect(result.words[0]!.word).toBe("Aligned");
  });
});
