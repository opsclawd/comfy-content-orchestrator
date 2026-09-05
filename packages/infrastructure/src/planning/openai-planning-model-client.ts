import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "@cco/application";
import { classifyError, isSafetyRefusalSignal, type RefusalEvidence } from "@cco/shared";

export interface OpenAiPlanningModelClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function executeWithSignal<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  timeoutMessage: string
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error(timeoutMessage));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error(timeoutMessage));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (res) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

function mapNetworkFailureToOutcome(message: string): PlanningModelOutcome {
  const retryClass = classifyError({ kind: "network", message });
  switch (retryClass) {
    case "transient":
      return { kind: "retryable_failure", message };
    case "non_retryable":
    case "safety_refusal":
      throw new Error(`Unreachable RetryClass for network failure: ${retryClass}`);
  }
}

const KNOWN_REFUSAL_DISCRIMINATORS: ReadonlyArray<{
  readonly field: "type" | "code";
  readonly value: string;
}> = [
  { field: "type", value: "refusal" },
  { field: "code", value: "content_policy_violation" }
];

function detectStructuredRefusalDiscriminator(
  errorType: string,
  errorCode: string
): RefusalEvidence {
  for (const candidate of KNOWN_REFUSAL_DISCRIMINATORS) {
    const actual = candidate.field === "type" ? errorType : errorCode;
    if (actual === candidate.value) {
      return { source: "structured_field", field: `error.${candidate.field}`, value: actual };
    }
  }
  return { source: "none" };
}

export class OpenAiPlanningModelClient implements PlanningModelClientPort {
  readonly providerName = "OpenAI" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiPlanningModelClientOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAiPlanningModelClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.model = options.model ?? "gpt-5.6-sol";
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async complete(request: PlanningModelRequest): Promise<PlanningModelOutcome> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`
    };

    const payload = {
      model: this.model,
      messages: [
        {
          role: "system",
          content: request.systemPrompt
        },
        {
          role: "user",
          content: request.userPrompt
        }
      ]
    };

    const attemptController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      attemptController.abort(new Error(`Provider attempt timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    const onCallerAbort = () => {
      attemptController.abort(request.signal?.reason ?? new Error("Aborted by caller"));
    };
    if (request.signal) {
      if (request.signal.aborted) {
        attemptController.abort(request.signal.reason ?? new Error("Aborted by caller"));
      } else {
        request.signal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    try {
      let response: Response;
      try {
        response = await executeWithSignal(
          () =>
            this.fetchFn(url, {
              method: "POST",
              headers,
              body: JSON.stringify(payload),
              signal: attemptController.signal
            }),
          attemptController.signal,
          `Provider attempt timed out after ${this.timeoutMs}ms`
        );
      } catch (err) {
        const isTimeout =
          timedOut ||
          attemptController.signal.aborted ||
          (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
        const message = isTimeout
          ? timedOut
            ? `Provider attempt timed out after ${this.timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err)
          : err instanceof Error
            ? err.message
            : String(err);
        return mapNetworkFailureToOutcome(message);
      }

      const status = response.status;
      let bodyText = "";

      try {
        bodyText = await executeWithSignal(
          () => response.text(),
          attemptController.signal,
          `Provider attempt timed out reading response body after ${this.timeoutMs}ms`
        );
      } catch (err) {
        const isTimeout =
          timedOut ||
          attemptController.signal.aborted ||
          (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));
        const message = isTimeout
          ? timedOut
            ? `Provider attempt timed out reading response body after ${this.timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err)
          : err instanceof Error
            ? err.message
            : String(err);
        return mapNetworkFailureToOutcome(message);
      }

      let parsedBody: unknown = undefined;
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        // Body is not JSON
      }

      if (status >= 200 && status < 300) {
        if (parsedBody && typeof parsedBody === "object") {
          const bodyObj = parsedBody as Record<string, unknown>;
          if (Array.isArray(bodyObj.choices) && bodyObj.choices.length > 0) {
            const firstChoice = bodyObj.choices[0] as Record<string, unknown>;
            if (firstChoice.finish_reason === "content_filter") {
              return {
                kind: "safety_refusal",
                httpStatus: status,
                message: "Content filtered by safety policy"
              };
            }
            const messageObj = firstChoice.message as Record<string, unknown> | undefined;
            if (messageObj?.refusal) {
              return {
                kind: "safety_refusal",
                httpStatus: status,
                message: String(messageObj.refusal)
              };
            }
            if (typeof messageObj?.content === "string") {
              return { kind: "success", rawText: messageObj.content };
            }
          }
        }
        return { kind: "success", rawText: bodyText };
      }

      const message = this.extractErrorMessage(parsedBody, bodyText, status);

      const { errorType, errorCode } = this.extractErrorFields(parsedBody);
      let refusalEvidence = detectStructuredRefusalDiscriminator(errorType, errorCode);
      if (refusalEvidence.source === "none" && status === 403) {
        const heuristic = isSafetyRefusalSignal({ errorType, errorCode, message });
        if (heuristic.matched) {
          refusalEvidence = {
            source: "message_heuristic",
            scopedToHttpStatus: 403,
            matchedKeyword: heuristic.keyword
          };
        }
      }
      const retryClass = classifyError({
        kind: "http",
        httpStatus: status,
        refusalEvidence,
        message
      });
      switch (retryClass) {
        case "safety_refusal":
          return { kind: "safety_refusal", httpStatus: status, message };
        case "transient":
          return { kind: "retryable_failure", httpStatus: status, message };
        case "non_retryable":
          return { kind: "permanent_failure", httpStatus: status, message };
        default: {
          const exhaustive: never = retryClass;
          throw new Error(`Unreachable RetryClass: ${JSON.stringify(exhaustive)}`);
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (request.signal) {
        request.signal.removeEventListener("abort", onCallerAbort);
      }
    }
  }

  private extractErrorFields(parsedBody: unknown): { errorType: string; errorCode: string } {
    if (parsedBody && typeof parsedBody === "object") {
      const b = parsedBody as Record<string, unknown>;
      const errorObj = (b.error && typeof b.error === "object" ? b.error : {}) as Record<
        string,
        unknown
      >;
      const errorType =
        typeof errorObj.type === "string"
          ? errorObj.type
          : typeof b.type === "string"
            ? b.type
            : "";
      const errorCode =
        typeof errorObj.code === "string"
          ? errorObj.code
          : typeof b.code === "string"
            ? b.code
            : "";
      return { errorType, errorCode };
    }
    return { errorType: "", errorCode: "" };
  }

  private extractErrorMessage(parsedBody: unknown, bodyText: string, status: number): string {
    if (parsedBody && typeof parsedBody === "object") {
      const b = parsedBody as Record<string, unknown>;
      if (b.error && typeof b.error === "object") {
        const err = b.error as Record<string, unknown>;
        if (typeof err.message === "string") return err.message;
      }
      if (typeof b.message === "string") return b.message;
    }
    return bodyText || `HTTP ${status}`;
  }
}
