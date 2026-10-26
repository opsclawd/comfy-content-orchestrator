import { z } from "zod";
import { RenderProfileKeySchema, type RenderProfileKey } from "./render-profile.js";
import { H3CandidateProfileKeySchema, type H3CandidateProfileKey } from "./h3-candidate-profile.js";

export type ReleasedProductionProfileKey = H3ReleaseProfileKey;
export type StagingCandidateProfileKey = H3CandidateProfileKey;
export type LegacyProductionProfileKey = RenderProfileKey;

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hexadecimal hash");

export const H3ReleaseProfileKeySchema = z
  .string()
  .regex(
    /^H3_RELEASE_[0-9a-f]{64}_V[1-9]\d*$/,
    "Released profile key must match pattern H3_RELEASE_<64-hex-spec-digest>_V<version>"
  );
export type H3ReleaseProfileKey = z.infer<typeof H3ReleaseProfileKeySchema>;

export function computeH3ReleaseKey(
  specificationDigest: string,
  version: number = 1
): H3ReleaseProfileKey {
  const normalized = specificationDigest.toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid specificationDigest for release key: ${specificationDigest}`);
  }
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(`Invalid version for release key: ${version}`);
  }
  return `H3_RELEASE_${normalized}_V${version}` as H3ReleaseProfileKey;
}

export const LegacyProductionProfileSelectionSchema = z
  .object({
    kind: z.literal("legacy_production"),
    profileKey: RenderProfileKeySchema,
    version: z.number().int().positive().default(1)
  })
  .strict();
export type LegacyProductionProfileSelection = z.infer<
  typeof LegacyProductionProfileSelectionSchema
>;

export const ReleasedProductionProfileSelectionSchema = z
  .object({
    kind: z.literal("released_production"),
    profileKey: H3ReleaseProfileKeySchema,
    specificationDigest: sha256HashSchema,
    releaseId: z.string().trim().min(1),
    signedReleaseDigest: sha256HashSchema,
    certificationRecordDigest: sha256HashSchema,
    deploymentEnablementDigest: sha256HashSchema
  })
  .strict();
export type ReleasedProductionProfileSelection = z.infer<
  typeof ReleasedProductionProfileSelectionSchema
>;

export const StagingCandidateProfileSelectionSchema = z
  .object({
    kind: z.literal("staging_candidate"),
    profileKey: H3CandidateProfileKeySchema,
    specificationDigest: sha256HashSchema,
    targetId: z.string().trim().min(1),
    authorizationId: z.string().trim().min(1)
  })
  .strict();
export type StagingCandidateProfileSelection = z.infer<
  typeof StagingCandidateProfileSelectionSchema
>;

export const ExecutionProfileSelectionSchema = z
  .discriminatedUnion("kind", [
    LegacyProductionProfileSelectionSchema,
    ReleasedProductionProfileSelectionSchema,
    StagingCandidateProfileSelectionSchema
  ])
  .superRefine((val, ctx) => {
    if (val.kind === "released_production") {
      const expectedPrefix = `H3_RELEASE_${val.specificationDigest.toLowerCase()}_`;
      if (!val.profileKey.startsWith(expectedPrefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `profileKey "${val.profileKey}" does not match specificationDigest "${val.specificationDigest}"`,
          path: ["profileKey"]
        });
      }
    }
  });
export type ExecutionProfileSelection = z.infer<typeof ExecutionProfileSelectionSchema>;

export function isReleasedProductionProfileKey(key: string | undefined): boolean {
  if (!key) return false;
  return /^H3_RELEASE_[0-9a-f]{64}_V[1-9]\d*$/.test(key.trim());
}

export function isLegacyProductionProfileKey(key: string | undefined): boolean {
  if (!key) return false;
  const result = RenderProfileKeySchema.safeParse(key.trim());
  return result.success;
}

export function isStagingCandidateProfileKey(key: string | undefined): boolean {
  if (!key) return false;
  return /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(key.trim());
}
