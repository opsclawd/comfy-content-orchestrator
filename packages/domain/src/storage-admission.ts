import { STORAGE_WATERMARK_STATES, type StorageWatermarkState } from "@cco/shared";

export { STORAGE_WATERMARK_STATES, type StorageWatermarkState };

export const STORAGE_WATERMARK_THRESHOLDS = Object.freeze({
  WARNING_RATIO: 0.7,
  DEGRADED_RATIO: 0.85,
  CRITICAL_RATIO: 0.92
});

export function evaluateStorageWatermark(
  usedBytes: number,
  totalBytes: number
): StorageWatermarkState {
  if (totalBytes <= 0 || usedBytes < 0) {
    throw new Error(`Invalid storage metrics: usedBytes=${usedBytes}, totalBytes=${totalBytes}`);
  }
  const ratio = usedBytes / totalBytes;
  if (ratio >= STORAGE_WATERMARK_THRESHOLDS.CRITICAL_RATIO) {
    return "critical";
  }
  if (ratio >= STORAGE_WATERMARK_THRESHOLDS.DEGRADED_RATIO) {
    return "degraded";
  }
  if (ratio >= STORAGE_WATERMARK_THRESHOLDS.WARNING_RATIO) {
    return "warning";
  }
  return "normal";
}

export interface StorageAdmissionPolicy {
  readonly state: StorageWatermarkState;
  readonly usedRatio: number;
  canAdmitNewCandidates(): boolean;
  canAdmitNewMedia(): boolean;
  canAdmitDeliveryMedia(): boolean;
  canAccelerateCleanup(): boolean;
}

export function createStorageAdmissionPolicy(
  usedBytes: number,
  totalBytes: number
): StorageAdmissionPolicy {
  const state = evaluateStorageWatermark(usedBytes, totalBytes);
  const usedRatio = usedBytes / totalBytes;

  return Object.freeze({
    state,
    usedRatio,
    canAdmitNewCandidates(): boolean {
      return state === "normal" || state === "warning";
    },
    canAdmitNewMedia(): boolean {
      return state !== "critical";
    },
    canAdmitDeliveryMedia(): boolean {
      return state !== "critical";
    },
    canAccelerateCleanup(): boolean {
      return state !== "normal";
    }
  });
}
