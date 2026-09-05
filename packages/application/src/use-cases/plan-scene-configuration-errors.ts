export class PlanningNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningNotAuthorizedError";
  }
}

export interface PlanningSafetyRefusalOptions {
  readonly provider?: "Anthropic" | "OpenAI";
  readonly httpStatus?: number;
}

export class PlanningSafetyRefusalError extends Error {
  readonly provider: "Anthropic" | "OpenAI";
  readonly httpStatus: number;

  constructor(message: string, options?: PlanningSafetyRefusalOptions) {
    super(message);
    this.name = "PlanningSafetyRefusalError";
    this.provider = options?.provider ?? "Anthropic";
    this.httpStatus = options?.httpStatus ?? 403;
  }
}

export interface PlanningProviderAttempt {
  readonly provider: "Anthropic" | "OpenAI";
  readonly failureReason: string;
}

export class PlanningProviderExhaustedError extends Error {
  readonly attempts: readonly PlanningProviderAttempt[];

  constructor(message: string, attempts: readonly PlanningProviderAttempt[]) {
    super(message);
    this.name = "PlanningProviderExhaustedError";
    this.attempts = Object.freeze([...attempts]);
  }
}
