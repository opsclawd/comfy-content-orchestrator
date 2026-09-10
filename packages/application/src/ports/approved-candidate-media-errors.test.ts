import { describe, expect, it } from "vitest";
import type { CandidateId, ApprovedVisualProductionInput, SceneId } from "@cco/domain";
import type { PersistentMediaRef } from "@cco/contracts";
import {
  ApprovedCandidateMediaUnavailableError,
  ApprovedCandidateMediaHashMismatchError,
  type ResolvedApprovedVisualProductionMedia,
  type ApprovedCandidateMediaUnavailableReason
} from "./approved-candidate-media-errors.js";

describe("Approved candidate media errors & types", () => {
  describe("ApprovedCandidateMediaUnavailableError", () => {
    it.each<ApprovedCandidateMediaUnavailableReason>([
      "missing",
      "unreadable",
      "corrupt",
      "unsupported_content_type"
    ])("instantiates with reason '%s' and candidateId", (reason) => {
      const candidateId = "cand-123" as CandidateId;
      const err = new ApprovedCandidateMediaUnavailableError(candidateId, reason);

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApprovedCandidateMediaUnavailableError);
      expect(err.name).toBe("ApprovedCandidateMediaUnavailableError");
      expect(err.candidateId).toBe(candidateId);
      expect(err.reason).toBe(reason);
      expect(err.message).toContain("cand-123");
      expect(err.message).toContain(reason);
    });

    it("supports optional ErrorOptions (e.g. cause)", () => {
      const cause = new Error("Underlying network failure");
      const err = new ApprovedCandidateMediaUnavailableError(
        "cand-123" as CandidateId,
        "unreadable",
        { cause }
      );
      expect(err.cause).toBe(cause);
    });
  });

  describe("ApprovedCandidateMediaHashMismatchError", () => {
    it("instantiates with expected and actual sha256 hashes", () => {
      const candidateId = "cand-456" as CandidateId;
      const expected = "a".repeat(64);
      const actual = "b".repeat(64);
      const err = new ApprovedCandidateMediaHashMismatchError(candidateId, expected, actual);

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApprovedCandidateMediaHashMismatchError);
      expect(err.name).toBe("ApprovedCandidateMediaHashMismatchError");
      expect(err.candidateId).toBe(candidateId);
      expect(err.expectedSha256).toBe(expected);
      expect(err.actualSha256).toBe(actual);
      expect(err.message).toContain("cand-456");
      expect(err.message).toContain(expected);
      expect(err.message).toContain(actual);
    });

    it("supports optional ErrorOptions (e.g. cause)", () => {
      const cause = new Error("Hash verification abort");
      const err = new ApprovedCandidateMediaHashMismatchError(
        "cand-456" as CandidateId,
        "a".repeat(64),
        "b".repeat(64),
        { cause }
      );
      expect(err.cause).toBe(cause);
    });
  });

  describe("ResolvedApprovedVisualProductionMedia", () => {
    it("composes ApprovedVisualProductionInput and PersistentMediaRef without modification", () => {
      const input: ApprovedVisualProductionInput = {
        candidateId: "cand-789" as CandidateId,
        sceneId: "scene-001" as SceneId,
        specRevision: 2,
        contentHashSha256: "c".repeat(64),
        variantOrdinal: 2
      };

      const media: PersistentMediaRef = {
        bucket: "storyboard-bucket",
        key: "scenes/scene-001/candidates/cand-789.png",
        sha256: "c".repeat(64),
        contentType: "image/png"
      };

      const resolved: ResolvedApprovedVisualProductionMedia = {
        input,
        media
      };

      expect(resolved.input).toBe(input);
      expect(resolved.media).toBe(media);
      expect(resolved.input.candidateId).toBe("cand-789");
      expect(resolved.input.variantOrdinal).toBe(2);
      expect(resolved.media.sha256).toBe(resolved.input.contentHashSha256);
    });
  });
});
