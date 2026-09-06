import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ConcreteForcedAlignmentPort,
  ForcedAlignmentInput,
  ForcedAlignmentOutput,
  AlignedWord
} from "@cco/application";
import { WhisperXAlignmentError } from "./whisperx-error.js";
import { type WhisperXSpawnLikeFn, defaultWhisperXSpawnRunner } from "./whisperx-process-runner.js";
import {
  findRepoRoot,
  loadPinnedWhisperXVersion,
  resolveWhisperXPythonPath,
  verifyWhisperXModelDir
} from "./whisperx-engine.js";

export interface WhisperXAlignmentAdapterOptions {
  readonly pythonPath?: string | undefined;
  readonly scriptPath?: string | undefined;
  readonly spawnRunner?: WhisperXSpawnLikeFn | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly modelDir?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly skipPreflight?: boolean | undefined;
}

export class WhisperXAlignmentAdapter implements ConcreteForcedAlignmentPort {
  private readonly workspaceRoot: string;
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly modelDir: string;
  private readonly spawnRunner: WhisperXSpawnLikeFn;
  private readonly timeoutMs: number;
  private readonly skipPreflight: boolean;

  constructor(options: WhisperXAlignmentAdapterOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? findRepoRoot();
    this.pythonPath = options.pythonPath ?? resolveWhisperXPythonPath(this.workspaceRoot);
    this.scriptPath =
      options.scriptPath ?? path.join(this.workspaceRoot, "scripts", "whisperx_align.py");
    const pinned = loadPinnedWhisperXVersion(this.workspaceRoot);
    this.modelDir = options.modelDir ?? path.resolve(this.workspaceRoot, pinned.modelDir);
    this.spawnRunner = options.spawnRunner ?? defaultWhisperXSpawnRunner;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.skipPreflight = options.skipPreflight ?? false;
  }

