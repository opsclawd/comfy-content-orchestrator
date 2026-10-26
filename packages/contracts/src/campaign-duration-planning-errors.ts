import { z } from "zod";

export const CampaignDurationPlanningReasonSchema = z.enum([
  "capability_unavailable",
  "release_unavailable",
  "authorization_denied",
  "profile_route_mismatch",
  "no_feasible_allocation",
  "scene_ceiling",
  "assembly_envelope_exceeded",
  "catalog_limit",
  "stale_plan",
  "repair_required",
  "realm_mismatch",
  "origin_not_admissible",
  "observation_authority_invalid"
]);
export type CampaignDurationPlanningReason = z.infer<typeof CampaignDurationPlanningReasonSchema>;

export class CampaignDurationPlanningError extends Error {
  override readonly name = "CampaignDurationPlanningError";
  readonly reason: CampaignDurationPlanningReason;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    reason: CampaignDurationPlanningReason,
    message: string,
    details?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.reason = reason;
    this.details = details;
  }

  get httpStatusCode(): number {
    switch (this.reason) {
      case "no_feasible_allocation":
      case "scene_ceiling":
      case "assembly_envelope_exceeded":
      case "profile_route_mismatch":
      case "catalog_limit":
        return 422;
      case "stale_plan":
      case "repair_required":
        return 409;
      case "authorization_denied":
      case "realm_mismatch":
      case "origin_not_admissible":
      case "observation_authority_invalid":
        return 403;
      case "capability_unavailable":
      case "release_unavailable":
        return 503;
      default:
        return 400;
    }
  }

  get statusCode(): number {
    return this.httpStatusCode;
  }
}
