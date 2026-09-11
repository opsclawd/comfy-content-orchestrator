import { randomUUID } from "node:crypto";
import type { CreateCampaignShellRequest } from "@cco/contracts";
import type { CampaignId, CampaignShellRecord } from "@cco/domain";
import {
  isCampaignShellRepository,
  type CampaignShellRepository,
  type UnitOfWork,
  type UnitOfWorkContext
} from "../ports/index.js";
import { CampaignIdempotencyConflictError } from "./campaign-idempotency-conflict-error.js";
import { computeCampaignRequestHash } from "./campaign-request-hash.js";
import { resolveSceneCount } from "./scene-count-policy.js";

export interface CreateCampaignShellResult {
  readonly campaign: CampaignShellRecord;
  readonly isIdempotentReplay: boolean;
}

export class CreateCampaignShellUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  private getShellRepository(context: UnitOfWorkContext): CampaignShellRepository {
    if (!isCampaignShellRepository(context.campaigns)) {
      throw new Error(
        "UnitOfWorkContext.campaigns does not support campaign shell idempotency operations."
      );
    }
    return context.campaigns;
  }

  /**
   * Outer entry point for campaign shell creation with idempotency and race recovery.
   * If a concurrent duplicate submission races and hits a unique constraint violation,
   * the aborted transaction is cleanly rolled back before attempting a fresh read to recover
   * the committed winner's row.
   */
  async execute(input: CreateCampaignShellRequest): Promise<CreateCampaignShellResult> {
    try {
      return await this.uow.execute((context) => this.executeWithContext(context, input));
    } catch (err) {
      if (err instanceof CampaignIdempotencyConflictError) {
        return await this.recoverFromConcurrentConflict(input, err);
      }
      throw err;
    }
  }

  /**
   * Recovers from a concurrent conflict by opening a FRESH UnitOfWork transaction/connection.
   * This is necessary because in PostgreSQL, once a statement encounters a unique violation (23505),
   * the current transaction block is aborted (25P02) and no further commands can be executed on it.
   */
  private async recoverFromConcurrentConflict(
    input: CreateCampaignShellRequest,
    original: CampaignIdempotencyConflictError
  ): Promise<CreateCampaignShellResult> {
    const requestHash = await computeCampaignRequestHash(input);
    return this.uow.execute(async (context) => {
      if (!isCampaignShellRepository(context.campaigns)) {
        throw original;
      }
      const winner = await context.campaigns.findByIdempotencyKey(input.idempotencyKey);
      if (winner !== undefined && winner.requestHashSha256 === requestHash) {
        return {
          campaign: winner,
          isIdempotentReplay: true
        };
      }
      throw original;
    });
  }

  /**
   * Executes the creation logic within an existing UnitOfWorkContext.
   * Callers that own their own transaction boundary (e.g. future composed flows in #217-B/#217-C)
   * invoke this directly. Any conflict error propagates up so the caller's transaction
   * can abort and rollback cleanly.
   */
  async executeWithContext(
    context: UnitOfWorkContext,
    input: CreateCampaignShellRequest
  ): Promise<CreateCampaignShellResult> {
    const repo = this.getShellRepository(context);

    const requestHash = await computeCampaignRequestHash(input);
    const existing = await repo.findByIdempotencyKey(input.idempotencyKey);

    if (existing !== undefined) {
      if (existing.requestHashSha256 === requestHash) {
        return {
          campaign: existing,
          isIdempotentReplay: true
        };
      }
      throw new CampaignIdempotencyConflictError(input.idempotencyKey);
    }

    const totalScenes = resolveSceneCount({
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride
    });

    const now = new Date().toISOString();
    const record: CampaignShellRecord = {
      id: randomUUID() as CampaignId,
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform ?? "instagram_reels",
      status: "drafting",
      totalScenes,
      approvedScenes: 0,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: input.idempotencyKey,
      targetTotalDurationMs: input.targetTotalDurationMs
    };

    await repo.saveWithRequestHash(record, requestHash);
    return {
      campaign: record,
      isIdempotentReplay: false
    };
  }
}
