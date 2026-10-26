import {
  CampaignDurationPlanningError,
  type EvidenceOrigin,
  type ExecutionRealm,
  type OwnerKind
} from "@cco/contracts";
import type { RealmAdmissionContext } from "../ports/realm-admission-context.js";

export interface IsolatedSimulationRealmContextOptions {
  readonly testRealmId: string;
  readonly isolationDescriptorDigest: string;
  readonly fixtureSetRevision?: string | undefined;
}

export class IsolatedSimulationRealmContext implements RealmAdmissionContext {
  readonly realm: ExecutionRealm;
  readonly fixtureSetRevision: string;

  constructor(options: IsolatedSimulationRealmContextOptions) {
    if (!options.testRealmId || options.testRealmId.trim().length === 0) {
      throw new Error("testRealmId must be a non-empty string");
    }
    if (
      !options.isolationDescriptorDigest ||
      !/^[0-9a-f]{64}$/.test(options.isolationDescriptorDigest)
    ) {
      throw new Error(
        "isolationDescriptorDigest must be a 64-character lowercase hexadecimal hash"
      );
    }

    this.realm = Object.freeze({
      kind: "isolated_test" as const,
      testRealmId: options.testRealmId.trim(),
      isolationDescriptorDigest: options.isolationDescriptorDigest.trim()
    });
    this.fixtureSetRevision = options.fixtureSetRevision ?? "fixture-rev-1";
  }

  isSimulatedAdmissible(origin: EvidenceOrigin): boolean {
    return origin === "simulated_test";
  }

  validateAdmission(params: {
    readonly scope: "production" | "staging";
    readonly ownerKind: OwnerKind;
    readonly origin: EvidenceOrigin;
    readonly realm: ExecutionRealm;
  }): void {
    if (params.realm.kind !== "isolated_test") {
      throw new CampaignDurationPlanningError(
        "realm_mismatch",
        `Execution realm mismatch: expected isolated_test realm, received ${params.realm.kind}`
      );
    }

    if (
      this.realm.kind === "isolated_test" &&
      (params.realm.testRealmId !== this.realm.testRealmId ||
        params.realm.isolationDescriptorDigest !== this.realm.isolationDescriptorDigest)
    ) {
      throw new CampaignDurationPlanningError(
        "realm_mismatch",
        `Test realm mismatch: expected (${this.realm.testRealmId}, ${this.realm.isolationDescriptorDigest}), received (${params.realm.testRealmId}, ${params.realm.isolationDescriptorDigest})`
      );
    }

    if (params.origin !== "simulated_test") {
      throw new CampaignDurationPlanningError(
        "origin_not_admissible",
        `Evidence origin "${params.origin}" is not admissible in simulation realm (only simulated_test is permitted)`
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

export function createIsolatedSimulationRealmContext(
  options: IsolatedSimulationRealmContextOptions
): RealmAdmissionContext {
  return new IsolatedSimulationRealmContext(options);
}
