import {
  canonicalizeUtcTimestamp,
  compareDateOnly,
  isValidDateOnly,
  isValidPositiveInt,
  isValidUuid,
  normalizeAssertedBy,
  normalizeCanonicalSku,
  normalizeDisplayName,
  normalizeLotIdentifier,
  normalizeProducerIdentity,
  type BatchOriginKind
} from "@cco/shared";
import {
  ProductValidationError,
  type BatchFactsRevision,
  type BatchId,
  type ClientId,
  type ProductBatch,
  type ProductBatchCreationResult,
  type ProductSku,
  type SkuId
} from "@cco/domain";
import type {
  AppendBatchFactsCommand,
  ArchiveBatchCommand,
  ArchiveSkuCommand,
  CommandEnvelope,
  CreateBatchCommand,
  CreateSkuCommand,
  ProductBatchArchiveResult,
  ProductBatchUpdateResult,
  ProductEvidenceRepositoryPort,
  ProductSkuArchiveResult,
  ProductSkuUpdateResult,
  UnitOfWork,
  UpdateBatchMetadataCommand,
  UpdateSkuMetadataCommand
} from "../ports/index.js";

// ============================================================================
// Envelope and Input Validation Helpers
// ============================================================================

const UUID_V7_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const ALLOWED_ENVELOPE_KEYS = new Set(["actionId", "clientId", "actorId", "timestamp", "payload"]);

const ALLOWED_ORIGIN_KINDS = new Set<BatchOriginKind>([
  "own_production",
  "partner_origin",
  "unknown"
]);

function assertNoUnknownKeys(obj: unknown, allowed: Set<string>, pathPrefix: string[] = []): void {
  if (typeof obj !== "object" || obj === null) {
    return;
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: [...pathPrefix, key],
          message: `Unknown or unexpected field: "${key}".`
        }
      ]);
    }
  }
}

function validateCommandEnvelope<T>(cmd: CommandEnvelope<T>): void {
  if (typeof cmd !== "object" || cmd === null) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: [],
        message: "Command envelope must be an object."
      }
    ]);
  }
  assertNoUnknownKeys(cmd, ALLOWED_ENVELOPE_KEYS);

  if (!cmd.actionId || !UUID_V7_REGEX.test(cmd.actionId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["actionId"],
        message: "actionId must be a valid UUIDv7 string."
      }
    ]);
  }
  if (!cmd.clientId || !isValidUuid(cmd.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "clientId must be a valid UUID string."
      }
    ]);
  }
  try {
    normalizeAssertedBy(cmd.actorId, "actorId");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["actorId"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }
  try {
    canonicalizeUtcTimestamp(cmd.timestamp);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["timestamp"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }
}

// ============================================================================
// Mutation Use Cases
// ============================================================================

const ALLOWED_CREATE_SKU_PAYLOAD_KEYS = new Set(["canonicalSku", "displayName"]);

export class CreateProductSkuUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<CreateSkuCommand>): Promise<ProductSku> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_CREATE_SKU_PAYLOAD_KEYS, ["payload"]);
    try {
      normalizeCanonicalSku(cmd.payload.canonicalSku);
      normalizeDisplayName(cmd.payload.displayName, "displayName");
    } catch (err) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["payload"],
          message: err instanceof Error ? err.message : String(err)
        }
      ]);
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.createSku(cmd);
    });
  }
}

const ALLOWED_CREATE_BATCH_PAYLOAD_KEYS = new Set([
  "skuId",
  "lotIdentifier",
  "displayName",
  "initialFacts"
]);

const ALLOWED_INITIAL_FACTS_KEYS = new Set([
  "originKind",
  "producerIdentityAsClaimed",
  "productionStartDate",
  "productionEndDate",
  "originEvidenceId",
  "originEvidenceRevision"
]);

