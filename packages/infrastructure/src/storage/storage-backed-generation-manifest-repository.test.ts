import { describe, expect, it } from "vitest";
import type { ObjectLocator, ObjectStoragePort, StoredObject } from "@cco/application";
import { BUCKETS } from "@cco/shared";
import { StorageBackedGenerationManifestRepository } from "./storage-backed-generation-manifest-repository.js";

describe("StorageBackedGenerationManifestRepository (unit)", () => {
  function createFakeStorage(objects: Record<string, StoredObject>): ObjectStoragePort {
    return {
      putObject: async () => ({ bucket: "b", key: "k" }),
      getObject: async (loc: ObjectLocator) => objects[`${loc.bucket}/${loc.key}`]
    };
  }

  it("returns undefined when manifest does not exist in storage", async () => {
    const storage = createFakeStorage({});
    const repo = new StorageBackedGenerationManifestRepository(storage);
    const result = await repo.getComponentIdentityById("nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns undefined when payload has non-string or empty renderProfile", async () => {
    const payload = JSON.stringify({ renderProfile: "" });
    const storage = createFakeStorage({
      [`${BUCKETS.REVIEW}/generation-manifests/bad.json`]: {
        bucket: BUCKETS.REVIEW,
        key: "generation-manifests/bad.json",
        body: Buffer.from(payload)
      }
    });
    const repo = new StorageBackedGenerationManifestRepository(storage);
    const result = await repo.getComponentIdentityById("bad");
    expect(result).toBeUndefined();
  });

  it("returns undefined when body is invalid JSON", async () => {
    const storage = createFakeStorage({
      [`${BUCKETS.REVIEW}/generation-manifests/invalid-json.json`]: {
        bucket: BUCKETS.REVIEW,
        key: "generation-manifests/invalid-json.json",
        body: Buffer.from("not valid json")
      }
    });
    const repo = new StorageBackedGenerationManifestRepository(storage);
    const result = await repo.getComponentIdentityById("invalid-json");
    expect(result).toBeUndefined();
  });

  it("returns component identity with renderProfile, version, and output checksums", async () => {
    const payload = JSON.stringify({
      manifestId: "valid-id",
      renderProfile: "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      outputs: [{ checksumSha256: "a".repeat(64) }, { checksumSha256: "b".repeat(64) }]
    });
    const storage = createFakeStorage({
      [`${BUCKETS.REVIEW}/generation-manifests/valid-id.json`]: {
        bucket: BUCKETS.REVIEW,
        key: "generation-manifests/valid-id.json",
        body: Buffer.from(payload)
      }
    });
    const repo = new StorageBackedGenerationManifestRepository(storage);
    const result = await repo.getComponentIdentityById("valid-id");
    expect(result).toEqual({
      renderProfile: "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      outputChecksumsSha256: ["a".repeat(64), "b".repeat(64)]
    });
  });

  it("sets renderProfileVersion to null when not a number", async () => {
    const payload = JSON.stringify({
      manifestId: "no-version",
      renderProfile: "LTX_25_720P_5S_V1",
      renderProfileVersion: null
    });
    const storage = createFakeStorage({
      [`${BUCKETS.REVIEW}/generation-manifests/no-version.json`]: {
        bucket: BUCKETS.REVIEW,
        key: "generation-manifests/no-version.json",
        body: Buffer.from(payload)
      }
    });
    const repo = new StorageBackedGenerationManifestRepository(storage);
    const result = await repo.getComponentIdentityById("no-version");
    expect(result).toEqual({
      renderProfile: "LTX_25_720P_5S_V1",
      renderProfileVersion: null
    });
  });
});
