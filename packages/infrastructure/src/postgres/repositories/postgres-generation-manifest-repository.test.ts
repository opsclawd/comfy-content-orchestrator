import { describe, expect, it, vi } from "vitest";
import { PostgresGenerationManifestRepository } from "./postgres-generation-manifest-repository.js";

function fakePool(rows: unknown[]) {
  return {
    query: vi.fn(async (_sql: string, _params: unknown[]) => ({ rows }))
  };
}

describe("PostgresGenerationManifestRepository", () => {
  it("returns the render profile identity when the manifest exists and is well-formed", async () => {
    const pool = fakePool([
      { manifest_payload: { renderProfile: "LTX_25_720P_5S_V1", renderProfileVersion: 1 } }
    ]);
    const repo = new PostgresGenerationManifestRepository(pool as never);

    const result = await repo.getComponentIdentityById("00000000-0000-0000-0000-000000000001");

    expect(result).toEqual({ renderProfile: "LTX_25_720P_5S_V1", renderProfileVersion: 1 });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("generation_manifests"), [
      "00000000-0000-0000-0000-000000000001"
    ]);
  });

  it("returns undefined (fail closed) when no row matches", async () => {
    const pool = fakePool([]);
    const repo = new PostgresGenerationManifestRepository(pool as never);

    const result = await repo.getComponentIdentityById("nonexistent");

    expect(result).toBeUndefined();
  });

  it("returns undefined (fail closed) when renderProfile is missing from the payload", async () => {
    const pool = fakePool([{ manifest_payload: { renderProfileVersion: 1 } }]);
    const repo = new PostgresGenerationManifestRepository(pool as never);

    const result = await repo.getComponentIdentityById("malformed-1");

    expect(result).toBeUndefined();
  });

  it("returns undefined (fail closed) when renderProfile is an empty string", async () => {
    const pool = fakePool([{ manifest_payload: { renderProfile: "" } }]);
    const repo = new PostgresGenerationManifestRepository(pool as never);

    const result = await repo.getComponentIdentityById("malformed-2");

    expect(result).toBeUndefined();
  });

  it("defaults renderProfileVersion to null when absent, rather than fabricating one", async () => {
    const pool = fakePool([{ manifest_payload: { renderProfile: "LTX_25_720P_5S_V1" } }]);
    const repo = new PostgresGenerationManifestRepository(pool as never);

    const result = await repo.getComponentIdentityById("no-version");

    expect(result).toEqual({ renderProfile: "LTX_25_720P_5S_V1", renderProfileVersion: null });
  });

  it("extracts outputChecksumsSha256 when outputs array is present in manifest_payload", async () => {
    const validSha1 = "a".repeat(64);
    const validSha2 = "b".repeat(64);
    const pool = fakePool([
      {
        manifest_payload: {
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1,
          outputs: [
            { bucket: "b1", key: "k1", checksumSha256: validSha1 },
            { bucket: "b2", key: "k2", checksumSha256: validSha2 }
          ]
        }
      }
    ]);
    const repo = new PostgresGenerationManifestRepository(pool as never);

    const result = await repo.getComponentIdentityById("with-outputs");

    expect(result).toEqual({
      renderProfile: "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      outputChecksumsSha256: [validSha1, validSha2]
    });
  });

  describe("findVideoStemSourceByJobId", () => {
    const validSha = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    it("returns undefined when no manifest matches jobId", async () => {
      const pool = fakePool([]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      const result = await repo.findVideoStemSourceByJobId("job-not-found");
      expect(result).toBeUndefined();
    });

    it("translates checksumSha256 to sha256 and defaults missing contentType to video/mp4", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-123",
          manifest_payload: {
            outputs: [
              {
                bucket: "cco-render-output",
                key: "renders/scene-1.mp4",
                checksumSha256: validSha.toUpperCase()
              }
            ]
          }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      const result = await repo.findVideoStemSourceByJobId("job-123");
      expect(result).toBeDefined();
      expect(result!.generationManifestId).toBe("manifest-123");
      expect(result!.media).toEqual({
        bucket: "cco-render-output",
        key: "renders/scene-1.mp4",
        sha256: validSha.toLowerCase(),
        contentType: "video/mp4"
      });
    });

    it("preserves explicit contentType when provided", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-456",
          manifest_payload: {
            outputs: [
              {
                bucket: "cco-render-output",
                key: "renders/scene-2.mov",
                checksumSha256: validSha,
                contentType: "video/quicktime"
              }
            ]
          }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      const result = await repo.findVideoStemSourceByJobId("job-456");
      expect(result).toBeDefined();
      expect(result!.media.contentType).toBe("video/quicktime");
    });

    it("throws IncompleteVideoStemSourceError when outputs array is missing or empty", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-empty",
          manifest_payload: { outputs: [] }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      await expect(repo.findVideoStemSourceByJobId("job-empty")).rejects.toThrow(
        "Missing or empty outputs in manifest_payload"
      );
    });

    it("throws IncompleteVideoStemSourceError when required bucket is missing", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-no-bucket",
          manifest_payload: {
            outputs: [{ key: "k", checksumSha256: validSha }]
          }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      await expect(repo.findVideoStemSourceByJobId("job-no-bucket")).rejects.toThrow(
        "missing required bucket"
      );
    });

    it("throws IncompleteVideoStemSourceError when required key is missing", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-no-key",
          manifest_payload: {
            outputs: [{ bucket: "b", checksumSha256: validSha }]
          }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      await expect(repo.findVideoStemSourceByJobId("job-no-key")).rejects.toThrow(
        "missing required key"
      );
    });

    it("throws IncompleteVideoStemSourceError when required checksumSha256 is missing", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-no-sha",
          manifest_payload: {
            outputs: [{ bucket: "b", key: "k" }]
          }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      await expect(repo.findVideoStemSourceByJobId("job-no-sha")).rejects.toThrow(
        "missing required checksumSha256"
      );
    });

    it("throws IncompleteVideoStemSourceError when checksumSha256 is malformed", async () => {
      const pool = fakePool([
        {
          manifest_id: "manifest-bad-sha",
          manifest_payload: {
            outputs: [{ bucket: "b", key: "k", checksumSha256: "not-a-valid-sha" }]
          }
        }
      ]);
      const repo = new PostgresGenerationManifestRepository(pool as never);

      await expect(repo.findVideoStemSourceByJobId("job-bad-sha")).rejects.toThrow(
        "malformed checksumSha256"
      );
    });
  });
});
