import { describe, it, expect } from "vitest";
import {
  classifyError,
  isRetryable,
  isSafetyRefusalSignal,
  type ClassifiableFailure
} from "./api-failure-classification.js";

describe("api-failure-classification", () => {
  describe("classifyError", () => {
    it.each([429, 500, 502, 503, 504])(
      "maps HTTP %i with no refusal evidence to transient",
      (status) => {
        const failure: ClassifiableFailure = {
          kind: "http",
          httpStatus: status,
          refusalEvidence: { source: "none" }
        };
        expect(classifyError(failure)).toBe("transient");
      }
    );

    it.each([400, 401, 403, 404, 422])(
      "maps HTTP %i with no refusal evidence to non_retryable",
      (status) => {
        const failure: ClassifiableFailure = {
          kind: "http",
          httpStatus: status,
          refusalEvidence: { source: "none" }
        };
        expect(classifyError(failure)).toBe("non_retryable");
      }
    );

    it("maps network failure to transient regardless of message contents", () => {
      expect(
        classifyError({
          kind: "network",
          message: "socket hang up"
        })
      ).toBe("transient");

      expect(
        classifyError({
          kind: "network",
          message: "request failed: safety policy endpoint unavailable"
        })
      ).toBe("transient");
    });

    it("maps local_validation to non_retryable", () => {
      expect(
        classifyError({
          kind: "local_validation",
          reason: "unknown reference asset"
        })
      ).toBe("non_retryable");
    });

    it("maps HTTP 429 with structured_field refusal evidence to safety_refusal", () => {
      const failure: ClassifiableFailure = {
        kind: "http",
        httpStatus: 429,
        refusalEvidence: {
          source: "structured_field",
          field: "error.code",
          value: "content_policy_violation"
        }
      };
      expect(classifyError(failure)).toBe("safety_refusal");
    });

    it("maps HTTP 500 with structured_field refusal evidence to safety_refusal", () => {
      const failure: ClassifiableFailure = {
        kind: "http",
        httpStatus: 500,
        refusalEvidence: {
          source: "structured_field",
          field: "error.type",
          value: "refusal"
        }
      };
      expect(classifyError(failure)).toBe("safety_refusal");
    });

    it("maps HTTP 403 with message_heuristic refusal evidence to safety_refusal", () => {
      const failure: ClassifiableFailure = {
        kind: "http",
        httpStatus: 403,
        refusalEvidence: {
          source: "message_heuristic",
          scopedToHttpStatus: 403,
          matchedKeyword: "policy"
        }
      };
      expect(classifyError(failure)).toBe("safety_refusal");
    });
  });

  describe("isRetryable", () => {
    it("returns true only for transient", () => {
      expect(isRetryable("transient")).toBe(true);
      expect(isRetryable("non_retryable")).toBe(false);
      expect(isRetryable("safety_refusal")).toBe(false);
    });
  });

  describe("isSafetyRefusalSignal", () => {
    it("returns matched: true and the keyword when refusal keywords are present", () => {
      expect(
        isSafetyRefusalSignal({
          message: "Blocked by safety guidelines"
        })
      ).toEqual({ matched: true, keyword: "safety" });

      expect(
        isSafetyRefusalSignal({
          errorCode: "content_policy_violation"
        })
      ).toEqual({ matched: true, keyword: "policy" });

      expect(
        isSafetyRefusalSignal({
          errorType: "refusal"
        })
      ).toEqual({ matched: true, keyword: "refusal" });

      expect(
        isSafetyRefusalSignal({
          message: "Potential harm detected"
        })
      ).toEqual({ matched: true, keyword: "harm" });

      expect(
        isSafetyRefusalSignal({
          errorType: "content_filter"
        })
      ).toEqual({ matched: true, keyword: "content_filter" });
    });

    it("returns matched: false when no refusal keyword is present", () => {
      expect(
        isSafetyRefusalSignal({
          errorType: "invalid_request_error",
          errorCode: "parameter_missing",
          message: "Required parameter 'prompt' is missing"
        })
      ).toEqual({ matched: false });

      expect(
        isSafetyRefusalSignal({
          message: "Internal server error"
        })
      ).toEqual({ matched: false });
    });
  });
});
