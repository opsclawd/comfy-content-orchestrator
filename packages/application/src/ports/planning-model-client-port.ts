export interface PlanningModelRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly signal?: AbortSignal;
}

export type PlanningModelOutcome =
  | { readonly kind: "success"; readonly rawText: string }
  | { readonly kind: "retryable_failure"; readonly httpStatus?: number; readonly message: string }
  | { readonly kind: "permanent_failure"; readonly httpStatus: number; readonly message: string }
  | { readonly kind: "safety_refusal"; readonly httpStatus: number; readonly message: string };

export interface PlanningModelClientPort {
  readonly providerName: "Anthropic" | "OpenAI";
  complete(request: PlanningModelRequest): Promise<PlanningModelOutcome>;
}
