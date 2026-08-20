export const STORAGE_WATERMARK_STATES = ["normal", "warning", "degraded", "critical"] as const;
export type StorageWatermarkState = (typeof STORAGE_WATERMARK_STATES)[number];

export const STORAGE_OPERATION_CLASSES = [
  "candidate_upload",
  "proxy_upload",
  "delivery_write",
  "cleanup",
  "repair"
] as const;
export type StorageOperationClass = (typeof STORAGE_OPERATION_CLASSES)[number];
