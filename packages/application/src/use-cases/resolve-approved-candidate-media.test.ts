import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CampaignId, CandidateId, SceneId, StoryboardCandidate } from "@cco/domain";
import {
  ApprovalRevisionMismatchError,
  CandidateIdentityMismatchError,
  CandidateSceneMismatchError,
  InvalidApprovedVisualProductionInputError,
  MissingCandidateSelectionError,
  Scene,
  SelectedCandidateRevisionMismatchError,
  StaleCandidateRevisionError
} from "@cco/domain";
import type {
  GetObjectOptions,
  HashBytesPort,
  ObjectLocator,
  ObjectStoragePort,
  SceneRepository,
  StoryboardCandidateRepository,
  StoredObject
} from "../ports/index.js";
import {
  ApprovedCandidateMediaHashMismatchError,
  ApprovedCandidateMediaUnavailableError
} from "../ports/approved-candidate-media-errors.js";
import { CandidateNotFoundError } from "./candidate-not-found-error.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import {
  DEFAULT_MAX_CANDIDATE_IMAGE_BYTES,
  ResolveApprovedCandidateMediaUseCase,
  type ResolveApprovedCandidateMediaDeps
} from "./resolve-approved-candidate-media.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

class InMemoryObjectStorageStub implements ObjectStoragePort {
  readonly objects = new Map<string, StoredObject>();

  async putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType?: string;
    checksumSha256?: string;
  }): Promise<ObjectLocator> {
    const obj: StoredObject = {
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
      checksumSha256: input.checksumSha256 ?? sha256Hex(input.body)
    };
    this.objects.set(`${input.bucket}/${input.key}`, obj);
    return { bucket: input.bucket, key: input.key };
  }

  async getObject(
    locator: ObjectLocator,
    options?: GetObjectOptions
  ): Promise<StoredObject | undefined> {
    const stored = this.objects.get(`${locator.bucket}/${locator.key}`);
    if (!stored) return undefined;
    if (options?.maxBytes !== undefined && stored.body.byteLength > options.maxBytes) {
      throw new Error(
        `Object ${locator.bucket}/${locator.key} byteLength (${stored.body.byteLength}) exceeds maxBytes limit (${options.maxBytes})`
      );
    }
    return stored;
  }

  async copyObject(from: ObjectLocator, to: ObjectLocator): Promise<ObjectLocator> {
    const existing = await this.getObject(from);
    if (!existing) {
      throw new Error(`Source object not found: ${from.bucket}/${from.key}`);
    }
    await this.putObject({
      bucket: to.bucket,
      key: to.key,
      body: existing.body,
      ...(existing.contentType !== undefined ? { contentType: existing.contentType } : {}),
      ...(existing.checksumSha256 !== undefined ? { checksumSha256: existing.checksumSha256 } : {})
    });
    return to;
  }
}

class InMemorySceneRepositoryStub implements SceneRepository {
  readonly scenes = new Map<string, Scene>();

  async findById(sceneId: SceneId): Promise<Scene | undefined> {
    return this.scenes.get(sceneId);
  }

  async save(scene: Scene): Promise<void> {
    this.scenes.set(scene.id, scene);
  }
}

class InMemoryCandidateRepositoryStub implements StoryboardCandidateRepository {
  readonly candidates = new Map<string, StoryboardCandidate>();

  async findById(candidateId: CandidateId): Promise<StoryboardCandidate | undefined> {
    return this.candidates.get(candidateId);
  }

  async insert(candidate: StoryboardCandidate): Promise<void> {
    this.candidates.set(candidate.id, candidate);
  }

  async listBySceneAndRevision(
    sceneId: SceneId,
    specRevision: number
  ): Promise<readonly StoryboardCandidate[]> {
    return Array.from(this.candidates.values()).filter(
      (c) => c.sceneId === sceneId && c.specRevision === specRevision
    );
  }
}

