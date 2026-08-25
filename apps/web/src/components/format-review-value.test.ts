import { describe, expect, it } from "vitest";
import {
  formatSceneStatus,
  formatReviewAction,
  formatDurationMs,
  formatDateTime
} from "./format-review-value.js";

describe("format-review-value helpers", () => {
  describe("formatSceneStatus", () => {
    it("formats known scene statuses into human-readable labels", () => {
      expect(formatSceneStatus("draft_pending")).toBe("Draft Pending");
      expect(formatSceneStatus("generating_candidates")).toBe("Generating Candidates");
      expect(formatSceneStatus("director_review")).toBe("Director Review");
      expect(formatSceneStatus("approved")).toBe("Approved");
      expect(formatSceneStatus("completed")).toBe("Completed");
    });

    it("falls back to raw status string for unknown status values", () => {
      expect(formatSceneStatus("custom_status" as unknown as "approved")).toBe("custom_status");
    });
  });

  describe("formatReviewAction", () => {
    it("formats known review actions into human-readable labels", () => {
      expect(formatReviewAction("approve")).toBe("Approve");
      expect(formatReviewAction("reject")).toBe("Reject");
      expect(formatReviewAction("reroll")).toBe("Reroll");
      expect(formatReviewAction("prompt_edit")).toBe("Edit Prompt");
      expect(formatReviewAction("candidate_select")).toBe("Select Candidate");
    });

    it("falls back to raw action string for unknown action values", () => {
      expect(formatReviewAction("custom_action" as unknown as "approve")).toBe("custom_action");
    });
  });

  describe("formatDurationMs", () => {
    it("formats duration in milliseconds and seconds", () => {
      expect(formatDurationMs(4500)).toBe("4500 ms (4.50s)");
      expect(formatDurationMs(1000)).toBe("1000 ms (1.00s)");
      expect(formatDurationMs(0)).toBe("0 ms (0.00s)");
      expect(formatDurationMs(250)).toBe("250 ms (0.25s)");
    });
  });

  describe("formatDateTime", () => {
    it("formats a valid ISO timestamp to a readable UTC date time string", () => {
      const formatted = formatDateTime("2026-08-25T14:30:00.000Z");
      expect(formatted).toBe("Aug 25, 2026, 2:30:00 PM UTC");
    });

    it("handles different times and dates accurately in UTC", () => {
      expect(formatDateTime("2026-01-01T00:00:00.000Z")).toBe("Jan 1, 2026, 12:00:00 AM UTC");
      expect(formatDateTime("2026-12-31T23:59:59.000Z")).toBe("Dec 31, 2026, 11:59:59 PM UTC");
    });

    it("gracefully returns the input string if parsing fails", () => {
      expect(formatDateTime("not-a-date")).toBe("not-a-date");
      expect(formatDateTime("")).toBe("");
    });
  });
});
