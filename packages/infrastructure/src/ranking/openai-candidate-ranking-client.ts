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

export interface OpenAiCandidateRankingClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

export class OpenAiCandidateRankingClient implements RankingModelClientPort {
  readonly providerName = "OpenAI" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiCandidateRankingClientOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAiCandidateRankingClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.model = options.model ?? "gpt-5.6-luna";
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async rankBatch(request: RankingModelRequest): Promise<RankingModelOutcome> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`
    };

    const userContent: Array<
      | { readonly type: "text"; readonly text: string }
      | { readonly type: "image_url"; readonly image_url: { readonly url: string } }
    > = [
      {
        type: "text",
        text: [
          `Scene shot description: "${request.shotDescription}"`,
          "Review the following candidate images and rank them from best to worst based on visual quality, relevance to the shot description, and composition.",
          "Respond with ONLY a JSON array of the variant ordinals ordered from best to worst, e.g. [2, 1, 3]."
        ].join("\n")
      }
    ];

    for (const img of request.images) {
      userContent.push({
        type: "text",
        text: `Candidate variant #${img.ordinal}:`
      });
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${img.image.mimeType};base64,${img.image.base64Data}`
        }
      });
    }

    const payload = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert director reviewing candidate keyframes for a scene. Rank the candidate images from best to worst. Return ONLY a JSON array containing candidate ordinals."
        },
        {
          role: "user",
          content: userContent
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
              return parseAndValidateRanking(messageObj.content, request.images, status);
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
