import {
  CampaignReviewSummarySchema,
  type CampaignReviewSummary,
  HealthResponseSchema,
  type HealthResponse,
  SceneReviewDetailReadModelSchema,
  type SceneReviewDetailReadModel
} from "@cco/contracts";
import type { z } from "zod";

export type {
  CampaignReviewSummary,
  HealthResponse,
  SceneReviewDetailReadModel
} from "@cco/contracts";

export interface ApiClientConfig {
  baseUrl?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

export class ApiClientError extends Error {
  override readonly name = "ApiClientError";

  constructor(
    message: string,
    public readonly statusCode?: number,
    public override readonly cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}

export class ApiValidationError extends Error {
  override readonly name = "ApiValidationError";

  constructor(
    message: string,
    public readonly issues: unknown
  ) {
    super(message);
  }
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>;
  getCampaignReviewSummary(campaignId: string): Promise<CampaignReviewSummary>;
  getSceneReviewDetail(sceneId: string): Promise<SceneReviewDetailReadModel>;
}

async function requestJson<T>(
  url: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });
  } catch (err) {
    throw new ApiClientError(
      `Failed to connect to Control API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err
    );
  }

  if (!res.ok) {
    throw new ApiClientError(
      `Control API returned HTTP ${res.status}: ${res.statusText}`,
      res.status
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new ApiValidationError(
      `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  const parseResult = schema.safeParse(data);
  if (!parseResult.success) {
    throw new ApiValidationError(
      `Control API response failed schema validation: ${parseResult.error.message}`,
      parseResult.error.issues
    );
  }

  return parseResult.data;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? process.env.CONTROL_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function createApiClient(config?: ApiClientConfig): ApiClient {
  const baseUrl = resolveBaseUrl(config?.baseUrl);
  const fetchFn = config?.fetchFn ?? globalThis.fetch;

  return {
    async getHealth(): Promise<HealthResponse> {
      return requestJson(`${baseUrl}/api/health`, HealthResponseSchema, fetchFn);
    },

    async getCampaignReviewSummary(campaignId: string): Promise<CampaignReviewSummary> {
      const encoded = encodeURIComponent(campaignId);
      return requestJson(
        `${baseUrl}/api/campaigns/${encoded}/review-summary`,
        CampaignReviewSummarySchema,
        fetchFn
      );
    },

    async getSceneReviewDetail(sceneId: string): Promise<SceneReviewDetailReadModel> {
      const encoded = encodeURIComponent(sceneId);
      return requestJson(
        `${baseUrl}/api/scenes/${encoded}/review`,
        SceneReviewDetailReadModelSchema,
        fetchFn
      );
    }
  };
}

export async function getHealth(baseUrl?: string, fetchFn?: typeof fetch): Promise<HealthResponse> {
  const client = createApiClient({ baseUrl, fetchFn });
  return client.getHealth();
}

export async function getCampaignReviewSummary(
  campaignId: string,
  fetchImpl?: typeof fetch
): Promise<CampaignReviewSummary> {
  const client = createApiClient({ fetchFn: fetchImpl });
  return client.getCampaignReviewSummary(campaignId);
}

export async function getSceneReviewDetail(
  sceneId: string,
  fetchImpl?: typeof fetch
): Promise<SceneReviewDetailReadModel> {
  const client = createApiClient({ fetchFn: fetchImpl });
  return client.getSceneReviewDetail(sceneId);
}
