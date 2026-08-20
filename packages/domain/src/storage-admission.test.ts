import { describe, expect, it } from "vitest";
import {
  createStorageAdmissionPolicy,
  evaluateStorageWatermark,
  isStorageOperationPermitted,
  shouldAccelerateCleanup,
  STORAGE_OPERATION_CLASSES,
  STORAGE_WATERMARK_THRESHOLDS
} from "./storage-admission.js";

describe("Storage Watermark Evaluation and Admission Policy", () => {
  const TOTAL = 1_000_000_000; // 1 GB

  it("evaluates storage usage percentages into correct watermark states at all 6 exact boundaries", () => {
    // Boundary 1: 69.9% (<70%) -> normal
    expect(evaluateStorageWatermark(699_000_000, TOTAL)).toBe("normal");
    expect(evaluateStorageWatermark(0, TOTAL)).toBe("normal");

    // Boundary 2: 70.0% (>=70%) -> warning
    expect(evaluateStorageWatermark(700_000_000, TOTAL)).toBe("warning");

    // Boundary 3: 84.9% (<85%) -> warning
    expect(evaluateStorageWatermark(849_000_000, TOTAL)).toBe("warning");

    // Boundary 4: 85.0% (>=85%) -> degraded
    expect(evaluateStorageWatermark(850_000_000, TOTAL)).toBe("degraded");

    // Boundary 5: 91.9% (<92%) -> degraded
    expect(evaluateStorageWatermark(919_000_000, TOTAL)).toBe("degraded");

    // Boundary 6: 92.0% (>=92%) -> critical
    expect(evaluateStorageWatermark(920_000_000, TOTAL)).toBe("critical");
    expect(evaluateStorageWatermark(1_000_000_000, TOTAL)).toBe("critical");
  });

  it("rejects invalid byte input values", () => {
    expect(() => evaluateStorageWatermark(-1, TOTAL)).toThrow();
    expect(() => evaluateStorageWatermark(500, 0)).toThrow();
    expect(() => evaluateStorageWatermark(500, -100)).toThrow();
    expect(() => evaluateStorageWatermark(NaN, TOTAL)).toThrow();
    expect(() => evaluateStorageWatermark(500, Infinity)).toThrow();
  });

  it("enforces admission constraints for normal state (<70%)", () => {
    const policy = createStorageAdmissionPolicy(500_000_000, TOTAL);
    expect(policy.state).toBe("normal");
    expect(policy.usedRatio).toBe(0.5);
    expect(policy.freeBytes).toBe(500_000_000);
    expect(policy.shouldAccelerateCleanup).toBe(false);

    expect(policy.isPermitted("candidate_upload")).toBe(true);
    expect(policy.isPermitted("proxy_upload")).toBe(true);
    expect(policy.isPermitted("delivery_write")).toBe(true);
    expect(policy.isPermitted("cleanup")).toBe(true);
    expect(policy.isPermitted("repair")).toBe(true);
    expect(policy.permittedOperations).toEqual(STORAGE_OPERATION_CLASSES);
    expect(policy.deniedOperations).toEqual([]);
    expect(policy.canAdmitNewCandidates()).toBe(true);
    expect(policy.canAdmitNewMedia()).toBe(true);
    expect(policy.canAdmitDeliveryMedia()).toBe(true);
    expect(policy.canAccelerateCleanup()).toBe(false);
  });

  it("enforces admission constraints for warning state (>=70%): does NOT block normal work", () => {
    const policy = createStorageAdmissionPolicy(700_000_000, TOTAL);
    expect(policy.state).toBe("warning");
    expect(policy.shouldAccelerateCleanup).toBe(true);

    // Explicitly assert warning does not block normal work
    expect(policy.isPermitted("candidate_upload")).toBe(true);
    expect(policy.isPermitted("proxy_upload")).toBe(true);
    expect(policy.isPermitted("delivery_write")).toBe(true);
    expect(policy.isPermitted("cleanup")).toBe(true);
    expect(policy.isPermitted("repair")).toBe(true);
    expect(policy.permittedOperations).toEqual(STORAGE_OPERATION_CLASSES);
    expect(policy.deniedOperations).toEqual([]);
    expect(policy.canAdmitNewCandidates()).toBe(true);
    expect(policy.canAdmitNewMedia()).toBe(true);
    expect(policy.canAdmitDeliveryMedia()).toBe(true);
    expect(policy.canAccelerateCleanup()).toBe(true);
  });

  it("enforces admission constraints for degraded state (>=85%): stops candidate/proxy uploads, permits delivery & cleanup", () => {
    const policy = createStorageAdmissionPolicy(850_000_000, TOTAL);
    expect(policy.state).toBe("degraded");
    expect(policy.shouldAccelerateCleanup).toBe(true);

    // Blocked
    expect(policy.isPermitted("candidate_upload")).toBe(false);
    expect(policy.isPermitted("proxy_upload")).toBe(false);
    // Permitted
    expect(policy.isPermitted("delivery_write")).toBe(true);
    expect(policy.isPermitted("cleanup")).toBe(true);
    expect(policy.isPermitted("repair")).toBe(true);

    expect(policy.permittedOperations).toEqual(["delivery_write", "cleanup", "repair"]);
    expect(policy.deniedOperations).toEqual(["candidate_upload", "proxy_upload"]);
    expect(policy.canAdmitNewCandidates()).toBe(false);
    expect(policy.canAdmitNewMedia()).toBe(false);
    expect(policy.canAdmitDeliveryMedia()).toBe(true);
    expect(policy.canAccelerateCleanup()).toBe(true);
  });

  it("enforces admission constraints for critical state (>=92%): blocks all new media writes except cleanup/repair", () => {
    const policy = createStorageAdmissionPolicy(920_000_000, TOTAL);
    expect(policy.state).toBe("critical");
    expect(policy.shouldAccelerateCleanup).toBe(true);

    // Blocked
    expect(policy.isPermitted("candidate_upload")).toBe(false);
    expect(policy.isPermitted("proxy_upload")).toBe(false);
    expect(policy.isPermitted("delivery_write")).toBe(false);
    // Permitted
    expect(policy.isPermitted("cleanup")).toBe(true);
    expect(policy.isPermitted("repair")).toBe(true);

    expect(policy.permittedOperations).toEqual(["cleanup", "repair"]);
    expect(policy.deniedOperations).toEqual(["candidate_upload", "proxy_upload", "delivery_write"]);
    expect(policy.canAdmitNewCandidates()).toBe(false);
    expect(policy.canAdmitNewMedia()).toBe(false);
    expect(policy.canAdmitDeliveryMedia()).toBe(false);
    expect(policy.canAccelerateCleanup()).toBe(true);
  });

  it("exposes standalone pure helper functions", () => {
    expect(isStorageOperationPermitted("normal", "candidate_upload")).toBe(true);
    expect(isStorageOperationPermitted("warning", "candidate_upload")).toBe(true);
    expect(isStorageOperationPermitted("degraded", "candidate_upload")).toBe(false);
    expect(isStorageOperationPermitted("critical", "delivery_write")).toBe(false);
    expect(isStorageOperationPermitted("critical", "cleanup")).toBe(true);

    expect(shouldAccelerateCleanup("normal")).toBe(false);
    expect(shouldAccelerateCleanup("warning")).toBe(true);
    expect(shouldAccelerateCleanup("degraded")).toBe(true);
    expect(shouldAccelerateCleanup("critical")).toBe(true);

    expect(STORAGE_WATERMARK_THRESHOLDS.WARNING_RATIO).toBe(0.7);
    expect(STORAGE_WATERMARK_THRESHOLDS.DEGRADED_RATIO).toBe(0.85);
    expect(STORAGE_WATERMARK_THRESHOLDS.CRITICAL_RATIO).toBe(0.92);
  });
});
