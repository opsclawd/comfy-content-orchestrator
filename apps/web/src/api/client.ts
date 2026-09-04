import {
  CampaignReviewSummarySchema,
  type CampaignReviewSummary,
  HealthResponseSchema,
  type HealthResponse,
  ReviewCommandSchema,
  type ReviewCommand,
  ReviewCommandResponseSchema,
  type ReviewCommandResponse,
  ReviewErrorResponseSchema,
  type ReviewErrorResponse,
  SceneReviewDetailReadModelSchema,
  type SceneReviewDetailReadModel
} from "@cco/contracts";
import type { z } from "zod";
import { resolveControlApiBaseUrl } from "./runtime-config";

export type {
  CampaignReviewSummary,
  HealthResponse,
  ReviewCommand,
  ReviewCommandResponse,
  ReviewErrorResponse,
  SceneReviewDetailReadModel
} from "@cco/contracts";

export {
  CampaignReviewSummarySchema,
  HealthResponseSchema,
  ReviewCommandSchema,
  ReviewCommandResponseSchema,
  ReviewErrorResponseSchema,
  SceneReviewDetailReadModelSchema
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

export class ReviewCommandApiError extends Error {
  override readonly name = "ReviewCommandApiError";

  constructor(
    public readonly statusCode: number,
    public readonly error: ReviewErrorResponse
  ) {
    super(`Review command failed with HTTP ${statusCode} (${error.code}): ${error.message}`);
  }

  get body(): ReviewErrorResponse {
    return this.error;
  }
}

export interface ReviewerIdentity {
  readonly login: string;
  readonly displayName?: string;
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>;
  getCampaignReviewSummary(campaignId: string): Promise<CampaignReviewSummary>;
  getSceneReviewDetail(sceneId: string): Promise<SceneReviewDetailReadModel>;
  submitReviewCommand(
    sceneId: string,
    command: ReviewCommand,
    reviewerIdentity: ReviewerIdentity
  ): Promise<ReviewCommandResponse>;
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
  return resolveControlApiBaseUrl(baseUrl);
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
    },

    async submitReviewCommand(
      sceneId: string,
      command: ReviewCommand,
      reviewerIdentity: ReviewerIdentity
    ): Promise<ReviewCommandResponse> {
      const commandParseResult = ReviewCommandSchema.safeParse(command);
      if (!commandParseResult.success) {
        throw new ApiValidationError(
          `Review command failed validation: ${commandParseResult.error.message}`,
          commandParseResult.error.issues
        );
      }

      const parsedCommand = commandParseResult.data;
      if (sceneId !== parsedCommand.sceneId) {
        throw new ApiValidationError(
          `Route sceneId "${sceneId}" does not match command body sceneId "${parsedCommand.sceneId}"`,
          [
            {
              path: ["sceneId"],
              message: `Route sceneId "${sceneId}" does not match command body sceneId "${parsedCommand.sceneId}"`
            }
          ]
        );
      }

      const serializedBody = JSON.stringify(parsedCommand);
      const encodedSceneId = encodeURIComponent(sceneId);
      const url = `${baseUrl}/api/scenes/${encodedSceneId}/review-command`;

      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "tailscale-user-login": reviewerIdentity.login
      };
      if (reviewerIdentity.displayName !== undefined) {
        requestHeaders["tailscale-user-name"] = reviewerIdentity.displayName;
      }

      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: requestHeaders,
          cache: "no-store",
          body: serializedBody
        });
      } catch (err) {
        throw new ApiClientError(
          `Failed to connect to Control API: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          err
        );
      }

      if (!res.ok) {
        let errorData: unknown;
        try {
          errorData = await res.json();
        } catch {
          throw new ApiClientError(
            `Control API returned HTTP ${res.status}: ${res.statusText}`,
            res.status
          );
        }

        const errorParseResult = ReviewErrorResponseSchema.safeParse(errorData);
        if (errorParseResult.success) {
          throw new ReviewCommandApiError(res.status, errorParseResult.data);
        }

        throw new ApiValidationError(
          `Control API returned HTTP ${res.status} with malformed error payload: ${errorParseResult.error.message}`,
          errorParseResult.error.issues
        );
      }

      let successData: unknown;
      try {
        successData = await res.json();
      } catch (err) {
        throw new ApiValidationError(
          `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
          err
        );
      }

      const responseParseResult = ReviewCommandResponseSchema.safeParse(successData);
      if (!responseParseResult.success) {
        throw new ApiValidationError(
          `Control API response failed schema validation: ${responseParseResult.error.message}`,
          responseParseResult.error.issues
        );
      }

      return responseParseResult.data;
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

export async function submitReviewCommand(
  sceneId: string,
  command: ReviewCommand,
  reviewerIdentity: ReviewerIdentity,
  fetchImpl?: typeof fetch
): Promise<ReviewCommandResponse> {
  const client = createApiClient({ fetchFn: fetchImpl });
  return client.submitReviewCommand(sceneId, command, reviewerIdentity);
}
