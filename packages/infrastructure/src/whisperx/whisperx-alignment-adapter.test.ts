import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhisperXAlignmentAdapter } from "./whisperx-alignment-adapter.js";
import { WhisperXAlignmentError } from "./whisperx-error.js";
import type { WhisperXSpawnLikeFn } from "./whisperx-process-runner.js";

describe("WhisperXAlignmentAdapter", () => {
  let tmpDir: string;
  const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisperx-adapter-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails fast with MODEL_LOAD_FAILED when pinned model environment is missing (preflight)", async () => {
    const adapter = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      skipPreflight: false
    });

    await expect(
      adapter.align({
        audio: fakeAudio,
        text: "Hello world"
      })
    ).rejects.toThrow(WhisperXAlignmentError);

    try {
      await adapter.align({
        audio: fakeAudio,
        text: "Hello world"
      });
    } catch (err: unknown) {
      const alignErr = err as WhisperXAlignmentError;
      expect(alignErr.code).toBe("MODEL_LOAD_FAILED");
      expect(alignErr.message).toContain("scripts/install-whisperx.sh");
    }
  });

  it("validates input and throws INVALID_INPUT on empty audio or text", async () => {
    const adapter = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      skipPreflight: true
    });

    await expect(
      adapter.align({
        audio: new Uint8Array(0),
        text: "Hello"
      })
    ).rejects.toThrow(WhisperXAlignmentError);

    await expect(
      adapter.align({
        audio: fakeAudio,
        text: ""
      })
    ).rejects.toThrow(WhisperXAlignmentError);

    await expect(
      adapter.align({
        audio: fakeAudio,
        text: "   "
      })
    ).rejects.toThrow(WhisperXAlignmentError);
  });

  it("constructs correct argv with --model-dir and --model-name, writes temp files, and parses aligned output", async () => {
    let capturedCommand: string | undefined;
    let capturedArgs: readonly string[] | undefined;
    let capturedAudioContent: Buffer | undefined;
    let capturedTextContent: string | undefined;

    const fakeRunner: WhisperXSpawnLikeFn = async (command, args) => {
      capturedCommand = command;
      capturedArgs = args;

      const audioIdx = args.indexOf("--audio");
      const textIdx = args.indexOf("--text-file");
      if (audioIdx !== -1 && args[audioIdx + 1]) {
        capturedAudioContent = fs.readFileSync(args[audioIdx + 1]!);
      }
      if (textIdx !== -1 && args[textIdx + 1]) {
        capturedTextContent = fs.readFileSync(args[textIdx + 1]!, "utf-8");
      }

      const stdout = JSON.stringify({
        words: [
          { word: "Hello", start: 0.1, end: 0.5, aligned: true },
          { word: "world", start: 0.6, end: 1.0, aligned: true }
        ]
      });

      return {
        exitCode: 0,
        stdout,
        stderr: ""
      };
    };

    const adapter = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      pythonPath: "/mock/bin/python3",
      scriptPath: "/mock/scripts/whisperx_align.py",
      spawnRunner: fakeRunner,
      skipPreflight: true
    });

    const result = await adapter.align({
      audio: fakeAudio,
      text: "Hello world",
      language: "en"
    });

    expect(capturedCommand).toBe("/mock/bin/python3");
    expect(capturedArgs).toEqual([
      "/mock/scripts/whisperx_align.py",
      "--audio",
      expect.stringContaining("input.wav"),
      "--text-file",
      expect.stringContaining("input.txt"),
      "--language",
      "en",
      "--model-dir",
      expect.stringContaining("node_modules/.cache/whisperx-model"),
      "--model-name",
      "WAV2VEC2_ASR_BASE_960H"
    ]);
    expect(capturedAudioContent).toEqual(Buffer.from(fakeAudio));
    expect(capturedTextContent).toBe("Hello world");

    expect(result.words).toHaveLength(2);
    expect(result.words[0]).toEqual({
      word: "Hello",
      startMs: 100,
      endMs: 500,
      aligned: true
    });
    expect(result.words[1]).toEqual({
      word: "world",
      startMs: 600,
      endMs: 1000,
      aligned: true
    });
  });

  it("handles unaligned words from python script and preserves them with aligned: false", async () => {
    const fakeRunner: WhisperXSpawnLikeFn = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        words: [
          { word: "First", start: 0.2, end: 0.6, aligned: true },
          { word: "second", start: null, end: null, aligned: false }
        ]
      }),
      stderr: ""
    });

    const adapter = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      spawnRunner: fakeRunner,
      skipPreflight: true
    });

    const result = await adapter.align({
      audio: fakeAudio,
      text: "First second"
    });

    expect(result.words).toHaveLength(2);
    expect(result.words[0]!.aligned).toBe(true);
    expect(result.words[1]!.aligned).toBe(false);
    expect(result.words[1]!.word).toBe("second");
  });

  it("throws ALIGNMENT_FAILED on non-zero process exit", async () => {
    const fakeRunner: WhisperXSpawnLikeFn = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Torch CUDA out of memory"
    });

    const adapter = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      spawnRunner: fakeRunner,
      skipPreflight: true
    });

    await expect(
      adapter.align({
        audio: fakeAudio,
        text: "Test"
      })
    ).rejects.toThrow(WhisperXAlignmentError);

    try {
      await adapter.align({
        audio: fakeAudio,
        text: "Test"
      });
    } catch (err: unknown) {
      const alignErr = err as WhisperXAlignmentError;
      expect(alignErr.code).toBe("ALIGNMENT_FAILED");
      expect(alignErr.message).toContain("Torch CUDA out of memory");
    }
  });

  it("throws MALFORMED_OUTPUT on invalid JSON or missing words array", async () => {
    const fakeRunnerNonJson: WhisperXSpawnLikeFn = async () => ({
      exitCode: 0,
      stdout: "not-json-output",
      stderr: ""
    });

    const adapterNonJson = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      spawnRunner: fakeRunnerNonJson,
      skipPreflight: true
    });

    await expect(adapterNonJson.align({ audio: fakeAudio, text: "Test" })).rejects.toThrow(
      WhisperXAlignmentError
    );

    const fakeRunnerMissingWords: WhisperXSpawnLikeFn = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ unexpectedKey: 123 }),
      stderr: ""
    });

    const adapterMissingWords = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      spawnRunner: fakeRunnerMissingWords,
      skipPreflight: true
    });

    await expect(adapterMissingWords.align({ audio: fakeAudio, text: "Test" })).rejects.toThrow(
      WhisperXAlignmentError
    );
  });

  describe("strict output validation (F-ed38bf97 & F-70f06146)", () => {
    it.each([
      ["null word entry", JSON.stringify({ words: [null] })],
      ["empty object entry", JSON.stringify({ words: [{}] })],
      ["missing word text", JSON.stringify({ words: [{ aligned: false }] })],
      ["empty word text", JSON.stringify({ words: [{ word: "", aligned: false }] })],
      ["missing aligned boolean", JSON.stringify({ words: [{ word: "test" }] })],
      [
        "inverted timestamps (end <= start)",
        JSON.stringify({ words: [{ word: "test", aligned: true, start: 1.0, end: 0.5 }] })
      ],
      [
        "negative timestamp",
        JSON.stringify({ words: [{ word: "test", aligned: true, start: -0.1, end: 0.5 }] })
      ],
      [
        "non-numeric timestamp",
        JSON.stringify({ words: [{ word: "test", aligned: true, start: "zero", end: 1.0 }] })
      ],
      [
        "unaligned with non-null start",
        JSON.stringify({ words: [{ word: "test", aligned: false, start: 0.5, end: null }] })
      ],
      [
        "unaligned with non-null end",
        JSON.stringify({ words: [{ word: "test", aligned: false, start: null, end: 1.0 }] })
      ],
      [
        "unaligned with missing start",
        JSON.stringify({ words: [{ word: "test", aligned: false, end: null }] })
      ],
      [
        "unaligned with missing end",
        JSON.stringify({ words: [{ word: "test", aligned: false, start: null }] })
      ],
      [
        "unaligned with missing start and end",
        JSON.stringify({ words: [{ word: "test", aligned: false }] })
      ],
      [
        "aligned with missing start",
        JSON.stringify({ words: [{ word: "test", aligned: true, end: 1.0 }] })
      ],
      [
        "aligned with missing end",
        JSON.stringify({ words: [{ word: "test", aligned: true, start: 0.0 }] })
      ],
      ["empty words array for non-empty transcript", JSON.stringify({ words: [] })]
    ])("throws MALFORMED_OUTPUT when receiving %s", async (_, corruptStdout) => {
      const fakeRunner: WhisperXSpawnLikeFn = async () => ({
        exitCode: 0,
        stdout: corruptStdout,
        stderr: ""
      });

      const adapter = new WhisperXAlignmentAdapter({
        workspaceRoot: tmpDir,
        spawnRunner: fakeRunner,
        skipPreflight: true
      });

      try {
        await adapter.align({ audio: fakeAudio, text: "test" });
        expect.unreachable("should have thrown MALFORMED_OUTPUT");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WhisperXAlignmentError);
        const alignErr = err as WhisperXAlignmentError;
        expect(alignErr.code).toBe("MALFORMED_OUTPUT");
        expect(alignErr.context).toBeDefined();
        expect(alignErr.context!["pythonPath"]).toBeDefined();
        expect(alignErr.context!["scriptPath"]).toBeDefined();
      }
    });

    it("throws MALFORMED_OUTPUT when output omits transcript words (AC-1 & F-70f06146)", async () => {
      // The witness scenario from code review:
      // Multi-word transcript where subprocess output only returns the first word
      const fakeRunner: WhisperXSpawnLikeFn = async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          words: [{ word: "first", aligned: false, start: null, end: null }]
        }),
        stderr: ""
      });

      const adapter = new WhisperXAlignmentAdapter({
        workspaceRoot: tmpDir,
        spawnRunner: fakeRunner,
        skipPreflight: true
      });

      await expect(
        adapter.align({
          audio: fakeAudio,
          text: "first second third"
        })
      ).rejects.toThrow(WhisperXAlignmentError);

      try {
        await adapter.align({
          audio: fakeAudio,
          text: "first second third"
        });
      } catch (err: unknown) {
        const alignErr = err as WhisperXAlignmentError;
        expect(alignErr.code).toBe("MALFORMED_OUTPUT");
        expect(alignErr.message).toContain(
          "words count (1) does not match transcript words count (3)"
        );
        expect(alignErr.context?.["expectedWordsCount"]).toBe(3);
        expect(alignErr.context?.["actualWordsCount"]).toBe(1);
      }
    });

    it("throws MALFORMED_OUTPUT when output word does not match transcript word", async () => {
      const fakeRunner: WhisperXSpawnLikeFn = async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          words: [
            { word: "first", aligned: true, start: 0.1, end: 0.5 },
            { word: "mismatched", aligned: true, start: 0.6, end: 1.0 }
          ]
        }),
        stderr: ""
      });

      const adapter = new WhisperXAlignmentAdapter({
        workspaceRoot: tmpDir,
        spawnRunner: fakeRunner,
        skipPreflight: true
      });

      await expect(
        adapter.align({
          audio: fakeAudio,
          text: "first second"
        })
      ).rejects.toThrow(WhisperXAlignmentError);

      try {
        await adapter.align({
          audio: fakeAudio,
          text: "first second"
        });
      } catch (err: unknown) {
        const alignErr = err as WhisperXAlignmentError;
        expect(alignErr.code).toBe("MALFORMED_OUTPUT");
        expect(alignErr.message).toContain("does not match transcript word ('second')");
        expect(alignErr.context?.["expectedWord"]).toBe("second");
        expect(alignErr.context?.["actualWord"]).toBe("mismatched");
      }
    });

    it("parses stdout with surrounding whitespace or newlines correctly", async () => {
      const fakeRunner: WhisperXSpawnLikeFn = async () => ({
        exitCode: 0,
        stdout: `  \n\n${JSON.stringify({
          words: [{ word: "Padded", start: 0.1, end: 0.5, aligned: true }]
        })}\n\n  `,
        stderr: "diagnostic log on stderr"
      });

      const adapter = new WhisperXAlignmentAdapter({
        workspaceRoot: tmpDir,
        spawnRunner: fakeRunner,
        skipPreflight: true
      });

      const result = await adapter.align({ audio: fakeAudio, text: "Padded" });
      expect(result.words).toHaveLength(1);
      expect(result.words[0]!.word).toBe("Padded");
      expect(result.words[0]!.startMs).toBe(100);
      expect(result.words[0]!.endMs).toBe(500);
    });
  });

  it("propagates spawn runner PYTHON_NOT_FOUND and PROCESS_TIMEOUT untouched", async () => {
    const fakeRunnerNotFound: WhisperXSpawnLikeFn = async () => {
      throw new WhisperXAlignmentError("PYTHON_NOT_FOUND", "python3 missing");
    };

    const adapterNotFound = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      spawnRunner: fakeRunnerNotFound,
      skipPreflight: true
    });

    try {
      await adapterNotFound.align({ audio: fakeAudio, text: "Test" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WhisperXAlignmentError);
      expect((err as WhisperXAlignmentError).code).toBe("PYTHON_NOT_FOUND");
    }

    const fakeRunnerTimeout: WhisperXSpawnLikeFn = async () => {
      throw new WhisperXAlignmentError("PROCESS_TIMEOUT", "timed out");
    };

    const adapterTimeout = new WhisperXAlignmentAdapter({
      workspaceRoot: tmpDir,
      spawnRunner: fakeRunnerTimeout,
      skipPreflight: true
    });

    try {
      await adapterTimeout.align({ audio: fakeAudio, text: "Test" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WhisperXAlignmentError);
      expect((err as WhisperXAlignmentError).code).toBe("PROCESS_TIMEOUT");
    }
  });
});
