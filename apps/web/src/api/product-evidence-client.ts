import { z } from "zod";
import {
  BatchEvidenceDossierSchema,
  BatchFactsRevisionResponseSchema,
  CoaReportContractSchema,
  CoaReportResponseSchema,
  CoaReportReviewResponseSchema,
  EvidenceAssetResponseSchema,
  EvidenceDerivativeSchema,
  EvidenceMediaDeliveryResponseSchema,
  EvidenceVerificationEventSchema,
  InvalidateClaimResponseSchema,
  ProductBatchCreationResultResponseSchema,
  ProductBatchHistoryResponseSchema,
  ProductBatchListResponseSchema,
  ProductBatchResponseSchema,
  ProductClaimContractSchema,
  LinkClaimEvidenceResponseSchema,
  ProductClaimReviewResponseSchema,
  ProductSkuListResponseSchema,
  ProductSkuResponseSchema,
  type AppendBatchFactsRequest,
  type AppendClaimRevisionHttpRequest,
  type ArchiveBatchRequest,
  type ArchiveCoaReportHttpRequest,
  type ArchiveSkuRequest,
  type BatchEvidenceDossier,
  type BatchFactsRevisionResponse,
  type CoaReportContract,
  type CoaReportResponse,
  type CoaReportReviewResponse,
  type CreateBatchRequest,
  type CreateClaimHttpRequest,
  type CreateCoaReportHttpRequest,
  type CreateSkuRequest,
  type EvidenceAssetResponse,
  type EvidenceDerivativeContract,
  type EvidenceMediaDeliveryResponse,
  type EvidenceVerificationEventContract,
  type InvalidateClaimHttpRequest,
  type InvalidateClaimResponse,
  type LinkClaimEvidenceHttpRequest,
  type LinkEvidenceDerivativeRequest,
  type ProductBatchCreationResultResponse,
  type ProductBatchHistoryResponse,
  type ProductBatchListResponse,
  type ProductBatchResponse,
  type ProductClaimContract,
  type LinkClaimEvidenceResponse,
  type ProductClaimReviewResponse,
  type ProductSkuListResponse,
  type ProductSkuResponse,
  type RecordEvidenceVerificationEventRequest,
  type RegisterEvidenceAssetRequest,
  type ReviewClaimHttpRequest,
  type ReviewCoaReportHttpRequest,
  type SupersedeCoaReportHttpRequest,
  type UpdateBatchMetadataRequest,
  type UpdateSkuMetadataRequest,
  ClientListItemSchema
} from "@cco/contracts";
import type { AuthorizedClientsResponse } from "../app/api/authorized-clients/route";

export const AuthorizedClientsResponseSchema = z
  .object({
    clients: z.array(ClientListItemSchema),
    directorLogin: z.string().min(1)
  })
  .strict();

export class ProductEvidenceApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: unknown,
    public readonly issues?: unknown
  ) {
    super(message);
    this.name = "ProductEvidenceApiError";
  }
}

async function handleApiResponse<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ProductEvidenceApiError(
      res.status,
      res.ok ? "UNEXPECTED_RESPONSE" : "UPSTREAM_ERROR",
      `HTTP ${res.status}: Failed to parse JSON response.`
    );
  }

  if (!res.ok) {
    const errorObj =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const errorCode =
      typeof errorObj.error === "string"
        ? errorObj.error
        : typeof errorObj.code === "string"
          ? errorObj.code
          : `HTTP_${res.status}`;
    const message =
      typeof errorObj.message === "string"
        ? errorObj.message
        : `Request failed with status ${res.status}`;
    throw new ProductEvidenceApiError(
      res.status,
      errorCode,
      message,
      errorObj.details,
      errorObj.issues
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ProductEvidenceApiError(
      502,
      "UPSTREAM_VALIDATION_ERROR",
      "Response failed schema validation",
      parsed.error.issues
    );
  }
  return parsed.data;
}

