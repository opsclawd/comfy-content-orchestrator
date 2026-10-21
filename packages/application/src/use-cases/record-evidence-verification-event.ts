import {
  generateUuidV7,
  isValidPositiveInt,
  isValidUuid,
  isValidUuidV7,
  type IsoTimestampString,
  type VerificationFactScope,
  type VerificationKind,
  type VerificationOutcome
} from "@cco/shared";
import {
  createActionId,
  ProductValidationError,
  type ClientId,
  type EvidenceId,
  type EvidenceVerificationEvent,
  type VerificationEventId
} from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";

export interface RecordEvidenceVerificationEventInput {
  readonly clientId: ClientId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly outcome: VerificationOutcome;
  readonly verificationKind: VerificationKind;
  readonly factScope: VerificationFactScope;
  readonly method: string;
  readonly reason: string;
  readonly verifiedPartyReference?: string | null | undefined;
  readonly withdrawalEventId?: VerificationEventId | null | undefined;
  readonly actorId: string;
  readonly actionId?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface RecordEvidenceVerificationEventDependencies {
  readonly unitOfWork: UnitOfWork;
}

export class RecordEvidenceVerificationEventUseCase {
  constructor(private readonly dependencies: RecordEvidenceVerificationEventDependencies) {}

  async execute(input: RecordEvidenceVerificationEventInput): Promise<EvidenceVerificationEvent> {
    if (!isValidUuid(input.clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(input.evidenceId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["evidenceId"],
          message: "evidenceId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(input.evidenceRevision)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["evidenceRevision"],
          message: "evidenceRevision must be a positive integer."
        }
      ]);
    }
    if (input.outcome === "withdrawn" && !input.withdrawalEventId) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["withdrawalEventId"],
          message: "withdrawalEventId is required when outcome is 'withdrawn'."
        }
      ]);
    }
    if (input.withdrawalEventId && !isValidUuid(input.withdrawalEventId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["withdrawalEventId"],
          message: "withdrawalEventId must be a valid UUID string."
        }
      ]);
    }
    if (!input.method || input.method.trim().length === 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["method"],
          message: "method cannot be empty."
        }
      ]);
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["reason"],
          message: "reason cannot be empty."
        }
      ]);
    }

    if (input.actionId !== undefined && !isValidUuidV7(input.actionId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["actionId"],
          message: "actionId must be a valid UUIDv7 string."
        }
      ]);
    }

    const actionId = input.actionId ?? generateUuidV7();
    const timestamp = input.timestamp ?? new Date().toISOString();

    return await this.dependencies.unitOfWork.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
      }

      return await ctx.evidenceAsset.appendVerificationEvent({
        clientId: input.clientId,
        actionId: createActionId(actionId),
        actorId: input.actorId,
        timestamp: timestamp as IsoTimestampString,
        payload: {
          evidenceId: input.evidenceId,
          evidenceRevision: input.evidenceRevision,
          outcome: input.outcome,
          verificationKind: input.verificationKind,
          factScope: input.factScope,
          method: input.method.trim(),
          reason: input.reason.trim(),
          verifiedPartyReference: input.verifiedPartyReference ?? null,
          withdrawalEventId: input.withdrawalEventId ?? null
        }
      });
    });
  }
}
