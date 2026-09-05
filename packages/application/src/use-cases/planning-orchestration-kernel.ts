import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import {
  PlanningNotAuthorizedError,
  PlanningSafetyRefusalError,
  PlanningProviderExhaustedError,
  type PlanningProviderAttempt
} from "./plan-scene-configuration-errors.js";

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

export const DEFAULT_OVERALL_PLANNING_TIMEOUT_MS = 60_000;

export interface PlanningOrchestrationDeps {
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
  readonly overallTimeoutMs?: number | undefined;
}

export interface PlanningWorkflowPrepared<T> {
  readonly buildRequest: (correctiveFeedback?: string) => PlanningModelRequest;
  readonly parseAndValidate: (rawText: string) => T;
}

export interface PlanningOrchestrationInput<T> {
  readonly policy: PlanningAuthorizationPolicy;
  readonly prepare?: (signal: AbortSignal) => Promise<PlanningWorkflowPrepared<T>>;
  readonly buildRequest?: (correctiveFeedback?: string) => PlanningModelRequest;
  readonly parseAndValidate?: (rawText: string) => T;
  readonly overallTimeoutMs?: number | undefined;
}

export class PlanningOrchestrationKernel {
  constructor(private readonly deps: PlanningOrchestrationDeps) {}

  async run<T>(input: PlanningOrchestrationInput<T>): Promise<T> {
    const overallTimeoutMs =
      input.overallTimeoutMs ?? this.deps.overallTimeoutMs ?? DEFAULT_OVERALL_PLANNING_TIMEOUT_MS;

    const overallController = new AbortController();
    let overallTimedOut = false;
    const timeoutId = setTimeout(() => {
      overallTimedOut = true;
      overallController.abort(
        new Error(`Overall planning deadline of ${overallTimeoutMs}ms exceeded`)
      );
    }, overallTimeoutMs);

    try {
      // 1. Policy check: fail-closed
      if (!input.policy.allowCloudPlanning) {
        throw new PlanningNotAuthorizedError("allowCloudPlanning disabled");
      }

      // 2. Verify primary provider is authorized before any network call
      if (!input.policy.allowedProviders.has(this.deps.primaryClient.providerName)) {
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

      // 3. Preparation step (e.g. resolve reference assets) inside deadline scope
      let buildRequest: (correctiveFeedback?: string) => PlanningModelRequest;
      let parseAndValidate: (rawText: string) => T;

      if (input.prepare !== undefined) {
        const prepared = await input.prepare(overallController.signal);
        buildRequest = prepared.buildRequest;
        parseAndValidate = prepared.parseAndValidate;
      } else if (input.buildRequest !== undefined && input.parseAndValidate !== undefined) {
        buildRequest = input.buildRequest;
        parseAndValidate = input.parseAndValidate;
      } else {
        throw new Error(
          "PlanningOrchestrationKernel requires either prepare or buildRequest/parseAndValidate"
        );
      }

      const promptBuilder = (correctiveFeedback?: string): PlanningModelRequest => {
        const baseRequest = buildRequest(correctiveFeedback);
        return {
          ...baseRequest,
          signal: overallController.signal
        };
      };

      const attempts: PlanningProviderAttempt[] = [];

      if (overallTimedOut || overallController.signal.aborted) {
        throw new PlanningProviderExhaustedError("All planning providers exhausted", [
          {
            provider: this.deps.primaryClient.providerName,
            failureReason: `Overall planning deadline of ${overallTimeoutMs}ms exceeded`
          }
        ]);
      }

      // 3. Primary Provider (Anthropic)
      const primaryResult = await this.executeProviderWorkflow(
        this.deps.primaryClient,
        promptBuilder,
        parseAndValidate,
        attempts,
        overallController.signal,
        overallTimeoutMs
      );

      if (primaryResult !== undefined) {
        return primaryResult;
      }

      if (overallTimedOut || overallController.signal.aborted) {
        throw new PlanningProviderExhaustedError("All planning providers exhausted", attempts);
      }

      // 4. Fallback Provider authorization check before calling fallback client
      if (!input.policy.allowedProviders.has(this.deps.fallbackClient.providerName)) {
        throw new PlanningNotAuthorizedError(
          `${this.deps.fallbackClient.providerName} not in allowedProviders`
        );
      }

      // 5. Fallback Provider (OpenAI)
      const fallbackResult = await this.executeProviderWorkflow(
        this.deps.fallbackClient,
        promptBuilder,
        parseAndValidate,
        attempts,
        overallController.signal,
        overallTimeoutMs
      );

      if (fallbackResult !== undefined) {
        return fallbackResult;
      }

      // 6. Exhausted
      throw new PlanningProviderExhaustedError("All planning providers exhausted", attempts);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async executeProviderWorkflow<T>(
    client: PlanningModelClientPort,
    promptBuilder: (correctiveFeedback?: string) => PlanningModelRequest,
    parseAndValidate: (rawText: string) => T,
    attempts: PlanningProviderAttempt[],
    signal: AbortSignal,
    overallTimeoutMs: number
  ): Promise<T | undefined> {
    const providerName = client.providerName;

    const handleSuccessfulTransport = async (rawText: string): Promise<T | undefined> => {
      let rejectionReason: string | undefined;

      try {
        return parseAndValidate(rawText);
      } catch (err) {
        rejectionReason = err instanceof Error ? err.message : String(err);
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
        try {
          return parseAndValidate(correctiveOutcome.rawText);
        } catch (err2) {
          attempts.push({
            provider: providerName,
            failureReason: err2 instanceof Error ? err2.message : String(err2)
          });
          return undefined;
        }
      } else {
        attempts.push({ provider: providerName, failureReason: correctiveOutcome.message });
        return undefined;
      }
    };

    if (signal.aborted) {
      attempts.push({
        provider: providerName,
        failureReason: `Overall planning deadline of ${overallTimeoutMs}ms exceeded`
      });
      return undefined;
    }

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

      if (signal.aborted) {
        attempts.push({
          provider: providerName,
          failureReason: `Overall planning deadline of ${overallTimeoutMs}ms exceeded`
        });
        return undefined;
      }

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