export class CreateProductBatchUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<CreateBatchCommand>): Promise<ProductBatchCreationResult> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_CREATE_BATCH_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    try {
      normalizeLotIdentifier(cmd.payload.lotIdentifier);
      normalizeDisplayName(cmd.payload.displayName, "displayName");
    } catch (err) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["payload"],
          message: err instanceof Error ? err.message : String(err)
        }
      ]);
    }

    if (cmd.payload.initialFacts !== undefined && cmd.payload.initialFacts !== null) {
      assertNoUnknownKeys(cmd.payload.initialFacts, ALLOWED_INITIAL_FACTS_KEYS, [
        "payload",
        "initialFacts"
      ]);

      const facts = cmd.payload.initialFacts;
      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["initialFacts", "originEvidenceId"],
            message: "Origin evidence linkage is not yet supported in this phase."
          }
        ]);
      }
      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["initialFacts", "originEvidenceRevision"],
            message: "Origin evidence linkage is not yet supported in this phase."
          }
        ]);
      }

      if (!facts.originKind || !ALLOWED_ORIGIN_KINDS.has(facts.originKind)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["initialFacts", "originKind"],
            message: `originKind must be one of: ${Array.from(ALLOWED_ORIGIN_KINDS).join(", ")}.`
          }
        ]);
      }

      if (
        facts.producerIdentityAsClaimed !== undefined &&
        facts.producerIdentityAsClaimed !== null
      ) {
        try {
          normalizeProducerIdentity(facts.producerIdentityAsClaimed);
        } catch (err) {
          throw new ProductValidationError([
            {
              code: "INVALID_TEXT",
              path: ["initialFacts", "producerIdentityAsClaimed"],
              message: err instanceof Error ? err.message : String(err)
            }
          ]);
        }
      }

      if (facts.productionStartDate !== undefined && facts.productionStartDate !== null) {
        if (!isValidDateOnly(facts.productionStartDate)) {
          throw new ProductValidationError([
            {
              code: "INVALID_DATE",
              path: ["initialFacts", "productionStartDate"],
              message: "productionStartDate must be a valid YYYY-MM-DD date."
            }
          ]);
        }
      }

      if (facts.productionEndDate !== undefined && facts.productionEndDate !== null) {
        if (!isValidDateOnly(facts.productionEndDate)) {
          throw new ProductValidationError([
            {
              code: "INVALID_DATE",
              path: ["initialFacts", "productionEndDate"],
              message: "productionEndDate must be a valid YYYY-MM-DD date."
            }
          ]);
        }
      }

      if (
        facts.productionStartDate &&
        facts.productionEndDate &&
        compareDateOnly(facts.productionStartDate, facts.productionEndDate) > 0
      ) {
        throw new ProductValidationError([
          {
            code: "INVALID_DATE",
            path: ["initialFacts", "productionDates"],
            message: "productionStartDate cannot be later than productionEndDate."
          }
        ]);
      }
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.createBatch(cmd);
    });
  }
}

const ALLOWED_APPEND_FACTS_PAYLOAD_KEYS = new Set([
  "batchId",
  "expectedVersion",
  "originKind",
  "producerIdentityAsClaimed",
  "productionStartDate",
  "productionEndDate",
  "originEvidenceId",
  "originEvidenceRevision"
]);

export class AppendBatchFactsUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<AppendBatchFactsCommand>): Promise<BatchFactsRevision> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_APPEND_FACTS_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }

    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["originEvidenceId"],
          message: "Origin evidence linkage is not yet supported in this phase."
        }
      ]);
    }
    if (
      cmd.payload.originEvidenceRevision !== null &&
      cmd.payload.originEvidenceRevision !== undefined
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["originEvidenceRevision"],
          message: "Origin evidence linkage is not yet supported in this phase."
        }
      ]);
    }

    if (!cmd.payload.originKind || !ALLOWED_ORIGIN_KINDS.has(cmd.payload.originKind)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["originKind"],
          message: `originKind must be one of: ${Array.from(ALLOWED_ORIGIN_KINDS).join(", ")}.`
        }
      ]);
    }

    if (
      cmd.payload.producerIdentityAsClaimed !== undefined &&
      cmd.payload.producerIdentityAsClaimed !== null
    ) {
      try {
        normalizeProducerIdentity(cmd.payload.producerIdentityAsClaimed);
      } catch (err) {
        throw new ProductValidationError([
          {
            code: "INVALID_TEXT",
            path: ["producerIdentityAsClaimed"],
            message: err instanceof Error ? err.message : String(err)
          }
        ]);
      }
    }

    if (cmd.payload.productionStartDate !== undefined && cmd.payload.productionStartDate !== null) {
      if (!isValidDateOnly(cmd.payload.productionStartDate)) {
        throw new ProductValidationError([
          {
            code: "INVALID_DATE",
            path: ["productionStartDate"],
            message: "productionStartDate must be a valid YYYY-MM-DD date."
          }
        ]);
      }
    }

    if (cmd.payload.productionEndDate !== undefined && cmd.payload.productionEndDate !== null) {
      if (!isValidDateOnly(cmd.payload.productionEndDate)) {
        throw new ProductValidationError([
          {
            code: "INVALID_DATE",
            path: ["productionEndDate"],
            message: "productionEndDate must be a valid YYYY-MM-DD date."
          }
        ]);
      }
    }

    if (
      cmd.payload.productionStartDate &&
      cmd.payload.productionEndDate &&
      compareDateOnly(cmd.payload.productionStartDate, cmd.payload.productionEndDate) > 0
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["productionDates"],
          message: "productionStartDate cannot be later than productionEndDate."
        }
      ]);
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.appendBatchFacts(cmd);
    });
  }
}

