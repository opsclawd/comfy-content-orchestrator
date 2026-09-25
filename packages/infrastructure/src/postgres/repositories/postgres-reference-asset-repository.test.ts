import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import { PostgresReferenceAssetRepository } from "./postgres-reference-asset-repository.js";

describe("PostgresReferenceAssetRepository (Unit)", () => {
  const asset: ReferenceAsset = {
    id: "11111111-1111-1111-1111-111111111111" as ReferenceAssetId,
    clientId: "client-a",
    assetType: "image",
    storageBucket: "godzspeed-reference",
    storageObjectKey: "clients/client-a/references/hash-a",
    contentHashSha256: "hash-a",
    width: 100,
    height: 100,
    mimeType: "image/png",
    displayName: "asset-a",
    archivedAt: null
  };

  it("successfully inserts a new reference asset", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            asset_id: asset.id,
            client_id: asset.clientId,
            asset_type: asset.assetType,
            storage_bucket: asset.storageBucket,
            storage_object_key: asset.storageObjectKey,
            content_hash_sha256: asset.contentHashSha256,
            width: asset.width,
            height: asset.height,
            mime_type: asset.mimeType,
            display_name: asset.displayName,
            archived_at: null
          }
        ]
      })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);
    const result = await repo.saveOrReactivateByContentHash(asset);

    expect(result.id).toBe(asset.id);
    expect(result.clientId).toBe(asset.clientId);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const querySql = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(querySql).toBeDefined();
    expect(querySql).toContain("ON CONFLICT (storage_bucket, storage_object_key) DO UPDATE SET");
    expect(querySql).toContain("WHERE reference_assets.client_id = EXCLUDED.client_id");
    expect(querySql).toContain(
      "AND reference_assets.content_hash_sha256 = EXCLUDED.content_hash_sha256"
    );
  });

  it("rejects conflict when existing row belongs to a different client without mutating it", async () => {
    const mockClient = {
      query: vi
        .fn()
        // First query (INSERT ON CONFLICT) returns 0 rows because WHERE condition was false
        .mockResolvedValueOnce({ rows: [] })
        // Second query inspects the existing conflicting row
        .mockResolvedValueOnce({
          rows: [
            {
              asset_id: "22222222-2222-2222-2222-222222222222",
              client_id: "client-b",
              storage_bucket: asset.storageBucket,
              storage_object_key: asset.storageObjectKey,
              content_hash_sha256: "hash-a"
            }
          ]
        })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);

    await expect(repo.saveOrReactivateByContentHash(asset)).rejects.toThrow(
      "Inconsistent client ownership: asset key belongs to client client-b, not client-a"
    );

    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it("rejects conflict when existing row has different content hash without mutating it", async () => {
    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              asset_id: "22222222-2222-2222-2222-222222222222",
              client_id: "client-a",
              storage_bucket: asset.storageBucket,
              storage_object_key: asset.storageObjectKey,
              content_hash_sha256: "hash-different"
            }
          ]
        })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);

    await expect(repo.saveOrReactivateByContentHash(asset)).rejects.toThrow(
      "Inconsistent content hash: asset key has hash hash-different, not hash-a"
    );

    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it("validates returned row consistency after save", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            asset_id: asset.id,
            client_id: "tampered-client",
            storage_bucket: asset.storageBucket,
            storage_object_key: asset.storageObjectKey,
            content_hash_sha256: asset.contentHashSha256
          }
        ]
      })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);

    await expect(repo.saveOrReactivateByContentHash(asset)).rejects.toThrow(
      "Inconsistent client ownership: asset key belongs to client tampered-client, not client-a"
    );
  });

  it("rejects conflict in save() when asset_id belongs to a different client", async () => {
    const mockClient = {
      query: vi
        .fn()
        // First query (INSERT ON CONFLICT) returns 0 rows because WHERE condition was false
        .mockResolvedValueOnce({ rows: [] })
        // Second query inspects the existing conflicting row
        .mockResolvedValueOnce({
          rows: [
            {
              client_id: "client-b"
            }
          ]
        })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);

    await expect(repo.save(asset)).rejects.toThrow(
      "Inconsistent client ownership: asset belongs to client client-b, not client-a"
    );

    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it("acquires and releases advisory lock during withLock execution", async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    const mockClient = { query: querySpy } as unknown as PoolClient;
    const repo = new PostgresReferenceAssetRepository(mockClient);

    const result = await repo.withLock("lock-key", async () => "success");

    expect(result).toBe("success");
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(querySpy).toHaveBeenNthCalledWith(1, "SELECT pg_advisory_lock(hashtext($1))", [
      "lock-key"
    ]);
    expect(querySpy).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_unlock(hashtext($1))", [
      "lock-key"
    ]);
  });

  it("updates library_role using updateLibraryRole", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            asset_id: asset.id,
            client_id: asset.clientId,
            asset_type: asset.assetType,
            storage_bucket: asset.storageBucket,
            storage_object_key: asset.storageObjectKey,
            content_hash_sha256: asset.contentHashSha256,
            width: asset.width,
            height: asset.height,
            mime_type: asset.mimeType,
            display_name: asset.displayName,
            library_role: "style",
            archived_at: null
          }
        ]
      })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);
    const result = await repo.updateLibraryRole(asset.clientId, asset.id, "style");

    expect(result).toBeDefined();
    expect(result?.libraryRole).toBe("style");
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const querySql = (mockClient.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(querySql).toContain("UPDATE reference_assets");
    expect(querySql).toContain("SET library_role = $3");
  });

  it("maps description column correctly when present or null", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            asset_id: asset.id,
            client_id: asset.clientId,
            asset_type: asset.assetType,
            storage_bucket: asset.storageBucket,
            storage_object_key: asset.storageObjectKey,
            content_hash_sha256: asset.contentHashSha256,
            width: asset.width,
            height: asset.height,
            mime_type: asset.mimeType,
            display_name: asset.displayName,
            description: "A detailed product description",
            library_role: "product",
            archived_at: null
          }
        ]
      })
    } as unknown as PoolClient;

    const repo = new PostgresReferenceAssetRepository(mockClient);
    const results = await repo.findByIds(asset.clientId, [asset.id]);

    expect(results).toHaveLength(1);
    expect(results[0]?.description).toBe("A detailed product description");
  });
});
