import { z } from "zod";
import {
  STORAGE_OPERATION_CLASSES,
  STORAGE_WATERMARK_STATES,
  type StorageOperationClass,
  type StorageWatermarkState
} from "@cco/shared";

export { STORAGE_OPERATION_CLASSES, STORAGE_WATERMARK_STATES };
export type { StorageOperationClass, StorageWatermarkState };

export const StorageWatermarkStateSchema = z.enum(STORAGE_WATERMARK_STATES);
export const StorageOperationClassSchema = z.enum(STORAGE_OPERATION_CLASSES);

export const BucketStorageTelemetrySchema = z.object({
  bucket: z.string().min(1),
  usedBytes: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative().optional()
});
export type BucketStorageTelemetry = z.infer<typeof BucketStorageTelemetrySchema>;

export const StorageTelemetrySnapshotSchema = z.object({
  totalBytes: z.number().int().positive(),
  usedBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
  buckets: z.array(BucketStorageTelemetrySchema),
  measuredAt: z.string().datetime()
});
export type StorageTelemetrySnapshot = z.infer<typeof StorageTelemetrySnapshotSchema>;

export const StorageMetricsSnapshotSchema = z.object({
  objectStorageBytes: z.record(z.string(), z.number().int().nonnegative()),
  storageFreeBytes: z.number().int().nonnegative(),
  storageWatermarkState: StorageWatermarkStateSchema,
  measuredAt: z.string().datetime()
});
export type StorageMetricsSnapshot = z.infer<typeof StorageMetricsSnapshotSchema>;
