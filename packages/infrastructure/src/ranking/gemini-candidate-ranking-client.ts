import type {
  RankingModelClientPort,
  RankingModelOutcome,
  RankingModelRequest
} from "@cco/application";
import {
  classifyHttpErrorOutcome,
  executeWithSignal,
  mapNetworkFailureToOutcome,
  parseAndValidateRanking
} from "./ranking-client-helpers.js";

export interface GeminiCandidateRankingClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

export class GeminiCandidateRankingClient implements RankingModelClientPort {
  readonly providerName = "Google" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiCandidateRankingClientOptions) {
    if (!options.apiKey) {
      throw new Error("GeminiCandidateRankingClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com";
    this.model = options.model ?? "gemini-3.8-flash";
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async rankBatch(request: RankingModelRequest): Promise<RankingModelOutcome> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const headers = {
      "content-type": "application/json",
      "x-goog-api-key": this.apiKey
    };

    const parts: Array<
      | { readonly text: string }
      | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
    > = [
      {
        text: [
          "You are an expert director reviewing candidate keyframes for a scene.",
          `Scene shot description: "${request.shotDescription}"`,
          "Review the following candidate images and rank them from best to worst based on visual quality, relevance to the shot description, and composition.",
          "Respond with ONLY a JSON array of the variant ordinals ordered from best to worst, e.g. [2, 1, 3]."
        ].join("\n")
      }
    ];

    for (const img of request.images) {
      parts.push({
        text: `Candidate variant #${img.ordinal}:`
      });
      parts.push({
        inlineData: {
          mimeType: img.image.mimeType,
          data: img.image.base64Data
        }
      });
    }

    const payload = {
      contents: [
        {
          role: "user",
          parts
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
        // Not JSON
      }

      if (status >= 200 && status < 300) {
        if (parsedBody && typeof parsedBody === "object") {
          const bodyObj = parsedBody as Record<string, unknown>;

          if (bodyObj.promptFeedback && typeof bodyObj.promptFeedback === "object") {
            const pf = bodyObj.promptFeedback as Record<string, unknown>;
            if (pf.blockReason === "SAFETY") {
              return {
                kind: "safety_refusal",
                httpStatus: status,
                message: "Prompt blocked by safety policy"
              };
            }
          }

          if (Array.isArray(bodyObj.candidates) && bodyObj.candidates.length > 0) {
            const firstCandidate = bodyObj.candidates[0] as Record<string, unknown>;
            if (
              firstCandidate.finishReason === "SAFETY" ||
              firstCandidate.finishReason === "RECITATION"
            ) {
              return {
                kind: "safety_refusal",
                httpStatus: status,
                message: `Model generation blocked due to ${firstCandidate.finishReason}`
              };
            }

            const contentObj = firstCandidate.content as Record<string, unknown> | undefined;
            if (contentObj && Array.isArray(contentObj.parts)) {
              const textParts = contentObj.parts
                .filter(
                  (part): part is { text: string } =>
                    typeof (part as Record<string, unknown>).text === "string"
                )
                .map((part) => part.text)
                .join("");
              return parseAndValidateRanking(textParts, request.images, status);
            }
          }
        }
        return parseAndValidateRanking(bodyText, request.images, status);
      }

      return classifyHttpErrorOutcome(status, parsedBody, bodyText);
    } finally {
      clearTimeout(timeoutId);
      if (request.signal) {
        request.signal.removeEventListener("abort", onCallerAbort);
      }
    }
  }
}
