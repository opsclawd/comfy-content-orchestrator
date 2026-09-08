import type { StoryboardCandidate } from "@cco/domain";
import type {
  CandidateRankerPort,
  CandidateRankingContext,
  RankingModelClientPort,
  RankingModelOutcome,
  RankingModelRequest,
  ResolvedCandidateImage
} from "../ports/index.js";

export interface VisualQaAuthorizationPolicy {
  readonly allowCloudVisualQA: boolean;
  readonly allowedProviders: ReadonlySet<string>;
  readonly sensitiveDataMasking: boolean;
}

export function decodeVisualQaAuthorizationPolicy(
  raw?: Record<string, unknown> | null
): VisualQaAuthorizationPolicy {
  if (!raw || typeof raw !== "object") {
    return {
      allowCloudVisualQA: false,
      allowedProviders: new Set<string>(),
      sensitiveDataMasking: true
    };
  }

  const allowCloudVisualQA = raw.allowCloudVisualQA === true;

  let allowedProviders: Set<string>;
  if (Array.isArray(raw.allowedProviders)) {
    allowedProviders = new Set<string>(
      raw.allowedProviders.filter((p): p is string => typeof p === "string")
    );
  } else {
    allowedProviders = new Set<string>();
  }

  const sensitiveDataMasking = raw.sensitiveDataMasking !== false;

  return {
    allowCloudVisualQA,
    allowedProviders,
    sensitiveDataMasking
  };
}

export function decideRankingFallback(
  outcome: RankingModelOutcome,
  attemptNumber: 1 | 2
): "retry_same" | "fallback" | "terminal_safety_refusal" | "terminal_success" {
  if (outcome.kind === "success") {
    return "terminal_success";
  }
  if (outcome.kind === "safety_refusal") {
    return "terminal_safety_refusal";
  }
  if (outcome.kind === "retryable_failure") {
    return attemptNumber === 1 ? "retry_same" : "fallback";
  }
  if (outcome.kind === "permanent_failure") {
    return "fallback";
  }
  return "fallback";
}

export const DEFAULT_OVERALL_RANKING_TIMEOUT_MS = 60_000;

export interface CandidateRankingOrchestratorDeps {
  readonly primaryClient: RankingModelClientPort;
  readonly fallbackClient: RankingModelClientPort;
  readonly policy: VisualQaAuthorizationPolicy | (() => VisualQaAuthorizationPolicy);
  readonly overallTimeoutMs?: number;
}

export class CandidateRankingOrchestrator implements CandidateRankerPort<
  StoryboardCandidate,
  CandidateRankingContext
