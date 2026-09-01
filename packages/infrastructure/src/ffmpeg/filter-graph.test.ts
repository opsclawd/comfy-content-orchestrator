import { describe, expect, it } from "vitest";
import {
  buildDirectFitGraph,
  buildFfmpegArgs,
  buildFitBlurredFillGraph,
  computeCommandFingerprint,
  selectFilterGraph
} from "./filter-graph.js";

describe("filter-graph & command builder", () => {
  describe("buildFitBlurredFillGraph", () => {
    it("builds correct filter string for single stem", () => {
      const graph = buildFitBlurredFillGraph(1);
      expect(graph).toContain(
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20,setsar=1[bg0]"
      );
      expect(graph).toContain(
        "[0:v]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg0]"
      );
      expect(graph).toContain(
        "[bg0][fg0]overlay=(W-w)/2:(H-h)/2:shortest=1,fps=30,format=yuv420p[v0]"
      );
      expect(graph).toContain("[v0]concat=n=1:v=1:a=0[outv]");
    });

    it("builds correct filter string for multiple stems in sequence", () => {
      const graph = buildFitBlurredFillGraph(3);
      for (let i = 0; i < 3; i++) {
        expect(graph).toContain(
          `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20,setsar=1[bg${i}]`
        );
        expect(graph).toContain(
          `[${i}:v]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg${i}]`
        );
        expect(graph).toContain(
          `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2:shortest=1,fps=30,format=yuv420p[v${i}]`
        );
      }
      expect(graph).toContain("[v0][v1][v2]concat=n=3:v=1:a=0[outv]");
    });

    it("throws if stemCount <= 0", () => {
      expect(() => buildFitBlurredFillGraph(0)).toThrow("stemCount must be at least 1");
    });
  });

  describe("buildDirectFitGraph", () => {
    it("builds direct fit filter string for stems", () => {
      const graph = buildDirectFitGraph(2);
      expect(graph).toContain("[0:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v0]");
      expect(graph).toContain("[1:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v1]");
      expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0[outv]");
    });

    it("throws if stemCount <= 0", () => {
      expect(() => buildDirectFitGraph(0)).toThrow("stemCount must be at least 1");
    });
  });

  describe("selectFilterGraph", () => {
    it("selects fit_blurred_fill", () => {
      const graph = selectFilterGraph("fit_blurred_fill", 2);
      expect(graph).toContain("gblur=sigma=20");
    });

    it("selects direct_fit", () => {
      const graph = selectFilterGraph("direct_fit", 2);
      expect(graph).not.toContain("gblur");
      expect(graph).toContain("scale=1080:1920");
    });
  });

  describe("buildFfmpegArgs", () => {
    it("builds complete argument array without shell interpolation", () => {
      const args = buildFfmpegArgs({
        stagedInputPaths: ["/tmp/s0.mp4", "/tmp/s1.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/tmp/out.mp4",
        crf: 23,
        preset: "veryfast"
      });

      expect(args[0]).toBe("-y");
      expect(args).toContain("-i");
      expect(args).toContain("/tmp/s0.mp4");
      expect(args).toContain("/tmp/s1.mp4");
      expect(args).toContain("-filter_complex");
      expect(args).toContain("-map");
      expect(args).toContain("[outv]");
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-preset");
      expect(args).toContain("veryfast");
      expect(args).toContain("-pix_fmt");
      expect(args).toContain("yuv420p");
      expect(args).toContain("-r");
      expect(args).toContain("30");
      expect(args).toContain("-crf");
      expect(args).toContain("23");
      expect(args).toContain("-movflags");
      expect(args).toContain("+faststart");
      expect(args).toContain("-map_metadata");
      expect(args).toContain("-1");
      expect(args).toContain("-metadata:s:v:0");
      expect(args).toContain("rotate=0");
      expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    });
    it("builds argument array with audio and subtitle options", () => {
      const args = buildFfmpegArgs({
        stagedInputPaths: ["/tmp/s0.mp4", "/tmp/s1.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/tmp/out.mp4",
        stagedVoiceoverPath: "/tmp/vo.wav",
        stagedSoundbedPath: "/tmp/sb.wav",
        subtitleAssPath: "/tmp/subs.ass",
        audioFilterGraph: "[2:a]aformat=stereo[outa]",
        audioEncoding: {
          codec: "aac",
          bitrateKbps: 192,
          sampleRateHz: 48000,
          channels: 2
        }
      });

      expect(args).toContain("-i");
      expect(args).toContain("/tmp/vo.wav");
      expect(args).toContain("/tmp/sb.wav");
      expect(args).toContain("-map");
      expect(args).toContain("[outv_sub]");
      expect(args).toContain("[outa]");
      expect(args).toContain("-c:a");
      expect(args).toContain("aac");
      expect(args).toContain("192k");
    });
  });

  describe("computeCommandFingerprint", () => {
    it("normalizes temporary paths and produces a stable 64-char hex fingerprint", () => {
      const args1 = buildFfmpegArgs({
        stagedInputPaths: ["/tmp/dirA/stem-0.mp4", "/tmp/dirA/stem-1.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/tmp/dirA/output.mp4"
      });
      const fp1 = computeCommandFingerprint(
        args1,
        ["/tmp/dirA/stem-0.mp4", "/tmp/dirA/stem-1.mp4"],
        "/tmp/dirA/output.mp4"
      );

      const args2 = buildFfmpegArgs({
        stagedInputPaths: ["/var/run/customDirB/stem-0.mp4", "/var/run/customDirB/stem-1.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/var/run/customDirB/output.mp4"
      });
      const fp2 = computeCommandFingerprint(
        args2,
        ["/var/run/customDirB/stem-0.mp4", "/var/run/customDirB/stem-1.mp4"],
        "/var/run/customDirB/output.mp4"
      );

      expect(fp1).toMatch(/^[0-9a-f]{64}$/);
      expect(fp2).toMatch(/^[0-9a-f]{64}$/);
      // Different temporary paths must produce identical fingerprints because paths are normalized
      expect(fp1).toBe(fp2);
    });

    it("normalizes audio and subtitle paths in fingerprint", () => {
      const args1 = buildFfmpegArgs({
        stagedInputPaths: ["/tmp/dirA/stem-0.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/tmp/dirA/output.mp4",
        stagedVoiceoverPath: "/tmp/dirA/vo.mp3",
        subtitleAssPath: "/tmp/dirA/subs.ass",
        audioFilterGraph: "[1:a]aformat=stereo[outa]"
      });
      const fp1 = computeCommandFingerprint(
        args1,
        ["/tmp/dirA/stem-0.mp4"],
        "/tmp/dirA/output.mp4",
        {
          stagedVoiceoverPath: "/tmp/dirA/vo.mp3",
          subtitleAssPath: "/tmp/dirA/subs.ass"
        }
      );

      const args2 = buildFfmpegArgs({
        stagedInputPaths: ["/other/dirB/stem-0.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/other/dirB/output.mp4",
        stagedVoiceoverPath: "/other/dirB/vo.mp3",
        subtitleAssPath: "/other/dirB/subs.ass",
        audioFilterGraph: "[1:a]aformat=stereo[outa]"
      });
      const fp2 = computeCommandFingerprint(
        args2,
        ["/other/dirB/stem-0.mp4"],
        "/other/dirB/output.mp4",
        {
          stagedVoiceoverPath: "/other/dirB/vo.mp3",
          subtitleAssPath: "/other/dirB/subs.ass"
        }
      );

      expect(fp1).toBe(fp2);
    });

    it("produces different fingerprint when encoding options or layout change", () => {
      const args1 = buildFfmpegArgs({
        stagedInputPaths: ["/tmp/stem-0.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/tmp/output.mp4",
        crf: 23
      });
      const fp1 = computeCommandFingerprint(args1, ["/tmp/stem-0.mp4"], "/tmp/output.mp4");

      const args2 = buildFfmpegArgs({
        stagedInputPaths: ["/tmp/stem-0.mp4"],
        layoutMode: "fit_blurred_fill",
        outputPath: "/tmp/output.mp4",
        crf: 18
      });
      const fp2 = computeCommandFingerprint(args2, ["/tmp/stem-0.mp4"], "/tmp/output.mp4");

      expect(fp1).not.toBe(fp2);
    });
  });
});