  async align(input: ForcedAlignmentInput): Promise<ForcedAlignmentOutput> {
    if (!input.audio || input.audio.byteLength === 0) {
      throw new WhisperXAlignmentError("INVALID_INPUT", "Alignment audio must not be empty", {
        text: input.text,
        pythonPath: this.pythonPath,
        scriptPath: this.scriptPath
      });
    }

    if (!input.text || input.text.trim().length === 0) {
      throw new WhisperXAlignmentError("INVALID_INPUT", "Alignment text must not be empty", {
        text: input.text,
        pythonPath: this.pythonPath,
        scriptPath: this.scriptPath
      });
    }

    if (!this.skipPreflight) {
      verifyWhisperXModelDir(this.workspaceRoot, this.pythonPath, this.modelDir);
    }

    const pinned = loadPinnedWhisperXVersion(this.workspaceRoot);

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whisperx-align-"));
    const tmpAudioPath = path.join(tmpDir, "input.wav");
    const tmpTextPath = path.join(tmpDir, "input.txt");

    try {
      await fs.promises.writeFile(tmpAudioPath, input.audio);
      await fs.promises.writeFile(tmpTextPath, input.text, "utf-8");

      const args = [
        this.scriptPath,
        "--audio",
        tmpAudioPath,
        "--text-file",
        tmpTextPath,
        "--language",
        input.language ?? "en",
        "--model-dir",
        this.modelDir,
        "--model-name",
        pinned.alignmentModelId
      ];

      const result = await this.spawnRunner(this.pythonPath, args, {
        timeoutMs: this.timeoutMs
      });

      if (result.exitCode !== 0) {
        throw new WhisperXAlignmentError(
          "ALIGNMENT_FAILED",
          `WhisperX alignment process failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
          {
            command: this.pythonPath,
            args,
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
            pythonPath: this.pythonPath,
            scriptPath: this.scriptPath,
            modelDir: this.modelDir
          }
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout.trim());
      } catch (err: unknown) {
        throw new WhisperXAlignmentError(
          "MALFORMED_OUTPUT",
          `WhisperX output was not valid JSON: ${result.stdout.slice(0, 200)}`,
          {
            stdout: result.stdout,
            stderr: result.stderr,
            pythonPath: this.pythonPath,
            scriptPath: this.scriptPath,
            modelDir: this.modelDir
          },
          { cause: err }
        );
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("words" in parsed) ||
        !Array.isArray((parsed as { words: unknown }).words)
      ) {
        throw new WhisperXAlignmentError(
          "MALFORMED_OUTPUT",
          "WhisperX output missing 'words' array",
          {
            stdout: result.stdout,
            stderr: result.stderr,
            pythonPath: this.pythonPath,
            scriptPath: this.scriptPath,
            modelDir: this.modelDir
          }
        );
      }

      const expectedWords = input.text.trim().split(/\s+/).filter(Boolean);

      const rawWords = (parsed as { words: readonly unknown[] }).words;
      if (rawWords.length === 0) {
        throw new WhisperXAlignmentError(
          "MALFORMED_OUTPUT",
          "WhisperX returned empty words array for non-empty transcript",
          {
            expectedWordsCount: expectedWords.length,
            actualWordsCount: 0,
            stdout: result.stdout,
            stderr: result.stderr,
            pythonPath: this.pythonPath,
            scriptPath: this.scriptPath,
            modelDir: this.modelDir
          }
        );
      }

      if (rawWords.length !== expectedWords.length) {
        throw new WhisperXAlignmentError(
          "MALFORMED_OUTPUT",
          `WhisperX output words count (${rawWords.length}) does not match transcript words count (${expectedWords.length})`,
          {
            expectedWordsCount: expectedWords.length,
            actualWordsCount: rawWords.length,
            stdout: result.stdout,
            stderr: result.stderr,
            pythonPath: this.pythonPath,
            scriptPath: this.scriptPath,
            modelDir: this.modelDir
          }
        );
      }

      const words: AlignedWord[] = [];
      try {
        for (let i = 0; i < rawWords.length; i++) {
          const item = rawWords[i];
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            throw new WhisperXAlignmentError(
              "MALFORMED_OUTPUT",
              `WhisperX output word at index ${i} is not a valid object`,
              {
                item,
                index: i,
                stdout: result.stdout,
                stderr: result.stderr,
                pythonPath: this.pythonPath,
                scriptPath: this.scriptPath,
                modelDir: this.modelDir
              }
            );
          }

          const record = item as Record<string, unknown>;
          if (typeof record["word"] !== "string" || record["word"].trim().length === 0) {
            throw new WhisperXAlignmentError(
              "MALFORMED_OUTPUT",
              `WhisperX output word at index ${i} missing non-empty 'word' text`,
              {
                item: record,
                index: i,
                stdout: result.stdout,
                stderr: result.stderr,
                pythonPath: this.pythonPath,
                scriptPath: this.scriptPath,
                modelDir: this.modelDir
              }
            );
          }

          if (record["word"] !== expectedWords[i]) {
            throw new WhisperXAlignmentError(
              "MALFORMED_OUTPUT",
              `WhisperX output word at index ${i} ('${record["word"]}') does not match transcript word ('${expectedWords[i]}')`,
              {
                item: record,
                index: i,
                expectedWord: expectedWords[i],
                actualWord: record["word"],
                stdout: result.stdout,
                stderr: result.stderr,
                pythonPath: this.pythonPath,
                scriptPath: this.scriptPath,
                modelDir: this.modelDir
              }
            );
          }

          if (typeof record["aligned"] !== "boolean") {
            throw new WhisperXAlignmentError(
              "MALFORMED_OUTPUT",
              `WhisperX output word at index ${i} missing boolean 'aligned' flag`,
              {
                item: record,
                index: i,
                stdout: result.stdout,
                stderr: result.stderr,
                pythonPath: this.pythonPath,
                scriptPath: this.scriptPath,
                modelDir: this.modelDir
              }
            );
          }

          const isAligned = record["aligned"];
          if (isAligned) {
            if (!("start" in record) || !("end" in record)) {
              throw new WhisperXAlignmentError(
                "MALFORMED_OUTPUT",
                `WhisperX aligned word at index ${i} missing start/end timestamps`,
                {
                  item: record,
                  index: i,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  pythonPath: this.pythonPath,
                  scriptPath: this.scriptPath,
                  modelDir: this.modelDir
                }
              );
            }

            const start = record["start"];
            const end = record["end"];
            if (
              typeof start !== "number" ||
              typeof end !== "number" ||
              !Number.isFinite(start) ||
              !Number.isFinite(end)
            ) {
              throw new WhisperXAlignmentError(
                "MALFORMED_OUTPUT",
                `WhisperX aligned word at index ${i} missing finite numeric start/end timestamps`,
                {
                  item: record,
                  index: i,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  pythonPath: this.pythonPath,
                  scriptPath: this.scriptPath,
                  modelDir: this.modelDir
                }
              );
            }

            if (start < 0 || end < 0) {
              throw new WhisperXAlignmentError(
                "MALFORMED_OUTPUT",
                `WhisperX aligned word at index ${i} has negative timestamp: start=${start}, end=${end}`,
                {
                  item: record,
                  index: i,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  pythonPath: this.pythonPath,
                  scriptPath: this.scriptPath,
                  modelDir: this.modelDir
                }
              );
            }

            if (end <= start) {
              throw new WhisperXAlignmentError(
                "MALFORMED_OUTPUT",
                `WhisperX aligned word at index ${i} has invalid range (end <= start): start=${start}, end=${end}`,
                {
                  item: record,
                  index: i,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  pythonPath: this.pythonPath,
                  scriptPath: this.scriptPath,
                  modelDir: this.modelDir
                }
              );
            }

            words.push({
              word: record["word"],
              startMs: Math.round(start * 1000),
              endMs: Math.round(end * 1000),
              aligned: true
            });
          } else {
            if (!("start" in record) || record["start"] !== null) {
              throw new WhisperXAlignmentError(
                "MALFORMED_OUTPUT",
                `WhisperX unaligned word at index ${i} has unexpected non-null start timestamp: ${String(record["start"])}`,
                {
                  item: record,
                  index: i,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  pythonPath: this.pythonPath,
                  scriptPath: this.scriptPath,
                  modelDir: this.modelDir
                }
              );
            }
            if (!("end" in record) || record["end"] !== null) {
              throw new WhisperXAlignmentError(
                "MALFORMED_OUTPUT",
                `WhisperX unaligned word at index ${i} has unexpected non-null end timestamp: ${String(record["end"])}`,
                {
                  item: record,
                  index: i,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  pythonPath: this.pythonPath,
                  scriptPath: this.scriptPath,
                  modelDir: this.modelDir
                }
              );
            }

            words.push({
              word: record["word"],
              startMs: 0,
              endMs: 0,
              aligned: false
            });
          }
        }
      } catch (err: unknown) {
        if (err instanceof WhisperXAlignmentError) {
          throw err;
        }
        throw new WhisperXAlignmentError(
          "MALFORMED_OUTPUT",
          `WhisperX output validation failed: ${err instanceof Error ? err.message : String(err)}`,
          {
            stdout: result.stdout,
            stderr: result.stderr,
            pythonPath: this.pythonPath,
            scriptPath: this.scriptPath,
            modelDir: this.modelDir
          },
          { cause: err }
        );
      }

      return { words };
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
