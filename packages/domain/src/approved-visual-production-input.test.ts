import { describe, expect, it } from "vitest";
import {
  ApprovalRevisionMismatchError,
  type ApprovedVisualProductionInput,
  ApprovedVisualProductionInputInvariantError,
  CandidateIdentityMismatchError,
  CandidateSceneMismatchError,
  createApprovedVisualProductionInput,
  InvalidApprovedVisualProductionInputError,
  MissingCandidateSelectionError,
  SelectedCandidateRevisionMismatchError,
  SHA256_HEX_PATTERN,
  StaleCandidateRevisionError,
  verifyApprovedVisualProductionInput
} from "./approved-visual-production-input.js";
import {
  Scene,
  type CampaignId,
  type CandidateId,
  type SceneId,
  type SceneSnapshot
} from "./scene.js";
import type { StoryboardCandidate } from "./storyboard-candidate.js";

const VALID_HASH_A = "a".repeat(64);
const VALID_HASH_B = "b".repeat(64);

function createCandidateFixture(overrides: Partial<StoryboardCandidate> = {}): StoryboardCandidate {
  return {
    id: "candidate-001" as CandidateId,
    sceneId: "scene-001" as SceneId,
    specRevision: 1,
    variantOrdinal: 0,
    storageBucket: "cco-test-bucket",
    storageObjectKey: "scenes/scene-001/candidates/candidate-001.png",
    contentHash: VALID_HASH_A,
    generationMetadata: { seed: 12345 },
    createdAt: "2026-09-09T10:00:00.000Z",
    ...overrides
  };
}

type SceneSnapshotOverrides = {
  [K in keyof SceneSnapshot]?: SceneSnapshot[K] | undefined;
};

function createApprovedSceneSnapshot(overrides: SceneSnapshotOverrides = {}): SceneSnapshot {
  const base: SceneSnapshot = {
    id: "scene-001" as SceneId,
    campaignId: "campaign-001" as CampaignId,
    status: "approved",
    specRevision: 1,
    configuration: {
      prompt: "A cinematic neon cityscape",
      referenceIds: [],
      engineProfileId: "ltx-2.5@certified-v1",
      durationMs: 4000
    },
    sequenceIndex: 1,
    selectedCandidateId: "candidate-001" as CandidateId,
    selectedCandidateRevision: 1,
    approval: {
      revision: 1,
      approvedBy: "director-alice",
      approvedAt: "2026-09-09T10:30:00.000Z"
    }
  };

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result as unknown as SceneSnapshot;
}

