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
  StoryboardCandidateSchema,
  ReviewCommandResponseSchema,
  ReviewCommandSchema,
  CandidateSelectCommandSchema,
  ApproveCommandSchema,
  RerollCommandSchema,
  PromptEditCommandSchema,
  ReferenceChangeCommandSchema,
  EngineChangeCommandSchema,
  DurationChangeCommandSchema,
  LoraTuneCommandSchema,
  CancelCommandSchema,
  RejectCommandSchema,
  CandidateSelectPayloadSchema,
  PromptEditPayloadSchema,
  ReferenceChangePayloadSchema,
  EngineChangePayloadSchema,
  DurationChangePayloadSchema,
  LoraTunePayloadSchema,
  EmptyActionPayloadSchema,
  canonicalizeReviewCommand,
  hashReviewCommand
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

describe("Review Command Envelopes, Discriminated Action Payloads, and Canonical Request Hashing", () => {
  const baseEnvelope = {
    actionId: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    expectedSpecRevision: 1,
    directorNotes: "Note for review"
  };

  it("validates discriminated review commands and rejects reserved reorder and duplicate actions", () => {
    const candidateSelect = {
      ...baseEnvelope,
      action: "candidate_select" as const,
      payload: { candidateId: "33333333-3333-4333-8333-333333333333" }
    };
    expect(ReviewCommandSchema.parse(candidateSelect)).toEqual(candidateSelect);
    expect(CandidateSelectCommandSchema.parse(candidateSelect)).toEqual(candidateSelect);

    const approve = {
      ...baseEnvelope,
      action: "approve" as const,
      payload: {}
    };
    expect(ReviewCommandSchema.parse(approve)).toEqual(approve);
    expect(ApproveCommandSchema.parse(approve)).toEqual(approve);

    const reroll = { ...baseEnvelope, action: "reroll" as const, payload: {} };
    expect(ReviewCommandSchema.parse(reroll)).toEqual(reroll);
    expect(RerollCommandSchema.parse(reroll)).toEqual(reroll);

    const promptEdit = {
      ...baseEnvelope,
      action: "prompt_edit" as const,
      payload: { prompt: "Updated dramatic prompt" }
    };
    expect(ReviewCommandSchema.parse(promptEdit)).toEqual(promptEdit);
    expect(PromptEditCommandSchema.parse(promptEdit)).toEqual(promptEdit);

    const refChange = {
      ...baseEnvelope,
      action: "reference_change" as const,
      payload: { referenceIds: ["ref-1", "ref-2"] }
    };
    expect(ReviewCommandSchema.parse(refChange)).toEqual(refChange);
    expect(ReferenceChangeCommandSchema.parse(refChange)).toEqual(refChange);

    const engineChange = {
      ...baseEnvelope,
      action: "engine_change" as const,
      payload: { engineProfileId: "ltx_25_720p" }
    };
    expect(ReviewCommandSchema.parse(engineChange)).toEqual(engineChange);
    expect(EngineChangeCommandSchema.parse(engineChange)).toEqual(engineChange);

    const durationChange = {
      ...baseEnvelope,
      action: "duration_change" as const,
      payload: { durationMs: 6000 }
    };
    expect(ReviewCommandSchema.parse(durationChange)).toEqual(durationChange);
    expect(DurationChangeCommandSchema.parse(durationChange)).toEqual(durationChange);

    const loraTune = {
      ...baseEnvelope,
      action: "lora_tune" as const,
      payload: { loraConfigurationId: "carnival-v2" }
    };
    expect(ReviewCommandSchema.parse(loraTune)).toEqual(loraTune);
    expect(LoraTuneCommandSchema.parse(loraTune)).toEqual(loraTune);

    const cancel = { ...baseEnvelope, action: "cancel" as const, payload: {} };
    expect(ReviewCommandSchema.parse(cancel)).toEqual(cancel);
    expect(CancelCommandSchema.parse(cancel)).toEqual(cancel);

    const reject = { ...baseEnvelope, action: "reject" as const, payload: {} };
    expect(ReviewCommandSchema.parse(reject)).toEqual(reject);
    expect(RejectCommandSchema.parse(reject)).toEqual(reject);

    // Reject reserved actions
    const reorder = {
      ...baseEnvelope,
      action: "reorder",
      payload: { newPosition: 3 }
    };
    expect(ReviewCommandSchema.safeParse(reorder).success).toBe(false);

    const duplicate = {
      ...baseEnvelope,
      action: "duplicate",
      payload: {}
    };
    expect(ReviewCommandSchema.safeParse(duplicate).success).toBe(false);
  });

  it("requires candidateId as UUID for candidate_select and rejects URL strings", () => {
    const validCandidateSelect = {
      ...baseEnvelope,
      action: "candidate_select" as const,
      payload: { candidateId: "33333333-3333-4333-8333-333333333333" }
    };
    expect(CandidateSelectPayloadSchema.parse(validCandidateSelect.payload)).toEqual(
      validCandidateSelect.payload
    );
    expect(ReviewCommandSchema.parse(validCandidateSelect)).toEqual(validCandidateSelect);

    const invalidWithUrl = {
      ...baseEnvelope,
      action: "candidate_select" as const,
      payload: { candidateId: "https://storage-01.ts.net/cand.webp" }
    };
    expect(CandidateSelectPayloadSchema.safeParse(invalidWithUrl.payload).success).toBe(false);
    expect(ReviewCommandSchema.safeParse(invalidWithUrl).success).toBe(false);

    const invalidArbitraryString = {
      ...baseEnvelope,
      action: "candidate_select" as const,
      payload: { candidateId: "not-a-uuid-string" }
    };
    expect(CandidateSelectPayloadSchema.safeParse(invalidArbitraryString.payload).success).toBe(
      false
    );
    expect(ReviewCommandSchema.safeParse(invalidArbitraryString).success).toBe(false);
  });

  it("hashes commands deterministically ignoring actionId and key order while detecting material changes", () => {
    const cmdA1 = {
      actionId: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222222",
      expectedSpecRevision: 1,
      action: "prompt_edit" as const,
      payload: { prompt: "hello world" },
      directorNotes: "test notes"
    };

    const cmdA2DifferentActionId = {
      actionId: "99999999-9999-4999-8999-999999999999",
      sceneId: "22222222-2222-4222-8222-222222222222",
      expectedSpecRevision: 1,
      action: "prompt_edit" as const,
      payload: { prompt: "hello world" },
      directorNotes: "test notes"
    };

    const hashA1 = hashReviewCommand(cmdA1);
    const hashA2 = hashReviewCommand(cmdA2DifferentActionId);
    expect(hashA1).toHaveLength(64);
    expect(hashA1).toBe(hashA2);

    // Key order test in canonicalization
    const canonicalKeyOrder1 = canonicalizeReviewCommand({
      sceneId: "22222222-2222-4222-8222-222222222222",
      expectedSpecRevision: 1,
      action: "reference_change",
      payload: { referenceIds: ["ref-1", "ref-2"] },
      directorNotes: "test"
    });
    const canonicalKeyOrder2 = canonicalizeReviewCommand({
      directorNotes: "test",
      payload: { referenceIds: ["ref-1", "ref-2"] },
      action: "reference_change",
      expectedSpecRevision: 1,
      sceneId: "22222222-2222-4222-8222-222222222222"
    });
    expect(canonicalKeyOrder1).toBe(canonicalKeyOrder2);

    // Changing payload changes hash
    const cmdPayloadChange = {
      ...cmdA1,
      payload: { prompt: "different prompt" }
    };
    expect(hashReviewCommand(cmdPayloadChange)).not.toBe(hashA1);

    // Changing revision changes hash
    const cmdRevisionChange = {
      ...cmdA1,
      expectedSpecRevision: 2
    };
    expect(hashReviewCommand(cmdRevisionChange)).not.toBe(hashA1);

    // Changing action changes hash
    const cmdActionChange = {
      ...cmdA1,
      action: "approve" as const,
      payload: {}
    };
    expect(hashReviewCommand(cmdActionChange)).not.toBe(hashA1);

    // Changing director notes changes hash
    const cmdNotesChange = {
      ...cmdA1,
      directorNotes: "different notes"
    };
    expect(hashReviewCommand(cmdNotesChange)).not.toBe(hashA1);

    // Omitting director notes changes hash
    const cmdNoNotes = {
      actionId: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222222",
      expectedSpecRevision: 1,
      action: "prompt_edit" as const,
      payload: { prompt: "hello world" }
    };
    expect(hashReviewCommand(cmdNoNotes)).not.toBe(hashA1);
  });

  it("accepts valid discriminated commands for all Phase 1 actions", () => {
    const candidateSelect = {
      ...baseEnvelope,
      action: "candidate_select" as const,
      payload: { candidateId: "33333333-3333-4333-8333-333333333333" }
    };
    expect(ReviewCommandSchema.parse(candidateSelect)).toEqual(candidateSelect);

    const approve = {
      ...baseEnvelope,
      action: "approve" as const,
      payload: {}
    };
    expect(ReviewCommandSchema.parse(approve)).toEqual(approve);

    const promptEdit = {
      ...baseEnvelope,
      action: "prompt_edit" as const,
      payload: { prompt: "Updated dramatic prompt" }
    };
    expect(ReviewCommandSchema.parse(promptEdit)).toEqual(promptEdit);

    const refChange = {
      ...baseEnvelope,
      action: "reference_change" as const,
      payload: { referenceIds: ["ref-1", "ref-2"] }
    };
    expect(ReviewCommandSchema.parse(refChange)).toEqual(refChange);

    const engineChange = {
      ...baseEnvelope,
      action: "engine_change" as const,
      payload: { engineProfileId: "ltx_25_720p" }
    };
    expect(ReviewCommandSchema.parse(engineChange)).toEqual(engineChange);

    const durationChange = {
      ...baseEnvelope,
      action: "duration_change" as const,
      payload: { durationMs: 6000 }
    };
    expect(ReviewCommandSchema.parse(durationChange)).toEqual(durationChange);

    const loraTune = {
      ...baseEnvelope,
      action: "lora_tune" as const,
      payload: { loraConfigurationId: "carnival-v2" }
    };
    expect(ReviewCommandSchema.parse(loraTune)).toEqual(loraTune);

    const reroll = { ...baseEnvelope, action: "reroll" as const, payload: {} };
    expect(ReviewCommandSchema.parse(reroll)).toEqual(reroll);

    const cancel = { ...baseEnvelope, action: "cancel" as const, payload: {} };
    expect(ReviewCommandSchema.parse(cancel)).toEqual(cancel);

    const reject = { ...baseEnvelope, action: "reject" as const, payload: {} };
    expect(ReviewCommandSchema.parse(reject)).toEqual(reject);
  });

  it("validates individual payload schemas", () => {
    expect(PromptEditPayloadSchema.parse({ prompt: "New prompt" })).toEqual({
      prompt: "New prompt"
    });
    expect(PromptEditPayloadSchema.safeParse({ prompt: "" }).success).toBe(false);

    expect(ReferenceChangePayloadSchema.parse({ referenceIds: ["id-1", "id-2"] })).toEqual({
      referenceIds: ["id-1", "id-2"]
    });

    expect(EngineChangePayloadSchema.parse({ engineProfileId: "ltx_25" })).toEqual({
      engineProfileId: "ltx_25"
    });
    expect(EngineChangePayloadSchema.safeParse({ engineProfileId: "" }).success).toBe(false);

    expect(DurationChangePayloadSchema.parse({ durationMs: 4000 })).toEqual({
      durationMs: 4000
    });
    expect(DurationChangePayloadSchema.safeParse({ durationMs: 0 }).success).toBe(false);
    expect(DurationChangePayloadSchema.safeParse({ durationMs: -500 }).success).toBe(false);

    expect(LoraTunePayloadSchema.parse({ loraConfigurationId: "lora-1" })).toEqual({
      loraConfigurationId: "lora-1"
    });
    expect(LoraTunePayloadSchema.parse({ loraConfigurationId: null })).toEqual({
      loraConfigurationId: null
    });
    expect(LoraTunePayloadSchema.parse({})).toEqual({});

    expect(EmptyActionPayloadSchema.parse({})).toEqual({});
  });

  it("validates ReviewCommandResponseSchema", () => {
    const response = {
      sceneId: "22222222-2222-4222-8222-222222222222",
      status: "approved" as const,
      specRevision: 1,
      selectedCandidateId: "33333333-3333-4333-8333-333333333333",
      approval: {
        revision: 1,
        approvedBy: "Director Thomas",
        approvedAt: "2026-08-15T12:00:00.000Z"
      },
      isIdempotentReplay: false
    };
    expect(ReviewCommandResponseSchema.parse(response)).toEqual(response);

    const minimalResponse = {
      sceneId: "22222222-2222-4222-8222-222222222222",
      status: "director_review" as const,
      specRevision: 2,
      isIdempotentReplay: true
    };
    expect(ReviewCommandResponseSchema.parse(minimalResponse)).toEqual(minimalResponse);

    // Invalid sceneId
    expect(
      ReviewCommandResponseSchema.safeParse({
        ...response,
        sceneId: "invalid-uuid"
      }).success
    ).toBe(false);

    // Invalid specRevision
    expect(
      ReviewCommandResponseSchema.safeParse({
        ...response,
        specRevision: 0
      }).success
    ).toBe(false);
  });
});
