import { StorageAdmissionError, type JobMutationResult } from "@cco/application";
import {
  STORAGE_OPERATION_CLASSES,
  STORAGE_WATERMARK_STATES,
  type StorageOperationClass,
  type StorageWatermarkState
} from "@cco/contracts";
import type { JobId, LeaseToken, RenderJob } from "@cco/domain";

export interface CompleteJobOptions {
  readonly manifestPayload?: Readonly<Record<string, unknown>> | undefined;
  readonly candidatePayload?: Readonly<Record<string, unknown>> | undefined;
}

export interface ControlApiClient {
  claim(workerId: string): Promise<RenderJob | undefined>;
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
}

export class ControlApiClientError extends Error {
  override readonly name = "ControlApiClientError";
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number | undefined, options?: ErrorOptions) {
    super(message, options);
    this.statusCode = statusCode;
  }
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

  async claim(workerId: string): Promise<RenderJob | undefined> {
    const url = `${this.baseUrl}/api/jobs/claim`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ workerId })
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
      throw new ControlApiClientError(
        `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
        res.status
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
        errorData = await res.json();
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

    throw new ControlApiClientError(
      `Control API returned HTTP ${res.status}: ${res.statusText || "Error"}`,
      res.status
    );
  }
}

export function createControlApiClient(config?: ControlApiClientConfig): ControlApiClient {
  return new HttpControlApiClient(config?.baseUrl, config?.fetch);
}