describe("ApprovedVisualProductionInput domain contracts", () => {
  describe("SHA256_HEX_PATTERN", () => {
    it("matches lowercase 64-character hex strings", () => {
      expect(SHA256_HEX_PATTERN.test(VALID_HASH_A)).toBe(true);
      expect(
        SHA256_HEX_PATTERN.test("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
      ).toBe(true);
    });

    it("rejects non-conforming strings", () => {
      expect(SHA256_HEX_PATTERN.test("")).toBe(false);
      expect(SHA256_HEX_PATTERN.test("A".repeat(64))).toBe(false); // uppercase
      expect(SHA256_HEX_PATTERN.test("a".repeat(63))).toBe(false); // too short
      expect(SHA256_HEX_PATTERN.test("a".repeat(65))).toBe(false); // too long
      expect(SHA256_HEX_PATTERN.test("g".repeat(64))).toBe(false); // non-hex
    });
  });

  describe("createApprovedVisualProductionInput", () => {
    it("creates an immutable ApprovedVisualProductionInput from a valid StoryboardCandidate", () => {
      const candidate = createCandidateFixture();
      const input: ApprovedVisualProductionInput = createApprovedVisualProductionInput(candidate);

      expect(input).toEqual({
        candidateId: "candidate-001",
        sceneId: "scene-001",
        specRevision: 1,
        contentHashSha256: VALID_HASH_A
      });
      expect(Object.isFrozen(input)).toBe(true);
    });

    it("throws InvalidApprovedVisualProductionInputError when candidate contentHash is malformed", () => {
      const candidate = createCandidateFixture({ contentHash: "not-a-valid-sha256" });

      expect(() => createApprovedVisualProductionInput(candidate)).toThrow(
        InvalidApprovedVisualProductionInputError
      );

      try {
        createApprovedVisualProductionInput(candidate);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidApprovedVisualProductionInputError);
        expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
        expect(err).toBeInstanceOf(Error);
        const invariantErr = err as InvalidApprovedVisualProductionInputError;
        expect(invariantErr.name).toBe("InvalidApprovedVisualProductionInputError");
        expect(invariantErr.code).toBe("invalid_approved_visual_production_input");
        expect(invariantErr.candidateId).toBe(candidate.id);
        expect(invariantErr.contentHash).toBe("not-a-valid-sha256");
        expect(invariantErr.reason).toContain("lowercase 64-character hexadecimal SHA-256");
      }
    });

    it("rejects uppercase sha256 hash", () => {
      const candidate = createCandidateFixture({ contentHash: VALID_HASH_A.toUpperCase() });
      expect(() => createApprovedVisualProductionInput(candidate)).toThrow(
        InvalidApprovedVisualProductionInputError
      );
    });
  });

  describe("verifyApprovedVisualProductionInput", () => {
    describe("happy paths", () => {
      it("succeeds for dispatch-time validation when job is omitted", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot();

        const input = verifyApprovedVisualProductionInput({
          candidate,
          scene
        });

        expect(input).toEqual({
          candidateId: "candidate-001",
          sceneId: "scene-001",
          specRevision: 1,
          contentHashSha256: VALID_HASH_A
        });
        expect(Object.isFrozen(input)).toBe(true);
      });

      it("succeeds for job-bound validation when job approvedCandidateId and sceneId match", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot();

        const input = verifyApprovedVisualProductionInput({
          candidate,
          scene,
          job: {
            approvedCandidateId: candidate.id,
            sceneId: scene.id
          }
        });

        expect(input.candidateId).toBe(candidate.id);
        expect(input.sceneId).toBe(scene.id);
        expect(input.specRevision).toBe(candidate.specRevision);
        expect(input.contentHashSha256).toBe(candidate.contentHash);
      });

      it("succeeds for job-bound validation when job.sceneId is omitted but approvedCandidateId matches", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot();

        const input = verifyApprovedVisualProductionInput({
          candidate,
          scene,
          job: {
            approvedCandidateId: candidate.id
          }
        });

        expect(input.candidateId).toBe(candidate.id);
      });

      it("validates successfully against a snapshot produced by the live Scene aggregate", () => {
        const sceneAggregate = Scene.create({
          id: "scene-aggregate-1" as SceneId,
          campaignId: "campaign-1" as CampaignId,
          configuration: {
            prompt: "Scene aggregate prompt",
            referenceIds: [],
            engineProfileId: "ltx-2.5@certified-v1",
            durationMs: 4000
          }
        });
        sceneAggregate.beginCandidateGeneration();
        sceneAggregate.submitCandidatesForReview();
        sceneAggregate.selectCandidate(
          "candidate-agg-1" as CandidateId,
          1,
          "scene-aggregate-1" as SceneId
        );
        sceneAggregate.approve({
          approvedBy: "reviewer-bob",
          approvedAt: "2026-09-09T11:00:00.000Z"
        });

        const candidate = createCandidateFixture({
          id: "candidate-agg-1" as CandidateId,
          sceneId: "scene-aggregate-1" as SceneId,
          specRevision: 1
        });

        const input = verifyApprovedVisualProductionInput({
          candidate,
          scene: sceneAggregate.snapshot(),
          job: {
            approvedCandidateId: candidate.id,
            sceneId: sceneAggregate.id
          }
        });

        expect(input.candidateId).toBe("candidate-agg-1");
        expect(input.sceneId).toBe("scene-aggregate-1");
        expect(input.specRevision).toBe(1);
      });
    });

    describe("candidate selection checks (MissingCandidateSelectionError)", () => {
      it("throws MissingCandidateSelectionError when scene has no selectedCandidateId", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot({ selectedCandidateId: undefined });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          MissingCandidateSelectionError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(MissingCandidateSelectionError);
          expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
          const e = err as MissingCandidateSelectionError;
          expect(e.name).toBe("MissingCandidateSelectionError");
          expect(e.code).toBe("missing_candidate_selection");
          expect(e.sceneId).toBe(scene.id);
          expect(e.selectedCandidateId).toBeUndefined();
          expect(e.selectedCandidateRevision).toBe(scene.selectedCandidateRevision);
        }
      });

      it("throws MissingCandidateSelectionError when scene has no selectedCandidateRevision", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot({ selectedCandidateRevision: undefined });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          MissingCandidateSelectionError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(MissingCandidateSelectionError);
          const e = err as MissingCandidateSelectionError;
          expect(e.selectedCandidateRevision).toBeUndefined();
          expect(e.selectedCandidateId).toBe(scene.selectedCandidateId);
        }
      });
    });

    describe("candidate identity checks (CandidateIdentityMismatchError)", () => {
      it("throws CandidateIdentityMismatchError when scene selected candidate id differs, even if both belong to the same scene and revision", () => {
        // Two distinct candidates generated for the exact same scene and revision
        const candidateA = createCandidateFixture({
          id: "candidate-001" as CandidateId,
          variantOrdinal: 0,
          contentHash: VALID_HASH_A
        });
        const candidateB = createCandidateFixture({
          id: "candidate-002" as CandidateId,
          variantOrdinal: 1,
          contentHash: VALID_HASH_B
        });

        // Scene selected candidateA
        const scene = createApprovedSceneSnapshot({
          selectedCandidateId: candidateA.id,
          selectedCandidateRevision: 1
        });

        // Attempt to condition production with candidateB
        expect(() =>
          verifyApprovedVisualProductionInput({
            candidate: candidateB,
            scene
          })
        ).toThrow(CandidateIdentityMismatchError);

        try {
          verifyApprovedVisualProductionInput({ candidate: candidateB, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateIdentityMismatchError);
          expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
          const e = err as CandidateIdentityMismatchError;
          expect(e.name).toBe("CandidateIdentityMismatchError");
          expect(e.code).toBe("candidate_identity_mismatch");
          expect(e.candidateId).toBe(candidateB.id);
          expect(e.expectedCandidateId).toBe(candidateA.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.source).toBe("scene");
        }
      });

      it("throws CandidateIdentityMismatchError when job.approvedCandidateId differs from candidate.id", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot();

        expect(() =>
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: {
              approvedCandidateId: "different-candidate" as CandidateId,
              sceneId: scene.id
            }
          })
        ).toThrow(CandidateIdentityMismatchError);

        try {
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: {
              approvedCandidateId: "different-candidate" as CandidateId,
              sceneId: scene.id
            }
          });
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateIdentityMismatchError);
          const e = err as CandidateIdentityMismatchError;
          expect(e.candidateId).toBe(candidate.id);
          expect(e.expectedCandidateId).toBe("different-candidate");
          expect(e.source).toBe("job");
        }
      });

      it("fails closed with CandidateIdentityMismatchError when job object is present but approvedCandidateId is undefined", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot();

        expect(() =>
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: {
              approvedCandidateId: undefined,
              sceneId: scene.id
            }
          })
        ).toThrow(CandidateIdentityMismatchError);

        try {
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: { approvedCandidateId: undefined, sceneId: scene.id }
          });
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateIdentityMismatchError);
          const e = err as CandidateIdentityMismatchError;
          expect(e.candidateId).toBe(candidate.id);
          expect(e.expectedCandidateId).toBeUndefined();
          expect(e.source).toBe("job");
        }
      });
    });

    describe("candidate and job scene checks (CandidateSceneMismatchError)", () => {
      it("throws CandidateSceneMismatchError when candidate.sceneId does not match scene.id", () => {
        const candidate = createCandidateFixture({
          sceneId: "foreign-scene-999" as SceneId
        });
        const scene = createApprovedSceneSnapshot({
          selectedCandidateId: candidate.id
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          CandidateSceneMismatchError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateSceneMismatchError);
          expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
          const e = err as CandidateSceneMismatchError;
          expect(e.name).toBe("CandidateSceneMismatchError");
          expect(e.code).toBe("candidate_scene_mismatch");
          expect(e.candidateId).toBe(candidate.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.candidateSceneId).toBe("foreign-scene-999");
          expect(e.mismatchedSceneId).toBe("foreign-scene-999");
          expect(e.source).toBe("candidate");
        }
      });

      it("throws CandidateSceneMismatchError when job.sceneId differs from scene.id while candidate matches", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot();

        expect(() =>
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: {
              approvedCandidateId: candidate.id,
              sceneId: "different-scene-in-job" as SceneId
            }
          })
        ).toThrow(CandidateSceneMismatchError);

        try {
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: {
              approvedCandidateId: candidate.id,
              sceneId: "different-scene-in-job" as SceneId
            }
          });
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateSceneMismatchError);
          const e = err as CandidateSceneMismatchError;
          expect(e.candidateId).toBe(candidate.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.jobSceneId).toBe("different-scene-in-job");
          expect(e.mismatchedSceneId).toBe("different-scene-in-job");
          expect(e.source).toBe("job");
        }
      });
    });

    describe("revision agreement checks (StaleCandidateRevisionError, SelectedCandidateRevisionMismatchError, ApprovalRevisionMismatchError)", () => {
      it("throws StaleCandidateRevisionError when candidate.specRevision does not match scene.specRevision", () => {
        const candidate = createCandidateFixture({ specRevision: 1 });
        const scene = createApprovedSceneSnapshot({
          specRevision: 2,
          selectedCandidateRevision: 1,
          approval: {
            revision: 1,
            approvedBy: "alice",
            approvedAt: "2026-09-09T10:00:00.000Z"
          }
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          StaleCandidateRevisionError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(StaleCandidateRevisionError);
          expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
          const e = err as StaleCandidateRevisionError;
          expect(e.name).toBe("StaleCandidateRevisionError");
          expect(e.code).toBe("stale_candidate_revision");
          expect(e.candidateId).toBe(candidate.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.candidateRevision).toBe(1);
          expect(e.sceneRevision).toBe(2);
        }
      });

      it("throws SelectedCandidateRevisionMismatchError when scene.selectedCandidateRevision does not match candidate.specRevision", () => {
        const candidate = createCandidateFixture({ specRevision: 2 });
        const scene = createApprovedSceneSnapshot({
          specRevision: 2,
          selectedCandidateRevision: 1, // Desynced selection pointer
          approval: {
            revision: 2,
            approvedBy: "alice",
            approvedAt: "2026-09-09T10:00:00.000Z"
          }
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          SelectedCandidateRevisionMismatchError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(SelectedCandidateRevisionMismatchError);
          expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
          const e = err as SelectedCandidateRevisionMismatchError;
          expect(e.name).toBe("SelectedCandidateRevisionMismatchError");
          expect(e.code).toBe("selected_candidate_revision_mismatch");
          expect(e.candidateId).toBe(candidate.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.candidateRevision).toBe(2);
          expect(e.selectedCandidateRevision).toBe(1);
        }
      });

      it("throws ApprovalRevisionMismatchError when scene approval is undefined", () => {
        const candidate = createCandidateFixture();
        const scene = createApprovedSceneSnapshot({ approval: undefined });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          ApprovalRevisionMismatchError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(ApprovalRevisionMismatchError);
          expect(err).toBeInstanceOf(ApprovedVisualProductionInputInvariantError);
          const e = err as ApprovalRevisionMismatchError;
          expect(e.name).toBe("ApprovalRevisionMismatchError");
          expect(e.code).toBe("approval_revision_mismatch");
          expect(e.candidateId).toBe(candidate.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.candidateRevision).toBe(1);
          expect(e.approvalRevision).toBeUndefined();
        }
      });

      it("throws ApprovalRevisionMismatchError when scene approval revision does not match candidate specRevision", () => {
        const candidate = createCandidateFixture({ specRevision: 2 });
        const scene = createApprovedSceneSnapshot({
          specRevision: 2,
          selectedCandidateRevision: 2,
          approval: {
            revision: 1, // Stale approval from revision 1
            approvedBy: "alice",
            approvedAt: "2026-09-09T10:00:00.000Z"
          }
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          ApprovalRevisionMismatchError
        );

        try {
          verifyApprovedVisualProductionInput({ candidate, scene });
        } catch (err) {
          expect(err).toBeInstanceOf(ApprovalRevisionMismatchError);
          const e = err as ApprovalRevisionMismatchError;
          expect(e.candidateId).toBe(candidate.id);
          expect(e.sceneId).toBe(scene.id);
          expect(e.candidateRevision).toBe(2);
          expect(e.approvalRevision).toBe(1);
        }
      });
    });

    describe("candidate content hash validation", () => {
      it("throws InvalidApprovedVisualProductionInputError when verified candidate has malformed contentHash", () => {
        const candidate = createCandidateFixture({ contentHash: "malformed-hash" });
        const scene = createApprovedSceneSnapshot();

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          InvalidApprovedVisualProductionInputError
        );
      });
    });

    describe("deterministic check precedence", () => {
      it("evaluates missing candidate selection before candidate identity mismatch", () => {
        const candidate = createCandidateFixture({ id: "cand-other" as CandidateId });
        const scene = createApprovedSceneSnapshot({
          selectedCandidateId: undefined
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          MissingCandidateSelectionError
        );
      });

      it("evaluates scene candidate identity before job candidate identity", () => {
        const candidate = createCandidateFixture({ id: "cand-1" as CandidateId });
        const scene = createApprovedSceneSnapshot({
          selectedCandidateId: "cand-2" as CandidateId
        });

        try {
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: { approvedCandidateId: "cand-3" as CandidateId }
          });
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateIdentityMismatchError);
          const e = err as CandidateIdentityMismatchError;
          expect(e.source).toBe("scene");
          expect(e.expectedCandidateId).toBe("cand-2");
        }
      });

      it("evaluates candidate identity before candidate scene mismatch", () => {
        const candidate = createCandidateFixture({
          id: "cand-wrong" as CandidateId,
          sceneId: "scene-wrong" as SceneId
        });
        const scene = createApprovedSceneSnapshot({
          selectedCandidateId: "cand-001" as CandidateId
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          CandidateIdentityMismatchError
        );
      });

      it("evaluates candidate scene mismatch before job scene mismatch", () => {
        const candidate = createCandidateFixture({
          sceneId: "scene-wrong-candidate" as SceneId
        });
        const scene = createApprovedSceneSnapshot({
          selectedCandidateId: candidate.id
        });

        try {
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: { approvedCandidateId: candidate.id, sceneId: "scene-wrong-job" as SceneId }
          });
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateSceneMismatchError);
          const e = err as CandidateSceneMismatchError;
          expect(e.source).toBe("candidate");
          expect(e.mismatchedSceneId).toBe("scene-wrong-candidate");
        }
      });

      it("evaluates job scene mismatch before stale candidate revision", () => {
        const candidate = createCandidateFixture({
          specRevision: 1
        });
        const scene = createApprovedSceneSnapshot({
          specRevision: 2,
          selectedCandidateRevision: 2,
          approval: { revision: 2, approvedBy: "a", approvedAt: "2026-09-09T00:00:00.000Z" }
        });

        try {
          verifyApprovedVisualProductionInput({
            candidate,
            scene,
            job: { approvedCandidateId: candidate.id, sceneId: "different-scene" as SceneId }
          });
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(CandidateSceneMismatchError);
          const e = err as CandidateSceneMismatchError;
          expect(e.source).toBe("job");
        }
      });

      it("evaluates stale candidate revision before selected candidate revision mismatch", () => {
        const candidate = createCandidateFixture({ specRevision: 1 });
        const scene = createApprovedSceneSnapshot({
          specRevision: 2,
          selectedCandidateRevision: 3
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          StaleCandidateRevisionError
        );
      });

      it("evaluates selected candidate revision mismatch before approval revision mismatch", () => {
        const candidate = createCandidateFixture({ specRevision: 2 });
        const scene = createApprovedSceneSnapshot({
          specRevision: 2,
          selectedCandidateRevision: 1,
          approval: undefined
        });

        expect(() => verifyApprovedVisualProductionInput({ candidate, scene })).toThrow(
          SelectedCandidateRevisionMismatchError
        );
      });
    });
  });
});
