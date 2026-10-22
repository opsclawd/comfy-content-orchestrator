import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import {
  ArchiveBatchRequestSchema,
  ArchiveCoaReportHttpRequestSchema,
  ArchiveSkuRequestSchema,
  AppendBatchFactsRequestSchema,
  AppendClaimRevisionHttpRequestSchema,
  RecordEvidenceVerificationEventRequestSchema,
  CreateBatchRequestSchema,
  CreateClaimHttpRequestSchema,
  CreateCoaReportHttpRequestSchema,
  CreateSkuRequestSchema,
  InvalidateClaimRequestSchema,
  LinkClaimEvidenceHttpRequestSchema,
  LinkEvidenceDerivativeRequestSchema,
  ProductClaimDetailResponseSchema,
  RegisterEvidenceAssetRequestSchema,
  RegisterEvidenceAssetMultipartMetadataSchema,
  ReviewClaimHttpRequestSchema,
  ReviewCoaReportHttpRequestSchema,
  SupersedeCoaReportHttpRequestSchema,
  UpdateBatchMetadataRequestSchema,
  UpdateSkuMetadataRequestSchema,
  type EvidenceAssetResponse,
  type RegisterEvidenceAssetResponse
} from "@cco/contracts";
import {
  ProductValidationError,
  NotFoundError,
  createActionId,
  type BatchId,
  type ClaimId,
  type ClientId,
  type CoaReportId,
  type EvidenceId,
  type ReferenceAssetId,
  type Sha256Hex,
  type SkuId,
  type SourceObjectId,
  type VerificationEventId
} from "@cco/domain";
import {
  serializeProductSku,
  serializeProductBatch,
  serializeBatchFactsRevision,
  type ClientContextResolver,
  type LinkExistingDerivativeInput
} from "@cco/application";
import {
  ClientAuthenticationRequiredError,
  ClientForbiddenError,
  ReviewerIdentityUnavailableError,
  handleProductEvidenceError
} from "../errors.js";
import { defaultClock, type ControlApiAppOptions, type ControlApiContainer } from "../types.js";

export interface ProductEvidenceRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
  readonly clientContextResolver?: ClientContextResolver<FastifyRequest> | undefined;
}

async function authenticateClient(
  resolver: ClientContextResolver<FastifyRequest> | undefined,
  request: FastifyRequest,
  routeClientId: string
): Promise<ClientId> {
  if (!resolver) {
    throw new ClientAuthenticationRequiredError(
      "Client authentication resolver is not configured."
    );
  }
  const principalClientId = await resolver.resolve(request);
  if (!principalClientId) {
    throw new ClientAuthenticationRequiredError("Client authentication required.");
  }
  if (principalClientId !== routeClientId) {
    throw new ClientForbiddenError("Access denied.");
  }
  return principalClientId as ClientId;
}

function parseRevisionParam(rawRevision: string): number {
  const parsed = Number.parseInt(rawRevision, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["revision"],
        message: `Invalid revision parameter: "${rawRevision}" must be a positive integer.`
      }
    ]);
  }
  return parsed;
}

function toSafeEvidenceAssetResponse(res: RegisterEvidenceAssetResponse): EvidenceAssetResponse {
  const { sourceObject } = res;
  return {
    evidenceAsset: res.evidenceAsset,
    evidenceRevision: res.evidenceRevision,
    sourceObject: {
      sourceObjectId: sourceObject.sourceObjectId,
      originalSha256: sourceObject.originalSha256,
      detectedMimeType: sourceObject.detectedMimeType,
      byteLength: sourceObject.byteLength,
      uploadedAt: sourceObject.uploadedAt,
      uploaderId: sourceObject.uploaderId,
      accessClass: sourceObject.accessClass,
      retentionClass: sourceObject.retentionClass,
      retentionPolicyVersion: sourceObject.retentionPolicyVersion,
      availability: sourceObject.availability
    },
    batchEvidenceLink: res.batchEvidenceLink,
    derivative: res.derivative
  };
}

