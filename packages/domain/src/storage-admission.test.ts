import { describe, expect, it } from "vitest";
import {
  createStorageAdmissionPolicy,
  evaluateStorageWatermark,
  STORAGE_WATERMARK_THRESHOLDS
} from "./storage-admission.js";

describe("Storage Watermark Evaluation and Admission Policy", () => {
  const TOTAL = 1_000_000_000; // 1 GB

  it("evaluates storage usage percentages into correct watermark states", () => {
    // Normal: < 70%
    expect(evaluateStorageWatermark(0, TOTAL)).toBe("normal");
    expect(evaluateStorageWatermark(699_999_999, TOTAL)).toBe("normal");

    // Warning: 70% to 84.9%
    expect(evaluateStorageWatermark(700_000_000, TOTAL)).toBe("warning");
    expect(evaluateStorageWatermark(849_999_999, TOTAL)).toBe("warning");

    // Degraded: 85% to 91.9%
    expect(evaluateStorageWatermark(850_000_000, TOTAL)).toBe("degraded");
    expect(evaluateStorageWatermark(919_999_999, TOTAL)).toBe("degraded");

    // Critical: >= 92%
    expect(evaluateStorageWatermark(920_000_000, TOTAL)).toBe("critical");
    expect(evaluateStorageWatermark(1_000_000_000, TOTAL)).toBe("critical");
  });

  it("rejects invalid byte input values", () => {
    expect(() => evaluateStorageWatermark(-1, TOTAL)).toThrow();
    expect(() => evaluateStorageWatermark(500, 0)).toThrow();
    expect(() => evaluateStorageWatermark(500, -100)).toThrow();
  });

  it("enforces admission constraints for normal state", () => {
    const policy = createStorageAdmissionPolicy(500_000_000, TOTAL);
    expect(policy.state).toBe("normal");
    expect(policy.canAdmitNewCandidates()).toBe(true);
    expect(policy.canAdmitNewMedia()).toBe(true);
    expect(policy.canAdmitDeliveryMedia()).toBe(true);
    expect(policy.canAccelerateCleanup()).toBe(false);
  });

  it("enforces admission constraints for warning state (70%)", () => {
    const policy = createStorageAdmissionPolicy(750_000_000, TOTAL);
    expect(policy.state).toBe("warning");
    expect(policy.canAdmitNewCandidates()).toBe(true);
    expect(policy.canAdmitNewMedia()).toBe(true);
    expect(policy.canAdmitDeliveryMedia()).toBe(true);
    expect(policy.canAccelerateCleanup()).toBe(true);
  });

  it("enforces admission constraints for degraded state (85%)", () => {
    const policy = createStorageAdmissionPolicy(860_000_000, TOTAL);
    expect(policy.state).toBe("degraded");
    expect(policy.canAdmitNewCandidates()).toBe(false); // Blocks new candidate uploads / generation
    expect(policy.canAdmitNewMedia()).toBe(true);
    expect(policy.canAdmitDeliveryMedia()).toBe(true);
    expect(policy.canAccelerateCleanup()).toBe(true);
  });

  it("enforces admission constraints for critical state (92%)", () => {
    const policy = createStorageAdmissionPolicy(950_000_000, TOTAL);
    expect(policy.state).toBe("critical");
    expect(policy.canAdmitNewCandidates()).toBe(false); // Blocks candidate admission
    expect(policy.canAdmitNewMedia()).toBe(false); // Blocks all new media writes
    expect(policy.canAdmitDeliveryMedia()).toBe(false);
    expect(policy.canAccelerateCleanup()).toBe(true);
  });

  it("exposes STORAGE_WATERMARK_THRESHOLDS constants", () => {
    expect(STORAGE_WATERMARK_THRESHOLDS.WARNING_RATIO).toBe(0.7);
    expect(STORAGE_WATERMARK_THRESHOLDS.DEGRADED_RATIO).toBe(0.85);
    expect(STORAGE_WATERMARK_THRESHOLDS.CRITICAL_RATIO).toBe(0.92);
  });
});
