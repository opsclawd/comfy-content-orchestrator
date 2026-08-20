import type { StorageOperationClass } from "@cco/contracts";
import { createStorageAdmissionPolicy, type StorageAdmissionPolicy } from "@cco/domain";
import type { StorageMetricsRegistryPort } from "../ports/storage-metrics-registry-port.js";
import type { StorageTelemetryPort } from "../ports/storage-telemetry-port.js";
import { StorageAdmissionError } from "./storage-admission-error.js";

export interface EnforceStorageAdmissionDependencies {
  readonly telemetryPort: StorageTelemetryPort;
  readonly metricsRegistry?: StorageMetricsRegistryPort;
}

export class EnforceStorageAdmission {
  constructor(private readonly deps: EnforceStorageAdmissionDependencies) {}

  async execute(operation: StorageOperationClass): Promise<StorageAdmissionPolicy> {
    const telemetry = await this.deps.telemetryPort.getStorageTelemetry();
    const policy = createStorageAdmissionPolicy(telemetry.usedBytes, telemetry.totalBytes);

    if (this.deps.metricsRegistry) {
      this.deps.metricsRegistry.recordTelemetry(telemetry, policy.state);
    }

    if (!policy.isPermitted(operation)) {
      throw new StorageAdmissionError({
        operationClass: operation,
        watermarkState: policy.state,
        usedRatio: policy.usedRatio,
        totalBytes: policy.totalBytes,
        freeBytes: policy.freeBytes
      });
    }

    return policy;
  }
}
