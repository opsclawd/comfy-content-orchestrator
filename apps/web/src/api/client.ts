import { HealthResponseSchema, type HealthResponse } from "@cco/contracts";

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
}

export function createApiClient(config?: ApiClientConfig): ApiClient {
  const baseUrl = (
    config?.baseUrl ??
    process.env.CONTROL_API_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
  const fetchFn = config?.fetchFn ?? globalThis.fetch;

  return {
    async getHealth(): Promise<HealthResponse> {
      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/api/health`, {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
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
          `Control API health endpoint returned HTTP ${res.status}: ${res.statusText}`,
          res.status
        );
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch (err) {
        throw new ApiClientError(
          `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
          res.status,
          err
        );
      }

      const parseResult = HealthResponseSchema.safeParse(data);
      if (!parseResult.success) {
        throw new ApiValidationError(
          `Control API health response failed schema validation: ${parseResult.error.message}`,
          parseResult.error.issues
        );
      }

      return parseResult.data;
    }
  };
}

export async function getHealth(baseUrl?: string, fetchFn?: typeof fetch): Promise<HealthResponse> {
  const client = createApiClient({ baseUrl, fetchFn });
  return client.getHealth();
}
