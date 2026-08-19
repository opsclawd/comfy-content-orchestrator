import { describe, expect, it } from "vitest";
import {
  ReviewCommandResponseSchema,
  hashReviewCommand,
  type ReviewCommand,
  type ReviewCommandResponse,
  type ReviewErrorResponse,
  type ReviewEvent
} from "@cco/contracts";
import {
  Scene,
  type CampaignId,
  type CandidateId,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import { createControlApiApp } from "../app.js";

class InMemorySceneUnitOfWork implements UnitOfWork {
  private readonly _seededScenes: Map<SceneId, Scene>;
  private readonly _seededCandidates: Map<CandidateId, StoryboardCandidate>;
  private readonly _seededReviewEvents: Map<string, ReviewEvent>;
  private readonly _savedScenes: Scene[] = [];
  private readonly _reviewEvents: ReviewEvent[] = [];

  constructor(
    seededScenes?: Iterable<Scene> | ReadonlyMap<SceneId, Scene> | Record<string, Scene>,
    seededCandidates?:
      | Iterable<StoryboardCandidate>
      | ReadonlyMap<CandidateId, StoryboardCandidate>
      | Record<string, StoryboardCandidate>,
    seededReviewEvents?:
      Iterable<ReviewEvent> | ReadonlyMap<string, ReviewEvent> | Record<string, ReviewEvent>
  ) {
    this._seededScenes = new Map<SceneId, Scene>();
    if (seededScenes !== undefined && seededScenes !== null) {
      if (seededScenes instanceof Map) {
        for (const [id, scene] of seededScenes.entries()) {
          this._seededScenes.set(id, scene);
        }
      } else if (Symbol.iterator in seededScenes) {
        for (const item of seededScenes) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededScenes.set(item[0] as SceneId, item[1] as Scene);
          } else {
            const scene = item as Scene;
            this._seededScenes.set(scene.id, scene);
          }
        }
      } else if (typeof seededScenes === "object") {
        for (const [id, scene] of Object.entries(seededScenes)) {
          this._seededScenes.set(id as SceneId, scene as Scene);
        }
      }
    }

    this._seededCandidates = new Map<CandidateId, StoryboardCandidate>();
    if (seededCandidates !== undefined && seededCandidates !== null) {
      if (seededCandidates instanceof Map) {
        for (const [id, candidate] of seededCandidates.entries()) {
          this._seededCandidates.set(id, candidate);
        }
      } else if (Symbol.iterator in seededCandidates) {
        for (const item of seededCandidates) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededCandidates.set(item[0] as CandidateId, item[1] as StoryboardCandidate);
          } else {
            const candidate = item as StoryboardCandidate;
            this._seededCandidates.set(candidate.id, candidate);
          }
        }
      } else if (typeof seededCandidates === "object") {
        for (const [id, candidate] of Object.entries(seededCandidates)) {
          this._seededCandidates.set(id as CandidateId, candidate as StoryboardCandidate);
        }
      }
    }

    this._seededReviewEvents = new Map<string, ReviewEvent>();
    if (seededReviewEvents !== undefined && seededReviewEvents !== null) {
      if (seededReviewEvents instanceof Map) {
        for (const [id, event] of seededReviewEvents.entries()) {
          this._seededReviewEvents.set(id, event);
        }
      } else if (Symbol.iterator in seededReviewEvents) {
        for (const item of seededReviewEvents) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededReviewEvents.set(item[0], item[1] as ReviewEvent);
          } else {
            const event = item as ReviewEvent;
            this._seededReviewEvents.set(event.eventId, event);
          }
        }
      } else if (typeof seededReviewEvents === "object") {
        for (const [id, event] of Object.entries(seededReviewEvents)) {
          this._seededReviewEvents.set(id, event as ReviewEvent);
        }
      }
    }
  }

  get savedScenes(): readonly Scene[] {
    return this._savedScenes;
  }

  get reviewEvents(): readonly ReviewEvent[] {
    return this._reviewEvents;
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const stagedScenes: Scene[] = [];
    const stagedReviewEvents: ReviewEvent[] = [];
    const stagedCandidates: StoryboardCandidate[] = [];

    const scopedScenes: SceneRepository = {
      findById: async (sceneId: SceneId): Promise<Scene | undefined> => {
        return this._seededScenes.get(sceneId);
      },
      save: async (scene: Scene): Promise<void> => {
        stagedScenes.push(scene);
      }
    };

    const scopedCandidates: StoryboardCandidateRepository = {
      findById: async (candidateId: CandidateId): Promise<StoryboardCandidate | undefined> => {
        return (
          stagedCandidates.find((c) => c.id === candidateId) ??
          this._seededCandidates.get(candidateId)
        );
      },
      insert: async (candidate: StoryboardCandidate): Promise<void> => {
        stagedCandidates.push(candidate);
      },
      listBySceneAndRevision: async (
        sceneId: SceneId,
        specRevision: number
      ): Promise<readonly StoryboardCandidate[]> => {
        const candidatesMap = new Map<CandidateId, StoryboardCandidate>(this._seededCandidates);
        for (const candidate of stagedCandidates) {
          candidatesMap.set(candidate.id, candidate);
        }
        return Array.from(candidatesMap.values())
          .filter(
            (candidate) => candidate.sceneId === sceneId && candidate.specRevision === specRevision
          )
          .sort((a, b) => a.variantOrdinal - b.variantOrdinal);
      }
    };

    const scopedReviewEvents: ReviewEventStore = {
      append: async (event: ReviewEvent): Promise<void> => {
        stagedReviewEvents.push(event);
      },
      findById: async (eventId: string): Promise<ReviewEvent | undefined> => {
        return (
          stagedReviewEvents.find((e) => e.eventId === eventId) ??
          this._reviewEvents.find((e) => e.eventId === eventId) ??
          this._seededReviewEvents.get(eventId)
        );
      }
    };

    const context: UnitOfWorkContext = {
      scenes: scopedScenes,
      reviewEvents: scopedReviewEvents,
      candidates: scopedCandidates
    };

    const result = await work(context);

    this._savedScenes.push(...stagedScenes);
    this._reviewEvents.push(...stagedReviewEvents);
    for (const scene of stagedScenes) {
      this._seededScenes.set(scene.id, scene);
    }
    for (const candidate of stagedCandidates) {
      this._seededCandidates.set(candidate.id, candidate);
    }
    for (const event of stagedReviewEvents) {
      this._seededReviewEvents.set(event.eventId, event);
    }

    return result;
  }
}

