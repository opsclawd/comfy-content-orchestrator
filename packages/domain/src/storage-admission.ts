import {
  STORAGE_OPERATION_CLASSES,
  STORAGE_WATERMARK_STATES,
  type StorageOperationClass,
  type StorageWatermarkState
} from "@cco/shared";

export { STORAGE_OPERATION_CLASSES, STORAGE_WATERMARK_STATES };
export type { StorageOperationClass, StorageWatermarkState };

export const STORAGE_WATERMARK_THRESHOLDS = Object.freeze({
  WARNING_RATIO: 0.7,
  DEGRADED_RATIO: 0.85,
  CRITICAL_RATIO: 0.92
});

export function evaluateStorageWatermark(
  usedBytes: number,
  totalBytes: number
): StorageWatermarkState {
  if (
    !Number.isFinite(usedBytes) ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0 ||
    usedBytes < 0
  ) {
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

export function isStorageOperationPermitted(
  state: StorageWatermarkState,
  operation: StorageOperationClass
): boolean {
  switch (state) {
    case "normal":
      return true;
    case "warning":
      return true;
    case "degraded":
      return operation === "delivery_write" || operation === "cleanup" || operation === "repair";
    case "critical":
      return operation === "cleanup" || operation === "repair";
  }
}

export function shouldAccelerateCleanup(state: StorageWatermarkState): boolean {
  return state !== "normal";
}

export interface StorageAdmissionPolicy {
  readonly state: StorageWatermarkState;
  readonly usedBytes: number;
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly usedRatio: number;
  readonly permittedOperations: ReadonlyArray<StorageOperationClass>;
  readonly deniedOperations: ReadonlyArray<StorageOperationClass>;
  readonly shouldAccelerateCleanup: boolean;
  isPermitted(operation: StorageOperationClass): boolean;
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
  const freeBytes = Math.max(0, totalBytes - usedBytes);

  const permittedOperations = Object.freeze(
    STORAGE_OPERATION_CLASSES.filter((op) => isStorageOperationPermitted(state, op))
  );
  const deniedOperations = Object.freeze(
    STORAGE_OPERATION_CLASSES.filter((op) => !isStorageOperationPermitted(state, op))
  );
  const accelerate = shouldAccelerateCleanup(state);

  return Object.freeze({
    state,
    usedBytes,
    totalBytes,
    freeBytes,
    usedRatio,
    permittedOperations,
    deniedOperations,
    shouldAccelerateCleanup: accelerate,
    isPermitted(operation: StorageOperationClass): boolean {
      return isStorageOperationPermitted(state, operation);
    },
    canAdmitNewCandidates(): boolean {
      return isStorageOperationPermitted(state, "candidate_upload");
    },
    canAdmitNewMedia(): boolean {
      return (
        isStorageOperationPermitted(state, "candidate_upload") &&
        isStorageOperationPermitted(state, "proxy_upload")
      );
    },
    canAdmitDeliveryMedia(): boolean {
      return isStorageOperationPermitted(state, "delivery_write");
    },
    canAccelerateCleanup(): boolean {
      return accelerate;
    }
  });
}
