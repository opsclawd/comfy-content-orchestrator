import type { ReferenceAsset, ReferenceAssetId, SceneConfiguration } from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
import {
  PlanningNotAuthorizedError,
  PlanningSafetyRefusalError,
  PlanningProviderExhaustedError,
  type PlanningProviderAttempt
} from "./plan-scene-configuration-errors.js";
import { buildPlanningPrompt, type CreativeBrief } from "./planning-prompt.js";
import { parsePlanningResponse } from "./planning-response-parser.js";
import { validateSceneConfiguration } from "./validate-scene-configuration.js";

export interface PlanningAuthorizationPolicy {
  readonly allowCloudPlanning: boolean;
  readonly allowedProviders: ReadonlySet<string>;
  readonly sensitiveDataMasking: boolean;
}

export function decodePlanningAuthorizationPolicy(
  raw?: Record<string, unknown> | null
): PlanningAuthorizationPolicy {
  if (!raw || typeof raw !== "object") {
    return {
      allowCloudPlanning: false,
      allowedProviders: new Set<string>(),
      sensitiveDataMasking: true
    };
  }

  const allowCloudPlanning = raw.allowCloudPlanning === true;

  let allowedProviders: Set<string>;
  if (Array.isArray(raw.allowedProviders)) {
    allowedProviders = new Set<string>(
      raw.allowedProviders.filter((p): p is string => typeof p === "string")
    );
  } else {
    allowedProviders = new Set<string>();
  }

  // sensitiveDataMasking defaults to true unless explicitly boolean false
  const sensitiveDataMasking = raw.sensitiveDataMasking !== false;

  return {
    allowCloudPlanning,
    allowedProviders,
    sensitiveDataMasking
  };
}

