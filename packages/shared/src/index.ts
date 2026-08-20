/**
 * Pure cross-cutting primitives only.
 *
 * PRD §3.6.2: `shared` is the sink of the dependency graph — it must not import
 * from `domain`, `application`, `infrastructure`, `contracts`, or any app.
 */

/** Branded-type helper used across packages to prevent identifier mix-ups. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Narrow an unknown error into a message without losing non-Error throws. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { BUCKET_NAMES, BUCKETS, type BucketName } from "./buckets.js";
export {
  STORAGE_WATERMARK_STATES,
  type StorageWatermarkState,
  STORAGE_OPERATION_CLASSES,
  type StorageOperationClass
} from "./storage-watermark.js";
