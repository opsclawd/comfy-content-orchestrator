export interface ResolvedCandidateImage {
  readonly base64Data: string;
  readonly mimeType: string;
}

export type RankingModelOutcome =
  | { readonly kind: "success"; readonly rankedOrdinals: readonly number[] }
  | { readonly kind: "retryable_failure"; readonly httpStatus?: number; readonly message: string }
  | { readonly kind: "permanent_failure"; readonly httpStatus: number; readonly message: string }
  | { readonly kind: "safety_refusal"; readonly httpStatus: number; readonly message: string };

export interface RankingModelRequest {
  readonly shotDescription: string;
  readonly images: readonly { readonly ordinal: number; readonly image: ResolvedCandidateImage }[];
  readonly signal?: AbortSignal;
}

export interface RankingModelClientPort {
  readonly providerName: "Google" | "OpenAI";
  rankBatch(request: RankingModelRequest): Promise<RankingModelOutcome>;
}
