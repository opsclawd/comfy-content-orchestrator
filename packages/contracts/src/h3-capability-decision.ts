import { z } from "zod";
import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";
import { sha256HashSchema } from "./persistent-media.js";
import {
  H3CandidateExecutionSpecificationSchema,
  H3CandidateProfileKeySchema,
  computeH3CandidateSpecificationDigest,
  type H3CandidateExecutionSpecification
} from "./h3-candidate-profile.js";

export const H3CapabilityVerdictSchema = z.enum(["pass", "fail", "unknown"]);
export type H3CapabilityVerdict = z.infer<typeof H3CapabilityVerdictSchema>;

export const H3CapabilityDecisionRowSchema = z
  .object({
    specification: H3CandidateExecutionSpecificationSchema,
    specificationDigest: sha256HashSchema,
    speedVerdict: H3CapabilityVerdictSchema,
    qualityVerdict: H3CapabilityVerdictSchema,
    overallVerdict: H3CapabilityVerdictSchema,
    evidenceDigests: z.array(sha256HashSchema).min(1),
    operatorIdentity: z.string().trim().min(1),
    decidedAt: z.string().datetime(),
    notes: z.string().optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    const computedDigest = computeH3CandidateSpecificationDigest(
      val.specification as H3CandidateExecutionSpecification
    );
    if (val.specificationDigest !== computedDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `specificationDigest mismatch: declared "${val.specificationDigest}", computed "${computedDigest}"`,
        path: ["specificationDigest"]
      });
    }

    if (val.overallVerdict === "pass") {
      if (val.speedVerdict !== "pass") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'overallVerdict cannot be "pass" when speedVerdict is not "pass"',
          path: ["overallVerdict"]
        });
      }
      if (val.qualityVerdict !== "pass") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'overallVerdict cannot be "pass" when qualityVerdict is not "pass"',
          path: ["overallVerdict"]
        });
      }
    }
  });

export type H3CapabilityDecisionRow = z.infer<typeof H3CapabilityDecisionRowSchema>;

export const H3CapabilityMatrixEnvelopeSchema = z
  .object({
    version: z.literal(1),
    matrixId: z.string().trim().min(1),
    rows: z.array(H3CapabilityDecisionRowSchema),
    signedBy: z.string().trim().min(1),
    signatureHex: z.string().regex(/^[0-9a-fA-F]+$/),
    signedAt: z.string().datetime()
  })
  .strict();

export type H3CapabilityMatrixEnvelope = z.infer<typeof H3CapabilityMatrixEnvelopeSchema>;

export function canonicalizeCapabilityMatrixPayload(
  envelope: Omit<H3CapabilityMatrixEnvelope, "signatureHex">
): string {
  return canonicalizeJson(envelope);
}

export function computeCapabilityMatrixDigest(
  envelope: Omit<H3CapabilityMatrixEnvelope, "signatureHex">
): string {
  return sha256Hex(canonicalizeCapabilityMatrixPayload(envelope));
}

export const H3AuthorizationPurposeSchema = z.enum(["staging", "production"]);
export type H3AuthorizationPurpose = z.infer<typeof H3AuthorizationPurposeSchema>;

export const H3AuthorizationScopeSchema = z.enum(["staging", "production"]);
export type H3AuthorizationScope = z.infer<typeof H3AuthorizationScopeSchema>;

export const H3CandidateAuthorizationPayloadSchema = z
  .object({
    version: z.literal(1),
    candidateKey: H3CandidateProfileKeySchema,
    specificationDigest: sha256HashSchema,
    goldMasterWorkflowHash: sha256HashSchema,
    goldMasterModelHashesDigest: sha256HashSchema,
    targetHostname: z.string().trim().min(1),
    targetGpuUuid: z.string().trim().min(1),
    purpose: H3AuthorizationPurposeSchema,
    scope: H3AuthorizationScopeSchema,
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    operatorId: z.string().trim().min(1)
  })
  .strict()
  .superRefine((val, ctx) => {
    const issued = Date.parse(val.issuedAt as string);
    const expires = Date.parse(val.expiresAt as string);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiresAt must be chronologically after issuedAt",
        path: ["expiresAt"]
      });
    }

    if (val.purpose === "production" && val.scope !== "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A staging-scope grant cannot be used for "production" purpose',
        path: ["purpose"]
      });
    }
  });

export type H3CandidateAuthorizationPayload = z.infer<typeof H3CandidateAuthorizationPayloadSchema>;

export const H3CandidateAuthorizationGrantSchema = z
  .object({
    payload: H3CandidateAuthorizationPayloadSchema,
    signature: z.string().regex(/^[0-9a-fA-F]+$/),
    signerKeyId: z.string().trim().min(1)
  })
  .strict();

export type H3CandidateAuthorizationGrant = z.infer<typeof H3CandidateAuthorizationGrantSchema>;

export function canonicalizeAuthorizationPayload(payload: H3CandidateAuthorizationPayload): string {
  return canonicalizeJson(payload);
}

export function computeAuthorizationPayloadDigest(
  payload: H3CandidateAuthorizationPayload
): string {
  return sha256Hex(canonicalizeAuthorizationPayload(payload));
}