export async function fetchAuthorizedClients(
  fetchFn: typeof fetch = fetch
): Promise<AuthorizedClientsResponse> {
  const res = await fetchFn("/api/authorized-clients", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  return handleApiResponse<AuthorizedClientsResponse>(res, AuthorizedClientsResponseSchema);
}

export async function fetchProductSkus(
  clientId: string,
  includeArchived?: boolean,
  fetchFn: typeof fetch = fetch
): Promise<ProductSkuResponse[]> {
  const query = includeArchived ? "?includeArchived=true" : "";
  const res = await fetchFn(`/api/clients/${clientId}/product-skus${query}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const data = await handleApiResponse<ProductSkuListResponse>(res, ProductSkuListResponseSchema);
  return [...data.skus];
}

export async function createProductSku(
  clientId: string,
  request: CreateSkuRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductSkuResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/product-skus`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductSkuResponse>(res, ProductSkuResponseSchema);
}

export async function updateProductSkuMetadata(
  clientId: string,
  skuId: string,
  request: UpdateSkuMetadataRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductSkuResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/product-skus/${skuId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductSkuResponse>(res, ProductSkuResponseSchema);
}

export async function archiveProductSku(
  clientId: string,
  skuId: string,
  request: ArchiveSkuRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductSkuResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/product-skus/${skuId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductSkuResponse>(res, ProductSkuResponseSchema);
}

export async function fetchProductBatches(
  clientId: string,
  skuId?: string,
  includeArchived?: boolean,
  fetchFn: typeof fetch = fetch
): Promise<ProductBatchResponse[]> {
  const params = new URLSearchParams();
  if (skuId) params.set("skuId", skuId);
  if (includeArchived) params.set("includeArchived", "true");
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchFn(`/api/clients/${clientId}/batches${query}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const data = await handleApiResponse<ProductBatchListResponse>(
    res,
    ProductBatchListResponseSchema
  );
  return [...data.batches];
}

export async function createProductBatch(
  clientId: string,
  request: CreateBatchRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductBatchCreationResultResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductBatchCreationResultResponse>(
    res,
    ProductBatchCreationResultResponseSchema
  );
}

export async function updateProductBatchMetadata(
  clientId: string,
  batchId: string,
  request: UpdateBatchMetadataRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductBatchResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductBatchResponse>(res, ProductBatchResponseSchema);
}

export async function archiveProductBatch(
  clientId: string,
  batchId: string,
  request: ArchiveBatchRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductBatchResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductBatchResponse>(res, ProductBatchResponseSchema);
}

export async function fetchBatchFactsHistory(
  clientId: string,
  batchId: string,
  fetchFn: typeof fetch = fetch
): Promise<BatchFactsRevisionResponse[]> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/facts`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const data = await handleApiResponse<ProductBatchHistoryResponse>(
    res,
    ProductBatchHistoryResponseSchema
  );
  return [...data.revisions];
}

export async function appendBatchFacts(
  clientId: string,
  batchId: string,
  request: AppendBatchFactsRequest,
  fetchFn: typeof fetch = fetch
): Promise<BatchFactsRevisionResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/facts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<BatchFactsRevisionResponse>(res, BatchFactsRevisionResponseSchema);
}

export async function fetchBatchEvidenceDossier(
  clientId: string,
  batchId: string,
  fetchFn: typeof fetch = fetch
): Promise<BatchEvidenceDossier> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/dossier`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  return handleApiResponse<BatchEvidenceDossier>(res, BatchEvidenceDossierSchema);
}

export async function registerEvidenceAssetMultipart(
  clientId: string,
  batchId: string,
  formData: FormData,
  fetchFn: typeof fetch = fetch
): Promise<EvidenceAssetResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/evidence`, {
    method: "POST",
    body: formData,
    cache: "no-store"
  });
  return handleApiResponse<EvidenceAssetResponse>(res, EvidenceAssetResponseSchema);
}

export async function registerEvidenceAssetReuse(
  clientId: string,
  batchId: string,
  request: RegisterEvidenceAssetRequest,
  fetchFn: typeof fetch = fetch
): Promise<EvidenceAssetResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<EvidenceAssetResponse>(res, EvidenceAssetResponseSchema);
}

export async function linkEvidenceDerivative(
  clientId: string,
  batchId: string,
  evidenceId: string,
  revision: number,
  request: LinkEvidenceDerivativeRequest,
  fetchFn: typeof fetch = fetch
): Promise<EvidenceDerivativeContract> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/evidence/${evidenceId}/revisions/${revision}/derivatives`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<EvidenceDerivativeContract>(res, EvidenceDerivativeSchema);
}

export async function recordEvidenceVerificationEvent(
  clientId: string,
  batchId: string,
  evidenceId: string,
  revision: number,
  request: RecordEvidenceVerificationEventRequest,
  fetchFn: typeof fetch = fetch
): Promise<EvidenceVerificationEventContract> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/evidence/${evidenceId}/revisions/${revision}/verification-events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<EvidenceVerificationEventContract>(res, EvidenceVerificationEventSchema);
}

export async function fetchEvidenceMedia(
  clientId: string,
  batchId: string,
  evidenceId: string,
  revision: number,
  fetchFn: typeof fetch = fetch
): Promise<EvidenceMediaDeliveryResponse> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/evidence/${evidenceId}/revisions/${revision}/media`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    }
  );
  return handleApiResponse<EvidenceMediaDeliveryResponse>(res, EvidenceMediaDeliveryResponseSchema);
}

