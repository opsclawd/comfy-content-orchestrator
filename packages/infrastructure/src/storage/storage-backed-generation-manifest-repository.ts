import type {
  GenerationManifestComponentIdentity,
  GenerationManifestRepository,
  ObjectStoragePort
} from "@cco/application";
import { BUCKETS } from "@cco/shared";

export class StorageBackedGenerationManifestRepository implements GenerationManifestRepository {
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly bucket: string = BUCKETS.REVIEW
  ) {}

  async getComponentIdentityById(
    generationManifestId: string
  ): Promise<GenerationManifestComponentIdentity | undefined> {
    const stored = await this.storage.getObject({
      bucket: this.bucket,
      key: `generation-manifests/${generationManifestId}.json`
    });
    if (!stored) {
      return undefined;
    }

    try {
      const payload = JSON.parse(new TextDecoder().decode(stored.body));
      if (typeof payload.renderProfile !== "string" || payload.renderProfile.length === 0) {
        return undefined;
      }

      const outputChecksumsSha256: string[] = [];
      if (Array.isArray(payload.outputs)) {
        for (const out of payload.outputs) {
          if (
            out &&
            typeof out === "object" &&
            typeof (out as { checksumSha256?: unknown }).checksumSha256 === "string"
          ) {
            outputChecksumsSha256.push((out as { checksumSha256: string }).checksumSha256);
          }
        }
      }

      return {
        renderProfile: payload.renderProfile,
        renderProfileVersion:
          typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null,
        ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {})
      };
    } catch {
      return undefined;
    }
  }
}
