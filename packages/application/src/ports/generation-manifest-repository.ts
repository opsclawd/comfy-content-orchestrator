/**
 * The subset of a persisted generation manifest needed to resolve its
 * license-routing component reference — not the full manifest payload.
 */
export interface GenerationManifestComponentIdentity {
  readonly renderProfile: string;
  readonly renderProfileVersion: number | null;
  /**
   * Checksum SHA-256 hashes of the rendered outputs produced by this generation manifest.
   * If provided, callers (e.g. AssembleDeliveryReel) verify that the referenced video stem's
   * media checksum matches one of the manifest's output checksums to prevent stale or inconsistent
   * manifest references from being accepted into assembly provenance.
   */
  readonly outputChecksumsSha256?: readonly string[] | undefined;
}

export interface GenerationManifestRepository {
  /**
   * Looks up a generation manifest by its ID (AssemblySpec.videoStems[].generationManifestId)
   * and returns just its component identity. Returns undefined when no
   * manifest exists for that ID — callers must treat this as a fail-closed
   * case (an unresolvable generation-manifest reference must not be
   * silently skipped), not as "no license constraint applies".
   */
  readonly getComponentIdentityById: (
    generationManifestId: string
  ) => Promise<GenerationManifestComponentIdentity | undefined>;
}
