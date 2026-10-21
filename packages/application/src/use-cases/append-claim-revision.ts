import { AppendClaimRevisionRequestSchema, type AppendClaimRevisionRequest } from "@cco/contracts";
import { createClaimId, ProductValidationError, type ClaimId } from "@cco/domain";
import type { CommandEnvelope, ProductClaimRevisionResult, UnitOfWork } from "../ports/index.js";
import { validateClaimCommandEnvelope } from "./claim-command-envelope-validator.js";

export type AppendClaimRevisionPayload = AppendClaimRevisionRequest & {
  readonly claimId: ClaimId | string;
};

export class AppendClaimRevisionUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    cmd: CommandEnvelope<AppendClaimRevisionPayload>
  ): Promise<ProductClaimRevisionResult> {
    validateClaimCommandEnvelope(cmd);

    const { claimId: rawClaimId, ...restPayload } = cmd.payload;
    const claimId = createClaimId(String(rawClaimId));

    const parseResult = AppendClaimRevisionRequestSchema.safeParse(restPayload);
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
      return context.productClaims.appendClaimRevision({
        ...cmd,
        payload: {
          ...parseResult.data,
          claimId
        }
      });
    });
  }
}
