import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "@cco/application";

export interface OpenAiPlanningModelClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAiPlanningModelClient implements PlanningModelClientPort {
  readonly providerName = "OpenAI" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: OpenAiPlanningModelClientOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAiPlanningModelClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com";
    this.model = options.model ?? "gpt-5.6-sol";
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
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

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
    } catch (err) {
      return {
        kind: "retryable_failure",
        message: err instanceof Error ? err.message : String(err)
      };
    }

    const status = response.status;
    let bodyText = "";
    let parsedBody: unknown = undefined;

    try {
      bodyText = await response.text();
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

    if (status === 429 || status >= 500) {
      return {
        kind: "retryable_failure",
        httpStatus: status,
        message
      };
    }

    if (status === 403) {
      if (this.hasRefusalSignal(parsedBody, message)) {
        return {
          kind: "safety_refusal",
          httpStatus: 403,
          message
        };
      }
      return {
        kind: "permanent_failure",
        httpStatus: 403,
        message
      };
    }

    return {
      kind: "permanent_failure",
      httpStatus: status,
      message
    };
  }

  private hasRefusalSignal(parsedBody: unknown, message: string): boolean {
    if (parsedBody && typeof parsedBody === "object") {
      const b = parsedBody as Record<string, unknown>;
      const errorObj = (b.error && typeof b.error === "object" ? b.error : b) as Record<
        string,
        unknown
      >;
      const errorCode = String(errorObj.code ?? "").toLowerCase();
      const errorType = String(errorObj.type ?? "").toLowerCase();
      const msg = (String(errorObj.message ?? "") + " " + message).toLowerCase();

      const signals = [
        "safety",
        "policy",
        "refusal",
        "violat",
        "content_filter",
        "content_policy_violation"
      ];
      return signals.some((s) => errorCode.includes(s) || errorType.includes(s) || msg.includes(s));
    }
    const lower = message.toLowerCase();
    return ["safety", "policy", "refusal", "violat", "content_filter"].some((s) =>
      lower.includes(s)
    );
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
