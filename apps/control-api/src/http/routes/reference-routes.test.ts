import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { BUCKETS } from "@cco/shared";
import {
  ObjectAlreadyExistsError,
  type ClientContextResolver,
  type HeadObjectResult,
  type ObjectLocator,
  type ObjectStoragePort,
  type PutObjectInput,
  type ReferenceAssetRepository,
  type ReferenceAssetRepositoryOptions,
  type ReviewMediaDeliveryPort,
  type StoredObject,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import type { ReferenceAssetResponse } from "@cco/contracts";
import type { ReferenceAsset, ReferenceAssetId, ReferenceRole } from "@cco/domain";
import { SharpImageInspectionAdapter } from "@cco/infrastructure";
import { createControlApiApp } from "../app.js";
import type { ControlApiAppOptions } from "../types.js";
import {
  createClientSessionToken,
  createProductionClientSessionAuthenticator
} from "../client-context.js";

// Valid sample buffers
const VALID_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const VALID_JPEG = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAKAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
  "base64"
);

const VALID_WEBP = Buffer.from(
  "UklGRj4AAABXRUJQVlA4IDIAAADQAQCdASoKAAoAAUAmJaACdLoB+AADsAD+6SIf+8+fufP3Pn/Rn/+U/fI4/kcf/KBAAA==",
  "base64"
);

class FakeReferenceAssetRepository implements ReferenceAssetRepository {
  private readonly assets = new Map<string, ReferenceAsset>();

  constructor(initialAssets: ReferenceAsset[] = []) {
    for (const a of initialAssets) {
      this.assets.set(a.id, a);
    }
  }

  get allAssets(): readonly ReferenceAsset[] {
    return Array.from(this.assets.values());
  }

  async listBySceneId(): Promise<readonly ReferenceAsset[]> {
    return [];
  }

  async findByIds(): Promise<readonly ReferenceAsset[]> {
    return [];
  }

  async findById(id: ReferenceAssetId): Promise<ReferenceAsset | null> {
    return this.assets.get(id) ?? null;
  }

  async findByClientId(
    clientId: string,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "groupId">
  ): Promise<readonly ReferenceAsset[]> {
    return Array.from(this.assets.values()).filter((a) => {
      if (a.clientId !== clientId) return false;
      if (!options?.includeArchived && a.archivedAt !== null && a.archivedAt !== undefined) {
        return false;
      }
      return true;
    });
  }

  async findByClientAndContentHash(
    clientId: string,
    contentHashSha256: string,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived">
  ): Promise<ReferenceAsset | undefined> {
    const found = Array.from(this.assets.values()).find(
      (a) => a.clientId === clientId && a.contentHashSha256 === contentHashSha256
    );
    if (!found) return undefined;
    if (!options?.includeArchived && found.archivedAt !== null && found.archivedAt !== undefined) {
      return undefined;
    }
    return found;
  }

  async save(asset: ReferenceAsset): Promise<ReferenceAsset> {
    for (const existing of this.assets.values()) {
      if (
        existing.id !== asset.id &&
        existing.storageBucket === asset.storageBucket &&
        existing.storageObjectKey === asset.storageObjectKey
      ) {
        throw new Error(
          `Unique constraint violation: (${asset.storageBucket}, ${asset.storageObjectKey})`
        );
      }
    }
    this.assets.set(asset.id, asset);
    return asset;
  }

  async saveOrReactivateByContentHash(asset: ReferenceAsset): Promise<ReferenceAsset> {
    const existing = Array.from(this.assets.values()).find(
      (a) =>
        a.storageBucket === asset.storageBucket && a.storageObjectKey === asset.storageObjectKey
    );
    if (existing) {
      const updated: ReferenceAsset = {
        ...existing,
        archivedAt: null
      };
      this.assets.set(existing.id, updated);
      return updated;
    }
    this.assets.set(asset.id, asset);
    return asset;
  }

  async archive(clientId: string, referenceId: ReferenceAssetId): Promise<boolean> {
    const asset = this.assets.get(referenceId);
    if (!asset || asset.clientId !== clientId) {
      return false;
    }
    if (asset.archivedAt !== null && asset.archivedAt !== undefined) {
      return false;
    }
    this.assets.set(referenceId, {
      ...asset,
      archivedAt: new Date().toISOString()
    });
    return true;
  }

