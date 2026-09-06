import { describe, expect, it } from "vitest";
import { WhisperXAlignmentError } from "./whisperx-error.js";
import { defaultWhisperXSpawnRunner } from "./whisperx-process-runner.js";

describe("defaultWhisperXSpawnRunner", () => {
  it("executes command successfully and captures stdout", async () => {
    const result = await defaultWhisperXSpawnRunner("node", [
      "-e",
      "console.log('test-runner-ok')"
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("test-runner-ok");
    expect(result.stderr).toBe("");
  });

  it("captures non-zero exit code and stderr without rejecting", async () => {
    const result = await defaultWhisperXSpawnRunner("node", [
      "-e",
      "console.error('some-error'); process.exit(42);"
    ]);
    expect(result.exitCode).toBe(42);
    expect(result.stderr.trim()).toBe("some-error");
  });

  it("throws WhisperXAlignmentError with PYTHON_NOT_FOUND on ENOENT and NEVER throws FfmpegAssemblyError (Finding 1 fix)", async () => {
    const nonexistentPath = "/tmp/nonexistent-python-binary-whisperx-test";
    try {
      await defaultWhisperXSpawnRunner(nonexistentPath, ["--version"]);
      expect.unreachable("Should have thrown ENOENT");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WhisperXAlignmentError);
      const alignErr = err as WhisperXAlignmentError;
      expect(alignErr.code).toBe("PYTHON_NOT_FOUND");
      expect(alignErr.name).toBe("WhisperXAlignmentError");
      expect((err as { name?: string }).name).not.toBe("FfmpegAssemblyError");
    }
  });

  it("throws WhisperXAlignmentError with PROCESS_TIMEOUT on timeout and NEVER throws FfmpegAssemblyError (Finding 1 fix)", async () => {
    try {
      await defaultWhisperXSpawnRunner("node", ["-e", "setTimeout(() => {}, 5000)"], {
        timeoutMs: 50
      });
      expect.unreachable("Should have timed out");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WhisperXAlignmentError);
      const alignErr = err as WhisperXAlignmentError;
      expect(alignErr.code).toBe("PROCESS_TIMEOUT");
      expect(alignErr.name).toBe("WhisperXAlignmentError");
      expect((err as { name?: string }).name).not.toBe("FfmpegAssemblyError");
    }
  });
});