export function decidePlanningFallback(
  outcome: PlanningModelOutcome,
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

export interface PlanSceneConfigurationDeps {
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
}

export interface PlanSceneConfigurationInput {
  readonly brief: CreativeBrief;
  readonly clientId: string;
  readonly candidateReferenceAssetIds: readonly ReferenceAssetId[];
  readonly externalProcessingPolicy: Record<string, unknown>;
  readonly maxDurationMs?: number;
}

export class PlanSceneConfigurationUseCase {
  constructor(private readonly deps: PlanSceneConfigurationDeps) {}

  async execute(input: PlanSceneConfigurationInput): Promise<SceneConfiguration> {
    // 1. Decode policy; fail-closed
    const policy = decodePlanningAuthorizationPolicy(input.externalProcessingPolicy);
    if (!policy.allowCloudPlanning) {
      throw new PlanningNotAuthorizedError("allowCloudPlanning disabled");
    }

    // 2. Verify primary provider is authorized before any network call
    if (!policy.allowedProviders.has(this.deps.primaryClient.providerName)) {
      throw new PlanningNotAuthorizedError(
        `${this.deps.primaryClient.providerName} not in allowedProviders`
      );
    }

    // Enforce required provider ordering
    if (this.deps.primaryClient.providerName !== "Anthropic") {
      throw new PlanningNotAuthorizedError(
        `Primary planning provider must be Anthropic, got ${this.deps.primaryClient.providerName}`
      );
    }
    if (this.deps.fallbackClient.providerName !== "OpenAI") {
      throw new PlanningNotAuthorizedError(
        `Fallback planning provider must be OpenAI, got ${this.deps.fallbackClient.providerName}`
      );
    }

    // 3. Resolve reference assets (scoped to client)
    const resolvedReferenceAssets = await this.deps.referenceAssetRepository.findByIds(
      input.clientId,
      input.candidateReferenceAssetIds
    );

    const promptBuilder = (correctiveFeedback?: string): PlanningModelRequest =>
      buildPlanningPrompt({
        brief: input.brief,
        resolvedReferenceAssets,
        maskSensitiveData: policy.sensitiveDataMasking,
        maxDurationMs: input.maxDurationMs,
        correctiveFeedback
      });

    const attempts: PlanningProviderAttempt[] = [];

    // 4. Primary Provider (Anthropic)
    const primaryResult = await this.executeProviderWorkflow(
      this.deps.primaryClient,
      promptBuilder,
      resolvedReferenceAssets,
      input.maxDurationMs,
      attempts
    );

    if (primaryResult) {
      return primaryResult;
    }

    // 5. Fallback Provider authorization check before calling fallback client
    if (!policy.allowedProviders.has(this.deps.fallbackClient.providerName)) {
      throw new PlanningNotAuthorizedError(
        `${this.deps.fallbackClient.providerName} not in allowedProviders`
      );
    }

    // 6. Fallback Provider (OpenAI)
    const fallbackResult = await this.executeProviderWorkflow(
      this.deps.fallbackClient,
      promptBuilder,
      resolvedReferenceAssets,
      input.maxDurationMs,
      attempts
    );

    if (fallbackResult) {
      return fallbackResult;
    }

    // 7. Exhausted
    throw new PlanningProviderExhaustedError("All planning providers exhausted", attempts);
  }

  private async executeProviderWorkflow(
    client: PlanningModelClientPort,
    promptBuilder: (correctiveFeedback?: string) => PlanningModelRequest,
    resolvedReferenceAssets: readonly ReferenceAsset[],
    maxDurationMs: number | undefined,
    attempts: PlanningProviderAttempt[]
  ): Promise<SceneConfiguration | undefined> {
    const providerName = client.providerName;

    const handleSuccessfulTransport = async (
      rawText: string
    ): Promise<SceneConfiguration | undefined> => {
      const parsed = parsePlanningResponse(rawText);
      let rejectionReason: string | undefined;

      if (parsed.ok) {
        try {
          return validateSceneConfiguration(parsed.value, resolvedReferenceAssets, maxDurationMs);
        } catch (err) {
          rejectionReason = err instanceof Error ? err.message : String(err);
        }
      } else {
        rejectionReason = parsed.reason;
      }

      // One corrective retry against the same client with feedback
      attempts.push({ provider: providerName, failureReason: rejectionReason });
      const correctiveRequest = promptBuilder(rejectionReason);
      const correctiveOutcome = await client.complete(correctiveRequest);

      if (correctiveOutcome.kind === "safety_refusal") {
        throw new PlanningSafetyRefusalError(correctiveOutcome.message, {
          provider: providerName,
          httpStatus: correctiveOutcome.httpStatus
        });
      }

      if (correctiveOutcome.kind === "success") {
        const parsed2 = parsePlanningResponse(correctiveOutcome.rawText);
        if (parsed2.ok) {
          try {
            return validateSceneConfiguration(
              parsed2.value,
              resolvedReferenceAssets,
              maxDurationMs
            );
          } catch (err2) {
            attempts.push({
              provider: providerName,
              failureReason: err2 instanceof Error ? err2.message : String(err2)
            });
            return undefined;
          }
        } else {
          attempts.push({ provider: providerName, failureReason: parsed2.reason });
          return undefined;
        }
      } else {
        attempts.push({ provider: providerName, failureReason: correctiveOutcome.message });
        return undefined;
      }
    };

    const initialRequest = promptBuilder();
    const firstOutcome = await client.complete(initialRequest);
    const firstDecision = decidePlanningFallback(firstOutcome, 1);

    if (firstDecision === "terminal_safety_refusal") {
      throw new PlanningSafetyRefusalError(
        firstOutcome.kind === "safety_refusal" ? firstOutcome.message : "Safety refusal",
        {
          provider: providerName,
          httpStatus: firstOutcome.kind === "safety_refusal" ? firstOutcome.httpStatus : 403
        }
      );
    }

    if (firstDecision === "terminal_success") {
      const rawText = (firstOutcome as { readonly kind: "success"; readonly rawText: string })
        .rawText;
      return await handleSuccessfulTransport(rawText);
    }

    if (firstDecision === "retry_same") {
      attempts.push({
        provider: providerName,
        failureReason: (firstOutcome as { readonly message: string }).message
      });

      // Second attempt on same client
      const secondOutcome = await client.complete(initialRequest);
      const secondDecision = decidePlanningFallback(secondOutcome, 2);

      if (secondDecision === "terminal_safety_refusal") {
        throw new PlanningSafetyRefusalError(
          secondOutcome.kind === "safety_refusal" ? secondOutcome.message : "Safety refusal",
          {
            provider: providerName,
            httpStatus: secondOutcome.kind === "safety_refusal" ? secondOutcome.httpStatus : 403
          }
        );
      }

      if (secondDecision === "terminal_success") {
        const rawText = (secondOutcome as { readonly kind: "success"; readonly rawText: string })
          .rawText;
        return await handleSuccessfulTransport(rawText);
      } else {
        attempts.push({
          provider: providerName,
          failureReason: (secondOutcome as { readonly message: string }).message
        });
        return undefined;
      }
    }

    // firstDecision === "fallback" (e.g. permanent_failure on attempt 1)
    attempts.push({
      provider: providerName,
      failureReason: (firstOutcome as { readonly message: string }).message
    });
    return undefined;
  }
}