const ALLOWED_UPDATE_SKU_PAYLOAD_KEYS = new Set(["skuId", "expectedVersion", "displayName"]);

export class UpdateProductSkuMetadataUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<UpdateSkuMetadataCommand>): Promise<ProductSkuUpdateResult> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_UPDATE_SKU_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }
    try {
      normalizeDisplayName(cmd.payload.displayName, "displayName");
    } catch (err) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["displayName"],
          message: err instanceof Error ? err.message : String(err)
        }
      ]);
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.updateSkuMetadata(cmd);
    });
  }
}

const ALLOWED_UPDATE_BATCH_PAYLOAD_KEYS = new Set(["batchId", "expectedVersion", "displayName"]);

export class UpdateProductBatchMetadataUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    cmd: CommandEnvelope<UpdateBatchMetadataCommand>
  ): Promise<ProductBatchUpdateResult> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_UPDATE_BATCH_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }
    try {
      normalizeDisplayName(cmd.payload.displayName, "displayName");
    } catch (err) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["displayName"],
          message: err instanceof Error ? err.message : String(err)
        }
      ]);
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.updateBatchMetadata(cmd);
    });
  }
}

const ALLOWED_ARCHIVE_SKU_PAYLOAD_KEYS = new Set(["skuId", "expectedVersion"]);

export class ArchiveProductSkuUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<ArchiveSkuCommand>): Promise<ProductSkuArchiveResult> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_ARCHIVE_SKU_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.archiveSku(cmd);
    });
  }
}

const ALLOWED_ARCHIVE_BATCH_PAYLOAD_KEYS = new Set(["batchId", "expectedVersion"]);

export class ArchiveProductBatchUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<ArchiveBatchCommand>): Promise<ProductBatchArchiveResult> {
    validateCommandEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_ARCHIVE_BATCH_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }

    return this.uow.execute(async (context) => {
      if (context.productEvidence === undefined) {
        throw new Error(
          "UnitOfWorkContext.productEvidence is not configured for this UnitOfWork implementation."
        );
      }
      return context.productEvidence.archiveBatch(cmd);
    });
  }
}

// ============================================================================
// Query Use Cases
// ============================================================================

export class GetProductSkuUseCase {
  constructor(private readonly repo: ProductEvidenceRepositoryPort) {}

  async execute(clientId: ClientId, skuId: SkuId): Promise<ProductSku | null> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    return this.repo.getSkuById(clientId, skuId);
  }
}

export class ListProductSkusUseCase {
  constructor(private readonly repo: ProductEvidenceRepositoryPort) {}

  async execute(
    clientId: ClientId,
    filter?: { readonly includeArchived?: boolean }
  ): Promise<readonly ProductSku[]> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    return this.repo.listSkus(clientId, filter);
  }
}

export class GetProductBatchUseCase {
  constructor(private readonly repo: ProductEvidenceRepositoryPort) {}

  async execute(clientId: ClientId, batchId: BatchId): Promise<ProductBatch | null> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    return this.repo.getBatchById(clientId, batchId);
  }
}

export class GetBatchFactsHistoryUseCase {
  constructor(private readonly repo: ProductEvidenceRepositoryPort) {}

  async execute(clientId: ClientId, batchId: BatchId): Promise<readonly BatchFactsRevision[]> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    return this.repo.getBatchHistory(clientId, batchId);
  }
}

export class ListProductBatchesUseCase {
  constructor(private readonly repo: ProductEvidenceRepositoryPort) {}

  async execute(
    clientId: ClientId,
    filter?: {
      readonly skuId?: SkuId;
      readonly includeArchived?: boolean;
    }
  ): Promise<readonly ProductBatch[]> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (filter?.skuId && !isValidUuid(filter.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["filter", "skuId"],
          message: "skuId filter must be a valid UUID string."
        }
      ]);
    }
    return this.repo.listBatches(clientId, filter);
  }
}
