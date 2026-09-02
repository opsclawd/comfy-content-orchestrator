import type { EvaluatedComponentStatus } from "../license-routing-policy.js";

export type LicenseRoutingOperationContext =
  | {
      readonly kind: "generation";
      readonly renderJobId?: string | undefined;
      readonly sceneId?: string | undefined;
      readonly campaignId?: string | undefined;
    }
  | {
      readonly kind: "assembly";
      readonly campaignId?: string | undefined;
      readonly outputStemId?: string | undefined;
    }
  | {
      readonly kind: "custom";
      readonly operationId: string;
    };

export interface LicenseRoutingErrorContext {
  readonly registryRevision: string;
  readonly evaluatedComponents: readonly EvaluatedComponentStatus[];
  readonly deniedReasons: readonly string[];
  readonly operation?: LicenseRoutingOperationContext | undefined;
}

export class LicenseRoutingError extends Error {
  override readonly name = "LicenseRoutingError";
  readonly code = "license_routing_denied";
  readonly registryRevision: string;
  readonly evaluatedComponents: readonly EvaluatedComponentStatus[];
  readonly deniedReasons: readonly string[];
  readonly operation?: LicenseRoutingOperationContext | undefined;

  constructor(message: string, context: LicenseRoutingErrorContext) {
    super(message);
    this.registryRevision = context.registryRevision;
    this.evaluatedComponents = context.evaluatedComponents;
    this.deniedReasons = context.deniedReasons;
    this.operation = context.operation;
  }
}