  async updateLibraryRole(
    clientId: string,
    referenceId: ReferenceAssetId,
    libraryRole: ReferenceRole
  ): Promise<ReferenceAsset | undefined> {
    const asset = this.assets.get(referenceId);
    if (
      !asset ||
      asset.clientId !== clientId ||
      (asset.archivedAt !== null && asset.archivedAt !== undefined)
    ) {
      return undefined;
    }
    const updated: ReferenceAsset = {
      ...asset,
      libraryRole
    };
    this.assets.set(referenceId, updated);
    return updated;
  }
}

class FakeObjectStorage implements ObjectStoragePort {
  readonly storedObjects = new Map<string, StoredObject>();
  readonly deletedKeys: string[] = [];

  private toKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    const fullKey = this.toKey(input.bucket, input.key);
    if (input.ifNoneMatch === "*" && this.storedObjects.has(fullKey)) {
      throw new ObjectAlreadyExistsError(input.bucket, input.key);
    }
    const stored: StoredObject = {
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {})
    };
    this.storedObjects.set(fullKey, stored);
    return { bucket: input.bucket, key: input.key };
  }

  async getObject(locator: ObjectLocator): Promise<StoredObject | undefined> {
    const fullKey = this.toKey(locator.bucket, locator.key);
    return this.storedObjects.get(fullKey);
  }

  async headObject(locator: ObjectLocator): Promise<HeadObjectResult | undefined> {
    const fullKey = this.toKey(locator.bucket, locator.key);
    const obj = this.storedObjects.get(fullKey);
    if (!obj) return undefined;
    return {
      bucket: obj.bucket,
      key: obj.key,
      checksumSha256: obj.checksumSha256,
      contentType: obj.contentType
    };
  }

  async copyObject(from: ObjectLocator, to: ObjectLocator): Promise<ObjectLocator> {
    const src = await this.getObject(from);
    if (!src) throw new Error("Source not found");
    await this.putObject({ bucket: to.bucket, key: to.key, body: src.body });
    return to;
  }

  async deleteObject(locator: ObjectLocator): Promise<void> {
    const fullKey = this.toKey(locator.bucket, locator.key);
    this.storedObjects.delete(fullKey);
    this.deletedKeys.push(fullKey);
  }
}

class FakeReviewMediaDelivery implements ReviewMediaDeliveryPort {
  failingKeys = new Set<string>();

  async generatePresignedReadUrl(options: {
    bucket: string;
    key: string;
    contentHash: string;
  }): Promise<string> {
    if (this.failingKeys.has(options.key)) {
      throw new Error(`Signing failed for ${options.key}`);
    }
    return `https://s3.example.com/${options.bucket}/${options.key}?hash=${options.contentHash}`;
  }
}

class FakeUnitOfWork implements UnitOfWork {
  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({} as unknown as UnitOfWorkContext);
  }
}

