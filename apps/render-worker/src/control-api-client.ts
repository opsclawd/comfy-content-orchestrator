import {
  StorageAdmissionError,
  type DeliveryAssemblyJobMutationResult,
  type JobMutationResult
} from "@cco/application";
import {
  STORAGE_OPERATION_CLASSES,
  STORAGE_WATERMARK_STATES,
  type AssemblySpec,
  type StorageOperationClass,
  type StorageWatermarkState
} from "@cco/contracts";
import type { DeliveryAssemblyJob, JobId, JobKind, LeaseToken, RenderJob } from "@cco/domain";

export interface CompleteJobOptions {
  readonly manifestPayload?: Readonly<Record<string, unknown>> | undefined;
  readonly candidatePayload?: Readonly<Record<string, unknown>> | undefined;
}

export interface ControlApiClient {
  claim(workerId: string, allowedJobKinds?: readonly JobKind[]): Promise<RenderJob | undefined>;
  start(jobId: JobId | string, leaseToken: LeaseToken | string): Promise<JobMutationResult>;
  heartbeat(jobId: JobId | string, leaseToken: LeaseToken | string): Promise<JobMutationResult>;
  complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    payload?: CompleteJobOptions | undefined
  ): Promise<JobMutationResult>;
  fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<JobMutationResult>;
  defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<JobMutationResult>;
}