export async function createCoaReport(
  clientId: string,
  batchId: string,
  request: CreateCoaReportHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<CoaReportResponse> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/coa-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<CoaReportResponse>(res, CoaReportResponseSchema);
}

export async function supersedeCoaReport(
  clientId: string,
  batchId: string,
  reportId: string,
  request: SupersedeCoaReportHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<CoaReportResponse> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/coa-reports/${reportId}/supersede`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<CoaReportResponse>(res, CoaReportResponseSchema);
}

export async function reviewCoaReport(
  clientId: string,
  batchId: string,
  reportId: string,
  request: ReviewCoaReportHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<CoaReportReviewResponse> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/coa-reports/${reportId}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<CoaReportReviewResponse>(res, CoaReportReviewResponseSchema);
}

export async function archiveCoaReport(
  clientId: string,
  batchId: string,
  reportId: string,
  request: ArchiveCoaReportHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<{ report: CoaReportContract }> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/coa-reports/${reportId}/archive`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  const schema = z.object({ report: CoaReportContractSchema }).strict();
  return handleApiResponse<{ report: CoaReportContract }>(res, schema);
}

export async function createProductClaim(
  clientId: string,
  batchId: string,
  request: CreateClaimHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductClaimContract> {
  const res = await fetchFn(`/api/clients/${clientId}/batches/${batchId}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    cache: "no-store"
  });
  return handleApiResponse<ProductClaimContract>(res, ProductClaimContractSchema);
}

export async function appendClaimRevision(
  clientId: string,
  batchId: string,
  claimId: string,
  request: AppendClaimRevisionHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductClaimContract> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/claims/${claimId}/revisions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<ProductClaimContract>(res, ProductClaimContractSchema);
}

export async function linkClaimEvidence(
  clientId: string,
  batchId: string,
  claimId: string,
  request: LinkClaimEvidenceHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<LinkClaimEvidenceResponse> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/claims/${claimId}/evidence-links`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<LinkClaimEvidenceResponse>(res, LinkClaimEvidenceResponseSchema);
}

export async function reviewClaim(
  clientId: string,
  batchId: string,
  claimId: string,
  request: ReviewClaimHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<ProductClaimReviewResponse> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/claims/${claimId}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<ProductClaimReviewResponse>(res, ProductClaimReviewResponseSchema);
}

export async function invalidateClaim(
  clientId: string,
  batchId: string,
  claimId: string,
  request: InvalidateClaimHttpRequest,
  fetchFn: typeof fetch = fetch
): Promise<InvalidateClaimResponse> {
  const res = await fetchFn(
    `/api/clients/${clientId}/batches/${batchId}/claims/${claimId}/invalidate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    }
  );
  return handleApiResponse<InvalidateClaimResponse>(res, InvalidateClaimResponseSchema);
}
