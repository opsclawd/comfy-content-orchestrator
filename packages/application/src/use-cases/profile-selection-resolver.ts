import {
  type ExecutionProfileSelection,
  type ExecutionRealm,
  type H3CapabilityResolverReader,
  type H3ProfileFrameCapability,
  type ReleasedProductionProfileKey,
  type RenderProfileKey,
  isReleasedProductionProfileKey,
  isStagingCandidateProfileKey,
  resolveH3ProfileFrameCapabilities,
  CampaignDurationPlanningError
} from "@cco/contracts";
import type { ProductionReleaseCapabilityReader } from "../ports/production-release-ports.js";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";

export interface ProfileSelectionResolverDependencies {
  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
  readonly registryReader?: H3CapabilityResolverReader | undefined;
}

export class ProfileSelectionResolver {
  constructor(private readonly deps: ProfileSelectionResolverDependencies) {}

  async buildCapabilitiesMap(
    principal?: string | undefined
  ): Promise<Map<string, H3ProfileFrameCapability>> {
    const capabilities = new Map<string, H3ProfileFrameCapability>();

    if (this.deps.productionReleaseReader) {
      // Outages must not block legacy-only operations; catch and return empty
      const releases = await this.deps.productionReleaseReader
        .listReleasedProfiles()
        .catch(() => []);
      for (const rel of releases) {
        const frames = rel.specification.frames;
        capabilities.set(
          rel.key,
          Object.freeze({
            profileKey: rel.key,
            route: rel.specification.route,
            routingMode: rel.specification.routingMode,
            width: rel.specification.width,
            height: rel.specification.height,
            fps: rel.specification.fps,
            allowedFrameCounts: Object.freeze([frames]),
            isAllowedFrameCount: (f: number) => f === frames
          })
        );
      }
    }

    if (this.deps.stagingAuthSource) {
      // Outages must not block legacy-only operations; catch and return empty
      const candidates = await this.deps.stagingAuthSource
        .listAuthorizedCandidates(principal)
        .catch(() => []);
      for (const cand of candidates) {
        const cap = resolveH3ProfileFrameCapabilities(cand.profileKey, this.deps.registryReader);
        if (cap) {
          capabilities.set(cand.profileKey, cap);
        }
      }
    }

    return capabilities;
  }

  async resolveSelection(
    key: string,
    principal?: string | undefined
  ): Promise<ExecutionProfileSelection> {
    if (isReleasedProductionProfileKey(key)) {
      if (!this.deps.productionReleaseReader) {
        throw new CampaignDurationPlanningError(
          "release_unavailable",
          `No production release reader configured for released profile: ${key}`
        );
      }
      const rel = await this.deps.productionReleaseReader.getReleasedProfile(key);
      if (!rel) {
        throw new CampaignDurationPlanningError(
          "release_unavailable",
          `Released profile ${key} is not available or not enabled`
        );
      }
      return {
        kind: "released_production",
        profileKey: key as ReleasedProductionProfileKey,
        specificationDigest: rel.specificationDigest,
        releaseId: rel.releaseId,
        signedReleaseDigest: rel.signedReleaseDigest,
        certificationRecordDigest: rel.certificationRecordDigest,
        deploymentEnablementDigest: rel.deploymentEnablementDigest
      };
    }

    if (isStagingCandidateProfileKey(key)) {
      if (!this.deps.stagingAuthSource) {
        throw new CampaignDurationPlanningError(
          "capability_unavailable",
          `No staging authorization source configured for candidate profile: ${key}`
        );
      }
      const candidates = await this.deps.stagingAuthSource.listAuthorizedCandidates(principal);
      const cand = candidates.find((c) => c.profileKey === key);
      if (!cand) {
        throw new CampaignDurationPlanningError(
          "capability_unavailable",
          `Staging candidate ${key} is not authorized`
        );
      }
      return cand;
    }

    return {
      kind: "legacy_production",
      profileKey: key as RenderProfileKey,
      version: 1
    };
  }

  async verifyAndResolveSelection(
    supplied: ExecutionProfileSelection,
    principal?: string | undefined
  ): Promise<ExecutionProfileSelection> {
    const authority = await this.resolveSelection(supplied.profileKey, principal);

    if (supplied.kind !== authority.kind) {
      throw new CampaignDurationPlanningError(
        "authorization_denied",
        `Supplied profile selection kind "${supplied.kind}" does not match authority kind "${authority.kind}" for "${supplied.profileKey}"`
      );
    }

    if (supplied.kind === "released_production" && authority.kind === "released_production") {
      if (
        supplied.specificationDigest !== authority.specificationDigest ||
        supplied.releaseId !== authority.releaseId ||
        supplied.signedReleaseDigest !== authority.signedReleaseDigest ||
        supplied.certificationRecordDigest !== authority.certificationRecordDigest ||
        supplied.deploymentEnablementDigest !== authority.deploymentEnablementDigest
      ) {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          `Supplied released_production selection for "${supplied.profileKey}" disagrees with authority digests or metadata`
        );
      }
    } else if (supplied.kind === "staging_candidate" && authority.kind === "staging_candidate") {
      if (
        supplied.specificationDigest !== authority.specificationDigest ||
        supplied.authorizationId !== authority.authorizationId ||
        supplied.targetId !== authority.targetId
      ) {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          `Supplied staging_candidate selection for "${supplied.profileKey}" disagrees with authority specificationDigest or authorization target`
        );
      }
    }

    return authority;
  }

  verifyScopeAndRealm(
    selection: ExecutionProfileSelection,
    scope: "production" | "staging",
    realm: ExecutionRealm
  ): void {
    if (selection.kind === "staging_candidate") {
      if (scope === "production") {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          `Staging candidate "${selection.profileKey}" cannot be used in production scope`
        );
      }
    }

    if (scope === "production" && realm.kind === "isolated_test") {
      throw new CampaignDurationPlanningError(
        "authorization_denied",
        `Production scope cannot execute within isolated_test realm "${realm.testRealmId}"`
      );
    }

    if (realm.kind === "isolated_test" && scope !== "staging") {
      throw new CampaignDurationPlanningError(
        "authorization_denied",
        `Isolated test realm "${realm.testRealmId}" requires staging scope`
      );
    }
  }
}
