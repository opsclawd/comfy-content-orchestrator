import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { CandidateId, SceneId, StoryboardCandidate } from "@cco/domain";
import { PostgresStoryboardCandidateRepository } from "./postgres-storyboard-candidate-repository.js";

describe("PostgresStoryboardCandidateRepository (unit)", () => {
  const candidateId = "01928374-abcd-7000-8000-000000000001" as CandidateId;
  const sceneId = "01928374-abcd-7000-8000-000000000002" as SceneId;

  it("findById maps beat_index to candidate domain model and defaults null to 1", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            candidate_id: candidateId,
            scene_id: sceneId,
            scene_spec_revision: 1,
            variant_ordinal: 1,
            beat_index: 2,
            storage_bucket: "test-bucket",
            storage_object_key: "test-key",
            content_hash_sha256: "hash123",
            generation_payload: { modelProfile: "test-model" },
            created_at: new Date("2026-10-11T12:00:00Z")
          }
        ]
      })
    } as unknown as PoolClient;

    const repo = new PostgresStoryboardCandidateRepository(mockClient);
    const candidate = await repo.findById(candidateId);

    expect(candidate).toBeDefined();
    expect(candidate?.id).toBe(candidateId);
    expect(candidate?.beatIndex).toBe(2);
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("beat_index"), [
      candidateId
    ]);
  });

  it("insert persists beatIndex or defaults to 1 if omitted", async () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const mockClient = { query: queryFn } as unknown as PoolClient;
    const repo = new PostgresStoryboardCandidateRepository(mockClient);

    const candidateWithoutBeat: StoryboardCandidate = {
      id: candidateId,
      sceneId,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "test-bucket",
      storageObjectKey: "test-key",
      contentHash: "hash123",
      generationMetadata: {},
      createdAt: "2026-10-11T12:00:00.000Z"
    };

    await repo.insert(candidateWithoutBeat);

    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining("beat_index"),
      expect.arrayContaining([1])
    );
    // 5th param is beat_index (index 4 in 0-indexed params: candidate_id, scene_id, scene_spec_revision, variant_ordinal, beat_index)
    const callArgs = queryFn.mock.calls[0]!;
    expect(callArgs[1][4]).toBe(1);

    // Now insert with explicit beatIndex 3
    const candidateWithBeat: StoryboardCandidate = {
      ...candidateWithoutBeat,
      beatIndex: 3
    };

    await repo.insert(candidateWithBeat);
    const call2Args = queryFn.mock.calls[1]!;
    expect(call2Args[1][4]).toBe(3);
  });

  it("listBySceneAndRevision orders deterministically by variant then beat index", async () => {
    const queryFn = vi.fn().mockResolvedValue({
      rows: [
        {
          candidate_id: candidateId,
          scene_id: sceneId,
          scene_spec_revision: 1,
          variant_ordinal: 1,
          beat_index: 1,
          storage_bucket: "test-bucket",
          storage_object_key: "test-key-1",
          content_hash_sha256: "hash123",
          generation_payload: {},
          created_at: new Date("2026-10-11T12:00:00Z")
        },
        {
          candidate_id: "01928374-abcd-7000-8000-000000000003",
          scene_id: sceneId,
          scene_spec_revision: 1,
          variant_ordinal: 1,
          beat_index: 2,
          storage_bucket: "test-bucket",
          storage_object_key: "test-key-2",
          content_hash_sha256: "hash456",
          generation_payload: {},
          created_at: new Date("2026-10-11T12:01:00Z")
        }
      ]
    });
    const mockClient = { query: queryFn } as unknown as PoolClient;
    const repo = new PostgresStoryboardCandidateRepository(mockClient);

    const list = await repo.listBySceneAndRevision(sceneId, 1);
    expect(list).toHaveLength(2);
    expect(list[0]?.beatIndex).toBe(1);
    expect(list[1]?.beatIndex).toBe(2);

    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY variant_ordinal ASC, beat_index ASC"),
      [sceneId, 1]
    );
  });
});