export const productEvidenceRoutes: FastifyPluginAsync<ProductEvidenceRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: ProductEvidenceRoutesOptions
): Promise<void> => {
  const { container, appOptions } = opts;
  const clientContextResolver = opts.clientContextResolver ?? appOptions?.clientContextResolver;
  const reviewerIdentityResolver = appOptions?.reviewerIdentityResolver;
  const clock = appOptions?.clock ?? defaultClock;

  const resolveActor = async (request: FastifyRequest): Promise<string> => {
    if (!reviewerIdentityResolver) {
      throw new ReviewerIdentityUnavailableError();
    }
    return reviewerIdentityResolver.resolve(request);
  };

  fastify.addHook("onRequest", async (request) => {
    const match = request.url.match(/\/api\/v1\/clients\/([^/?#]+)/);
    if (match) {
      const routeClientId = decodeURIComponent(match[1]!);
      await authenticateClient(clientContextResolver, request, routeClientId);
    }
  });

  const maxConcurrentUploads = 4;
  let activeUploads = 0;
  const uploadWaiters: (() => void)[] = [];

  const acquireUploadSlot = async (): Promise<() => void> => {
    if (activeUploads < maxConcurrentUploads) {
      activeUploads++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          activeUploads--;
          const next = uploadWaiters.shift();
          if (next) {
            activeUploads++;
            next();
          }
        }
      };
    }
    await new Promise<void>((resolve) => uploadWaiters.push(resolve));
    let released = false;
    return () => {
      if (!released) {
        released = true;
        activeUploads--;
        const next = uploadWaiters.shift();
        if (next) {
          activeUploads++;
          next();
        }
      }
    };
  };

  fastify.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "private, no-store");
    return payload;
  });

  fastify.setErrorHandler(handleProductEvidenceError);

  await fastify.register(fastifyMultipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1 * 1024 * 1024,
      fields: 10,
      fileSize: 64 * 1024 * 1024,
      files: 1,
      headerPairs: 2000,
      parts: 10
    }
  });

  // ==========================================================================
  // Product SKU Routes
  // ==========================================================================

  fastify.post<{ Params: { clientId: string } }>(
    "/api/v1/clients/:clientId/product-skus",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = CreateSkuRequestSchema.parse(request.body);

      if (!container.useCases.createProductSku) {
        throw new Error("CreateProductSkuUseCase is not configured.");
      }

      const result = await container.useCases.createProductSku.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          canonicalSku: body.canonicalSku,
          displayName: body.displayName
        }
      });

      return reply.status(201).send(serializeProductSku(result));
    }
  );

  fastify.get<{ Params: { clientId: string }; Querystring: { includeArchived?: string } }>(
    "/api/v1/clients/:clientId/product-skus",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const includeArchived = request.query.includeArchived === "true";

      if (!container.useCases.listProductSkus) {
        throw new Error("ListProductSkusUseCase is not configured.");
      }

      const list = await container.useCases.listProductSkus.execute(clientId, {
        includeArchived
      });

      return reply.status(200).send({
        skus: list.map(serializeProductSku)
      });
    }
  );

  fastify.get<{ Params: { clientId: string; skuId: string } }>(
    "/api/v1/clients/:clientId/product-skus/:skuId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );

      if (!container.useCases.getProductSku) {
        throw new Error("GetProductSkuUseCase is not configured.");
      }

      const sku = await container.useCases.getProductSku.execute(
        clientId,
        request.params.skuId as SkuId
      );

      if (!sku) {
        throw new NotFoundError("ProductSku", request.params.skuId);
      }

      return reply.status(200).send(serializeProductSku(sku));
    }
  );

  fastify.patch<{ Params: { clientId: string; skuId: string } }>(
    "/api/v1/clients/:clientId/product-skus/:skuId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = UpdateSkuMetadataRequestSchema.parse(request.body);

      if (!container.useCases.updateProductSkuMetadata) {
        throw new Error("UpdateProductSkuMetadataUseCase is not configured.");
      }

      const result = await container.useCases.updateProductSkuMetadata.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          skuId: request.params.skuId as SkuId,
          expectedVersion: body.expectedVersion,
          displayName: body.displayName
        }
      });

      return reply.status(200).send(serializeProductSku(result.sku));
    }
  );

  fastify.post<{ Params: { clientId: string; skuId: string } }>(
    "/api/v1/clients/:clientId/product-skus/:skuId/archive",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = ArchiveSkuRequestSchema.parse(request.body);

      if (!container.useCases.archiveProductSku) {
        throw new Error("ArchiveProductSkuUseCase is not configured.");
      }

      const result = await container.useCases.archiveProductSku.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          skuId: request.params.skuId as SkuId,
          expectedVersion: body.expectedVersion
        }
      });

      return reply.status(200).send(serializeProductSku(result.sku));
    }
  );

  // ==========================================================================
  // Product Batch Routes
  // ==========================================================================

  fastify.post<{ Params: { clientId: string } }>(
    "/api/v1/clients/:clientId/batches",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = CreateBatchRequestSchema.parse(request.body);

      if (!container.useCases.createProductBatch) {
        throw new Error("CreateProductBatchUseCase is not configured.");
      }

      const result = await container.useCases.createProductBatch.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          skuId: body.skuId as SkuId,
          lotIdentifier: body.lotIdentifier,
          displayName: body.displayName,
          ...(body.initialFacts
            ? {
                initialFacts: {
                  originKind: body.initialFacts.originKind,
                  producerIdentityAsClaimed: body.initialFacts.producerIdentityAsClaimed ?? null,
                  productionStartDate: body.initialFacts.productionStartDate ?? null,
                  productionEndDate: body.initialFacts.productionEndDate ?? null,
                  originEvidenceId: (body.initialFacts.originEvidenceId as EvidenceId) ?? null,
                  originEvidenceRevision: body.initialFacts.originEvidenceRevision ?? null
                }
              }
            : {})
        }
      });

      return reply.status(201).send({
        batch: serializeProductBatch(result.batch),
        initialFacts: serializeBatchFactsRevision(result.initialFacts)
      });
    }
  );

  fastify.get<{
    Params: { clientId: string };
    Querystring: { skuId?: string; includeArchived?: string };
  }>("/api/v1/clients/:clientId/batches", async (request, reply) => {
    const clientId = await authenticateClient(
      clientContextResolver,
      request,
      request.params.clientId
    );
    const skuId = request.query.skuId as SkuId | undefined;
    const includeArchived = request.query.includeArchived === "true";

    if (!container.useCases.listProductBatches) {
      throw new Error("ListProductBatchesUseCase is not configured.");
    }

    const batches = await container.useCases.listProductBatches.execute(clientId, {
      ...(skuId ? { skuId } : {}),
      includeArchived
    });

    return reply.status(200).send({
      batches: batches.map(serializeProductBatch)
    });
  });

  fastify.get<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );

      if (!container.useCases.getProductBatch) {
        throw new Error("GetProductBatchUseCase is not configured.");
      }

      const batch = await container.useCases.getProductBatch.execute(
        clientId,
        request.params.batchId as BatchId
      );

      if (!batch) {
        throw new NotFoundError("ProductBatch", request.params.batchId);
      }

      return reply.status(200).send(serializeProductBatch(batch));
    }
  );

  fastify.patch<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = UpdateBatchMetadataRequestSchema.parse(request.body);

      if (!container.useCases.updateProductBatchMetadata) {
        throw new Error("UpdateProductBatchMetadataUseCase is not configured.");
      }

      const result = await container.useCases.updateProductBatchMetadata.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          batchId: request.params.batchId as BatchId,
          expectedVersion: body.expectedVersion,
          displayName: body.displayName
        }
      });

      return reply.status(200).send(serializeProductBatch(result.batch));
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/archive",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = ArchiveBatchRequestSchema.parse(request.body);

      if (!container.useCases.archiveProductBatch) {
        throw new Error("ArchiveProductBatchUseCase is not configured.");
      }

      const result = await container.useCases.archiveProductBatch.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          batchId: request.params.batchId as BatchId,
          expectedVersion: body.expectedVersion
        }
      });

      return reply.status(200).send(serializeProductBatch(result.batch));
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/facts",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const body = AppendBatchFactsRequestSchema.parse(request.body);

      if (!container.useCases.appendBatchFacts) {
        throw new Error("AppendBatchFactsUseCase is not configured.");
      }

      const result = await container.useCases.appendBatchFacts.execute({
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          batchId: request.params.batchId as BatchId,
          expectedVersion: body.expectedVersion,
          originKind: body.originKind,
          producerIdentityAsClaimed: body.producerIdentityAsClaimed ?? null,
          productionStartDate: body.productionStartDate ?? null,
          productionEndDate: body.productionEndDate ?? null,
          originEvidenceId: (body.originEvidenceId as EvidenceId) ?? null,
          originEvidenceRevision: body.originEvidenceRevision ?? null
        }
      });

      return reply.status(201).send(serializeBatchFactsRevision(result));
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/facts",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );

      if (!container.useCases.getBatchFactsHistory) {
        throw new Error("GetBatchFactsHistoryUseCase is not configured.");
      }

      const history = await container.useCases.getBatchFactsHistory.execute(
        clientId,
        request.params.batchId as BatchId
      );

      return reply.status(200).send({
        revisions: history.map(serializeBatchFactsRevision)
      });
    }
  );

  // ==========================================================================
  // Evidence Asset Routes
  // ==========================================================================

  fastify.post<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      if (request.isMultipart()) {
        const releaseUploadSlot = await acquireUploadSlot();
        try {
          let fileBuffer: Buffer | undefined;
          let metadataRaw: Record<string, unknown> | undefined;
          let fileCount = 0;
          let metadataCount = 0;

          for await (const part of request.parts()) {
            if (part.type === "file") {
              if (part.fieldname !== "file") {
                throw new ProductValidationError([
                  {
                    code: "INVALID_FIELD_COMBINATION",
                    path: ["file"],
                    message: "File part must have field name 'file'."
                  }
                ]);
              }
              fileCount++;
              if (fileCount > 1) {
                throw new ProductValidationError([
                  {
                    code: "INVALID_FIELD_COMBINATION",
                    path: ["file"],
                    message: "Only one file part is allowed in multipart request."
                  }
                ]);
              }
              if (part.file.truncated) {
                const err = new Error("File exceeds maximum allowed size.");
                Object.assign(err, { statusCode: 413, code: "FST_ERR_MULTIPART_FILE_TOO_LARGE" });
                throw err;
              }
              const buf = await part.toBuffer();
              if (part.file.truncated) {
                const err = new Error("File exceeds maximum allowed size.");
                Object.assign(err, { statusCode: 413, code: "FST_ERR_MULTIPART_FILE_TOO_LARGE" });
                throw err;
              }
              fileBuffer = buf;
            } else {
              if (part.fieldname === "metadata") {
                if ((part as { readonly valueTruncated?: boolean }).valueTruncated) {
                  const err = new Error("Metadata part exceeds maximum allowed size.");
                  Object.assign(err, {
                    statusCode: 413,
                    code: "FST_ERR_MULTIPART_FIELD_VALUE_TOO_LARGE"
                  });
                  throw err;
                }
                metadataCount++;
                if (metadataCount > 1) {
                  throw new ProductValidationError([
                    {
                      code: "INVALID_FIELD_COMBINATION",
                      path: ["metadata"],
                      message: "Duplicate metadata part in multipart request."
                    }
                  ]);
                }
                try {
                  metadataRaw =
                    typeof part.value === "string"
                      ? JSON.parse(part.value)
                      : (part.value as Record<string, unknown>);
                } catch {
                  throw new ProductValidationError([
                    {
                      code: "INVALID_FIELD_COMBINATION",
                      path: ["metadata"],
                      message: "Metadata part must be valid JSON."
                    }
                  ]);
                }
              } else {
                throw new ProductValidationError([
                  {
                    code: "INVALID_FIELD_COMBINATION",
                    path: ["metadata"],
                    message:
                      "Unexpected part in multipart payload. Multipart evidence upload only accepts 'metadata' and 'file' parts."
                  }
                ]);
              }
            }
          }

          if (!fileBuffer) {
            throw new ProductValidationError([
              {
                code: "INVALID_FIELD_COMBINATION",
                path: ["file"],
                message: "Missing file part in multipart request."
              }
            ]);
          }

          if (!metadataRaw) {
            throw new ProductValidationError([
              {
                code: "INVALID_FIELD_COMBINATION",
                path: ["metadata"],
                message: "Missing metadata part in multipart request."
              }
            ]);
          }

          if ("reusedSourceObjectId" in metadataRaw && metadataRaw.reusedSourceObjectId) {
            throw new ProductValidationError([
              {
                code: "INVALID_FIELD_COMBINATION",
                path: ["reusedSourceObjectId"],
                message: "reusedSourceObjectId cannot be combined with uploaded file bytes."
              }
            ]);
          }

          const headerActionId = request.headers["x-action-id"] as string | undefined;
          if (headerActionId && metadataRaw.actionId && headerActionId !== metadataRaw.actionId) {
            throw new ProductValidationError([
              {
                code: "INVALID_FIELD_COMBINATION",
                path: ["actionId"],
                message: "actionId in x-action-id header does not match metadata"
              }
            ]);
          }

          const metadata = RegisterEvidenceAssetMultipartMetadataSchema.parse({
            ...metadataRaw,
            actionId: metadataRaw.actionId ?? headerActionId,
            batchId,
            declaredMimeType: metadataRaw.declaredMimeType
          });

          const regRes = await container.useCases.evidenceAsset.registerEvidenceAsset(
            clientId,
            batchId,
            {
              ...metadata,
              targetEvidenceId: metadata.targetEvidenceId as EvidenceId | undefined,
              derivative: metadata.derivative as LinkExistingDerivativeInput | undefined,
              clientId,
              batchId,
              actorId,
              actionId: createActionId(metadata.actionId),
              body: new Uint8Array(fileBuffer)
            }
          );

          return reply.status(201).send(toSafeEvidenceAssetResponse(regRes));
        } finally {
          releaseUploadSlot();
        }
      }

      // JSON reused source path
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      if (rawBody.batchId && rawBody.batchId !== batchId) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["batchId"],
              message: "batchId in request body does not match URL parameter"
            }
          ],
          "batchId in request body does not match URL parameter"
        );
      }
      const body = RegisterEvidenceAssetRequestSchema.parse({
        ...rawBody,
        batchId
      });
      const regRes = await container.useCases.evidenceAsset.registerEvidenceAsset(
        clientId,
        batchId,
        {
          clientId,
          batchId,
          actorId,
          actionId: createActionId(body.actionId),
          purpose: body.purpose,
          sourceClass: body.sourceClass,
          acquisitionMethod: body.acquisitionMethod,
          assertionText: body.assertionText,
          reportedCaptureDate: body.reportedCaptureDate,
          reportedCaptureTimestamp: body.reportedCaptureTimestamp,
          reportedCapturePrecision: body.reportedCapturePrecision,
          captureContext: body.captureContext,
          rightsStatus: body.rightsStatus,
          consentStatus: body.consentStatus,
          rightsAttribution: body.rightsAttribution,
          rightsDocumentLocator: body.rightsDocumentLocator,
          declaredMimeType: body.declaredMimeType,
          registrationIntent: body.registrationIntent,
          reusedSourceObjectId: body.reusedSourceObjectId as SourceObjectId | undefined,
          expectedEvidenceVersion: body.expectedEvidenceVersion,
          targetEvidenceId: body.targetEvidenceId as EvidenceId | undefined,
          derivative: body.derivative as LinkExistingDerivativeInput | undefined
        }
      );

      return reply.status(201).send(toSafeEvidenceAssetResponse(regRes));
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const list = await container.useCases.evidenceAsset.listBatchEvidence(clientId, batchId);
      return reply.status(200).send(list);
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string; evidenceId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const detail = await container.useCases.evidenceAsset.getEvidenceAssetHead(
        clientId,
        batchId,
        evidenceId
      );
      return reply.status(200).send(detail);
    }
  );

  fastify.get<{
    Params: { clientId: string; batchId: string; evidenceId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId/revisions/:revision",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;
      const revision = parseRevisionParam(request.params.revision);

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const rev = await container.useCases.evidenceAsset.getEvidenceRevision(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      return reply.status(200).send(rev);
    }
  );

  // ==========================================================================
  // Derivative Linking Routes
  // ==========================================================================

  fastify.post<{
    Params: { clientId: string; batchId: string; evidenceId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId/revisions/:revision/derivative",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;
      const revision = parseRevisionParam(request.params.revision);

      const rawBody = (
        typeof request.body === "object" && request.body !== null ? request.body : {}
      ) as Record<string, unknown>;
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = LinkEvidenceDerivativeRequestSchema.parse({
        actionId: rawBody.actionId ?? headerActionId,
        evidenceId: rawBody.evidenceId ?? evidenceId,
        evidenceRevision: rawBody.evidenceRevision ?? revision,
        referenceAssetId: rawBody.referenceAssetId,
        derivativeSha256: rawBody.derivativeSha256,
        transformDescription: rawBody.transformDescription,
        ...(rawBody.transformToolVersion !== undefined
          ? { transformToolVersion: rawBody.transformToolVersion }
          : {})
      });

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const result = await container.useCases.evidenceAsset.linkDerivative(clientId, batchId, {
        clientId,
        evidenceId,
        evidenceRevision: revision,
        referenceAssetId: body.referenceAssetId as ReferenceAssetId,
        derivativeSha256: body.derivativeSha256 as Sha256Hex,
        transformDescription: body.transformDescription,
        transformToolVersion: body.transformToolVersion,
        actorId,
        actionId: createActionId(body.actionId)
      });

      return reply.status(200).send(result);
    }
  );

  fastify.get<{
    Params: { clientId: string; batchId: string; evidenceId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId/revisions/:revision/derivative",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;
      const revision = parseRevisionParam(request.params.revision);

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const result = await container.useCases.evidenceAsset.getDerivative(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      return reply.status(200).send(result);
    }
  );

  // ==========================================================================
  // Verification Event Routes
  // ==========================================================================

  fastify.post<{
    Params: { clientId: string; batchId: string; evidenceId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId/revisions/:revision/verification-events",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;
      const revision = parseRevisionParam(request.params.revision);

      const rawBody = (
        typeof request.body === "object" && request.body !== null ? request.body : {}
      ) as Record<string, unknown>;
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = RecordEvidenceVerificationEventRequestSchema.parse({
        actionId: rawBody.actionId ?? headerActionId,
        evidenceId: rawBody.evidenceId ?? evidenceId,
        evidenceRevision: rawBody.evidenceRevision ?? revision,
        outcome: rawBody.outcome,
        verificationKind: rawBody.verificationKind,
        factScope: rawBody.factScope,
        method: rawBody.method,
        reason: rawBody.reason,
        ...(rawBody.verifiedPartyReference !== undefined
          ? { verifiedPartyReference: rawBody.verifiedPartyReference }
          : {}),
        ...(rawBody.withdrawalEventId !== undefined
          ? { withdrawalEventId: rawBody.withdrawalEventId }
          : {})
      });

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const event = await container.useCases.evidenceAsset.recordVerificationEvent(
        clientId,
        batchId,
        {
          clientId,
          evidenceId,
          evidenceRevision: revision,
          actorId,
          actionId: createActionId(body.actionId),
          outcome: body.outcome,
          verificationKind: body.verificationKind,
          factScope: body.factScope,
          method: body.method,
          reason: body.reason,
          verifiedPartyReference: body.verifiedPartyReference,
          withdrawalEventId: body.withdrawalEventId as VerificationEventId | undefined
        }
      );

      return reply.status(200).send(event);
    }
  );

  fastify.get<{
    Params: { clientId: string; batchId: string; evidenceId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId/revisions/:revision/verification-events",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;
      const revision = parseRevisionParam(request.params.revision);

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const result = await container.useCases.evidenceAsset.listVerificationEvents(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      return reply.status(200).send(result);
    }
  );

  // ==========================================================================
  // Media Delivery Route (Signed URL 300s TTL)
  // ==========================================================================

  fastify.get<{
    Params: { clientId: string; batchId: string; evidenceId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/evidence/:evidenceId/revisions/:revision/media",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const evidenceId = request.params.evidenceId as EvidenceId;
      const revision = parseRevisionParam(request.params.revision);

      if (!container.useCases.evidenceAsset) {
        throw new Error("EvidenceAssetUseCases is not configured.");
      }

      const result = await container.useCases.evidenceAsset.deliverMedia(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      return reply.status(200).send(result);
    }
  );

  // ==========================================================================
  // CoA Report Routes
  // ==========================================================================

  fastify.post<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      if (rawBody.batchId && rawBody.batchId !== batchId) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["batchId"],
              message: "batchId in request body does not match URL parameter"
            }
          ],
          "batchId in request body does not match URL parameter"
        );
      }
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = CreateCoaReportHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId,
        batchId
      });

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const { actionId, ...coaPayload } = body;
      const result = await container.useCases.coaReport.createCoaReport(clientId, batchId, {
        actionId: createActionId(actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          ...coaPayload,
          batchId
        }
      });

      return reply.status(201).send({
        report: result.report,
        currentRevision: {
          ...result.revision,
          measurements: result.measurements
        }
      });
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const result = await container.useCases.coaReport.listReportsForBatch(clientId, batchId);
      return reply.status(200).send(result);
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string; reportId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports/:reportId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const reportId = request.params.reportId as CoaReportId;

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const result = await container.useCases.coaReport.getReportById(clientId, batchId, reportId);
      return reply.status(200).send(result);
    }
  );

  fastify.get<{
    Params: { clientId: string; batchId: string; reportId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports/:reportId/revisions/:revision",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const reportId = request.params.reportId as CoaReportId;
      const revision = parseRevisionParam(request.params.revision);

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const result = await container.useCases.coaReport.getReportRevision(
        clientId,
        batchId,
        reportId,
        revision
      );
      return reply.status(200).send(result);
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; reportId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports/:reportId/supersede",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const reportId = request.params.reportId as CoaReportId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = SupersedeCoaReportHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const { actionId, ...supersedePayload } = body;
      const result = await container.useCases.coaReport.supersedeCoaReport(
        clientId,
        batchId,
        reportId,
        {
          actionId: createActionId(actionId),
          clientId,
          actorId,
          timestamp: clock.now(),
          payload: {
            ...supersedePayload,
            reportId
          }
        }
      );

      return reply.status(200).send({
        report: result.report,
        currentRevision: {
          ...result.revision,
          measurements: result.measurements
        }
      });
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; reportId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports/:reportId/review",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const reportId = request.params.reportId as CoaReportId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = ReviewCoaReportHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const { actionId, ...reviewPayload } = body;
      const result = await container.useCases.coaReport.reviewCoaReport(
        clientId,
        batchId,
        reportId,
        {
          actionId: createActionId(actionId),
          clientId,
          actorId,
          timestamp: clock.now(),
          payload: {
            ...reviewPayload,
            reportId
          }
        }
      );

      return reply.status(200).send(result);
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; reportId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/coa-reports/:reportId/archive",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const reportId = request.params.reportId as CoaReportId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = ArchiveCoaReportHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.coaReport) {
        throw new Error("CoaReportUseCases is not configured.");
      }

      const { actionId, ...archivePayload } = body;
      const result = await container.useCases.coaReport.archiveCoaReport(
        clientId,
        batchId,
        reportId,
        {
          actionId: createActionId(actionId),
          clientId,
          actorId,
          timestamp: clock.now(),
          payload: {
            ...archivePayload,
            reportId
          }
        }
      );

      return reply.status(200).send({ report: result });
    }
  );

  // ==========================================================================
  // Product Claim Routes
  // ==========================================================================

  fastify.post<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      if (rawBody.batchId && rawBody.batchId !== batchId) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["batchId"],
              message: "batchId in request body does not match URL parameter"
            }
          ],
          "batchId in request body does not match URL parameter"
        );
      }
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = CreateClaimHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId,
        batchId
      });

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const { actionId, ...claimPayload } = body;
      const result = await container.useCases.claim.createClaim(clientId, batchId, {
        actionId: createActionId(actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          ...claimPayload,
          batchId
        }
      });

      return reply.status(201).send(result.claim);
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const result = await container.useCases.claim.listClaimsForBatch(clientId, batchId);
      return reply.status(200).send(result);
    }
  );

  fastify.get<{ Params: { clientId: string; batchId: string; claimId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims/:claimId",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const claimId = request.params.claimId as ClaimId;

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const result = await container.useCases.claim.getClaimById(clientId, batchId, claimId);
      return reply.status(200).send(ProductClaimDetailResponseSchema.parse(result));
    }
  );

  fastify.get<{
    Params: { clientId: string; batchId: string; claimId: string; revision: string };
  }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims/:claimId/revisions/:revision",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;
      const claimId = request.params.claimId as ClaimId;
      const revision = parseRevisionParam(request.params.revision);

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const result = await container.useCases.claim.getClaimRevision(
        clientId,
        batchId,
        claimId,
        revision
      );
      return reply.status(200).send(result);
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; claimId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims/:claimId/revisions",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const claimId = request.params.claimId as ClaimId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = AppendClaimRevisionHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const { actionId, ...revisionPayload } = body;
      const result = await container.useCases.claim.appendClaimRevision(
        clientId,
        batchId,
        claimId,
        {
          actionId: createActionId(actionId),
          clientId,
          actorId,
          timestamp: clock.now(),
          payload: {
            ...revisionPayload,
            claimId
          }
        }
      );

      return reply.status(200).send(result.claim);
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; claimId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims/:claimId/evidence-links",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const claimId = request.params.claimId as ClaimId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = LinkClaimEvidenceHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const { actionId, ...linkPayload } = body;
      const result = await container.useCases.claim.linkClaimEvidence(clientId, batchId, claimId, {
        actionId: createActionId(actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          ...linkPayload,
          claimId
        }
      });

      return reply.status(200).send(result);
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; claimId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims/:claimId/review",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const claimId = request.params.claimId as ClaimId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = ReviewClaimHttpRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const { actionId, ...reviewPayload } = body;
      const result = await container.useCases.claim.reviewClaim(clientId, batchId, claimId, {
        actionId: createActionId(actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          ...reviewPayload,
          claimId
        }
      });

      return reply.status(200).send(result);
    }
  );

  fastify.post<{ Params: { clientId: string; batchId: string; claimId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/claims/:claimId/invalidate",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const actorId = await resolveActor(request);
      const batchId = request.params.batchId as BatchId;
      const claimId = request.params.claimId as ClaimId;
      const rawBody = (request.body as Record<string, unknown>) ?? {};
      const headerActionId = request.headers["x-action-id"] as string | undefined;
      if (headerActionId && rawBody.actionId && headerActionId !== rawBody.actionId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["actionId"],
            message: "actionId in x-action-id header does not match body"
          }
        ]);
      }
      const body = InvalidateClaimRequestSchema.parse({
        ...rawBody,
        actionId: rawBody.actionId ?? headerActionId
      });

      if (!container.useCases.claim) {
        throw new Error("ClaimUseCases is not configured.");
      }

      const result = await container.useCases.claim.invalidateClaim(clientId, batchId, claimId, {
        actionId: createActionId(body.actionId),
        clientId,
        actorId,
        timestamp: clock.now(),
        payload: {
          ...body,
          claimId
        }
      });

      return reply.status(200).send(result);
    }
  );

  // ==========================================================================
  // Dossier Read Model Query
  // ==========================================================================

  fastify.get<{ Params: { clientId: string; batchId: string } }>(
    "/api/v1/clients/:clientId/batches/:batchId/dossier",
    async (request, reply) => {
      const clientId = await authenticateClient(
        clientContextResolver,
        request,
        request.params.clientId
      );
      const batchId = request.params.batchId as BatchId;

      if (!container.useCases.resolveBatchEvidenceDossier) {
        throw new Error("ResolveBatchEvidenceDossierUseCase is not configured.");
      }

      const dossier = await container.useCases.resolveBatchEvidenceDossier.execute({
        clientId,
        batchId
      });

      return reply.status(200).send(dossier);
    }
  );
};
