import { describe, expect, it } from "vitest";
import type { SubtitleCue } from "@cco/contracts";
import {
  MAX_CUE_DURATION_MS,
  SUBTITLE_STYLE_PROFILE_ID,
  buildAssDocument,
  escapeAssText,
  escapeFfmpegFilterPath,
  formatAssTimestamp
} from "./subtitle-renderer.js";

describe("subtitle-renderer", () => {
  describe("escapeAssText", () => {
    it("escapes backslashes, braces, and newlines", () => {
      const input = "Line 1 with {special} \\ characters\nLine 2\r\nLine 3";
      const escaped = escapeAssText(input);
      expect(escaped).toBe("Line 1 with \\{special\\} \\\\ characters\\NLine 2\\NLine 3");
    });

    it("handles plain text without changes", () => {
      const input = "Hello world, this is a clean subtitle.";
      expect(escapeAssText(input)).toBe(input);
    });
  });

  describe("formatAssTimestamp", () => {
    it("formats milliseconds to H:MM:SS.cc format", () => {
      expect(formatAssTimestamp(0)).toBe("0:00:00.00");
      expect(formatAssTimestamp(1500)).toBe("0:00:01.50");
      expect(formatAssTimestamp(61230)).toBe("0:01:01.23");
      expect(formatAssTimestamp(3665430)).toBe("1:01:05.43");
    });

    it("throws on negative timestamps", () => {
      expect(() => formatAssTimestamp(-100)).toThrow("Subtitle timestamp cannot be negative");
    });
  });

  describe("escapeFfmpegFilterPath", () => {
    it("escapes colons and single quotes", () => {
      expect(escapeFfmpegFilterPath("/tmp/dir/test:file'name.ass")).toBe(
        "/tmp/dir/test\\:file\\'name.ass"
      );
    });
  });

  describe("buildAssDocument", () => {
    it("generates deterministic ASS document from cues", () => {
      const cues: SubtitleCue[] = [
        { startMs: 0, endMs: 2500, text: "First subtitle" },
        { startMs: 3000, endMs: 5500, text: "Second subtitle with {tags}" }
      ];

      const doc1 = buildAssDocument(cues);
      const doc2 = buildAssDocument(cues);
      expect(doc1).toBe(doc2);

      expect(doc1).toContain("[Script Info]");
      expect(doc1).toContain("PlayResX: 1080");
      expect(doc1).toContain("PlayResY: 1920");
      expect(doc1).toContain("[V4+ Styles]");
      expect(doc1).toContain("Style: Default,Arial,52,&H00FFFFFF");
      expect(doc1).toContain("[Events]");
      expect(doc1).toContain("Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,First subtitle");
      expect(doc1).toContain(
        "Dialogue: 0,0:00:03.00,0:00:05.50,Default,,0,0,0,,Second subtitle with \\{tags\\}"
      );
    });

    it("rejects cue exceeding MAX_CUE_DURATION_MS", () => {
      const cues: SubtitleCue[] = [
        { startMs: 0, endMs: MAX_CUE_DURATION_MS + 100, text: "Too long cue" }
      ];

      expect(() => buildAssDocument(cues)).toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "SUBTITLE_RENDER_FAILED"
        })
      );
    });

    it("exports SUBTITLE_STYLE_PROFILE_ID constant", () => {
      expect(SUBTITLE_STYLE_PROFILE_ID).toBe("VERTICAL_REEL_CENTER_V1");
    });
  });
});
