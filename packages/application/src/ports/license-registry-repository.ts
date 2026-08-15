export interface LicenseRegistryRepository<TLicenseRecord> {
  findByComponentKey(componentKey: string): Promise<TLicenseRecord | undefined>;
}
