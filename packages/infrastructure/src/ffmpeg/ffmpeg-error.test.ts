import { describe, expect, it } from "vitest";
import { FfmpegAssemblyError, type FfmpegAssemblyFailureCode } from "./ffmpeg-error.js";

describe("FfmpegAssemblyError", () => {
  it("initializes with name, code, message and context", () => {
    const error = new FfmpegAssemblyError("STEM_HASH_MISMATCH", "Hash does not match", {
      stemOrder: 2,
      expectedSha256: "abc",
      actualSha256: "def"
    });

    expect(error.name).toBe("FfmpegAssemblyError");
    expect(error.code).toBe("STEM_HASH_MISMATCH");
    expect(error.message).toBe("Hash does not match");
    expect(error.context).toEqual({
      stemOrder: 2,
      expectedSha256: "abc",
      actualSha256: "def"
    });
    expect(error).toBeInstanceOf(Error);
  });

  it("handles all typed failure codes", () => {
    const codes: FfmpegAssemblyFailureCode[] = [
      "FFMPEG_NOT_FOUND",
      "FFPROBE_NOT_FOUND",
      "ENCODER_UNAVAILABLE",
      "STEM_FETCH_FAILED",
      "STEM_TOO_LARGE",
      "STEM_HASH_MISMATCH",
      "STEM_PROBE_FAILED",
      "STEM_NO_VIDEO_STREAM",
      "STEM_DURATION_OUT_OF_TOLERANCE",
      "FFMPEG_EXECUTION_FAILED",
      "OUTPUT_PROBE_FAILED",
      "OUTPUT_VALIDATION_FAILED"
    ];

    for (const code of codes) {
      const err = new FfmpegAssemblyError(code, `Testing ${code}`);
      expect(err.code).toBe(code);
      expect(err.message).toBe(`Testing ${code}`);
    }
  });
});
