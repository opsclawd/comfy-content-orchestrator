import type { CampaignId, ReferenceAssetId, SceneConfiguration } from "@cco/domain";
import type { PlanningModelClientPort } from "../ports/planning-model-client-port.js";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
import { buildPlanningPrompt, type CreativeBrief } from "./planning-prompt.js";
import { parsePlanningResponse } from "./planning-response-parser.js";
import {
  PlanningOrchestrationKernel,
  decodePlanningAuthorizationPolicy,
  decidePlanningFallback,
  DEFAULT_OVERALL_PLANNING_TIMEOUT_MS,
  type PlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import {
  SceneConfigurationValidationError,
  validateSceneConfiguration
} from "./validate-scene-configuration.js";

export {
  decodePlanningAuthorizationPolicy,
  decidePlanningFallback,
  DEFAULT_OVERALL_PLANNING_TIMEOUT_MS,
  type PlanningAuthorizationPolicy
};

export interface PlanSceneConfigurationDeps {
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
  readonly overallTimeoutMs?: number | undefined;
  readonly kernel?: PlanningOrchestrationKernel | undefined;
}

export interface PlanSceneConfigurationInput {
  readonly brief: CreativeBrief;
  readonly campaignId: CampaignId | string;
  readonly clientId: string;
  readonly candidateReferenceAssetIds: readonly ReferenceAssetId[];
  readonly externalProcessingPolicy: Record<string, unknown>;
  readonly maxDurationMs?: number | undefined;
  readonly targetDurationMs?: number | undefined;
  readonly overallTimeoutMs?: number | undefined;
}

export class PlanSceneConfigurationUseCase {
  private readonly kernel: PlanningOrchestrationKernel;

  constructor(private readonly deps: PlanSceneConfigurationDeps) {
    this.kernel =
      deps.kernel ??
      new PlanningOrchestrationKernel({
        primaryClient: deps.primaryClient,
        fallbackClient: deps.fallbackClient,
        ...(deps.overallTimeoutMs !== undefined ? { overallTimeoutMs: deps.overallTimeoutMs } : {})
      });
  }

  async execute(input: PlanSceneConfigurationInput): Promise<SceneConfiguration> {
    if (
      input.targetDurationMs !== undefined &&
      input.maxDurationMs !== undefined &&
      input.targetDurationMs > input.maxDurationMs
    ) {
      throw new SceneConfigurationValidationError(
        `targetDurationMs ${input.targetDurationMs} cannot exceed maxDurationMs ${input.maxDurationMs}`
      );
    }

    const policy = decodePlanningAuthorizationPolicy(input.externalProcessingPolicy);

    return this.kernel.run({
      policy,
      overallTimeoutMs: input.overallTimeoutMs,
      prepare: async (_signal: AbortSignal) => {
        const resolvedReferenceAssets = await this.deps.referenceAssetRepository.findByIds(
          input.clientId,
          input.candidateReferenceAssetIds
        );

        return {
          buildRequest: (correctiveFeedback?: string) =>
            buildPlanningPrompt({
              brief: input.brief,
              campaignId: input.campaignId,
              resolvedReferenceAssets,
              maskSensitiveData: policy.sensitiveDataMasking,
              maxDurationMs: input.maxDurationMs,
              targetDurationMs: input.targetDurationMs,
              correctiveFeedback
            }),
          parseAndValidate: (rawText: string): SceneConfiguration => {
            const parsed = parsePlanningResponse(rawText);
            if (!parsed.ok) {
              throw new SceneConfigurationValidationError(parsed.reason);
            }
            return validateSceneConfiguration(parsed.value, resolvedReferenceAssets, {
              maxDurationMs: input.maxDurationMs,
              targetDurationMs: input.targetDurationMs
            });
          }
        };
      }
    });
  }
}
