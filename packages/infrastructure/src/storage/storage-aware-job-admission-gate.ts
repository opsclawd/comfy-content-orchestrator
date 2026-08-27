import type {
  JobAdmissionGate,
  StorageMetricsRegistryPort,
  StorageTelemetryPort
} from "@cco/application";
import { StorageAdmissionUnavailableError } from "@cco/application";
import type { StorageOperationClass } from "@cco/contracts";
import { createStorageAdmissionPolicy, type JobKind } from "@cco/domain";

export interface StorageAwareJobAdmissionGateOptions {
  readonly telemetryPort: StorageTelemetryPort;
  readonly metricsRegistry?: StorageMetricsRegistryPort;
}

export class StorageAwareJobAdmissionGate implements JobAdmissionGate {
  constructor(private readonly options: StorageAwareJobAdmissionGateOptions) {}

  async canAdmit(jobKind: JobKind): Promise<boolean> {
    try {
      const telemetry = await this.options.telemetryPort.getStorageTelemetry();
      const policy = createStorageAdmissionPolicy(telemetry.usedBytes, telemetry.totalBytes);

      if (this.options.metricsRegistry) {
        this.options.metricsRegistry.recordTelemetry(telemetry, policy.state);
      }

      const operation: StorageOperationClass =
        jobKind === "candidate" ? "candidate_upload" : "delivery_write";

      return policy.isPermitted(operation);
    } catch (error) {
      if (error instanceof StorageAdmissionUnavailableError) {
        throw error;
      }
      throw new StorageAdmissionUnavailableError({ cause: error });
    }
  }
}