export interface ControlApiClientConfig {
  readonly baseUrl?: string | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

// A hung Control API request (connection opened, never responds) leaves an
// awaited fetch() promise pending forever — no error, so none of the
// existing retry/reconciliation logic in DeliveryAssemblyWorker ever gets a
// chance to run. Every request must be bounded so a hung request surfaces
// as a catchable failure instead of blocking retries and shutdown drain
// indefinitely.
export const DEFAULT_CONTROL_API_TIMEOUT_MS = 30_000;

// The abort signal must stay live through response-body consumption, not
// just the initial fetch() call: a server can send headers and then never
// complete the body, leaving res.json() pending forever even though
// fetch() itself already resolved. handleResponse is called with the same
// deadline still armed, so a hang anywhere in status-check-or-body-read is
// covered, not just connection establishment.
async function fetchWithTimeout<T>(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  handleResponse: (res: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    return await handleResponse(res);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ControlApiClientError(
        `Control API request to ${url} timed out after ${timeoutMs}ms`,
        undefined,
        { cause: err }
      );
    }
    if (err instanceof ControlApiClientError) {
      throw err;
    }
    throw new ControlApiClientError(
      `Failed to connect to Control API: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }
}

export class ControlApiClientError extends Error {
  override readonly name = "ControlApiClientError";
  readonly statusCode: number | undefined;
  readonly responseDetail?: string | undefined;

  constructor(
    message: string,
    statusCode?: number | undefined,
    options?: ErrorOptions & { responseDetail?: string | undefined }
  ) {
    super(message, options);
    this.statusCode = statusCode;
    this.responseDetail = options?.responseDetail;
  }
}

const MAX_ERROR_DETAIL_LENGTH = 500;

async function extractSafeErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const contentType = res.headers?.get?.("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return undefined;
    }
    const data: unknown = await res.json();
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.message === "string" && record.message.trim().length > 0) {
        return record.message.trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
      }
      if (typeof record.code === "string" && record.code.trim().length > 0) {
        return record.code.trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
      }
    }
  } catch {
    // If JSON parsing fails, do not read arbitrary/unbounded text bodies
  }
  return undefined;
}

interface StorageAdmissionErrorPayload {
  readonly code: "STORAGE_ADMISSION_DENIED";
  readonly message?: string;
  readonly operationClass: StorageOperationClass;
  readonly watermarkState: StorageWatermarkState;
  readonly usedRatio: number;
  readonly totalBytes: number;
  readonly freeBytes: number;
}

function isStorageAdmissionErrorPayload(data: unknown): data is StorageAdmissionErrorPayload {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (obj.code !== "STORAGE_ADMISSION_DENIED") {
    return false;
  }
  if (
    typeof obj.operationClass !== "string" ||
    !(STORAGE_OPERATION_CLASSES as readonly string[]).includes(obj.operationClass)
  ) {
    return false;
  }
  if (
    typeof obj.watermarkState !== "string" ||
    !(STORAGE_WATERMARK_STATES as readonly string[]).includes(obj.watermarkState)
  ) {
    return false;
  }
  if (typeof obj.usedRatio !== "number" || Number.isNaN(obj.usedRatio)) {
    return false;
  }
  if (typeof obj.totalBytes !== "number" || Number.isNaN(obj.totalBytes)) {
    return false;
  }
  if (typeof obj.freeBytes !== "number" || Number.isNaN(obj.freeBytes)) {
    return false;
  }
  return true;
}

export class HttpControlApiClient implements ControlApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(baseUrl?: string | undefined, fetchFn?: typeof globalThis.fetch | undefined) {
    const rawUrl = baseUrl ?? process.env.CONTROL_API_BASE_URL ?? "http://localhost:3000";
    this.baseUrl = rawUrl.replace(/\/+$/, "");
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async claim(
    workerId: string,
    allowedJobKinds?: readonly JobKind[]
  ): Promise<RenderJob | undefined> {
    const url = `${this.baseUrl}/api/jobs/claim`;
    const body: { workerId: string; allowedJobKinds?: readonly JobKind[] } = {
      workerId,
      ...(allowedJobKinds !== undefined ? { allowedJobKinds } : {})
    };
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      throw new ControlApiClientError(
        `Failed to connect to Control API: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err }
      );
    }

    if (res.status === 204) {
      return undefined;
    }

    if (!res.ok) {
      const detail = await extractSafeErrorDetail(res);
      throw new ControlApiClientError(
        detail
          ? `Control API returned HTTP ${res.status}: ${detail}`
          : `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
        res.status,
        detail !== undefined ? { responseDetail: detail } : undefined
      );
    }

    try {
      const data = (await res.json()) as RenderJob;
      return data;
    } catch (err) {
      throw new ControlApiClientError(
        `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
        res.status,
        { cause: err }
      );
    }
  }

  async start(jobId: JobId | string, leaseToken: LeaseToken | string): Promise<JobMutationResult> {
    return this.postMutation(`/api/jobs/${encodeURIComponent(jobId)}/start`, { leaseToken });
  }

  async heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<JobMutationResult> {
    return this.postMutation(`/api/jobs/${encodeURIComponent(jobId)}/heartbeat`, { leaseToken });
  }

  async complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    payload?: CompleteJobOptions | undefined
  ): Promise<JobMutationResult> {
    const body: Record<string, unknown> = { leaseToken };
    if (payload?.manifestPayload !== undefined) {
      body.manifestPayload = payload.manifestPayload;
    }
    if (payload?.candidatePayload !== undefined) {
      body.candidatePayload = payload.candidatePayload;
    }
    return this.postMutation(`/api/jobs/${encodeURIComponent(jobId)}/complete`, body, true);
  }

  async fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<JobMutationResult> {
    return this.postMutation(`/api/jobs/${encodeURIComponent(jobId)}/fail`, {
      leaseToken,
      errorTrace
    });
  }

  async defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<JobMutationResult> {
    return this.postMutation(`/api/jobs/${encodeURIComponent(jobId)}/defer`, {
      leaseToken,
      reason
    });
  }

  private async postMutation(
    path: string,
    body: Record<string, unknown>,
    handleAdmission507 = false
  ): Promise<JobMutationResult> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      throw new ControlApiClientError(
        `Failed to connect to Control API: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err }
      );
    }

    if (res.status === 200) {
      try {
        const data = (await res.json()) as JobMutationResult;
        return data;
      } catch (err) {
        throw new ControlApiClientError(
          `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
          200,
          { cause: err }
        );
      }
    }

    if (res.status === 409) {
      return { outcome: "superseded" };
    }

    if (res.status === 404) {
      return { outcome: "not_found" };
    }

    if (handleAdmission507 && res.status === 507) {
      let errorData: unknown;
      try {
        const contentType = res.headers?.get?.("content-type");
        if (contentType && contentType.includes("application/json")) {
          errorData = await res.json();
        }
      } catch (err) {
        throw new ControlApiClientError(
          `Control API returned HTTP 507: ${res.statusText || "Insufficient Storage"}`,
          507,
          { cause: err }
        );
      }

      if (isStorageAdmissionErrorPayload(errorData)) {
        const admissionError = new StorageAdmissionError({
          operationClass: errorData.operationClass,
          watermarkState: errorData.watermarkState,
          usedRatio: errorData.usedRatio,
          totalBytes: errorData.totalBytes,
          freeBytes: errorData.freeBytes
        });
        if (typeof errorData.message === "string" && errorData.message.length > 0) {
          admissionError.message = errorData.message;
        }
        throw admissionError;
      }

      throw new ControlApiClientError(
        `Control API returned HTTP 507: ${res.statusText || "Insufficient Storage"} (malformed admission error payload)`,
        507
      );
    }

    const detail = await extractSafeErrorDetail(res);
    throw new ControlApiClientError(
      detail
        ? `Control API returned HTTP ${res.status}: ${detail}`
        : `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
      res.status,
      detail !== undefined ? { responseDetail: detail } : undefined
    );
  }
}

export function createControlApiClient(config?: ControlApiClientConfig): ControlApiClient {
  return new HttpControlApiClient(config?.baseUrl, config?.fetch);
}

export interface DeliveryAssemblyControlApiClient {
  enqueue(
    campaignId: string,
    assemblySpec: AssemblySpec,
    maxRetries?: number
  ): Promise<DeliveryAssemblyJob<AssemblySpec>>;
  claim(workerId: string): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined>;
  start(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  getJob(jobId: JobId | string): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined>;
}

export class HttpDeliveryAssemblyControlApiClient implements DeliveryAssemblyControlApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(
    baseUrl?: string | undefined,
    fetchFn?: typeof globalThis.fetch | undefined,
    timeoutMs?: number | undefined
  ) {
    const rawUrl = baseUrl ?? process.env.CONTROL_API_BASE_URL ?? "http://localhost:3000";
    this.baseUrl = rawUrl.replace(/\/+$/, "");
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = timeoutMs ?? DEFAULT_CONTROL_API_TIMEOUT_MS;
  }

  async enqueue(
    campaignId: string,
    assemblySpec: AssemblySpec,
    maxRetries?: number
  ): Promise<DeliveryAssemblyJob<AssemblySpec>> {
    const url = `${this.baseUrl}/api/delivery-assembly-jobs`;
    const body = {
      campaignId,
      assemblySpec,
      ...(maxRetries !== undefined ? { maxRetries } : {})
    };
    return fetchWithTimeout(
      this.fetchFn,
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      },
      this.timeoutMs,
      async (res) => {
        if (!res.ok) {
          const detail = await extractSafeErrorDetail(res);
          throw new ControlApiClientError(
            detail
              ? `Control API returned HTTP ${res.status}: ${detail}`
              : `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
            res.status,
            detail !== undefined ? { responseDetail: detail } : undefined
          );
        }
        try {
          return (await res.json()) as DeliveryAssemblyJob<AssemblySpec>;
        } catch (err) {
          throw new ControlApiClientError(
            `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
            res.status,
            { cause: err }
          );
        }
      }
    );
  }

  async claim(workerId: string): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined> {
    const url = `${this.baseUrl}/api/delivery-assembly-jobs/claim`;
    const body = { workerId };
    return fetchWithTimeout(
      this.fetchFn,
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      },
      this.timeoutMs,
      async (res) => {
        if (res.status === 204) {
          return undefined;
        }

        if (!res.ok) {
          const detail = await extractSafeErrorDetail(res);
          throw new ControlApiClientError(
            detail
              ? `Control API returned HTTP ${res.status}: ${detail}`
              : `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
            res.status,
            detail !== undefined ? { responseDetail: detail } : undefined
          );
        }

        try {
          return (await res.json()) as DeliveryAssemblyJob<AssemblySpec>;
        } catch (err) {
          throw new ControlApiClientError(
            `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
            res.status,
            { cause: err }
          );
        }
      }
    );
  }

  async start(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    return this.postMutation(`/api/delivery-assembly-jobs/${encodeURIComponent(jobId)}/start`, {
      leaseToken
    });
  }

  async heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    return this.postMutation(`/api/delivery-assembly-jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      leaseToken
    });
  }

  async complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    return this.postMutation(`/api/delivery-assembly-jobs/${encodeURIComponent(jobId)}/complete`, {
      leaseToken
    });
  }

  async fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    return this.postMutation(`/api/delivery-assembly-jobs/${encodeURIComponent(jobId)}/fail`, {
      leaseToken,
      errorTrace
    });
  }

  async defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    return this.postMutation(`/api/delivery-assembly-jobs/${encodeURIComponent(jobId)}/defer`, {
      leaseToken,
      reason
    });
  }

  async getJob(jobId: JobId | string): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined> {
    const url = `${this.baseUrl}/api/delivery-assembly-jobs/${encodeURIComponent(jobId)}`;
    return fetchWithTimeout(
      this.fetchFn,
      url,
      { method: "GET", headers: { Accept: "application/json" } },
      this.timeoutMs,
      async (res) => {
        if (res.status === 404) {
          return undefined;
        }

        if (!res.ok) {
          const detail = await extractSafeErrorDetail(res);
          throw new ControlApiClientError(
            detail
              ? `Control API returned HTTP ${res.status}: ${detail}`
              : `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
            res.status,
            detail !== undefined ? { responseDetail: detail } : undefined
          );
        }

        try {
          return (await res.json()) as DeliveryAssemblyJob<AssemblySpec>;
        } catch (err) {
          throw new ControlApiClientError(
            `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
            res.status,
            { cause: err }
          );
        }
      }
    );
  }

  private async postMutation(
    path: string,
    body: Record<string, unknown>
  ): Promise<DeliveryAssemblyJobMutationResult> {
    const url = `${this.baseUrl}${path}`;
    return fetchWithTimeout(
      this.fetchFn,
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      },
      this.timeoutMs,
      async (res) => {
        if (res.status === 200) {
          try {
            return (await res.json()) as DeliveryAssemblyJobMutationResult;
          } catch (err) {
            throw new ControlApiClientError(
              `Failed to parse response JSON from Control API: ${err instanceof Error ? err.message : String(err)}`,
              200,
              { cause: err }
            );
          }
        }

        if (res.status === 409) {
          return { outcome: "superseded" };
        }

        if (res.status === 404) {
          return { outcome: "not_found" };
        }

        const detail = await extractSafeErrorDetail(res);
        throw new ControlApiClientError(
          detail
            ? `Control API returned HTTP ${res.status}: ${detail}`
            : `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
          res.status,
          detail !== undefined ? { responseDetail: detail } : undefined
        );
      }
    );
  }
}

export function createDeliveryAssemblyControlApiClient(
  config?: ControlApiClientConfig
): DeliveryAssemblyControlApiClient {
  return new HttpDeliveryAssemblyControlApiClient(
    config?.baseUrl,
    config?.fetch,
    config?.timeoutMs
  );
}