describe("POST /api/scenes/:sceneId/review-command", () => {
  const campaignUuid = "8bf83226-f761-419b-a010-8b1b017b2b00" as CampaignId;
  const sceneUuid = "d0728c3a-b892-4919-bb0d-587274092b3b" as SceneId;
  const candidateUuid = "3e590059-cb14-41d6-b5fa-28498897ee22" as CandidateId;
  const actionUuid = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";

  const createReviewReadyScene = (
    overrides?: Partial<Parameters<typeof Scene.reconstitute>[0]>
  ): Scene => {
    return Scene.reconstitute({
      id: sceneUuid,
      campaignId: campaignUuid,
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "A cinematic shot of a mountain sunrise",
        referenceIds: ["ref-1"],
        engineProfileId: "ltx_25",
        durationMs: 5000,
        loraConfigurationId: "lora-initial"
      },
      ...overrides
    });
  };

  const createCandidate = (
    id: CandidateId = candidateUuid,
    specRevision = 1
  ): StoryboardCandidate => ({
    id,
    sceneId: sceneUuid,
    specRevision,
    variantOrdinal: 1,
    locator: "minio://bucket/c1.mp4",
    contentHash: "hash-c1",
    generationMetadata: { seed: 123 },
    createdAt: "2026-08-18T10:00:00.000Z"
  });

  it("malformed payload returns 400 VALIDATION_FAILURE", async () => {
    const scene = createReviewReadyScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "not-a-valid-uuid",
        action: "invalid_action",
        expectedSpecRevision: -5
      }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toBeDefined();
  });

  it("mismatched URL sceneId and body sceneId returns 400 VALIDATION_FAILURE", async () => {
    const scene = createReviewReadyScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });
    const otherSceneUuid = "00000000-0000-0000-0000-000000000001";

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: actionUuid,
        sceneId: otherSceneUuid,
        expectedSpecRevision: 1,
        action: "reroll",
        payload: {}
      }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toContain("sceneId");
  });

  it("audit authority uses server-derived reviewer identity and timestamp", async () => {
    const scene = createReviewReadyScene();
    const candidate = createCandidate();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);

    const trustedReviewer = "Authorized Lead Director";
    const trustedTimestamp = "2026-08-18T15:30:00.000Z";

    const app = createControlApiApp(
      { uow },
      {
        reviewerIdentityResolver: {
          resolve: () => trustedReviewer
        },
        clock: {
          now: () => trustedTimestamp
        }
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: actionUuid,
        sceneId: sceneUuid,
        expectedSpecRevision: 1,
        action: "candidate_select",
        payload: {
          candidateId: candidateUuid
        },
        directorNotes: "LGTM"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(uow.reviewEvents).toHaveLength(1);
    const recordedEvent = uow.reviewEvents[0]!;
    expect(recordedEvent.reviewerName).toBe(trustedReviewer);
    expect(recordedEvent.occurredAt).toBe(trustedTimestamp);
    expect(recordedEvent.directorNotes).toBe("LGTM");
  });

  it("computes canonical SHA-256 hash for review commands", async () => {
    const scene = createReviewReadyScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    const payload = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "prompt_edit",
      payload: {
        prompt: "A moody twilight forest"
      },
      directorNotes: "Adjusting lighting"
    } as const;

    const expectedHash = await hashReviewCommand({
      sceneId: payload.sceneId,
      expectedSpecRevision: payload.expectedSpecRevision,
      action: payload.action,
      payload: payload.payload,
      directorNotes: payload.directorNotes
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(uow.reviewEvents).toHaveLength(1);
    expect(uow.reviewEvents[0]?.requestHashSha256).toBe(expectedHash);
  });

  it("candidate_select selects candidate and returns 200", async () => {
    const scene = createReviewReadyScene();
    const candidate = createCandidate();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: {
        candidateId: candidateUuid
      }
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = ReviewCommandResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const data = body as ReviewCommandResponse;
    expect(data.sceneId).toBe(sceneUuid);
    expect(data.status).toBe("director_review");
    expect(data.specRevision).toBe(1);
    expect(data.selectedCandidateId).toBe(candidateUuid);
    expect(data.isIdempotentReplay).toBe(false);
  });

  it("approve sets scene to approved and returns 200", async () => {
    const scene = createReviewReadyScene({
      selectedCandidateId: candidateUuid,
      selectedCandidateRevision: 1
    });
    const candidate = createCandidate();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "approve",
      payload: {}
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewCommandResponse;
    expect(body.sceneId).toBe(sceneUuid);
    expect(body.status).toBe("approved");
    expect(body.specRevision).toBe(1);
    expect(body.selectedCandidateId).toBe(candidateUuid);
    expect(body.approval).toBeDefined();
    expect(body.approval?.revision).toBe(1);
    expect(body.approval?.approvedBy).toBe("Thomas Cumberbatch");
    expect(body.isIdempotentReplay).toBe(false);
  });

  it("reroll verifies scene status generating_candidates and candidate selection cleared", async () => {
    const scene = createReviewReadyScene({
      selectedCandidateId: candidateUuid,
      selectedCandidateRevision: 1
    });
    const candidate = createCandidate();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "reroll",
      payload: {}
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewCommandResponse;
    expect(body.sceneId).toBe(sceneUuid);
    expect(body.status).toBe("generating_candidates");
    expect(body.specRevision).toBe(1);
    expect(body.selectedCandidateId).toBeUndefined();
    expect(body.isIdempotentReplay).toBe(false);
  });

  it("prompt_edit, reference_change, engine_change, duration_change, lora_tune update configuration and revision", async () => {
    const scene = createReviewReadyScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    // 1. prompt_edit: rev 1 -> 2
    const promptRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "11111111-1111-4111-8111-111111111111",
        sceneId: sceneUuid,
        expectedSpecRevision: 1,
        action: "prompt_edit",
        payload: { prompt: "Updated prompt text" }
      }
    });
    expect(promptRes.statusCode).toBe(200);
    expect((promptRes.json() as ReviewCommandResponse).specRevision).toBe(2);

    // 2. reference_change: rev 2 -> 3
    const refRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "22222222-2222-4222-8222-222222222222",
        sceneId: sceneUuid,
        expectedSpecRevision: 2,
        action: "reference_change",
        payload: { referenceIds: ["ref-new-1", "ref-new-2"] }
      }
    });
    expect(refRes.statusCode).toBe(200);
    expect((refRes.json() as ReviewCommandResponse).specRevision).toBe(3);

    // 3. engine_change: rev 3 -> 4
    const engRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "33333333-3333-4333-8333-333333333333",
        sceneId: sceneUuid,
        expectedSpecRevision: 3,
        action: "engine_change",
        payload: { engineProfileId: "wan_21_t2v" }
      }
    });
    expect(engRes.statusCode).toBe(200);
    expect((engRes.json() as ReviewCommandResponse).specRevision).toBe(4);

    // 4. duration_change: rev 4 -> 5
    const durRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "44444444-4444-4444-8444-444444444444",
        sceneId: sceneUuid,
        expectedSpecRevision: 4,
        action: "duration_change",
        payload: { durationMs: 7500 }
      }
    });
    expect(durRes.statusCode).toBe(200);
    expect((durRes.json() as ReviewCommandResponse).specRevision).toBe(5);

    // 5. lora_tune: rev 5 -> 6
    const loraRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "55555555-5555-4555-8555-555555555555",
        sceneId: sceneUuid,
        expectedSpecRevision: 5,
        action: "lora_tune",
        payload: { loraConfigurationId: "lora-v2-hyper" }
      }
    });
    expect(loraRes.statusCode).toBe(200);
    expect((loraRes.json() as ReviewCommandResponse).specRevision).toBe(6);
  });

  it("cancel transitions scene to cancelled", async () => {
    const scene = createReviewReadyScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "cancel",
      payload: {}
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewCommandResponse;
    expect(body.sceneId).toBe(sceneUuid);
    expect(body.status).toBe("cancelled");
    expect(body.specRevision).toBe(1);
    expect(body.isIdempotentReplay).toBe(false);
  });

  it("reject transitions QA scene back to director_review", async () => {
    const scene = Scene.reconstitute({
      id: sceneUuid,
      campaignId: campaignUuid,
      status: "qa",
      specRevision: 1,
      configuration: {
        prompt: "A cinematic shot of a mountain sunrise",
        referenceIds: ["ref-1"],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      selectedCandidateId: candidateUuid,
      selectedCandidateRevision: 1,
      approval: {
        revision: 1,
        approvedBy: "Thomas Cumberbatch",
        approvedAt: "2026-08-18T11:00:00.000Z"
      }
    });
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "reject",
      payload: {},
      directorNotes: "Render artifacts visible on frame 45"
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewCommandResponse;
    expect(body.sceneId).toBe(sceneUuid);
    expect(body.status).toBe("director_review");
    expect(body.approval).toBeUndefined();
    expect(body.isIdempotentReplay).toBe(false);
  });

  it("stale expectedSpecRevision returns 409 STALE_REVISION_CONFLICT", async () => {
    const scene = createReviewReadyScene({ specRevision: 2 });
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1, // Stale! Current is 2
      action: "prompt_edit",
      payload: { prompt: "Stale edit" }
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("STALE_REVISION_CONFLICT");
    expect(body.message).toContain("expected spec revision 1, but current revision is 2");
  });

  it("exact action replay returns 200 with isIdempotentReplay: true", async () => {
    const scene = createReviewReadyScene();
    const candidate = createCandidate();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: { candidateId: candidateUuid }
    };

    // First execution: 200, isIdempotentReplay: false
    const firstRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });
    expect(firstRes.statusCode).toBe(200);
    expect((firstRes.json() as ReviewCommandResponse).isIdempotentReplay).toBe(false);

    // Replay execution with identical actionId and payload: 200, isIdempotentReplay: true
    const replayRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });
    expect(replayRes.statusCode).toBe(200);
    expect((replayRes.json() as ReviewCommandResponse).isIdempotentReplay).toBe(true);
  });

  it("action ID reuse with altered payload returns 409 IDEMPOTENCY_CONFLICT", async () => {
    const scene = createReviewReadyScene();
    const candidate1 = createCandidate(candidateUuid, 1);
    const otherCandidateUuid = "7709eeae-377c-4743-bcf2-b2586a11e130" as CandidateId;
    const candidate2 = createCandidate(otherCandidateUuid, 1);
    const uow = new InMemorySceneUnitOfWork([scene], [candidate1, candidate2]);
    const app = createControlApiApp({ uow });

    const command1: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: { candidateId: candidateUuid }
    };

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command1
    });
    expect(firstRes.statusCode).toBe(200);

    // Reuse actionUuid with a different payload (selecting a different candidate)
    const command2: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: { candidateId: otherCandidateUuid }
    };

    const secondRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command2
    });

    expect(secondRes.statusCode).toBe(409);
    const body = secondRes.json() as ReviewErrorResponse;
    expect(body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(body.message).toContain("Idempotency conflict for action ID");
  });

  it("invalid transition returns 422 INVALID_DOMAIN_TRANSITION", async () => {
    // Scene in draft_pending cannot be directly approved
    const scene = Scene.reconstitute({
      id: sceneUuid,
      campaignId: campaignUuid,
      status: "draft_pending",
      specRevision: 1,
      configuration: {
        prompt: "A cinematic shot of a mountain sunrise",
        referenceIds: ["ref-1"],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });
    const uow = new InMemorySceneUnitOfWork([scene]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "approve",
      payload: {}
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(422);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("INVALID_DOMAIN_TRANSITION");
    expect(body.message).toBeDefined();
  });

  it("target scene not found returns 404 NOT_FOUND", async () => {
    const uow = new InMemorySceneUnitOfWork([]);
    const app = createControlApiApp({ uow });

    const command: ReviewCommand = {
      actionId: actionUuid,
      sceneId: sceneUuid,
      expectedSpecRevision: 1,
      action: "reroll",
      payload: {}
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: command
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain("Scene");
  });
});
