import { describe, expect, it } from "vitest";
import {
  CampaignReviewSummarySchema,
  CandidateReadModelSchema,
  MediaAvailabilitySchema,
  REVIEW_ACTIONS,
  REVIEW_ERROR_CODES,
  ReviewActionSchema,
  ReviewErrorCodeSchema,
  ReviewErrorResponseSchema,
  ReviewEventSchema,
  SCENE_STATUSES,
  SceneApprovalSchema,
  SceneConfigurationSchema,
  SceneReviewCandidateGroupSchema,
  SceneReviewDetailReadModelSchema,
  SceneStatusSchema,
  StoryboardCandidateSchema
} from "./scene-review.js";

describe("scene-review contracts", () => {
  it("accepts every canonical scene status and review action", () => {
    for (const status of SCENE_STATUSES) {
      expect(SceneStatusSchema.parse(status)).toBe(status);
    }

    for (const action of REVIEW_ACTIONS) {
      expect(ReviewActionSchema.parse(action)).toBe(action);
    }
  });

  it("rejects review events whose prior or resulting status is not canonical", () => {
    const validEvent = {
      eventId: "evt-001",
      sceneId: "scene-123",
      reviewerName: "Director Alice",
      action: "approve",
      directorNotes: "Looks great",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "approved",
      occurredAt: "2026-08-15T00:00:00.000Z"
    };

    expect(ReviewEventSchema.parse(validEvent)).toEqual(validEvent);

    const withInvalidPrior = {
      ...validEvent,
      priorSceneStatus: "non_canonical_status"
    };
    expect(ReviewEventSchema.safeParse(withInvalidPrior).success).toBe(false);

    const withInvalidResulting = {
      ...validEvent,
      resultingSceneStatus: "non_canonical_status"
    };
    expect(ReviewEventSchema.safeParse(withInvalidResulting).success).toBe(false);
  });

  it("accepts candidate_select as a canonical review action", () => {
    expect(ReviewActionSchema.parse("candidate_select")).toBe("candidate_select");

    const event = {
      eventId: "evt-002",
      sceneId: "scene-123",
      reviewerName: "Director Alice",
      action: "candidate_select",
      mutationPayload: { candidateId: "cand-1", candidateRevision: 1 },
      priorSceneStatus: "director_review",
      resultingSceneStatus: "director_review",
      occurredAt: "2026-08-15T00:00:00.000Z"
    };
    expect(ReviewEventSchema.parse(event)).toEqual(event);
  });

  it("accepts and validates expectedSpecRevision, resultingSpecRevision, and requestHashSha256", () => {
    const validWithIdempotency = {
      eventId: "evt-003",
      sceneId: "scene-123",
      reviewerName: "Director Alice",
      action: "candidate_select" as const,
      mutationPayload: { candidateId: "cand-1", candidateRevision: 1 },
      priorSceneStatus: "director_review" as const,
      resultingSceneStatus: "director_review" as const,
      expectedSpecRevision: 1,
      resultingSpecRevision: 1,
      requestHashSha256: "a".repeat(64),
      occurredAt: "2026-08-15T00:00:00.000Z"
    };
    expect(ReviewEventSchema.parse(validWithIdempotency)).toEqual(validWithIdempotency);

    // Rejects non-positive revisions
    expect(
      ReviewEventSchema.safeParse({ ...validWithIdempotency, expectedSpecRevision: 0 }).success
    ).toBe(false);
    expect(
      ReviewEventSchema.safeParse({ ...validWithIdempotency, resultingSpecRevision: -1 }).success
    ).toBe(false);

    // Rejects invalid sha256
    expect(
      ReviewEventSchema.safeParse({ ...validWithIdempotency, requestHashSha256: "short" }).success
    ).toBe(false);
  });
});

