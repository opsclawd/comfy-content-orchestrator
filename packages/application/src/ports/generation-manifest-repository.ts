/**
 * The subset of a persisted generation manifest needed to resolve its
 * license-routing component reference — not the full manifest payload.
 */
export interface GenerationManifestComponentIdentity {
  readonly renderProfile: string;
  readonly renderProfileVersion: number | null;
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
