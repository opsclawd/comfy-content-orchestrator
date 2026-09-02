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
});
