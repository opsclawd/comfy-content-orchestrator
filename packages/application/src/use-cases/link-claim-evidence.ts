import { LinkClaimEvidenceRequestSchema, type LinkClaimEvidenceRequest } from "@cco/contracts";
import { createClaimId, ProductValidationError, type ClaimId } from "@cco/domain";
import type { CommandEnvelope, ProductClaimLinkResult, UnitOfWork } from "../ports/index.js";
import { validateClaimCommandEnvelope } from "./claim-command-envelope-validator.js";

export type LinkClaimEvidencePayload = LinkClaimEvidenceRequest & {
  readonly claimId: ClaimId | string;
};

export class LinkClaimEvidenceUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: CommandEnvelope<LinkClaimEvidencePayload>): Promise<ProductClaimLinkResult> {
    validateClaimCommandEnvelope(cmd);

    const { claimId: rawClaimId, ...restPayload } = cmd.payload;
    const claimId = createClaimId(String(rawClaimId));

    const parseResult = LinkClaimEvidenceRequestSchema.safeParse(restPayload);
    if (!parseResult.success) {
      throw new ProductValidationError(
        parseResult.error.issues.map((issue) => ({
          code: "INVALID_FIELD_COMBINATION",
          path: issue.path.map(String),
          message: issue.message
        }))
      );
    }

    return this.uow.execute(async (context) => {
      if (!context.productClaims) {
        throw new Error(
          "UnitOfWorkContext.productClaims is not configured for this UnitOfWork implementation."
        );
      }
      return context.productClaims.linkClaimEvidence({
        ...cmd,
        payload: {
          ...parseResult.data,
          claimId
        }
      });
    });
  }
}
