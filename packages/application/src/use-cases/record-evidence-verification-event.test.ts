import { describe, expect, it, vi } from "vitest";
import {
  createClientId,
  createEvidenceId,
  type EvidenceId,
  NotFoundError,
  ProductValidationError,
  type EvidenceVerificationEvent,
  type VerificationEventId
} from "@cco/domain";
import type { EvidenceAssetRepositoryPort, UnitOfWork, UnitOfWorkContext } from "../ports/index.js";
import {
  RecordEvidenceVerificationEventUseCase,
  type RecordEvidenceVerificationEventInput
} from "./record-evidence-verification-event.js";

describe("RecordEvidenceVerificationEventUseCase", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const evidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000010");
  const eventId = "018f0000-0000-7000-8000-000000000030" as VerificationEventId;

  function createTestDependencies(overrides?: {
    evidenceAssetRepo?: Partial<EvidenceAssetRepositoryPort>;
  }) {
    const evidenceAssetRepo = {
      registerEvidence: vi.fn(),
      linkDerivative: vi.fn(),
      appendVerificationEvent: vi.fn(async (cmd) => {
        const event: EvidenceVerificationEvent = {
          clientId: cmd.clientId,
          eventId,
          evidenceId: cmd.payload.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision,
          outcome: cmd.payload.outcome,
          verificationKind: cmd.payload.verificationKind,
          factScope: cmd.payload.factScope,
          actorId: cmd.actorId,
          occurredAt: "2026-10-20T00:00:00.000Z",
          method: cmd.payload.method,
          reason: cmd.payload.reason,
          verifiedPartyReference: cmd.payload.verifiedPartyReference ?? null,
          withdrawalEventId: cmd.payload.withdrawalEventId ?? null
        };
        return event;
      }),
      quarantineSourceObject: vi.fn(),
      createIngestReservation: vi.fn(),
      completeIngestReservation: vi.fn(),
      getClientStorageUsage: vi.fn(),
      ...overrides?.evidenceAssetRepo
    } as unknown as EvidenceAssetRepositoryPort;

    const unitOfWork: UnitOfWork = {
      execute: vi.fn(async (work) => {
        const ctx = {
          evidenceAsset: evidenceAssetRepo
        } as unknown as UnitOfWorkContext;
        return await work(ctx);
      })
    };

    return { unitOfWork, evidenceAssetRepo };
  }

  const baseInput: RecordEvidenceVerificationEventInput = {
    clientId,
    evidenceId,
    evidenceRevision: 1,
    outcome: "verified",
    verificationKind: "human_internal_review",
    factScope: "capture_circumstances",
    method: "visual_inspection_against_harvest_standard",
    reason: "Flower physical anatomy and trichome density match certified batch profile.",
    actorId: "qa-lead-1"
  };

  it("successfully records a verification event", async () => {
    const deps = createTestDependencies();
    const useCase = new RecordEvidenceVerificationEventUseCase(deps);

    const result = await useCase.execute(baseInput);

    expect(result.eventId).toBe(eventId);
    expect(result.outcome).toBe("verified");
    expect(result.verificationKind).toBe("human_internal_review");
    expect(deps.evidenceAssetRepo.appendVerificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId,
        payload: expect.objectContaining({
          evidenceId,
          evidenceRevision: 1,
          outcome: "verified"
        })
      })
    );
  });

  it("requires withdrawalEventId when outcome is withdrawn", async () => {
    const deps = createTestDependencies();
    const useCase = new RecordEvidenceVerificationEventUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        outcome: "withdrawn"
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("records a withdrawn outcome when withdrawalEventId is provided", async () => {
    const deps = createTestDependencies();
    const useCase = new RecordEvidenceVerificationEventUseCase(deps);

    const priorEventId = "018f0000-0000-7000-8000-000000000025" as VerificationEventId;
    const result = await useCase.execute({
      ...baseInput,
      outcome: "withdrawn",
      withdrawalEventId: priorEventId,
      reason: "Prior verification was submitted in error without secondary QA sign-off."
    });

    expect(result.outcome).toBe("withdrawn");
    expect(result.withdrawalEventId).toBe(priorEventId);
  });

  it("rejects invalid UUID identifiers", async () => {
    const deps = createTestDependencies();
    const useCase = new RecordEvidenceVerificationEventUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        evidenceId: "not-a-valid-uuid" as unknown as EvidenceId
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects empty reason or method", async () => {
    const deps = createTestDependencies();
    const useCase = new RecordEvidenceVerificationEventUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        method: "   "
      })
    ).rejects.toThrow(ProductValidationError);

    await expect(
      useCase.execute({
        ...baseInput,
        reason: ""
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("propagates repository NotFoundError if target revision does not exist", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        appendVerificationEvent: vi.fn(async () => {
          throw new NotFoundError("EvidenceRevision", "rev-1");
        })
      }
    });
    const useCase = new RecordEvidenceVerificationEventUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);
  });
});
