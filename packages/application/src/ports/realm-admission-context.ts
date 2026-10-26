import {
  CampaignDurationPlanningError,
  type EvidenceOrigin,
  type ExecutionRealm,
  type OwnerKind
} from "@cco/contracts";

export interface RealmAdmissionContext {
  readonly realm: ExecutionRealm;
  isSimulatedAdmissible(origin: EvidenceOrigin): boolean;
  validateAdmission(params: {
    readonly scope: "production" | "staging";
    readonly ownerKind: OwnerKind;
    readonly origin: EvidenceOrigin;
    readonly realm: ExecutionRealm;
  }): void;
}

export class DeployedLiveRealmContext implements RealmAdmissionContext {
  readonly realm: ExecutionRealm;

  constructor(deploymentId: string) {
    if (!deploymentId || deploymentId.trim().length === 0) {
      throw new Error("deploymentId must be a non-empty string");
    }
    this.realm = Object.freeze({
      kind: "deployed" as const,
      deploymentId: deploymentId.trim()
    });
  }

  isSimulatedAdmissible(_origin: EvidenceOrigin): boolean {
    return false;
  }

  validateAdmission(params: {
    readonly scope: "production" | "staging";
    readonly ownerKind: OwnerKind;
    readonly origin: EvidenceOrigin;
    readonly realm: ExecutionRealm;
  }): void {
    if (params.realm.kind !== "deployed") {
      throw new CampaignDurationPlanningError(
        "realm_mismatch",
        `Execution realm mismatch: expected deployed realm, received ${params.realm.kind}`
      );
    }

    if (this.realm.kind === "deployed" && params.realm.deploymentId !== this.realm.deploymentId) {
      throw new CampaignDurationPlanningError(
        "realm_mismatch",
        `Deployment ID mismatch: expected "${this.realm.deploymentId}", received "${params.realm.deploymentId}"`
      );
    }

    if (params.origin !== "live_execution") {
      throw new CampaignDurationPlanningError(
        "origin_not_admissible",
        `Evidence origin "${params.origin}" is not admissible in deployed execution context (only live_execution is permitted)`
      );
    }

    if (params.scope === "production") {
      if (params.ownerKind !== "production_run") {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          `Production execution requires ownerKind "production_run", received "${params.ownerKind}"`
        );
      }
    } else if (params.scope === "staging") {
      if (params.ownerKind !== "staging_acceptance" && params.ownerKind !== "standalone_staging") {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          `Staging execution requires ownerKind "staging_acceptance" or "standalone_staging", received "${params.ownerKind}"`
        );
      }
    }
  }
}

export function createDeployedLiveRealmContext(deploymentId: string): RealmAdmissionContext {
  return new DeployedLiveRealmContext(deploymentId);
}
