import type {
  ComponentLicenseRegistrySnapshot,
  ComponentRef,
  ComponentType,
  LicensePolicyStatus
} from "@cco/contracts";

export interface EvaluatedComponentStatus {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly versionOrRevision: string;
  readonly status: LicensePolicyStatus | "unknown_component";
  readonly licenseId?: string | undefined;
  readonly licenseSource?: string | undefined;
  readonly policyRevision?: string | undefined;
}

export interface LicenseRoutingEvaluation {
  readonly permitted: boolean;
  readonly evaluated: readonly EvaluatedComponentStatus[];
  readonly deniedReasons?: readonly string[] | undefined;
}

export function evaluateLicenseRouting(
  requiredComponents: readonly ComponentRef[],
  registrySnapshot: ComponentLicenseRegistrySnapshot
): LicenseRoutingEvaluation {
  if (!requiredComponents || requiredComponents.length === 0) {
    return {
      permitted: false,
      evaluated: [],
      deniedReasons: ["No required components specified for license routing evaluation"]
    };
  }

  const evaluated: EvaluatedComponentStatus[] = [];
  const deniedReasons: string[] = [];

  for (const ref of requiredComponents) {
    if (!ref.componentId || !ref.versionOrRevision || !ref.componentType) {
      evaluated.push({
        componentId: ref.componentId ?? "unknown",
        componentType: ref.componentType ?? "model",
        versionOrRevision: ref.versionOrRevision ?? "unknown",
        status: "unknown_component"
      });
      deniedReasons.push("Invalid component reference: missing required fields");
      continue;
    }

    const match = registrySnapshot.entries.find(
      (entry) =>
        entry.componentId === ref.componentId &&
        entry.versionOrRevision === ref.versionOrRevision &&
        entry.componentType === ref.componentType
    );

    if (!match) {
      evaluated.push({
        componentId: ref.componentId,
        componentType: ref.componentType,
        versionOrRevision: ref.versionOrRevision,
        status: "unknown_component"
      });
      deniedReasons.push(
        `Component "${ref.componentId}" (version: "${ref.versionOrRevision}", type: "${ref.componentType}") is not registered in license registry revision "${registrySnapshot.registryRevision}"`
      );
      continue;
    }

    evaluated.push({
      componentId: match.componentId,
      componentType: match.componentType,
      versionOrRevision: match.versionOrRevision,
      status: match.status,
      ...(match.licenseId !== undefined ? { licenseId: match.licenseId } : {}),
      licenseSource: match.licenseSource,
      policyRevision: match.policyRevision
    });

    if (match.status !== "approved") {
      deniedReasons.push(
        `Component "${ref.componentId}" (version: "${ref.versionOrRevision}", type: "${ref.componentType}") has policy status "${match.status}"`
      );
    }
  }

  const permitted = deniedReasons.length === 0;

  return {
    permitted,
    evaluated,
    ...(deniedReasons.length > 0 ? { deniedReasons } : {})
  };
}
