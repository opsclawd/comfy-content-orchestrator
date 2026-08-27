import type { StorageOperationClass, StorageWatermarkState } from "@cco/contracts";

export interface StorageAdmissionErrorContext {
  readonly operationClass: StorageOperationClass;
  readonly watermarkState: StorageWatermarkState;
  readonly usedRatio: number;
  readonly totalBytes: number;
  readonly freeBytes: number;
}

export class StorageAdmissionError extends Error {
  readonly operationClass: StorageOperationClass;
  readonly watermarkState: StorageWatermarkState;
  readonly usedRatio: number;
  readonly totalBytes: number;
  readonly freeBytes: number;

  constructor(context: StorageAdmissionErrorContext) {
    const percentage = (context.usedRatio * 100).toFixed(1);
    super(
      `Storage admission denied for operation "${context.operationClass}": watermark state is "${context.watermarkState}" (${percentage}% disk usage)`
    );
    this.name = "StorageAdmissionError";
    this.operationClass = context.operationClass;
    this.watermarkState = context.watermarkState;
    this.usedRatio = context.usedRatio;
    this.totalBytes = context.totalBytes;
    this.freeBytes = context.freeBytes;
  }
}

export class StorageAdmissionUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Storage telemetry is unavailable.", options);
    this.name = "StorageAdmissionUnavailableError";
  }
}
