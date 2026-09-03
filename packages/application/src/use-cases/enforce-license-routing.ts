import { createHash } from "node:crypto";
import type { ComponentRef } from "@cco/contracts";
import {
  evaluateLicenseRouting,
  type EvaluatedComponentStatus
} from "../license-routing-policy.js";
import type { LicenseRegistryPort } from "../ports/license-registry-repository.js";
import {
  LicenseRoutingError,
  type LicenseRoutingOperationContext
} from "./license-routing-error.js";

export { type LicenseRoutingOperationContext } from "./license-routing-error.js";

export function sanitizeOperationContext(op: unknown): LicenseRoutingOperationContext | undefined {
  if (!op || typeof op !== "object" || Array.isArray(op)) {
    return undefined;
  }
  const record = op as Record<string, unknown>;
  if (record.kind === "generation") {
    return {
      kind: "generation",
      ...(typeof record.renderJobId === "string" ? { renderJobId: record.renderJobId } : {}),
      ...(typeof record.sceneId === "string" ? { sceneId: record.sceneId } : {}),
      ...(typeof record.campaignId === "string" ? { campaignId: record.campaignId } : {})
    };
  }
  if (record.kind === "assembly") {
    return {
      kind: "assembly",
      ...(typeof record.campaignId === "string" ? { campaignId: record.campaignId } : {}),
      ...(typeof record.outputStemId === "string" ? { outputStemId: record.outputStemId } : {})
    };
  }
  if (record.kind === "custom") {
    return {
      kind: "custom",
      operationId: typeof record.operationId === "string" ? record.operationId : "unknown"
    };
  }
  return undefined;
}

export interface LicenseRoutingDecision {
  readonly decisionId: string;
  readonly registryRevision: string;
  readonly evaluatedAt: string;
  readonly components: readonly EvaluatedComponentStatus[];
  readonly operation?: LicenseRoutingOperationContext | undefined;
}

export interface EnforceLicenseRoutingDependencies {
  readonly registry: LicenseRegistryPort;
  readonly now?: (() => Date) | undefined;
  readonly generateDecisionId?: (() => string) | undefined;
}

export interface EnforceLicenseRoutingParams {
  readonly requiredComponents: readonly ComponentRef[];
  readonly operation?: LicenseRoutingOperationContext | undefined;
}

export class EnforceLicenseRouting {
  constructor(private readonly deps: EnforceLicenseRoutingDependencies) {}

  enforce(params: EnforceLicenseRoutingParams): LicenseRoutingDecision {
    const { requiredComponents } = params;
    const sanitizedOperation = sanitizeOperationContext(params.operation);
    const snapshot = this.deps.registry.getSnapshot();
    const evaluation = evaluateLicenseRouting(requiredComponents, snapshot);
    const now = this.deps.now ? this.deps.now() : new Date();
    const defaultGenerateDecisionId = () => {
      const canonical = {
        registryRevision: snapshot.registryRevision,
        components: [...requiredComponents]
          .map((c) => ({
            id: c.componentId,
            type: c.componentType,
            ver: c.versionOrRevision
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        operation: sanitizedOperation ?? null
      };
      const hash = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex")
        .slice(0, 32);
      const uuidLike = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
      return `gov-dec-${uuidLike}`;
    };
    const generateDecisionId = this.deps.generateDecisionId ?? defaultGenerateDecisionId;
    const decisionId = generateDecisionId();

    if (!evaluation.permitted) {
      const reasons = evaluation.deniedReasons ?? ["License routing policy denied execution"];
      throw new LicenseRoutingError(`License routing denied: ${reasons.join("; ")}`, {
        decisionId,
        registryRevision: snapshot.registryRevision,
        evaluatedComponents: evaluation.evaluated,
        deniedReasons: reasons,
        operation: sanitizedOperation
      });
    }

    return {
      decisionId,
      registryRevision: snapshot.registryRevision,
      evaluatedAt: now.toISOString(),
      components: evaluation.evaluated,
      ...(sanitizedOperation !== undefined ? { operation: sanitizedOperation } : {})
    };
  }
}
