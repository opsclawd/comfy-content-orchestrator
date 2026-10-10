export const MAX_PLANNING_IMAGES = 9;

export interface PlanningModelImage {
  readonly mimeType: string;
  readonly base64Data: string;
}

export interface PlanningModelRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly images?: readonly PlanningModelImage[] | undefined;
  /**
   * Number of active bound reference assets for the scene.
   * When provided, adapter caps attached images to this binding count.
   */
  readonly bindingCount?: number | undefined;
  /**
   * Optional explicit maximum image count cap (at most MAX_PLANNING_IMAGES).
   */
  readonly maxImages?: number | undefined;
  readonly signal?: AbortSignal;
}

export type PlanningModelOutcome =
  | { readonly kind: "success"; readonly rawText: string }
  | { readonly kind: "retryable_failure"; readonly httpStatus?: number; readonly message: string }
  | { readonly kind: "permanent_failure"; readonly httpStatus: number; readonly message: string }
  | { readonly kind: "safety_refusal"; readonly httpStatus: number; readonly message: string };

export interface PlanningModelClientPort {
  readonly providerName: "Anthropic" | "OpenAI";
  readonly imageCapability?: boolean | undefined;
  readonly supportsImages?: boolean | undefined;
  readonly maxImages?: number | undefined;
  complete(request: PlanningModelRequest): Promise<PlanningModelOutcome>;
}