describe("ResolveApprovedCandidateMediaUseCase", () => {
  const sceneId = "scene-101" as SceneId;
  const campaignId = "campaign-202" as CampaignId;
  const candidateId = "cand-303" as CandidateId;
  const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
  const expectedHash = sha256Hex(imageBytes);

  function createFixtureCandidate(overrides?: Partial<StoryboardCandidate>): StoryboardCandidate {
    return {
      id: candidateId,
      sceneId,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "cco-media",
      storageObjectKey: "scenes/scene-101/candidates/cand-303.png",
      contentHash: expectedHash,
      generationMetadata: {},
      createdAt: "2026-09-09T10:00:00.000Z",
      ...overrides
    };
  }

  interface FixtureSceneOverrides {
    readonly id?: SceneId;
    readonly campaignId?: CampaignId;
    readonly status?: Parameters<typeof Scene.reconstitute>[0]["status"];
    readonly specRevision?: number;
    readonly configuration?: Parameters<typeof Scene.reconstitute>[0]["configuration"];
    readonly sequenceIndex?: number;
    readonly selectedCandidateId?: CandidateId | null;
    readonly selectedCandidateRevision?: number | null;
    readonly approval?: Parameters<typeof Scene.reconstitute>[0]["approval"] | null;
  }

  function createFixtureScene(overrides?: FixtureSceneOverrides): Scene {
    const hasApproval = overrides && "approval" in overrides;
    const approval = hasApproval
      ? (overrides.approval ?? undefined)
      : {
          revision: 1,
          approvedBy: "director-1",
          approvedAt: "2026-09-09T10:05:00.000Z"
        };

    const hasSelectedCandidateId = overrides && "selectedCandidateId" in overrides;
    const selectedCandidateId = hasSelectedCandidateId
      ? (overrides.selectedCandidateId ?? undefined)
      : candidateId;

    const hasSelectedCandidateRevision = overrides && "selectedCandidateRevision" in overrides;
    const selectedCandidateRevision = hasSelectedCandidateRevision
      ? (overrides.selectedCandidateRevision ?? undefined)
      : 1;

    return Scene.reconstitute({
      id: overrides?.id ?? sceneId,
      campaignId: overrides?.campaignId ?? campaignId,
      status: overrides?.status ?? "approved",
      specRevision: overrides?.specRevision ?? 1,
      configuration: overrides?.configuration ?? {
        prompt: "A cinematic establishing shot",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      ...(overrides?.sequenceIndex !== undefined ? { sequenceIndex: overrides.sequenceIndex } : {}),
      ...(approval !== undefined ? { approval } : {}),
      ...(selectedCandidateId !== undefined ? { selectedCandidateId } : {}),
      ...(selectedCandidateRevision !== undefined ? { selectedCandidateRevision } : {})
    });
  }

  function setupEnvironment(options?: {
    candidate?: StoryboardCandidate;
    scene?: Scene;
    objectStorage?: ObjectStoragePort;
    hashBytes?: HashBytesPort;
    maxCandidateImageBytes?: number;
  }): {
    useCase: ResolveApprovedCandidateMediaUseCase;
    candidateRepo: InMemoryCandidateRepositoryStub;
    sceneRepo: InMemorySceneRepositoryStub;
    storage: ObjectStoragePort;
  } {
    const candidateRepo = new InMemoryCandidateRepositoryStub();
    const sceneRepo = new InMemorySceneRepositoryStub();
    const storage = options?.objectStorage ?? new InMemoryObjectStorageStub();
    const hashBytes: HashBytesPort = options?.hashBytes ?? {
      hashBytes: async (bytes) => sha256Hex(bytes)
    };

    if (options?.candidate) {
      candidateRepo.candidates.set(options.candidate.id, options.candidate);
    }
    if (options?.scene) {
      sceneRepo.scenes.set(options.scene.id, options.scene);
    }

    const deps: ResolveApprovedCandidateMediaDeps = {
      sceneRepository: sceneRepo,
      storyboardCandidateRepository: candidateRepo,
      objectStorage: storage,
      hashBytes,
      ...(options?.maxCandidateImageBytes !== undefined
        ? { maxCandidateImageBytes: options.maxCandidateImageBytes }
        : {})
    };

    const useCase = new ResolveApprovedCandidateMediaUseCase(deps);
    return { useCase, candidateRepo, sceneRepo, storage };
  }

  it("resolves and hash-verifies valid approved candidate media successfully", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes,
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const result = await useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    // Invariants verified
    expect(result.input.candidateId).toBe(candidateId);
    expect(result.input.sceneId).toBe(sceneId);
    expect(result.input.specRevision).toBe(1);
    expect(result.input.contentHashSha256).toBe(expectedHash);

    // Resolved media ref verified
    expect(result.media.bucket).toBe("cco-media");
    expect(result.media.key).toBe("scenes/scene-101/candidates/cand-303.png");
    expect(result.media.sha256).toBe(expectedHash);
    expect(result.media.contentType).toBe("image/png");

    // No ephemeral/presigned or local paths
    expect((result.media as Record<string, unknown>).presignedUrl).toBeUndefined();
    expect((result.media as Record<string, unknown>).localPath).toBeUndefined();
  });

  it("works identically through the resolve() method alias", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes,
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const result = await useCase.resolve({
      sceneId,
      approvedCandidateId: candidateId
    });

    expect(result.input.candidateId).toBe(candidateId);
    expect(result.media.sha256).toBe(expectedHash);
  });

  it.each(["image/png", "image/jpeg", "image/webp"])(
    "accepts supported content type '%s'",
    async (contentType) => {
      const candidate = createFixtureCandidate();
      const scene = createFixtureScene();
      const storage = new InMemoryObjectStorageStub();
      await storage.putObject({
        bucket: candidate.storageBucket,
        key: candidate.storageObjectKey,
        body: imageBytes,
        contentType
      });

      const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

      const result = await useCase.execute({
        sceneId,
        approvedCandidateId: candidateId
      });

      expect(result.media.contentType).toBe(contentType);
    }
  );

  it("handles content type with parameters like charset", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes,
      contentType: "image/png; charset=utf-8"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const result = await useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    expect(result.media.contentType).toBe("image/png; charset=utf-8");
  });

  it("rejects candidate if candidate does not exist in repository", async () => {
    const scene = createFixtureScene();
    const { useCase } = setupEnvironment({ scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidateId
      })
    ).rejects.toThrow(CandidateNotFoundError);
  });

  it("rejects scene if scene does not exist in repository", async () => {
    const candidate = createFixtureCandidate();
    const { useCase } = setupEnvironment({ candidate });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidateId
      })
    ).rejects.toThrow(SceneNotFoundError);
  });

  it("rejects a different candidate from the same scene and same revision (not selected)", async () => {
    const candidateA = createFixtureCandidate({ id: "cand-A" as CandidateId });
    const candidateB = createFixtureCandidate({ id: "cand-B" as CandidateId });

    // Scene selected and approved candidate A at revision 1
    const scene = createFixtureScene({
      selectedCandidateId: candidateA.id,
      selectedCandidateRevision: 1,
      approval: {
        revision: 1,
        approvedBy: "director-1",
        approvedAt: "2026-09-09T10:05:00.000Z"
      }
    });

    // Job asks for candidate B
    const { useCase, candidateRepo } = setupEnvironment({ candidate: candidateB, scene });
    candidateRepo.candidates.set(candidateA.id, candidateA);

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidateB.id
      })
    ).rejects.toThrow(CandidateIdentityMismatchError);
  });

  it("rejects candidate when candidate belongs to a different scene", async () => {
    const candidateFromOtherScene = createFixtureCandidate({
      sceneId: "scene-999" as SceneId
    });
    const scene = createFixtureScene({
      selectedCandidateId: candidateFromOtherScene.id
    });

    const { useCase } = setupEnvironment({ candidate: candidateFromOtherScene, scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidateFromOtherScene.id
      })
    ).rejects.toThrow(CandidateSceneMismatchError);
  });

  it("rejects candidate when candidate specRevision is stale compared to scene", async () => {
    const candidate = createFixtureCandidate({ specRevision: 1 });
    const scene = createFixtureScene({
      specRevision: 2,
      selectedCandidateId: candidate.id,
      selectedCandidateRevision: 1,
      approval: {
        revision: 2,
        approvedBy: "director-1",
        approvedAt: "2026-09-09T10:05:00.000Z"
      }
    });

    const { useCase } = setupEnvironment({ candidate, scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidate.id
      })
    ).rejects.toThrow(StaleCandidateRevisionError);
  });

  it("rejects when scene selectedCandidateRevision does not match candidate specRevision", async () => {
    const candidate = createFixtureCandidate({ specRevision: 2 });
    const scene = createFixtureScene({
      specRevision: 2,
      selectedCandidateId: candidate.id,
      selectedCandidateRevision: 1, // Mismatched
      approval: {
        revision: 2,
        approvedBy: "director-1",
        approvedAt: "2026-09-09T10:05:00.000Z"
      }
    });

    const { useCase } = setupEnvironment({ candidate, scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidate.id
      })
    ).rejects.toThrow(SelectedCandidateRevisionMismatchError);
  });

  it("rejects when scene approval revision does not match candidate revision", async () => {
    const candidate = createFixtureCandidate({ specRevision: 2 });
    const scene = createFixtureScene({
      specRevision: 2,
      selectedCandidateId: candidate.id,
      selectedCandidateRevision: 2,
      approval: {
        revision: 1, // Stale approval
        approvedBy: "director-1",
        approvedAt: "2026-09-09T10:05:00.000Z"
      }
    });

    const { useCase } = setupEnvironment({ candidate, scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidate.id
      })
    ).rejects.toThrow(ApprovalRevisionMismatchError);
  });

  it("rejects when scene has no approval record", async () => {
    const candidate = createFixtureCandidate({ specRevision: 1 });
    const scene = createFixtureScene({
      specRevision: 1,
      selectedCandidateId: candidate.id,
      selectedCandidateRevision: 1,
      approval: null
    });

    const { useCase } = setupEnvironment({ candidate, scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidate.id
      })
    ).rejects.toThrow(ApprovalRevisionMismatchError);
  });

  it("rejects when scene has no candidate selection", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene({
      selectedCandidateId: null,
      selectedCandidateRevision: null
    });

    const { useCase } = setupEnvironment({ candidate, scene });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidate.id
      })
    ).rejects.toThrow(MissingCandidateSelectionError);
  });

  it("rejects when candidate media object is missing in object storage", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub(); // empty storage

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "missing"
    });
  });

  it("rejects when candidate media object is empty (0 bytes / unreadable)", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: new Uint8Array([]), // 0 bytes
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "unreadable"
    });
  });

  it("rejects when actual media bytes SHA-256 does not match candidate contentHash (corrupt media)", async () => {
    const candidate = createFixtureCandidate({
      contentHash: expectedHash
    });
    const scene = createFixtureScene();
    const corruptBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const actualCorruptHash = sha256Hex(corruptBytes);

    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: corruptBytes,
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaHashMismatchError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      expectedSha256: expectedHash,
      actualSha256: actualCorruptHash
    });
  });

  it("rejects when media has unsupported content type", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes,
      contentType: "video/mp4" // Unsupported for storyboard candidate conditioning
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "unsupported_content_type"
    });
  });

  it("rejects when media has missing / empty content type", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes,
      contentType: ""
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "unsupported_content_type"
    });
  });

  it("rejects when candidate has malformed content hash (not 64-hex SHA-256)", async () => {
    const candidate = createFixtureCandidate({
      contentHash: "not-a-valid-sha256"
    });
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes,
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    await expect(
      useCase.execute({
        sceneId,
        approvedCandidateId: candidateId
      })
    ).rejects.toThrow(InvalidApprovedVisualProductionInputError);
  });

  it("rejects with unreadable and preserves cause when storage throws a provider/network read error", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const networkError = new Error("Connection reset by peer");
    const throwingStorage: ObjectStoragePort = {
      async putObject() {
        throw new Error("not implemented");
      },
      async getObject() {
        throw networkError;
      },
      async copyObject() {
        throw new Error("not implemented");
      }
    };

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: throwingStorage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "unreadable"
    });
    const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
    expect(error.cause).toBe(networkError);
  });

  it("rejects with corrupt and preserves cause when storage throws a checksum mismatch error", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const checksumError = new Error(
      "Checksum mismatch on getObject for cco-media/cand.png: stored checksum abc, calculated def"
    );
    const corruptStorage: ObjectStoragePort = {
      async putObject() {
        throw new Error("not implemented");
      },
      async getObject() {
        throw checksumError;
      },
      async copyObject() {
        throw new Error("not implemented");
      }
    };

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: corruptStorage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "corrupt"
    });
    const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
    expect(error.cause).toBe(checksumError);
  });

  it("rejects with unreadable and preserves cause when media exceeds default candidate image byte limit (10 MiB)", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    const oversizedBytes = new Uint8Array(DEFAULT_MAX_CANDIDATE_IMAGE_BYTES + 1);
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: oversizedBytes,
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({ candidate, scene, objectStorage: storage });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "unreadable"
    });
    const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
    expect(error.cause).toBeDefined();
    expect((error.cause as Error).message).toMatch(/exceeds maxBytes limit/);
  });

  it("rejects with unreadable and preserves cause when media exceeds custom configured maxCandidateImageBytes limit", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes, // 8 bytes
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({
      candidate,
      scene,
      objectStorage: storage,
      maxCandidateImageBytes: 4 // limit to 4 bytes
    });

    const promise = useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
    await expect(promise).rejects.toMatchObject({
      candidateId: candidate.id,
      reason: "unreadable"
    });
    const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
    expect(error.cause).toBeDefined();
    expect((error.cause as Error).message).toMatch(/exceeds maxBytes limit/);
  });

  it("succeeds when media is within custom configured maxCandidateImageBytes limit", async () => {
    const candidate = createFixtureCandidate();
    const scene = createFixtureScene();
    const storage = new InMemoryObjectStorageStub();
    await storage.putObject({
      bucket: candidate.storageBucket,
      key: candidate.storageObjectKey,
      body: imageBytes, // 8 bytes
      contentType: "image/png"
    });

    const { useCase } = setupEnvironment({
      candidate,
      scene,
      objectStorage: storage,
      maxCandidateImageBytes: 100 // limit allows 8 bytes
    });

    const result = await useCase.execute({
      sceneId,
      approvedCandidateId: candidateId
    });

    expect(result.media.sha256).toBe(expectedHash);
  });
});
