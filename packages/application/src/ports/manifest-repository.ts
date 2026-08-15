export interface ManifestRepository<TManifest> {
  findByJobId(renderJobId: string): Promise<TManifest | undefined>;
  append(manifest: TManifest): Promise<void>;
}