describe("Review Read Model and Error Contracts", () => {
  it("validates SceneConfigurationSchema matching domain configuration", () => {
    const validConfig = {
      prompt: "Cinematic shot of ocean waves",
      referenceIds: ["ref-1", "ref-2"],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: "lora-carnival-v1"
    };
    expect(SceneConfigurationSchema.parse(validConfig)).toEqual(validConfig);

    const withoutLora = {
      prompt: "Cinematic shot of ocean waves",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000
    };
    expect(SceneConfigurationSchema.parse(withoutLora)).toEqual(withoutLora);

    const withNullLora = {
      prompt: "Cinematic shot of ocean waves",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: null
    };
    expect(SceneConfigurationSchema.parse(withNullLora)).toEqual(withNullLora);

    // Invalid duration
    expect(
      SceneConfigurationSchema.safeParse({
        ...validConfig,
        durationMs: 0
      }).success
    ).toBe(false);

    // Invalid engine profile
    expect(
      SceneConfigurationSchema.safeParse({
        ...validConfig,
        engineProfileId: ""
      }).success
    ).toBe(false);
  });

  it("validates CandidateReadModelSchema and presentation-safe media availability", () => {
    const mediaAvailable = {
      available: true,
      url: "https://storage-01.godzspeed-internal.ts.net/godzspeed-review/cand-1.webp?token=xyz"
    };
    expect(MediaAvailabilitySchema.parse(mediaAvailable)).toEqual(mediaAvailable);

    const mediaUnavailable = { available: false };
    expect(MediaAvailabilitySchema.parse(mediaUnavailable)).toEqual(mediaUnavailable);

    const validCandidate = {
      candidateId: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222222",
      specRevision: 1,
      variantOrdinal: 1,
      contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      media: {
        available: true,
        url: "https://storage-01.godzspeed-internal.ts.net/godzspeed-review/cand-1.webp?token=xyz"
      },
      generationMetadata: { sampler: "euler", steps: 20 },
      createdAt: "2026-08-15T00:00:00.000Z"
    };

    expect(CandidateReadModelSchema.parse(validCandidate)).toEqual(validCandidate);

    const candidateGroup = {
      specRevision: 1,
      candidates: [validCandidate]
    };
    expect(SceneReviewCandidateGroupSchema.parse(candidateGroup)).toEqual(candidateGroup);

    const approval = {
      revision: 1,
      approvedBy: "Director Thomas",
      approvedAt: "2026-08-15T12:00:00.000Z"
    };
    expect(SceneApprovalSchema.parse(approval)).toEqual(approval);

    const unavailableCandidate = {
      ...validCandidate,
      media: { available: false }
    };
    expect(CandidateReadModelSchema.parse(unavailableCandidate)).toEqual(unavailableCandidate);

    // Non-UUID candidateId
    expect(
      CandidateReadModelSchema.safeParse({
        ...validCandidate,
        candidateId: "not-a-uuid"
      }).success
    ).toBe(false);

    // Non-positive specRevision
    expect(
      CandidateReadModelSchema.safeParse({
        ...validCandidate,
        specRevision: 0
      }).success
    ).toBe(false);
  });

  it("validates complete SceneReviewDetailReadModelSchema without exposing persistence or infrastructure internals", () => {
    const detail = {
      sceneId: "22222222-2222-4222-8222-222222222222",
      campaignId: "33333333-3333-4333-8333-333333333333",
      status: "director_review" as const,
      specRevision: 1,
      configuration: {
        prompt: "Sunset over Maracas Bay",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      selectedCandidateId: "11111111-1111-4111-8111-111111111111",
      selectedCandidateRevision: 1,
      approval: {
        revision: 1,
        approvedBy: "Director Thomas",
        approvedAt: "2026-08-15T12:00:00.000Z"
      },
      candidatesByRevision: [
        {
          specRevision: 1,
          candidates: [
            {
              candidateId: "11111111-1111-4111-8111-111111111111",
              sceneId: "22222222-2222-4222-8222-222222222222",
              specRevision: 1,
              variantOrdinal: 1,
              contentHash: "hash123",
              media: { available: true, url: "https://storage-01.ts.net/cand.webp" },
              createdAt: "2026-08-15T00:00:00.000Z"
            }
          ]
        }
      ],
      allowedActions: ["approve", "reroll", "candidate_select"] as const
    };

    expect(SceneReviewDetailReadModelSchema.parse(detail)).toEqual(detail);

    // Rejects non-canonical action
    expect(
      SceneReviewDetailReadModelSchema.safeParse({
        ...detail,
        allowedActions: ["invalid_action"]
      }).success
    ).toBe(false);

    // Rejects non-canonical status
    expect(
      SceneReviewDetailReadModelSchema.safeParse({
        ...detail,
        status: "unknown_status"
      }).success
    ).toBe(false);
  });

  it("validates SceneReviewDetailReadModelSchema and CampaignReviewSummarySchema", () => {
    const detail = {
      sceneId: "22222222-2222-4222-8222-222222222222",
      campaignId: "33333333-3333-4333-8333-333333333333",
      status: "director_review" as const,
      specRevision: 1,
      configuration: {
        prompt: "Sunset over Maracas Bay",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      candidatesByRevision: [],
      allowedActions: ["approve"] as const
    };

    expect(SceneReviewDetailReadModelSchema.parse(detail)).toEqual(detail);

    const summary = {
      campaignId: "33333333-3333-4333-8333-333333333333",
      campaignName: "Tobago Vacation Villa Reel",
      totalScenes: 6,
      scenesByStatus: {
        director_review: 4,
        approved: 2
      },
      pendingReviewCount: 4,
      approvedCount: 2,
      completedCount: 0,
      updatedAt: "2026-08-15T12:00:00.000Z"
    };

    expect(CampaignReviewSummarySchema.parse(summary)).toEqual(summary);

    // Negative scene count rejected
    expect(
      CampaignReviewSummarySchema.safeParse({
        ...summary,
        totalScenes: -1
      }).success
    ).toBe(false);
  });

  it("validates StoryboardCandidateSchema persistent data contract", () => {
    const candidate = {
      candidateId: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222222",
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: "candidates/scene-1/rev-1-var-1.webp",
      contentHashSha256: "a".repeat(64),
      generationMetadata: { prompt: "test" },
      createdAt: "2026-08-15T00:00:00.000Z"
    };

    expect(StoryboardCandidateSchema.parse(candidate)).toEqual(candidate);

    // Defaults generationMetadata if omitted
    const withoutMetadata = {
      candidateId: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222222",
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: "candidates/scene-1/rev-1-var-1.webp",
      contentHashSha256: "a".repeat(64),
      createdAt: "2026-08-15T00:00:00.000Z"
    };
    expect(StoryboardCandidateSchema.parse(withoutMetadata)).toEqual({
      ...withoutMetadata,
      generationMetadata: {}
    });

    // Rejects contentHash with wrong length
    expect(
      StoryboardCandidateSchema.safeParse({
        ...candidate,
        contentHashSha256: "short_hash"
      }).success
    ).toBe(false);
  });

  it("validates canonical review error codes and error response structure", () => {
    for (const code of REVIEW_ERROR_CODES) {
      expect(ReviewErrorCodeSchema.parse(code)).toBe(code);
    }

    const expectedCodes = [
      "NOT_FOUND",
      "STALE_REVISION_CONFLICT",
      "IDEMPOTENCY_CONFLICT",
      "INVALID_DOMAIN_TRANSITION",
      "VALIDATION_FAILURE",
      "MEDIA_UNAVAILABLE"
    ];
    expect(REVIEW_ERROR_CODES).toEqual(expectedCodes);

    const validError = {
      code: "STALE_REVISION_CONFLICT" as const,
      message: "Expected revision 1, but scene is at revision 2",
      details: { expected: 1, current: 2 }
    };
    expect(ReviewErrorResponseSchema.parse(validError)).toEqual(validError);

    const validErrorWithoutDetails = {
      code: "MEDIA_UNAVAILABLE" as const,
      message: "Media not found for candidate"
    };
    expect(ReviewErrorResponseSchema.parse(validErrorWithoutDetails)).toEqual(
      validErrorWithoutDetails
    );

    const invalidErrorCode = {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something failed"
    };
    expect(ReviewErrorResponseSchema.safeParse(invalidErrorCode).success).toBe(false);

    const emptyMessage = {
      code: "NOT_FOUND" as const,
      message: ""
    };
    expect(ReviewErrorResponseSchema.safeParse(emptyMessage).success).toBe(false);
  });
});
