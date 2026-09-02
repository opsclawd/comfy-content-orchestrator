import type { ComponentLicenseRegistrySnapshot } from "@cco/contracts";

export interface LicenseRegistryPort {
  getSnapshot(): ComponentLicenseRegistrySnapshot;
}