> {
  constructor(private readonly deps: CandidateRankingOrchestratorDeps) {}

  async rank(
    candidates: readonly StoryboardCandidate[],
    context: CandidateRankingContext
  ): Promise<readonly StoryboardCandidate[]> {
    try {
      const policy = typeof this.deps.policy === "function" ? this.deps.policy() : this.deps.policy;

      if (!policy.allowCloudVisualQA || policy.sensitiveDataMasking) {
        return candidates;
      }

      const overallTimeoutMs = this.deps.overallTimeoutMs ?? DEFAULT_OVERALL_RANKING_TIMEOUT_MS;
      const overallController = new AbortController();
      const timeoutId = setTimeout(() => {
        overallController.abort(new Error(`Ranking deadline of ${overallTimeoutMs}ms exceeded`));
      }, overallTimeoutMs);

      try {
        if (overallController.signal.aborted) {
          return candidates;
        }

        // Resolve images in parallel; tolerate individual candidate resolution failures
        const resolved = await Promise.all(
          candidates.map(async (c) => {
            try {
              if (overallController.signal.aborted) {
                return { candidate: c, image: undefined };
              }
              const image = await context.resolveImageData(c, overallController.signal);
              return { candidate: c, image };
            } catch {
              return { candidate: c, image: undefined };
            }
          })
        );

        if (overallController.signal.aborted) {
          return candidates;
        }

        const withImages = resolved.filter(
          (r): r is { candidate: StoryboardCandidate; image: ResolvedCandidateImage } =>
            r.image !== undefined
        );

        if (withImages.length < 2) {
          return candidates; // Nothing meaningful to rank
        }

        const images = withImages.map(({ candidate, image }) => ({
          ordinal: candidate.variantOrdinal,
          image
        }));

        const rankedOrdinals = await this.attemptProviders(
          images,
          context,
          policy,
          overallController.signal
        );
        if (rankedOrdinals === undefined) {
          return candidates; // All providers failed or not authorized
        }

        return this.reorderByOrdinals(candidates, rankedOrdinals);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // Defense in depth: rank() must NEVER throw.
      return candidates;
    }
  }

  private async attemptProviders(
    images: readonly { readonly ordinal: number; readonly image: ResolvedCandidateImage }[],
    context: CandidateRankingContext,
    policy: VisualQaAuthorizationPolicy,
    signal: AbortSignal
  ): Promise<readonly number[] | undefined> {
    const request: RankingModelRequest = {
      shotDescription: context.shotDescription,
      images,
      signal
    };

    // 1. Primary provider attempt (Gemini)
    if (policy.allowedProviders.has(this.deps.primaryClient.providerName)) {
      if (!signal.aborted) {
        const primaryResult = await this.executeClientAttempts(this.deps.primaryClient, request);
        if (primaryResult.kind === "success") {
          return primaryResult.rankedOrdinals;
        }
        if (primaryResult.kind === "terminal_safety_refusal") {
          // Safety refusals are terminal; do not fall back cross-provider to launder refusal
          return undefined;
        }
      }
    }

    // 2. Fallback provider attempt (OpenAI)
    if (policy.allowedProviders.has(this.deps.fallbackClient.providerName)) {
      if (!signal.aborted) {
        const fallbackResult = await this.executeClientAttempts(this.deps.fallbackClient, request);
        if (fallbackResult.kind === "success") {
          return fallbackResult.rankedOrdinals;
        }
        if (fallbackResult.kind === "terminal_safety_refusal") {
          return undefined;
        }
      }
    }

    return undefined;
  }

  private async executeClientAttempts(
    client: RankingModelClientPort,
    request: RankingModelRequest
  ): Promise<
    | { readonly kind: "success"; readonly rankedOrdinals: readonly number[] }
    | { readonly kind: "terminal_safety_refusal" }
    | { readonly kind: "failed" }
  > {
    try {
      const outcome1 = await client.rankBatch(request);
      const decision1 = decideRankingFallback(outcome1, 1);

      if (decision1 === "terminal_success") {
        return {
          kind: "success",
          rankedOrdinals: (
            outcome1 as { readonly kind: "success"; readonly rankedOrdinals: readonly number[] }
          ).rankedOrdinals
        };
      }

      if (decision1 === "terminal_safety_refusal") {
        return { kind: "terminal_safety_refusal" };
      }

      if (decision1 === "retry_same") {
        if (request.signal?.aborted) {
          return { kind: "failed" };
        }

        const outcome2 = await client.rankBatch(request);
        const decision2 = decideRankingFallback(outcome2, 2);

        if (decision2 === "terminal_success") {
          return {
            kind: "success",
            rankedOrdinals: (
              outcome2 as { readonly kind: "success"; readonly rankedOrdinals: readonly number[] }
            ).rankedOrdinals
          };
        }

        if (decision2 === "terminal_safety_refusal") {
          return { kind: "terminal_safety_refusal" };
        }

        return { kind: "failed" };
      }

      return { kind: "failed" };
    } catch {
      return { kind: "failed" };
    }
  }

  private reorderByOrdinals(
    candidates: readonly StoryboardCandidate[],
    rankedOrdinals: readonly number[]
  ): readonly StoryboardCandidate[] {
    const candidateMap = new Map<number, StoryboardCandidate>();
    for (const c of candidates) {
      candidateMap.set(c.variantOrdinal, c);
    }

    const reordered: StoryboardCandidate[] = [];
    const seenOrdinals = new Set<number>();

    for (const ordinal of rankedOrdinals) {
      const c = candidateMap.get(ordinal);
      if (c !== undefined && !seenOrdinals.has(ordinal)) {
        reordered.push(c);
        seenOrdinals.add(ordinal);
      }
    }

    // Append any unmentioned candidates at the end in their original relative order
    for (const c of candidates) {
      if (!seenOrdinals.has(c.variantOrdinal)) {
        reordered.push(c);
      }
    }

    return reordered;
  }
}