describe("Reference Assets HTTP Routes", () => {
  const testClientId = "11111111-1111-1111-1111-111111111111";
  const otherClientId = "22222222-2222-2222-2222-222222222222";

  function createTestApp(options?: {
    authenticatedClientId?: string | null;
    withoutResolver?: boolean;
    initialAssets?: ReferenceAsset[];
    clientSessionAuthenticator?: ControlApiAppOptions["clientSessionAuthenticator"];
  }) {
    const uow = new FakeUnitOfWork();
    const referenceAssetRepository = new FakeReferenceAssetRepository(options?.initialAssets ?? []);
    const objectStorage = new FakeObjectStorage();
    const reviewMediaDelivery = new FakeReviewMediaDelivery();
    const imageValidator = new SharpImageInspectionAdapter();

    const clientContextResolver: ClientContextResolver<FastifyRequest> | undefined =
      options?.withoutResolver
        ? undefined
        : {
            resolve: () =>
              options?.authenticatedClientId !== undefined
                ? options.authenticatedClientId
                : testClientId
          };

    const app = createControlApiApp(
      {
        uow,
        referenceAssetRepository,
        objectStorage,
        reviewMediaDelivery,
        imageValidator
      },
      {
        ...(clientContextResolver !== undefined ? { clientContextResolver } : {}),
        ...(options?.clientSessionAuthenticator !== undefined
          ? { clientSessionAuthenticator: options.clientSessionAuthenticator }
          : {})
      }
    );

    return { app, referenceAssetRepository, objectStorage, reviewMediaDelivery };
  }

  describe("POST /api/clients/:clientId/references", () => {
    it("successfully uploads a PNG with explicit x-display-name and returns 201", async () => {
      const { app, referenceAssetRepository, objectStorage } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-display-name": "Hero Character Portrait",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.clientId).toBe(testClientId);
      expect(body.assetType).toBe("image");
      expect(body.storageBucket).toBe(BUCKETS.REFERENCE);
      expect(body.mimeType).toBe("image/png");
      expect(body.displayName).toBe("Hero Character Portrait");
      expect(body.libraryRole).toBe("subject_identity");
      expect(body.width).toBe(1);
      expect(body.height).toBe(1);
      expect(body.previewAvailability).toBe("available");
      expect(body.previewUrl).toContain("https://s3.example.com");

      const expectedSha256 = crypto.createHash("sha256").update(VALID_1X1_PNG).digest("hex");
      expect(body.contentHashSha256).toBe(expectedSha256);
      expect(body.storageObjectKey).toBe(`clients/${testClientId}/references/${expectedSha256}`);

      // Verify stored in object storage
      const stored = await objectStorage.getObject({
        bucket: BUCKETS.REFERENCE,
        key: body.storageObjectKey
      });
      expect(stored).toBeDefined();
      expect(Buffer.from(stored!.body).equals(VALID_1X1_PNG)).toBe(true);

      // Verify in repository
      const inRepo = await referenceAssetRepository.findById(body.id);
      expect(inRepo).not.toBeNull();
      expect(inRepo?.displayName).toBe("Hero Character Portrait");
      expect(inRepo?.libraryRole).toBe("subject_identity");
    });

    it("successfully uploads a JPEG without x-display-name and applies deterministic name", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/jpeg",
          "x-reference-role": "product"
        },
        payload: VALID_JPEG
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.mimeType).toBe("image/jpeg");
      const sha256 = crypto.createHash("sha256").update(VALID_JPEG).digest("hex");
      expect(body.displayName).toBe(`${sha256.slice(0, 16)}.jpg`);
      expect(body.libraryRole).toBe("product");
      expect(body.previewAvailability).toBe("available");
    });

    it("successfully uploads a WebP image", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/webp",
          "x-reference-role": "style"
        },
        payload: VALID_WEBP
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.mimeType).toBe("image/webp");
      expect(body.libraryRole).toBe("style");
      expect(body.previewAvailability).toBe("available");
    });

    it("idempotently converges on re-uploading identical bytes for the same client", async () => {
      const { app } = createTestApp();

      const firstRes = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-display-name": "First Upload Name",
          "x-reference-role": "location"
        },
        payload: VALID_1X1_PNG
      });
      expect(firstRes.statusCode).toBe(201);
      const firstBody = firstRes.json();
      expect(firstBody.libraryRole).toBe("location");

      // Second upload with identical bytes but different display name
      const secondRes = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-display-name": "Changed Name Attempt",
          "x-reference-role": "location"
        },
        payload: VALID_1X1_PNG
      });

      expect(secondRes.statusCode).toBe(201);
      const secondBody = secondRes.json();
      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.contentHashSha256).toBe(firstBody.contentHashSha256);
      expect(secondBody.storageObjectKey).toBe(firstBody.storageObjectKey);
      // Preserves established display name
      expect(secondBody.displayName).toBe("First Upload Name");
      expect(secondBody.libraryRole).toBe("location");
    });

    it("reactivates an archived asset on re-uploading identical bytes", async () => {
      const expectedSha256 = crypto.createHash("sha256").update(VALID_1X1_PNG).digest("hex");
      const archivedAsset: ReferenceAsset = {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as ReferenceAssetId,
        clientId: testClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${testClientId}/references/${expectedSha256}`,
        contentHashSha256: expectedSha256,
        width: 1,
        height: 1,
        mimeType: "image/png",
        displayName: "Archived Asset",
        libraryRole: "composition",
        archivedAt: "2026-01-01T00:00:00.000Z"
      };

      const { app, referenceAssetRepository } = createTestApp({
        initialAssets: [archivedAsset]
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-reference-role": "composition"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBe(archivedAsset.id);
      expect(body.libraryRole).toBe("composition");
      expect(body.archivedAt).toBeNull();

      // Check repository row is active
      const inRepo = await referenceAssetRepository.findById(archivedAsset.id);
      expect(inRepo?.archivedAt).toBeNull();
    });

    it("rejects corrupted/malformed image buffers with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const corruptBuffer = Buffer.from("NotAnImageAtAllCorruptedContent");
      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png"
        },
        payload: corruptBuffer
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects MIME mismatch (declared PNG but actually JPEG) with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png"
        },
        payload: VALID_JPEG // JPEG bytes with PNG content-type
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects unsupported media type with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/gif"
        },
        payload: Buffer.from("GIF89a...")
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects payload exceeding 10 MiB limit with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      // 10 MiB + 1024 bytes
      const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024);
      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png"
        },
        payload: oversizedBuffer
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects empty body with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png"
        },
        payload: Buffer.alloc(0)
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects invalid x-display-name containing control characters with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-display-name": "Hero\x00Name",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects x-display-name exceeding 255 UTF-8 bytes with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-display-name": "a".repeat(256),
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects missing x-reference-role header with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(body.message).toContain("x-reference-role");
    });

    it("rejects invalid x-reference-role header value with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-reference-role": "invalid_role_enum"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(body.message).toContain("invalid_role_enum");
    });

    it("accepts x-library-role header as alternative to x-reference-role", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-library-role": "product"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.libraryRole).toBe("product");
    });

    it("rejects invalid client UUID with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/not-a-valid-uuid/references`,
        headers: {
          "content-type": "image/png",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects with 401 AUTHENTICATION_REQUIRED when resolver is absent or principal is null", async () => {
      const { app: unauthedApp } = createTestApp({ authenticatedClientId: null });

      const response = await unauthedApp.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("rejects with 403 FORBIDDEN when authenticated client differs from route :clientId", async () => {
      const { app } = createTestApp({ authenticatedClientId: otherClientId });

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          "content-type": "image/png",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe("FORBIDDEN");
    });

    it("successfully authenticates using default SessionClientContextResolver when request has session token validated by authenticator", async () => {
      const secret = "test-session-secret";
      const authenticator = createProductionClientSessionAuthenticator({ secret });
      const { app } = createTestApp({
        withoutResolver: true,
        clientSessionAuthenticator: authenticator
      });
      const validToken = createClientSessionToken({ clientId: testClientId, secret });

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          authorization: `Bearer ${validToken}`,
          "content-type": "image/png",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.clientId).toBe(testClientId);
      expect(body.libraryRole).toBe("subject_identity");
    });

    it("rejects caller with arbitrary Bearer token when using default SessionClientContextResolver without authenticator", async () => {
      const { app } = createTestApp({ withoutResolver: true });

      const response = await app.inject({
        method: "POST",
        url: `/api/clients/${testClientId}/references`,
        headers: {
          authorization: `Bearer client:${testClientId}`,
          "content-type": "image/png",
          "x-reference-role": "subject_identity"
        },
        payload: VALID_1X1_PNG
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("GET /api/clients/:clientId/references", () => {
    it("returns active references with presigned URLs and excludes archived assets", async () => {
      const activeAsset1: ReferenceAsset = {
        id: "11111111-aaaa-1111-aaaa-111111111111" as ReferenceAssetId,
        clientId: testClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${testClientId}/references/hash1`,
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        width: 100,
        height: 100,
        mimeType: "image/png",
        displayName: "Active Reference 1",
        archivedAt: null
      };

      const activeAsset2: ReferenceAsset = {
        id: "22222222-aaaa-2222-aaaa-222222222222" as ReferenceAssetId,
        clientId: testClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${testClientId}/references/hash2`,
        contentHashSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        width: 200,
        height: 200,
        mimeType: "image/jpeg",
        displayName: "Active Reference 2",
        archivedAt: null
      };

      const archivedAsset: ReferenceAsset = {
        id: "33333333-aaaa-3333-aaaa-333333333333" as ReferenceAssetId,
        clientId: testClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${testClientId}/references/hash3`,
        contentHashSha256: "cb8379ac2098aa165029e3938a51da0bcecfc008fd6795f401178647f96c5b34",
        width: 300,
        height: 300,
        mimeType: "image/webp",
        displayName: "Archived Asset",
        archivedAt: "2026-01-01T00:00:00.000Z"
      };

      const foreignAsset: ReferenceAsset = {
        id: "44444444-aaaa-4444-aaaa-444444444444" as ReferenceAssetId,
        clientId: otherClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${otherClientId}/references/hash4`,
        contentHashSha256: "678916bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        mimeType: "image/png",
        archivedAt: null
      };

      const { app, reviewMediaDelivery } = createTestApp({
        initialAssets: [activeAsset1, activeAsset2, archivedAsset, foreignAsset]
      });

      // Mark asset2 preview as failing/unavailable
      reviewMediaDelivery.failingKeys.add(activeAsset2.storageObjectKey);

      const response = await app.inject({
        method: "GET",
        url: `/api/clients/${testClientId}/references`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.references).toHaveLength(2);

      const res1 = body.references.find((r: ReferenceAssetResponse) => r.id === activeAsset1.id);
      expect(res1).toBeDefined();
      expect(res1.previewAvailability).toBe("available");
      expect(res1.previewUrl).toContain(activeAsset1.storageObjectKey);

      const res2 = body.references.find((r: ReferenceAssetResponse) => r.id === activeAsset2.id);
      expect(res2).toBeDefined();
      expect(res2.previewAvailability).toBe("unavailable");
      expect(res2.previewUrl).toBeNull();
    });

    it("returns 401 when unauthenticated", async () => {
      const { app } = createTestApp({ authenticatedClientId: null });

      const response = await app.inject({
        method: "GET",
        url: `/api/clients/${testClientId}/references`
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 403 when authenticated client differs from route :clientId", async () => {
      const { app } = createTestApp({ authenticatedClientId: otherClientId });

      const response = await app.inject({
        method: "GET",
        url: `/api/clients/${testClientId}/references`
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("FORBIDDEN");
    });
  });

  describe("DELETE /api/clients/:clientId/references/:referenceId", () => {
    it("archives an active reference asset, returning 204 and keeping storage intact", async () => {
      const asset: ReferenceAsset = {
        id: "55555555-5555-5555-5555-555555555555" as ReferenceAssetId,
        clientId: testClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${testClientId}/references/hash5`,
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mimeType: "image/png",
        archivedAt: null
      };

      const { app, referenceAssetRepository, objectStorage } = createTestApp({
        initialAssets: [asset]
      });

      // Seed object storage
      await objectStorage.putObject({
        bucket: asset.storageBucket,
        key: asset.storageObjectKey,
        body: VALID_1X1_PNG
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/clients/${testClientId}/references/${asset.id}`
      });

      expect(response.statusCode).toBe(204);

      // Verify in repository that it is archived
      const inRepo = await referenceAssetRepository.findById(asset.id);
      expect(inRepo?.archivedAt).not.toBeNull();

      // Verify storage bytes were NOT deleted
      const stored = await objectStorage.getObject({
        bucket: asset.storageBucket,
        key: asset.storageObjectKey
      });
      expect(stored).toBeDefined();
      expect(objectStorage.deletedKeys).toHaveLength(0);

      // Subsequent GET should not return it
      const listRes = await app.inject({
        method: "GET",
        url: `/api/clients/${testClientId}/references`
      });
      expect(listRes.json().references).toHaveLength(0);
    });

    it("returns 404 NOT_FOUND for non-existent reference asset", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "DELETE",
        url: `/api/clients/${testClientId}/references/99999999-9999-9999-9999-999999999999`
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    });

    it("returns 404 NOT_FOUND for foreign-owned reference asset without disclosing existence", async () => {
      const foreignAsset: ReferenceAsset = {
        id: "66666666-6666-6666-6666-666666666666" as ReferenceAssetId,
        clientId: otherClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${otherClientId}/references/hash6`,
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mimeType: "image/png",
        archivedAt: null
      };

      const { app } = createTestApp({
        initialAssets: [foreignAsset]
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/clients/${testClientId}/references/${foreignAsset.id}`
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    });

    it("returns 404 NOT_FOUND when archiving an already archived asset", async () => {
      const archivedAsset: ReferenceAsset = {
        id: "77777777-7777-7777-7777-777777777777" as ReferenceAssetId,
        clientId: testClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${testClientId}/references/hash7`,
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mimeType: "image/png",
        archivedAt: "2026-01-01T00:00:00.000Z"
      };

      const { app } = createTestApp({
        initialAssets: [archivedAsset]
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/clients/${testClientId}/references/${archivedAsset.id}`
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    });

    it("returns 401 when unauthenticated", async () => {
      const { app } = createTestApp({ authenticatedClientId: null });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/clients/${testClientId}/references/88888888-8888-8888-8888-888888888888`
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 403 when authenticated client differs from route :clientId", async () => {
      const { app } = createTestApp({ authenticatedClientId: otherClientId });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/clients/${testClientId}/references/88888888-8888-8888-8888-888888888888`
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("FORBIDDEN");
    });
  });

  describe("PATCH /api/clients/:clientId/references/:referenceId", () => {
    const activeAsset: ReferenceAsset = {
      id: "99999999-aaaa-9999-aaaa-999999999999" as ReferenceAssetId,
      clientId: testClientId,
      assetType: "image",
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${testClientId}/references/hash9`,
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      mimeType: "image/png",
      displayName: "Editable Asset",
      libraryRole: "subject_identity",
      archivedAt: null
    };

    it("updates library role to another valid role and returns 200 with updated response", async () => {
      const { app, referenceAssetRepository } = createTestApp({
        initialAssets: [activeAsset]
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/${activeAsset.id}`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: "product"
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(activeAsset.id);
      expect(body.libraryRole).toBe("product");

      // Verify in repository
      const inRepo = await referenceAssetRepository.findById(activeAsset.id);
      expect(inRepo?.libraryRole).toBe("product");
    });

    it("rejects null libraryRole with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp({
        initialAssets: [activeAsset]
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/${activeAsset.id}`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: null
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("rejects invalid role with 400 VALIDATION_FAILURE", async () => {
      const { app } = createTestApp({
        initialAssets: [activeAsset]
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/${activeAsset.id}`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: "invalid_role"
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 404 NOT_FOUND for non-existent reference asset", async () => {
      const { app } = createTestApp();

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/88888888-8888-8888-8888-888888888888`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: "product"
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    });

    it("returns 404 NOT_FOUND for foreign-owned reference asset without disclosing existence", async () => {
      const foreignAsset: ReferenceAsset = {
        id: "aaaaaaaa-ffff-aaaa-ffff-aaaaaaaaaaaa" as ReferenceAssetId,
        clientId: otherClientId,
        assetType: "image",
        storageBucket: BUCKETS.REFERENCE,
        storageObjectKey: `clients/${otherClientId}/references/foreign`,
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mimeType: "image/png",
        libraryRole: "style",
        archivedAt: null
      };

      const { app } = createTestApp({
        initialAssets: [foreignAsset]
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/${foreignAsset.id}`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: "product"
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    });

    it("returns 401 when unauthenticated", async () => {
      const { app } = createTestApp({ authenticatedClientId: null, initialAssets: [activeAsset] });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/${activeAsset.id}`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: "product"
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 403 when authenticated client differs from route :clientId", async () => {
      const { app } = createTestApp({
        authenticatedClientId: otherClientId,
        initialAssets: [activeAsset]
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/clients/${testClientId}/references/${activeAsset.id}`,
        headers: {
          "content-type": "application/json"
        },
        payload: {
          libraryRole: "product"
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("FORBIDDEN");
    });
  });
});
