import { ReviewClaimRequestSchema, type ReviewClaimRequest } from "@cco/contracts";
import { createClaimId, ProductValidationError, type ClaimId } from "@cco/domain";
import {
  DenyAllReviewerAuthorizationAdapter,
  type CommandEnvelope,
  type ProductClaimReviewResult,
  type ReviewerAuthorizationPort,
  type UnitOfWork
} from "../ports/index.js";
import { validateClaimCommandEnvelope } from "./claim-command-envelope-validator.js";

export type ReviewClaimPayload = ReviewClaimRequest & {
  readonly claimId: ClaimId | string;
};

export class ReviewClaimUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly reviewerAuth: ReviewerAuthorizationPort = new DenyAllReviewerAuthorizationAdapter()
  ) {}

  async execute(cmd: CommandEnvelope<ReviewClaimPayload>): Promise<ProductClaimReviewResult> {
    validateClaimCommandEnvelope(cmd);

    const { claimId: rawClaimId, ...restPayload } = cmd.payload;
    const claimId = createClaimId(String(rawClaimId));

    const parseResult = ReviewClaimRequestSchema.safeParse(restPayload);
    if (!parseResult.success) {
      throw new ProductValidationError(
        parseResult.error.issues.map((issue) => ({
          code: "INVALID_FIELD_COMBINATION",
          path: issue.path.map(String),
          message: issue.message
        }))
      );
    }

    await this.reviewerAuth.assertCanReviewClaim(cmd.clientId, cmd.actorId);

    return this.uow.execute(async (context) => {
      if (!context.productClaims) {
        throw new Error(
          "UnitOfWorkContext.productClaims is not configured for this UnitOfWork implementation."
        );
      }
      return context.productClaims.reviewClaim({
        ...cmd,
        payload: {
          ...parseResult.data,
          claimId
        }
      });
    });
  }
}
